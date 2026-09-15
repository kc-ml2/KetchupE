import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { IoSend } from "react-icons/io5";
import { FaStopCircle } from "react-icons/fa";
import {
  LuBrain,
  LuFileText,
  LuFolderSearch,
  LuLayers,
  LuSettings,
} from "react-icons/lu";
import Sidebar from "@Features/Sidebar/components/Sidebar";
import { useAgentApi } from "@Features/Agent/hooks/useAgentApi";
import { useThreadMessages } from "@Features/Agent/hooks/useThreadMessages";
import {
  ThreadsContext,
  type ThreadsContextType,
} from "@Contexts/ThreadsContext";
import { WORKSPACE_ID } from "@Contexts/ThreadsProvider";
import { useAgentRun, phaseLabel } from "@Features/Agent/hooks/useAgentRun";
import {
  useCanvasRun,
  canvasPhaseLabel,
} from "@Features/Agent/hooks/useCanvasRun";
import { useCollections } from "@Features/Agent/hooks/useCollections";
import { useMemories } from "@Features/Agent/hooks/useMemories";
import AgentMessages from "@Features/Agent/components/AgentMessages";
import CanvasPanel from "@Features/Agent/components/CanvasPanel";
import MissingTermsForm from "@Features/Agent/components/MissingTermsForm";
import AnchorChoicePrompt from "@Features/Agent/components/AnchorChoicePrompt";
import CollectionPanel from "@Features/Agent/components/CollectionPanel";
import MemoryPanel from "@Features/Agent/components/MemoryPanel";
import ModelSettingsForm from "@Features/Agent/components/ModelSettingsForm";
// import { guideCopy } from "@config/guideCopy";

type PanelTab = "context" | "collections" | "model";

