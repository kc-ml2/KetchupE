const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Dialog APIs
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // Folder scanning APIs
  scanFolder: (folderPath) => ipcRenderer.invoke('folder:scan', folderPath),

  // File reading APIs
  readFile: (filePath) => ipcRenderer.invoke('folder:readFile', filePath),

  // Folder opening APIs
  openFolderInExplorer: (folderPath) => ipcRenderer.invoke('folder:openInExplorer', folderPath),

  // File open by relative path
  openFileByRelativePath: (relativePath) => ipcRenderer.invoke('file:openByRelativePath', relativePath),

  // WebSocket sync APIs
  setWebSocketUrl: (url) => ipcRenderer.invoke('sync:setWebSocketUrl', url),
  setAccessToken: (token) => ipcRenderer.invoke('sync:setAccessToken', token),
  toggleSync: () => ipcRenderer.invoke('sync:toggle'),
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),

  // Listen to sync status changes
  onSyncStatus: (callback) => {
    ipcRenderer.on('sync-status', (event, data) => callback(data));
  },
  onWebSocketStatus: (callback) => {
    ipcRenderer.on('websocket-status', (event, data) => callback(data));
  },
  onWebSocketMessage: (callback) => {
    ipcRenderer.on('websocket-message', (event, data) => callback(data));
  },
  onSyncError: (callback) => {
    ipcRenderer.on('sync-error', (event, data) => callback(data));
  },

  // LanceDB APIs
  addDocument: (data) => ipcRenderer.invoke('lancedb:addDocument', data),
  searchDocuments: (query, limit) => ipcRenderer.invoke('lancedb:search', query, limit),
  getLanceDBStats: () => ipcRenderer.invoke('lancedb:getStats'),
});
