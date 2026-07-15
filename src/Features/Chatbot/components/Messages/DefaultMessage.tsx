import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface DefaultMessageProps {
  content: string;
  showCopy?: boolean;
}

// **text**한글 패턴에서 word boundary 문제 해결
const preprocessMarkdown = (text: string): string => {
  // **text** 뒤에 바로 한글이 오면 zero-width space 추가
  return text.replace(/\*\*([^*]+)\*\*([가-힣])/g, "**$1**\u200B$2");
};

const DefaultMessage = ({ content, showCopy = true }: DefaultMessageProps): React.JSX.Element => {
  const [isCopied, setIsCopied] = useState(false);
  // content가 런타임에 null/undefined로 들어와도 크래시하지 않도록 방어
  const processedContent = preprocessMarkdown(content ?? "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      alert("메신저에서는 사용할 수 없는 기능입니다. https://chatbot.kct.co.kr 링크에서 챗봇을 사용해 주세요");
    }
  };

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        // singleTilde: false → `~` 한 개는 취소선(Strikethrough)으로 처리하지 않음
        // (예: "성수기(7~8월)"의 `~`가 취소선으로 묶이는 문제 방지)
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // 단락
          p: ({ ...props }) => (
            <p className="leading-relaxed mb-2 last:mb-0" {...props} />
          ),
          // 리스트
          ol: ({ ...props }) => (
            <ol className="list-decimal leading-relaxed pl-5 my-2" {...props} />
          ),
          ul: ({ ...props }) => (
            <ul className="list-disc leading-relaxed pl-5 my-2" {...props} />
          ),
          li: ({ ...props }) => (
            <li className="leading-relaxed py-0.5" {...props} />
          ),
          // 제목
          h1: ({ ...props }) => (
            <h1 className="text-xl font-bold mt-4 mb-2" {...props} />
          ),
          h2: ({ ...props }) => (
            <h2 className="text-lg font-bold mt-3 mb-2" {...props} />
          ),
          h3: ({ ...props }) => (
            <h3 className="text-base font-semibold mt-3 mb-1" {...props} />
          ),
          h4: ({ ...props }) => (
            <h4 className="text-sm font-semibold mt-2 mb-1" {...props} />
          ),
          // 코드
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");

            // 코드 블록 (언어 지정된 경우)
            if (match) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: "0.5rem",
                    fontSize: "0.875rem",
                  }}
                >
                  {codeString}
                </SyntaxHighlighter>
              );
            }

            // 코드 블록 (언어 미지정) - className이 있으면 코드 블록
            if (className) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language="text"
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: "0.5rem",
                    fontSize: "0.875rem",
                  }}
                >
                  {codeString}
                </SyntaxHighlighter>
              );
            }

            // 인라인 코드
            return (
              <code
                className="bg-gray-100 dark:bg-[#2A2A2A] text-blue-800 dark:text-blue-200 px-1.5 py-0.5 rounded text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <div className="my-3 overflow-x-auto">{children}</div>
          ),
          // 링크
          a: ({ ...props }) => (
            <a
              className="text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 underline"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          // 인용구
          blockquote: ({ ...props }) => (
            <blockquote
              className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-3 italic text-gray-600 dark:text-gray-300"
              {...props}
            />
          ),
          // 수평선
          hr: ({ ...props }) => (
            <hr className="my-4 border-gray-300" {...props} />
          ),
          // 강조
          strong: ({ ...props }) => (
            <strong className="font-semibold" {...props} />
          ),
          em: ({ ...props }) => <em className="italic" {...props} />,
          // 테이블
          table: ({ ...props }) => (
            <div className="overflow-x-auto my-3">
              <table
                className="min-w-full border-collapse border border-gray-300 dark:border-gray-600"
                {...props}
              />
            </div>
          ),
          thead: ({ ...props }) => (
            <thead className="bg-gray-100 dark:bg-[#2A2A2A]" {...props} />
          ),
          th: ({ ...props }) => (
            <th
              className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-semibold text-sm"
              {...props}
            />
          ),
          td: ({ ...props }) => (
            <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" {...props} />
          ),
          tr: ({ ...props }) => (
            <tr className="even:bg-gray-50 dark:even:bg-[#1F1F1F]" {...props} />
          ),
          // 이미지
          img: ({ ...props }) => (
            <img className="max-w-full h-auto rounded my-2" {...props} />
          ),
        }}
      >
        {processedContent}
      </ReactMarkdown>
      {showCopy && (
        <div className="mt-4 flex justify-start">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 pl-0 pr-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#2A2A2A] rounded transition-colors"
          >
            {isCopied ? (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                복사됨
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
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
                복사
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default DefaultMessage;
