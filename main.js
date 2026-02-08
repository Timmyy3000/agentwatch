const { app, BrowserWindow, ipcMain, Tray, Menu, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { fetchViaWindow } = require('./src/fetch-via-window');

const store = new Store({
  encryptionKey: 'agentwatch-secure-key-2026'
});

// Debug mode: set DEBUG_LOG=1 env var or pass --debug flag to see verbose logs.
// Regular users will only see critical errors in the console.
const DEBUG = process.env.DEBUG_LOG === '1' || process.argv.includes('--debug');
function debugLog(...args) {
  if (DEBUG) console.log('[Debug]', ...args);
}

function sanitizeForDebug(value, depth = 0) {
  if (depth > 3) return '[MaxDepth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 220 ? `${value.slice(0, 220)}...` : value;
  }
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForDebug(item, depth + 1));
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes('cookie')
      || lowered.includes('token')
      || lowered.includes('session')
      || lowered.includes('authoriz')
      || lowered.includes('bearer')
    ) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = sanitizeForDebug(val, depth + 1);
  }
  return out;
}

function appendDebugEvent(event, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    payload: sanitizeForDebug(payload)
  };
  debugEvents.push(entry);
  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.shift();
  }

  try {
    const logPath = path.join(app.getPath('userData'), 'agentwatch-debug.log');
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    // Don't break app flow if disk logging fails.
  }
}

const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PARTITIONS = {
  claude: 'persist:claude',
  codex: 'persist:codex'
};

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_LOGIN_URL = 'https://chatgpt.com/codex/settings/usage';
const CODEX_DAILY_BREAKDOWN_URL = 'https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown';
const MAX_DEBUG_EVENTS = 300;

let mainWindow = null;
let tray = null;
const debugEvents = [];

const WIDGET_WIDTH = 580;
const WIDGET_HEIGHT = 360;
const WIDGET_HEIGHT_WITH_TIMER = 392;
const COMPACT_WIDTH = 410;
const COMPACT_HEIGHT = 180;
const SETTINGS_WIDTH = 560;
const SETTINGS_HEIGHT = 680;

function getProviderSession(provider) {
  return session.fromPartition(PARTITIONS[provider]);
}

function setAllKnownUserAgents() {
  session.defaultSession.setUserAgent(CHROME_USER_AGENT);
  getProviderSession('claude').setUserAgent(CHROME_USER_AGENT);
  getProviderSession('codex').setUserAgent(CHROME_USER_AGENT);
}

function migrateStoreSchema() {
  const schemaVersion = store.get('schemaVersion', 1);
  if (schemaVersion >= 2) return;

  const legacySessionKey = store.get('sessionKey');
  const legacyOrganizationId = store.get('organizationId');

  if (legacySessionKey) {
    store.set('providers.claude.sessionKey', legacySessionKey);
  }
  if (legacyOrganizationId) {
    store.set('providers.claude.organizationId', legacyOrganizationId);
  }

  store.set('schemaVersion', 2);
}

function getClaudeCredentials() {
  return {
    sessionKey: store.get('providers.claude.sessionKey', store.get('sessionKey')),
    organizationId: store.get('providers.claude.organizationId', store.get('organizationId'))
  };
}

function getCodexCredentials() {
  return {
    cookieHeader: store.get('providers.codex.cookieHeader'),
    cookieName: store.get('providers.codex.cookieName'),
    cookieValue: store.get('providers.codex.cookieValue'),
    bearerToken: store.get('providers.codex.bearerToken')
  };
}

function hasClaudeCredentials() {
  const creds = getClaudeCredentials();
  return Boolean(creds.sessionKey && creds.organizationId);
}

function hasCodexCredentials() {
  const creds = getCodexCredentials();
  return Boolean(creds.bearerToken || creds.cookieHeader || (creds.cookieName && creds.cookieValue));
}

async function setClaudeSessionCookie(sessionKey) {
  await getProviderSession('claude').cookies.set({
    url: 'https://claude.ai',
    name: 'sessionKey',
    value: sessionKey,
    domain: '.claude.ai',
    path: '/',
    secure: true,
    httpOnly: true
  });
  debugLog('Claude session cookie set');
}

async function setCodexSessionCookie(cookieName, cookieValue) {
  const cookiePayload = {
    url: 'https://chatgpt.com',
    name: cookieName,
    value: cookieValue,
    path: '/',
    secure: true,
    httpOnly: true
  };

  // __Host- cookies must not set an explicit Domain attribute.
  if (!cookieName.startsWith('__Host-')) {
    cookiePayload.domain = '.chatgpt.com';
  }

  await getProviderSession('codex').cookies.set(cookiePayload);
  debugLog('Codex cookie set:', cookieName);
}

function parseCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== 'string') return [];
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return null;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
      if (!name || !value) return null;
      return { name, value };
    })
    .filter(Boolean);
}

async function setCodexAuthCookies({ cookieHeader, cookieName, cookieValue }) {
  if (cookieHeader) {
    const parsed = parseCookieHeader(cookieHeader);
    if (parsed.length === 0) {
      throw new Error('Cookie header did not contain valid name=value pairs');
    }

    // Most-auth cookies are host/domain scoped to chatgpt.com.
    for (const cookie of parsed) {
      await setCodexSessionCookie(cookie.name, cookie.value);
    }
    appendDebugEvent('codex.cookies.header_applied', {
      count: parsed.length,
      names: parsed.map((c) => c.name)
    });
    return;
  }

  // Bearer-only mode does not require cookie injection.
  if (!cookieName && !cookieValue) {
    return;
  }

  if (!cookieName || !cookieValue) {
    throw new Error('Codex cookieName and cookieValue are required');
  }

  await setCodexSessionCookie(cookieName, cookieValue);
}

function clearClaudeCredentials() {
  store.delete('providers.claude.sessionKey');
  store.delete('providers.claude.organizationId');
  // Keep deleting legacy keys for compatibility cleanup.
  store.delete('sessionKey');
  store.delete('organizationId');
}

function clearCodexCredentials() {
  store.delete('providers.codex.cookieHeader');
  store.delete('providers.codex.cookieName');
  store.delete('providers.codex.cookieValue');
  store.delete('providers.codex.bearerToken');
}

async function clearProviderSessionData(provider) {
  const ses = getProviderSession(provider);
  const targetUrl = provider === 'claude' ? 'https://claude.ai' : 'https://chatgpt.com';

  const cookies = await ses.cookies.get({ url: targetUrl });
  for (const cookie of cookies) {
    await ses.cookies.remove(targetUrl, cookie.name);
  }

  await ses.clearStorageData({
    storages: ['localstorage', 'sessionstorage', 'cachestorage'],
    origin: targetUrl
  });
}

async function clearAllProviderSessions() {
  await clearProviderSessionData('claude');
  await clearProviderSessionData('codex');
}

function emitSessionExpired(provider) {
  if (mainWindow) {
    mainWindow.webContents.send('provider-session-expired', provider);
    // Backward compatible event for existing renderer paths.
    if (provider === 'claude') {
      mainWindow.webContents.send('session-expired');
    }
  }
}

function parseJsonMaybeWithPrefix(text) {
  if (typeof text !== 'string') {
    throw new Error('InvalidJSON: response body is not text');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('InvalidJSON: empty response');
  }

  const dePrefixed = trimmed.replace(/^\)\]\}'\s*/, '');
  return JSON.parse(dePrefixed);
}

