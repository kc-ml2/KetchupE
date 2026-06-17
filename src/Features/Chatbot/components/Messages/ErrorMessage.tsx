import DefaultMessage from "./DefaultMessage";
import { MessageMeta } from "@app-types/Chatbot.types";

interface ErrorMessageProps {
  content: string;
  meta?: MessageMeta;
}

const ErrorMessage = ({
  content,
  meta,
}: ErrorMessageProps): React.JSX.Element => {
  return (
    <div className="text-[#7A2732] dark:text-[#FFD9E0]">
      <div className="flex items-start gap-2">
        <span className="mt-1 text-[#B05566] dark:text-[#F0B7C2]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <DefaultMessage content={content} showCopy={false} />
        </div>
      </div>

      {meta?.contents && meta.contents.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#EBC5CD] dark:border-[#6B3A46]">
          <div className="text-xs text-[#B05566] dark:text-[#F0B7C2] mb-2">
            관련 정보
          </div>
          <div className="flex flex-wrap gap-2">
            {meta.contents.map((item: string, idx: number) => (
              <span
                key={idx}
                className="px-2 py-1 text-xs bg-[#FFECEF] dark:bg-[#5A2F39]/50 text-[#9A3D4D] dark:text-[#FFD9E0] rounded border border-[#F1D4DA] dark:border-[#7A4451]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrorMessage;
