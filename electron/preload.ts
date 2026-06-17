import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  scanFolder: (folderPath: string) => ipcRenderer.invoke("folder:scan", folderPath),
  readFile: (filePath: string) => ipcRenderer.invoke("folder:readFile", filePath),
  openFolderInExplorer: (folderPath: string) => ipcRenderer.invoke("folder:openInExplorer", folderPath),
  openFileByRelativePath: (relativePath: string) =>
    ipcRenderer.invoke("file:openByRelativePath", relativePath),
});
