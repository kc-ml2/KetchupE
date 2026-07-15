import { useRef, useState } from "react";
import {
  LuFileDown,
  LuPanelRight,
  LuPencilLine,
  LuPlus,
  LuRedo2,
  LuTrash2,
  LuUndo2,
  LuX,
} from "react-icons/lu";
import { CanvasActionContext } from "@app-types/Chatbot.types";
import { useCanvasDocxExport } from "../hooks/useCanvasDocxExport";
import { parseContractTableGrid } from "@lib/contractTableText";
import { getPathLeafName } from "@lib/pathDisplay";
import {
  ContractBlock,
  ContractCanvas,
  ContractSection,
  ContractTableCell,
} from "@app-types/Canvas.types";

interface CanvasPanelProps {
  canvas: ContractCanvas;
  changedBlockIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  onClose: () => void;
  activeActionContexts: CanvasActionContext[];
  onEditBlock: (section: ContractSection, block: ContractBlock) => void;
  onAddBlockAfter: (section: ContractSection, block: ContractBlock) => void;
  onDeleteBlock: (section: ContractSection, block: ContractBlock) => void;
  onChangeVersion: (op: "undo" | "redo") => boolean;
  onFinalize: () => boolean;
}

const JSON_INDENT = 2;
const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_WIDTH_RATIO = 0.75;
const RESIZE_STEP = 24;

const getCanvasTitle = (canvas: ContractCanvas): string =>
  canvas.title || canvas.metadata?.title || "Canvas";

// phase5 스펙(table.rows[].cells[]) 또는 구버전 호환 text({cell,value}[]) → 라벨:값 쌍 목록
const getBlockPairRows = (block: ContractBlock): ContractTableCell[][] => {
  if (block.table?.rows) return block.table.rows.map((row) => row.cells);
  if (Array.isArray(block.text)) return [block.text];
  return [];
};

const PairTable = ({ rows }: { rows: ContractTableCell[][] }) => (
  <table className="w-full text-sm border-collapse">
    <tbody>
      {rows.map((row, rowIndex) =>
        row.map((cell, cellIndex) => (
          <tr
            key={`${rowIndex}-${cellIndex}`}
            className="border-b last:border-b-0 border-[#E4E4E7] dark:border-[#27272A]"
          >
            <td className="py-1.5 pr-3 align-top whitespace-nowrap font-medium text-[#52525B] dark:text-[#A1A1AA]">
              {cell.cell}
            </td>
            <td className="py-1.5 whitespace-pre-wrap text-[#18181B] dark:text-[#FAFAFA]">
              {cell.value}
            </td>
          </tr>
        )),
      )}
    </tbody>
  </table>
);

