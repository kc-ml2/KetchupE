import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import {
  setWebSocketUrl,
  setWebSocketToken,
  setSyncEnabled,
  isSyncEnabled,
  getWebSocketStatus,
  connectWebSocket,
  disconnectWebSocket
} from '../websocket/handler';
import { addDocument, searchDocuments, getStats } from '../lancedb/operations';
import { DocumentData } from '../lancedb/types';

interface FileMetadata {
  fileName: string;
  createdAt: string;
  relativePath: string;
  size: number;
  fullPath?: string;
}

function notifyRenderer<T>(mainWindow: BrowserWindow | null, channel: string, data: T) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

export function registerIPCHandlers(getMainWindow: () => BrowserWindow | null, getTrayUpdateFn: () => void) {
  // WebSocket sync handlers
  ipcMain.handle('sync:setWebSocketUrl', async (event, url: string) => {
    console.log('🔧 [Sync] Setting WebSocket URL:', url);
    setWebSocketUrl(url);
    return { success: true };
  });

  ipcMain.handle('sync:setAccessToken', async (event, token: string) => {
    console.log('🔧 [Sync] Setting access token');
    setWebSocketToken(token);
    return { success: true };
  });

  ipcMain.handle('sync:toggle', async () => {
    const mainWindow = getMainWindow();
    const currentStatus = getWebSocketStatus();

    if (!isSyncEnabled() && (!currentStatus.wsUrl || !currentStatus.wsUrl)) {
      console.log('⚠️ [Sync] Cannot enable sync: No WebSocket URL or token configured');
      notifyRenderer(mainWindow, 'sync-error', {
        message: 'WebSocket URL 또는 토큰이 설정되지 않았습니다. 먼저 로그인해주세요.'
      });
      return { success: false, enabled: false };
    }

    const newSyncEnabled = !isSyncEnabled();
    setSyncEnabled(newSyncEnabled);
    console.log(`🔄 [Sync] Sync ${newSyncEnabled ? 'enabled' : 'disabled'}`);

    if (newSyncEnabled) {
      connectWebSocket(mainWindow);
    } else {
      disconnectWebSocket(mainWindow);
    }

    getTrayUpdateFn();
    notifyRenderer(mainWindow, 'sync-status', { enabled: newSyncEnabled });

    return { success: true, enabled: newSyncEnabled };
  });

  ipcMain.handle('sync:getStatus', async () => {
    return getWebSocketStatus();
  });

  // LanceDB handlers
  ipcMain.handle('lancedb:addDocument', async (event, data: DocumentData) => {
    return await addDocument(data);
  });

  ipcMain.handle('lancedb:search', async (event, query: number[], limit: number = 5) => {
    return await searchDocuments(query, limit);
  });

  ipcMain.handle('lancedb:getStats', async () => {
    return await getStats();
  });

  // Folder sync handlers
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      console.log('📁 [Main Process] 사용자가 폴더 선택 취소');
      return null;
    }

    console.log('📁 [Main Process] 선택된 폴더:', result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('folder:scan', async (event, folderPath: string) => {
    try {
      console.log('📂 [Main Process] 폴더 스캔 시작:', folderPath);
      const files = await scanDirectory(folderPath);
      console.log('✅ [Main Process] 스캔 완료:', files.length, '개 파일');
      return { success: true, files };
    } catch (error) {
      console.error('❌ [Main Process] 스캔 실패:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('folder:readFile', async (event, filePath: string) => {
    try {
      const buffer = await fs.readFile(filePath);
      console.log('📖 [Main Process] 파일 읽기 성공:', filePath, `(${buffer.length} bytes)`);
      return { success: true, data: buffer };
    } catch (error) {
      console.error('❌ [Main Process] 파일 읽기 실패:', filePath, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('folder:openInExplorer', async (event, pathToOpen: string) => {
    try {
      console.log('📂 [Main Process] 경로 열기:', pathToOpen);

      try {
        const stats = await fs.stat(pathToOpen);
        const isDirectory = stats.isDirectory();
        const isFile = stats.isFile();
        console.log(`📝 [Main Process] 경로 타입: ${isDirectory ? '폴더' : isFile ? '파일' : '기타'}`);

        if (!isDirectory && !isFile) {
          throw new Error('Path is not a file or directory');
        }
      } catch {
        console.error('❌ [Main Process] 경로가 존재하지 않음:', pathToOpen);
        return { success: false, error: 'Path does not exist' };
      }

      const result = await shell.openPath(pathToOpen);
      if (result) {
        console.error('❌ [Main Process] 경로 열기 실패:', result);
        return { success: false, error: result };
      }

      console.log('✅ [Main Process] 경로 열기 성공');
      return { success: true };
    } catch (error) {
      console.error('❌ [Main Process] 경로 열기 실패:', pathToOpen, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}

async function scanDirectory(dirPath: string, baseDir: string = dirPath): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];

  const ignorePatterns = [
    /^\.DS_Store$/,
    /^Thumbs\.db$/,
    /^desktop\.ini$/,
    /^\._/,
    /^\.git/,
    /^node_modules/,
    /^__pycache__/,
    /\.pyc$/,
    /^\.vscode/,
    /^\.idea/,
  ];

  const shouldIgnore = (fileName: string): boolean => {
    return ignorePatterns.some(pattern => pattern.test(fileName));
  };

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await scanDirectory(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const stats = await fs.stat(fullPath);
      const relativePath = path.relative(baseDir, fullPath);

      files.push({
        fileName: entry.name,
        createdAt: stats.birthtime.toISOString(),
        relativePath: relativePath.replace(/\\/g, '/'),
        fullPath,
        size: stats.size,
      });
    }
  }

  return files;
}