const AgentPage = (): React.JSX.Element => {
  const api = useAgentApi();
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  const selectedId = threadId ?? null;
  const { createThread } = useContext(ThreadsContext) as ThreadsContextType;
  const { messages, hasMore, reload, loadOlder } = useThreadMessages(
    api,
    selectedId,
  );
  const {
    view,
    attach: attachAgent,
    resume,
    cancel,
  } = useAgentRun(api, selectedId, () => void reload());
  const canvasRun = useCanvasRun(api, selectedId, () => void reload());
  const canvas = canvasRun.view;
  const collectionsState = useCollections(api, WORKSPACE_ID);
  const memoriesState = useMemories(api, WORKSPACE_ID);
  const [tab, setTab] = useState<PanelTab>("context");
  const [input, setInput] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null);
  const [documentMode, setDocumentMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api?.getWorkspace().then((workspace) => {
      setMemoryEnabled(workspace.memoryEnabled);
    });
  }, [api]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, view.streamingText, view.phase, starting, canvas.phase]);

  if (!api) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 items-center justify-center text-sm text-[#71717A]">
          케찹이는 데스크톱 앱에서만 사용할 수 있습니다.
        </div>
      </div>
    );
  }

  const canvasActive = Boolean(canvas.runId);
  const busy = starting || view.isRunning || canvas.isBusy;

  const toggleMemory = async (enabled: boolean) => {
    setMemoryEnabled(enabled);
    setMemoryStatus(null);
    try {
      await api.setMemoryEnabled(WORKSPACE_ID, enabled);
    } catch (cause) {
      setMemoryEnabled(!enabled);
      setMemoryStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (canvasActive && canvas.interrupt?.type === "awaiting_edit") {
      setInput("");
      await canvasRun.sendFeedback(text);
      return;
    }
    if (canvasActive && canvas.interrupt?.type === "awaiting_anchor_choice")
      return;
    if (view.waitingQuestion !== null) {
      setInput("");
      await resume(text);
      return;
    }
    setStartError(null);
    setStarting(true);
    try {
      let target = selectedId;
      if (!target) {
        target = (await createThread())?.id ?? null;
        if (target) navigate(`/agent/${target}`);
      }
      if (!target) return;
      setInput("");
      // "auto" routes chat vs document authoring from the message, like MARU's graph router; the icon forces doc.
      const started = await api.startRun({
        threadId: target,
        workspaceId: WORKSPACE_ID,
        text,
        mode: documentMode ? "doc" : "auto",
      });
      setDocumentMode(false);
      if (started.kind === "canvas") canvasRun.attach(started.runId);
      else attachAgent(started.runId);
      void reload(target);
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const activeCollectionCount = collectionsState.collections.filter(
    (collection) => collection.active,
  ).length;
  const placeholder = (() => {
    if (canvas.interrupt?.type === "awaiting_anchor_choice")
      return "위에서 참고할 표준 양식을 선택해 주세요";
    if (canvas.actionContexts.length > 1)
      return `선택한 ${canvas.actionContexts.length}개 블록에 적용할 내용을 입력하세요`;
    if (canvas.actionContexts[0]?.op === "edit")
      return "선택한 블록을 어떻게 수정할지 입력하세요";
    if (canvas.actionContexts[0]?.op === "add")
      return "선택한 블록 아래에 추가할 내용을 입력하세요";
    if (canvas.interrupt?.type === "awaiting_edit")
      return "문서 전체에 대한 수정 의견을 입력하세요 (재작성)";
    if (documentMode) return "어떤 문서를 작성할까요? 예: 계약서 초안";
    if (view.waitingQuestion !== null)
      return "에이전트의 질문에 답해 주세요...";
    return activeCollectionCount
      ? `활성 collection ${activeCollectionCount}개에서 검색합니다...`
      : "먼저 오른쪽에서 폴더를 등록하세요";
  })();
  // 진행 상태는 메시지 목록의 progressText가, 안내 문구는 입력창 placeholder가 보여준다. 여기서는 실패만 알린다.
  const errorText = startError ?? view.error ?? canvas.error ?? null;
  const responsePersisted = Boolean(
    !view.isRunning &&
    view.runId &&
    view.streamingText &&
    messages.some(
      (message) =>
        message.role === "assistant" &&
        message.runId === view.runId &&
        message.content === view.streamingText,
    ),
  );
  const streamingText = responsePersisted ? "" : view.streamingText;
  const progressText = starting
    ? "요청을 준비하는 중..."
    : view.isRunning && !streamingText
      ? phaseLabel(view.phase) || "작업 중..."
      : canvas.isBusy
        ? canvasPhaseLabel(canvas.phase) || "문서를 처리하는 중..."
        : null;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden font-['Inter',sans-serif]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-white dark:bg-[#0F0F0F]">
        <div className="flex items-center gap-3 h-[60px] px-6 border-b border-[#E4E4E7] dark:border-[#27272A]">
          <span className="text-lg font-semibold text-[#18181B] dark:text-[#FAFAFA]">
            케찹이
          </span>
          <span className="text-xs text-[#71717A]">
            현재 질문은 이 대화에만 적용됩니다.
          </span>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <AgentMessages
                messages={messages}
                streamingText={streamingText}
                streamingRunId={view.runId}
                streamingCitations={responsePersisted ? [] : view.citations}
                streamingAppliedContext={
                  responsePersisted ? { memories: [] } : view.appliedContext
                }
                progressText={progressText}
                hasMore={hasMore}
                onLoadOlder={() => void loadOlder()}
                onOpenCitation={(runId, evidenceId) =>
                  void api.openCitation(runId, evidenceId)
                }
              />
              {canvas.interrupt?.type === "awaiting_anchor_choice" && (
                <AnchorChoicePrompt
                  candidates={canvas.interrupt.candidates}
                  selectedIds={canvas.selectedAnchorIds}
                  disabled={canvas.isBusy}
                  onToggle={canvasRun.toggleAnchor}
                  onSubmit={(action) =>
                    void canvasRun.submitAnchorChoice(action)
                  }
                />
              )}
              {canvas.canvas && canvasRun.showMissingTermsForm && (
                <MissingTermsForm
                  terms={canvas.canvas.missing_terms}
                  disabled={canvas.isBusy}
                  onSubmit={canvasRun.submitMissingTerms}
                />
              )}
              <div ref={bottomRef} />
            </div>

            <div className="px-6 pb-4">
              {errorText && (
                <div className="mb-2 text-xs text-[#DC2626]">{errorText}</div>
              )}
              {canvas.actionContexts.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {canvas.actionContexts.map((context) => (
                    <span
                      key={
                        context.op === "edit"
                          ? `edit:${context.block_id}`
                          : `add:${context.after_block_id}`
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-[#0066FF] bg-[#EFF6FF] px-3 py-1 text-xs font-medium text-[#0066FF] dark:bg-[#0B1B33]"
                    >
                      {context.label}{" "}
                      {context.op === "edit" ? "수정" : "아래 추가"}
                      <button
                        type="button"
                        onClick={() => canvasRun.removeContext(context)}
                        className="rounded-full hover:bg-[#0066FF] hover:text-white w-4 h-4 leading-none"
                        title="선택 해제"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <form
                onSubmit={submit}
                className={`flex items-end gap-2 p-2 rounded-xl border ${documentMode ? "border-[#0066FF]" : "border-[#E4E4E7] dark:border-[#27272A]"}`}
              >
                {!canvasActive && (
                  <button
                    type="button"
                    onClick={() => setDocumentMode((current) => !current)}
                    title={
                      documentMode
                        ? "문서 작성 모드 켜짐: 등록된 문서를 근거로 계약서·기안서 초안을 만듭니다"
                        : "문서 작성 모드 켜기: 등록된 문서를 근거로 계약서·기안서 초안을 만듭니다"
                    }
                    aria-label={
                      documentMode
                        ? "문서 작성 모드 켜짐"
                        : "문서 작성 모드 켜기"
                    }
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-medium ${documentMode ? "bg-[#0066FF] text-white" : "text-[#71717A] hover:text-[#0066FF] border border-[#E4E4E7] dark:border-[#27272A]"}`}
                  >
                    <LuFileText className="w-4 h-4" />
                    <span>문서 작성</span>
                  </button>
                )}
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit(event);
                    }
                  }}
                  placeholder={placeholder}
                  disabled={canvas.interrupt?.type === "awaiting_anchor_choice"}
                  rows={2}
                  className="flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none text-[#18181B] dark:text-[#FAFAFA]"
                />
                {busy ? (
                  <button
                    type="button"
                    onClick={() =>
                      void (view.runId
                        ? cancel()
                        : canvas.runId && api.cancelRun(canvas.runId))
                    }
                    className="p-2 text-[#DC2626]"
                    title="중단"
                  >
                    <FaStopCircle className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="p-2 text-[#0066FF] disabled:opacity-40"
                    title="보내기"
                  >
                    <IoSend className="w-5 h-5" />
                  </button>
                )}
              </form>
            </div>
          </div>

          {canvas.canvas && (
            <CanvasPanel
              canvas={canvas.canvas}
              changedBlockIds={canvas.changedBlockIds}
              canUndo={
                canvas.interrupt?.type === "awaiting_edit" &&
                canvas.interrupt.can_undo
              }
              canRedo={
                canvas.interrupt?.type === "awaiting_edit" &&
                canvas.interrupt.can_redo
              }
              onClose={canvasRun.close}
              activeActionContexts={canvas.actionContexts}
              onEditBlock={canvasRun.startEditBlock}
              onAddBlockAfter={canvasRun.startAddBlockAfter}
              onDeleteBlock={canvasRun.deleteBlock}
              onUpdateBlockContent={canvasRun.updateBlockContent}
              onChangeVersion={canvasRun.changeVersion}
              onFinalize={canvasRun.finalize}
              onOpenSource={(documentId) =>
                canvas.canvas &&
                void api.openCanvasSource(canvas.canvas.canvas_id, documentId)
              }
            />
          )}
        </div>
      </div>

      <aside className="flex flex-col w-[300px] shrink-0 border-l border-[#E4E4E7] dark:border-[#27272A] bg-[#FAFAFA] dark:bg-[#141414]">
        <div
          role="tablist"
          aria-label="오른쪽 패널"
          className="flex h-[60px] border-b border-[#E4E4E7] dark:border-[#27272A]"
        >
          {(
            [
              ["context", LuLayers, "컨텍스트"],
              ["collections", LuFolderSearch, "폴더"],
              ["model", LuSettings, "모델"],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold ${tab === key ? "text-[#0066FF] border-b-2 border-[#0066FF]" : "text-[#71717A]"}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "collections" && (
            <div role="tabpanel">
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                <LuFolderSearch className="h-4 w-4" />
                검색 폴더
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-[#71717A]">
                활성화한 폴더만 검색하며, 답변에는 실제 인용한 문서가
                표시됩니다.
              </p>
              <CollectionPanel
                collections={collectionsState.collections}
                error={collectionsState.error}
                onAdd={() => void collectionsState.add()}
                onRemove={(name) => void collectionsState.remove(name)}
                onSync={(name) => void collectionsState.sync(name)}
                onToggle={(name, active) =>
                  void collectionsState.setActive(name, active)
                }
              />
            </div>
          )}
          {tab === "context" && (
            <div role="tabpanel">
              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                    <LuBrain className="h-4 w-4" />
                    저장된 컨텍스트
                  </h3>
                  <label className="flex items-center gap-1.5 text-[11px] text-[#71717A]">
                    <input
                      type="checkbox"
                      checked={memoryEnabled}
                      onChange={(event) =>
                        void toggleMemory(event.target.checked)
                      }
                    />
                    사용
                  </label>
                </div>
                <p className="mb-3 mt-1 text-[11px] leading-relaxed text-[#71717A]">
                  {memoryEnabled
                    ? "고정한 항목은 항상, 나머지는 관련 질문에서 사용합니다."
                    : "꺼져 있어 저장된 컨텍스트를 답변에 사용하지 않습니다."}
                </p>
                {memoryStatus && (
                  <p className="mb-3 text-xs text-[#DC2626]">{memoryStatus}</p>
                )}
                <MemoryPanel
                  memories={memoriesState.memories}
                  onAdd={memoriesState.add}
                  onUpdate={memoriesState.update}
                  onPin={memoriesState.setPinned}
                  onConfirm={memoriesState.confirm}
                  onDelete={memoriesState.remove}
                />
              </section>
            </div>
          )}
          {tab === "model" && (
            <div role="tabpanel">
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#18181B] dark:text-[#FAFAFA]">
                <LuSettings className="h-4 w-4" />
                모델 연결
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-[#71717A]">
                LiteLLM 게이트웨이와 사용할 모델을 지정합니다. 비워두면 서버가
                제공하는 첫 번째 모델을 씁니다.
              </p>
              <ModelSettingsForm api={api} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default AgentPage;