// 실제 서버가 table 블록 text에 보내는 마크다운 표 문자열 → 임의 열 개수의 grid로 렌더링
const GridTable = ({
  header,
  rows,
}: {
  header: string[] | null;
  rows: string[][];
}) => (
  <table className="w-full text-sm border-collapse">
    {header && (
      <thead>
        <tr className="border-b border-[#E4E4E7] dark:border-[#27272A]">
          {header.map((cell, cellIndex) => (
            <th
              key={cellIndex}
              className="py-1.5 px-2 text-left whitespace-pre-wrap font-medium text-[#52525B] dark:text-[#A1A1AA]"
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
    )}
    <tbody>
      {rows.map((row, rowIndex) => (
        <tr
          key={rowIndex}
          className="border-b last:border-b-0 border-[#E4E4E7] dark:border-[#27272A]"
        >
          {row.map((cell, cellIndex) => (
            <td
              key={cellIndex}
              className="py-1.5 px-2 align-top whitespace-pre-wrap text-[#18181B] dark:text-[#FAFAFA]"
            >
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

// 블록 본문: table 블록은 table 필드/{cell,value} 배열 → 라벨:값 표, 마크다운 표 문자열 → grid 표,
// 그 외는 문자열 → 문단으로 렌더링
const BlockText = ({ block }: { block: ContractBlock }) => {
  const pairRows = getBlockPairRows(block);
  if (pairRows.length > 0) return <PairTable rows={pairRows} />;

  if (block.block_type === "table" && typeof block.text === "string") {
    const grid = parseContractTableGrid(block.text);
    if (grid.header || grid.rows.length > 0) {
      return <GridTable header={grid.header} rows={grid.rows} />;
    }
  }

  const text = typeof block.text === "string" ? block.text : "";
  const isArticleHeading = /^제\s*\d+\s*조/.test(
    `${block.numbering ?? ""} ${text}`.trim(),
  );

  return (
    <p
      className={`text-sm leading-relaxed whitespace-pre-wrap break-words text-[#18181B] dark:text-[#FAFAFA] ${
        isArticleHeading ? "font-semibold" : ""
      }`}
    >
      {block.numbering ? `${block.numbering} ` : ""}
      {text}
    </p>
  );
};

// 블록 하나 = 부분 수정의 최소 단위
const BlockCard = ({
  block,
  section,
  isActive,
  isChanged,
  isEditable,
  onEditBlock,
  onAddBlockAfter,
  onAskDelete,
}: {
  block: ContractBlock;
  section: ContractSection;
  isActive: boolean;
  isChanged: boolean;
  isEditable: boolean;
  onEditBlock: (section: ContractSection, block: ContractBlock) => void;
  onAddBlockAfter: (section: ContractSection, block: ContractBlock) => void;
  onAskDelete: (section: ContractSection, block: ContractBlock) => void;
}) => {
  return (
    <div
      role={isEditable ? "button" : undefined}
      tabIndex={isEditable ? 0 : -1}
      onClick={() => isEditable && onEditBlock(section, block)}
      onKeyDown={(event) => {
        if (isEditable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onEditBlock(section, block);
        }
      }}
      className={`rounded-lg border bg-white px-2.5 py-1.5 text-left transition-colors dark:bg-[#171717] ${
        isActive
          ? "border-[#0066FF] shadow-[0_0_0_1px_#0066FF]"
          : `border-[#E4E4E7] dark:border-[#27272A] ${
              isEditable ? "hover:border-[#0066FF]" : ""
            }`
      }`}
    >
      <div
        className={
          isChanged
            ? "text-[#0066FF] [&_*]:!text-[#0066FF] dark:text-[#60A5FA] dark:[&_*]:!text-[#60A5FA]"
            : undefined
        }
      >
        <BlockText block={block} />
      </div>
      {isEditable && (
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
          {[
            {
              key: "edit" as const,
              label: "내용 수정하기",
              icon: LuPencilLine,
              className:
                "text-[#A1A1AA] hover:bg-[#EFF6FF] hover:text-[#0066FF] dark:text-[#52525B] dark:hover:bg-[#1E293B]",
              onClick: () => onEditBlock(section, block),
            },
            {
              key: "add" as const,
              label: "아래에 내용 추가하기",
              icon: LuPlus,
              className:
                "text-[#A1A1AA] hover:bg-[#EFF6FF] hover:text-[#0066FF] dark:text-[#52525B] dark:hover:bg-[#1E293B]",
              onClick: () => onAddBlockAfter(section, block),
            },
            {
              key: "delete" as const,
              label: "삭제하기",
              icon: LuTrash2,
              className:
                "text-[#E4B4BA] hover:bg-[#FEF2F2] hover:text-[#B4232F] dark:text-[#6B4A50] dark:hover:bg-[#3F2A30]",
              onClick: () => onAskDelete(section, block),
            },
          ].map(({ key, label, icon: Icon, className, onClick }) => (
            <div key={key} className="group relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onClick();
                }}
                aria-label={label}
                title={label}
                className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium transition-colors ${className}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
              <span className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-[#18181B] px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-[#FAFAFA] dark:text-[#18181B]">
                {label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// 조항(section) 단위: 제목(제N조) + 소속 블록 목록
const SectionGroup = ({
  section,
  changedBlockIds,
  isEditable,
  activeActionContexts,
  onEditBlock,
  onAddBlockAfter,
  onAskDelete,
}: {
  section: ContractSection;
  changedBlockIds: string[];
  isEditable: boolean;
  activeActionContexts: CanvasActionContext[];
  onEditBlock: (section: ContractSection, block: ContractBlock) => void;
  onAddBlockAfter: (section: ContractSection, block: ContractBlock) => void;
  onAskDelete: (section: ContractSection, block: ContractBlock) => void;
}) => {
  const sourceNames = [
    ...new Set(
      [
        ...(section.source_refs ?? []),
        ...section.blocks.flatMap((block) => block.source_refs ?? []),
      ].map(({ document_name }) => getPathLeafName(document_name)),
    ),
  ];

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-left text-sm font-semibold text-[#18181B] dark:text-[#FAFAFA]">
          {section.title}
        </h3>
        {sourceNames.length > 0 && (
          <div className="flex flex-wrap justify-end gap-x-2 text-right text-[10px] text-[#A1A1AA]">
            {sourceNames.map((sourceName) => (
              <span key={sourceName}>{sourceName}</span>
            ))}
          </div>
        )}
      </div>
      {section.blocks.map((block) => (
        <BlockCard
          key={block.block_id}
          block={block}
          section={section}
          isChanged={changedBlockIds.includes(block.block_id)}
          isEditable={isEditable}
          isActive={activeActionContexts.some((context) =>
            context.op === "edit"
              ? context.block_id === block.block_id
              : context.after_block_id === block.block_id,
          )}
          onEditBlock={onEditBlock}
          onAddBlockAfter={onAddBlockAfter}
          onAskDelete={onAskDelete}
        />
      ))}
    </section>
  );
};

// Canvas 렌더링이 실패해도 앱 전체가 죽지 않도록 ErrorBoundary fallback으로 사용
export const CanvasPanelFallback = ({ onClose }: { onClose: () => void }) => {
  return (
    <div className="flex flex-col items-center justify-center gap-3 w-[40%] min-w-[360px] max-w-[560px] min-h-0 p-6 border-l border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#0F0F0F]">
      <p className="text-sm text-center text-[#71717A] dark:text-[#A1A1AA]">
        캔버스를 표시하는 중 문제가 발생했어요.
        <br />
        콘솔의 에러 로그를 확인해 주세요.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[#D4D4D8] text-[#18181B] dark:text-[#FAFAFA] hover:border-[#0066FF] hover:text-[#0066FF] transition-colors"
      >
        닫기
      </button>
    </div>
  );
};

// Canvas 패널: 계약서 초안을 조항 > 블록 단위로 표시
const CanvasPanel = ({
  canvas,
  changedBlockIds,
  canUndo,
  canRedo,
  onClose,
  activeActionContexts,
  onEditBlock,
  onAddBlockAfter,
  onDeleteBlock,
  onChangeVersion,
  onFinalize,
}: CanvasPanelProps) => {
  const [deleteTarget, setDeleteTarget] = useState<{
    section: ContractSection;
    block: ContractBlock;
  } | null>(null);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const { isExporting, exportCanvasToDocx } = useCanvasDocxExport();
  const orderedSections = [...canvas.sections].sort(
    (a, b) => a.order - b.order,
  );
  const title = getCanvasTitle(canvas);
  const isFinalized = canvas.status.toLowerCase() === "finalized";
  const clampWidth = (width: number) =>
    Math.min(
      window.innerWidth * MAX_PANEL_WIDTH_RATIO,
      Math.max(MIN_PANEL_WIDTH, width),
    );

  return (
    <div
      ref={panelRef}
      style={{ width: panelWidth ?? "40%" }}
      className="relative flex flex-none flex-col min-w-[360px] max-w-[75vw] min-h-0 border-l border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#0F0F0F]"
    >
      <div
        role="separator"
        aria-label="캔버스 너비 조절"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={(event) => {
          resizeStartRef.current = {
            x: event.clientX,
            width: panelRef.current?.offsetWidth ?? MIN_PANEL_WIDTH,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = resizeStartRef.current;
          if (!start) return;
          setPanelWidth(clampWidth(start.width + start.x - event.clientX));
        }}
        onPointerUp={() => {
          resizeStartRef.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const current =
            panelWidth ?? panelRef.current?.offsetWidth ?? MIN_PANEL_WIDTH;
          setPanelWidth(
            clampWidth(
              current +
                (event.key === "ArrowLeft" ? RESIZE_STEP : -RESIZE_STEP),
            ),
          );
        }}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none outline-none before:absolute before:left-1/2 before:h-full before:w-px before:bg-transparent before:transition-colors hover:before:bg-[#0066FF] focus:before:bg-[#0066FF]"
      />
      {/* Panel Header */}
      <div className="flex items-center justify-between h-[60px] px-4 border-b border-[#E4E4E7] dark:border-[#27272A]">
        <div className="flex items-center gap-2 min-w-0">
          <LuPanelRight className="w-5 h-5 flex-shrink-0 text-[#18181B] dark:text-[#FAFAFA]" />
          <span className="text-base font-semibold truncate text-[#18181B] dark:text-[#FAFAFA]">
            {title}
          </span>
          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[#F4F4F5] dark:bg-[#262626] text-[#71717A] dark:text-[#A1A1AA]">
            {isFinalized ? "확정됨" : canvas.status}
          </span>
          <button
            type="button"
            onClick={() => onChangeVersion("undo")}
            disabled={!canUndo || isFinalized}
            aria-label="되돌리기"
            title="되돌리기"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[#52525B] transition-colors hover:bg-[#EFF6FF] hover:text-[#0066FF] disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#D4D4D8] dark:hover:bg-[#1E293B]"
          >
            <LuUndo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onChangeVersion("redo")}
            disabled={!canRedo || isFinalized}
            aria-label="다시 실행"
            title="다시 실행"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[#52525B] transition-colors hover:bg-[#EFF6FF] hover:text-[#0066FF] disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#D4D4D8] dark:hover:bg-[#1E293B]"
          >
            <LuRedo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exportCanvasToDocx(canvas)}
            disabled={isExporting}
            title="docx 파일로 내보내기"
            className="flex items-center gap-1 flex-shrink-0 px-2 py-1 rounded-lg text-xs font-medium border border-[#D4D4D8] text-[#52525B] transition-colors hover:border-[#0066FF] hover:text-[#0066FF] disabled:opacity-50 disabled:pointer-events-none dark:border-[#3F3F46] dark:text-[#D4D4D8]"
          >
            <LuFileDown className="w-3.5 h-3.5" />
            {isExporting ? "내보내는 중…" : "docx로 내보내기"}
          </button>
          {!isFinalized && (
            <button
              type="button"
              onClick={() => setShowFinalizeConfirm(true)}
              className="flex-shrink-0 rounded-lg bg-[#0066FF] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#0052CC]"
            >
              문서 확정
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="닫기"
          className="flex items-center justify-center w-8 h-8 flex-shrink-0 rounded-lg text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] dark:hover:text-[#FAFAFA] dark:hover:bg-[#262626] transition-colors"
        >
          <LuX className="w-4 h-4" />
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-5">
        {/* 조항 > 블록 목록 */}
        {orderedSections.map((section) => (
          <SectionGroup
            key={section.section_id}
            section={section}
            changedBlockIds={changedBlockIds}
            isEditable={!isFinalized}
            activeActionContexts={activeActionContexts}
            onEditBlock={onEditBlock}
            onAddBlockAfter={onAddBlockAfter}
            onAskDelete={(targetSection, targetBlock) =>
              setDeleteTarget({ section: targetSection, block: targetBlock })
            }
          />
        ))}

        {/* 디버깅용 원본 JSON */}
        <details className="text-xs text-[#71717A] dark:text-[#A1A1AA]">
          <summary className="cursor-pointer select-none">원본 JSON</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all bg-[#F4F4F5] dark:bg-[#171717] rounded-lg p-3 text-[#18181B] dark:text-[#FAFAFA]">
            {JSON.stringify(canvas, null, JSON_INDENT)}
          </pre>
        </details>
      </div>

      {deleteTarget && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-lg border border-[#E4E4E7] bg-white p-4 shadow-lg dark:border-[#27272A] dark:bg-[#171717]">
            <h3 className="text-sm font-semibold text-[#18181B] dark:text-[#FAFAFA]">
              이 블록을 삭제하시겠습니까?
            </h3>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-[#D4D4D8] px-3 py-1.5 text-xs font-semibold text-[#52525B] transition-colors hover:border-[#A1A1AA] dark:border-[#3F3F46] dark:text-[#D4D4D8]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteBlock(deleteTarget.section, deleteTarget.block);
                  setDeleteTarget(null);
                }}
                className="rounded-lg bg-[#B4232F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#921B26]"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinalizeConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="finalize-dialog-title"
            className="w-full max-w-sm rounded-lg border border-[#E4E4E7] bg-white p-4 shadow-lg dark:border-[#27272A] dark:bg-[#171717]"
          >
            <h3
              id="finalize-dialog-title"
              className="text-sm font-semibold text-[#18181B] dark:text-[#FAFAFA]"
            >
              문서를 확정하시겠습니까?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#71717A] dark:text-[#A1A1AA]">
              확정 후에는 문서를 수정할 수 없습니다.
            </p>
            {canvas.missing_terms.length > 0 && (
              <p className="mt-2 rounded-lg bg-[#FFFBEB] px-3 py-2 text-xs font-medium text-[#B45309] dark:bg-[#271C0B] dark:text-[#FCD34D]">
                미작성 항목 {canvas.missing_terms.length}개가 남아 있습니다.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFinalizeConfirm(false)}
                className="rounded-lg border border-[#D4D4D8] px-3 py-1.5 text-xs font-semibold text-[#52525B] transition-colors hover:border-[#A1A1AA] dark:border-[#3F3F46] dark:text-[#D4D4D8]"
              >
                계속 편집
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onFinalize()) setShowFinalizeConfirm(false);
                }}
                className="rounded-lg bg-[#0066FF] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0052CC]"
              >
                문서 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CanvasPanel;
