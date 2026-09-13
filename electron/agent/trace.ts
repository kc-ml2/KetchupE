import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PolicyTransition, TraceEvent, TraceStage, TraceEventType } from "./contracts.ts";

export class TraceWriter {
  private seq = 0;
  private readonly db: DatabaseSync;
  readonly runId: string;
  constructor(db: DatabaseSync, runId: string) {
    this.db = db;
    this.runId = runId;
    const row = db.prepare("SELECT MAX(seq) AS seq FROM trace_events WHERE run_id = ?").get(runId) as { seq: number | null };
    this.seq = Number(row.seq ?? 0);
  }

  record(
    type: TraceEventType,
    stage: TraceStage,
    payload: Record<string, unknown>,
    options: { parentSeq?: number; startedAt?: number; } = {},
  ): number {
    this.seq += 1;
    const startedAt = options.startedAt ?? Date.now();
    const durationMs = options.startedAt === undefined ? null : Date.now() - options.startedAt;
    this.db.prepare(`
      INSERT INTO trace_events (run_id, seq, parent_seq, type, stage, started_at, duration_ms, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(this.runId, this.seq, options.parentSeq ?? null, type, stage, new Date(startedAt).toISOString(), durationMs, JSON.stringify(payload));
    return this.seq;
  }
}

export function readTrace(db: DatabaseSync, runId: string): TraceEvent[] {
  const rows = db.prepare("SELECT * FROM trace_events WHERE run_id = ? ORDER BY seq").all(runId) as Record<string, unknown>[];
  return rows.map((row) => ({
    runId: String(row.run_id),
    seq: Number(row.seq),
    parentSeq: row.parent_seq == null ? undefined : Number(row.parent_seq),
    type: row.type as TraceEventType,
    stage: row.stage as TraceStage,
    startedAt: String(row.started_at),
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
  }));
}

export function transitions(db: DatabaseSync, runId: string): PolicyTransition[] {
  return readTrace(db, runId)
    .filter((event) => event.type === "policy.decided" && event.payload.transition)
    .map((event) => event.payload.transition as PolicyTransition);
}

const REDACT_KEYS = new Set(["snippet", "content", "userGoal", "goal", "text", "question", "query", "stopReason", "claimsToVerify", "claims", "activeTask", "contextText", "answer", "title"]);
const DROP_KEYS = new Set(["path", "absolutePath"]);

function redact(value: unknown, key?: string): unknown {
  if (key && DROP_KEYS.has(key)) return undefined;
  if (typeof value === "string" && key && REDACT_KEYS.has(key)) return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([nested, item]) => [nested, redact(item, nested)]).filter(([, item]) => item !== undefined));
  }
  return value;
}

/** Redacted JSONL: IDs, hashes and metrics survive; free text and paths do not. */
export function exportTraceJsonl(db: DatabaseSync, runId: string): string {
  const events = readTrace(db, runId);
  const interactions = db.prepare("SELECT kind, created_at FROM interaction_events WHERE run_id = ? ORDER BY created_at").all(runId) as Array<{ kind: string; created_at: string }>;
  const lines = events.map((event) => JSON.stringify({ ...event, payload: redact(event.payload) }));
  for (const interaction of interactions) lines.push(JSON.stringify({ runId, type: "interaction.recorded", stage: "feedback", startedAt: interaction.created_at, payload: { kind: interaction.kind } }));
  return `${lines.join("\n")}\n`;
}
