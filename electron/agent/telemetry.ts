// Central monitoring via Langfuse's OTLP/HTTP endpoint and scores API. No SDK, no OpenTelemetry runtime:
// one finished run → one OTLP trace built from the local trace_events; user reactions and outcomes → scores.
// Local SQLite stays the source of truth; this is a redacted (by default) mirror for cross-user analysis and A/B.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { InteractionKind } from "../../src/app-types/Agent.types.ts";
import type { PolicyTransition, TraceEvent } from "./contracts.ts";
import type { TelemetrySettings } from "./settings.ts";
import { readTrace } from "./trace.ts";

export const TELEMETRY_FLUSH_MS = 5_000;
const TELEMETRY_RETRY_MAX_MS = 5 * 60_000;
const OUTBOX_LIMIT = 100;
const BENCH_EXPORT_SCHEMA = "ketchupe-trajectory-v1";

/** Anonymous, stable per install; never derived from the machine name or the user. */
export function loadInstallId(userData: string): string {
  const path = join(userData, "install-id");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(userData, { recursive: true });
  const id = randomUUID();
  writeFileSync(path, id);
  return id;
}

type AttrValue = string | number | boolean | string[];
type OtlpAttr = { key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean; arrayValue?: { values: Array<{ stringValue: string }> } } };
type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttr[];
  status?: { code: number; message?: string };
};

export type Score = { id?: string; traceId: string; name: string; value: number; dataType: "NUMERIC" | "BOOLEAN"; comment?: string };

const INTERACTION_SCORES: Record<InteractionKind, { name: string; value: number }> = {
  accepted: { name: "user_feedback", value: 1 },
  corrected: { name: "user_feedback", value: 0 },
  retried: { name: "retried", value: 1 },
  citation_opened: { name: "citation_opened", value: 1 },
  clarification_answered: { name: "clarification_answered", value: 1 },
  abandoned: { name: "abandoned", value: 1 },
  memory_confirmed: { name: "memory_feedback", value: 1 },
  memory_rejected: { name: "memory_feedback", value: 0 },
};

function attr(key: string, value: AttrValue | undefined): OtlpAttr[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return [{ key, value: { arrayValue: { values: value.map((item) => ({ stringValue: String(item) })) } } }];
  if (typeof value === "boolean") return [{ key, value: { boolValue: value } }];
  if (typeof value === "number") return Number.isInteger(value) ? [{ key, value: { intValue: String(value) } }] : [{ key, value: { doubleValue: value } }];
  return [{ key, value: { stringValue: value } }];
}

const nanos = (iso: string, plusMs = 0) => `${(Date.parse(iso) + plusMs) * 1_000_000}`;
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
export const traceIdFor = (runId: string) => runId.replace(/-/g, "").padEnd(32, "0").slice(0, 32);
const spanIdFor = (runId: string, seq: number) => createHash("sha256").update(`${runId}:${seq}`).digest("hex").slice(0, 16);

export type RunSummaryRow = { id: string; thread_id: string; goal: string; status: string; error_code: string | null; created_at: string; finished_at: string | null };

