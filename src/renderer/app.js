
// Application state
let claudeCredentials = null;
let codexCredentials = null;
let updateInterval = null;
let countdownInterval = null;
let updateTimerInterval = null;
let latestClaudeUsageData = null;
let latestCodexUsageData = null;
let isExpanded = false;
let refreshIntervalMs = 5 * 60 * 1000;
let showUpdateTimer = false;
let nextUpdateTime = null;

const WIDGET_HEIGHT_COLLAPSED = 348;
const WIDGET_ROW_HEIGHT = 34;

// Debug logging - only shows in DevTools.
const DEBUG = (new URLSearchParams(window.location.search)).has('debug');
function debugLog(...args) {
    if (DEBUG) console.log('[Debug]', ...args);
}

const elements = {
    loadingContainer: document.getElementById('loadingContainer'),
    loginContainer: document.getElementById('loginContainer'),
    noUsageContainer: document.getElementById('noUsageContainer'),
    mainContent: document.getElementById('mainContent'),

    loginStep1: document.getElementById('loginStep1'),
    loginStep2: document.getElementById('loginStep2'),
    autoDetectBtn: document.getElementById('autoDetectBtn'),
    autoDetectError: document.getElementById('autoDetectError'),
    openBrowserLink: document.getElementById('openBrowserLink'),
    nextStepBtn: document.getElementById('nextStepBtn'),
    backStepBtn: document.getElementById('backStepBtn'),
    sessionKeyInput: document.getElementById('sessionKeyInput'),
    connectBtn: document.getElementById('connectBtn'),
    sessionKeyError: document.getElementById('sessionKeyError'),
    openSettingsForCodexBtn: document.getElementById('openSettingsForCodexBtn'),

    refreshBtn: document.getElementById('refreshBtn'),
    minimizeBtn: document.getElementById('minimizeBtn'),
    closeBtn: document.getElementById('closeBtn'),

    claudeStatus: document.getElementById('claudeStatus'),
    codexStatus: document.getElementById('codexStatus'),
    codexHint: document.getElementById('codexHint'),

    claudeSessionPercentage: document.getElementById('claudeSessionPercentage'),
    claudeSessionProgress: document.getElementById('claudeSessionProgress'),
    claudeSessionTimer: document.getElementById('claudeSessionTimer'),
    claudeSessionTimeText: document.getElementById('claudeSessionTimeText'),

    claudeWeeklyPercentage: document.getElementById('claudeWeeklyPercentage'),
    claudeWeeklyProgress: document.getElementById('claudeWeeklyProgress'),
    claudeWeeklyTimer: document.getElementById('claudeWeeklyTimer'),
    claudeWeeklyTimeText: document.getElementById('claudeWeeklyTimeText'),

    codexSessionPercentage: document.getElementById('codexSessionPercentage'),
    codexSessionProgress: document.getElementById('codexSessionProgress'),
    codexSessionTimer: document.getElementById('codexSessionTimer'),
    codexSessionTimeText: document.getElementById('codexSessionTimeText'),

    codexWeeklyPercentage: document.getElementById('codexWeeklyPercentage'),
    codexWeeklyProgress: document.getElementById('codexWeeklyProgress'),
    codexWeeklyTimer: document.getElementById('codexWeeklyTimer'),
    codexWeeklyTimeText: document.getElementById('codexWeeklyTimeText'),

    expandToggle: document.getElementById('expandToggle'),
    expandArrow: document.getElementById('expandArrow'),
    expandSection: document.getElementById('expandSection'),
    extraRows: document.getElementById('extraRows'),

    settingsBtn: document.getElementById('settingsBtn'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    compactModeToggle: document.getElementById('compactModeToggle'),

    compactSettingsBtn: document.getElementById('compactSettingsBtn'),
    compactMinimizeBtn: document.getElementById('compactMinimizeBtn'),
    compactCloseBtn: document.getElementById('compactCloseBtn'),

    refreshIntervalSelect: document.getElementById('refreshIntervalSelect'),
    showUpdateTimerToggle: document.getElementById('showUpdateTimerToggle'),

    codexAutoDetectBtn: document.getElementById('codexAutoDetectBtn'),
    codexManualConnectBtn: document.getElementById('codexManualConnectBtn'),
    codexDisconnectBtn: document.getElementById('codexDisconnectBtn'),
    openCodexBrowserBtn: document.getElementById('openCodexBrowserBtn'),
    copyCodexLogsBtn: document.getElementById('copyCodexLogsBtn'),
    clearCodexLogsBtn: document.getElementById('clearCodexLogsBtn'),
    codexCookieHeaderInput: document.getElementById('codexCookieHeaderInput'),
    codexBearerTokenInput: document.getElementById('codexBearerTokenInput'),
    codexCookieNameInput: document.getElementById('codexCookieNameInput'),
    codexCookieValueInput: document.getElementById('codexCookieValueInput'),
    codexAuthError: document.getElementById('codexAuthError'),

    updateTimerNormal: document.getElementById('updateTimerNormal'),
    updateTimerText: document.getElementById('updateTimerText'),
    updateTimerCompact: document.getElementById('updateTimerCompact')
};

const EXTRA_ROW_CONFIG = {
    seven_day_sonnet: { label: 'Sonnet (7d)', color: 'weekly' },
    seven_day_opus: { label: 'Opus (7d)', color: 'opus' },
    seven_day_cowork: { label: 'Cowork (7d)', color: 'weekly' },
    seven_day_oauth_apps: { label: 'OAuth Apps (7d)', color: 'weekly' },
    extra_usage: { label: 'Extra Usage', color: 'extra' }
};

async function init() {
    setupEventListeners();

    const isCompactMode = await window.electronAPI.getCompactMode();
    applyCompactMode(isCompactMode);
    elements.compactModeToggle.checked = isCompactMode;

    refreshIntervalMs = await window.electronAPI.getRefreshInterval();
    elements.refreshIntervalSelect.value = refreshIntervalMs.toString();

    showUpdateTimer = await window.electronAPI.getShowUpdateTimer();
    elements.showUpdateTimerToggle.checked = showUpdateTimer;
    applyUpdateTimerVisibility();

    await loadCredentials();
    refreshProviderStatus();

    if (hasAnyProviderConnected()) {
        showMainContent();
        await fetchAllUsageData();
        startAutoUpdate();
    } else {
        showLoginRequired();
    }
}

async function loadCredentials() {
    claudeCredentials = await window.electronAPI.getProviderCredentials('claude');
    codexCredentials = await window.electronAPI.getProviderCredentials('codex');
}

function hasClaudeConnected() {
    return Boolean(claudeCredentials?.sessionKey && claudeCredentials?.organizationId);
}

function hasCodexConnected() {
    return Boolean(
        codexCredentials?.bearerToken
        || codexCredentials?.cookieHeader
        || (codexCredentials?.cookieName && codexCredentials?.cookieValue)
    );
}

function hasAnyProviderConnected() {
    return hasClaudeConnected() || hasCodexConnected();
}

function applyCompactMode(isCompact) {
    if (isCompact) {
        document.body.classList.add('compact-mode');
    } else {
        document.body.classList.remove('compact-mode');
    }
}

async function openSettings() {
    await window.electronAPI.expandForSettings(true);
    elements.settingsOverlay.style.display = 'flex';
}

async function closeSettings() {
    elements.settingsOverlay.style.display = 'none';
    await window.electronAPI.expandForSettings(false);
}

function applyUpdateTimerVisibility() {
    if (showUpdateTimer) {
        elements.updateTimerNormal.style.display = 'flex';
        elements.updateTimerCompact.style.display = 'inline';
    } else {
        elements.updateTimerNormal.style.display = 'none';
        elements.updateTimerCompact.style.display = 'none';
    }
}

function updateTimerCountdown() {
    if (!showUpdateTimer || !nextUpdateTime) return;

    const now = Date.now();
    const remaining = Math.max(0, nextUpdateTime - now);
    const seconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    const timeStr = `${minutes}:${secs.toString().padStart(2, '0')}`;
    elements.updateTimerText.textContent = `Next update in ${timeStr}`;
    elements.updateTimerCompact.textContent = `⟳ ${timeStr}`;
}

function startUpdateTimerCountdown() {
    if (updateTimerInterval) clearInterval(updateTimerInterval);
    nextUpdateTime = Date.now() + refreshIntervalMs;
    updateTimerCountdown();
    updateTimerInterval = setInterval(updateTimerCountdown, 1000);
}

function stopUpdateTimerCountdown() {
    if (!updateTimerInterval) return;
    clearInterval(updateTimerInterval);
    updateTimerInterval = null;
}
function setupEventListeners() {
    elements.autoDetectBtn.addEventListener('click', handleClaudeAutoDetect);

    elements.nextStepBtn.addEventListener('click', () => {
        elements.loginStep1.style.display = 'none';
        elements.loginStep2.style.display = 'block';
        elements.sessionKeyInput.focus();
    });

    elements.backStepBtn.addEventListener('click', () => {
        elements.loginStep2.style.display = 'none';
        elements.loginStep1.style.display = 'flex';
        elements.sessionKeyError.textContent = '';
    });

    elements.openBrowserLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.openExternal('https://claude.ai');
    });

    elements.connectBtn.addEventListener('click', handleClaudeManualConnect);
    elements.sessionKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleClaudeManualConnect();
        elements.sessionKeyError.textContent = '';
    });

    elements.openSettingsForCodexBtn.addEventListener('click', async () => {
        await openSettings();
    });

    elements.refreshBtn.addEventListener('click', async () => {
        elements.refreshBtn.classList.add('spinning');
        await fetchAllUsageData();
        elements.refreshBtn.classList.remove('spinning');
    });

    elements.minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });

    elements.closeBtn.addEventListener('click', () => {
        window.electronAPI.closeWindow();
    });

    elements.expandToggle.addEventListener('click', () => {
        isExpanded = !isExpanded;
        elements.expandArrow.classList.toggle('expanded', isExpanded);
        elements.expandSection.style.display = isExpanded ? 'block' : 'none';
        resizeWidget();
    });

    elements.settingsBtn.addEventListener('click', openSettings);
    elements.closeSettingsBtn.addEventListener('click', closeSettings);

    elements.logoutBtn.addEventListener('click', async () => {
        await disconnectClaude();
    });

    elements.compactModeToggle.addEventListener('change', async (e) => {
        const isCompact = e.target.checked;
        await window.electronAPI.setCompactMode(isCompact);
        applyCompactMode(isCompact);
        resizeWidget();
    });

    elements.refreshIntervalSelect.addEventListener('change', async (e) => {
        refreshIntervalMs = parseInt(e.target.value, 10);
        await window.electronAPI.setRefreshInterval(refreshIntervalMs);
        if (updateInterval) {
            startAutoUpdate();
        }
    });

    elements.showUpdateTimerToggle.addEventListener('change', async (e) => {
        showUpdateTimer = e.target.checked;
        await window.electronAPI.setShowUpdateTimer(showUpdateTimer);
        applyUpdateTimerVisibility();
    });

    elements.codexAutoDetectBtn.addEventListener('click', handleCodexAutoDetect);
    elements.codexManualConnectBtn.addEventListener('click', handleCodexManualConnect);
    elements.codexDisconnectBtn.addEventListener('click', disconnectCodex);
    elements.copyCodexLogsBtn.addEventListener('click', copyCodexLogs);
    elements.clearCodexLogsBtn.addEventListener('click', clearCodexLogs);
    elements.openCodexBrowserBtn.addEventListener('click', () => {
        window.electronAPI.openExternal('https://chatgpt.com/codex/settings/usage');
    });

    elements.codexCookieValueInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCodexManualConnect();
    });

    elements.compactSettingsBtn.addEventListener('click', openSettings);
    elements.compactMinimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    elements.compactCloseBtn.addEventListener('click', () => window.electronAPI.closeWindow());

    window.electronAPI.onRefreshUsage(async () => {
        await fetchAllUsageData();
    });

    window.electronAPI.onSessionExpired(() => {
        claudeCredentials = { sessionKey: null, organizationId: null };
        latestClaudeUsageData = null;
        refreshProviderStatus();
        if (!hasAnyProviderConnected()) showLoginRequired();
    });

    window.electronAPI.onProviderSessionExpired((provider) => {
        if (provider === 'claude') {
            claudeCredentials = { sessionKey: null, organizationId: null };
            latestClaudeUsageData = null;
        } else if (provider === 'codex') {
            codexCredentials = { cookieName: null, cookieValue: null };
            latestCodexUsageData = null;
        }

        refreshProviderStatus();
        updateUI();

        if (!hasAnyProviderConnected()) {
            showLoginRequired();
        }
    });
}

