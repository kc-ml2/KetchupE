import { useEffect, useState } from "react";
import { LuX } from "react-icons/lu";

interface EditNameModalProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

const EditNameModal = ({
  isOpen,
  currentName,
  onClose,
  onSubmit,
}: EditNameModalProps): React.JSX.Element | null => {
  const [name, setName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // 모달을 열 때마다 현재 표시명으로 입력값을 초기화한다.
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setErrorMessage("");
    }
  }, [isOpen, currentName]);

  if (!isOpen) return null;

  const trimmedName = name.trim();
  const isUnchanged = trimmedName === currentName.trim();

  const handleSubmit = async () => {
    if (!trimmedName || isUnchanged) return;
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      await onSubmit(trimmedName);
      onClose();
    } catch (err) {
      console.error("표시명 변경 실패:", err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "이름 변경에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setErrorMessage("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative w-full max-w-[420px] mx-4 bg-white dark:bg-[#18181B] rounded-2xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <h2 className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
            이름 변경
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
          <label className="block text-xs text-[#71717A] mb-1.5">
            표시 이름
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="표시할 이름을 입력하세요"
            autoFocus
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#27272A] text-[#18181B] dark:text-[#FAFAFA] placeholder:text-[#A1A1AA] outline-none focus:border-[#0066FF]"
          />
          <p className="mt-2 text-xs text-[#71717A]">
            변경한 이름은 모든 팀에서 표시됩니다.
          </p>
          {errorMessage && (
            <p className="mt-1.5 text-xs text-[#EF4444]">{errorMessage}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E4E4E7] dark:border-[#27272A]">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg border border-[#E4E4E7] dark:border-[#27272A] text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
          >
            닫기
          </button>
          <button
            onClick={handleSubmit}
            disabled={!trimmedName || isUnchanged || isSubmitting}
            className="px-4 py-2 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] disabled:bg-[#A1A1AA] disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {isSubmitting ? "변경 중..." : "변경"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditNameModal;
