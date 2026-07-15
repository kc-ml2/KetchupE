import {
  ContractBlock,
  ContractCanvas,
  ContractSection,
} from "./Canvas.types";

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

// Canvas 편집 대기 interrupt: 서버가 계약서 초안을 보내고 사용자 입력(resume)을 기다리는 상태
export interface CanvasInterruptContent {
  type: "awaiting_edit";
  canvas_id?: string | null;
  canvas?: ContractCanvas;
  can_undo?: boolean;
  can_redo?: boolean;
  missing_parties?: CanvasPartyValue[];
  error?: string | null;
}

// 참고(anchor) 문서 후보
export interface AnchorCandidate {
  document_id: string;
  name: string;
  score: number;
}

// 참고 문서 선택 interrupt: canvas 작성 전 어떤 계약서를 참고할지 사용자에게 묻는 상태
export interface AnchorChoiceInterruptContent {
  type: "awaiting_anchor_choice";
  candidates: AnchorCandidate[];
}

export type InterruptContent =
  | FeedbackInterruptContent
  | CanvasInterruptContent
  | AnchorChoiceInterruptContent;

// 클라이언트가 UI로 응답을 받는 interrupt (pendingInterrupt 상태로 관리)
export type PendingInterrupt =
  | FeedbackInterruptContent
  | CanvasInterruptContent
  | AnchorChoiceInterruptContent;

// anchor 선택 응답 방식
// use_selected: 선택한 문서 참고 / anchor_only: 선택한 문서에서만 참고 / skip: 문서 참고 안 함
export type AnchorChoiceAction = "use_selected" | "anchor_only" | "skip";

// ============ Resume Content Types ============
// interrupt 하위 타입마다 resume으로 보내야 할 content 형태가 다르다.
// 새 interrupt 타입이 생기면 대응되는 resume content를 여기에 추가할 것.

// feedback_score / feedback_reason interrupt에 대한 응답 (점수 또는 의견 텍스트)
export type FeedbackResumeContent = string;

// awaiting_anchor_choice interrupt에 대한 응답 (참고 문서 선택 결과)
export interface AnchorChoiceResumeContent {
  document_ids: string[];
  skip: boolean;
  anchor_only: boolean;
}

export interface CanvasPartyValue {
  label: string;
  name?: string;
  address?: string;
  representative?: string;
  role?: string;
}

export type CanvasAtomicEditOp =
  | { op: "edit"; block_id: string; feedback?: string }
  | {
      op: "add";
      content?: string;
      feedback?: string;
      after_block_id?: string;
      section_id?: string;
      block_type?: string;
    }
  | { op: "delete"; block_id: string }
  | { op: "reorder"; order: string[]; section_id?: string }
  | { op: "set_parties"; parties: CanvasPartyValue[] }
  | { op: "set_terms"; terms: Array<{ label: string; value: string }> };

export type CanvasEditOp =
  | CanvasAtomicEditOp
  | { op: "batch"; ops: CanvasAtomicEditOp[] }
  | { op: "regenerate"; feedback: string }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "finalize" };

export type ResumeContent =
  | FeedbackResumeContent
  | AnchorChoiceResumeContent
  | CanvasEditOp;

export interface CanvasRef {
  canvas_id: string;
  version_id: string;
  title: string;
}

export interface CanvasTermValue {
  term_key: string;
  label: string;
  value: string;
}

export type CanvasActionContext =
  | {
      op: "edit";
      block_id: string;
      label: string;
    }
  | {
      op: "add";
      section_id: string;
      after_block_id: string;
      label: string;
    };

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
  canvasRef?: CanvasRef;
}

// Chat Hook Interface
export interface ChatMessagesHook {
  messages: Message[];
  inputMessage: string;
  isGenerating: boolean;
  feedbackModeEnabled: boolean;
  isConfigured: boolean;
  connectionPhase: ConnectionPhase;
  pendingInterrupt: PendingInterrupt | null;
  isSubmittingResume: boolean;
  sessionId: string | null;
  canvasData: ContractCanvas | null;
  canvasActionContexts: CanvasActionContext[];
  changedBlockIds: string[];
  selectedAnchorIds: string[];
  showMissingTermsForm: boolean;
  setInputMessage: (message: string) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  toggleFeedbackMode: () => Promise<void>;
  sendResume: (content: string) => void;
  toggleAnchorCandidate: (documentId: string) => void;
  submitAnchorChoice: (action: AnchorChoiceAction) => void;
  openCanvas: (canvasId: string) => void;
  removeCanvasActionContext: (context: CanvasActionContext) => void;
  startEditBlock: (section: ContractSection, block: ContractBlock) => void;
  startAddBlockAfter: (section: ContractSection, block: ContractBlock) => void;
  deleteBlock: (section: ContractSection, block: ContractBlock) => void;
  submitMissingTerms: (terms: CanvasTermValue[]) => boolean;
  changeCanvasVersion: (op: "undo" | "redo") => boolean;
  finalizeCanvas: () => boolean;
  stopGenerating: () => void;
  startNewSession: () => Promise<void>;
  closeCanvas: () => void;
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

// interrupt 응답. content는 직전 interrupt 하위 타입에 대응하는 형태여야 한다
export interface WSResumeMessage {
  type: "resume";
  content: ResumeContent;
}

// Server -> Client (Incoming)
export type WSIncomingMessage =
  | WSAuthenticatedMessage
  | WSConfiguredMessage
  | WSRoutedMessage
  | WSThinkingMessage
  | WSMiscMessage
  | WSRetrieveMessage
  | WSStreamMessage
  | WSCanvasMessage
  | WSInterruptMessage
  | WSCompleteMessage
  | WSErrorMessage;

// 서버 라우터가 이번 메시지를 어떤 graph로 보냈는지 알리는 정보성 메시지
export interface WSRoutedMessage {
  type: "routed";
  graph_id: string;
}

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

export interface WSMiscMessage {
  type: "misc";
  content: string;
  elapsed_s?: number;
}

export interface WSRetrieveMessage {
  type: "retrieve";
  documents: RetrieveDocument[];
}

export interface WSStreamMessage {
  type: "stream";
  content: string;
}

// Canvas 응답: message는 채팅창에, canvas는 우측 패널에 표시
export interface WSCanvasMessage {
  type: "canvas";
  message?: string;
  canvas?: ContractCanvas;
}

export interface WSInterruptMessage {
  type: "interrupt";
  content: InterruptContent;
}

export interface WSCompleteMessage {
  type: "complete";
}

export interface WSErrorMessage {
  type: "error";
  content: string;
}