function isHtmlLike(text) {
  if (typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return lower.includes('<html')
    || lower.includes('<!doctype html')
    || lower.includes('enable javascript and cookies to continue')
    || lower.includes('just a moment');
}

function buildCodexRequestHeaders(credentials = {}) {
  const headers = {
    accept: 'application/json,text/plain,*/*'
  };

  if (credentials.bearerToken) {
    const token = credentials.bearerToken.trim();
    headers.authorization = token.toLowerCase().startsWith('bearer ')
      ? token
      : `Bearer ${token}`;
  }

  return headers;
}

async function fetchCodexJsonViaPageContext(targetUrl, { timeoutMs = 20000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 900,
      height: 700,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: PARTITIONS.codex
      }
    });

    const timeout = setTimeout(() => {
      win.close();
      reject(new Error('Request timeout'));
    }, timeoutMs);

    const finalizeReject = (error) => {
      clearTimeout(timeout);
      win.close();
      reject(error);
    };

    win.webContents.on('did-finish-load', async () => {
      try {
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const response = await fetch(${JSON.stringify(targetUrl)}, {
              method: 'GET',
              credentials: 'include',
              headers: ${JSON.stringify(headers)}
            });
            const body = await response.text();
            return {
              ok: response.ok,
              status: response.status,
              body
            };
          })();
        `);

        clearTimeout(timeout);
        win.close();

        if (!result || typeof result.body !== 'string') {
          appendDebugEvent('codex.page_fetch.invalid_payload', { targetUrl, resultType: typeof result });
          reject(new Error('Invalid response payload'));
          return;
        }

        if (!result.ok) {
          appendDebugEvent('codex.page_fetch.http_error', {
            targetUrl,
            status: result.status,
            bodyPreview: result.body.substring(0, 180)
          });
          reject(new Error(`HTTP ${result.status}: ${result.body.substring(0, 180)}`));
          return;
        }

        if (isHtmlLike(result.body)) {
          appendDebugEvent('codex.page_fetch.unexpected_html', {
            targetUrl,
            bodyPreview: result.body.substring(0, 180)
          });
          reject(new Error(`UnexpectedHTML: ${result.body.substring(0, 180)}`));
          return;
        }

        try {
          const parsed = parseJsonMaybeWithPrefix(result.body);
          appendDebugEvent('codex.page_fetch.ok', {
            targetUrl,
            topLevelKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 20) : []
          });
          resolve(parsed);
        } catch (parseError) {
          appendDebugEvent('codex.page_fetch.invalid_json', {
            targetUrl,
            bodyPreview: result.body.substring(0, 180)
          });
          reject(new Error(`InvalidJSON: ${result.body.substring(0, 180)}`));
        }
      } catch (error) {
        appendDebugEvent('codex.page_fetch.exception', { targetUrl, error: error.message });
        finalizeReject(error);
      }
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      appendDebugEvent('codex.page_fetch.load_failed', { targetUrl, errorCode, errorDescription });
      finalizeReject(new Error(`LoadFailed: ${errorCode} ${errorDescription}`));
    });

    win.loadURL(CODEX_LOGIN_URL);
  });
}

async function fetchCodexUsageRaw(credentials = {}) {
  const headers = buildCodexRequestHeaders(credentials);
  const hasBearer = Boolean(credentials?.bearerToken);

  // First attempt: direct load (fast path). Skip if bearer is required.
  if (!hasBearer) {
    try {
      const direct = await fetchViaWindow(CODEX_USAGE_URL, {
        partition: PARTITIONS.codex,
        timeoutMs: 15000
      });
      if (direct && typeof direct === 'object') {
        const authFailure = looksLikeAuthFailurePayload(direct);
        appendDebugEvent('codex.usage.direct_ok', {
          topLevelKeys: Object.keys(direct).slice(0, 20),
          authFailure
        });

        // Do not short-circuit on unauthorized JSON payloads.
        if (!authFailure) {
          return direct;
        }
      }
    } catch (error) {
      debugLog('Codex direct usage fetch failed:', error.message);
      appendDebugEvent('codex.usage.direct_failed', { error: error.message });
    }
  } else {
    appendDebugEvent('codex.usage.direct_skipped', {
      reason: 'bearer_token_present'
    });
  }

  // Fallback: fetch inside an authenticated chatgpt.com page context.
  appendDebugEvent('codex.usage.fallback_page_fetch', {});
  return fetchCodexJsonViaPageContext(CODEX_USAGE_URL, {
    timeoutMs: 20000,
    headers
  });
}

function toFiniteNumber(value) {
  let num = Number(value);
  if (!Number.isFinite(num) && typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    num = Number(cleaned);
  }
  return Number.isFinite(num) ? num : null;
}

function looksLikeAuthFailurePayload(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const text = JSON.stringify(raw).toLowerCase();
  return text.includes('unauthorized')
    || text.includes('forbidden')
    || text.includes('not_authenticated')
    || text.includes('authentication required')
    || text.includes('login required');
}

function hasAuthSignals(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const candidates = [raw, raw.data, raw.user, raw.result].filter(Boolean);
  return candidates.some((entry) => (
    Boolean(entry.user_id)
    || Boolean(entry.account_id)
    || Boolean(entry.email)
    || Boolean(entry.plan_type)
    || Boolean(entry.rate_limit)
    || Boolean(entry.code_review_rate_limit)
  ));
}

function normalizeCodexWindow(windowData) {
  if (!windowData || typeof windowData !== 'object') return null;

  const utilization = toFiniteNumber(
    windowData.used_percent
    ?? windowData.usedPercent
    ?? windowData.used_pct
    ?? windowData.utilization
  );
  if (utilization == null) return null;

  const resetAtSeconds = toFiniteNumber(
    windowData.reset_at
    ?? windowData.resetAt
    ?? windowData.reset_at_seconds
  );
  const resetAfterSeconds = toFiniteNumber(
    windowData.reset_after_seconds
    ?? windowData.resetAfterSeconds
  );
  const limitWindowSeconds = toFiniteNumber(
    windowData.limit_window_seconds
    ?? windowData.limitWindowSeconds
    ?? windowData.window_seconds
  );

  let resetAt = null;
  if (resetAtSeconds != null) {
    resetAt = new Date(resetAtSeconds * 1000).toISOString();
  } else if (resetAfterSeconds != null) {
    resetAt = new Date(Date.now() + (resetAfterSeconds * 1000)).toISOString();
  }

  const totalWindowMinutes = limitWindowSeconds != null
    ? Math.round(limitWindowSeconds / 60)
    : null;

  return {
    utilization,
    resets_at: resetAt,
    total_window_minutes: totalWindowMinutes
  };
}

function collectCodexWindowCandidates(raw) {
  const buckets = [
    raw?.rate_limit,
    raw?.code_review_rate_limit,
    raw?.rateLimit,
    raw?.codeReviewRateLimit
  ];

  const out = [];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue;
    if (bucket.primary_window) out.push(bucket.primary_window);
    if (bucket.secondary_window) out.push(bucket.secondary_window);
    if (bucket.primaryWindow) out.push(bucket.primaryWindow);
    if (bucket.secondaryWindow) out.push(bucket.secondaryWindow);
  }
  return out;
}

async function validateClaudeSessionKey(sessionKey) {
  if (!sessionKey) {
    return { success: false, error: 'Session key is required' };
  }
  debugLog('Validating Claude session key:', sessionKey.substring(0, 20) + '...');
  try {
    await setClaudeSessionCookie(sessionKey);
    const data = await fetchViaWindow('https://claude.ai/api/organizations', {
      partition: PARTITIONS.claude
    });

    if (Array.isArray(data) && data.length > 0) {
      const organizationId = data[0].uuid || data[0].id;
      return { success: true, organizationId };
    }

    if (data && data.error) {
      return { success: false, error: data.error.message || data.error };
    }

    return { success: false, error: 'No organization found' };
  } catch (error) {
    await getProviderSession('claude').cookies.remove('https://claude.ai', 'sessionKey');
    return { success: false, error: error.message };
  }
}

async function detectClaudeSessionKey() {
  const claudeSession = getProviderSession('claude');

  try {
    await claudeSession.cookies.remove('https://claude.ai', 'sessionKey');
  } catch (error) {
    // Ignore stale cookie cleanup failures.
  }

  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: 'Log in to Claude',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: PARTITIONS.claude
      }
    });

    let resolved = false;

    const onCookieChanged = (event, cookie, cause, removed) => {
      if (
        cookie.name === 'sessionKey'
        && cookie.domain.includes('claude.ai')
        && !removed
        && cookie.value
      ) {
        resolved = true;
        claudeSession.cookies.removeListener('changed', onCookieChanged);
        loginWin.close();
        resolve({ success: true, sessionKey: cookie.value });
      }
    };

    claudeSession.cookies.on('changed', onCookieChanged);

    loginWin.on('closed', () => {
      claudeSession.cookies.removeListener('changed', onCookieChanged);
      if (!resolved) {
        resolve({ success: false, error: 'Login window closed' });
      }
    });

    loginWin.loadURL('https://claude.ai/login');
  });
}

function normalizeCodexUsage(raw) {
  const candidates = collectCodexWindowCandidates(raw);
  const normalizedCandidates = candidates
    .map((candidate) => ({
      window: normalizeCodexWindow(candidate),
      seconds: toFiniteNumber(candidate?.limit_window_seconds ?? candidate?.limitWindowSeconds)
    }))
    .filter((entry) => entry.window && entry.seconds != null);

  let session = null;
  let weekly = null;

  if (normalizedCandidates.length > 0) {
    const bySecondsAsc = [...normalizedCandidates].sort((a, b) => a.seconds - b.seconds);
    session = bySecondsAsc.find((entry) => entry.seconds <= 6 * 60 * 60) || bySecondsAsc[0];

    const weeklyCandidates = normalizedCandidates
      .filter((entry) => entry.seconds >= 24 * 60 * 60)
      .sort((a, b) => Math.abs(a.seconds - (7 * 24 * 60 * 60)) - Math.abs(b.seconds - (7 * 24 * 60 * 60)));

    weekly = weeklyCandidates[0] || bySecondsAsc[bySecondsAsc.length - 1];
  }

  return {
    five_hour: session?.window || null,
    seven_day: weekly?.window || null,
    codex_meta: {
      plan_type: raw?.plan_type || null,
      fetched_at: new Date().toISOString(),
      windows_seen: normalizedCandidates.length
    }
  };
}

async function fetchClaudeUsageData() {
  const { sessionKey, organizationId } = getClaudeCredentials();

  if (!sessionKey || !organizationId) {
    throw new Error('Missing Claude credentials');
  }

  await setClaudeSessionCookie(sessionKey);

  const usageUrl = `https://claude.ai/api/organizations/${organizationId}/usage`;
  const overageUrl = `https://claude.ai/api/organizations/${organizationId}/overage_spend_limit`;
  const prepaidUrl = `https://claude.ai/api/organizations/${organizationId}/prepaid/credits`;

  const [usageResult, overageResult, prepaidResult] = await Promise.allSettled([
    fetchViaWindow(usageUrl, { partition: PARTITIONS.claude }),
    fetchViaWindow(overageUrl, { partition: PARTITIONS.claude }),
    fetchViaWindow(prepaidUrl, { partition: PARTITIONS.claude })
  ]);

  if (usageResult.status === 'rejected') {
    const error = usageResult.reason;
    const errorMessage = error?.message || '';
    const isBlocked = errorMessage.startsWith('CloudflareBlocked')
      || errorMessage.startsWith('CloudflareChallenge')
      || errorMessage.startsWith('UnexpectedHTML');

    if (isBlocked) {
      clearClaudeCredentials();
      await clearProviderSessionData('claude');
      emitSessionExpired('claude');
      throw new Error('SessionExpired');
    }

    throw error;
  }

  const data = usageResult.value;

  if (overageResult.status === 'fulfilled' && overageResult.value) {
    const overage = overageResult.value;
    const limit = overage.monthly_credit_limit ?? overage.spend_limit_amount_cents;
    const used = overage.used_credits ?? overage.balance_cents;
    const enabled = overage.is_enabled !== undefined ? overage.is_enabled : (limit != null);

    if (enabled && typeof limit === 'number' && limit > 0 && typeof used === 'number') {
      data.extra_usage = {
        utilization: (used / limit) * 100,
        resets_at: null,
        used_cents: used,
        limit_cents: limit
      };
    }
  }

  if (prepaidResult.status === 'fulfilled' && prepaidResult.value) {
    const prepaid = prepaidResult.value;
    if (typeof prepaid.amount === 'number') {
      if (!data.extra_usage) data.extra_usage = {};
      data.extra_usage.balance_cents = prepaid.amount;
    }
  }

  return data;
}