/** Builds the OTLP payload for one run from its trace_events. Pure; used by tests and the exporter. */
export function buildRunTrace(
  db: DatabaseSync,
  runId: string,
  options: { userId: string; includeContent: boolean; resource: Record<string, string> },
): { traceId: string; payload: unknown; scores: Score[]; terminal: boolean } | undefined {
  const run = db.prepare("SELECT id, thread_id, goal, status, error_code, created_at, finished_at FROM runs WHERE id = ?").get(runId) as RunSummaryRow | undefined;
  if (!run) return undefined;
  const events = readTrace(db, runId);
  const started = events.find((event) => event.type === "run.started");
  const answer = db.prepare("SELECT content FROM messages WHERE run_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 1").get(runId) as { content: string } | undefined;
  const text = (value: string | undefined) => (value === undefined ? undefined : options.includeContent ? value : hash(value));
  const traceId = traceIdFor(runId);
  const rootSpanId = spanIdFor(runId, 0);
  const endIso = run.finished_at ?? events.at(-1)?.startedAt ?? run.created_at;

  const transitions = events.filter((event) => event.type === "policy.decided" && event.payload.transition);
  const decisions = transitions.map((event) => (event.payload.transition as PolicyTransition).decision);
  const actions = decisions.map((decision) => decision.action);
  const validated = events.find((event) => event.type === "answer.validated")?.payload;
  const failed = events.find((event) => event.type === "run.failed")?.payload;
  const last = decisions.at(-1);
  const modelCalls = events.filter((event) => event.type === "model.completed");
  const tokens = modelCalls.reduce((sum, event) => sum + Number(event.payload.promptTokens ?? 0) + Number(event.payload.completionTokens ?? 0), 0);
  const variant = String(started?.payload.variant ?? "");
  const profiles = (started?.payload.profiles ?? {}) as Record<string, string>;
  const evidenceById = new Map(transitions.flatMap((event) => (event.payload.transition as PolicyTransition).state.evidence).map((item) => [item.evidenceId, item]));
  const terminal = run.status !== "running" && run.status !== "waiting_user";
  const tags = [variant || "unassigned", run.status].filter(Boolean);
  const traceAttributes = () => [
    ...attr("langfuse.trace.name", "agent.run"),
    ...attr("langfuse.user.id", options.userId),
    ...attr("langfuse.session.id", run.thread_id),
    ...attr("langfuse.trace.tags", tags),
    ...attr("langfuse.release", options.resource["service.version"]),
    ...attr("langfuse.trace.metadata.exportSchema", BENCH_EXPORT_SCHEMA),
    ...attr("langfuse.trace.metadata.variant", variant),
    ...attr("langfuse.trace.metadata.policyProfile", profiles.policy),
    ...attr("langfuse.trace.metadata.retrievalProfile", profiles.retrieval),
    ...attr("langfuse.trace.metadata.answerProfile", profiles.answer),
  ];
  const exportLocator = (locator: PolicyTransition["state"]["evidence"][number]["locator"]) => ({
    ...locator,
    sheet: text(locator.sheet),
  });
  const exportEvidence = (evidence: PolicyTransition["state"]["evidence"]) => evidence.map((item) => ({
    evidenceId: item.evidenceId,
    sourceId: item.sourceId,
    chunkId: item.chunkId,
    title: text(item.title),
    breadcrumb: item.breadcrumb.map((part) => text(part)),
    locator: exportLocator(item.locator),
    snippet: text(item.snippet),
    score: item.score,
  }));
  const exportObservation = (observation: PolicyTransition["observation"]) => observation?.kind === "verification"
    ? { ...observation, missingClaims: observation.missingClaims.map((claim) => text(claim)) }
    : observation;
  const exportState = (state: PolicyTransition["state"]) => ({
    userGoal: text(state.userGoal),
    activeTask: text(state.activeTask),
    selectedMemories: state.selectedMemories.map((memory) => ({ ...memory, content: text(memory.content) })),
    recentMessages: state.recentMessages.map((message) => ({ ...message, content: text(message.content) })),
    activeCollections: state.activeCollections.map((name) => text(name)),
    evidence: exportEvidence(state.evidence),
    signals: state.signals,
    previousDecisions: state.previousDecisions,
    lastObservation: exportObservation(state.lastObservation),
    remaining: state.remaining,
  });
  const exportDecision = (decision: PolicyTransition["decision"]) => ({
    ...decision,
    search: decision.search ? { ...decision.search, query: text(decision.search.query) } : undefined,
    question: text(decision.question),
    claimsToVerify: decision.claimsToVerify?.map((claim) => text(claim)),
    stopReason: text(decision.stopReason),
  });

  const spans: OtlpSpan[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: "agent.run",
      kind: 1,
      startTimeUnixNano: nanos(run.created_at),
      endTimeUnixNano: nanos(endIso),
      attributes: [
        ...attr("langfuse.observation.type", "agent"),
        ...traceAttributes(),
        ...attr("langfuse.observation.input", text(run.goal)),
        ...attr("langfuse.observation.output", text(answer?.content)),
        ...attr("langfuse.trace.metadata.status", run.status),
        ...attr("langfuse.trace.metadata.errorCode", run.error_code ?? undefined),
        ...attr("langfuse.trace.metadata.actions", actions.join(">")),
        ...attr("langfuse.trace.metadata.steps", transitions.length),
        ...attr("langfuse.trace.metadata.searches", actions.filter((action) => action === "SEARCH").length),
        ...attr("langfuse.trace.metadata.verifies", actions.filter((action) => action === "VERIFY").length),
        ...attr("langfuse.trace.metadata.modelCalls", modelCalls.length),
        ...attr("langfuse.trace.metadata.totalTokens", tokens),
        ...attr("langfuse.trace.metadata.citationsValid", validated ? (validated.valid as string[]).length : undefined),
        ...attr("langfuse.trace.metadata.citationsRepaired", validated ? Boolean(validated.repaired) : undefined),
        ...attr("langfuse.trace.metadata.lastDifficulty", last?.taskDifficulty),
        ...attr("langfuse.trace.metadata.lastPredictedSuccess", last?.predictedSuccess),
        ...attr("langfuse.observation.level", failed ? "ERROR" : "DEFAULT"),
        ...attr("langfuse.observation.status_message", failed ? text(`${String(failed.code)}: ${String(failed.message)}`) : undefined),
      ],
      status: failed ? { code: 2, message: String(failed.code) } : { code: 1 },
    },
  ];

  const stepSpanBySeq = new Map<number, string>();
  for (const event of transitions) {
    const transition = event.payload.transition as PolicyTransition;
    const { decision, state } = transition;
    const next = events.find((candidate) => candidate.seq > event.seq && (candidate.type === "policy.decided" || candidate.type.startsWith("run.")));
    const spanId = spanIdFor(runId, event.seq);
    stepSpanBySeq.set(event.seq, spanId);
    spans.push({
      traceId,
      spanId,
      parentSpanId: rootSpanId,
      name: `step.${state.step}.${decision.action}`,
      kind: 1,
      startTimeUnixNano: nanos(event.startedAt),
      endTimeUnixNano: nanos(next?.startedAt ?? endIso),
      attributes: [
        ...attr("langfuse.observation.type", "span"),
        ...traceAttributes(),
        ...attr("langfuse.observation.input", JSON.stringify(exportState(state))),
        ...attr("langfuse.observation.output", JSON.stringify({ decision: exportDecision(decision), observation: exportObservation(transition.observation), outcome: transition.outcome })),
        ...attr("langfuse.observation.metadata.action", decision.action),
        ...attr("langfuse.observation.metadata.reasonCode", decision.reasonCode),
        ...attr("langfuse.observation.metadata.taskDifficulty", decision.taskDifficulty),
        ...attr("langfuse.observation.metadata.predictedSuccess", decision.predictedSuccess),
        ...attr("langfuse.observation.metadata.evidenceSufficiency", decision.evidenceSufficiency),
        ...attr("langfuse.observation.metadata.evidenceCount", state.evidence.length),
        ...attr("langfuse.observation.metadata.observation", transition.observation?.kind),
        ...attr("langfuse.observation.metadata.effectiveMode", transition.observation?.kind === "search" ? transition.observation.effectiveMode : undefined),
        ...attr("langfuse.observation.metadata.outcome", transition.outcome),
      ],
    });
  }

  const parentFor = (event: TraceEvent): string => {
    let cursor: TraceEvent | undefined = event;
    while (cursor?.parentSeq !== undefined) {
      const known = stepSpanBySeq.get(cursor.parentSeq);
      if (known) return known;
      cursor = events.find((candidate) => candidate.seq === cursor?.parentSeq);
    }
    return rootSpanId;
  };

  for (const event of events) {
    if (event.type === "tool.completed") {
      const observation = event.payload.observation as { kind?: string; effectiveMode?: string; resultIds?: string[]; code?: string } | undefined;
      const startedEvent = events.find((candidate) => candidate.seq === event.parentSeq);
      const query = String(event.payload.query ?? startedEvent?.payload.query ?? "") || undefined;
      const evidence = event.payload.evidence
        ? event.payload.evidence as PolicyTransition["state"]["evidence"]
        : (observation?.resultIds ?? []).flatMap((id) => evidenceById.get(id) ?? []);
      spans.push({
        traceId,
        spanId: spanIdFor(runId, event.seq),
        parentSpanId: parentFor(event),
        name: `tool.${String(event.payload.tool)}`,
        kind: 1,
        startTimeUnixNano: nanos(event.startedAt),
        endTimeUnixNano: nanos(event.startedAt, event.durationMs ?? 0),
        attributes: [
          ...attr("langfuse.observation.type", "retriever"),
          ...traceAttributes(),
          ...attr("langfuse.observation.input", query ? text(query) : JSON.stringify({ evidenceId: startedEvent?.payload.evidenceId })) ,
          ...attr("langfuse.observation.output", JSON.stringify(exportEvidence(evidence))),
          ...attr("langfuse.observation.metadata.cached", Boolean(event.payload.cached)),
          ...attr("langfuse.observation.metadata.effectiveMode", observation?.effectiveMode),
          ...attr("langfuse.observation.metadata.results", observation?.resultIds?.length),
          ...attr("langfuse.observation.metadata.error", observation?.kind === "tool_error" ? observation.code : undefined),
          ...attr("langfuse.observation.level", observation?.kind === "tool_error" ? "ERROR" : "DEFAULT"),
        ],
      });
    }
    if (event.type === "model.completed") {
      const usage = { input: Number(event.payload.promptTokens ?? 0), output: Number(event.payload.completionTokens ?? 0) };
      spans.push({
        traceId,
        spanId: spanIdFor(runId, event.seq),
        parentSpanId: parentFor(event),
        name: `model.${String(event.payload.purpose)}`,
        kind: 3,
        startTimeUnixNano: nanos(event.startedAt),
        endTimeUnixNano: nanos(event.startedAt, event.durationMs ?? 0),
        attributes: [
          ...attr("langfuse.observation.type", "generation"),
          ...traceAttributes(),
          ...attr("langfuse.observation.model.name", event.payload.modelAlias === undefined ? undefined : String(event.payload.modelAlias)),
          ...attr("langfuse.observation.usage_details", JSON.stringify({ input: usage.input, output: usage.output, total: usage.input + usage.output })),
          ...attr("langfuse.observation.metadata.purpose", String(event.payload.purpose)),
          ...attr("langfuse.observation.metadata.finishReason", event.payload.finishReason === undefined ? undefined : String(event.payload.finishReason)),
        ],
      });
    }
  }

  const scores: Score[] = terminal
    ? [
        { traceId, name: "task_completed", value: run.status === "completed" ? 1 : 0, dataType: "BOOLEAN", comment: run.status },
        ...(validated ? [{ traceId, name: "citation_valid", value: validated.failed ? 0 : 1, dataType: "BOOLEAN" as const }] : []),
        ...(last ? [{ traceId, name: "predicted_success", value: last.predictedSuccess, dataType: "NUMERIC" as const }] : []),
        { traceId, name: "steps", value: transitions.length, dataType: "NUMERIC" },
        { traceId, name: "searches", value: actions.filter((action) => action === "SEARCH").length, dataType: "NUMERIC" },
      ]
    : [];

  const payload = {
    resourceSpans: [
      {
        resource: { attributes: Object.entries(options.resource).flatMap(([key, value]) => attr(key, value)) },
        scopeSpans: [{ scope: { name: "ketchupe-agent" }, spans }],
      },
    ],
  };
  return { traceId, payload, scores, terminal };
}

