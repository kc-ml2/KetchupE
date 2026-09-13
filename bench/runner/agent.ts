// Agent suite: scripted messages → complete run trajectory through the real Harness, Tomato, and model adapter.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { openAgentDb } from "../../electron/db/openAgentDb.ts";
import { Harness } from "../../electron/agent/harness.ts";
import { confirmMemory, proposeMemory } from "../../electron/agent/memory.ts";
import { createThread, ensureWorkspace, getRun, loadThread } from "../../electron/agent/store.ts";
import { tomatoTools } from "../../electron/agent/tools.ts";
import { readTrace, transitions } from "../../electron/agent/trace.ts";
import type { MemoryKind } from "../../src/app-types/Agent.types.ts";
import { PIPELINE_PROFILE, Tomato } from "../../electron/tomato/tomato.ts";
import { BENCH_MODEL_CACHE, loadProfile, parseBenchArgs, readJsonl, writeResults } from "./common.ts";
import { brier, ece, mean, percentile, riskCoverage } from "./metrics.ts";
import { benchModelAlias, benchModelClient } from "./policies.ts";

type AgentCase = {
  caseId: string;
  scenario: string;
  message: string;
  userReplies?: Array<{ ifQuestionContains: string[]; reply: string }>;
  memories?: string[];
  needsClarification?: boolean;
  expect: { mustContain?: string[]; mustNotContain?: string[]; sourceKey?: string; allowStop?: boolean; allowNoSearch?: boolean; maxSearches?: number };
};
type MemorySeed = { id: string; kind: MemoryKind; content: string; pinned: boolean };

const MAX_USER_TURNS = 2;
const DEFAULT_REPLY = "잘 모르겠어요. 일반적인 경우로 알려주세요.";

const args = parseBenchArgs();
const profile = loadProfile(args.profilePath);
profile.policy.modelAlias = await benchModelAlias(profile.policy.modelAlias);
profile.answer.modelAlias = await benchModelAlias(profile.answer.modelAlias);
const cases = readJsonl<AgentCase>(join(args.datasetDir, "agent-cases.jsonl"));
const memorySeeds = readJsonl<MemorySeed>(join(args.datasetDir, "memories.jsonl"));

const home = mkdtempSync(join(tmpdir(), "bench-agent-"));
const tomato = new Tomato(home, { modelCache: BENCH_MODEL_CACHE });
await tomato.registerCollection(join(args.datasetDir, "corpus"), "bench");
if (profile.retrieval.mode !== "keyword") {
  try {
    await tomato.embedMissing("bench");
  } catch (error) {
    console.warn("embedding unavailable, keyword fallback:", error instanceof Error ? error.message : error);
  }
}

const runs: Array<Record<string, unknown>> = [];
for (let run = 1; run <= args.runs; run += 1) {
  for (const item of cases) {
    const db = openAgentDb(":memory:");
    const workspace = ensureWorkspace(db);
    for (const seedId of item.memories ?? []) {
      const seed = memorySeeds.find((memory) => memory.id === seedId);
      if (seed) confirmMemory(db, proposeMemory(db, { workspaceId: workspace.id, kind: seed.kind, content: seed.content }));
    }
    const harness = new Harness({
      db,
      model: benchModelClient(args.client),
      tools: tomatoTools(tomato, { mode: profile.retrieval.mode, topK: profile.retrieval.topK }),
      profiles: { retrieval: { ...PIPELINE_PROFILE, ...profile.retrieval }, policy: profile.policy, answer: profile.answer },
      activeCollections: () => ["bench"],
    });
    const thread = createThread(db, workspace.id);
    const startedAt = Date.now();
    const cpuStarted = process.cpuUsage();
    let handle = harness.startRun({ workspaceId: workspace.id, threadId: thread.id, text: item.message });
    await handle.done;
    let userTurns = 0;
    let clarificationMatched = false;
    while (getRun(db, handle.runId).status === "waiting_user" && userTurns < MAX_USER_TURNS) {
      const question = loadThread(db, thread.id).messages.at(-1)?.content ?? "";
      const scripted = item.userReplies?.find((reply) => reply.ifQuestionContains.some((needle) => question.includes(needle)));
      clarificationMatched ||= Boolean(scripted);
      userTurns += 1;
      handle = harness.startRun({ workspaceId: workspace.id, threadId: thread.id, text: scripted?.reply ?? DEFAULT_REPLY });
      await handle.done;
    }
    const latencyMs = Date.now() - startedAt;
    const record = getRun(db, handle.runId);
    const trajectory = transitions(db, handle.runId);
    const trace = readTrace(db, handle.runId);
    const cpu = process.cpuUsage(cpuStarted);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const rssMb = process.memoryUsage().rss / 1024 / 1024;
    const answer = loadThread(db, thread.id).messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    const actions = trajectory.map((transition) => transition.decision.action);
    const searches = actions.filter((action) => action === "SEARCH").length;
    const asked = actions.includes("ASK");
    const verified = actions.includes("VERIFY");
    const evidenceGain = trajectory.filter((transition) => transition.decision.action === "SEARCH").map((transition, index, all) => {
      const next = all[index + 1]?.state.evidence.length ?? trajectory.at(-1)?.state.evidence.length ?? 0;
      return next - transition.state.evidence.length;
    });
    const modelCalls = trace.filter((event) => event.type === "model.completed");
    const promptTokens = modelCalls.reduce((sum, event) => sum + Number(event.payload.promptTokens ?? 0), 0);
    const completionTokens = modelCalls.reduce((sum, event) => sum + Number(event.payload.completionTokens ?? 0), 0);
    const toolCalls = trace.filter((event) => event.type === "tool.started").length;
    const validated = trace.findLast((event) => event.type === "answer.validated");
    const citedIds = new Set(Array.isArray(validated?.payload.valid) ? validated.payload.valid.map(String) : []);
    const citationRows = db.prepare("SELECT evidence_id, path FROM citations WHERE run_id = ?").all(handle.runId) as Array<{ evidence_id: string; path: string }>;
    const citedSourceKeys = new Set(citationRows.filter((row) => citedIds.has(row.evidence_id)).map((row) => basename(row.path)));
    const citationFailures = trace.filter((event) => event.type === "answer.validated" && event.payload.failed).length;

    const mustContainOk = (item.expect.mustContain ?? []).every((text) => answer.includes(text));
    const mustNotContainOk = (item.expect.mustNotContain ?? []).every((text) => !answer.includes(text));
    const searchesOk = item.expect.maxSearches === undefined || searches <= item.expect.maxSearches;
    const sourceOk = !item.expect.sourceKey || citedSourceKeys.has(item.expect.sourceKey);
    let success = false;
    let firstFailedStage: string | null = null;
    if (record.status === "completed") {
      success = mustContainOk && mustNotContainOk && searchesOk && sourceOk;
      if (!success) firstFailedStage = !searchesOk ? "policy" : !sourceOk ? "citation" : trajectory.some((transition) => transition.state.evidence.some((evidence) => (item.expect.mustContain ?? []).some((text) => evidence.snippet.includes(text)))) ? "generation" : "retrieval";
    } else if (record.status === "abstained") {
      success = Boolean(item.expect.allowStop) && mustNotContainOk;
      if (!success) firstFailedStage = "policy";
    } else {
      firstFailedStage = "runtime";
    }
    runs.push({
      run,
      caseId: item.caseId,
      scenario: item.scenario,
      status: record.status,
      errorCode: record.errorCode,
      actions,
      steps: trajectory.length,
      searches,
      toolCalls,
      modelCalls: modelCalls.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      asked,
      verified,
      clarificationMatched,
      evidenceGainPerHop: mean(evidenceGain),
      predictedSuccess: trajectory[0]?.decision.predictedSuccess,
      taskDifficulty: trajectory[0]?.decision.taskDifficulty,
      success,
      firstFailedStage,
      citationFailures,
      latencyMs,
      cpuMs,
      rssMb,
      answerPreview: answer.slice(0, 120),
      citedSourceKeys: [...citedSourceKeys],
    });
    db.close();
  }
}
rmSync(home, { recursive: true, force: true });

