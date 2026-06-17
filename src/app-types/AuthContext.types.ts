import { createFetchClient } from "@lib/fetchClient";

export interface AuthContextType {
  isAuthenticated: boolean;
  login: (token: string, redirectTo?: string, email?: string) => void;
  logout: () => void;
  fetchClient: ReturnType<typeof createFetchClient>;
  getTokenPayload: (token?: string) => UserPayload | null;
  getAccessToken: () => string | null;
  user: UserPayload | null;
  isInitializing: boolean;
  // 본인 표시명(닉네임) 변경 후 전역 user 상태를 갱신한다.
  updateUserName: (name: string) => void;
}

export interface UserPayload {
  name: string | null;
  email: string;
}
