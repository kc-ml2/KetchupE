import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgentMessages from "./AgentMessages";

const defaults = {
  messages: [],
  streamingText: "",
  streamingRunId: null,
  streamingCitations: [],
  streamingAppliedContext: { memories: [] },
  progressText: null,
  hasMore: false,
  onLoadOlder: vi.fn(),
  onOpenCitation: vi.fn(),
  onInteraction: vi.fn(),
  onExportTrace: vi.fn(),
};

describe("AgentMessages", () => {
  it("진행 상태와 답변의 참고 문서 제목을 표시한다", () => {
    const onOpenCitation = vi.fn();
    const { rerender } = render(<AgentMessages {...defaults} progressText="문서 검색 중" />);
    expect(screen.getByText("문서 검색 중")).toBeInTheDocument();

    rerender(
      <AgentMessages
        {...defaults}
        streamingText="연차를 정산합니다 [[e1]]."
        streamingRunId="run-1"
        streamingCitations={[{ evidenceId: "e1", title: "인사 규정", breadcrumb: [], page: 2 }]}
        streamingAppliedContext={{ workspaceInstruction: "인사 규정에 근거해 답변", memories: [{ id: "memory-1", kind: "preference", content: "답변은 존댓말로 작성" }] }}
        onOpenCitation={onOpenCitation}
      />,
    );
    expect(screen.queryByText("문서 검색 중")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "[e1] 인사 규정 · 2쪽" }));
    expect(onOpenCitation).toHaveBeenCalledWith("run-1", "e1");
    expect(screen.getByText("인사 규정에 근거해 답변")).toBeInTheDocument();
    expect(screen.getByText(/답변은 존댓말로 작성/)).toBeInTheDocument();
  });
});
