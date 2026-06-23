interface Config {
  apiUrl: string;
}

// 과거 버전에서 서버 URL 입력 기능이 남긴 stale localStorage 키를 1회성 정리.
// 이 값이 남아 있으면 빌드에 박힌 VITE_API_URL을 덮어써서 이전 URL로 동작한다.
localStorage.removeItem("serverUrl");

export const config: Config = {
  apiUrl: import.meta.env.VITE_API_URL,
};