export function interactionScore(runId: string, kind: InteractionKind): Score {
  const mapped = INTERACTION_SCORES[kind];
  return { traceId: traceIdFor(runId), name: mapped.name, value: mapped.value, dataType: mapped.name === "user_feedback" || mapped.name === "memory_feedback" ? "BOOLEAN" : "NUMERIC", comment: kind };
}

export type TelemetryIdentity = { installId: string; appVersion: string; os: string };
type OutboxRow = { id: string; kind: "run" | "trace" | "score"; run_id: string | null; payload: string | null; attempts: number };
type FlushResult = { traces: number; scores: number; error?: string };

export class LangfuseExporter {
  private timer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<FlushResult>;
  private stopped = false;
  private readonly db: DatabaseSync;
  private readonly settings: () => TelemetrySettings;
  private readonly identity: TelemetryIdentity;
  private readonly log: (message: string) => void;

  constructor(db: DatabaseSync, settings: () => TelemetrySettings, identity: TelemetryIdentity, log: (message: string) => void = console.warn) {
    this.db = db;
    this.settings = settings;
    this.identity = identity;
    this.log = log;
    if (this.enabled && this.hasReadyItems()) this.schedule();
  }

  get enabled(): boolean {
    const current = this.settings();
    return current.enabled && Boolean(current.publicKey && current.secretKey);
  }

