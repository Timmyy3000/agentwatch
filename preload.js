const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Credentials management
  getCredentials: () => ipcRenderer.invoke('get-credentials'),
  saveCredentials: (credentials) => ipcRenderer.invoke('save-credentials', credentials),
  deleteCredentials: () => ipcRenderer.invoke('delete-credentials'),
  validateSessionKey: (sessionKey) => ipcRenderer.invoke('validate-session-key', sessionKey),
  detectSessionKey: () => ipcRenderer.invoke('detect-session-key'),

  // Provider-aware credentials/auth
  getProviderCredentials: (provider) => ipcRenderer.invoke('get-provider-credentials', provider),
  saveProviderCredentials: (provider, payload) => ipcRenderer.invoke('save-provider-credentials', provider, payload),
  deleteProviderCredentials: (provider) => ipcRenderer.invoke('delete-provider-credentials', provider),
  validateProviderAuth: (provider, payload) => ipcRenderer.invoke('validate-provider-auth', provider, payload),
  detectProviderAuth: (provider) => ipcRenderer.invoke('detect-provider-auth', provider),
  getProviderStatuses: () => ipcRenderer.invoke('get-provider-statuses'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  resizeWindow: (height) => ipcRenderer.send('resize-window', height),

  // Window position
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (position) => ipcRenderer.invoke('set-window-position', position),

  // Event listeners
  onRefreshUsage: (callback) => {
    ipcRenderer.on('refresh-usage', () => callback());
  },
  onSessionExpired: (callback) => {
    ipcRenderer.on('session-expired', () => callback());
  },
  onProviderSessionExpired: (callback) => {
    ipcRenderer.on('provider-session-expired', (event, provider) => callback(provider));
  },

  // API
  fetchUsageData: () => ipcRenderer.invoke('fetch-usage-data'),
  fetchProviderUsage: (provider) => ipcRenderer.invoke('fetch-provider-usage', provider),
  fetchAllUsage: () => ipcRenderer.invoke('fetch-all-usage'),
  getDebugLogs: () => ipcRenderer.invoke('get-debug-logs'),
  clearDebugLogs: () => ipcRenderer.invoke('clear-debug-logs'),
  getDebugLogPath: () => ipcRenderer.invoke('get-debug-log-path'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Compact mode
  getCompactMode: () => ipcRenderer.invoke('get-compact-mode'),
  setCompactMode: (isCompact) => ipcRenderer.invoke('set-compact-mode', isCompact),
  expandForSettings: (expand) => ipcRenderer.invoke('expand-for-settings', expand),

  // Refresh interval and update timer settings
  getRefreshInterval: () => ipcRenderer.invoke('get-refresh-interval'),
  setRefreshInterval: (interval) => ipcRenderer.invoke('set-refresh-interval', interval),
  getShowUpdateTimer: () => ipcRenderer.invoke('get-show-update-timer'),
  setShowUpdateTimer: (show) => ipcRenderer.invoke('set-show-update-timer', show)
});