async function fetchCodexUsageData() {
  const credentials = getCodexCredentials();

  if (!credentials.bearerToken && !credentials.cookieHeader && !(credentials.cookieName && credentials.cookieValue)) {
    throw new Error('Missing Codex credentials');
  }

  await setCodexAuthCookies(credentials);

  try {
    const usage = await fetchCodexUsageRaw(credentials);
    appendDebugEvent('codex.usage.raw_received', {
      hasAuthSignals: hasAuthSignals(usage),
      looksLikeAuthFailure: looksLikeAuthFailurePayload(usage),
      topLevelKeys: usage && typeof usage === 'object' ? Object.keys(usage).slice(0, 20) : []
    });

    const normalized = normalizeCodexUsage(usage);
    if (!normalized.five_hour && !normalized.seven_day) {
      // Fallback: daily breakdown can at least verify usage endpoint access.
      try {
        const breakdown = await fetchCodexJsonViaPageContext(CODEX_DAILY_BREAKDOWN_URL, {
          timeoutMs: 15000,
          headers: buildCodexRequestHeaders(credentials)
        });
        normalized.codex_meta.daily_breakdown_available = Array.isArray(breakdown?.data);
        appendDebugEvent('codex.usage.breakdown_probe', {
          available: normalized.codex_meta.daily_breakdown_available,
          points: Array.isArray(breakdown?.data) ? breakdown.data.length : 0
        });
      } catch (error) {
        normalized.codex_meta.daily_breakdown_available = false;
        appendDebugEvent('codex.usage.breakdown_probe_failed', { error: error.message });
      }
    }

    appendDebugEvent('codex.usage.normalized', {
      hasSession: Boolean(normalized.five_hour),
      hasWeekly: Boolean(normalized.seven_day),
      windowsSeen: normalized.codex_meta?.windows_seen
    });
    return normalized;
  } catch (error) {
    const errorMessage = error?.message || '';
    const isAuthError = errorMessage.includes('401')
      || errorMessage.includes('403')
      || errorMessage.startsWith('CloudflareBlocked')
      || errorMessage.startsWith('CloudflareChallenge')
      || errorMessage.startsWith('UnexpectedHTML');

    if (isAuthError) {
      clearCodexCredentials();
      await clearProviderSessionData('codex');
      emitSessionExpired('codex');
      throw new Error('SessionExpired');
    }

    throw error;
  }
}