async function writeClipboardText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
}

async function copyCodexLogs() {
    try {
        const [events, logPath] = await Promise.all([
            window.electronAPI.getDebugLogs(),
            window.electronAPI.getDebugLogPath()
        ]);

        const text = [
            `AgentWatch debug export @ ${new Date().toISOString()}`,
            logPath ? `File: ${logPath}` : 'File: unavailable',
            '',
            JSON.stringify(events, null, 2)
        ].join('\n');

        await writeClipboardText(text);
        elements.codexAuthError.textContent = 'Codex logs copied to clipboard.';
    } catch (error) {
        elements.codexAuthError.textContent = `Failed to copy logs: ${error.message}`;
    }
}

async function clearCodexLogs() {
    try {
        await window.electronAPI.clearDebugLogs();
        elements.codexAuthError.textContent = 'Codex logs cleared.';
    } catch (error) {
        elements.codexAuthError.textContent = `Failed to clear logs: ${error.message}`;
    }
}

async function handleClaudeManualConnect() {
    const sessionKey = elements.sessionKeyInput.value.trim();
    if (!sessionKey) {
        elements.sessionKeyError.textContent = 'Please paste your Claude session key';
        return;
    }

    elements.connectBtn.disabled = true;
    elements.connectBtn.textContent = '...';
    elements.sessionKeyError.textContent = '';

    try {
        const result = await window.electronAPI.validateProviderAuth('claude', { sessionKey });
        if (!result.success) {
            elements.sessionKeyError.textContent = result.error || 'Invalid session key';
            return;
        }

        claudeCredentials = { sessionKey, organizationId: result.organizationId };
        await window.electronAPI.saveProviderCredentials('claude', claudeCredentials);

        elements.sessionKeyInput.value = '';
        showMainContent();
        refreshProviderStatus();
        await fetchAllUsageData();
        startAutoUpdate();
    } catch (error) {
        elements.sessionKeyError.textContent = 'Connection failed. Check your key.';
    } finally {
        elements.connectBtn.disabled = false;
        elements.connectBtn.textContent = 'Connect';
    }
}

