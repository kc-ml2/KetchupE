import { useMemo } from "react";
import { LuCopy } from "react-icons/lu";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { AppliedContext, CitationSummary, MemoryKind, MessageRecord } from "@app-types/Agent.types";

const CITATION = /\[\[(e\d+)\]\]/g;
const CITE_HREF = "#cite-";

/** `[[e1]]` → `[e1](#cite-e1)` so the markdown renderer hands it to the link component as a chip. */
const withCitationLinks = (text: string): string => text.replace(CITATION, `[$1](${CITE_HREF}$1)`);

const chip = "inline-flex items-center mx-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[#E6F0FF] text-[#0066FF] dark:bg-[#1E293B] align-middle";
const border = "border-[#D4D4D8] dark:border-[#3F3F46]";
const codeBg = "bg-black/5 dark:bg-white/10";

const buildComponents = (runId: string | null, onOpenCitation: (runId: string, evidenceId: string) => void): Components => ({
  a: ({ href, children }) => {
    const evidenceId = href?.startsWith(CITE_HREF) ? href.slice(CITE_HREF.length) : null;
    if (evidenceId) {
      return (
        <button type="button" disabled={!runId} onClick={() => runId && onOpenCitation(runId, evidenceId)} className={chip} title="원본 위치 열기">
          {evidenceId}
        </button>
      );
    }
    return <a href={href} target="_blank" rel="noreferrer noopener" className="text-[#0066FF] underline">{children}</a>;
  },
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 mt-1 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-1 text-[15px] font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-1 text-sm font-semibold first:mt-0">{children}</h3>,
  // A fenced block keeps react-markdown's language class; inline code gets the pill styling.
  code: ({ className, children }) => (className ? <code className={className}>{children}</code> : <code className={`rounded px-1 py-0.5 text-[13px] ${codeBg}`}>{children}</code>),
  pre: ({ children }) => <pre className={`mb-2 overflow-x-auto rounded-lg p-3 text-[13px] last:mb-0 ${codeBg}`}>{children}</pre>,
  blockquote: ({ children }) => <blockquote className={`mb-2 border-l-2 pl-3 text-[#52525B] last:mb-0 dark:text-[#A1A1AA] ${border}`}>{children}</blockquote>,
  table: ({ children }) => <div className="mb-2 overflow-x-auto last:mb-0"><table className="w-full border-collapse text-[13px]">{children}</table></div>,
  th: ({ children }) => <th className={`border px-2 py-1 text-left font-semibold ${border}`}>{children}</th>,
  td: ({ children }) => <td className={`border px-2 py-1 ${border}`}>{children}</td>,
  hr: () => <hr className={`my-3 ${border}`} />,
});

/** Assistant answers are markdown; `[[eN]]` markers render as chips that open the original document. */
export const MessageBody = ({ text, runId, onOpenCitation }: { text: string; runId: string | null; onOpenCitation: (runId: string, evidenceId: string) => void }): React.JSX.Element => {
  const components = useMemo(() => buildComponents(runId, onOpenCitation), [runId, onOpenCitation]);
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {withCitationLinks(text)}
      </ReactMarkdown>
    </div>
  );
};

const MEMORY_KIND_LABEL: Record<MemoryKind, string> = { preference: "응답 방식", fact: "업무 정보", task: "작업" };

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
          <span className="block text-[11px] text-[#71717A]">저장된 컨텍스트</span>
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
};

const AgentMessages = ({ messages, streamingText, streamingRunId, streamingCitations, streamingAppliedContext, progressText, hasMore, onLoadOlder, onOpenCitation }: Props): React.JSX.Element => (
  <div className="flex flex-col gap-3">
    {hasMore && (
      <button type="button" onClick={onLoadOlder} className="self-center text-xs text-[#0066FF] hover:underline">
        이전 대화 더 보기
      </button>
    )}
    {messages.map((message) => (
      <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${message.role === "user" ? "whitespace-pre-wrap bg-[#0066FF] text-white" : "bg-[#F4F4F5] dark:bg-[#1F1F1F] text-[#18181B] dark:text-[#FAFAFA]"}`}>
          {message.role === "assistant" ? <MessageBody text={message.content} runId={message.runId} onOpenCitation={onOpenCitation} /> : message.content}
          {message.role === "assistant" && <ContextSources citations={message.citations} appliedContext={message.appliedContext} runId={message.runId} onOpenCitation={onOpenCitation} />}
          {message.role === "assistant" && (
            <div className="flex items-center gap-2 mt-2 text-[#71717A]">
              <button type="button" title="답변 복사" aria-label="답변 복사" onClick={() => void navigator.clipboard.writeText(message.content)} className="hover:text-[#0066FF]"><LuCopy className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      </div>
    ))}
    {streamingText && (
      <div className="flex justify-start">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed bg-[#F4F4F5] dark:bg-[#1F1F1F] text-[#18181B] dark:text-[#FAFAFA]">
          <MessageBody text={streamingText} runId={streamingRunId} onOpenCitation={onOpenCitation} />
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
