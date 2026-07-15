import { useEffect, useRef } from "react";
import { IoSend } from "react-icons/io5";
import { FaStopCircle } from "react-icons/fa";
// import { isMobile } from "react-device-detect";
import { LuMessageSquare, LuPlus } from "react-icons/lu";
import { useChatMessages } from "@Features/Chatbot/hooks/useChatMessage";
import { useTextareaResize } from "@Features/Chatbot/hooks/useTextareaResize";
import { useScrollToBottom } from "@Features/Chatbot/hooks/useScrollToBottom";
import MessageRouter from "@Features/Chatbot/components/MessageRouter";
import CanvasPanel, {
  CanvasPanelFallback,
} from "@Features/Chatbot/components/CanvasPanel";
import AnchorChoicePrompt from "@Features/Chatbot/components/AnchorChoicePrompt";
import MissingTermsForm from "@Features/Chatbot/components/MissingTermsForm";
import ErrorBoundary from "@Features/Shared/components/ErrorBoundary";
import KetchupE from "@images/rag.png";
import Sidebar from "@Features/Sidebar/components/Sidebar";
import { guideCopy } from "@config/guideCopy";

const ChatbotPage = (): React.JSX.Element => {
  const {
    messages,
    inputMessage,
    isGenerating,
    feedbackModeEnabled,
    connectionPhase,
    pendingInterrupt,
    isSubmittingResume,
    canvasData,
    canvasActionContexts,
    changedBlockIds,
    selectedAnchorIds,
    showMissingTermsForm,
    setInputMessage,
    handleSubmit,
    // toggleFeedbackMode,
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
  } = useChatMessages();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useTextareaResize(
    textareaRef as React.RefObject<HTMLTextAreaElement>,
    inputMessage,
  );
  useScrollToBottom(messagesEndRef as React.RefObject<HTMLDivElement>, [
    messages,
  ]);

  useEffect(() => {
    if (canvasActionContexts.length > 0) {
      textareaRef.current?.focus();
    }
  }, [canvasActionContexts]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  const isFeedbackPreparing =
    feedbackModeEnabled &&
    (connectionPhase === "connecting" || connectionPhase === "configuring");
  const isInputDisabled =
    isGenerating ||
    isFeedbackPreparing ||
    pendingInterrupt?.type === "feedback_score" ||
    pendingInterrupt?.type === "awaiting_anchor_choice";

  // const handleFeedbackToggle = async () => {
  //   await toggleFeedbackMode();
  // };

  const handleScoreSelect = (score: number) => {
    sendResume(String(score));
  };

  const inputPlaceholder = (() => {
    if (canvasActionContexts.length > 1) {
      return `선택한 ${canvasActionContexts.length}개 작업에 적용할 내용을 입력해 주세요...`;
    }
    const context = canvasActionContexts[0];
    if (context?.op === "edit") {
      return "선택한 블록을 어떻게 수정할지 입력해 주세요...";
    }
    if (context?.op === "add") {
      return "선택한 블록 아래에 추가할 내용을 입력해 주세요...";
    }
    if (pendingInterrupt?.type === "feedback_reason") {
      return "추가 의견을 입력해 주세요...";
    }
    if (pendingInterrupt?.type === "awaiting_anchor_choice") {
      return "위에서 참고할 문서를 선택해 주세요...";
    }
    if (pendingInterrupt?.type === "awaiting_edit") {
      return "캔버스 전체에 대한 수정 의견을 입력해 주세요...";
    }
    return "메시지를 입력하세요...";
  })();
  const composerModeLabel = (() => {
    if (canvasActionContexts.length > 1) {
      return `${canvasActionContexts.length}개 작업 일괄 편집 모드`;
    }
    const context = canvasActionContexts[0];
    if (context?.op === "edit") {
      return "선택한 블록 수정 모드";
    }
    if (context?.op === "add") {
      return "선택한 블록 아래에 추가 모드";
    }
    if (pendingInterrupt?.type === "feedback_score") {
      return "피드백 점수 선택 대기 중";
    }
    if (pendingInterrupt?.type === "feedback_reason") {
      return "추가 의견 입력 모드";
    }
    if (pendingInterrupt?.type === "awaiting_anchor_choice") {
      return "참고 문서 선택 대기 중";
    }
    if (pendingInterrupt?.type === "awaiting_edit") {
      return "캔버스 전체 수정 모드";
    }
    if (feedbackModeEnabled) {
      return "Feedback Mode 활성화";
    }
    return null;
  })();

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden font-['Inter',sans-serif]">
      <Sidebar />

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-white dark:bg-[#0F0F0F]">
        {/* Chat Header */}
        <div className="flex items-center justify-between h-[60px] px-6 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <div className="flex items-center gap-3">
            <LuMessageSquare className="w-6 h-6 text-[#18181B] dark:text-[#FAFAFA]" />
            <span className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
              채팅
            </span>
            <span className="text-sm text-[#71717A] dark:text-[#A1A1AA]">
              케찹이와 대화하기
            </span>
          </div>

          <button
            type="button"
            onClick={startNewSession}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[#0066FF] text-[#0066FF] hover:bg-[#0066FF] hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <LuPlus className="w-4 h-4" />새 대화 시작하기
          </button>
        </div>

        {/* Chat Content */}
        <div className="flex flex-col flex-1 min-h-0 p-6 gap-4">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="text-center max-w-2xl">
                  <img
                    src={KetchupE}
                    className="w-[54px] h-auto mx-auto mb-4"
                    alt="KetchupE"
                  />
                  <h1 className="text-xl font-semibold text-[#18181B] dark:text-[#FAFAFA] mb-2">
                    {guideCopy.chat.emptyTitle}
                  </h1>
                  <p className="text-sm text-[#71717A] dark:text-[#A1A1AA]">
                    {guideCopy.chat.emptyDescription}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {messages.map((msg, index) => {
                // answer 메시지에 가장 최근 retrieve의 documents 전달
                const retrieveDocs =
                  msg.kind === "answer" && !msg.isInterruptPrompt
                    ? messages
                        .slice(0, index)
                        .findLast((m) => m.kind === "retrieve")?.documents
                    : undefined;
                return (
                  <MessageRouter
                    key={index}
                    msg={msg}
                    index={index}
                    retrieveDocs={retrieveDocs}
                    onOpenCanvas={openCanvas}
                  />
                );
              })}

              {canvasData && showMissingTermsForm && (
                <MissingTermsForm
                  terms={canvasData.missing_terms}
                  disabled={isGenerating || isSubmittingResume}
                  onSubmit={submitMissingTerms}
                />
              )}

              {pendingInterrupt?.type === "feedback_score" && (
                <div className="flex flex-col mb-2 items-start">
                  <div className="flex items-start flex-row">
                    <img
                      src={KetchupE}
                      alt="Assistant"
                      className="w-7 h-7 object-cover"
                    />
                    <div className="px-4 py-2 rounded-2xl leading-tight text-gray-900 dark:text-[#FAFAFA] rounded-br-md mr-12 max-w-[85%] border border-[#E4E4E7] dark:border-[#27272A]">
                      <p className="text-sm mb-3">
                        점수를 선택하면 바로 이어서 답변할게요.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4, 5].map((score) => (
                          <button
                            key={score}
                            type="button"
                            disabled={isSubmittingResume}
                            onClick={() => handleScoreSelect(score)}
                            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[#D4D4D8] text-[#18181B] dark:text-[#FAFAFA] hover:border-[#0066FF] hover:text-[#0066FF] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {pendingInterrupt?.type === "awaiting_anchor_choice" && (
                <AnchorChoicePrompt
                  candidates={pendingInterrupt.candidates}
                  selectedIds={selectedAnchorIds}
                  disabled={isSubmittingResume}
                  onToggle={toggleAnchorCandidate}
                  onSubmit={submitAnchorChoice}
                />
              )}

              {pendingInterrupt?.type === "feedback_reason" && (
                <div className="flex flex-col mb-2 items-start">
                  <div className="flex items-start flex-row">
                    <img
                      src={KetchupE}
                      alt="Assistant"
                      className="w-7 h-7 object-cover"
                    />
                    <div className="px-4 py-2 rounded-2xl leading-tight text-gray-900 dark:text-[#FAFAFA] rounded-br-md mr-12 max-w-[85%] border border-[#E4E4E7] dark:border-[#27272A]">
                      <p className="text-sm">
                        아래 입력창에 추가 의견을 입력해서 전송해주세요.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* {isGenerating && (
                <div className="flex items-center gap-3">
                  <img
                    src={KetchupE}
                    className="w-[54px] h-[54px] object-contain"
                    alt="MARU"
                  />
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#F4F4F5] dark:bg-[#262626]">
                    <div className="animate-spin h-4 w-4 border-2 border-[#71717A] border-t-transparent rounded-full" />
                    <span className="text-sm text-[#18181B] dark:text-[#FAFAFA]">
                      응답 생성 중...
                    </span>
                  </div>
                </div>
              )} */}
            </div>

            <div ref={messagesEndRef} />
          </div>

          {/* Search Scope Filter */}
          {/* <div className="flex items-center gap-3 px-1">
            <div className="flex items-center gap-2 text-[#71717A]">
              <LuSearch className="w-4 h-4" />
              <span className="text-sm">검색 범위</span>
            </div>
            <div className="flex items-center gap-2">
              {groups.map((group) => {
                const isSelected = selectedGroups.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroupSelection(group.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      isSelected
                        ? "bg-[#0066FF] text-white"
                        : "border border-[#E4E4E7] dark:border-[#3F3F46] text-[#71717A] hover:border-[#A1A1AA]"
                    }`}
                  >
                    {isSelected && <LuCheck className="w-3.5 h-3.5" />}
                    <span>{group.name}</span>
                  </button>
                );
              })}
            </div>
          </div> */}
        </div>

        {composerModeLabel && (
          <div className="px-5 pb-2">
            <p
              className={`inline-flex text-xs ${
                pendingInterrupt?.type === "awaiting_edit"
                  ? "rounded-full bg-[#EFF6FF] px-2.5 py-1 font-semibold text-[#0066FF] dark:bg-[#0B1B33] dark:text-[#60A5FA]"
                  : "text-[#71717A] dark:text-[#A1A1AA]"
              }`}
            >
              {composerModeLabel}
            </p>
          </div>
        )}

        {canvasActionContexts.length > 0 && (
          <div className="px-5 pb-2">
            <div className="flex flex-wrap gap-2">
              {canvasActionContexts.map((context) => (
                <div
                  key={
                    context.op === "edit"
                      ? `edit:${context.block_id}`
                      : `add:${context.after_block_id}`
                  }
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#0066FF] bg-[#EFF6FF] px-3 py-1.5 text-xs font-medium text-[#0066FF] dark:bg-[#0B1B33]"
                >
                  <span className="truncate">
                    {context.label}{" "}
                    {context.op === "edit" ? "수정" : "아래 추가"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCanvasActionContext(context)}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[#0066FF] transition-colors hover:bg-[#0066FF] hover:text-white"
                    title="선택 해제"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-5 pb-2">
          <div className="flex items-center justify-between gap-3">
            {/* <div className="inline-flex items-center gap-2 rounded-full border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#171717] px-2 py-1">
              <span className="text-xs font-medium text-[#18181B] dark:text-[#FAFAFA]">
                FeedbackMode
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={feedbackModeEnabled}
                onClick={handleFeedbackToggle}
                disabled={connectionPhase === "configuring"}
                className={`relative inline-flex h-5 w-12 items-center rounded-full transition-colors ${
                  feedbackModeEnabled
                    ? "bg-[#0066FF]"
                    : "bg-[#D4D4D8] dark:bg-[#3F3F46]"
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <span
                  className={`absolute inset-0 flex items-center text-[9px] font-semibold tracking-wide ${
                    feedbackModeEnabled
                      ? "justify-start pl-1.5 text-white/90"
                      : "justify-end pr-1.5 text-[#3F3F46] dark:text-[#E4E4E7]"
                  }`}
                >
                  {feedbackModeEnabled ? "ON" : "OFF"}
                </span>
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    feedbackModeEnabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div> */}
            <span className="flex-1 text-sm text-right text-gray-500">
              🦜 이전 대화를 이어서 기억해요. 새로 시작하려면 '새 대화
              시작하기'를 눌러주세요.
            </span>
          </div>
        </div>
        <div className="px-5 pb-6">
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="flex items-end gap-3 min-h-[52px] max-h-[200px] py-2 px-4 rounded-xl border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#171717]"
          >
            {/* <LuPaperclip className="w-5 h-5 text-[#71717A] flex-shrink-0 cursor-pointer hover:text-[#52525B] mb-2" /> */}
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={inputPlaceholder}
              disabled={isInputDisabled}
              rows={1}
              className="flex-1 text-sm bg-transparent border-none outline-none resize-none text-[#18181B] dark:text-[#FAFAFA] placeholder:text-[#71717A] leading-6 py-2 min-h-[36px] max-h-[180px] overflow-y-auto"
            />
            {isGenerating ? (
              <button
                type="button"
                onClick={stopGenerating}
                className="flex items-center justify-center w-9 h-9 mb-0.5 rounded-lg bg-[#dc3545] hover:bg-[#c82333] transition-colors flex-shrink-0"
              >
                <FaStopCircle className="w-[18px] h-[18px] text-white" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isInputDisabled || !inputMessage.trim()}
                className="flex items-center justify-center w-9 h-9 mb-0.5 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] transition-colors flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <IoSend className="w-[18px] h-[18px] text-white" />
              </button>
            )}
          </form>
        </div>
        {/* Input Area */}
      </div>

      {/* Canvas Panel (계약서 초안 수신 시 표시) */}
      {canvasData && (
        <ErrorBoundary fallback={<CanvasPanelFallback onClose={closeCanvas} />}>
          <CanvasPanel
            canvas={canvasData}
            changedBlockIds={changedBlockIds}
            canUndo={
              pendingInterrupt?.type === "awaiting_edit" &&
              pendingInterrupt.can_undo === true
            }
            canRedo={
              pendingInterrupt?.type === "awaiting_edit" &&
              pendingInterrupt.can_redo === true
            }
            onClose={closeCanvas}
            activeActionContexts={canvasActionContexts}
            onEditBlock={startEditBlock}
            onAddBlockAfter={startAddBlockAfter}
            onDeleteBlock={deleteBlock}
            onChangeVersion={changeCanvasVersion}
            onFinalize={finalizeCanvas}
          />
        </ErrorBoundary>
      )}
    </div>
  );
};

export default ChatbotPage;
