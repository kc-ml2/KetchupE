import { Fragment } from "react";
import { LuThumbsDown, LuThumbsUp } from "react-icons/lu";
import type { AppliedContext, CitationSummary, InteractionKind, MemoryKind, MessageRecord } from "@app-types/Agent.types";

const CITATION = /\[\[(e\d+)\]\]/g;

/** Renders [[eN]] markers as clickable chips that open the original document location. */
export const CitedText = ({ text, runId, onOpenCitation }: { text: string; runId: string | null; onOpenCitation: (runId: string, evidenceId: string) => void }): React.JSX.Element => {
  const parts = text.split(CITATION);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <button
            key={index}
            type="button"
            disabled={!runId}
            onClick={() => runId && onOpenCitation(runId, part)}
            className="inline-flex items-center mx-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[#E6F0FF] text-[#0066FF] dark:bg-[#1E293B] align-middle"
            title="원본 위치 열기"
          >
            {part}
          </button>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
};

const MEMORY_KIND_LABEL: Record<MemoryKind, string> = { preference: "응답 선호", fact: "업무·사용자 정보", task: "작업" };

const ContextSources = ({ citations, appliedContext, runId, onOpenCitation }: { citations: CitationSummary[]; appliedContext: AppliedContext; runId: string | null; onOpenCitation: (runId: string, evidenceId: string) => void }): React.JSX.Element | null => {
  if (!citations.length && !appliedContext.workspaceInstruction && !appliedContext.memories.length) return null;
  return (
    <div className="mt-3 pt-2 border-t border-[#D4D4D8] dark:border-[#3F3F46]">
      <div className="mb-2 text-[11px] font-semibold text-[#71717A]">사용한 컨텍스트</div>
      {citations.length > 0 && (
        <div className="mb-2 flex flex-col items-start gap-1">
          <span className="text-[11px] text-[#71717A]">참고 문서</span>
          {citations.map((citation) => (
            <button
              key={citation.evidenceId}
              type="button"
              disabled={!runId}
              onClick={() => runId && onOpenCitation(runId, citation.evidenceId)}
              className="text-left text-xs text-[#0066FF] hover:underline disabled:text-[#71717A]"
            >
              [{citation.evidenceId}] {citation.title || "제목 없는 문서"}{citation.page !== undefined ? ` · ${citation.page}쪽` : ""}
            </button>
          ))}
        </div>
      )}
      {appliedContext.workspaceInstruction && (
        <div className="mb-2 text-xs text-[#52525B] dark:text-[#A1A1AA]">
          <span className="block text-[11px] text-[#71717A]">작업 공간 지침</span>
          {appliedContext.workspaceInstruction}
        </div>
      )}
      {appliedContext.memories.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-[#52525B] dark:text-[#A1A1AA]">
          <span className="text-[11px] text-[#71717A]">기억</span>
          {appliedContext.memories.map((memory) => <span key={memory.id}>· {memory.content} <span className="text-[10px] text-[#A1A1AA]">({MEMORY_KIND_LABEL[memory.kind]})</span></span>)}
        </div>
      )}
    </div>
  );
};

type Props = {
  messages: MessageRecord[];
  streamingText: string;
  streamingRunId: string | null;
  streamingCitations: CitationSummary[];
  streamingAppliedContext: AppliedContext;
  progressText: string | null;
  hasMore: boolean;
  onLoadOlder: () => void;
  onOpenCitation: (runId: string, evidenceId: string) => void;
  onInteraction: (runId: string, kind: InteractionKind) => void;
};

const AgentMessages = ({ messages, streamingText, streamingRunId, streamingCitations, streamingAppliedContext, progressText, hasMore, onLoadOlder, onOpenCitation, onInteraction }: Props): React.JSX.Element => (
  <div className="flex flex-col gap-3">
    {hasMore && (
      <button type="button" onClick={onLoadOlder} className="self-center text-xs text-[#0066FF] hover:underline">
        이전 대화 더 보기
      </button>
    )}
    {messages.map((message) => (
      <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${message.role === "user" ? "bg-[#0066FF] text-white" : "bg-[#F4F4F5] dark:bg-[#1F1F1F] text-[#18181B] dark:text-[#FAFAFA]"}`}>
          {message.role === "assistant" ? <CitedText text={message.content} runId={message.runId} onOpenCitation={onOpenCitation} /> : message.content}
          {message.role === "assistant" && <ContextSources citations={message.citations} appliedContext={message.appliedContext} runId={message.runId} onOpenCitation={onOpenCitation} />}
          {message.role === "assistant" && message.runId && (
            <div className="flex items-center gap-2 mt-2 text-[#71717A]">
              <button type="button" title="도움됨" onClick={() => onInteraction(message.runId as string, "accepted")} className="hover:text-[#0066FF]"><LuThumbsUp className="w-3.5 h-3.5" /></button>
              <button type="button" title="틀렸거나 수정 필요" onClick={() => onInteraction(message.runId as string, "corrected")} className="hover:text-[#DC2626]"><LuThumbsDown className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      </div>
    ))}
    {streamingText && (
      <div className="flex justify-start">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed bg-[#F4F4F5] dark:bg-[#1F1F1F] text-[#18181B] dark:text-[#FAFAFA]">
          <CitedText text={streamingText} runId={streamingRunId} onOpenCitation={onOpenCitation} />
          <ContextSources citations={streamingCitations} appliedContext={streamingAppliedContext} runId={streamingRunId} onOpenCitation={onOpenCitation} />
        </div>
      </div>
    )}
    {!streamingText && progressText && (
      <div className="flex justify-start">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm bg-[#F4F4F5] dark:bg-[#1F1F1F] text-[#71717A] animate-pulse">
          {progressText}
        </div>
      </div>
    )}
  </div>
);

export default AgentMessages;
