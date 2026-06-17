// 내 프로필 (API: GET /auth/me, PATCH /auth/me 응답)
// name은 사용자가 표시명을 설정하지 않았으면 null이다. (UI에서 email로 폴백)
export interface UserProfile {
  id: number;
  email: string;
  name: string | null;
}

// 표시명(닉네임) 변경 요청 (API: PATCH /auth/me)
export interface UpdateProfileRequest {
  name: string;
}
