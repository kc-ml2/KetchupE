import { useState, useRef, useCallback, useEffect, useContext } from "react";
import { config } from "@config/index";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import {
  AnchorChoiceAction,
  CanvasActionContext,
  CanvasAtomicEditOp,
  CanvasEditOp,
  CanvasTermValue,
  ChatMessagesHook,
  ConnectionPhase,
  FeedbackInterruptContent,
  Message,
  PendingInterrupt,
  WSAuthMessage,
  WSChatMessage,
  WSConfigureMessage,
  WSIncomingMessage,
  WSResumeMessage,
} from "@app-types/Chatbot.types";
import {
  ContractBlock,
  ContractCanvas,
  ContractSection,
} from "@app-types/Canvas.types";
import { Conversation, Paginated } from "@app-types/Session.types";
import { useSession } from "./useSession";

// 로컬 turn 식별자 (stale 메시지 필터링용, 서버 session_id와 무관)
let turnIdCounter = 0;
const CONFIGURE_TIMEOUT_MS = 8000;
const AUTH_TIMEOUT_MS = 10000;
const HISTORY_PAGE_SIZE = 100;
const generateTurnId = (): number => {
  turnIdCounter += 1;
  return turnIdCounter;
};

// canvas 수신 시 서버 message가 없을 때 채팅창에 표시할 기본 안내 문구
const CANVAS_READY_MESSAGE =
  "계약서 초안을 오른쪽 캔버스에 준비했어요. 캔버스에서 내용을 확인해 주세요.";

// awaiting_anchor_choice interrupt 수신 시 채팅창에 표시할 안내 문구
const ANCHOR_CHOICE_PROMPT_MESSAGE =
  "참고할 계약서를 선택해 주세요. 선택한 문서를 바탕으로 초안을 작성할게요.";

// 요청 전송 직후 서버의 첫 이벤트가 오기 전까지 진행 중임을 보여주는 placeholder
// (thinking/stream/canvas/interrupt/error 핸들러가 kind === "thinking"을 제거하며 교체한다)
const createThinkingMessage = (): Message => ({
  role: "assistant",
  content: "",
  kind: "thinking",
  isStreaming: true,
});

export const upsertThinkingMessage = (
  messages: Message[],
  content = "",
): Message[] => [
  ...messages.filter((message) => message.kind !== "thinking"),
  { ...createThinkingMessage(), content },
];

const getCanvasTitle = (canvas: ContractCanvas): string =>
  canvas.title || canvas.metadata?.title || "Canvas";

const getSectionHeading = (section: ContractSection): string =>
  [section.metadata?.article_no, section.title].filter(Boolean).join(" ");

const getBlockActionLabel = (
  section: ContractSection,
  block: ContractBlock,
): string => {
  const sectionHeading = getSectionHeading(section);
  return [sectionHeading, block.block_id].filter(Boolean).join(" / ");
};

export const getCanvasActionKey = (context: CanvasActionContext): string =>
  context.op === "edit"
    ? `edit:${context.block_id}`
    : `add:${context.after_block_id}`;

export const getCanvasFeedbackEditOp = (
  context: CanvasActionContext,
  feedback: string,
): CanvasAtomicEditOp => {
  if (context.op === "edit") {
    return { op: "edit", block_id: context.block_id, feedback };
  }
  return {
    op: "add",
    feedback,
    after_block_id: context.after_block_id,
    section_id: context.section_id,
  };
};

export const getCanvasFeedbackEditCommand = (
  contexts: CanvasActionContext[],
  feedback: string,
): CanvasEditOp => {
  if (contexts.length === 0) return { op: "regenerate", feedback };
  const ops = contexts.map((context) =>
    getCanvasFeedbackEditOp(context, feedback),
  );
  return ops.length === 1 ? ops[0] : { op: "batch", ops };
};

const getVisibleBlockContent = (block: ContractBlock): string =>
  JSON.stringify([
    block.block_type,
    block.numbering,
    block.text,
    block.table,
  ]);

export const getChangedBlockIds = (
  previous: ContractCanvas,
  current: ContractCanvas,
): string[] => {
  const previousBlocks = new Map(
    previous.sections.flatMap((section) =>
      section.blocks.map((block) => [block.block_id, block] as const),
    ),
  );
  return current.sections
    .flatMap((section) => section.blocks)
    .filter(
      (block) =>
        !previousBlocks.has(block.block_id) ||
        getVisibleBlockContent(previousBlocks.get(block.block_id)!) !==
          getVisibleBlockContent(block),
    )
    .map((block) => block.block_id);
};

// 대화 이력(시간순) → 화면 메시지로 변환 (한 턴 = 사용자 질문 + 어시스턴트 답변)
// answer는 interrupt로 끝난 턴에서 null일 수 있어 방어 처리 (undefined content는 렌더링 크래시 유발)
const conversationsToMessages = (items: Conversation[]): Message[] =>
  items.flatMap((conversation) => [
    { role: "user" as const, content: conversation.question ?? "" },
    {
      role: "assistant" as const,
      content: conversation.answer ?? "",
      kind: "answer" as const,
    },
  ]);

