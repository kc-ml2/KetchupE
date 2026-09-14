// Failure-stage advisor: turns benchmark summaries into one-axis experiments. It never mutates production profiles.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

type Result = { manifest: Record<string, unknown>; summary: Record<string, unknown> };
export type Advice = { axis: "parser" | "chunking" | "retrieval" | "answer" | "policy" | "memory" | "resource"; evidence: string[]; experiment: string };

const value = (summary: Record<string, unknown>, key: string) => typeof summary[key] === "number" ? summary[key] as number : undefined;

export function recommend(results: Result[], budgets: { latencyMs?: number; rssMb?: number; tokens?: number } = {}): Advice[] {
  const evidence = new Map<Advice["axis"], string[]>();
  const add = (axis: Advice["axis"], message: string) => evidence.set(axis, [...(evidence.get(axis) ?? []), message]);
  for (const { manifest, summary } of results) {
    const suite = String(manifest.suite ?? "unknown");
    if (suite === "parse" && (value(summary, "parseSuccess") ?? 1) < 1) add("parser", `parseSuccess=${value(summary, "parseSuccess")}`);
    if (suite === "parse" && (value(summary, "locatorAccuracy") ?? 1) < 1) add("parser", `locatorAccuracy=${value(summary, "locatorAccuracy")}`);
    if (suite === "chunk" && (value(summary, "goldSpanCoverage") ?? 1) < 1) add("chunking", `goldSpanCoverage=${value(summary, "goldSpanCoverage")}`);
    if (suite === "retrieval" && (value(summary, "recall@8") ?? 1) < 1) add("retrieval", `recall@8=${value(summary, "recall@8")}`);
    if (suite === "rag" && (value(summary, "answerCorrectness") ?? 1) < 1) add("answer", `answerCorrectness=${value(summary, "answerCorrectness")}`);
    if (suite === "rag" && (value(summary, "citationValidity") ?? 1) < 1) add("answer", `citationValidity=${value(summary, "citationValidity")}`);
    if (suite === "policy" && (value(summary, "actionAccuracy") ?? 1) < 1) add("policy", `actionAccuracy=${value(summary, "actionAccuracy")}`);
    if (suite === "policy" && (value(summary, "brier") ?? 0) > 0.2) add("policy", `brier=${value(summary, "brier")}`);
    const stages = summary.failureStages as Record<string, number> | undefined;
    if (stages) for (const [stage, count] of Object.entries(stages)) {
      if (!count) continue;
      if (stage === "retrieval") add("retrieval", `${suite}.failureStages.retrieval=${count}`);
      if (stage === "generation" || stage === "citation") add("answer", `${suite}.failureStages.${stage}=${count}`);
      if (stage === "policy") add("policy", `${suite}.failureStages.policy=${count}`);
    }
    if (budgets.latencyMs !== undefined && (value(summary, "latencyP95") ?? 0) > budgets.latencyMs) add("resource", `${suite}.latencyP95=${value(summary, "latencyP95")}`);
    if (budgets.rssMb !== undefined && (value(summary, "rssMbP95") ?? 0) > budgets.rssMb) add("resource", `${suite}.rssMbP95=${value(summary, "rssMbP95")}`);
    if (budgets.tokens !== undefined && (value(summary, "totalTokensMean") ?? 0) > budgets.tokens) add("resource", `${suite}.totalTokensMean=${value(summary, "totalTokensMean")}`);
  }
  const experiments: Record<Advice["axis"], string> = {
    parser: "parser/OCR profile 하나만 변경하고 parse suite를 재실행",
    chunking: "chunk size·overlap·boundary 중 하나만 변경하고 chunk→retrieval→RAG 순서로 재실행",
    retrieval: "embedding·fusion·top-k 중 하나만 변경하고 retrieval과 agent suite를 재실행",
    answer: "answer prompt 또는 model 중 하나만 변경하고 frozen-evidence RAG와 agent suite를 재실행",
    policy: "ASK/VERIFY 기준 또는 policy prompt 중 하나만 변경하고 policy와 agent suite를 재실행",
    memory: "memory selection/expiry 중 하나만 변경하고 replay 및 held-out stream을 재실행",
    resource: "batch·thread·quantization 중 하나만 변경하고 동일 hardware profile에서 품질 회귀와 자원을 비교",
  };
  return [...evidence.entries()].sort((left, right) => right[1].length - left[1].length).map(([axis, messages]) => ({ axis, evidence: messages, experiment: experiments[axis] }));
}

function main(): void {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: "string" },
    "latency-budget": { type: "string" },
    "rss-budget": { type: "string" },
    "token-budget": { type: "string" },
  } });
  if (!positionals.length) throw new Error("usage: bench:advise -- [budgets] <result-dir>...");
  const results = positionals.map((dir) => ({
    manifest: JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>,
    summary: JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as Record<string, unknown>,
  }));
  const advice = recommend(results, {
    latencyMs: values["latency-budget"] === undefined ? undefined : Number(values["latency-budget"]),
    rssMb: values["rss-budget"] === undefined ? undefined : Number(values["rss-budget"]),
    tokens: values["token-budget"] === undefined ? undefined : Number(values["token-budget"]),
  });
  const output = `${JSON.stringify({ generatedAt: new Date().toISOString(), advice }, null, 2)}\n`;
  if (values.out) writeFileSync(resolve(values.out), output);
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
