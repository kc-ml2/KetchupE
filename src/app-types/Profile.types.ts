// 내 프로필 (API: GET /auth/me, PATCH /auth/me 응답)
export interface UserProfile {
  id: number;
  email: string;
  name: string;
}

// 표시명(닉네임) 변경 요청 (API: PATCH /auth/me)
export interface UpdateProfileRequest {
  name: string;
}
