// npm run bench:compare -- bench/results/<baseline> bench/results/<candidate>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [baselineDir, candidateDir] = process.argv.slice(2);
if (!baselineDir || !candidateDir) {
  console.error("usage: bench:compare <baseline-dir> <candidate-dir>");
  process.exit(2);
}
const read = (dir: string) => ({
  manifest: JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>,
  summary: JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as Record<string, unknown>,
  runs: readFileSync(join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
});
const baseline = read(baselineDir);
const candidate = read(candidateDir);
if (baseline.manifest.suite !== candidate.manifest.suite) console.warn(`suite mismatch: ${baseline.manifest.suite} vs ${candidate.manifest.suite}`);
if (baseline.manifest.datasetHash !== candidate.manifest.datasetHash) console.warn("dataset hash differs; deltas are not comparable");
if (baseline.manifest.client !== candidate.manifest.client) console.warn("model client differs; policy effects are not isolated");
for (const component of ["retrieval", "answer"] as const) {
  const before = (baseline.manifest.fingerprints as Record<string, string> | undefined)?.[component];
  const after = (candidate.manifest.fingerprints as Record<string, string> | undefined)?.[component];
  if (before !== after) console.warn(`${component} profile differs; policy effects are not isolated`);
}

const HIGHER_IS_BETTER = new Set(["actionAccuracy", "reasonAccuracy", "difficultyMacroF1", "validRate", "taskSuccess", "citationF1", "recall@5", "recall@8", "mrr@10", "ndcg@10", "locatorAccuracy", "parseSuccess", "requiredUnitRecall", "goldSpanCoverage", "verificationSuccessWhenUsed", "clarificationRecall", "clarificationSuccessWhenAsked"]);
const rows: string[] = [`metric | ${baseline.manifest.profile} | ${candidate.manifest.profile} | delta`];
for (const [key, value] of Object.entries(candidate.summary)) {
  const before = baseline.summary[key];
  if (typeof value !== "number" || typeof before !== "number") continue;
  const delta = value - before;
  const direction = delta === 0 ? "=" : (HIGHER_IS_BETTER.has(key) ? delta > 0 : delta < 0) ? "better" : "worse";
  rows.push(`${key} | ${before.toFixed(4)} | ${value.toFixed(4)} | ${delta >= 0 ? "+" : ""}${delta.toFixed(4)} ${direction}`);
}
if (baseline.manifest.suite === "agent") {
  const beforeByCase = new Map(baseline.runs.map((run) => [`${run.run}:${run.caseId}`, Boolean(run.success)]));
  const pairs = candidate.runs.flatMap((run) => {
    const before = beforeByCase.get(`${run.run}:${run.caseId}`);
    return before === undefined ? [] : [{ before, after: Boolean(run.success) }];
  });
  const wins = pairs.filter(({ before, after }) => !before && after).length;
  const losses = pairs.filter(({ before, after }) => before && !after).length;
  rows.push(`pairedTaskSuccess | ${pairs.filter(({ before }) => before).length} | ${pairs.filter(({ after }) => after).length} | ${wins} wins / ${losses} losses`);
}
console.log(rows.join("\n"));
