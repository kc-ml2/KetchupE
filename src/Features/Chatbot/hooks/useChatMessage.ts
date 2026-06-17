import { useState, useRef, useCallback, useEffect, useContext } from "react";
import { config } from "@config/index";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import {
  ChatMessagesHook,
  ConnectionPhase,
  FeedbackInterruptContent,
  Message,
  WSAuthMessage,
  WSChatMessage,
  WSConfigureMessage,
  WSIncomingMessage,
  WSResumeMessage,
} from "@app-types/Chatbot.types";
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

// 대화 이력(시간순) → 화면 메시지로 변환 (한 턴 = 사용자 질문 + 어시스턴트 답변)
const conversationsToMessages = (items: Conversation[]): Message[] =>
  items.flatMap((conversation) => [
    { role: "user" as const, content: conversation.question },
    {
      role: "assistant" as const,
      content: conversation.answer,
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
    useState<FeedbackInterruptContent | null>(null);
  const [isSubmittingResume, setIsSubmittingResume] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
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

            case "thinking": {
              setConnectionPhase("streaming");
              setIsGenerating(true);
              setPendingInterrupt(null);

              setMessages((prev) => {
                const filtered = prev.filter((msg) => msg.kind !== "thinking");
                return [
                  ...filtered,
                  {
                    role: "assistant",
                    content: "",
                    kind: "thinking",
                    isStreaming: true,
                  },
                ];
              });
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

            case "interrupt": {
              setPendingInterrupt(data.content);
              setIsGenerating(false);
              setIsSubmittingResume(false);
              setConnectionPhase("waiting_interrupt");
              currentContentRef.current = "";
              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
                  return [
                    ...prev.slice(0, -1),
                    { ...lastMsg, isStreaming: false },
                  ];
                }
                return prev;
              });
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: getInterruptPromptMessage(data.content.type),
                  kind: "answer",
                  isInterruptPrompt: true,
                },
              ]);
              break;
            }

            case "complete": {
              const finalContent = currentContentRef.current;

              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
                  return [
                    ...prev.slice(0, -1),
                    { ...lastMsg, content: finalContent, isStreaming: false },
                  ];
                }
                return prev;
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

            case "error": {
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

  const connectAndSend = useCallback(
    async (userMessage: string, turnId: number): Promise<void> => {
      await connectWithAuth(turnId);
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
      wsRef.current.send(JSON.stringify(chatMessage));
    },
    [connectWithAuth],
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
    setIsSubmittingResume(false);
    setIsGenerating(false);
    currentContentRef.current = "";
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
    setMessages([]);
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

  const sendResume = useCallback(
    (content: string) => {
      if (!pendingInterrupt || isSubmittingResume) return;

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

  // 메시지 전송
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isGenerating || isSubmittingResume) {
      return;
    }

    const userMessage = inputMessage.trim();
    if (!userMessage) return;

    if (pendingInterrupt?.type === "feedback_score") {
      return;
    }

    if (pendingInterrupt?.type === "feedback_reason") {
      setInputMessage("");
      sendResume(userMessage);
      return;
    }

    // 새 turn 시작
    let turnId = activeTurnIdRef.current;

    if (!feedbackModeEnabled) {
      turnId = generateTurnId();
      console.log("[WebSocket] Starting new turn:", turnId);
      activeTurnIdRef.current = turnId;
    }

    if (turnId === null) return;

    // 이전 스트리밍 메시지 정리 + 사용자 메시지 추가
    setMessages((prev) => {
      // 이전 turn에서 스트리밍 중이던 메시지 제거
      const cleaned = prev.filter((msg) => !msg.isStreaming);
      return [...cleaned, { role: "user", content: userMessage }];
    });

    setPendingInterrupt(null);
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
        await connectAndSend(userMessage, turnId);
      }
    } catch (error) {
      console.error("[WebSocket] Connection failed:", error);
      if (
        error instanceof Error &&
        error.message === "FEEDBACK_CONFIGURE_FAILED"
      ) {
        setIsGenerating(false);
        setConnectionPhase("idle");
        return;
      }

      // 현재 turn의 에러만 처리 (서버 연결 실패)
      if (activeTurnIdRef.current === turnId) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "죄송합니다 케찹이가 깜빡 잠들었어요, 다시 물어봐 주세요!",
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
  };

  // 안전한 생성 중지 (turn 무효화 후 WebSocket 연결 종료)
  const stopGenerating = useCallback(() => {
    // 1. 먼저 turn 무효화 - 이후 도착하는 메시지는 무시됨
    console.log("[WebSocket] Stopping generation, invalidating turn");
    activeTurnIdRef.current = null;
    authPromiseRef.current?.reject(new Error("Generation stopped"));

    // 2. 스트리밍 중인 메시지가 있으면 중단 표시
    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
        return [
          ...prev.slice(0, -1),
          {
            ...lastMsg,
            isStreaming: false,
          },
        ];
      }
      return prev;
    });

    // 3. 상태 초기화
    currentContentRef.current = "";
    setIsGenerating(false);
    setPendingInterrupt(null);
    setIsSubmittingResume(false);
    setConfiguredState(false);
    setConnectionPhase("idle");

    // 4. WebSocket 연결 종료
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [setConfiguredState]);

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
    setInputMessage,
    handleSubmit,
    toggleFeedbackMode,
    sendResume,
    stopGenerating,
    startNewSession,
  };
};