async function handleClaudeAutoDetect() {
    elements.autoDetectBtn.disabled = true;
    elements.autoDetectBtn.textContent = 'Waiting...';
    elements.autoDetectError.textContent = '';

    try {
        const result = await window.electronAPI.detectProviderAuth('claude');
        if (!result.success) {
            elements.autoDetectError.textContent = result.error || 'Login failed';
            return;
        }

        const validation = await window.electronAPI.validateProviderAuth('claude', {
            sessionKey: result.sessionKey
        });

        if (!validation.success) {
            elements.autoDetectError.textContent = validation.error || 'Session invalid';
            return;
        }

        claudeCredentials = {
            sessionKey: result.sessionKey,
            organizationId: validation.organizationId
        };

        await window.electronAPI.saveProviderCredentials('claude', claudeCredentials);
        showMainContent();
        refreshProviderStatus();
        await fetchAllUsageData();
        startAutoUpdate();
    } catch (error) {
        elements.autoDetectError.textContent = error.message || 'Login failed';
    } finally {
        elements.autoDetectBtn.disabled = false;
        elements.autoDetectBtn.textContent = 'Log in';
    }
}

async function handleCodexAutoDetect() {
    elements.codexAutoDetectBtn.disabled = true;
    elements.codexAutoDetectBtn.textContent = 'Waiting...';
    elements.codexAuthError.textContent = '';

    try {
        const detected = await window.electronAPI.detectProviderAuth('codex');
        if (!detected.success) {
            elements.codexAuthError.textContent = detected.error || 'Codex login failed';
            return;
        }

        const validation = await window.electronAPI.validateProviderAuth('codex', {
            cookieName: detected.cookieName,
            cookieValue: detected.cookieValue
        });

        if (!validation.success) {
            elements.codexAuthError.textContent = validation.error || 'Codex cookie validation failed';
            return;
        }
        if (validation.warning) {
            elements.codexAuthError.textContent = validation.warning;
        }

        codexCredentials = {
            cookieName: detected.cookieName,
            cookieValue: detected.cookieValue
        };
        await window.electronAPI.saveProviderCredentials('codex', codexCredentials);

        elements.codexCookieNameInput.value = detected.cookieName;
        elements.codexCookieValueInput.value = '';

        refreshProviderStatus();
        showMainContent();
        await fetchAllUsageData();
        startAutoUpdate();
    } catch (error) {
        elements.codexAuthError.textContent = error.message || 'Codex login failed';
    } finally {
        elements.codexAutoDetectBtn.disabled = false;
        elements.codexAutoDetectBtn.textContent = 'Auto Connect (Non-Google)';
    }
}

