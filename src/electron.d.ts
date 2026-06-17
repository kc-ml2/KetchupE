export interface ScannedFile {
  fileName: string;
  createdAt: string;
  relativePath: string;
  fullPath?: string;
  size: number;
  mtime: number;
}

export interface ElectronAPI {
  openDirectory: () => Promise<string | null>;
  scanFolder: (folderPath: string) => Promise<{
    success: boolean;
    files?: ScannedFile[];
    error?: string;
  }>;
  readFile: (filePath: string) => Promise<{
    success: boolean;
    data?: ArrayBuffer;
    error?: string;
  }>;
  openFolderInExplorer: (folderPath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  openFileByRelativePath: (relativePath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
