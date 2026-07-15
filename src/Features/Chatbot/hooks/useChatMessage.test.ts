import { describe, expect, it } from "vitest";
import {
  getCanvasFeedbackEditCommand,
  getCanvasFeedbackEditOp,
  getChangedBlockIds,
  upsertThinkingMessage,
} from "./useChatMessage";
import { ContractCanvas } from "@app-types/Canvas.types";

describe("upsertThinkingMessage", () => {
  it("기존 thinking을 misc HTML 내용으로 교체한다", () => {
    expect(
      upsertThinkingMessage(
        [
          { role: "user", content: "계약서 작성해줘" },
          { role: "assistant", content: "", kind: "thinking" },
        ],
        "<strong>계약서를 검토하고 있어요.</strong>",
      ),
    ).toEqual([
      { role: "user", content: "계약서 작성해줘" },
      {
        role: "assistant",
        content: "<strong>계약서를 검토하고 있어요.</strong>",
        kind: "thinking",
        isStreaming: true,
      },
    ]);
  });
});

describe("getCanvasFeedbackEditOp", () => {
  it("선택한 블록이 없으면 canvas 전체 재생성 op을 만든다", () => {
    expect(getCanvasFeedbackEditCommand([], "전체적으로 더 간결하게 수정해줘"))
      .toEqual({
        op: "regenerate",
        feedback: "전체적으로 더 간결하게 수정해줘",
      });
  });

  it("canvas action을 awaiting_edit resume op으로 변환한다", () => {
    expect(
      getCanvasFeedbackEditOp(
        { op: "edit", block_id: "blk_1", label: "제1조" },
        "간결하게 수정해줘",
      ),
    ).toEqual({
      op: "edit",
      block_id: "blk_1",
      feedback: "간결하게 수정해줘",
    });

    expect(
      getCanvasFeedbackEditOp(
        {
          op: "add",
          section_id: "sec_1",
          after_block_id: "blk_1",
          label: "제1조",
        },
        "아래에 조항을 추가해줘",
      ),
    ).toEqual({
      op: "add",
      feedback: "아래에 조항을 추가해줘",
      after_block_id: "blk_1",
      section_id: "sec_1",
    });
  });

  it("여러 canvas action을 batch op으로 묶는다", () => {
    expect(
      getCanvasFeedbackEditCommand(
        [
          { op: "edit", block_id: "blk_1", label: "제1조" },
          { op: "edit", block_id: "blk_2", label: "제2조" },
        ],
        "간결하게 수정해줘",
      ),
    ).toEqual({
      op: "batch",
      ops: [
        {
          op: "edit",
          block_id: "blk_1",
          feedback: "간결하게 수정해줘",
        },
        {
          op: "edit",
          block_id: "blk_2",
          feedback: "간결하게 수정해줘",
        },
      ],
    });
  });
});

describe("getChangedBlockIds", () => {
  it("수정되거나 추가된 블록만 찾는다", () => {
    const previous = {
      sections: [
        {
          blocks: [
            { block_id: "same", block_type: "paragraph", text: "같음" },
            { block_id: "edited", block_type: "paragraph", text: "이전" },
          ],
        },
      ],
    } as ContractCanvas;
    const current = {
      sections: [
        {
          blocks: [
            { block_id: "same", block_type: "paragraph", text: "같음" },
            { block_id: "edited", block_type: "paragraph", text: "수정" },
            { block_id: "added", block_type: "paragraph", text: "추가" },
          ],
        },
      ],
    } as ContractCanvas;

    expect(getChangedBlockIds(previous, current)).toEqual(["edited", "added"]);
  });
});
