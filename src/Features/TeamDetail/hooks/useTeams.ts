import { useState, useEffect, useContext, useCallback } from "react";
import { CreateTeamRequest, TeamSummary } from "@app-types/Team.types";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";

interface UseTeamsReturn {
  teams: TeamSummary[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  createTeam: (name: string, description?: string) => Promise<TeamSummary>;
}

export const useTeams = (): UseTeamsReturn => {
  const { fetchClient, isAuthenticated } = useContext(AuthContext) as AuthContextType;
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTeams = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchClient.get<TeamSummary[]>("/teams");
      setTeams(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("팀 목록을 불러오는데 실패했습니다."));
    } finally {
      setIsLoading(false);
    }
  }, [fetchClient, isAuthenticated]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const createTeam = async (
    name: string,
    description?: string,
  ): Promise<TeamSummary> => {
    const body: CreateTeamRequest = { name };
    // 설명은 선택값이므로 입력이 있을 때만 전달한다. (없으면 백엔드가 null로 생성)
    if (description) body.description = description;
    const newTeam = await fetchClient.post<TeamSummary>(
      "/teams",
      body as unknown as Record<string, unknown>,
    );
    await fetchTeams();
    return newTeam;
  };

  return { teams, isLoading, error, refetch: fetchTeams, createTeam };
};
