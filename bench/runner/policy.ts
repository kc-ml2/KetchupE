// Frozen-state policy replay: same PolicyState → compare action/difficulty/calibration/budget across profiles.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDecision, type PolicyAction, type PolicyState, type ReasonCode } from "../../electron/agent/contracts.ts";
import { alwaysSearchDecision, derivePolicySignals } from "../../electron/agent/policy.ts";
import { loadProfile, parseBenchArgs, readJsonl, writeResults } from "./common.ts";
import { brier, ece, macroF1, mean, riskCoverage } from "./metrics.ts";
import { benchModelAlias, benchModelClient } from "./policies.ts";

type PolicyCase = {
  caseId: string;
  stateFixture: string;
  difficulty: 0 | 1 | 2 | 3;
  allowedActions: PolicyAction[];
  successWithinBudget: boolean;
  requiredReasonCodes?: ReasonCode[];
};

const args = parseBenchArgs();
const profile = loadProfile(args.profilePath);
profile.policy.modelAlias = await benchModelAlias(profile.policy.modelAlias);
profile.answer.modelAlias = await benchModelAlias(profile.answer.modelAlias);
const client = benchModelClient(args.client);
const cases = readJsonl<PolicyCase>(join(args.datasetDir, "policy-cases.jsonl"));

const runs: Array<Record<string, unknown>> = [];
for (let run = 1; run <= args.runs; run += 1) {
  for (const item of cases) {
    const state = JSON.parse(readFileSync(join(args.datasetDir, item.stateFixture), "utf8")) as PolicyState;
    state.signals = derivePolicySignals(state);
    const startedAt = Date.now();
    let record: Record<string, unknown> = { run, caseId: item.caseId, difficulty: item.difficulty, allowedActions: item.allowedActions };
    try {
      let raw;
      if (profile.policy.strategy === "always-search") {
        raw = alwaysSearchDecision(state, profile.policy.version);
      } else {
        if (state.remaining.modelCalls <= 0) throw new Error("no model calls remaining for policy decision");
        state.remaining.modelCalls -= 1;
        raw = await client.decide(state, profile.policy, new AbortController().signal);
      }
      const validation = validateDecision(raw, state, profile.policy.allowedActions);
      const decision = validation.ok ? validation.decision : undefined;
      const call = profile.policy.strategy === "llm" && client.lastCall?.purpose === "policy" ? client.lastCall : undefined;
      record = {
        ...record,
        latencyMs: Date.now() - startedAt,
        decision: raw,
        signals: state.signals,
        valid: validation.ok,
        modelCalls: profile.policy.strategy === "llm" ? 1 : 0,
        promptTokens: call?.promptTokens ?? 0,
        completionTokens: call?.completionTokens ?? 0,
        budgetViolation: !validation.ok && validation.code === "BUDGET_EXCEEDED",
        actionCorrect: decision ? item.allowedActions.includes(decision.action) : false,
        reasonCorrect: decision ? !item.requiredReasonCodes || item.requiredReasonCodes.includes(decision.reasonCode) : false,
        predictedDifficulty: decision?.taskDifficulty,
        predictedSuccess: decision?.predictedSuccess,
        firstFailedStage: decision ? (item.allowedActions.includes(decision.action) ? null : "policy") : "runtime",
      };
    } catch (error) {
      record = { ...record, latencyMs: Date.now() - startedAt, valid: false, actionCorrect: false, error: error instanceof Error ? error.message : String(error), firstFailedStage: "runtime" };
    }
    runs.push(record);
  }
}

const valid = runs.filter((record) => record.valid);
const summary = {
  cases: cases.length,
  runs: args.runs,
  validRate: mean(runs.map((record) => (record.valid ? 1 : 0))),
  actionAccuracy: mean(runs.map((record) => (record.actionCorrect ? 1 : 0))),
  reasonAccuracy: mean(valid.map((record) => (record.reasonCorrect ? 1 : 0))),
  difficultyMacroF1: macroF1(valid.map((record) => ({ predicted: Number(record.predictedDifficulty), actual: Number(record.difficulty) }))),
  brier: brier(valid.map((record) => ({ predicted: Number(record.predictedSuccess), outcome: Boolean(record.actionCorrect) && (cases.find((item) => item.caseId === record.caseId)?.successWithinBudget ?? false) }))),
  ece: ece(valid.map((record) => ({ predicted: Number(record.predictedSuccess), outcome: Boolean(record.actionCorrect) && (cases.find((item) => item.caseId === record.caseId)?.successWithinBudget ?? false) }))),
  riskCoverage: riskCoverage(valid.map((record) => ({ predicted: Number(record.predictedSuccess), outcome: Boolean(record.actionCorrect) && (cases.find((item) => item.caseId === record.caseId)?.successWithinBudget ?? false) }))),
  budgetViolations: runs.filter((record) => record.budgetViolation).length,
  modelCallsMean: mean(runs.map((record) => Number(record.modelCalls ?? 0))),
  totalTokensMean: mean(runs.map((record) => Number(record.promptTokens ?? 0) + Number(record.completionTokens ?? 0))),
  latencyMsMean: mean(runs.map((record) => Number(record.latencyMs))),
  failureStages: Object.fromEntries(["policy", "runtime"].map((stage) => [stage, runs.filter((record) => record.firstFailedStage === stage).length])),
};
writeResults("policy", args, profile, { manifest: {}, runs, summary });