async function validateCodexCookie(authPayload = {}) {
  try {
    const usingHeader = Boolean(authPayload.cookieHeader);
    const usingBearer = Boolean(authPayload.bearerToken);
    if (!usingBearer && !usingHeader && !(authPayload.cookieName && authPayload.cookieValue)) {
      return { success: false, error: 'Provide bearer token, cookie header, or cookie name/value' };
    }

    await setCodexAuthCookies(authPayload);
    const usage = await fetchCodexUsageRaw(authPayload);

    const hasRateWindow = Boolean(
      usage?.rate_limit?.primary_window
      || usage?.rate_limit?.secondary_window
      || usage?.code_review_rate_limit?.primary_window
      || usage?.code_review_rate_limit?.secondary_window
    );

    const looksAuthenticated = hasAuthSignals(usage);
    const authFailure = looksLikeAuthFailurePayload(usage);

    appendDebugEvent('codex.auth.validation', {
      cookieMode: usingBearer ? 'bearer' : (usingHeader ? 'header' : 'single_cookie'),
      cookieName: authPayload.cookieName || null,
      hasRateWindow,
      looksAuthenticated,
      authFailure,
      topLevelKeys: usage && typeof usage === 'object' ? Object.keys(usage).slice(0, 20) : [],
      usagePreview: usage && typeof usage === 'object' ? usage : String(usage)
    });

    if (authFailure) {
      return { success: false, error: 'Authentication appears invalid for the provided cookie' };
    }

    if (hasRateWindow) {
      return { success: true };
    }

    if (looksAuthenticated) {
      return {
        success: true,
        warning: 'Authenticated, but no supported rate-limit windows were returned yet. Metrics may show as unavailable until usage data is exposed.'
      };
    }

    // Keep the flow debuggable: allow connect when payload is non-empty, then inspect logs.
    if (usage && typeof usage === 'object' && Object.keys(usage).length > 0) {
      return {
        success: true,
        warning: 'Could not fully confirm auth signals, but payload is non-empty. Connected for debugging; check Codex logs.'
      };
    }

    return { success: false, error: 'Could not confirm authentication from usage response' };
  } catch (error) {
    appendDebugEvent('codex.auth.validation_error', {
      cookieMode: authPayload.bearerToken ? 'bearer' : (authPayload.cookieHeader ? 'header' : 'single_cookie'),
      cookieName: authPayload.cookieName || null,
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

function isCodexCookieCandidate(cookie) {
  if (!cookie || !cookie.value || !cookie.name) return false;
  if (!cookie.domain || !cookie.domain.includes('chatgpt.com')) return false;

  const knownCandidates = [
    '__Secure-next-auth.session-token',
    '__Host-next-auth.csrf-token',
    '_puid',
    'cf_clearance',
    'oai-did'
  ];

  return knownCandidates.includes(cookie.name)
    || cookie.name.startsWith('__Secure-')
    || cookie.name.includes('auth');
}

async function detectCodexAuthCookie() {
  const codexSession = getProviderSession('codex');

  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 1100,
      height: 760,
      title: 'Log in to ChatGPT for Codex',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: PARTITIONS.codex
      }
    });

    const tested = new Set();
    const queue = [];
    let checking = false;
    let resolved = false;
    let sawGoogleOAuth = false;
    let openedExternalOAuth = false;

    const cleanup = () => {
      codexSession.cookies.removeListener('changed', onCookieChanged);
    };

    const processQueue = async () => {
      if (checking || resolved) return;
      checking = true;

      while (queue.length > 0 && !resolved) {
        const cookie = queue.shift();
        const signature = `${cookie.name}:${cookie.value}`;
        if (tested.has(signature)) continue;
        tested.add(signature);

        const validation = await validateCodexCookie({
          cookieName: cookie.name,
          cookieValue: cookie.value
        });
        if (validation.success) {
          resolved = true;
          cleanup();
          loginWin.close();
          resolve({
            success: true,
            cookieName: cookie.name,
            cookieValue: cookie.value
          });
          return;
        }
      }

      checking = false;
    };

    const onCookieChanged = (event, cookie, cause, removed) => {
      if (removed || resolved) return;
      if (!isCodexCookieCandidate(cookie)) return;
      queue.push(cookie);
      processQueue();
    };

    codexSession.cookies.on('changed', onCookieChanged);

    loginWin.webContents.on('did-navigate', (event, url) => {
      if (typeof url === 'string' && url.includes('accounts.google.com')) {
        sawGoogleOAuth = true;
        if (!openedExternalOAuth) {
          openedExternalOAuth = true;
          shell.openExternal(url);
          loginWin.close();
        }
      }
    });

    loginWin.on('closed', () => {
      cleanup();
      if (!resolved) {
        if (sawGoogleOAuth) {
          resolve({
            success: false,
            error: 'Google sign-in was opened in your default browser. Complete login there, then use Manual Connect with your auth cookie.'
          });
          return;
        }
        resolve({ success: false, error: 'Login window closed' });
      }
    });

    loginWin.loadURL(CODEX_LOGIN_URL);
  });
}