const askedRuns = runs.filter((run) => run.asked);
const clarificationCases = runs.filter((run) => cases.find((item) => item.caseId === run.caseId)?.needsClarification);
const nonClarificationCases = runs.filter((run) => !cases.find((item) => item.caseId === run.caseId)?.needsClarification);
const verifiedRuns = runs.filter((run) => run.verified);
const forecasts = runs.filter((run) => typeof run.predictedSuccess === "number").map((run) => ({ predicted: Number(run.predictedSuccess), outcome: Boolean(run.success) }));
writeResults("agent", args, profile, {
  manifest: {},
  runs,
  summary: {
    cases: cases.length,
    runs: args.runs,
    taskSuccess: mean(runs.map((run) => (run.success ? 1 : 0))),
    stepsMean: mean(runs.map((run) => Number(run.steps))),
    searchesMean: mean(runs.map((run) => Number(run.searches))),
    toolCallsMean: mean(runs.map((run) => Number(run.toolCalls))),
    modelCallsMean: mean(runs.map((run) => Number(run.modelCalls))),
    promptTokensMean: mean(runs.map((run) => Number(run.promptTokens))),
    completionTokensMean: mean(runs.map((run) => Number(run.completionTokens))),
    totalTokensMean: mean(runs.map((run) => Number(run.totalTokens))),
    evidenceGainPerHop: mean(runs.map((run) => Number(run.evidenceGainPerHop))),
    askRate: mean(runs.map((run) => (run.asked ? 1 : 0))),
    clarificationRecall: clarificationCases.length ? mean(clarificationCases.map((run) => (run.asked ? 1 : 0))) : null,
    unnecessaryAskRate: nonClarificationCases.length ? mean(nonClarificationCases.map((run) => (run.asked ? 1 : 0))) : null,
    clarificationSuccessWhenAsked: askedRuns.length ? mean(askedRuns.map((run) => (run.success ? 1 : 0))) : null,
    verifyRate: mean(runs.map((run) => (run.verified ? 1 : 0))),
    verificationSuccessWhenUsed: verifiedRuns.length ? mean(verifiedRuns.map((run) => (run.success ? 1 : 0))) : null,
    predictedSuccessBrier: brier(forecasts),
    predictedSuccessEce: ece(forecasts),
    predictedSuccessRiskCoverage: riskCoverage(forecasts),
    citationFailures: runs.reduce((sum, run) => sum + Number(run.citationFailures), 0),
    latencyP50: percentile(runs.map((run) => Number(run.latencyMs)), 50),
    latencyP95: percentile(runs.map((run) => Number(run.latencyMs)), 95),
    cpuMsMean: mean(runs.map((run) => Number(run.cpuMs))),
    rssMbP95: percentile(runs.map((run) => Number(run.rssMb)), 95),
    failureStages: Object.fromEntries(["retrieval", "policy", "generation", "citation", "runtime"].map((stage) => [stage, runs.filter((run) => run.firstFailedStage === stage).length])),
  },
});
