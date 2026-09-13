// Chunk suite: canonical units (frozen or freshly parsed) → chunks. Gold spans must land inside one chunk.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkUnits, parseSource, type StructuralUnit } from "../../electron/tomato/tomato.ts";
import { loadProfile, parseBenchArgs, readJsonl, writeResults } from "./common.ts";
import { mean, percentile } from "./metrics.ts";

type ChunkCase = { caseId: string; sourceKey: string; canonical?: string; goldSpans: Array<{ mustContain: string[] }> };

const args = parseBenchArgs();
const profile = loadProfile(args.profilePath);
const cases = readJsonl<ChunkCase>(join(args.datasetDir, "chunk-cases.jsonl"));
const options = { targetTokens: Number(profile.retrieval.targetTokens), maxTokens: Number(profile.retrieval.maxTokens), overlapTokens: Number(profile.retrieval.overlapTokens) };
const runs: Array<Record<string, unknown>> = [];
const tokenCounts: number[] = [];

for (const item of cases) {
  let units: StructuralUnit[];
  if (item.canonical) {
    units = JSON.parse(readFileSync(join(args.datasetDir, item.canonical), "utf8")) as StructuralUnit[];
  } else {
    const path = join(args.datasetDir, "corpus", item.sourceKey);
    const buffer = readFileSync(path);
    units = (await parseSource(path, buffer, createHash("sha256").update(buffer).digest("hex"), "off")).units;
  }
  const chunks = chunkUnits(item.caseId, item.sourceKey, units, options);
  tokenCounts.push(...chunks.map((chunk) => chunk.tokenCount));
  const covered = item.goldSpans.map((span) => chunks.some((chunk) => span.mustContain.every((text) => chunk.body.includes(text))));
  const splitViolations = covered.filter((ok) => !ok).length;
  runs.push({ caseId: item.caseId, chunks: chunks.length, goldSpanCoverage: mean(covered.map((ok) => (ok ? 1 : 0))), splitViolations, maxTokens: Math.max(...chunks.map((chunk) => chunk.tokenCount)), firstFailedStage: splitViolations ? "chunk" : null });
}

writeResults("chunk", args, profile, {
  manifest: { chunkOptions: options },
  runs,
  summary: {
    cases: cases.length,
    goldSpanCoverage: mean(runs.map((run) => Number(run.goldSpanCoverage))),
    splitViolations: runs.reduce((sum, run) => sum + Number(run.splitViolations), 0),
    tokenP50: percentile(tokenCounts, 50),
    tokenP95: percentile(tokenCounts, 95),
    overMaxTokens: tokenCounts.filter((count) => count > options.maxTokens).length,
  },
});
