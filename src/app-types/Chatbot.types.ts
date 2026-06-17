// 메시지 종류 (answer, error, thinking, retrieve)
export type MessageKind = "answer" | "error" | "thinking" | "retrieve";

export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "configuring"
  | "ready"
  | "streaming"
  | "waiting_interrupt";

export type FeedbackInterruptType = "feedback_score" | "feedback_reason";

export interface FeedbackInterruptContent {
  type: FeedbackInterruptType;
}

// 메시지 메타 정보 (참조 문서 등)
export interface MessageMeta {
  contents?: string[];
}

// Retrieve 문서 정보
export interface RetrieveDocument {
  document_id: string;
  document_name: string;
  score: number;
  content: string;
  file_path: string;
  group_id: string | null;
}

// Chat Message
export interface Message {
  role: "user" | "assistant";
  content: string;
  kind?: MessageKind;
  isInterruptPrompt?: boolean;
  isStreaming?: boolean;
  meta?: MessageMeta;
  documents?: RetrieveDocument[];
}

// Chat Hook Interface
export interface ChatMessagesHook {
  messages: Message[];
  inputMessage: string;
  isGenerating: boolean;
  feedbackModeEnabled: boolean;
  isConfigured: boolean;
  connectionPhase: ConnectionPhase;
  pendingInterrupt: FeedbackInterruptContent | null;
  isSubmittingResume: boolean;
  sessionId: string | null;
  setInputMessage: (message: string) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  toggleFeedbackMode: () => Promise<void>;
  sendResume: (content: string) => void;
  stopGenerating: () => void;
  startNewSession: () => Promise<void>;
}

// ============ WebSocket Message Types ============

// Client -> Server (Outgoing)
export type WSOutgoingMessage =
  | WSAuthMessage
  | WSConfigureMessage
  | WSChatMessage
  | WSResumeMessage;

export interface WSAuthMessage {
  type: "auth";
  chat_token: string;
  session_id: string;
}

export interface WSChatMessage {
  type: "message";
  content: string;
}

export interface WSConfigureMessage {
  type: "configure";
  function: "feedback";
}

export interface WSResumeMessage {
  type: "resume";
  content: string;
}

// Server -> Client (Incoming)
export type WSIncomingMessage =
  | WSAuthenticatedMessage
  | WSConfiguredMessage
  | WSThinkingMessage
  | WSRetrieveMessage
  | WSStreamMessage
  | WSInterruptMessage
  | WSCompleteMessage
  | WSErrorMessage;

export interface WSAuthenticatedMessage {
  type: "authenticated";
  session_id: string;
}

export interface WSConfiguredMessage {
  type: "configured";
}

export interface WSThinkingMessage {
  type: "thinking";
}

export interface WSRetrieveMessage {
  type: "retrieve";
  documents: RetrieveDocument[];
}

export interface WSStreamMessage {
  type: "stream";
  content: string;
}

export interface WSInterruptMessage {
  type: "interrupt";
  content: FeedbackInterruptContent;
}

export interface WSCompleteMessage {
  type: "complete";
}

export interface WSErrorMessage {
  type: "error";
  content: string;
}
