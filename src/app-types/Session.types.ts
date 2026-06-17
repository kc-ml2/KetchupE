// 세션 (서버측 대화 흐름 단위)
export interface Session {
  id: string; // uuid hex — WebSocket auth 프레임에 넣을 session_id
  title: string | null;
  status: number;
  created_at: string;
  updated_at: string;
}

// 대화 이력 한 턴 (질문 + 답변)
export interface Conversation {
  id: number;
  question: string;
  answer: string;
  summary: string | null;
  created_at: string;
}

// 서버 페이지네이션 응답 래퍼
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}