async function handleCodexManualConnect() {
    const cookieName = elements.codexCookieNameInput.value.trim();
    const cookieValue = elements.codexCookieValueInput.value.trim();
    const cookieHeader = elements.codexCookieHeaderInput.value.trim();
    const bearerToken = elements.codexBearerTokenInput.value.trim();

    const hasSingleCookie = Boolean(cookieName && cookieValue);
    const hasCookieHeader = Boolean(cookieHeader);
    const hasBearer = Boolean(bearerToken);

    if (!hasSingleCookie && !hasCookieHeader && !hasBearer) {
        elements.codexAuthError.textContent = 'Provide bearer token, cookie header, or cookie name/value';
        return;
    }

    elements.codexManualConnectBtn.disabled = true;
    elements.codexManualConnectBtn.textContent = '...';
    elements.codexAuthError.textContent = '';

    try {
        const validation = await window.electronAPI.validateProviderAuth('codex', {
            cookieName,
            cookieValue,
            cookieHeader,
            bearerToken
        });

        if (!validation.success) {
            elements.codexAuthError.textContent = validation.error || 'Invalid Codex cookie';
            return;
        }
        if (validation.warning) {
            elements.codexAuthError.textContent = validation.warning;
        }

        codexCredentials = { cookieName, cookieValue, cookieHeader, bearerToken };
        await window.electronAPI.saveProviderCredentials('codex', codexCredentials);

        elements.codexCookieValueInput.value = '';
        refreshProviderStatus();
        showMainContent();
        await fetchAllUsageData();
        startAutoUpdate();
    } catch (error) {
        elements.codexAuthError.textContent = error.message || 'Codex connection failed';
    } finally {
        elements.codexManualConnectBtn.disabled = false;
        elements.codexManualConnectBtn.textContent = 'Manual Connect';
    }
}

