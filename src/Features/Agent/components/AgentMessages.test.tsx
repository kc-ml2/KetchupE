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

  it("답변을 마크다운으로 렌더링하고 [[eN]]은 인용 칩으로 남긴다", () => {
    const onOpenCitation = vi.fn();
    render(
      <AgentMessages
        {...defaults}
        streamingRunId="run-1"
        streamingText={"## 연차 정산\n\n- **미사용 연차**는 수당으로 지급 [[e1]]\n- `통상임금` 기준"}
        onOpenCitation={onOpenCitation}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "연차 정산" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("미사용 연차").tagName).toBe("STRONG");
    expect(screen.getByText("통상임금").tagName).toBe("CODE");

    fireEvent.click(screen.getByRole("button", { name: "e1" }));
    expect(onOpenCitation).toHaveBeenCalledWith("run-1", "e1");
  });

  it("답변 텍스트를 복사한다", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <AgentMessages
        {...defaults}
        messages={[{
          id: "message-1",
          threadId: "thread-1",
          runId: "run-1",
          role: "assistant",
          content: "복사할 답변",
          citations: [],
          appliedContext: { memories: [] },
          createdAt: "2026-09-15T00:00:00.000Z",
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "답변 복사" }));
    expect(writeText).toHaveBeenCalledWith("복사할 답변");
  });
});
