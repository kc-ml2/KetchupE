import { Fragment, useEffect } from "react";
import {
  LuX,
  LuFolderOpen,
  LuUpload,
  LuCheck,
  LuCircleAlert,
  LuLoaderCircle,
} from "react-icons/lu";
import { UseFolderUploadReturn } from "../hooks/useFolderUpload";
import { TeamFolder } from "@app-types/Team.types";
import { guideCopy } from "@config/guideCopy";

interface FolderUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamName: string;
  upload: UseFolderUploadReturn;
  onUploadComplete: (folder: TeamFolder) => void;
}

const FolderUploadModal = ({
  isOpen,
  onClose,
  teamName,
  upload,
  onUploadComplete,
}: FolderUploadModalProps): React.JSX.Element | null => {
  const { state, selectFolder, startUpload, reset } = upload;

  useEffect(() => {
    if (isOpen && state.step === "idle") {
      selectFolder();
    }
  }, [isOpen, state.step, selectFolder]);

  if (!isOpen) return null;

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleUpload = async () => {
    const folder = await startUpload();
    if (folder) {
      onUploadComplete(folder);
      handleClose();
    }
  };

  const isProcessing = state.step === "scanning" || state.step === "checking";
  const uploadPercent =
    state.progress.total > 0
      ? Math.round((state.progress.current / state.progress.total) * 100)
      : 0;
  const uploadNoticeParts = guideCopy.folderUpload.notice.split("{teamName}");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative w-full max-w-[480px] mx-4 bg-white dark:bg-[#18181B] rounded-2xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <h2 className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
            폴더 업로드
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
          >
            <LuX className="w-5 h-5 text-[#71717A]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="mb-4 rounded-lg bg-[#F4F4F5] px-3 py-2.5 text-sm font-medium leading-6 text-[#18181B] dark:bg-[#27272A] dark:text-[#FAFAFA]">
            {uploadNoticeParts.map((part, index) => (
              <Fragment key={`${part}-${index}`}>
                {index > 0 && (
                  <span className="font-bold text-[#0066FF]">{teamName}</span>
                )}
                {part}
              </Fragment>
            ))}
          </p>

          {/* Scanning / Checking */}
          {isProcessing && (
            <div className="flex flex-col items-center py-8">
              <LuLoaderCircle className="w-10 h-10 text-[#0066FF] animate-spin mb-4" />
              <p className="text-sm text-[#71717A]">
                {state.step === "scanning"
                  ? "폴더를 스캔하고 있습니다..."
                  : "서버에서 파일을 확인하고 있습니다..."}
              </p>
            </div>
          )}

          {/* Ready - show check results */}
          {state.step === "ready" && state.checkResult && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-4 rounded-xl border border-[#E4E4E7] dark:border-[#27272A]">
                <LuFolderOpen className="w-8 h-8 text-[#0066FF]" />
                <div>
                  <p className="text-sm font-medium text-[#18181B] dark:text-[#FAFAFA]">
                    {state.folderName}
                  </p>
                  <p className="text-xs text-[#71717A]">
                    총{state.scannedFiles.length}개 파일
                    {state.skippedUnsupported > 0 &&
                      ` / 미지원 포맷 ${state.skippedUnsupported}개 (${state.skippedExtensions.join(", ")}) 제외`}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <SyncCheckRow
                  label="업로드할 파일"
                  count={state.checkResult.indices_to_upload.length}
                  color="text-[#0066FF]"
                />
                <SyncCheckRow
                  label="스킵 (변경 없음)"
                  count={
                    state.checkResult.total -
                    state.checkResult.indices_to_upload.length
                  }
                  color="text-[#71717A]"
                />
              </div>

              {state.checkResult.indices_to_upload.length === 0 && (
                <p className="text-sm text-[#71717A] text-center py-2">
                  업로드할 새 파일이 없습니다.
                </p>
              )}
            </div>
          )}

          {/* Uploading */}
          {state.step === "uploading" && (
            <div className="flex flex-col items-center py-6 gap-4">
              <LuUpload className="w-10 h-10 text-[#0066FF]" />
              <div className="w-full">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#71717A]">업로드 중...</span>
                  <span className="text-[#18181B] dark:text-[#FAFAFA] font-medium">
                    {state.progress.current} / {state.progress.total}
                  </span>
                </div>
                <div className="w-full h-2 bg-[#E4E4E7] dark:bg-[#27272A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#0066FF] rounded-full transition-all duration-300"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Done */}
          {state.step === "done" && (
            <div className="flex flex-col items-center py-8">
              <LuCheck className="w-10 h-10 text-[#22C55E] mb-4" />
              <p className="text-sm font-medium text-[#18181B] dark:text-[#FAFAFA]">
                업로드 완료!
              </p>
              <p className="text-xs text-[#71717A] mt-1">
                {guideCopy.folderUpload.doneDescription}
              </p>
            </div>
          )}

          {/* Error */}
          {state.step === "error" && (
            <div className="flex flex-col items-center py-8">
              <LuCircleAlert className="w-10 h-10 text-red-500 mb-4" />
              <p className="text-sm text-red-500">{state.errorMessage}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E4E4E7] dark:border-[#27272A]">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg border border-[#E4E4E7] dark:border-[#27272A] text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
          >
            {state.step === "done" ? "닫기" : "취소"}
          </button>
          {state.step === "ready" &&
            state.checkResult &&
            state.checkResult.indices_to_upload.length > 0 && (
              <button
                onClick={handleUpload}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] transition-colors"
              >
                <LuUpload className="w-4 h-4 text-white" />
                <span className="text-sm font-medium text-white">
                  {state.checkResult.indices_to_upload.length}개 파일 업로드
                </span>
              </button>
            )}
        </div>
      </div>
    </div>
  );
};

function SyncCheckRow({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F4F4F5] dark:bg-[#27272A]">
      <span className="text-sm text-[#71717A]">{label}</span>
      <span className={`text-sm font-medium ${color}`}>{count}개</span>
    </div>
  );
}

export default FolderUploadModal;
