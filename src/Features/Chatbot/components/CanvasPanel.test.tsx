import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CanvasPanel from "./CanvasPanel";
import { ContractCanvas } from "@app-types/Canvas.types";

const canvas: ContractCanvas = {
  schema_version: "contract.v1",
  canvas_type: "contract",
  canvas_id: "contract_123",
  version_id: "ver_001",
  base_version_id: null,
  status: "draft",
  metadata: {
    title: "테스트 계약서",
    contract_type: "service_agreement",
    parties: [],
  },
  sections: [
    {
      section_id: "sec_001",
      section_type: "article",
      title: "당사자",
      order: 1,
      metadata: { article_no: "제1조" },
      blocks: [
        {
          block_id: "blk_001_001",
          block_type: "table",
          meta_data: {},
          text:
            "| 회사 | 주식회사 케이씨○○○○<br>{회사 주소}<br>대표이사 {대표이사 성명} |<br>" +
            "| --- | --- |<br>" +
            "| 대표이사 | {대표이사 성명} ({생년월일})<br>{주소} |",
          source_refs: [
            {
              document_id: "doc_001",
              document_name: "/documents/기준 계약서.pdf",
              score: 0.9,
            },
          ],
        },
        {
          block_id: "blk_001_002",
          block_type: "table",
          meta_data: {},
          text:
            "| 구분 | 기준가격 | 수량 | 부여일 |\n" +
            "| --- | --- | --- | --- |\n" +
            "| 1회차 | {1회차 기준가격} | {1회차 수량} | {1회차 부여일} |\n" +
            "| 2회차 | {2회차 기준가격} | {2025년도의 CEO 연봉의 10%} ÷ {기준가격} | 2025년 정기주주총회 |\n" +
            "| … | … | … | … |\n" +
            "| N회차 | {N회차 기준가격} | {2024+(N-1)년도의 CEO 연봉의 10%} ÷ {기준가격} | 2024+(N-1)년 정기주주총회 |",
          source_refs: [],
        },
        {
          block_id: "blk_001_003",
          block_type: "paragraph",
          text: "제1조 (목적)",
          source_refs: [],
        },
      ],
    },
  ],
  missing_terms: [],
};

describe("CanvasPanel", () => {
  it("실제 서버 table 블록 두 형태를 예외 없이 렌더링한다", () => {
    const onChangeVersion = vi.fn(() => true);
    render(
      <CanvasPanel
        canvas={canvas}
        changedBlockIds={["blk_001_001"]}
        canUndo={true}
        canRedo={false}
        onClose={vi.fn()}
        activeActionContexts={[]}
        onEditBlock={vi.fn()}
        onAddBlockAfter={vi.fn()}
        onDeleteBlock={vi.fn()}
        onChangeVersion={onChangeVersion}
        onFinalize={vi.fn()}
      />,
    );

    expect(screen.getByText("회사")).toBeInTheDocument();
    expect(screen.getByText("대표이사")).toBeInTheDocument();
    expect(screen.getByText("구분")).toBeInTheDocument();
    expect(screen.getByText("1회차")).toBeInTheDocument();
    expect(screen.getByText("N회차")).toBeInTheDocument();
    expect(screen.getByText("제1조 (목적)")).toHaveClass("font-semibold");
    expect(screen.queryByText("제1조 당사자")).not.toBeInTheDocument();
    const sectionHeader = screen.getByRole("heading", { name: "당사자" }).parentElement!;
    expect(within(sectionHeader).getByText("기준 계약서.pdf")).toBeInTheDocument();
    expect(screen.queryByText("blk_001_001")).not.toBeInTheDocument();
    expect(screen.queryByText("table")).not.toBeInTheDocument();
    expect(screen.getByText("회사").closest("div")?.className).toContain(
      "[&_*]:!text-[#0066FF]",
    );
    expect(screen.getAllByRole("button", { name: "내용 수정하기" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "아래에 내용 추가하기" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "삭제하기" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "작업 메뉴 열기" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "되돌리기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "다시 실행" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
    expect(onChangeVersion).toHaveBeenCalledOnce();
    expect(onChangeVersion).toHaveBeenCalledWith("undo");
  });

  it("미작성 항목을 경고한 뒤 문서를 확정한다", async () => {
    const onFinalize = vi.fn(() => true);
    const canvasWithMissingTerm = {
      ...canvas,
      missing_terms: [
        {
          term_key: "contract_amount",
          label: "계약금액",
          description: "계약금액 입력",
          block_ids: ["blk_001_001"],
        },
      ],
    };

    render(
      <CanvasPanel
        canvas={canvasWithMissingTerm}
        changedBlockIds={[]}
        canUndo={false}
        canRedo={false}
        onClose={vi.fn()}
        activeActionContexts={[]}
        onEditBlock={vi.fn()}
        onAddBlockAfter={vi.fn()}
        onDeleteBlock={vi.fn()}
        onChangeVersion={vi.fn()}
        onFinalize={onFinalize}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "문서 확정" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("미작성 항목 1개가 남아 있습니다.")).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 확정" }),
    );
    expect(onFinalize).toHaveBeenCalledOnce();
  });
});
