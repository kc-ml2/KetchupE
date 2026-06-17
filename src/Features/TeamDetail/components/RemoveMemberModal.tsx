import { useState } from "react";
import { LuX, LuTriangleAlert } from "react-icons/lu";
import { TeamMember } from "@app-types/Team.types";

interface RemoveMemberModalProps {
  isOpen: boolean;
  member: TeamMember | null;
  onClose: () => void;
  onConfirm: (userId: number) => Promise<void>;
}

const RemoveMemberModal = ({
  isOpen,
  member,
  onClose,
  onConfirm,
}: RemoveMemberModalProps): React.JSX.Element | null => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !member) return null;

  const displayName = member.name ?? member.email;

  const handleClose = () => {
    setErrorMessage(null);
    onClose();
  };

  const handleConfirm = async () => {
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await onConfirm(member.id);
      handleClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "멤버 삭제에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative w-full max-w-[400px] mx-4 bg-white dark:bg-[#18181B] rounded-2xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <h2 className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
            멤버 삭제
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
          >
            <LuX className="w-5 h-5 text-[#71717A]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30">
            <LuTriangleAlert className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm text-center text-[#18181B] dark:text-[#FAFAFA]">
            <span className="font-semibold">{displayName}</span> 님을 팀에서
            삭제하시겠습니까?
          </p>
          <p className="text-xs text-[#71717A] text-center">
            삭제된 멤버는 더 이상 이 팀의 문서에 접근할 수 없습니다.
          </p>
          {errorMessage && (
            <p className="text-sm text-red-500">{errorMessage}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E4E4E7] dark:border-[#27272A]">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg border border-[#E4E4E7] dark:border-[#27272A] text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:bg-[#A1A1AA] disabled:cursor-not-allowed transition-colors text-sm font-medium text-white"
          >
            {isDeleting ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RemoveMemberModal;