  userId(): string {
    return this.settings().userId.trim() || `install:${this.identity.installId}`;
  }

  resource(): Record<string, string> {
    return { "service.name": "ketchupe", "service.version": this.identity.appVersion, "os.type": this.identity.os, "ketchupe.install_id": this.identity.installId };
  }

  /** One trace per app launch so DAU/MAU can be read from Langfuse users even on days without runs. */
  appSession(variant: string): void {
    if (!this.enabled) return;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.enqueue(`trace:${id}`, "trace", null, {
      resourceSpans: [{ resource: { attributes: Object.entries(this.resource()).flatMap(([key, value]) => attr(key, value)) }, scopeSpans: [{ scope: { name: "ketchupe-agent" }, spans: [{
        traceId: traceIdFor(id), spanId: spanIdFor(id, 0), name: "app.session", kind: 1, startTimeUnixNano: nanos(now), endTimeUnixNano: nanos(now, 1),
        attributes: [...attr("langfuse.trace.name", "app.session"), ...attr("langfuse.user.id", this.userId()), ...attr("langfuse.trace.tags", [variant, "app.session"]), ...attr("langfuse.release", this.identity.appVersion), ...attr("langfuse.trace.metadata.variant", variant)],
      }] }] }],
    });
    this.schedule();
  }

