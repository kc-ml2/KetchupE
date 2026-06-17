import { useState, useContext, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  LuBuilding2,
  LuUsers,
  LuFolder,
  LuUpload,
  LuTrash2,
  LuUserPlus,
  LuX,
  LuShieldCheck,
  LuLoaderCircle,
  LuCircleAlert,
  LuChevronDown,
  LuChevronRight,
  LuFileText,
  LuRefreshCw,
} from "react-icons/lu";
import Sidebar from "@Features/Sidebar/components/Sidebar";
import InviteMemberModal from "@Features/TeamDetail/components/InviteMemberModal";
import RemoveMemberModal from "@Features/TeamDetail/components/RemoveMemberModal";
import FolderUploadModal from "@Features/TeamDetail/components/FolderUploadModal";
import { useTeamDetail } from "@Features/TeamDetail/hooks/useTeamDetail";
import { useFolderUpload } from "@Features/TeamDetail/hooks/useFolderUpload";
import {
  InviteMemberRequest,
  TeamMember,
  TeamFolder,
  FolderStatus,
  IngestDocument,
} from "@app-types/Team.types";
import { getTeamDisplayName } from "@lib/teamDisplayName";
import { getTeamScopeInfo } from "@lib/teamScopeInfo";
import { getPathLeafName } from "@lib/pathDisplay";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import { guideCopy } from "@config/guideCopy";

const MEMBER_COLORS = [
  "#0066FF",
  "#22C55E",
  "#F59E0B",
  "#EC4899",
  "#8B5CF6",
  "#06B6D4",
];

const getMemberColor = (name: string): string => {
  const index = name.charCodeAt(0) % MEMBER_COLORS.length;
  return MEMBER_COLORS[index];
};

const ROLE_LABEL: Record<string, string> = {
  admin: "관리자",
  member: "멤버",
  pending: "초대 대기 중",
};

const TOAST_DURATION_MS = 2000;

