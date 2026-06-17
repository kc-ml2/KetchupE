import { useContext, useState } from "react";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import { UpdateProfileRequest, UserProfile } from "@app-types/Profile.types";

interface UseProfileReturn {
  updateName: (name: string) => Promise<void>;
  isUpdating: boolean;
}

export const useProfile = (): UseProfileReturn => {
  const { fetchClient, updateUserName } = useContext(
    AuthContext,
  ) as AuthContextType;
  const [isUpdating, setIsUpdating] = useState(false);

  // 표시명(닉네임) 변경 후 전역 user 상태도 서버 응답값으로 동기화한다.
  const updateName = async (name: string): Promise<void> => {
    setIsUpdating(true);
    try {
      const body: UpdateProfileRequest = { name };
      const profile = await fetchClient.patch<UserProfile>(
        "/auth/me",
        body as unknown as Record<string, unknown>,
      );
      // 방금 설정한 이름이므로 응답 name이 null이면 입력값으로 폴백한다.
      updateUserName(profile.name ?? name);
    } finally {
      setIsUpdating(false);
    }
  };

  return { updateName, isUpdating };
};