async function disconnectClaude() {
    await window.electronAPI.deleteProviderCredentials('claude');
    claudeCredentials = { sessionKey: null, organizationId: null };
    latestClaudeUsageData = null;

    refreshProviderStatus();
    updateUI();

    if (!hasAnyProviderConnected()) {
        await closeSettings();
        showLoginRequired();
    }
}

async function disconnectCodex() {
    await window.electronAPI.deleteProviderCredentials('codex');
    codexCredentials = { cookieName: null, cookieValue: null, cookieHeader: null, bearerToken: null };
    latestCodexUsageData = null;
    elements.codexAuthError.textContent = '';

    refreshProviderStatus();
    updateUI();

    if (!hasAnyProviderConnected()) {
        await closeSettings();
        showLoginRequired();
    }
}
async function fetchAllUsageData() {
    if (!hasAnyProviderConnected()) {
        showLoginRequired();
        return;
    }

    try {
        const response = await window.electronAPI.fetchAllUsage();

        if (response.claude?.error) {
            debugLog('Claude fetch error:', response.claude.error);
            if (response.claude.error.includes('SessionExpired')) {
                claudeCredentials = { sessionKey: null, organizationId: null };
                latestClaudeUsageData = null;
            }
        } else {
            latestClaudeUsageData = response.claude?.data || null;
        }

        if (response.codex?.error) {
            debugLog('Codex fetch error:', response.codex.error);
            if (response.codex.error.includes('SessionExpired')) {
                codexCredentials = { cookieName: null, cookieValue: null };
                latestCodexUsageData = null;
            } else {
                elements.codexAuthError.textContent = `Codex: ${response.codex.error}`;
            }
        } else {
            latestCodexUsageData = response.codex?.data || null;
            if (elements.codexAuthError.textContent.startsWith('Codex:')) {
                elements.codexAuthError.textContent = '';
            }
            const hasWindows = Boolean(
                latestCodexUsageData?.five_hour || latestCodexUsageData?.seven_day
            );
            if (hasCodexConnected() && !hasWindows && !elements.codexAuthError.textContent) {
                const seen = latestCodexUsageData?.codex_meta?.windows_seen;
                const seenText = typeof seen === 'number' ? ` (windows detected: ${seen})` : '';
                elements.codexAuthError.textContent = `Connected, but usage windows are unavailable right now${seenText}.`;
            }
        }

        refreshProviderStatus();
        updateUI();
    } catch (error) {
        console.error('Failed to fetch usage data:', error);
    }
}

