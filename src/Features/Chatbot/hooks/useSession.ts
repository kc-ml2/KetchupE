import { useState, useRef, useCallback, useContext } from "react";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import { Session } from "@app-types/Session.types";

interface UseSessionResult {
  sessionId: string | null;
  ensureSession: () => Promise<string>;
  createNewSession: () => Promise<string>;
}

// 서버측 session_id 확보/초기화를 담당하는 Chatbot 전용 hook
export const useSession = (): UseSessionResult => {
  const { fetchClient } = useContext(AuthContext) as AuthContextType;

  const [sessionId, setSessionId] = useState<string | null>(null);
  // 비동기 콜백에서 최신 session_id를 동기적으로 참조하기 위한 ref
  const sessionIdRef = useRef<string | null>(null);
  // 동시에 여러 번 호출돼도 GET /sessions/last가 한 번만 나가도록 in-flight 가드
  const ensurePromiseRef = useRef<Promise<string> | null>(null);

  const updateSessionId = useCallback((id: string) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  // session_id가 이미 있으면 재사용, 없으면 가장 최근 세션을 확보 (없으면 서버가 자동 생성)
  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }
    if (ensurePromiseRef.current) {
      return ensurePromiseRef.current;
    }
    ensurePromiseRef.current = (async () => {
      try {
        const session = await fetchClient.get<Session>("/sessions/last");
        updateSessionId(session.id);
        return session.id;
      } finally {
        ensurePromiseRef.current = null;
      }
    })();
    return ensurePromiseRef.current;
  }, [fetchClient, updateSessionId]);

  // 새 세션 발급 ("새 대화 시작하기")
  const createNewSession = useCallback(async (): Promise<string> => {
    const session = await fetchClient.post<Session>("/sessions");
    updateSessionId(session.id);
    return session.id;
  }, [fetchClient, updateSessionId]);

  return { sessionId, ensureSession, createNewSession };
};
