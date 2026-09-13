// Retrieval suite: raw corpus + query → ranked evidence. Gold = sourceKey + mustContain (+ page overlap when present).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tomato } from "../../electron/tomato/tomato.ts";
import { BENCH_MODEL_CACHE, loadProfile, parseBenchArgs, readJsonl, writeResults } from "./common.ts";
import { mean, mrr, ndcg, percentile, recallAtK } from "./metrics.ts";

type Relevant = { sourceKey: string; locator?: { pageStart?: number; pageEnd?: number }; mustContain: string[] };
type RetrievalCase = { queryId: string; query: string; kind: string; relevant: Relevant[] };

const args = parseBenchArgs();
const profile = loadProfile(args.profilePath);
const cases = readJsonl<RetrievalCase>(join(args.datasetDir, "retrieval-cases.jsonl"));
const home = mkdtempSync(join(tmpdir(), "bench-retrieval-"));
const tomato = new Tomato(home, { modelCache: BENCH_MODEL_CACHE });
await tomato.registerCollection(join(args.datasetDir, "corpus"), "bench");
let embedError: string | undefined;
if (profile.retrieval.mode !== "keyword") {
  try {
    await tomato.embedMissing("bench");
  } catch (error) {
    embedError = error instanceof Error ? error.message : String(error);
  }
}

const runs: Array<Record<string, unknown>> = [];
for (const item of cases) {
  const startedAt = Date.now();
  const search = await tomato.search(item.query, { collections: ["bench"], mode: profile.retrieval.mode, limit: 10 });
  const latencyMs = Date.now() - startedAt;
  const hits: boolean[] = [];
  for (const result of search.results) {
    const [chunk] = await tomato.getNeighbors(result.chunkId, 0, 0);
    hits.push(item.relevant.some((gold) =>
      gold.sourceKey === result.relativePath &&
      gold.mustContain.every((text) => chunk.body.includes(text)) &&
      (!gold.locator?.pageStart || (chunk.pageStart !== undefined && chunk.pageStart <= (gold.locator.pageEnd ?? gold.locator.pageStart) && (chunk.pageEnd ?? chunk.pageStart) >= gold.locator.pageStart)),
    ));
  }
  const relevantTotal = item.relevant.length;
  runs.push({
    queryId: item.queryId,
    kind: item.kind,
    effectiveMode: search.effectiveMode,
    results: search.results.length,
    latencyMs,
    "recall@5": relevantTotal ? recallAtK(hits, 5, relevantTotal) : null,
    "recall@8": relevantTotal ? recallAtK(hits, 8, relevantTotal) : null,
    "mrr@10": relevantTotal ? mrr(hits, 10) : null,
    "ndcg@10": relevantTotal ? ndcg(hits, 10, relevantTotal) : null,
    noAnswerEmpty: relevantTotal ? null : search.results.length === 0,
    firstFailedStage: relevantTotal && !hits.some(Boolean) ? "retrieval" : null,
  });
}
rmSync(home, { recursive: true, force: true });

const scored = runs.filter((run) => run["recall@5"] !== null);
writeResults("retrieval", args, profile, {
  manifest: { embedError, effectiveModes: Object.fromEntries(["keyword", "semantic", "hybrid"].map((mode) => [mode, runs.filter((run) => run.effectiveMode === mode).length])) },
  runs,
  summary: {
    queries: cases.length,
    "recall@5": mean(scored.map((run) => Number(run["recall@5"]))),
    "recall@8": mean(scored.map((run) => Number(run["recall@8"]))),
    "mrr@10": mean(scored.map((run) => Number(run["mrr@10"]))),
    "ndcg@10": mean(scored.map((run) => Number(run["ndcg@10"]))),
    noAnswerEmptyRate: mean(runs.filter((run) => run.noAnswerEmpty !== null).map((run) => (run.noAnswerEmpty ? 1 : 0))),
    latencyP50: percentile(runs.map((run) => Number(run.latencyMs)), 50),
    latencyP95: percentile(runs.map((run) => Number(run.latencyMs)), 95),
    retrievalFailures: runs.filter((run) => run.firstFailedStage === "retrieval").length,
  },
});