const TeamDetailPage = (): React.JSX.Element => {
  const { teamId } = useParams<{ teamId: string }>();
  const {
    team,
    isLoading,
    error,
    inviteMember,
    removeMember,
    retryDocument,
    retryFolder,
    addFolderOptimistic,
    refetch,
  } = useTeamDetail(teamId);
  const { user, fetchClient } = useContext(AuthContext) as AuthContextType;
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<TeamMember | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<IngestDocument | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<TeamFolder | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [isNotAdminModalOpen, setIsNotAdminModalOpen] = useState(false);
  // 재시도 진행 중인 대상 키. 문서는 doc.id, 폴더는 `folder-${id}`.
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const folderUpload = useFolderUpload(Number(teamId));

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const currentMember = team?.members.find((m) => m.email === user?.email);
  const isAdmin = currentMember?.role === "admin";

  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden font-['Inter',sans-serif]">
        <Sidebar />
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#F4F4F5] dark:bg-[#0F0F0F] items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-[#0066FF] border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden font-['Inter',sans-serif]">
        <Sidebar />
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#F4F4F5] dark:bg-[#0F0F0F] items-center justify-center">
          <p className="text-[#71717A]">
            {error?.message || "팀을 찾을 수 없습니다."}
          </p>
        </div>
      </div>
    );
  }

  const handleInvite = async (invite: InviteMemberRequest) => {
    await inviteMember(invite);
  };

  const handleRemoveMember = async (userId: number) => {
    await removeMember(userId);
    setToastMessage("삭제되었습니다!");
  };

  const handleUploadComplete = (folder: TeamFolder) => {
    addFolderOptimistic(folder);
    setToastMessage(guideCopy.teamDetail.uploadComplete);
  };

  const handleDeleteDocClick = (doc: IngestDocument) => {
    if (!isAdmin) {
      setIsNotAdminModalOpen(true);
      return;
    }
    setDeletingDoc(doc);
  };

  const handleDeleteDocConfirm = async () => {
    if (!deletingDoc) return;
    try {
      await fetchClient.del(`/ingest/${deletingDoc.id}`, {
        team_id: Number(teamId),
      });
      setToastMessage("파일이 삭제되었습니다.");
      refetch();
    } catch {
      setToastMessage("삭제에 실패했습니다.");
    } finally {
      setDeletingDoc(null);
    }
  };

  const handleDeleteFolderClick = (folder: TeamFolder) => {
    if (!isAdmin) {
      setIsNotAdminModalOpen(true);
      return;
    }
    setDeletingFolder(folder);
  };

  const handleDeleteFolderConfirm = async () => {
    if (!deletingFolder || isDeletingFolder) return;
    setIsDeletingFolder(true);
    try {
      await fetchClient.del(`/ingest/groups/${deletingFolder.id}`, {
        team_id: Number(teamId),
      });
      setToastMessage("폴더가 삭제되었습니다.");
      setDeletingFolder(null);
      refetch();
    } catch {
      setToastMessage("삭제에 실패했습니다.");
    } finally {
      setIsDeletingFolder(false);
    }
  };

  const handleRetryDoc = async (doc: IngestDocument) => {
    if (retryingId) return;
    setRetryingId(doc.id);
    try {
      await retryDocument(doc.id);
      setToastMessage("다시 시도를 시작했습니다.");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      setToastMessage(
        reason
          ? `다시 시도에 실패했습니다: ${reason}`
          : "다시 시도에 실패했습니다.",
      );
    } finally {
      setRetryingId(null);
    }
  };

  const handleRetryFolder = async (folder: TeamFolder) => {
    if (retryingId) return;
    setRetryingId(`folder-${folder.id}`);
    try {
      await retryFolder(folder.id);
      setToastMessage("다시 시도를 시작했습니다.");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      setToastMessage(
        reason
          ? `다시 시도에 실패했습니다: ${reason}`
          : "다시 시도에 실패했습니다.",
      );
    } finally {
      setRetryingId(null);
    }
  };

  const teamScopeInfo = getTeamScopeInfo(team.name);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden font-['Inter',sans-serif]">
      <Sidebar />

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#F2F3F7] dark:bg-[#0F0F0F]">
        {/* Header */}
        <div className="flex items-center px-6 py-3 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <div className="flex items-start gap-3">
            <LuUsers className="mt-0.5 w-6 h-6 text-[#18181B] dark:text-[#FAFAFA]" />
            <div className="flex flex-col gap-1">
              <span className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                {getTeamDisplayName(team.name)}
              </span>
              <p className="text-sm text-[#71717A] dark:text-[#A1A1AA]">
                {guideCopy.teamDetail.description}
              </p>
              {team.description && (
                <div className="mt-1.5 flex max-w-3xl items-center gap-2 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1.5 dark:border-[#1D4ED8]/60 dark:bg-[#0B2341]">
                  <LuFileText className="h-4 w-4 flex-shrink-0 text-[#0066FF] dark:text-[#93C5FD]" />
                  <p className="min-w-0 text-sm font-medium text-[#1E3A8A] dark:text-[#DBEAFE]">
                    <span className="font-semibold text-[#0066FF] dark:text-[#93C5FD]">
                      팀 설명 :{" "}
                    </span>
                    <span>{team.description}</span>
                  </p>
                </div>
              )}
              {teamScopeInfo && (
                <div className="mt-2 flex max-w-3xl items-start gap-2.5 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2.5 dark:border-[#1D4ED8]/60 dark:bg-[#0B2341]">
                  {teamScopeInfo.type === "public" ? (
                    <LuShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#0066FF] dark:text-[#93C5FD]" />
                  ) : (
                    <LuBuilding2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#0066FF] dark:text-[#93C5FD]" />
                  )}
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-semibold text-[#0052CC] dark:text-[#93C5FD]">
                      공유 범위: {teamScopeInfo.description}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex gap-6 h-full">
            {/* 업로드된 폴더 Section */}
            <div className="flex-1 flex flex-col rounded-xl border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#0F0F0F]">
              {/* Section Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
                <span className="text-sm font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                  업로드된 폴더
                </span>
                <button
                  onClick={() => setIsUploadModalOpen(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] transition-colors"
                >
                  <LuUpload className="w-4 h-4 text-white" />
                  <span className="text-sm font-medium text-white">
                    폴더 업로드
                  </span>
                </button>
              </div>

              {/* Folder List */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-2">
                  {team.folders.map((folder) => (
                    <FolderItem
                      key={folder.id}
                      folder={folder}
                      onDeleteDocClick={handleDeleteDocClick}
                      onDeleteFolderClick={handleDeleteFolderClick}
                      onRetryDoc={handleRetryDoc}
                      onRetryFolder={handleRetryFolder}
                      retryingId={retryingId}
                    />
                  ))}
                </div>

                {team.folders.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16">
                    <LuFolder className="w-12 h-12 text-[#71717A] mb-3" />
                    <p className="text-sm text-[#71717A]">
                      아직 업로드된 폴더가 없습니다.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 멤버 Section */}
            <div className="w-[280px] flex-shrink-0 flex flex-col rounded-xl border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#0F0F0F]">
              {/* Section Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
                <span className="text-sm font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                  멤버 ({team.members.length})
                </span>
                {isAdmin ? (
                  <button
                    onClick={() => setIsInviteModalOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#0066FF] hover:bg-[#0066FF]/10 transition-colors"
                  >
                    <LuUserPlus className="w-3.5 h-3.5 text-[#0066FF]" />
                    <span className="text-xs font-medium text-[#0066FF]">
                      초대
                    </span>
                  </button>
                ) : (
                  <span className="text-xs text-[#A1A1AA]">
                    관리자에게 초대를 요청해 주세요
                  </span>
                )}
              </div>

              {/* Member List */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-3">
                  {team.members.map((member) => {
                    const displayName = member.name ?? member.email;
                    const isPending = member.role === "pending";
                    return (
                      <div
                        key={member.id}
                        className={`flex items-center gap-3 ${isPending ? "opacity-50" : ""}`}
                      >
                        <div
                          className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: isPending
                              ? "#A1A1AA"
                              : getMemberColor(displayName),
                          }}
                        >
                          <span className="text-sm font-medium text-white">
                            {displayName.charAt(0)}
                          </span>
                        </div>
                        <div className="flex flex-col flex-1 min-w-0">
                          <span
                            className={`text-sm font-medium truncate ${isPending ? "text-[#A1A1AA]" : "text-[#18181B] dark:text-[#FAFAFA]"}`}
                          >
                            {displayName}
                          </span>
                          <span
                            className={`text-xs ${member.role === "admin" ? "text-[#0066FF]" : member.role === "pending" ? "text-[#F59E0B]" : "text-[#71717A]"}`}
                          >
                            {ROLE_LABEL[member.role] ?? member.role}
                          </span>
                        </div>
                        {isAdmin && member.id !== currentMember?.id && (
                          <button
                            onClick={() => setRemovingMember(member)}
                            className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                            title="멤버 삭제"
                          >
                            <LuX className="w-4 h-4 text-[#A1A1AA] hover:text-red-500" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="border-t border-[#E4E4E7] dark:border-[#27272A] px-4 py-3">
                <p className="text-xs leading-5 text-[#71717A] dark:text-[#A1A1AA]">
                  {guideCopy.teamDetail.memberAccess}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <InviteMemberModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onInvite={handleInvite}
      />
      <RemoveMemberModal
        isOpen={removingMember !== null}
        member={removingMember}
        onClose={() => setRemovingMember(null)}
        onConfirm={handleRemoveMember}
      />
      <FolderUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        teamName={getTeamDisplayName(team.name)}
        upload={folderUpload}
        onUploadComplete={handleUploadComplete}
      />

      {/* 관리자 아님 모달 */}
      {isNotAdminModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setIsNotAdminModalOpen(false)}
          />
          <div className="relative bg-white dark:bg-[#18181B] rounded-2xl shadow-xl px-6 py-5 w-full max-w-[340px] mx-4 flex flex-col items-center gap-3">
            <LuCircleAlert className="w-8 h-8 text-[#F59E0B]" />
            <p className="text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] text-center">
              관리자에게 문의하세요.
            </p>
            <button
              onClick={() => setIsNotAdminModalOpen(false)}
              className="mt-1 px-4 py-2 rounded-lg bg-[#F4F4F5] dark:bg-[#27272A] text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] hover:bg-[#E4E4E7] dark:hover:bg-[#3F3F46] transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 파일 삭제 확인 모달 */}
      {deletingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDeletingDoc(null)}
          />
          <div className="relative bg-white dark:bg-[#18181B] rounded-2xl shadow-xl px-6 py-5 w-full max-w-[400px] mx-4 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <LuTrash2 className="w-5 h-5 text-red-500 flex-shrink-0" />
              <h3 className="text-base font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                파일 삭제
              </h3>
            </div>
            <p className="text-sm text-[#71717A] leading-relaxed">
              <span className="font-medium text-[#18181B] dark:text-[#FAFAFA]">
                {getPathLeafName(deletingDoc.name)}
              </span>{" "}
              파일을 삭제하시겠습니까? 해당 파일 내용을 더이상 참고할 수 없게
              됩니다.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeletingDoc(null)}
                className="px-4 py-2 rounded-lg border border-[#E4E4E7] dark:border-[#27272A] text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleDeleteDocConfirm}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-sm font-medium text-white transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 폴더 삭제 확인 모달 */}
      {deletingFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !isDeletingFolder && setDeletingFolder(null)}
          />
          <div className="relative bg-white dark:bg-[#18181B] rounded-2xl shadow-xl px-6 py-5 w-full max-w-[400px] mx-4 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <LuTrash2 className="w-5 h-5 text-red-500 flex-shrink-0" />
              <h3 className="text-base font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                폴더 삭제
              </h3>
            </div>
            <p className="text-sm text-[#71717A] leading-relaxed">
              <span className="font-medium text-[#18181B] dark:text-[#FAFAFA]">
                {deletingFolder.name}
              </span>{" "}
              폴더를 삭제하시겠습니까? 폴더에 포함된 모든 파일이 삭제되며, 더이상
              참고할 수 없게 됩니다.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeletingFolder(null)}
                disabled={isDeletingFolder}
                className="px-4 py-2 rounded-lg border border-[#E4E4E7] dark:border-[#27272A] text-sm font-medium text-[#18181B] dark:text-[#FAFAFA] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleDeleteFolderConfirm}
                disabled={isDeletingFolder}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-sm font-medium text-white transition-colors disabled:opacity-50"
              >
                {isDeletingFolder && (
                  <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" />
                )}
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#18181B] dark:bg-[#FAFAFA] text-white dark:text-[#18181B] text-sm font-medium rounded-lg shadow-lg animate-fade-in">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

function FolderItem({
  folder,
  onDeleteDocClick,
  onDeleteFolderClick,
  onRetryDoc,
  onRetryFolder,
  retryingId,
}: {
  folder: TeamFolder;
  onDeleteDocClick: (doc: IngestDocument) => void;
  onDeleteFolderClick: (folder: TeamFolder) => void;
  onRetryDoc: (doc: IngestDocument) => void;
  onRetryFolder: (folder: TeamFolder) => void;
  retryingId: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const docs = folder.documents ?? [];
  const isFolderRetrying = retryingId === `folder-${folder.id}`;

  return (
    <div className="rounded-xl border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#171717] overflow-hidden">
      {/* 폴더 헤더 */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-[#F4F4F5] dark:hover:bg-[#1F1F1F] transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#DBEAFE] dark:bg-[#1E3A5F] flex-shrink-0">
          <FolderStatusIcon status={folder.status} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-[#18181B] dark:text-[#FAFAFA]">
            {folder.name}
          </p>
          <FolderStatusLabel
            status={folder.status}
            documentCount={folder.document_count}
          />
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {folder.status === "failed" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetryFolder(folder);
              }}
              disabled={retryingId !== null}
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#BFDBFE] px-2.5 text-xs font-medium text-[#0066FF] hover:bg-[#0066FF]/10 transition-colors disabled:opacity-50"
              title="실패한 파일들 다시 시도하기"
            >
              {isFolderRetrying ? (
                <LuLoaderCircle className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LuRefreshCw className="w-3.5 h-3.5" />
              )}
              다시 시도
            </button>
          )}
          <div className="flex items-center">
            {isExpanded ? (
              <LuChevronDown className="w-4 h-4 text-[#71717A]" />
            ) : (
              <LuChevronRight className="w-4 h-4 text-[#71717A]" />
            )}
          </div>
        </div>
      </div>

      {/* 펼침 영역: 파일 목록 + 폴더 삭제 */}
      {isExpanded && (
        <div className="border-t border-[#E4E4E7] dark:border-[#27272A]">
          {/* 폴더 삭제하기 */}
          <div className="flex justify-end bg-[#FAFAFA] dark:bg-[#1F1F1F] px-4 py-2.5">
            <button
              onClick={() => onDeleteFolderClick(folder)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title="폴더 전체 삭제"
            >
              <LuTrash2 className="w-3.5 h-3.5" />
              폴더 삭제하기
            </button>
          </div>

          {docs.length > 0 && (
            <div className="border-t border-[#F4F4F5] divide-y divide-[#F4F4F5] dark:border-[#27272A] dark:divide-[#27272A]">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-start gap-3 px-4 py-2.5 pl-[68px]"
                >
                  <LuFileText className="w-4 h-4 text-[#71717A] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#18181B] dark:text-[#FAFAFA] truncate">
                      {getPathLeafName(doc.name)}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <DocStatusBadge status={doc.status} />
                      <span className="text-xs text-[#A1A1AA]">
                        <b>생성:</b>{" "}
                        {new Date(doc.created_at).toLocaleString("ko-KR")}
                      </span>
                      <span className="text-xs text-[#A1A1AA]">
                        <b>수정:</b>{" "}
                        {new Date(doc.updated_at).toLocaleString("ko-KR")}
                      </span>
                    </div>
                  </div>
                  {doc.status === "error" && (
                    <button
                      onClick={() => onRetryDoc(doc)}
                      disabled={retryingId !== null}
                      className="p-1.5 rounded-lg hover:bg-[#0066FF]/10 transition-colors flex-shrink-0 mt-0.5 disabled:opacity-50"
                      title="다시 시도"
                    >
                      {retryingId === doc.id ? (
                        <LuLoaderCircle className="w-3.5 h-3.5 text-[#0066FF] animate-spin" />
                      ) : (
                        <LuRefreshCw className="w-3.5 h-3.5 text-[#A1A1AA]" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => onDeleteDocClick(doc)}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0 mt-0.5"
                    title="파일 삭제"
                  >
                    <LuTrash2 className="w-3.5 h-3.5 text-[#A1A1AA]" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    uploading:
      "inline-flex items-center rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[#0066FF] dark:border-[#1E3A8A] dark:bg-[#172554] dark:text-[#93C5FD]",
    queued: "text-[#0066FF]",
    processing:
      "inline-flex items-center rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[#0066FF] dark:border-[#1E3A8A] dark:bg-[#172554] dark:text-[#93C5FD]",
    active: "text-[#3B82C4]",
    completed: "text-[#22C55E]",
    failed: "text-red-500",
    error: "text-red-500",
  };
  const labels: Record<string, string> = {
    uploading: "처리 중",
    queued: "대기 중",
    processing: "처리 중",
    active: "사용 가능",
    completed: "완료",
    failed: "실패",
    error: "실패",
  };
  return (
    <span
      className={`text-xs font-medium ${styles[status] ?? "text-[#71717A]"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function FolderStatusIcon({ status }: { status: FolderStatus }) {
  switch (status) {
    case "processing":
      return <LuLoaderCircle className="w-5 h-5 text-[#0066FF] animate-spin" />;
    case "failed":
      // return <LuCircleAlert className="w-5 h-5 text-red-500" />;
      return <LuFolder className="w-5 h-5 text-[#0066FF]" />;
    case "completed":
    default:
      return <LuFolder className="w-5 h-5 text-[#0066FF]" />;
  }
}

function FolderStatusLabel({
  status,
  documentCount,
}: {
  status: FolderStatus;
  documentCount: number;
}) {
  switch (status) {
    case "processing":
      return (
        <p className="text-xs text-[#0066FF]">
          {guideCopy.teamDetail.folderProcessingStatus}
        </p>
      );
    case "failed":
      return (
        <p className="mt-0.5 flex items-center gap-1 text-xs">
          <span className="text-[#71717A]">{documentCount}개 문서</span>
          <span className="text-[#D4D4D8]">·</span>
          <span className="font-medium text-red-500">실패한 파일 있음</span>
        </p>
      );
    case "completed":
    default:
      return <p className="text-xs text-[#71717A]">{documentCount}개 문서</p>;
  }
}

export default TeamDetailPage;
