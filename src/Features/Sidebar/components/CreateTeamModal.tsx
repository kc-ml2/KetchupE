import { useState } from "react";
import { LuX } from "react-icons/lu";
import { guideCopy } from "@config/guideCopy";

interface CreateTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, description?: string) => Promise<unknown>;
}

const CreateTeamModal = ({
  isOpen,
  onClose,
  onSubmit,
}: CreateTeamModalProps): React.JSX.Element | null => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      await onSubmit(name.trim(), description.trim() || undefined);
      setName("");
      setDescription("");
      onClose();
    } catch (err) {
      console.error("팀 생성 실패:", err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "팀 생성에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setName("");
    setDescription("");
    setErrorMessage("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative w-full max-w-[480px] mx-4 bg-white dark:bg-[#18181B] rounded-2xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <h2 className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
            팀 만들기
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
          <span className="mb-5 block rounded-lg bg-[#F4F4F5] px-3 py-2.5 text-sm font-medium leading-6 text-[#18181B] dark:bg-[#27272A] dark:text-[#FAFAFA]">
            {guideCopy.createTeam.description.map((line, index) => (
              <span key={line}>
                {index === 0 ? "💡 " : ""}
                {line}
                {index < guideCopy.createTeam.description.length - 1 && <br />}
              </span>
            ))}
          </span>
          <label className="block text-xs text-[#71717A] mb-1.5">팀 이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="팀 이름을 입력하세요"
            autoFocus
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#27272A] text-[#18181B] dark:text-[#FAFAFA] placeholder:text-[#A1A1AA] outline-none focus:border-[#0066FF]"
          />
          <label className="block mt-4 text-xs text-[#71717A] mb-1.5">
            팀 설명 <span className="text-[#A1A1AA]">(선택)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="팀에 대한 설명을 입력하세요"
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#27272A] text-[#18181B] dark:text-[#FAFAFA] placeholder:text-[#A1A1AA] outline-none focus:border-[#0066FF] resize-none"
          />
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
            disabled={!name.trim() || isSubmitting}
            className="px-4 py-2 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] disabled:bg-[#A1A1AA] disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {isSubmitting ? "생성 중..." : "팀 생성"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateTeamModal;
