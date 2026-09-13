// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openAgentDb } from "../db/openAgentDb.ts";
import { PIPELINE_PROFILE, Tomato } from "../tomato/tomato.ts";
import type { PolicyDecision } from "./contracts.ts";
import { Harness } from "./harness.ts";
import { createFixtureClient } from "./modelClient.ts";
import { ANSWER_PROMPT_VERSION, assignVariant, DEFAULT_POLICY_PROFILE, POLICY_VARIANTS } from "./policy.ts";
import { createThread, ensureWorkspace, recordInteraction } from "./store.ts";
import { buildRunTrace, interactionScore, LangfuseExporter, traceIdFor } from "./telemetry.ts";
import { tomatoTools } from "./tools.ts";

let temporary: string;
let runId: string;
const db = openAgentDb(":memory:");
const base = { taskDifficulty: 1, predictedSuccess: 0.7, evidenceSufficiency: 0.5, policyVersion: "orchestration-1" } as const;
const decisions: PolicyDecision[] = [
  { ...base, action: "SEARCH", reasonCode: "MISSING_EVIDENCE", search: { tool: "search_local_docs", query: "연차 정산" } },
  { ...base, action: "ANSWER", reasonCode: "ENOUGH_EVIDENCE" },
];

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "telemetry-"));
  const docs = join(temporary, "docs");
  await mkdir(docs);
  await writeFile(join(docs, "a.md"), "# 규정\n\n## 연차\n\n미사용 연차는 수당으로 정산한다.\n");
  const tomato = new Tomato(join(temporary, "home"));
  await tomato.registerCollection(docs, "work");
  const workspace = ensureWorkspace(db);
  const settled: string[] = [];
  const harness = new Harness({
    db,
    model: createFixtureClient({ decide: decisions, answer: "수당으로 정산합니다 [[e1]]" }),
    tools: tomatoTools(tomato, { mode: "keyword", topK: 8 }),
    profiles: { retrieval: PIPELINE_PROFILE, policy: DEFAULT_POLICY_PROFILE, answer: { modelAlias: "fixture", promptVersion: ANSWER_PROMPT_VERSION, temperature: 0 } },
    activeCollections: () => ["work"],
    runMetadata: { variant: "baseline-v1" },
    onRunSettled: (id, status) => settled.push(`${id}:${status}`),
  });
  const handle = harness.startRun({ workspaceId: workspace.id, threadId: createThread(db, workspace.id).id, text: "연차 정산?" });
  await handle.done;
  runId = handle.runId;
  expect(settled).toEqual([`${runId}:completed`]);
  recordInteraction(db, runId, "accepted");
});

afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("telemetry", () => {
  it("maps a run to one OTLP trace with step, tool, and generation spans, redacted by default", () => {
    const built = buildRunTrace(db, runId, { userId: "u@example.com", includeContent: false, resource: { "service.name": "ketchupe" } });
    expect(built).toBeDefined();
    const spans = (built!.payload as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string; traceId: string; spanId: string; parentSpanId?: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }> }> }> }).resourceSpans[0].scopeSpans[0].spans;
    expect(built!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spans.every((span) => span.traceId === built!.traceId && /^[0-9a-f]{16}$/.test(span.spanId))).toBe(true);
    expect(spans.map((span) => span.name)).toEqual(["agent.run", "step.1.SEARCH", "step.2.ANSWER", "model.policy", "tool.search_local_docs", "model.policy", "model.answer"]);
    const root = spans[0];
    const value = (key: string) => root.attributes.find((item) => item.key === key)?.value;
    expect(value("langfuse.user.id")).toEqual({ stringValue: "u@example.com" });
    expect(value("langfuse.trace.tags")).toEqual({ arrayValue: { values: [{ stringValue: "baseline-v1" }, { stringValue: "completed" }] } });
    expect(value("langfuse.trace.metadata.variant")).toEqual({ stringValue: "baseline-v1" });
    expect(value("langfuse.trace.metadata.actions")).toEqual({ stringValue: "SEARCH>ANSWER" });
    expect((value("langfuse.observation.input") as { stringValue: string }).stringValue).toMatch(/^sha256:/);
    expect(JSON.stringify(built!.payload)).not.toContain("연차");
    expect(spans.every((span) => span.attributes.some((item) => item.key === "langfuse.trace.metadata.exportSchema"))).toBe(true);
    expect(spans.find((span) => span.name === "tool.search_local_docs")?.parentSpanId).toBe(spans[1].spanId);
    expect(built!.scores.map((score) => score.name)).toEqual(["task_completed", "citation_valid", "predicted_success", "steps", "searches"]);
  });

  it("includes content only when opted in", () => {
    const built = buildRunTrace(db, runId, { userId: "u", includeContent: true, resource: {} });
    expect(JSON.stringify(built!.payload)).toContain("연차 정산?");
    expect(JSON.stringify(built!.payload)).toContain("미사용 연차는 수당으로 정산한다.");
    expect(JSON.stringify(built!.payload)).not.toContain(temporary);
  });

  it("turns interactions into scores on the same trace id", () => {
    expect(interactionScore(runId, "accepted")).toMatchObject({ traceId: traceIdFor(runId), name: "user_feedback", value: 1, dataType: "BOOLEAN" });
    expect(interactionScore(runId, "corrected").value).toBe(0);
  });

  it("assigns variants deterministically and honours overrides", () => {
    const names = Object.keys(POLICY_VARIANTS);
    expect(assignVariant("install-a")).toBe(assignVariant("install-a"));
    expect(names).toContain(assignVariant("install-a"));
    expect(assignVariant("install-a", "adaptive-v1")).toBe("adaptive-v1");
    expect(assignVariant("install-a", "nope")).toBe(assignVariant("install-a"));
  });

  it("posts OTLP traces and scores with Basic auth and the v4 ingestion header", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const exporter = new LangfuseExporter(db, () => ({ enabled: true, host: "https://lf.test", publicKey: "pk", secretKey: "sk", userId: "", includeContent: false, variant: "" }), { installId: "inst", appVersion: "3.0.0", os: "darwin" });
      exporter.exportRun(db, runId);
      exporter.score(interactionScore(runId, "accepted"));
      const result = await exporter.flush();
      expect(result).toEqual({ traces: 1, scores: 6 });
      expect(calls[0].url).toBe("https://lf.test/api/public/otel/v1/traces");
      expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("pk:sk").toString("base64")}`);
      expect(calls[0].headers["x-langfuse-ingestion-version"]).toBe("4");
      expect(calls.filter((call) => call.url.endsWith("/api/public/scores"))).toHaveLength(6);
      expect(exporter.userId()).toBe("install:inst");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps failed telemetry in SQLite and retries it", async () => {
    const originalFetch = globalThis.fetch;
    let unavailable = true;
    globalThis.fetch = (async () => unavailable ? new Response("down", { status: 503 }) : new Response("{}", { status: 200 })) as typeof fetch;
    try {
      const exporter = new LangfuseExporter(
        db,
        () => ({ enabled: true, host: "https://lf.test", publicKey: "pk", secretKey: "sk", userId: "", includeContent: false, variant: "" }),
        { installId: "inst", appVersion: "3.0.0", os: "darwin" },
        () => undefined,
      );
      exporter.score(interactionScore(runId, "retried"));
      expect((await exporter.flush()).error).toContain("503");
      expect((db.prepare("SELECT COUNT(*) AS count FROM telemetry_outbox WHERE kind = 'score'").get() as { count: number }).count).toBe(1);

      unavailable = false;
      const restarted = new LangfuseExporter(
        db,
        () => ({ enabled: true, host: "https://lf.test", publicKey: "pk", secretKey: "sk", userId: "", includeContent: false, variant: "" }),
        { installId: "inst", appVersion: "3.0.0", os: "darwin" },
        () => undefined,
      );
      expect(await restarted.flush()).toEqual({ traces: 0, scores: 1, error: undefined });
      await exporter.flush(); // clears the first instance's scheduled retry
      expect((db.prepare("SELECT COUNT(*) AS count FROM telemetry_outbox WHERE kind = 'score'").get() as { count: number }).count).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does nothing when disabled", async () => {
    const exporter = new LangfuseExporter(db, () => ({ enabled: false, host: "", publicKey: "", userId: "", includeContent: false, variant: "" }), { installId: "i", appVersion: "0", os: "darwin" });
    exporter.exportRun(db, runId);
    expect(await exporter.flush()).toEqual({ traces: 0, scores: 0 });
  });
});
