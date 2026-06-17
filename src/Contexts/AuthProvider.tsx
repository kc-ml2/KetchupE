import { useState, useEffect, PropsWithChildren } from "react";
import { useNavigate } from "react-router-dom";
import { createFetchClient } from "@lib/fetchClient";
import { config } from "@config/index";
import { UserPayload } from "@app-types/AuthContext.types";
import { UserProfile } from "@app-types/Profile.types";
import Loading from "@Features/Shared/components/Loading";
import { AuthContext } from "./AuthContext";

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserPayload | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const navigate = useNavigate();

  const getAccessToken = () => accessToken;

  const getTokenPayload = (token?: string): UserPayload | null => {
    const t = token ?? getAccessToken();
    if (!t) return null;
    try {
      const base64Url = t.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join(""),
      );
      const payload = JSON.parse(jsonPayload);
      // console.dir(payload);
      return {
        email: payload.email ?? payload.sub ?? "",
        name: payload.name ?? null,
      };
    } catch (error) {
      console.error("Invalid token", error);
      return null;
    }
  };

  // 서버(GET /auth/me)에서 표시명을 받아 전역 user.name을 보강한다.
  // name은 JWT에 없을 수 있으므로 서버 프로필로 채운다. (없으면 null 유지 → UI에서 email로 폴백)
  // accessToken 상태 반영 전에도 동작하도록 토큰을 명시적으로 받는다.
  const syncUserProfile = async (token: string) => {
    try {
      const res = await fetch(`${config.apiUrl}/auth/me`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "device-id": localStorage.getItem("device_id") || "",
        },
      });
      if (!res.ok) return;
      const profile: UserProfile = await res.json();
      setUser((prev) => ({
        email: profile.email ?? prev?.email ?? "",
        name: profile.name ?? prev?.name ?? null,
      }));
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
    }
  };

  const login = (token: string, redirectTo = "/chatbot", email?: string) => {
    if (token) {
      setAccessToken(token);
      setIsAuthenticated(true);
      const payload = getTokenPayload(token);
      const userEmail = email ?? payload?.email ?? "";
      setUser({
        email: userEmail,
        name: payload?.name ?? null,
      });
      if (userEmail) {
        localStorage.setItem("user_email", userEmail);
      }
      // 서버 표시명으로 보강 (응답 전이라도 navigate는 진행)
      void syncUserProfile(token);

      navigate(redirectTo, { replace: true });
    }
  };

  // 로그아웃 (메모리 비우고 로그인 페이지로 이동)
  const logout = async () => {
    try {
      await fetch(`${config.apiUrl}/auth/logout`, {
        method: "POST",
        body: JSON.stringify({
          device_id: localStorage.getItem("device_id"),
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "device-id": localStorage.getItem("device_id") || "",
        },
      });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setAccessToken(null);
      setIsAuthenticated(false);
      setIsInitializing(false);
      setUser(null);
      localStorage.removeItem("user_email");
      navigate("/login");
    }
  };

  // 토큰 갱신 (TOKEN_EXPIRED 시 호출) - 중복 호출 방지
  const refreshPromiseRef = { current: null as Promise<void> | null };

  const silentRefresh = async () => {
    // 이미 refresh 진행 중이면 기존 Promise 반환
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      try {
        const deviceId = localStorage.getItem("device_id") || "";
        const res = await fetch(
          `${config.apiUrl}/auth/refresh?device_id=${deviceId}`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        if (!res.ok) {
          throw new Error("Token refresh failed");
        }

        const data = await res.json();
        const newAccessToken = data.access_token;

        if (newAccessToken) {
          setAccessToken(newAccessToken);
          setIsAuthenticated(true);
          const payload = getTokenPayload(newAccessToken);
          const savedEmail = localStorage.getItem("user_email") || "";
          setUser((prev) => ({
            email: prev?.email ?? savedEmail ?? payload?.email ?? "",
            name: payload?.name ?? prev?.name ?? null,
          }));
          // 서버 표시명으로 보강 (init 흐름에서 await되어 Sidebar 렌더 전 반영)
          await syncUserProfile(newAccessToken);
        } else {
          throw new Error("No access token in refresh response");
        }
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  };

  // 본인 표시명(닉네임) 변경 후 전역 user 상태 갱신
  const updateUserName = (name: string) => {
    setUser((prev) => (prev ? { ...prev, name } : prev));
  };

  // fetchClient 생성
  const getUser = () => user;

  const fetchClient = createFetchClient({
    getAccessToken,
    setAccessToken,
    silentRefresh,
    logout,
    getUser,
    setUser,
    getTokenPayload,
  });

  useEffect(() => {
    const initialize = async () => {
      setIsInitializing(true);
      const params = new URLSearchParams(window.location.search);
      const kcparams = params.get("kcparams");
      try {
        // 쿼리 파라미터로 토큰이 들어온 경우
        if (kcparams) {
          // 기존 device_id가 있으면 사용, 없으면 새로 생성 후 저장
          let deviceId = localStorage.getItem("device_id");
          if (!deviceId) {
            deviceId = "device-" + Math.random().toString(36).substring(2, 15);
            localStorage.setItem("device_id", deviceId);
          }
          const response = await fetchClient.post<string>(
            "/kc/verify_user_in_kc_group",
            {
              token: kcparams,
              device_id: deviceId,
            },
          );
          if (response) {
            login(response);
          } else {
            throw new Error("KC Token verification failed");
          }
        } else {
          // 일반적인 silentRefresh 시도
          await silentRefresh();
          // refresh 성공 시 chatbot으로 이동
          navigate("/chatbot", { replace: true });
        }
      } catch (error) {
        console.error("Authentication failed:", error);
        setIsAuthenticated(false);
        setAccessToken(null);
        setUser(null);
        // 초기 인증 실패 시 로그인 페이지로 이동
        navigate("/login");
      } finally {
        setIsInitializing(false);
      }
    };

    initialize();
  }, []);

  // 초기화 중일 때 로딩 화면 표시
  if (isInitializing) {
    return <Loading comment="인증 중입니다." />;
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        login,
        logout,
        fetchClient,
        getTokenPayload,
        getAccessToken,
        user,
        isInitializing,
        updateUserName,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