function createMainWindow() {
  const savedPosition = store.get('windowPosition');
  const isCompactMode = store.get('compactMode', false);
  const showUpdateTimer = store.get('showUpdateTimer', false);

  const windowHeight = isCompactMode
    ? COMPACT_HEIGHT
    : (showUpdateTimer ? WIDGET_HEIGHT_WITH_TIMER : WIDGET_HEIGHT);

  const windowOptions = {
    width: isCompactMode ? COMPACT_WIDTH : WIDGET_WIDTH,
    height: windowHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };

  if (savedPosition) {
    windowOptions.x = savedPosition.x;
    windowOptions.y = savedPosition.y;
  }

  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.loadFile('src/renderer/index.html');

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true);

  mainWindow.on('move', () => {
    const position = mainWindow.getBounds();
    store.set('windowPosition', { x: position.x, y: position.y });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Widget',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          } else {
            createMainWindow();
          }
        }
      },
      {
        label: 'Refresh',
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('refresh-usage');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Log Out (All)',
        click: async () => {
          clearClaudeCredentials();
          clearCodexCredentials();
          await clearAllProviderSessions();
          emitSessionExpired('claude');
          emitSessionExpired('codex');
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setToolTip('AgentWatch');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

// Compatibility IPC: legacy Claude methods
ipcMain.handle('get-credentials', () => getClaudeCredentials());

ipcMain.handle('save-credentials', async (event, { sessionKey, organizationId }) => {
  store.set('providers.claude.sessionKey', sessionKey);
  if (organizationId) {
    store.set('providers.claude.organizationId', organizationId);
  }
  await setClaudeSessionCookie(sessionKey);
  return true;
});

ipcMain.handle('delete-credentials', async () => {
  clearClaudeCredentials();
  await clearProviderSessionData('claude');
  return true;
});

ipcMain.handle('validate-session-key', async (event, sessionKey) => {
  return validateClaudeSessionKey(sessionKey);
});

ipcMain.handle('detect-session-key', async () => {
  return detectClaudeSessionKey();
});

ipcMain.handle('fetch-usage-data', async () => fetchClaudeUsageData());

// New provider-aware IPC
ipcMain.handle('get-provider-credentials', (event, provider) => {
  if (provider === 'claude') return getClaudeCredentials();
  if (provider === 'codex') return getCodexCredentials();
  throw new Error(`Unknown provider: ${provider}`);
});

ipcMain.handle('save-provider-credentials', async (event, provider, payload) => {
  if (provider === 'claude') {
    const { sessionKey, organizationId } = payload || {};
    if (!sessionKey || !organizationId) {
      throw new Error('Claude sessionKey and organizationId are required');
    }
    store.set('providers.claude.sessionKey', sessionKey);
    store.set('providers.claude.organizationId', organizationId);
    await setClaudeSessionCookie(sessionKey);
    return true;
  }

  if (provider === 'codex') {
    const { cookieName, cookieValue, cookieHeader, bearerToken } = payload || {};
    if (!bearerToken && !cookieHeader && !(cookieName && cookieValue)) {
      throw new Error('Provide bearerToken, cookieHeader, or cookieName/cookieValue for Codex');
    }

    if (cookieName && cookieValue) {
      store.set('providers.codex.cookieName', cookieName);
      store.set('providers.codex.cookieValue', cookieValue);
    } else {
      store.delete('providers.codex.cookieName');
      store.delete('providers.codex.cookieValue');
    }

    if (cookieHeader) store.set('providers.codex.cookieHeader', cookieHeader);
    else store.delete('providers.codex.cookieHeader');

    if (bearerToken) store.set('providers.codex.bearerToken', bearerToken);
    else store.delete('providers.codex.bearerToken');

    await setCodexAuthCookies({ cookieName, cookieValue, cookieHeader, bearerToken });
    return true;
  }

  throw new Error(`Unknown provider: ${provider}`);
});

ipcMain.handle('delete-provider-credentials', async (event, provider) => {
  if (provider === 'claude') {
    clearClaudeCredentials();
    await clearProviderSessionData('claude');
    return true;
  }

  if (provider === 'codex') {
    clearCodexCredentials();
    await clearProviderSessionData('codex');
    return true;
  }

  throw new Error(`Unknown provider: ${provider}`);
});

ipcMain.handle('validate-provider-auth', async (event, provider, payload) => {
  if (provider === 'claude') {
    return validateClaudeSessionKey(payload?.sessionKey);
  }

  if (provider === 'codex') {
    return validateCodexCookie(payload || {});
  }

  throw new Error(`Unknown provider: ${provider}`);
});

ipcMain.handle('detect-provider-auth', async (event, provider) => {
  if (provider === 'claude') {
    return detectClaudeSessionKey();
  }

  if (provider === 'codex') {
    return detectCodexAuthCookie();
  }

  throw new Error(`Unknown provider: ${provider}`);
});

ipcMain.handle('fetch-provider-usage', async (event, provider) => {
  if (provider === 'claude') return fetchClaudeUsageData();
  if (provider === 'codex') return fetchCodexUsageData();
  throw new Error(`Unknown provider: ${provider}`);
});

ipcMain.handle('fetch-all-usage', async () => {
  const response = {
    claude: {
      connected: hasClaudeCredentials(),
      data: null,
      error: null
    },
    codex: {
      connected: hasCodexCredentials(),
      data: null,
      error: null
    }
  };

  const tasks = [];
  if (response.claude.connected) {
    tasks.push(
      fetchClaudeUsageData()
        .then((data) => {
          response.claude.data = data;
        })
        .catch((error) => {
          response.claude.error = error.message;
        })
    );
  }

  if (response.codex.connected) {
    tasks.push(
      fetchCodexUsageData()
        .then((data) => {
          response.codex.data = data;
        })
        .catch((error) => {
          response.codex.error = error.message;
        })
    );
  }

  await Promise.all(tasks);
  return response;
});

ipcMain.handle('get-provider-statuses', () => {
  return {
    claude: hasClaudeCredentials(),
    codex: hasCodexCredentials()
  };
});

ipcMain.handle('get-debug-logs', () => {
  return [...debugEvents];
});

ipcMain.handle('clear-debug-logs', () => {
  debugEvents.length = 0;
  try {
    const logPath = path.join(app.getPath('userData'), 'agentwatch-debug.log');
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '', 'utf8');
    }
  } catch (error) {
    // Ignore disk cleanup errors.
  }
  return true;
});

