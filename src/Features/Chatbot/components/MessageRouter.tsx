import { useState } from "react";
import ragIcon from "@images/rag.png";
import AnswerMessage from "./Messages/AnswerMessage";
import ErrorMessage from "./Messages/ErrorMessage";
import ThinkingMessage from "./Messages/ThinkingMessage";
import DefaultMessage from "./Messages/DefaultMessage";
import RetrieveMessage from "./Messages/RetrieveMessage";
import { Message, RetrieveDocument } from "@app-types/Chatbot.types";

interface MessageRouterProps {
  msg: Message;
  index: number;
  retrieveDocs?: RetrieveDocument[];
  onOpenCanvas?: (canvasId: string) => void;
}

const MessageRouter = ({
  msg,
  retrieveDocs,
  onOpenCanvas,
}: MessageRouterProps) => {
  const isAssistant = msg.role === "assistant";
  const kind = msg.kind;
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      alert(
        "메신저에서는 사용할 수 없는 기능입니다. https://chatbot.kct.co.kr 링크에서 챗봇을 사용해 주세요",
      );
    }
  };

  // 사용자 메시지
  if (!isAssistant) {
    return (
      <div className="flex flex-col mb-3 items-end">
        <div className="flex items-end justify-end gap-0 w-full">
          <button
            onClick={handleCopy}
            title="복사"
            className="flex items-center justify-center w-5 h-5 mb-0.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded leading-none transition-colors"
          >
            {isCopied ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
          <div className="px-3 py-2 rounded-xl leading-relaxed bg-[#0066FF] text-white max-w-[85%]">
            <DefaultMessage content={msg.content} showCopy={false} />
          </div>
        </div>
      </div>
    );
  }

  // Thinking 메세지 (회색 배경)
  if (kind === "thinking") {
    return (
      <div className="flex flex-col mb-2 items-start">
        <div className="flex items-start flex-row">
          <img src={ragIcon} alt="Assistant" className="w-7 h-7 object-cover" />
          <div className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-[#262626] text-sm text-gray-900 dark:text-[#FAFAFA]">
            <ThinkingMessage content={msg.content} />
          </div>
        </div>
      </div>
    );
  }

  // Retrieve 메세지 (.)
  if (kind === "retrieve") {
    return null;
  }

  // Error 메시지 (빨간색 테두리)
  if (kind === "error") {
    return (
      <div className="flex flex-col mb-3 items-start">
        <div className="flex items-start flex-row">
          <img src={ragIcon} alt="Assistant" className="w-7 h-7 object-cover" />
          <div className="px-4 py-2 rounded-2xl leading-tight bg-[#FFF6F7] dark:bg-[#3A1F26]/70 border border-[#F1D4DA] dark:border-[#6B3A46] rounded-br-md mr-12 max-w-[85%]">
            <ErrorMessage content={msg.content} meta={msg.meta} />
          </div>
        </div>
      </div>
    );
  }

  // Answer 메시지 (기본)
  return (
    <div className="flex flex-col mb-3 items-start">
      <div className="flex items-start flex-row">
        <img src={ragIcon} alt="Assistant" className="w-7 h-7 object-cover" />
        <div className="px-4 py-2 rounded-2xl leading-tight text-gray-900 dark:text-[#FAFAFA] rounded-br-md mr-12 max-w-[85%]">
          <AnswerMessage
            content={msg.content}
            meta={msg.meta}
            retrieveDocs={retrieveDocs}
            showCopy={!msg.isInterruptPrompt}
          />
          {msg.canvasRef && (
            <button
              type="button"
              onClick={() => onOpenCanvas?.(msg.canvasRef!.canvas_id)}
              className="mt-3 inline-flex items-center rounded-lg border border-[#0066FF] px-3 py-1.5 text-xs font-semibold text-[#0066FF] transition-colors hover:bg-[#0066FF] hover:text-white"
            >
              {msg.canvasRef.title} 열기
            </button>
          )}
          {!msg.isInterruptPrompt && retrieveDocs && retrieveDocs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <RetrieveMessage documents={retrieveDocs} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageRouter;
