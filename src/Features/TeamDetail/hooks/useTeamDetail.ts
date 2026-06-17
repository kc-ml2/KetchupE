import { useState, useEffect, useCallback, useContext, useRef } from "react";
import {
  TeamDetail,
  TeamMember,
  TeamFolder,
  InviteMemberRequest,
  IngestDocument,
  IngestStatusResponse,
  FolderStatus,
  GroupRetryResponse,
} from "@app-types/Team.types";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import { FetchError } from "@lib/fetchClient";

const POLLING_INTERVAL_MS = 30_000;
const HTTP_STATUS_CONFLICT = 409;

// 임베딩이 끝나지 않은(진행 중) 문서 상태. 폴더를 "processing"으로 집계하고 polling을 켠다.
const IN_PROGRESS_DOC_STATUSES = new Set(["processing", "uploading", "queued"]);
// 업로드/임베딩에 실패한 문서 상태.
const FAILED_DOC_STATUSES = new Set(["error", "failed"]);

interface UseTeamDetailReturn {
  team: TeamDetail | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  inviteMember: (invite: InviteMemberRequest) => Promise<TeamMember>;
  removeMember: (userId: number) => Promise<void>;
  retryDocument: (documentId: string) => Promise<void>;
  retryFolder: (groupId: number) => Promise<void>;
  addFolderOptimistic: (folder: TeamFolder) => void;
}

export const useTeamDetail = (
  teamId: string | undefined,
): UseTeamDetailReturn => {
  const { fetchClient, isAuthenticated } = useContext(
    AuthContext,
  ) as AuthContextType;
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTeamDetail = useCallback(async () => {
    if (!teamId || !isAuthenticated) {
      setTeam(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const [data, ingestStatus] = await Promise.all([
        fetchClient.get<TeamDetail>(`/teams/${teamId}`),
        fetchClient.get<IngestStatusResponse>(`/ingest/status`, {
          team_id: Number(teamId),
        }),
      ]);

      // 문서는 group_id(= 폴더 id) 기준으로 그룹핑한다.
      const documentsByGroupId = ingestStatus.documents.reduce<
        Record<number, IngestDocument[]>
      >((acc, document) => {
        (acc[document.group_id] ??= []).push(document);
        return acc;
      }, {});

      // 빈 폴더(서버 기준 문서 0개)는 목록에서 제외한다.
      const nonEmptyFolders = data.folders.filter(
        (folder) => folder.document_count > 0,
      );

      const foldersWithStatus = nonEmptyFolders.map((folder) => {
        const docs = documentsByGroupId[folder.id] ?? [];

        // 폴더 상태는 문서들의 status로 집계한다. (하나라도 진행 중이면 폴더도 processing)
        const resolvedStatus: FolderStatus = (() => {
          if (docs.some((d) => IN_PROGRESS_DOC_STATUSES.has(d.status))) {
            return "processing";
          }
          if (docs.some((d) => FAILED_DOC_STATUSES.has(d.status))) {
            return "failed";
          }
          return "completed";
        })();

        // document_count는 서버(folder.document_count) 값을 그대로 신뢰한다.
        return {
          ...folder,
          status: resolvedStatus,
          document_id: docs[0]?.id ?? null,
          documents: docs,
        };
      });

      setTeam({ ...data, folders: foldersWithStatus });
    } catch (err) {
      setError(
        err instanceof Error
          ? err
          : new Error("팀 정보를 불러오는데 실패했습니다."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [teamId, fetchClient, isAuthenticated]);

  useEffect(() => {
    fetchTeamDetail();
  }, [fetchTeamDetail]);

  // Polling: activate when any folder is "processing"
  useEffect(() => {
    const hasProcessing = team?.folders.some((f) => f.status === "processing");

    if (hasProcessing) {
      pollingRef.current = setInterval(() => {
        fetchTeamDetail();
      }, POLLING_INTERVAL_MS);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [team?.folders, fetchTeamDetail]);

  const inviteMember = async (
    invite: InviteMemberRequest,
  ): Promise<TeamMember> => {
    const newMember = await fetchClient.post<TeamMember>(
      `/teams/${teamId}/members`,
      invite as unknown as Record<string, unknown>,
    );
    await fetchTeamDetail();
    return newMember;
  };

  const removeMember = async (userId: number): Promise<void> => {
    await fetchClient.del(`/teams/${teamId}/members/${userId}`);
    await fetchTeamDetail();
  };

  // 개별 문서 재시도. team_id는 쿼리스트링으로 전달한다. (force는 기본 false = ERROR 문서만)
  const retryDocument = async (documentId: string): Promise<void> => {
    await fetchClient.post(`/ingest/${documentId}/retry?team_id=${teamId}`);
    await fetchTeamDetail();
  };

  // 폴더(group) 단위 재시도. 작업 큐 미사용 환경에선 group endpoint가 409를
  // 던지므로, 그때만 폴더 내 error 문서를 개별 재시도로 폴백한다.
  const retryFolder = async (groupId: number): Promise<void> => {
    try {
      await fetchClient.post<GroupRetryResponse>(
        `/ingest/groups/${groupId}/retry?team_id=${teamId}`,
      );
    } catch (err) {
      const isQueueUnavailable =
        err instanceof FetchError && err.status === HTTP_STATUS_CONFLICT;
      if (!isQueueUnavailable) throw err;

      const errorDocs =
        team?.folders
          .find((folder) => folder.id === groupId)
          ?.documents?.filter((doc) => doc.status === "error") ?? [];
      for (const doc of errorDocs) {
        await fetchClient.post(`/ingest/${doc.id}/retry?team_id=${teamId}`);
      }
    }
    await fetchTeamDetail();
  };

  const addFolderOptimistic = useCallback((folder: TeamFolder) => {
    setTeam((prev) => {
      if (!prev) return prev;
      return { ...prev, folders: [...prev.folders, folder] };
    });
  }, []);

  return {
    team,
    isLoading,
    error,
    refetch: fetchTeamDetail,
    inviteMember,
    removeMember,
    retryDocument,
    retryFolder,
    addFolderOptimistic,
  };
};
