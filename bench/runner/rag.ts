// RAG generation suite: frozen gold evidence → answer. Retrieval quality is intentionally excluded.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Tomato } from "../../electron/tomato/tomato.ts";
import { chunkToEvidence } from "../../electron/agent/tools.ts";
import { validateCitations } from "../../electron/agent/verify.ts";
import { loadProfile, parseBenchArgs, readJsonl, writeResults } from "./common.ts";
import { mean, percentile } from "./metrics.ts";
import { benchModelAlias, benchModelClient } from "./policies.ts";

type RagCase = {
  caseId: string;
  question: string;
  evidence: Array<{ sourceKey: string; mustContain: string[] }>;
  expect: { mustContain?: string[]; mustNotContain?: string[] };
};

const args = parseBenchArgs();
const profile = loadProfile(args.profilePath);
profile.answer.modelAlias = await benchModelAlias(profile.answer.modelAlias);
const cases = readJsonl<RagCase>(join(args.datasetDir, "rag-cases.jsonl"));
const home = mkdtempSync(join(tmpdir(), "bench-rag-"));
const tomato = new Tomato(home);
await tomato.registerCollection(join(args.datasetDir, "corpus"), "bench");
const sources = await tomato.listSources(["bench"]);
const runs: Array<Record<string, unknown>> = [];

for (let trial = 1; trial <= args.runs; trial += 1) {
  for (const item of cases) {
    const chunks = [];
    for (const expected of item.evidence) {
      const source = sources.find((candidate) => basename(candidate.relativePath) === expected.sourceKey);
      if (!source) throw new Error(`missing source ${expected.sourceKey}`);
      const chunk = (await tomato.getSourceChunks(source.sourceId)).find((candidate) => expected.mustContain.every((text) => candidate.body.includes(text)));
      if (!chunk) throw new Error(`missing gold evidence for ${item.caseId}`);
      chunks.push(chunk);
    }
    const evidence = chunks.map((chunk, index) => chunkToEvidence(chunk, `e${index + 1}`, 1).evidence);
    const client = benchModelClient(args.client);
    const startedAt = Date.now();
    let answer = "";
    for await (const event of client.streamAnswer({ userGoal: item.question, context: "", evidence }, { ...profile.policy, ...profile.answer }, new AbortController().signal)) {
      if (event.type === "text_delta") answer += event.text;
    }
    const citations = validateCitations(answer, evidence);
    const correct = (item.expect.mustContain ?? []).every((text) => answer.includes(text))
      && (item.expect.mustNotContain ?? []).every((text) => !answer.includes(text));
    runs.push({
      trial,
      caseId: item.caseId,
      correct,
      citationValid: citations.invalid.length === 0 && citations.valid.length > 0,
      citationCoverage: evidence.length ? new Set(citations.valid).size / evidence.length : 1,
      latencyMs: Date.now() - startedAt,
      promptTokens: client.lastCall?.promptTokens ?? 0,
      completionTokens: client.lastCall?.completionTokens ?? 0,
      firstFailedStage: correct ? (citations.invalid.length || !citations.valid.length ? "citation" : null) : "generation",
      answerPreview: answer.slice(0, 120),
    });
  }
}
rmSync(home, { recursive: true, force: true });

writeResults("rag", args, profile, {
  manifest: { evidence: "frozen-gold" },
  runs,
  summary: {
    cases: cases.length,
    runs: args.runs,
    answerCorrectness: mean(runs.map((run) => run.correct ? 1 : 0)),
    citationValidity: mean(runs.map((run) => run.citationValid ? 1 : 0)),
    citationCoverage: mean(runs.map((run) => Number(run.citationCoverage))),
    latencyP50: percentile(runs.map((run) => Number(run.latencyMs)), 50),
    latencyP95: percentile(runs.map((run) => Number(run.latencyMs)), 95),
    totalTokensMean: mean(runs.map((run) => Number(run.promptTokens) + Number(run.completionTokens))),
  },
});