function refreshProviderStatus() {
    elements.claudeStatus.textContent = hasClaudeConnected() ? 'Connected' : 'Disconnected';
    elements.codexStatus.textContent = hasCodexConnected() ? 'Connected' : 'Disconnected';
    elements.codexHint.style.display = hasCodexConnected() ? 'none' : 'block';
}

function updateUI() {
    if (!hasAnyProviderConnected()) {
        showLoginRequired();
        return;
    }

    showMainContent();
    updateClaudeUsageUI();
    updateCodexUsageUI();

    if (isExpanded) refreshExtraTimers();
    resizeWidget();
    startCountdown();
}

function updateClaudeUsageUI() {
    const data = latestClaudeUsageData;

    if (!hasClaudeConnected() || !data) {
        setUnavailableMetric(
            elements.claudeSessionProgress,
            elements.claudeSessionPercentage,
            elements.claudeSessionTimeText,
            elements.claudeSessionTimer,
            'Connect Claude'
        );
        setUnavailableMetric(
            elements.claudeWeeklyProgress,
            elements.claudeWeeklyPercentage,
            elements.claudeWeeklyTimeText,
            elements.claudeWeeklyTimer,
            'Connect Claude'
        );
        elements.expandToggle.style.display = 'none';
        elements.expandSection.style.display = 'none';
        elements.extraRows.innerHTML = '';
        return;
    }

    const sessionUtilization = data.five_hour?.utilization || 0;
    const sessionResetsAt = data.five_hour?.resets_at;
    const weeklyUtilization = data.seven_day?.utilization || 0;
    const weeklyResetsAt = data.seven_day?.resets_at;

    updateProgressBar(elements.claudeSessionProgress, elements.claudeSessionPercentage, sessionUtilization);
    updateProgressBar(elements.claudeWeeklyProgress, elements.claudeWeeklyPercentage, weeklyUtilization);

    updateTimer(elements.claudeSessionTimer, elements.claudeSessionTimeText, sessionResetsAt, 5 * 60);
    updateTimer(elements.claudeWeeklyTimer, elements.claudeWeeklyTimeText, weeklyResetsAt, 7 * 24 * 60);

    buildExtraRows(data);
}

function updateCodexUsageUI() {
    const data = latestCodexUsageData;

    if (!hasCodexConnected()) {
        setUnavailableMetric(
            elements.codexSessionProgress,
            elements.codexSessionPercentage,
            elements.codexSessionTimeText,
            elements.codexSessionTimer,
            'Connect Codex'
        );
        setUnavailableMetric(
            elements.codexWeeklyProgress,
            elements.codexWeeklyPercentage,
            elements.codexWeeklyTimeText,
            elements.codexWeeklyTimer,
            'Connect Codex'
        );
        return;
    }

    const sessionData = data?.five_hour;
    const weeklyData = data?.seven_day;

    if (sessionData) {
        updateProgressBar(elements.codexSessionProgress, elements.codexSessionPercentage, sessionData.utilization);
        updateTimer(
            elements.codexSessionTimer,
            elements.codexSessionTimeText,
            sessionData.resets_at,
            sessionData.total_window_minutes || 5 * 60
        );
    } else {
        setUnavailableMetric(
            elements.codexSessionProgress,
            elements.codexSessionPercentage,
            elements.codexSessionTimeText,
            elements.codexSessionTimer,
            'Unavailable'
        );
    }

    if (weeklyData) {
        updateProgressBar(elements.codexWeeklyProgress, elements.codexWeeklyPercentage, weeklyData.utilization);
        updateTimer(
            elements.codexWeeklyTimer,
            elements.codexWeeklyTimeText,
            weeklyData.resets_at,
            weeklyData.total_window_minutes || 7 * 24 * 60
        );
    } else {
        setUnavailableMetric(
            elements.codexWeeklyProgress,
            elements.codexWeeklyPercentage,
            elements.codexWeeklyTimeText,
            elements.codexWeeklyTimer,
            'Unavailable'
        );
    }
}