ipcMain.handle('get-debug-log-path', () => {
  try {
    return path.join(app.getPath('userData'), 'agentwatch-debug.log');
  } catch (error) {
    return null;
  }
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('close-window', () => {
  app.quit();
});

ipcMain.on('resize-window', (event, height) => {
  if (!mainWindow) return;
  const isCompactMode = store.get('compactMode', false);
  const targetWidth = isCompactMode ? COMPACT_WIDTH : WIDGET_WIDTH;
  mainWindow.setContentSize(targetWidth, height);
});

ipcMain.handle('get-window-position', () => {
  if (mainWindow) {
    return mainWindow.getBounds();
  }
  return null;
});

ipcMain.handle('set-window-position', (event, { x, y }) => {
  if (mainWindow) {
    mainWindow.setPosition(x, y);
    return true;
  }
  return false;
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// Compact mode handlers
ipcMain.handle('get-compact-mode', () => {
  return store.get('compactMode', false);
});

ipcMain.handle('get-refresh-interval', () => {
  return store.get('refreshInterval', 300000);
});

ipcMain.handle('set-refresh-interval', (event, interval) => {
  store.set('refreshInterval', interval);
  return true;
});

ipcMain.handle('get-show-update-timer', () => {
  return store.get('showUpdateTimer', false);
});

ipcMain.handle('set-show-update-timer', (event, show) => {
  store.set('showUpdateTimer', show);
  return true;
});

ipcMain.handle('set-compact-mode', (event, isCompact) => {
  store.set('compactMode', isCompact);
  return true;
});

ipcMain.handle('expand-for-settings', (event, expand) => {
  if (!mainWindow) return false;

  const bounds = mainWindow.getBounds();
  const isCompactMode = store.get('compactMode', false);
  const showUpdateTimer = store.get('showUpdateTimer', false);

  mainWindow.setResizable(true);

  if (expand) {
    mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: SETTINGS_WIDTH, height: SETTINGS_HEIGHT });
  } else {
    const targetWidth = isCompactMode ? COMPACT_WIDTH : WIDGET_WIDTH;
    const targetHeight = isCompactMode
      ? COMPACT_HEIGHT
      : (showUpdateTimer ? WIDGET_HEIGHT_WITH_TIMER : WIDGET_HEIGHT);
    mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: targetWidth, height: targetHeight });
  }

  mainWindow.setResizable(false);
  return true;
});

// App lifecycle
app.whenReady().then(async () => {
  migrateStoreSchema();
  setAllKnownUserAgents();

  const claudeCreds = getClaudeCredentials();
  if (claudeCreds.sessionKey) {
    await setClaudeSessionCookie(claudeCreds.sessionKey);
  }

  const codexCreds = getCodexCredentials();
  if (codexCreds.bearerToken || codexCreds.cookieHeader || (codexCreds.cookieName && codexCreds.cookieValue)) {
    await setCodexAuthCookies(codexCreds);
  }

  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
