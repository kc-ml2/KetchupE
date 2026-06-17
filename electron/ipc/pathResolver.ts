import path from "path";

function trimWindowsRootPrefix(inputPath: string): string {
  return inputPath.replace(/^[\\/]+/, "");
}

function isMacVolumeRoot(rootPath: string): boolean {
  const normalizedRoot = path.posix.normalize(rootPath);
  return normalizedRoot.startsWith("/Volumes/");
}

function joinPathForPlatform(
  rootPath: string,
  relativePath: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") {
    return path.win32.normalize(
      path.win32.join(rootPath, trimWindowsRootPrefix(relativePath)),
    );
  }

  return path.posix.normalize(path.posix.join(rootPath, relativePath));
}

export function normalizeInputPath(
  inputPath: string,
  platform: NodeJS.Platform,
): string {
  let value = inputPath.trim();

  if (platform === "darwin") {
    value = value.normalize("NFD");
  }

  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(url.pathname);
      if (platform === "win32" && /^\/[A-Za-z]:/.test(value)) {
        value = value.slice(1);
      }
    } catch {
      // Keep original value when URL parsing fails.
    }
  }

  if (platform === "win32") {
    return path.win32.normalize(value.replace(/\//g, "\\"));
  }

  return path.posix.normalize(value.replace(/\\/g, "/"));
}

export function isWindowsAbsolutePath(inputPath: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(inputPath) ||
    /^\\\\[^\\]+\\[^\\]+/.test(inputPath)
  );
}

function isAbsolutePathForPlatform(
  inputPath: string,
  platform: NodeJS.Platform,
): boolean {
  if (platform === "win32") {
    return isWindowsAbsolutePath(inputPath);
  }

  return path.posix.isAbsolute(inputPath);
}

function getWindowsSearchPath(inputPath: string): string | null {
  if (inputPath.startsWith("\\\\")) {
    const parts = inputPath.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return null;
    return parts.slice(2).join("\\");
  }

  const drivePathMatch = /^[A-Za-z]:[\\/]?(.*)$/.exec(inputPath);
  if (drivePathMatch) {
    return drivePathMatch[1] ? trimWindowsRootPrefix(drivePathMatch[1]) : null;
  }

  return trimWindowsRootPrefix(inputPath);
}

function getMacVolumeSearchPath(inputPath: string): string | null {
  const parts = path.posix.normalize(inputPath).split("/").filter(Boolean);
  if (parts[0] !== "Volumes" || parts.length <= 2) return null;
  return parts.slice(2).join("/");
}

function splitPathSegments(
  inputPath: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform === "win32") {
    return inputPath.split(/[\\/]+/).filter(Boolean);
  }

  return path.posix.normalize(inputPath).split("/").filter(Boolean);
}

export function shouldSearchNestedByLeafName(
  inputPath: string,
  platform: NodeJS.Platform,
): boolean {
  const normalizedInput = normalizeInputPath(inputPath, platform);
  const searchPath =
    platform === "win32"
      ? getWindowsSearchPath(normalizedInput)
      : platform === "darwin"
        ? getMacVolumeSearchPath(normalizedInput) ?? normalizedInput
        : normalizedInput;

  if (!searchPath) return false;

  const segments = splitPathSegments(searchPath, platform);
  const leafName = segments.at(-1);

  return segments.length >= 2 && Boolean(leafName) && leafName !== ".";
}

export function createOpenPathCandidates(
  inputPath: string,
  platform: NodeJS.Platform,
  roots: string[],
): string[] {
  const normalizedInput = normalizeInputPath(inputPath, platform);
  const isAbsolute = isAbsolutePathForPlatform(normalizedInput, platform);
  const candidatePaths = new Set<string>();

  if (isAbsolute) {
    candidatePaths.add(normalizedInput);
  }

  if (platform === "win32") {
    const searchPath = getWindowsSearchPath(normalizedInput);
    if (searchPath) {
      roots.forEach((root) => {
        candidatePaths.add(joinPathForPlatform(root, searchPath, platform));
      });
    }
    return Array.from(candidatePaths);
  }

  if (platform === "darwin") {
    const volumeSearchPath = getMacVolumeSearchPath(normalizedInput);
    if (volumeSearchPath) {
      roots.filter(isMacVolumeRoot).forEach((root) => {
        candidatePaths.add(
          joinPathForPlatform(root, volumeSearchPath, platform),
        );
      });
    } else if (!isAbsolute) {
      roots.forEach((root) => {
        candidatePaths.add(joinPathForPlatform(root, normalizedInput, platform));
      });
    }
    return Array.from(candidatePaths);
  }

  if (!isAbsolute) {
    roots.forEach((root) => {
      candidatePaths.add(joinPathForPlatform(root, normalizedInput, platform));
    });
  }

  return Array.from(candidatePaths);
}
