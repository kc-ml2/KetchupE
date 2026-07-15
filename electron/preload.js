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

  // File open by relative path
  openFileByRelativePath: (relativePath) => ipcRenderer.invoke('file:openByRelativePath', relativePath),
});
