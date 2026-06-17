import { useState, useContext, useCallback } from "react";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import {
  ServerConfigResponse,
  SyncCheckResponse,
  SyncUploadResponse,
  TeamFolder,
} from "@app-types/Team.types";
import type { ScannedFile } from "../../../electron.d";

// 파일명에서 소문자 확장자(마지막 점 이후)를 추출한다. 점이 없으면 빈 문자열.
const getFileExtension = (fileName: string): string => {
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex === -1 ? "" : fileName.slice(lastDotIndex).toLowerCase();
};

const joinScannedFilePath = (
  folderPath: string,
  relativePath: string,
): string => {
  const separator =
    folderPath.includes("\\") && !folderPath.includes("/") ? "\\" : "/";
  const basePath = folderPath.replace(/[\\/]+$/, "");
  const normalizedRelativePath = relativePath
    .split("/")
    .join(separator)
    .replace(/^[\\/]+/, "");

  return `${basePath}${separator}${normalizedRelativePath}`;
};

const getScannedFileFullPath = (
  folderPath: string,
  file: ScannedFile,
): string => file.fullPath || joinScannedFilePath(folderPath, file.relativePath);

type UploadStep =
  | "idle"
  | "scanning"
  | "checking"
  | "ready"
  | "uploading"
  | "done"
  | "error";

interface UploadProgress {
  current: number;
  total: number;
}

interface UploadState {
  step: UploadStep;
  folderPath: string | null;
  folderName: string | null;
  scannedFiles: ScannedFile[];
  // 서버가 지원하지 않는 포맷이라 업로드에서 제외된 파일 수
  skippedUnsupported: number;
  // 제외된 미지원 확장자 목록 (중복 제거, 예: [".png", ".zip"])
  skippedExtensions: string[];
  checkResult: SyncCheckResponse | null;
  progress: UploadProgress;
  errorMessage: string | null;
}

const INITIAL_STATE: UploadState = {
  step: "idle",
  folderPath: null,
  folderName: null,
  scannedFiles: [],
  skippedUnsupported: 0,
  skippedExtensions: [],
  checkResult: null,
  progress: { current: 0, total: 0 },
  errorMessage: null,
};

const SESSION_EXPIRED_MESSAGE = "세션이 만료되었습니다. 다시 로그인해주세요.";

export interface UseFolderUploadReturn {
  state: UploadState;
  selectFolder: () => Promise<void>;
  startUpload: () => Promise<TeamFolder | null>;
  reset: () => void;
}

