import { useEffect, useMemo, useState } from "react";
import { isMobile as isMobileDevice } from "react-device-detect";
import { RetrieveDocument } from "@app-types/Chatbot.types";
import { getPathLeafName } from "@lib/pathDisplay";
import DefaultMessage from "./DefaultMessage";

const RETRIEVE_PANEL_OPEN_CLASS = "retrieve-panel-open";

interface RetrieveMessageProps {
  documents?: RetrieveDocument[];
}

interface GroupedItem {
  source: string;
  filePath: string;
  contents: string[];
}

const RetrieveMessage = ({
  documents,
}: RetrieveMessageProps): React.JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const handleOpenFile = async (filePath: string) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      setAlertMessage("PC앱(🍅공개 예정)에서만 파일 열람 기능이 가능합니다.");
      return;
    }

    const result = await electronAPI.openFileByRelativePath(filePath);
    if (!result.success) {
      setAlertMessage("현재 PC에 해당 파일이 존재하지 않습니다.");
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    if (isMobileDevice) {
      document.body.classList.remove(RETRIEVE_PANEL_OPEN_CLASS);
      document.body.style.overflow = "hidden";
    } else {
      document.body.classList.add(RETRIEVE_PANEL_OPEN_CLASS);
      document.body.style.overflow = previousOverflow;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove(RETRIEVE_PANEL_OPEN_CLASS);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const groupedItems = useMemo<GroupedItem[]>(() => {
    if (!documents || documents.length === 0) return [];

    const groupMap = new Map<
      string,
      { source: string; filePath: string; contents: string[] }
    >();

    documents.forEach((doc) => {
      const groupKey = doc.file_path || doc.document_id || doc.document_name;
      const existing = groupMap.get(groupKey);
      if (existing) {
        existing.contents.push(doc.content);
      } else {
        groupMap.set(groupKey, {
          source: getPathLeafName(doc.document_name || doc.file_path),
          filePath: doc.file_path,
          contents: [doc.content],
        });
      }
    });

    return Array.from(groupMap.values()).map(
      ({ source, filePath, contents }) => ({
        source,
        filePath,
        contents,
      }),
    );
  }, [documents]);

  if (groupedItems.length === 0) {
    return (
      <div className="text-gray-600 dark:text-gray-200">
        <span className="text-sm">검색 결과가 없습니다.</span>
      </div>
    );
  }

  return (
    <div className="w-full text-gray-600 dark:text-gray-200">
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-300 font-medium hover:text-gray-700 dark:hover:text-gray-100 transition-colors shrink-0 self-start"
      >
        <span>▶</span>
        📚 답변에 사용된 문서 {groupedItems.length}개 <i>(눌러서 확인하기)</i>
      </button>

      <div
        className={`fixed inset-0 z-[80] transition-opacity duration-300 ${isOpen ? (isMobileDevice ? "opacity-100 pointer-events-auto" : "opacity-100 pointer-events-none") : "opacity-0 pointer-events-none"}`}
        aria-hidden={!isOpen}
      >
        <button
          type="button"
          aria-label="답변에 사용된 문서 패널 닫기"
          onClick={() => setIsOpen(false)}
          className={`absolute inset-0 ${isMobileDevice ? "bg-black/50 backdrop-blur-[2px]" : "bg-transparent pointer-events-none"}`}
        />

        <aside
          role="dialog"
          aria-modal="true"
          className={`absolute right-0 top-0 h-[100dvh] bg-white dark:bg-[#1E1E1E] shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col pointer-events-auto transition-transform duration-300 ease-out ${isOpen ? (isMobileDevice ? "translate-y-0" : "translate-x-0") : isMobileDevice ? "-translate-y-full" : "translate-x-full"} ${isMobileDevice ? "w-full" : "w-[34rem]"}`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                📚 답변에 사용된 문서
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {groupedItems.length}개
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-[#2A2A2A] transition-colors"
              aria-label="패널 닫기"
            >
              <span className="text-lg leading-none text-gray-500 dark:text-gray-300">
                ×
              </span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {groupedItems.map((group, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-[#171717]"
              >
                <button
                  className="text-sm font-extrabold text-blue-600 dark:text-blue-300 mb-2 hover:underline text-left"
                  onClick={() => handleOpenFile(group.filePath)}
                >
                  {group.source}
                </button>
                <details className="group">
                  <summary className="cursor-pointer select-none text-xs text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100">
                    <span className="group-open:hidden">내용 보기</span>
                    <span className="hidden group-open:inline">
                      내용 숨기기
                    </span>
                  </summary>
                  <div className="space-y-2 mt-2">
                    {group.contents.map((text, contentIdx) => (
                      <div
                        key={contentIdx}
                        className="text-sm text-gray-700 dark:text-gray-100 pl-2 border-l-2 border-gray-200 dark:border-gray-700"
                      >
                        <DefaultMessage content={text} showCopy={false} />
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {alertMessage && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center">
          <button
            type="button"
            aria-label="모달 닫기"
            className="absolute inset-0 bg-black/50"
            onClick={() => setAlertMessage(null)}
          />
          <div className="relative bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl p-6 mx-4 max-w-sm w-full border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-800 dark:text-gray-100 mb-4">
              {alertMessage}
            </p>
            <button
              type="button"
              onClick={() => setAlertMessage(null)}
              className="w-full py-2 rounded-lg bg-gray-100 dark:bg-[#2A2A2A] text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#333] transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RetrieveMessage;
