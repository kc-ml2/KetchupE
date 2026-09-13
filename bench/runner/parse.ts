// Parse suite: raw file → canonical units. Checks required units, breadcrumb, and page locators.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseSource } from "../../electron/tomato/tomato.ts";
import { loadProfile, parseBenchArgs, readJsonl, writeResults } from "./common.ts";
import { mean } from "./metrics.ts";

type RequiredUnit = { kind: "text" | "table" | "code"; mustContain: string[]; breadcrumbEndsWith?: string; pageStart?: number };
type ParseCase = { caseId: string; sourceKey: string; requiredUnits: RequiredUnit[] };

const args = parseBenchArgs();
const profile = loadProfile(args.profilePath);
const cases = readJsonl<ParseCase>(join(args.datasetDir, "parse-cases.jsonl"));
const runs: Array<Record<string, unknown>> = [];

for (const item of cases) {
  const path = join(args.datasetDir, "corpus", item.sourceKey);
  const startedAt = Date.now();
  try {
    const buffer = readFileSync(path);
    const artifact = await parseSource(path, buffer, createHash("sha256").update(buffer).digest("hex"), "off");
    const found = item.requiredUnits.map((required) => {
      const unit = artifact.units.find((candidate) =>
        candidate.type === required.kind &&
        required.mustContain.every((text) => candidate.text.includes(text)) &&
        (!required.breadcrumbEndsWith || candidate.breadcrumb.at(-1) === required.breadcrumbEndsWith),
      );
      return { found: Boolean(unit), locatorOk: unit ? required.pageStart === undefined || unit.page === required.pageStart : false };
    });
    runs.push({ caseId: item.caseId, ok: true, units: artifact.units.length, requiredRecall: mean(found.map((f) => (f.found ? 1 : 0))), locatorAccuracy: mean(found.map((f) => (f.locatorOk ? 1 : 0))), latencyMs: Date.now() - startedAt, firstFailedStage: found.every((f) => f.found) ? null : "parse" });
  } catch (error) {
    runs.push({ caseId: item.caseId, ok: false, error: error instanceof Error ? error.message : String(error), requiredRecall: 0, locatorAccuracy: 0, latencyMs: Date.now() - startedAt, firstFailedStage: "parse" });
  }
}

writeResults("parse", args, profile, {
  manifest: {},
  runs,
  summary: {
    cases: cases.length,
    parseSuccess: mean(runs.map((run) => (run.ok ? 1 : 0))),
    requiredUnitRecall: mean(runs.map((run) => Number(run.requiredRecall))),
    locatorAccuracy: mean(runs.map((run) => Number(run.locatorAccuracy))),
    latencyMsMean: mean(runs.map((run) => Number(run.latencyMs))),
  },
});
