import { useState } from "react";
import { LuX, LuPlus, LuSend } from "react-icons/lu";
import { InviteMemberRequest } from "@app-types/Team.types";

interface InviteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvite: (invite: InviteMemberRequest) => Promise<void>;
}

const InviteMemberModal = ({
  isOpen,
  onClose,
  onInvite,
}: InviteMemberModalProps): React.JSX.Element | null => {
  const [email, setEmail] = useState("");
  const [inviteList, setInviteList] = useState<InviteMemberRequest[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddToList = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;
    // 동일 이메일 중복 추가 방지
    const isDuplicate = inviteList.some(
      (invite) => invite.email === trimmedEmail,
    );
    if (isDuplicate) {
      setEmail("");
      return;
    }
    setInviteList([...inviteList, { email: trimmedEmail }]);
    setEmail("");
  };

  const handleRemoveFromList = (index: number) => {
    setInviteList(inviteList.filter((_, i) => i !== index));
  };

  const handleSendInvites = async () => {
    if (inviteList.length === 0) return;
    setIsSending(true);
    try {
      setErrorMessage(null);
      for (const invite of inviteList) {
        await onInvite(invite);
      }
      setInviteList([]);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "멤버 초대에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    setEmail("");
    setInviteList([]);
    setErrorMessage(null);
    onClose();
  };

  // 랜덤 색상 생성
  const getRandomColor = (seed: string) => {
    const colors = [
      "#0066FF",
      "#22C55E",
      "#F59E0B",
      "#EC4899",
      "#8B5CF6",
      "#06B6D4",
    ];
    const index = seed.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-[480px] mx-4 bg-white dark:bg-[#18181B] rounded-2xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <h2 className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
            멤버 초대
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
          {/* Input Form */}
          <div className="p-4 rounded-xl border border-[#E4E4E7] dark:border-[#27272A] mb-6">
            <div className="mb-3">
              <label className="block text-xs text-[#71717A] mb-1.5">
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddToList()}
                placeholder="email@example.com"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#27272A] text-[#18181B] dark:text-[#FAFAFA] placeholder:text-[#A1A1AA] outline-none focus:border-[#0066FF]"
              />
            </div>
            <button
              onClick={handleAddToList}
              disabled={!email.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#0066FF] text-[#0066FF] hover:bg-[#0066FF]/10 disabled:border-[#A1A1AA] disabled:text-[#A1A1AA] disabled:cursor-not-allowed transition-colors"
            >
              <LuPlus className="w-4 h-4" />
              <span className="text-sm font-medium">초대 목록에 추가</span>
            </button>
            <p className="mt-2 text-xs text-[#71717A]">
              초대받은 사용자는 가입 후 직접 이름을 설정할 수 있습니다.
            </p>
          </div>

          {/* Pending Invites */}
          {inviteList.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-[#18181B] dark:text-[#FAFAFA] mb-3">
                초대할 멤버
              </h3>
              <div className="flex flex-col gap-2">
                {inviteList.map((invite, index) => (
                  <div
                    key={invite.email}
                    className="flex items-center justify-between p-3 rounded-xl border border-[#E4E4E7] dark:border-[#27272A]"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex items-center justify-center w-9 h-9 rounded-full"
                        style={{ backgroundColor: getRandomColor(invite.email) }}
                      >
                        <span className="text-sm font-medium text-white">
                          {invite.email.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-[#18181B] dark:text-[#FAFAFA]">
                        {invite.email}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveFromList(index)}
                      className="p-1 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
                    >
                      <LuX className="w-4 h-4 text-[#71717A]" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
          {errorMessage && (
            <div className="px-6 pb-2">
              <p className="text-sm text-red-500">{errorMessage}</p>
            </div>
          )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E4E4E7] dark:border-[#27272A]">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg border border-[#E4E4E7] dark:border-[#27272A] text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
          >
            닫기
          </button>
          <button
            onClick={handleSendInvites}
            disabled={inviteList.length === 0 || isSending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] disabled:bg-[#A1A1AA] disabled:cursor-not-allowed transition-colors"
          >
            <LuSend className="w-4 h-4 text-white" />
            <span className="text-sm font-medium text-white">{isSending ? "초대 중..." : "초대 보내기"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default InviteMemberModal;
