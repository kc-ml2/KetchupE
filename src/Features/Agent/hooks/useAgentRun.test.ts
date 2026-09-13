import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, KetchupEAgentAPI } from "@app-types/Agent.types";
import { useAgentRun } from "./useAgentRun";

function fakeApi() {
  let listener: ((event: AgentStreamEvent) => void) | undefined;
  const api = {
    openRun: vi.fn().mockResolvedValue(null),
    resumeRun: vi.fn().mockResolvedValue(undefined),
    onAgentEvent: vi.fn((next: (event: AgentStreamEvent) => void) => {
      listener = next;
      return () => undefined;
    }),
  } as unknown as KetchupEAgentAPI;
  return { api, emit: (event: AgentStreamEvent) => act(() => listener?.(event)) };
}

describe("useAgentRun", () => {
  it("streams text deltas and keeps the completed payload visible until messages reload", () => {
    const { api, emit } = fakeApi();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useAgentRun(api, "thread-1", onSettled), { wrapper: StrictMode });
    act(() => result.current.attach("run-1"));
    emit({ runId: "run-1", seq: 1, type: "status", payload: { phase: "searching" } });
    emit({ runId: "run-1", seq: 2, type: "text_delta", payload: { text: "미사용 " } });
    emit({ runId: "run-1", seq: 3, type: "text_delta", payload: { text: "연차는" } });
    expect(result.current.view.streamingText).toBe("미사용 연차는");
    expect(result.current.view.phase).toBe("searching");
    emit({ runId: "run-1", seq: 3, type: "text_delta", payload: { text: "(dup)" } });
    emit({ runId: "other", seq: 4, type: "text_delta", payload: { text: "(other)" } });
    expect(result.current.view.streamingText).toBe("미사용 연차는");
    emit({ runId: "run-1", seq: 4, type: "completed", payload: { outcome: "success", text: "미사용 연차는", citations: [{ evidenceId: "e1", title: "취업규칙", breadcrumb: [] }], appliedContext: { workspaceInstruction: "인사 규정만 사용", memories: [] } } });
    expect(result.current.view).toMatchObject({ isRunning: false, streamingText: "미사용 연차는", citations: [{ evidenceId: "e1", title: "취업규칙" }], appliedContext: { workspaceInstruction: "인사 규정만 사용" } });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("restores an ASK-waiting agent run but ignores canvas runs", async () => {
    const { api } = fakeApi();
    (api.openRun as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ runId: "run-2", status: "waiting_user", kind: "agent" });
    const { result } = renderHook(() => useAgentRun(api, "thread-2", () => undefined));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.view).toMatchObject({ runId: "run-2", waitingQuestion: "" });
    (api.openRun as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ runId: "run-3", status: "waiting_user", kind: "canvas" });
    const other = renderHook(() => useAgentRun(api, "thread-3", () => undefined));
    await act(async () => {
      await Promise.resolve();
    });
    expect(other.result.current.view.runId).toBeNull();
  });

  it("reattaches to a running agent after navigating to its thread", async () => {
    const { api } = fakeApi();
    (api.openRun as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ runId: "run-live", status: "running", kind: "agent" });
    const { result } = renderHook(() => useAgentRun(api, "thread-live", () => undefined));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.view).toMatchObject({ runId: "run-live", isRunning: true, phase: "deciding" });
  });
});