function setUnavailableMetric(progressElement, percentageElement, textElement, timerElement, label = 'Unavailable') {
    progressElement.style.width = '0%';
    progressElement.classList.remove('warning', 'danger');
    percentageElement.textContent = '--';
    textElement.textContent = label;
    textElement.style.opacity = '0.7';
    timerElement.style.strokeDashoffset = 63;
    timerElement.classList.remove('warning', 'danger');
}

function buildExtraRows(data) {
    elements.extraRows.innerHTML = '';
    let count = 0;

    for (const [key, config] of Object.entries(EXTRA_ROW_CONFIG)) {
        const value = data[key];
        const hasUtilization = value && value.utilization !== undefined;
        const hasBalance = key === 'extra_usage' && value && value.balance_cents != null;
        if (!hasUtilization && !hasBalance) continue;

        const utilization = value.utilization || 0;
        const resetsAt = value.resets_at;
        const colorClass = config.color;

        let percentageHTML;
        let timerHTML;

        if (key === 'extra_usage') {
            if (value.used_cents != null && value.limit_cents != null) {
                const usedDollars = (value.used_cents / 100).toFixed(0);
                const limitDollars = (value.limit_cents / 100).toFixed(0);
                percentageHTML = `<span class="usage-percentage extra-spending">$${usedDollars}/$${limitDollars}</span>`;
            } else {
                percentageHTML = `<span class="usage-percentage">${Math.round(utilization)}%</span>`;
            }

            if (value.balance_cents != null) {
                const balanceDollars = (value.balance_cents / 100).toFixed(0);
                timerHTML = `<div class="timer-container"><span class="timer-text extra-balance">Bal $${balanceDollars}</span></div>`;
            } else {
                timerHTML = '<div class="timer-container"></div>';
            }
        } else {
            percentageHTML = `<span class="usage-percentage">${Math.round(utilization)}%</span>`;
            const totalMinutes = key.includes('seven_day') ? 7 * 24 * 60 : 5 * 60;
            timerHTML = `
                <div class="timer-container">
                    <div class="timer-text" data-resets="${resetsAt || ''}" data-total="${totalMinutes}">--:--</div>
                    <svg class="mini-timer" width="24" height="24" viewBox="0 0 24 24">
                        <circle class="timer-bg" cx="12" cy="12" r="10" />
                        <circle class="timer-progress ${colorClass}" cx="12" cy="12" r="10" style="stroke-dasharray: 63; stroke-dashoffset: 63" />
                    </svg>
                </div>
            `;
        }

        const row = document.createElement('div');
        row.className = 'usage-section';
        row.innerHTML = `
            <span class="usage-label">${config.label}</span>
            <div class="progress-bar">
                <div class="progress-fill ${colorClass}" style="width: ${Math.min(utilization, 100)}%"></div>
            </div>
            ${percentageHTML}
            ${timerHTML}
        `;

        const progressEl = row.querySelector('.progress-fill');
        if (utilization >= 90) progressEl.classList.add('danger');
        else if (utilization >= 75) progressEl.classList.add('warning');

        elements.extraRows.appendChild(row);
        count++;
    }

    elements.expandToggle.style.display = count > 0 ? 'flex' : 'none';
    if (count === 0 && isExpanded) {
        isExpanded = false;
        elements.expandArrow.classList.remove('expanded');
        elements.expandSection.style.display = 'none';
    }
}
function refreshExtraTimers() {
    const timerTexts = elements.extraRows.querySelectorAll('.timer-text');
    const timerCircles = elements.extraRows.querySelectorAll('.timer-progress');

    timerTexts.forEach((textEl, i) => {
        const resetsAt = textEl.dataset.resets;
        const totalMinutes = parseInt(textEl.dataset.total, 10);
        const circleEl = timerCircles[i];
        if (resetsAt && circleEl) {
            updateTimer(circleEl, textEl, resetsAt, totalMinutes);
        }
    });
}

