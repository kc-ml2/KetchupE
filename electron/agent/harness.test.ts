// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "../../src/app-types/Agent.types.ts";
import { openAgentDb } from "../db/openAgentDb.ts";
import { PIPELINE_PROFILE, Tomato } from "../tomato/tomato.ts";
import type { PolicyDecision, PolicyProfile, PolicyState } from "./contracts.ts";
import { Harness } from "./harness.ts";
import { addMemory, confirmMemory, proposeMemory } from "./memory.ts";
import { createFixtureClient, type FixtureScript } from "./modelClient.ts";
import { ANSWER_PROMPT_VERSION, DEFAULT_POLICY_PROFILE } from "./policy.ts";
import { createThread, deleteThread, ensureWorkspace, getRun, listThreads, loadThread, setActiveTask } from "./store.ts";
import { tomatoTools } from "./tools.ts";
import { exportTraceJsonl, readTrace, transitions } from "./trace.ts";

const base = { taskDifficulty: 1, predictedSuccess: 0.8, evidenceSufficiency: 0.5, policyVersion: "orchestration-1" } as const;
const search = (query: string): PolicyDecision => ({ ...base, action: "SEARCH", reasonCode: "MISSING_EVIDENCE", search: { tool: "search_local_docs", query } });
const answer: PolicyDecision = { ...base, action: "ANSWER", reasonCode: "ENOUGH_EVIDENCE" };

let temporary: string;
let tomato: Tomato;
const db = openAgentDb(":memory:");
const workspace = ensureWorkspace(db);

function harness(script: FixtureScript, events: AgentStreamEvent[] = [], policy: PolicyProfile = DEFAULT_POLICY_PROFILE) {
  return new Harness({
    db,
    model: createFixtureClient(script),
    tools: tomatoTools(tomato, { mode: "hybrid", topK: 8 }),
    profiles: { retrieval: PIPELINE_PROFILE, policy, answer: { modelAlias: "fixture", promptVersion: ANSWER_PROMPT_VERSION, temperature: 0 } },
    activeCollections: () => ["work"],
    emit: (event) => events.push(event),
  });
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "harness-"));
  const documents = join(temporary, "docs");
  await mkdir(documents);
  await writeFile(join(documents, "handbook.md"), "# 인사 규정\n\n## 연차\n\n퇴직 시 미사용 연차는 퇴직일 기준으로 수당으로 정산한다.\n\n## 휴가\n\n경조사 휴가는 5일이다.\n");
  tomato = new Tomato(join(temporary, "home"));
  await tomato.registerCollection(documents, "work");
});

afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("harness", () => {
  it("SEARCH → ANSWER with validated citation and trace", async () => {
    const events: AgentStreamEvent[] = [];
    const thread = createThread(db, workspace.id);
    const handle = harness({ decide: [search("미사용 연차 정산"), answer], answer: "미사용 연차는 수당으로 정산합니다 [[e1]] [[e9]]." }, events).startRun({ workspaceId: workspace.id, threadId: thread.id, text: "퇴직 전 연차는 어떻게 정산하나?" });
    await handle.done;

    expect(getRun(db, handle.runId).status).toBe("completed");
    const page = loadThread(db, thread.id);
    expect(page.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(page.messages[1].content).toBe("미사용 연차는 수당으로 정산합니다 [[e1]].");
    expect(page.messages[1].citations).toMatchObject([{ evidenceId: "e1", title: "인사 규정" }]);
    const trajectory = transitions(db, handle.runId);
    expect(trajectory.map((transition) => transition.decision.action)).toEqual(["SEARCH", "ANSWER"]);
    expect(trajectory[1].state.evidence[0].evidenceId).toBe("e1");
    expect(trajectory[1].state.lastObservation).toMatchObject({ kind: "search", effectiveMode: "keyword" });
    expect(trajectory[1].state.signals).toMatchObject({ evidenceCount: 1, uniqueSourceCount: 1 });
    expect(trajectory[0].observation).toMatchObject({ kind: "search", resultIds: ["e1"] });
    expect(trajectory[1].outcome).toBe("success");
    expect(events.some((event) => event.type === "text_delta")).toBe(true);
    expect(events.filter((event) => event.type === "citation")).toHaveLength(1);

    const jsonl = exportTraceJsonl(db, handle.runId);
    expect(jsonl).not.toContain("미사용 연차");
    expect(jsonl).not.toContain(temporary);
    expect(jsonl).toContain("policy.decided");
  });

  it("ASK → waiting_user → resume → ANSWER keeps one run trajectory", async () => {
    const thread = createThread(db, workspace.id);
    const decide = (state: PolicyState): PolicyDecision => {
      if (state.step === 1) return { ...base, action: "ASK", reasonCode: "MISSING_USER_INPUT", question: "정규직인가요, 계약직인가요?" };
      if (state.previousDecisions.at(-1) === "ASK") return search("연차 정산");
      return answer;
    };
    const first = harness({ decide, answer: "정산합니다 [[e1]]" }).startRun({ workspaceId: workspace.id, threadId: thread.id, text: "연차 정산 알려줘" });
    await first.done;
    expect(getRun(db, first.runId).status).toBe("waiting_user");

    const second = harness({ decide, answer: "정산합니다 [[e1]]" }).startRun({ workspaceId: workspace.id, threadId: thread.id, text: "정규직" });
    await second.done;
    expect(second.runId).toBe(first.runId);
    expect(getRun(db, first.runId).status).toBe("completed");
    const actions = transitions(db, first.runId).map((transition) => transition.decision.action);
    expect(actions).toEqual(["ASK", "SEARCH", "ANSWER"]);
    expect(transitions(db, first.runId)[1].state.lastObservation?.kind).toBe("user");
    expect(loadThread(db, thread.id).messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("budget wins: repeated searches are deduped and over-budget SEARCH is coerced", async () => {
    const thread = createThread(db, workspace.id);
    const queries = ["연차 1", "연차 1", "연차 2", "연차 3", "연차 4"];
    const decide = (): PolicyDecision => search(queries.shift() ?? "연차 5");
    const handle = harness({ decide, answer: "답 [[e1]]" }).startRun({ workspaceId: workspace.id, threadId: thread.id, text: "budget" });
    await handle.done;
    const trajectory = transitions(db, handle.runId);
    expect(trajectory.map((transition) => transition.decision.action)).toEqual(["SEARCH", "SEARCH", "SEARCH", "SEARCH", "ANSWER"]);
    expect(trajectory.at(-1)?.decision.reasonCode).toBe("BUDGET_LIMIT");
    expect(readTrace(db, handle.runId).filter((event) => event.type === "tool.completed" && event.payload.cached)).toHaveLength(1);
    expect(getRun(db, handle.runId).status).toBe("completed");
  });

  it("runs the fixed policy with the same model client reserved for answer generation", async () => {
    const thread = createThread(db, workspace.id);
    const calls: string[] = [];
    const profile: PolicyProfile = { ...DEFAULT_POLICY_PROFILE, strategy: "always-search", allowedActions: ["SEARCH", "ANSWER", "STOP"] };
    const handle = harness({ decide: () => { throw new Error("fixed policy must not call the model"); }, answer: "정산합니다 [[e1]]", onCall: (call) => calls.push(call.purpose) }, [], profile)
      .startRun({ workspaceId: workspace.id, threadId: thread.id, text: "연차 정산" });
    await handle.done;

    expect(getRun(db, handle.runId).status).toBe("completed");
    expect(transitions(db, handle.runId).map((transition) => transition.decision.action)).toEqual(["SEARCH", "ANSWER"]);
    expect(calls).toEqual(["answer"]);
  });

  it("does not exceed the model-call budget for answer generation", async () => {
    const thread = createThread(db, workspace.id);
    const profile: PolicyProfile = { ...DEFAULT_POLICY_PROFILE, maxModelCalls: 1 };
    const handle = harness({ decide: [answer], answer: "예산을 넘긴 답변" }, [], profile)
      .startRun({ workspaceId: workspace.id, threadId: thread.id, text: "budget" });
    await handle.done;

    expect(getRun(db, handle.runId).status).toBe("abstained");
    expect(transitions(db, handle.runId).at(-1)?.decision).toMatchObject({ action: "STOP", reasonCode: "BUDGET_LIMIT" });
    expect(readTrace(db, handle.runId).filter((event) => event.type === "model.completed")).toHaveLength(1);
  });

  it("deletes a settled thread and its run data", async () => {
    const thread = createThread(db, workspace.id);
    const handle = harness({ decide: [search("연차"), answer], answer: "정산합니다 [[e1]]" }).startRun({ workspaceId: workspace.id, threadId: thread.id, text: "삭제할 대화" });
    await handle.done;
    deleteThread(db, thread.id);
    expect(listThreads(db, workspace.id).some((item) => item.id === thread.id)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM runs WHERE thread_id = ?").get(thread.id)).toMatchObject({ count: 0 });
  });

  it("uses confirmed memory in context and rejects answers without known evidence citations", async () => {
    const id = proposeMemory(db, { workspaceId: workspace.id, kind: "preference", content: "답변은 존댓말로" });
    confirmMemory(db, id);
    const thread = createThread(db, workspace.id);
    const handle = harness({ decide: [search("연차"), answer], answer: "근거 [[e7]]" }).startRun({ workspaceId: workspace.id, threadId: thread.id, text: "연차 존댓말" });
    await handle.done;
    expect(getRun(db, handle.runId)).toMatchObject({ status: "failed", errorCode: "INVALID_CITATION" });
    expect(transitions(db, handle.runId)[0].state.selectedMemories[0].content).toBe("답변은 존댓말로");
  });

  it("stores the instruction and memories actually applied to an answer", async () => {
    const scopedWorkspace = ensureWorkspace(db, "applied-context");
    setActiveTask(db, scopedWorkspace.id, "불확실하면 확인 질문하기");
    const memoryId = addMemory(db, scopedWorkspace.id, { kind: "preference", content: "답변은 존댓말로", pinned: true });
    const thread = createThread(db, scopedWorkspace.id);
    const events: AgentStreamEvent[] = [];
    const handle = harness({ decide: [search("연차"), answer], answer: "정산합니다 [[e1]]" }, events)
      .startRun({ workspaceId: scopedWorkspace.id, threadId: thread.id, text: "연차 정산" });
    await handle.done;

    expect(loadThread(db, thread.id).messages.at(-1)?.appliedContext).toEqual({
      workspaceInstruction: "불확실하면 확인 질문하기",
      memories: [{ id: memoryId, kind: "preference", content: "답변은 존댓말로" }],
    });
    expect(events.at(-1)).toMatchObject({ type: "completed", payload: { appliedContext: { memories: [{ id: memoryId }] } } });
  });

  it("cancel aborts the run", async () => {
    const thread = createThread(db, workspace.id);
    const events: AgentStreamEvent[] = [];
    const instance = harness({ decide: async () => new Promise<PolicyDecision>(() => undefined) } as unknown as FixtureScript, events);
    const handle = instance.startRun({ workspaceId: workspace.id, threadId: thread.id, text: "cancel" });
    instance.cancelRun(handle.runId);
    await handle.done;
    expect(getRun(db, handle.runId).status).toBe("cancelled");
    expect(events.at(-1)).toMatchObject({ type: "failed", payload: { code: "CANCELLED" } });
  });
});