export const useFolderUpload = (teamId: number): UseFolderUploadReturn => {
  const { fetchClient, getAccessToken } = useContext(
    AuthContext,
  ) as AuthContextType;
  const [state, setState] = useState<UploadState>(INITIAL_STATE);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const ensureToken = useCallback((): boolean => {
    if (!getAccessToken()) {
      setState((prev) => ({
        ...prev,
        step: "error",
        errorMessage: SESSION_EXPIRED_MESSAGE,
      }));
      return false;
    }
    return true;
  }, [getAccessToken]);

  const selectFolder = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      setState((prev) => ({
        ...prev,
        step: "error",
        errorMessage: "PC 앱에서만 가능한 기능입니다.",
      }));
      return;
    }

    // Step 1: Open directory dialog
    const folderPath = await electronAPI.openDirectory();
    if (!folderPath) return;

    // 다이얼로그가 열려 있는 동안 토큰이 만료될 수 있으므로
    // API 호출 전에 토큰 존재 여부를 확인
    if (!ensureToken()) return;

    const folderName = folderPath.split(/[/\\]/).pop() ?? folderPath;
    setState((prev) => ({ ...prev, step: "scanning", folderPath, folderName }));

    // Step 2: Scan folder
    const scanResult = await electronAPI.scanFolder(folderPath);
    if (!scanResult.success || !scanResult.files) {
      setState((prev) => ({
        ...prev,
        step: "error",
        errorMessage: scanResult.error ?? "폴더 스캔에 실패했습니다.",
      }));
      return;
    }

    const scannedFiles = scanResult.files;
    setState((prev) => ({ ...prev, step: "checking" }));

    // Step 3: 서버가 지원하는 파일 포맷을 조회해 미지원 파일은 업로드에서 제외
    let supportedFiles = scannedFiles;
    let skippedUnsupported = 0;
    let skippedExtensions: string[] = [];
    try {
      const serverConfig =
        await fetchClient.get<ServerConfigResponse>("/config");
      const supportedExtensions = new Set(
        serverConfig.supported_extensions.map((ext) => ext.toLowerCase()),
      );
      const skippedExtSet = new Set<string>();
      supportedFiles = scannedFiles.filter((file) => {
        const extension = getFileExtension(file.fileName);
        const isSupported = supportedExtensions.has(extension);
        if (!isSupported) {
          skippedExtSet.add(extension === "" ? "(확장자 없음)" : extension);
        }
        return isSupported;
      });
      skippedUnsupported = scannedFiles.length - supportedFiles.length;
      skippedExtensions = Array.from(skippedExtSet).sort();
    } catch (err) {
      // 포맷 조회 실패 시 필터링 없이 전체 파일로 진행해 업로드 흐름을 막지 않는다.
      console.warn(
        "[useFolderUpload] /config 조회 실패, 전체 파일로 업로드를 진행합니다:",
        err,
      );
    }

    setState((prev) => ({
      ...prev,
      scannedFiles: supportedFiles,
      skippedUnsupported,
      skippedExtensions,
    }));

    // Step 4: sync/check
    try {
      const checkResult = await fetchClient.post<SyncCheckResponse>(
        "/ingest/check",
        {
          team_id: teamId,
          folder_path: folderPath,
          files: supportedFiles.map((f) => {
            const fullPath = getScannedFileFullPath(folderPath, f);

            return {
              relative_path: f.relativePath,
              file_path: fullPath,
              absolute_path: fullPath,
              absolutePath: fullPath,
              size: f.size,
              mtime: f.mtime,
              fileName: f.fileName,
            };
          }),
        },
        { suppressAuthRedirect: true },
      );

      setState((prev) => ({ ...prev, step: "ready", checkResult }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        step: "error",
        errorMessage:
          err instanceof Error ? err.message : "서버 확인에 실패했습니다.",
      }));
    }
  }, [teamId, fetchClient, ensureToken]);

  const startUpload = useCallback(async (): Promise<TeamFolder | null> => {
    const electronAPI = window.electronAPI;
    if (
      !electronAPI ||
      !state.folderPath ||
      !state.checkResult ||
      !state.folderName
    ) {
      return null;
    }

    if (!ensureToken()) return null;

    const filesToUpload = state.scannedFiles.filter((_, index) =>
      state.checkResult!.indices_to_upload.includes(index),
    );

    setState((prev) => ({
      ...prev,
      step: "uploading",
      progress: { current: 0, total: filesToUpload.length },
    }));

    let lastResponse: SyncUploadResponse | null = null;

    try {
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        const fullPath = getScannedFileFullPath(state.folderPath, file);

        const readResult = await electronAPI.readFile(fullPath);
        if (!readResult.success || !readResult.data) {
          throw new Error(`파일 읽기 실패: ${file.relativePath}`);
        }

        const blob = new Blob([readResult.data]);
        const formData = new FormData();
        formData.append("file", blob, file.relativePath);
        formData.append("team_id", String(teamId));
        formData.append("folder_path", state.folderPath!);
        formData.append("folder_name", state.folderName!);
        formData.append("file_name", file.fileName);
        formData.append("relative_path", file.relativePath);
        formData.append("file_path", fullPath);
        formData.append("absolute_path", fullPath);
        formData.append("mtime", String(file.mtime));

        lastResponse = await fetchClient.postFormData<SyncUploadResponse>(
          "/ingest/upload",
          formData,
          { suppressAuthRedirect: true },
        );

        setState((prev) => ({
          ...prev,
          progress: { current: i + 1, total: filesToUpload.length },
        }));
      }

      setState((prev) => ({ ...prev, step: "done" }));
      // console.log("[useFolderUpload] lastResponse:", lastResponse);

      if (lastResponse) {
        return {
          id: lastResponse.document_group_id,
          // lastResponse.name은 마지막 업로드된 파일명이므로, 실제 폴더명을 사용한다.
          name: state.folderName!,
          document_count: 0,
          // 업로드 직후엔 항상 임베딩이 시작되므로 processing으로 고정한다.
          // (업로드 응답 status 문자열이 "processing"이 아닐 수 있어 그대로 쓰면 "0개 문서"로 표시됨)
          status: "processing",
          uploaded_by: lastResponse.uploaded_by,
          uploaded_at: lastResponse.uploaded_at,
        };
      }

      return null;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        step: "error",
        errorMessage:
          err instanceof Error ? err.message : "업로드에 실패했습니다.",
      }));
      return null;
    }
  }, [
    state.folderPath,
    state.folderName,
    state.checkResult,
    state.scannedFiles,
    teamId,
    fetchClient,
    ensureToken,
  ]);

  return { state, selectFolder, startUpload, reset };
};