function refreshTimers() {
    if (latestClaudeUsageData && hasClaudeConnected()) {
        updateTimer(
            elements.claudeSessionTimer,
            elements.claudeSessionTimeText,
            latestClaudeUsageData.five_hour?.resets_at,
            5 * 60
        );
        updateTimer(
            elements.claudeWeeklyTimer,
            elements.claudeWeeklyTimeText,
            latestClaudeUsageData.seven_day?.resets_at,
            7 * 24 * 60
        );
    }

    if (latestCodexUsageData && hasCodexConnected()) {
        updateTimer(
            elements.codexSessionTimer,
            elements.codexSessionTimeText,
            latestCodexUsageData.five_hour?.resets_at,
            latestCodexUsageData.five_hour?.total_window_minutes || 5 * 60
        );
        updateTimer(
            elements.codexWeeklyTimer,
            elements.codexWeeklyTimeText,
            latestCodexUsageData.seven_day?.resets_at,
            latestCodexUsageData.seven_day?.total_window_minutes || 7 * 24 * 60
        );
    }

    if (isExpanded) refreshExtraTimers();
}

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(refreshTimers, 1000);
}

function updateProgressBar(progressElement, percentageElement, value) {
    const percentage = Math.min(Math.max(value || 0, 0), 100);
    progressElement.style.width = `${percentage}%`;
    percentageElement.textContent = `${Math.round(percentage)}%`;

    progressElement.classList.remove('warning', 'danger');
    if (percentage >= 90) {
        progressElement.classList.add('danger');
    } else if (percentage >= 75) {
        progressElement.classList.add('warning');
    }
}

function updateTimer(timerElement, textElement, resetsAt, totalMinutes) {
    if (!resetsAt) {
        textElement.textContent = '--:--';
        textElement.style.opacity = '0.7';
        timerElement.style.strokeDashoffset = 63;
        return;
    }

    textElement.style.opacity = '1';

    const resetDate = new Date(resetsAt);
    const now = new Date();
    const diff = resetDate - now;

    if (diff <= 0) {
        textElement.textContent = 'Resetting...';
        timerElement.style.strokeDashoffset = 0;
        return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        textElement.textContent = `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
        textElement.textContent = `${hours}h ${minutes}m`;
    } else {
        textElement.textContent = `${minutes}m`;
    }

    const totalMs = (totalMinutes || 1) * 60 * 1000;
    const elapsedMs = totalMs - diff;
    const elapsedPercentage = Math.min(Math.max((elapsedMs / totalMs) * 100, 0), 100);

    const circumference = 63;
    const offset = circumference - (elapsedPercentage / 100) * circumference;
    timerElement.style.strokeDashoffset = offset;

    timerElement.classList.remove('warning', 'danger');
    if (elapsedPercentage >= 90) {
        timerElement.classList.add('danger');
    } else if (elapsedPercentage >= 75) {
        timerElement.classList.add('warning');
    }
}

function resizeWidget() {
    const extraCount = elements.extraRows.children.length;
    const expandedExtra = isExpanded ? 12 + (extraCount * WIDGET_ROW_HEIGHT) : 0;
    const targetHeight = WIDGET_HEIGHT_COLLAPSED + expandedExtra;
    window.electronAPI.resizeWindow(targetHeight);
}

function showLoginRequired() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'flex';
    elements.noUsageContainer.style.display = 'none';
    elements.mainContent.style.display = 'none';

    elements.loginStep1.style.display = 'flex';
    elements.loginStep2.style.display = 'none';
    elements.sessionKeyError.textContent = '';
    elements.sessionKeyInput.value = '';

    stopAutoUpdate();
}

function showMainContent() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'none';
    elements.noUsageContainer.style.display = 'none';
    elements.mainContent.style.display = 'block';
}

function startAutoUpdate() {
    stopAutoUpdate();
    startUpdateTimerCountdown();

    updateInterval = setInterval(async () => {
        await fetchAllUsageData();
        startUpdateTimerCountdown();
    }, refreshIntervalMs);
}

function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    stopUpdateTimerCountdown();
}

const style = document.createElement('style');
style.textContent = `
    @keyframes spin-refresh {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .refresh-btn.spinning svg {
        animation: spin-refresh 1s linear;
    }
`;
document.head.appendChild(style);

init();

window.addEventListener('beforeunload', () => {
    stopAutoUpdate();
    if (countdownInterval) clearInterval(countdownInterval);
});
