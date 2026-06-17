import DefaultMessage from "./DefaultMessage";
import { MessageMeta, RetrieveDocument } from "@app-types/Chatbot.types";
import { getPathLeafName } from "@lib/pathDisplay";

interface AnswerMessageProps {
  content: string;
  meta?: MessageMeta;
  retrieveDocs?: RetrieveDocument[];
  showCopy?: boolean;
}

const AnswerMessage = ({
  content,
  meta,
  retrieveDocs,
  showCopy = true,
}: AnswerMessageProps): React.JSX.Element => {
  // [doc_xxx] 참조를 문서 이름으로 치환
  const resolvedContent = (() => {
    if (!retrieveDocs || retrieveDocs.length === 0) return content;

    const docMap = new Map(
      retrieveDocs.map((doc) => [
        doc.document_id,
        getPathLeafName(doc.document_name),
      ]),
    );

    return content.replace(/\[([^\]]+)\]/g, (match, docId: string) => {
      const docName = docMap.get(docId);
      return docName ? `**[${docName}]**` : match;
    });
  })();

  return (
    <div>
      <DefaultMessage content={resolvedContent} showCopy={showCopy} />

      {/* 추가 정보 */}
      {meta?.contents && meta.contents.length > 0 && (
        <div className="pt-1 border-t border-gray-200">
          <div className="text-xs text-gray-500 mb-2">참조 문서</div>
          <div className="flex flex-wrap gap-2">
            {meta.contents.map((item: string, idx: number) => (
              <span
                key={idx}
                className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded border border-blue-200"
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

export default AnswerMessage;