export const useChatMessages = (): ChatMessagesHook => {
  const { fetchClient } = useContext(AuthContext) as AuthContextType;
  const { sessionId, ensureSession, createNewSession } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [feedbackModeEnabled, setFeedbackModeEnabled] =
    useState<boolean>(false);
  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [connectionPhase, setConnectionPhase] =
    useState<ConnectionPhase>("idle");
  const [pendingInterrupt, setPendingInterrupt] =
    useState<PendingInterrupt | null>(null);
  const [isSubmittingResume, setIsSubmittingResume] = useState<boolean>(false);
  const [canvasesById, setCanvasesById] = useState<
    Record<string, ContractCanvas>
  >({});
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [canvasActionContexts, setCanvasActionContexts] = useState<
    CanvasActionContext[]
  >([]);
  const [changedBlockIdsByCanvasId, setChangedBlockIdsByCanvasId] = useState<
    Record<string, string[]>
  >({});
  // awaiting_anchor_choice에서 사용자가 선택한 참고 문서 id 목록 (resume 전송 시 사용)
  const [selectedAnchorIds, setSelectedAnchorIds] = useState<string[]>([]);
  // missing term을 제출한 canvas 버전 키 — 같은 버전에서는 폼을 다시 보여주지 않는다
  const [submittedTermsCanvasKey, setSubmittedTermsCanvasKey] = useState<
    string | null
  >(null);

  const canvasData = activeCanvasId ? canvasesById[activeCanvasId] ?? null : null;
  const changedBlockIds = activeCanvasId
    ? changedBlockIdsByCanvasId[activeCanvasId] ?? []
    : [];
  const showMissingTermsForm = Boolean(
    canvasData &&
      pendingInterrupt?.type === "awaiting_edit" &&
      canvasData.status.toLowerCase() !== "finalized" &&
      canvasData.missing_terms.length > 0 &&
      `${canvasData.canvas_id}:${canvasData.version_id}` !==
        submittedTermsCanvasKey,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const canvasesByIdRef = useRef<Record<string, ContractCanvas>>({});
  // canvas 수신 이후에는 complete가 와도 연결을 닫지 않기 위한 플래그
  // (연결이 끊기면 서버가 canvas 편집 대기 상태를 버리고 새 계약서를 생성한다)
  const hasCanvasSessionRef = useRef<boolean>(false);
  const finalizingCanvasIdRef = useRef<string | null>(null);
  const currentContentRef = useRef<string>("");
  const activeTurnIdRef = useRef<number | null>(null);
  const isConfiguredRef = useRef<boolean>(false);
  // 대화 이력 복원을 1회만 수행하기 위한 가드
  const historyLoadedRef = useRef<boolean>(false);
  // 'authenticated' ack 대기 중인 connect promise의 resolver
  const authPromiseRef = useRef<{
    expectedSessionId: string;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const setConfiguredState = useCallback((value: boolean) => {
    isConfiguredRef.current = value;
    setIsConfigured(value);
  }, []);

  const storeCanvas = useCallback((canvas: ContractCanvas) => {
    const previous = canvasesByIdRef.current[canvas.canvas_id];
    if (previous?.version_id === canvas.version_id) {
      setActiveCanvasId(canvas.canvas_id);
      return;
    }
    if (previous) {
      setChangedBlockIdsByCanvasId((prev) => ({
        ...prev,
        [canvas.canvas_id]: getChangedBlockIds(previous, canvas),
      }));
    }
    hasCanvasSessionRef.current = true;
    canvasesByIdRef.current = {
      ...canvasesByIdRef.current,
      [canvas.canvas_id]: canvas,
    };
    setCanvasesById(canvasesByIdRef.current);
    setActiveCanvasId(canvas.canvas_id);
    setCanvasActionContexts([]);
  }, []);

  // WebSocket URL 생성
  const getWebSocketUrl = useCallback(() => {
    const baseUrl = config.apiUrl.replace(/^http/, "ws");
    return `${baseUrl}/chat/connect`;
  }, []);

  // Chat Token 발급
  const getChatToken = useCallback(async (): Promise<string> => {
    const response = await fetchClient.post<{ chat_token: string }>(
      "/auth/chat-token",
    );
    return response.chat_token;
  }, [fetchClient]);

  const resetTurnState = useCallback(() => {
    currentContentRef.current = "";
    setIsGenerating(false);
    setPendingInterrupt(null);
    setIsSubmittingResume(false);
    setConnectionPhase(feedbackModeEnabled && isConfigured ? "ready" : "idle");
  }, [feedbackModeEnabled, isConfigured]);

  const getInterruptPromptMessage = useCallback(
    (interruptType: FeedbackInterruptContent["type"]): string => {
      if (interruptType === "feedback_score") {
        return "답변 만족도를 1점부터 5점 사이로 선택해주세요.";
      }
      return "추가 의견을 남겨주세요.";
    },
    [],
  );

  // 메시지 핸들러 (turn ID로 stale 메시지 필터링)
  const createMessageHandler = useCallback(
    (turnId: number) => {
      return (event: MessageEvent) => {
        if (activeTurnIdRef.current !== turnId) {
          console.log(
            "[WebSocket] Ignoring stale message from turn:",
            turnId,
            "current:",
            activeTurnIdRef.current,
          );
          return;
        }
        console.log("[WebSocket] Processing message for turn:", turnId);

        try {
          const data = JSON.parse(event.data) as WSIncomingMessage;
          console.dir(data, { depth: null });

          switch (data.type) {
            case "authenticated": {
              const pending = authPromiseRef.current;
              if (pending) {
                if (data.session_id !== pending.expectedSessionId) {
                  console.error(
                    "[WebSocket] authenticated session_id mismatch:",
                    data.session_id,
                    "expected:",
                    pending.expectedSessionId,
                  );
                  pending.reject(
                    new Error("Authenticated session_id mismatch"),
                  );
                } else {
                  console.log(
                    "[WebSocket] Authenticated session:",
                    data.session_id,
                  );
                  pending.resolve();
                }
              }
              break;
            }

            case "configured": {
              setConfiguredState(true);
              setConnectionPhase("ready");
              break;
            }

            // 서버 라우터가 요청을 보낸 graph 안내 (정보성)
            case "routed": {
              console.log("[WebSocket] Routed to graph:", data.graph_id);
              break;
            }

            case "thinking": {
              setConnectionPhase("streaming");
              setIsGenerating(true);
              setPendingInterrupt(null);
              setMessages((prev) => upsertThinkingMessage(prev));
              break;
            }

            case "misc": {
              setMessages((prev) => upsertThinkingMessage(prev, data.content));
              break;
            }

            case "retrieve": {
              setMessages((prev) => {
                const filtered = prev.filter((msg) => msg.kind !== "thinking");
                return [
                  ...filtered,
                  {
                    role: "assistant",
                    content: "",
                    kind: "retrieve",
                    documents: data.documents,
                  },
                ];
              });
              break;
            }

            case "stream": {
              setConnectionPhase("streaming");
              setIsGenerating(true);

              currentContentRef.current += data.content || "";
              const content = currentContentRef.current;

              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (
                  lastMsg?.role === "assistant" &&
                  lastMsg.kind === "answer" &&
                  lastMsg.isStreaming
                ) {
                  return [...prev.slice(0, -1), { ...lastMsg, content }];
                }

                const filtered = prev.filter((msg) => msg.kind !== "thinking");
                return [
                  ...filtered,
                  {
                    role: "assistant",
                    content,
                    kind: "answer",
                    isStreaming: true,
                  },
                ];
              });
              break;
            }

            case "canvas": {
              // 계약서 초안 수신: canvas는 우측 패널에, message(없으면 기본 안내)는 채팅창에 표시
              currentContentRef.current = "";
              const canvasRef = data.canvas
                ? {
                    canvas_id: data.canvas.canvas_id,
                    version_id: data.canvas.version_id,
                    title: getCanvasTitle(data.canvas),
                  }
                : undefined;
              if (data.canvas) {
                storeCanvas(data.canvas);
              }
              const noticeMessage = data.message ?? CANVAS_READY_MESSAGE;
              setMessages((prev) => {
                // thinking 제거 + 진행 중이던 스트리밍 메시지 확정
                const finalized = prev
                  .filter((msg) => msg.kind !== "thinking")
                  .map((msg) =>
                    msg.isStreaming ? { ...msg, isStreaming: false } : msg,
                  );
                return [
                  ...finalized,
                  {
                    role: "assistant",
                    content: noticeMessage,
                    kind: "answer",
                    canvasRef,
                  },
                ];
              });
              // canvas 이후 서버는 interrupt 상태로 대기하므로 이 턴의 생성은 여기서 종료
              resetTurnState();
              break;
            }

            case "interrupt": {
              const interruptContent = data.content;

              // 공통: 생성 중단 + thinking 제거 + 스트리밍 중이던 메시지 확정
              setIsGenerating(false);
              setIsSubmittingResume(false);
              setConnectionPhase("waiting_interrupt");
              currentContentRef.current = "";
              setMessages((prev) => {
                const withoutThinking = prev.filter(
                  (msg) => msg.kind !== "thinking",
                );
                const lastMsg = withoutThinking[withoutThinking.length - 1];
                if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
                  return [
                    ...withoutThinking.slice(0, -1),
                    { ...lastMsg, isStreaming: false },
                  ];
                }
                return withoutThinking;
              });

              if (interruptContent.type === "awaiting_edit") {
                if (interruptContent.canvas?.canvas_id) {
                  storeCanvas(interruptContent.canvas);
                }
                if (interruptContent.error) {
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "assistant",
                      content: `캔버스 편집을 적용하지 못했어요: ${interruptContent.error}`,
                      kind: "error",
                    },
                  ]);
                }
                setPendingInterrupt(interruptContent);
                break;
              }

              // 참고 문서 선택: 후보 목록 UI는 pendingInterrupt 기반으로 렌더링됨
              if (interruptContent.type === "awaiting_anchor_choice") {
                setPendingInterrupt(interruptContent);
                setSelectedAnchorIds([]);
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: ANCHOR_CHOICE_PROMPT_MESSAGE,
                    kind: "answer",
                    isInterruptPrompt: true,
                  },
                ]);
                break;
              }

              // 피드백 interrupt (feedback_score / feedback_reason)
              if (
                interruptContent.type === "feedback_score" ||
                interruptContent.type === "feedback_reason"
              ) {
                setPendingInterrupt(interruptContent);
                const feedbackPrompt = getInterruptPromptMessage(
                  interruptContent.type,
                );
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: feedbackPrompt,
                    kind: "answer",
                    isInterruptPrompt: true,
                  },
                ]);
                break;
              }

              // 새로 추가될 interrupt 하위 타입 대비: 알 수 없는 타입은 무시
              console.warn(
                "[WebSocket] Unhandled interrupt type:",
                interruptContent,
              );
              break;
            }

            case "complete": {
              const finalContent = currentContentRef.current;
              const finalizedCanvasId = finalizingCanvasIdRef.current;

              if (finalizedCanvasId) {
                const canvas = canvasesByIdRef.current[finalizedCanvasId];
                if (canvas) {
                  canvasesByIdRef.current = {
                    ...canvasesByIdRef.current,
                    [finalizedCanvasId]: { ...canvas, status: "finalized" },
                  };
                  setCanvasesById(canvasesByIdRef.current);
                }
                finalizingCanvasIdRef.current = null;
                hasCanvasSessionRef.current = false;
              }

              setMessages((prev) => {
                const withoutThinking = prev.filter(
                  (msg) => msg.kind !== "thinking",
                );
                const lastMsg = withoutThinking[withoutThinking.length - 1];
                if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
                  return [
                    ...withoutThinking.slice(0, -1),
                    { ...lastMsg, content: finalContent, isStreaming: false },
                  ];
                }
                if (finalizedCanvasId) {
                  return [
                    ...withoutThinking,
                    {
                      role: "assistant",
                      content: finalContent || "문서가 확정되었습니다.",
                      kind: "answer",
                    },
                  ];
                }
                return withoutThinking;
              });

              resetTurnState();

              // canvas 세션 중에는 complete 후에도 연결과 turn을 유지한다
              if (!feedbackModeEnabled && !hasCanvasSessionRef.current) {
                activeTurnIdRef.current = null;
                if (wsRef.current) {
                  wsRef.current.close();
                  wsRef.current = null;
                }
              }
              break;
            }

            case "error": {
              finalizingCanvasIdRef.current = null;
              setMessages((prev) => {
                const filtered = prev.filter((msg) => msg.kind !== "thinking");
                return [
                  ...filtered,
                  { role: "assistant", content: data.content, kind: "error" },
                ];
              });

              resetTurnState();

              if (!feedbackModeEnabled) {
                activeTurnIdRef.current = null;
                if (wsRef.current) {
                  wsRef.current.close();
                  wsRef.current = null;
                }
              }
              break;
            }

            // 서버가 스펙 밖의 타입을 보낼 때 조용히 버리지 않고 남긴다 (백엔드 응답 판별용)
            default: {
              console.warn("[WebSocket] Unhandled message type:", data);
              break;
            }
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };
    },
    [
      feedbackModeEnabled,
      getInterruptPromptMessage,
      resetTurnState,
      setConfiguredState,
      storeCanvas,
    ],
  );

  const waitForConfigured = useCallback((timeoutMs: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (isConfiguredRef.current) {
        resolve();
        return;
      }

      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (isConfiguredRef.current) {
          clearInterval(timer);
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error("Configure response timeout"));
        }
      }, 100);
    });
  }, []);

  // WebSocket 연결 + 인증. 'authenticated' ack를 받은 뒤에야 resolve된다.
  const connectWithAuth = useCallback(
    async (turnId: number): Promise<void> => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // 서버 session_id 확보 후 auth 프레임에 포함
      const serverSessionId = await ensureSession();
      const chatToken = await getChatToken();

      return new Promise<void>((resolve, reject) => {
        if (activeTurnIdRef.current !== turnId) {
          reject(new Error("Turn invalidated before connection"));
          return;
        }

        let settled = false;
        let authTimer: ReturnType<typeof setTimeout> | null = null;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (authTimer) clearTimeout(authTimer);
          authPromiseRef.current = null;
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        // 'authenticated' ack 핸들러(createMessageHandler)에서 호출됨
        authPromiseRef.current = {
          expectedSessionId: serverSessionId,
          resolve: () => finish(),
          reject: (error: Error) => finish(error),
        };

        const wsUrl = getWebSocketUrl();
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          if (activeTurnIdRef.current !== turnId) {
            console.log("[WebSocket] Turn invalidated before open, closing...");
            wsRef.current?.close();
            finish(new Error("Turn invalidated before open"));
            return;
          }

          console.log("[WebSocket] Connected, sending auth...");
          const authMessage: WSAuthMessage = {
            type: "auth",
            chat_token: chatToken,
            session_id: serverSessionId,
          };
          wsRef.current?.send(JSON.stringify(authMessage));
          // 'authenticated' ack를 받으면 finish()로 resolve된다.
        };

        wsRef.current.onmessage = createMessageHandler(turnId);

        wsRef.current.onclose = (event) => {
          console.log("[WebSocket] Disconnected:", event.code, event.reason);
          if (activeTurnIdRef.current === turnId) {
            activeTurnIdRef.current = null;
            setConfiguredState(false);
            setConnectionPhase("idle");
            setIsGenerating(false);
            setPendingInterrupt(null);
            setIsSubmittingResume(false);
            setMessages((prev) =>
              prev.filter((msg) => msg.kind !== "thinking"),
            );
          }
          finish(new Error("WebSocket closed before authentication"));
        };

        wsRef.current.onerror = (error) => {
          console.error("[WebSocket] Error:", error);
          if (activeTurnIdRef.current === turnId) {
            activeTurnIdRef.current = null;
            setConfiguredState(false);
            setConnectionPhase("idle");
          }
          finish(new Error("WebSocket connection error"));
        };

        authTimer = setTimeout(() => {
          finish(new Error("Authentication timeout"));
        }, AUTH_TIMEOUT_MS);
      });
    },
    [
      createMessageHandler,
      ensureSession,
      getChatToken,
      getWebSocketUrl,
      setConfiguredState,
    ],
  );

  const connectForFeedbackMode = useCallback(
    async (disableModeOnFail: boolean): Promise<void> => {
      const turnId = generateTurnId();
      console.log("[WebSocket] Starting feedback turn:", turnId);
      activeTurnIdRef.current = turnId;
      setConnectionPhase("connecting");
      setConfiguredState(false);
      setPendingInterrupt(null);
      setIsSubmittingResume(false);
      currentContentRef.current = "";

      try {
        await connectWithAuth(turnId);

        if (
          activeTurnIdRef.current !== turnId ||
          wsRef.current?.readyState !== WebSocket.OPEN
        ) {
          throw new Error("WebSocket not ready for feedback configure");
        }

        const configureMessage: WSConfigureMessage = {
          type: "configure",
          function: "feedback",
        };
        setConnectionPhase("configuring");
        wsRef.current.send(JSON.stringify(configureMessage));
        await waitForConfigured(CONFIGURE_TIMEOUT_MS);
        setConnectionPhase("ready");
      } catch (error) {
        console.error("[WebSocket] Feedback configure failed:", error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "피드백 모드 연결에 실패했어요. 다시 시도해주세요.",
            kind: "error",
          },
        ]);
        if (disableModeOnFail) {
          setFeedbackModeEnabled(false);
        }
        setConnectionPhase("idle");
        setConfiguredState(false);
        setPendingInterrupt(null);
        setIsSubmittingResume(false);
        activeTurnIdRef.current = null;
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        throw new Error("FEEDBACK_CONFIGURE_FAILED");
      }
    },
    [connectWithAuth, setConfiguredState, waitForConfigured],
  );

  // WebSocket 연결 종료
  const disconnect = useCallback(() => {
    activeTurnIdRef.current = null;
    authPromiseRef.current?.reject(new Error("Disconnected"));
    setConfiguredState(false);
    setConnectionPhase("idle");
    setPendingInterrupt(null);
    setSelectedAnchorIds([]);
    setCanvasActionContexts([]);
    setIsSubmittingResume(false);
    setIsGenerating(false);
    currentContentRef.current = "";
    finalizingCanvasIdRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [setConfiguredState]);

  // 언마운트 시 연결 종료
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // 마운트 시 session_id 확보 + 유지된 세션의 이전 대화 이력 1회 복원
  // (실패 시 첫 전송에서 lazy 확보로 폴백)
  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    (async () => {
      try {
        const id = await ensureSession();
        const history = await fetchClient.get<Paginated<Conversation>>(
          `/sessions/${id}/conversations`,
          { size: HISTORY_PAGE_SIZE },
        );
        if (history.items.length === 0) return;
        setMessages(conversationsToMessages(history.items));
      } catch (error) {
        console.error(
          "[Session] Failed to restore conversation history:",
          error,
        );
      }
    })();
  }, [ensureSession, fetchClient]);

  // 새 대화 시작 (새 session_id 발급 + 화면 초기화)
  const startNewSession = useCallback(async () => {
    disconnect();
    hasCanvasSessionRef.current = false;
    setMessages([]);
    canvasesByIdRef.current = {};
    setCanvasesById({});
    setChangedBlockIdsByCanvasId({});
    setActiveCanvasId(null);
    setCanvasActionContexts([]);
    setSubmittedTermsCanvasKey(null);
    currentContentRef.current = "";
    setInputMessage("");
    try {
      await createNewSession();
    } catch (error) {
      console.error("[Session] Failed to start new session:", error);
      setMessages([
        {
          role: "assistant",
          content: "새 대화를 시작하지 못했어요. 잠시 후 다시 시도해주세요.",
          kind: "error",
        },
      ]);
    }
  }, [createNewSession, disconnect]);

  const toggleFeedbackMode = useCallback(async () => {
    if (feedbackModeEnabled) {
      setFeedbackModeEnabled(false);
      disconnect();
      return;
    }

    setFeedbackModeEnabled(true);
    try {
      await connectForFeedbackMode(true);
    } catch {
      // connectForFeedbackMode 내부에서 에러 처리됨
    }
  }, [connectForFeedbackMode, disconnect, feedbackModeEnabled]);

  const sendChatMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isGenerating || isSubmittingResume) {
        return;
      }

      // interrupt 대기 중에는 resume 흐름만 허용한다.
      if (pendingInterrupt) {
        return;
      }

      const userMessage = content.trim();

      // 열려 있는 일반 채팅 turn이 있으면 같은 연결을 재사용한다.
      const reuseOpenConnection =
        !feedbackModeEnabled &&
        activeTurnIdRef.current !== null &&
        wsRef.current?.readyState === WebSocket.OPEN;

      let turnId = activeTurnIdRef.current;

      if (!feedbackModeEnabled && !reuseOpenConnection) {
        turnId = generateTurnId();
        console.log("[WebSocket] Starting new turn:", turnId);
        activeTurnIdRef.current = turnId;
      }

      if (turnId === null) return;

      // 이전 스트리밍 메시지 정리 + 사용자 메시지 추가 + 진행 표시 placeholder
      setMessages((prev) => {
        const cleaned = prev.filter((msg) => !msg.isStreaming);
        return [
          ...cleaned,
          { role: "user", content: userMessage },
          createThinkingMessage(),
        ];
      });

      setPendingInterrupt(null);
      setSelectedAnchorIds([]);
      setIsSubmittingResume(false);
      currentContentRef.current = "";
      setInputMessage("");
      setIsGenerating(true);
      setConnectionPhase("streaming");

      try {
        if (feedbackModeEnabled) {
          if (
            !isConfiguredRef.current ||
            wsRef.current?.readyState !== WebSocket.OPEN
          ) {
            await connectForFeedbackMode(false);
          }

          if (
            !isConfiguredRef.current ||
            wsRef.current?.readyState !== WebSocket.OPEN
          ) {
            throw new Error("Feedback mode is not ready");
          }

          const chatMessage: WSChatMessage = {
            type: "message",
            content: userMessage,
          };
          wsRef.current?.send(JSON.stringify(chatMessage));
        } else {
          if (reuseOpenConnection) {
            console.log("[WebSocket] Reusing open connection, turn:", turnId);
          } else {
            await connectWithAuth(turnId);
          }
          if (
            activeTurnIdRef.current !== turnId ||
            wsRef.current?.readyState !== WebSocket.OPEN
          ) {
            throw new Error("WebSocket not ready");
          }
          const chatMessage: WSChatMessage = {
            type: "message",
            content: userMessage,
          };
          console.log("[WebSocket] Sending message:", chatMessage);
          wsRef.current.send(JSON.stringify(chatMessage));
        }
      } catch (error) {
        console.error("[WebSocket] Connection failed:", error);
        if (
          error instanceof Error &&
          error.message === "FEEDBACK_CONFIGURE_FAILED"
        ) {
          setMessages((prev) => prev.filter((msg) => msg.kind !== "thinking"));
          setIsGenerating(false);
          setConnectionPhase("idle");
          return;
        }

        // 현재 turn의 에러만 처리 (서버 연결 실패)
        if (activeTurnIdRef.current === turnId) {
          setMessages((prev) => [
            ...prev.filter((msg) => msg.kind !== "thinking"),
            {
              role: "assistant",
              content:
                "죄송합니다 케찹이가 깜빡 잠들었어요, 다시 물어봐 주세요!",
              kind: "error",
            },
          ]);
          setIsGenerating(false);
          setConnectionPhase("idle");
          if (!feedbackModeEnabled) {
            activeTurnIdRef.current = null;
          } else {
            setConfiguredState(false);
          }
        }
      }
    },
    [
      connectForFeedbackMode,
      connectWithAuth,
      feedbackModeEnabled,
      isGenerating,
      isSubmittingResume,
      pendingInterrupt,
      setConfiguredState,
    ],
  );

  const sendResume = useCallback(
    (content: string) => {
      if (
        (pendingInterrupt?.type !== "feedback_score" &&
          pendingInterrupt?.type !== "feedback_reason") ||
        isSubmittingResume
      ) {
        return;
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) return;

      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "연결이 끊겨서 피드백을 전송하지 못했어요.",
            kind: "error",
          },
        ]);
        setPendingInterrupt(null);
        setIsSubmittingResume(false);
        setIsGenerating(false);
        setConnectionPhase("idle");
        setConfiguredState(false);
        return;
      }

      setIsSubmittingResume(true);
      const displayContent =
        pendingInterrupt.type === "feedback_score"
          ? `${trimmedContent}점`
          : trimmedContent;
      setMessages((prev) => [
        ...prev,
        { role: "user", content: displayContent },
        createThinkingMessage(),
      ]);

      const resumeMessage: WSResumeMessage = {
        type: "resume",
        content: trimmedContent,
      };
      wsRef.current.send(JSON.stringify(resumeMessage));
      setPendingInterrupt(null);
      setConnectionPhase("streaming");
      setIsGenerating(true);
    },
    [isSubmittingResume, pendingInterrupt, setConfiguredState],
  );

  const sendCanvasResume = useCallback(
    (content: CanvasEditOp, displayContent: string): boolean => {
      if (
        pendingInterrupt?.type !== "awaiting_edit" ||
        isSubmittingResume
      ) {
        console.warn("[CanvasResume] Blocked before send", {
          op: content.op,
          pendingInterruptType: pendingInterrupt?.type ?? null,
          isSubmittingResume,
          readyState: wsRef.current?.readyState ?? null,
        });
        return false;
      }

      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("[CanvasResume] WebSocket is not open", {
          op: content.op,
          readyState: wsRef.current?.readyState ?? null,
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "연결이 끊겨서 캔버스 변경을 전송하지 못했어요.",
            kind: "error",
          },
        ]);
        setPendingInterrupt(null);
        setIsGenerating(false);
        setConnectionPhase("idle");
        return false;
      }

      setIsSubmittingResume(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: displayContent },
        createThinkingMessage(),
      ]);
      const resumeMessage: WSResumeMessage = { type: "resume", content };
      console.dir({ direction: "outgoing", payload: resumeMessage });
      wsRef.current.send(JSON.stringify(resumeMessage));
      setPendingInterrupt(null);
      setCanvasActionContexts([]);
      setInputMessage("");
      setConnectionPhase("streaming");
      setIsGenerating(true);
      return true;
    },
    [isSubmittingResume, pendingInterrupt],
  );

  // 참고 문서 후보 선택/해제 토글
  const toggleAnchorCandidate = useCallback((documentId: string) => {
    setSelectedAnchorIds((prev) =>
      prev.includes(documentId)
        ? prev.filter((id) => id !== documentId)
        : [...prev, documentId],
    );
  }, []);

  // anchor 선택 결과를 resume으로 전송
  const submitAnchorChoice = useCallback(
    (action: AnchorChoiceAction) => {
      if (
        pendingInterrupt?.type !== "awaiting_anchor_choice" ||
        isSubmittingResume
      ) {
        return;
      }
      // skip이 아니면 최소 1개는 선택되어 있어야 한다
      if (action !== "skip" && selectedAnchorIds.length === 0) return;

      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "연결이 끊겨서 문서 선택을 전송하지 못했어요.",
            kind: "error",
          },
        ]);
        setPendingInterrupt(null);
        setSelectedAnchorIds([]);
        setIsSubmittingResume(false);
        setIsGenerating(false);
        setConnectionPhase("idle");
        setConfiguredState(false);
        return;
      }

      setIsSubmittingResume(true);

      const skip = action === "skip";
      const documentIds = skip ? [] : selectedAnchorIds;
      const resumeMessage: WSResumeMessage = {
        type: "resume",
        content: {
          document_ids: documentIds,
          skip,
          anchor_only: action === "anchor_only",
        },
      };

      // 선택 결과를 사용자 메시지로 채팅창에 표시
      const candidateNameById = new Map(
        pendingInterrupt.candidates.map((candidate) => [
          candidate.document_id,
          candidate.name,
        ]),
      );
      const selectedNames = documentIds
        .map((id) => candidateNameById.get(id) ?? id)
        .join(", ");
      const displayContent = (() => {
        if (skip) return "문서 참고 없이 진행할게요.";
        if (action === "anchor_only")
          return `이 문서에서만 참고할게요: ${selectedNames}`;
        return `참고 문서 선택: ${selectedNames}`;
      })();
      setMessages((prev) => [
        ...prev,
        { role: "user", content: displayContent },
        createThinkingMessage(),
      ]);

      wsRef.current.send(JSON.stringify(resumeMessage));
      setPendingInterrupt(null);
      setSelectedAnchorIds([]);
      setConnectionPhase("streaming");
      setIsGenerating(true);
    },
    [
      isSubmittingResume,
      pendingInterrupt,
      selectedAnchorIds,
      setConfiguredState,
    ],
  );

  // 메시지 전송
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isGenerating || isSubmittingResume) {
      return;
    }

    const userMessage = inputMessage.trim();
    if (!userMessage) return;

    // 버튼 UI로만 응답하는 interrupt 대기 중에는 텍스트 전송 차단
    if (
      pendingInterrupt?.type === "feedback_score" ||
      pendingInterrupt?.type === "awaiting_anchor_choice"
    ) {
      return;
    }

    if (pendingInterrupt?.type === "feedback_reason") {
      setInputMessage("");
      sendResume(userMessage);
      return;
    }

    if (pendingInterrupt?.type === "awaiting_edit") {
      sendCanvasResume(
        getCanvasFeedbackEditCommand(canvasActionContexts, userMessage),
        userMessage,
      );
      return;
    }
    await sendChatMessage(userMessage);
  };

  const openCanvas = useCallback((canvasId: string) => {
    setActiveCanvasId((prev) => {
      if (canvasesById[canvasId]) return canvasId;
      return prev;
    });
  }, [canvasesById]);

  const removeCanvasActionContext = useCallback((target: CanvasActionContext) => {
    setCanvasActionContexts((contexts) =>
      contexts.filter(
        (context) => getCanvasActionKey(context) !== getCanvasActionKey(target),
      ),
    );
  }, []);

  const startEditBlock = useCallback(
    (section: ContractSection, block: ContractBlock) => {
      if (!canvasData) return;
      setCanvasActionContexts((contexts) =>
        contexts.some(
          (context) => context.op === "edit" && context.block_id === block.block_id,
        )
          ? contexts
          : [
              ...contexts,
              {
                op: "edit",
                block_id: block.block_id,
                label: getBlockActionLabel(section, block),
              },
            ],
      );
    },
    [canvasData],
  );

  const startAddBlockAfter = useCallback(
    (section: ContractSection, block: ContractBlock) => {
      if (!canvasData) return;
      setCanvasActionContexts((contexts) =>
        contexts.some(
          (context) =>
            context.op === "add" && context.after_block_id === block.block_id,
        )
          ? contexts
          : [
              ...contexts,
              {
                op: "add",
                section_id: section.section_id,
                after_block_id: block.block_id,
                label: getBlockActionLabel(section, block),
              },
            ],
      );
    },
    [canvasData],
  );

  const deleteBlock = useCallback(
    (section: ContractSection, block: ContractBlock) => {
      if (!canvasData) return;
      const label = getBlockActionLabel(section, block);
      sendCanvasResume(
        { op: "delete", block_id: block.block_id },
        `블록 삭제 요청: ${label}`,
      );
    },
    [canvasData, sendCanvasResume],
  );

  const submitMissingTerms = useCallback(
    (terms: CanvasTermValue[]): boolean => {
      if (!canvasData || terms.length === 0) return false;
      const displayContent = [
        "미정 항목 입력:",
        ...terms.map((term) => `${term.label}: ${term.value}`),
      ].join("\n");
      const sent = sendCanvasResume(
        {
          op: "set_terms",
          terms: terms.map(({ label, value }) => ({ label, value })),
        },
        displayContent,
      );
      if (sent) {
        setSubmittedTermsCanvasKey(
          `${canvasData.canvas_id}:${canvasData.version_id}`,
        );
      }
      return sent;
    },
    [canvasData, sendCanvasResume],
  );

  const changeCanvasVersion = useCallback(
    (op: "undo" | "redo"): boolean =>
      sendCanvasResume({ op }, op === "undo" ? "되돌리기" : "다시 실행"),
    [sendCanvasResume],
  );

  const finalizeCanvas = useCallback((): boolean => {
    if (!canvasData || canvasData.status.toLowerCase() === "finalized") {
      return false;
    }
    finalizingCanvasIdRef.current = canvasData.canvas_id;
    const sent = sendCanvasResume({ op: "finalize" }, "문서 확정");
    if (!sent) finalizingCanvasIdRef.current = null;
    return sent;
  }, [canvasData, sendCanvasResume]);

  // 안전한 생성 중지 (turn 무효화 후 WebSocket 연결 종료)
  const stopGenerating = useCallback(() => {
    // 1. 먼저 turn 무효화 - 이후 도착하는 메시지는 무시됨
    console.log("[WebSocket] Stopping generation, invalidating turn");
    activeTurnIdRef.current = null;
    authPromiseRef.current?.reject(new Error("Generation stopped"));

    // 2. thinking placeholder 제거 + 스트리밍 중인 메시지가 있으면 중단 표시
    setMessages((prev) => {
      const withoutThinking = prev.filter((msg) => msg.kind !== "thinking");
      const lastMsg = withoutThinking[withoutThinking.length - 1];
      if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
        return [
          ...withoutThinking.slice(0, -1),
          {
            ...lastMsg,
            isStreaming: false,
          },
        ];
      }
      return withoutThinking;
    });

    // 3. 상태 초기화
    currentContentRef.current = "";
    finalizingCanvasIdRef.current = null;
    setIsGenerating(false);
    setPendingInterrupt(null);
    setSelectedAnchorIds([]);
    setIsSubmittingResume(false);
    setConfiguredState(false);
    setConnectionPhase("idle");

    // 4. WebSocket 연결 종료
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [setConfiguredState]);

  const closeCanvas = useCallback(() => {
    setActiveCanvasId(null);
    setCanvasActionContexts([]);
  }, []);

  return {
    messages,
    inputMessage,
    isGenerating,
    feedbackModeEnabled,
    isConfigured,
    connectionPhase,
    pendingInterrupt,
    isSubmittingResume,
    sessionId,
    canvasData,
    canvasActionContexts,
    changedBlockIds,
    selectedAnchorIds,
    showMissingTermsForm,
    setInputMessage,
    handleSubmit,
    toggleFeedbackMode,
    sendResume,
    toggleAnchorCandidate,
    submitAnchorChoice,
    openCanvas,
    removeCanvasActionContext,
    startEditBlock,
    startAddBlockAfter,
    deleteBlock,
    submitMissingTerms,
    changeCanvasVersion,
    finalizeCanvas,
    stopGenerating,
    startNewSession,
    closeCanvas,
  };
};
