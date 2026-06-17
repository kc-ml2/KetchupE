import { ipcMain, dialog, shell, app } from "electron";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  createOpenPathCandidates,
  shouldSearchNestedByLeafName,
} from "./pathResolver";

interface FileMetadata {
  fileName: string;
  createdAt: string;
  relativePath: string;
  fullPath: string;
  size: number;
  mtime: number;
}

const OPEN_PATH_ROOTS_FILE_NAME = "open-path-roots.json";
const MAX_STORED_OPEN_PATH_ROOTS = 100;
const MAX_NESTED_SEARCH_ENTRIES = 3000;

const IGNORE_PATTERNS = [
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

function shouldIgnore(fileName: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function normalizeStoredRoot(rootPath: string): string {
  const normalizedPath = path.normalize(rootPath);
  return os.platform() === "darwin"
    ? normalizedPath.normalize("NFD")
    : normalizedPath;
}

function getOpenPathRootsFilePath(): string {
  return path.join(app.getPath("userData"), OPEN_PATH_ROOTS_FILE_NAME);
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

async function readRememberedOpenPathRoots(): Promise<string[]> {
  try {
    const filePath = getOpenPathRootsFilePath();
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (root): root is string => typeof root === "string" && root.length > 0,
    );
  } catch {
    return [];
  }
}

async function rememberOpenPathRoot(folderPath: string): Promise<void> {
  try {
    const filePath = getOpenPathRootsFilePath();
    const existingRoots = await readRememberedOpenPathRoots();
    const nextRoots = dedupePaths([
      normalizeStoredRoot(folderPath),
      normalizeStoredRoot(path.dirname(folderPath)),
      ...existingRoots,
    ]).slice(0, MAX_STORED_OPEN_PATH_ROOTS);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(nextRoots, null, 2), "utf-8");
  } catch (error) {
    console.warn("[file:open] failed to remember folder root:", error);
  }
}

async function scanDirectory(
  dirPath: string,
  baseDir: string = dirPath,
): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await scanDirectory(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const stats = await fs.stat(fullPath);
      files.push({
        fileName: entry.name,
        createdAt: stats.birthtime.toISOString(),
        relativePath: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
        fullPath,
        size: stats.size,
        mtime: Math.floor(stats.mtimeMs / 1000),
      });
    }
  }

  return files;
}

async function getOpenPathRoots(platform: NodeJS.Platform): Promise<string[]> {
  const rememberedRoots = await readRememberedOpenPathRoots();

  if (platform === "win32") {
    const roots: string[] = [...rememberedRoots];
    for (let i = 65; i <= 90; i++) {
      roots.push(`${String.fromCharCode(i)}:\\`);
    }
    return dedupePaths(roots);
  }

  if (platform === "darwin") {
    const roots: string[] = [...rememberedRoots];
    try {
      const volumes = await fs.readdir("/Volumes");
      roots.push(...volumes.map((volume) => path.join("/Volumes", volume)));
    } catch {
      // Ignore /Volumes read failures and fall back to common user folders.
    }

    roots.push(
      path.join(os.homedir(), "Documents"),
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Downloads"),
      os.homedir(),
    );

    return dedupePaths(roots);
  }

  return dedupePaths([...rememberedRoots, os.homedir()]);
}

async function findNestedPathByLeafName(
  startDir: string,
  leafName: string,
): Promise<string | null> {
  const pendingDirs = [startDir];
  let visitedEntries = 0;

  while (pendingDirs.length > 0 && visitedEntries < MAX_NESTED_SEARCH_ENTRIES) {
    const currentDir = pendingDirs.shift();
    if (!currentDir) break;

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;
      visitedEntries += 1;

      const candidatePath = path.join(currentDir, entry.name);
      if (entry.name === leafName && (entry.isFile() || entry.isDirectory())) {
        return candidatePath;
      }

      if (entry.isDirectory()) {
        pendingDirs.push(candidatePath);
      }

      if (visitedEntries >= MAX_NESTED_SEARCH_ENTRIES) break;
    }
  }

  return null;
}

async function findNestedOpenPath(
  inputPath: string,
  platform: NodeJS.Platform,
  candidatePaths: string[],
): Promise<string | null> {
  if (!shouldSearchNestedByLeafName(inputPath, platform)) return null;

  const leafName = path.basename(inputPath.replace(/\\/g, path.sep));
  if (!leafName || leafName === ".") return null;

  const searchDirs = dedupePaths(
    candidatePaths.map((candidatePath) => path.dirname(candidatePath)),
  );

  for (const searchDir of searchDirs) {
    const nestedPath = await findNestedPathByLeafName(searchDir, leafName);
    if (nestedPath) return nestedPath;
  }

  return null;
}

export function registerFolderHandlers() {
  ipcMain.handle("dialog:openDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedFolderPath = result.filePaths[0];
    void rememberOpenPathRoot(selectedFolderPath);

    return selectedFolderPath;
  });

  ipcMain.handle("folder:scan", async (_event, folderPath: string) => {
    try {
      const files = await scanDirectory(folderPath);
      return { success: true, files };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("folder:readFile", async (_event, filePath: string) => {
    try {
      const buffer = await fs.readFile(filePath);
      return { success: true, data: buffer };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle(
    "file:openByRelativePath",
    async (_event, relativePath: string) => {
      try {
        const platform = os.platform();
        const roots = await getOpenPathRoots(platform);
        const candidatePaths = createOpenPathCandidates(
          relativePath,
          platform,
          roots,
        );

        for (const fullPath of candidatePaths) {
          try {
            const stats = await fs.stat(fullPath);
            if (!stats.isFile() && !stats.isDirectory()) continue;

            console.log(`[file:open] found: ${fullPath}`);
            const openResult = await shell.openPath(fullPath);
            if (openResult) {
              return { success: false, error: openResult };
            }
            return { success: true };
          } catch {
            // 다음 루트 시도
          }
        }

        const nestedPath = await findNestedOpenPath(
          relativePath,
          platform,
          candidatePaths,
        );
        if (nestedPath) {
          console.log(`[file:open] found nested: ${nestedPath}`);
          const openResult = await shell.openPath(nestedPath);
          if (openResult) {
            return { success: false, error: openResult };
          }
          return { success: true };
        }

        console.log(
          `[file:open] not found: "${relativePath}" (${candidatePaths.length} candidates)`,
        );
        return { success: false, error: "not found" };
      } catch (err) {
        console.error("[file:open] unexpected error:", err);
        return { success: false, error: "not found" };
      }
    },
  );

  ipcMain.handle("folder:openInExplorer", async (_event, pathToOpen: string) => {
    try {
      const stats = await fs.stat(pathToOpen);
      if (!stats.isDirectory() && !stats.isFile()) {
        return { success: false, error: "Path is not a file or directory" };
      }

      const result = await shell.openPath(pathToOpen);
      if (result) {
        return { success: false, error: result };
      }

      return { success: true };
    } catch {
      return { success: false, error: "Path does not exist" };
    }
  });
}