  exportRun(db: DatabaseSync, runId: string): void {
    if (!this.enabled) return;
    const built = buildRunTrace(db, runId, { userId: this.userId(), includeContent: this.settings().includeContent, resource: this.resource() });
    if (!built) return;
    this.enqueue(`run:${runId}`, "run", runId);
    if (built.terminal) this.enqueueRunScores(runId, built.scores);
    this.schedule();
  }

  score(score: Score): void {
    if (!this.enabled) return;
    const queued = { ...score, id: score.id ?? randomUUID() };
    this.enqueue(`score:${queued.id}`, "score", null, queued);
    this.schedule();
  }

  private enqueue(id: string, kind: OutboxRow["kind"], runId: string | null, payload?: unknown): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO telemetry_outbox (id, kind, run_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, kind, runId, payload === undefined ? null : JSON.stringify(payload), new Date().toISOString());
  }

  private enqueueRunScores(runId: string, scores: Score[]): void {
    for (const score of scores) {
      const queued = { ...score, id: score.id ?? randomUUID() };
      this.enqueue(`score:${runId}:${score.name}`, "score", runId, queued);
    }
  }

  private hasReadyItems(): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM telemetry_outbox AS outbox
      LEFT JOIN runs ON runs.id = outbox.run_id
      WHERE outbox.sent_at IS NULL
        AND (outbox.kind <> 'run' OR runs.status NOT IN ('running', 'waiting_user'))
      LIMIT 1
    `).get());
  }

  private schedule(delay = TELEMETRY_FLUSH_MS): void {
    if (this.enabled && !this.stopped) this.timer ??= setTimeout(() => void this.flush(), delay);
  }

  private headers(): Record<string, string> {
    const { publicKey, secretKey } = this.settings();
    return {
      Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey ?? ""}`).toString("base64")}`,
      "Content-Type": "application/json",
      "x-langfuse-ingestion-version": "4",
    };
  }

  /** Sends durable outbox items. A failed item remains in SQLite and is retried with bounded backoff. */
  flush(): Promise<FlushResult> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOnce().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  stop(): Promise<FlushResult> {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    return this.flush();
  }

  discardPending(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.db.prepare("DELETE FROM telemetry_outbox WHERE sent_at IS NULL").run();
  }

  private async flushOnce(): Promise<FlushResult> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.enabled) return { traces: 0, scores: 0 };
    const rows = this.db.prepare(`
      SELECT outbox.id, outbox.kind, outbox.run_id, outbox.payload, outbox.attempts
      FROM telemetry_outbox AS outbox
      LEFT JOIN runs ON runs.id = outbox.run_id
      WHERE outbox.sent_at IS NULL
        AND (outbox.kind <> 'run' OR runs.status NOT IN ('running', 'waiting_user'))
      ORDER BY outbox.rowid
      LIMIT ?
    `).all(OUTBOX_LIMIT) as OutboxRow[];
    if (!rows.length) return { traces: 0, scores: 0 };
    const host = this.settings().host;
    let traces = 0;
    let scores = 0;
    let error: string | undefined;
    for (const row of rows) {
      try {
        let endpoint: string;
        let payload: unknown;
        if (row.kind === "run") {
          const built = buildRunTrace(this.db, row.run_id ?? "", { userId: this.userId(), includeContent: this.settings().includeContent, resource: this.resource() });
          if (!built?.terminal) continue;
          this.enqueueRunScores(row.run_id ?? "", built.scores);
          endpoint = "/api/public/otel/v1/traces";
          payload = built.payload;
        } else {
          endpoint = row.kind === "trace" ? "/api/public/otel/v1/traces" : "/api/public/scores";
          payload = JSON.parse(row.payload ?? "null");
        }
        const response = await fetch(`${host}${endpoint}`, { method: "POST", headers: this.headers(), body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`${row.kind} ingest ${response.status}: ${(await response.text()).slice(0, 200)}`);
        if (row.kind === "run") this.db.prepare("UPDATE telemetry_outbox SET sent_at = ?, last_error = NULL WHERE id = ?").run(new Date().toISOString(), row.id);
        else this.db.prepare("DELETE FROM telemetry_outbox WHERE id = ?").run(row.id);
        if (row.kind === "score") scores += 1;
        else traces += 1;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        const attempts = row.attempts + 1;
        this.db.prepare("UPDATE telemetry_outbox SET attempts = ?, last_error = ? WHERE id = ?").run(attempts, error, row.id);
        this.log(`[telemetry] flush failed: ${error}`);
        this.schedule(Math.min(TELEMETRY_FLUSH_MS * 2 ** Math.min(attempts, 6), TELEMETRY_RETRY_MAX_MS));
        break;
      }
    }
    if (!error && this.hasReadyItems()) this.schedule();
    return { traces, scores, error };
  }

  /** Connectivity check used by the settings screen. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const { host, publicKey, secretKey } = this.settings();
    if (!publicKey || !secretKey) return { ok: false, message: "public/secret key가 필요합니다." };
    try {
      const response = await fetch(`${host}/api/public/projects`, { headers: this.headers() });
      if (response.status === 401 || response.status === 403) return { ok: false, message: "Langfuse key가 거부되었습니다." };
      if (!response.ok) return { ok: false, message: `Langfuse 응답 ${response.status}` };
      const body = (await response.json()) as { data?: Array<{ name?: string }> };
      return { ok: true, message: `연결됨: ${body.data?.map((project) => project.name).join(", ") || "project"}` };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }
}
