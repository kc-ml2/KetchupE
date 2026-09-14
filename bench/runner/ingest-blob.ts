// Large-volume path: Langfuse observations_v2 JSON/JSONL(.gz) → the same trajectory envelope as the API importer.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { groupObservations } from "./ingest-langfuse.ts";

type Observation = Parameters<typeof groupObservations>[0][number];

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.includes("T")) return value;
  return `${value.replace(" ", "T")}Z`;
}

function normalizeObservation(value: unknown): Observation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const id = row.id;
  const traceId = row.traceId ?? row.trace_id;
  const startTime = normalizeTimestamp(row.startTime ?? row.start_time);
  if (typeof id !== "string" || typeof traceId !== "string" || !startTime) return undefined;
  return {
    ...row,
    id,
    traceId,
    startTime,
    endTime: normalizeTimestamp(row.endTime ?? row.end_time),
    parentObservationId: row.parentObservationId ?? row.parent_observation_id,
    traceName: row.traceName ?? row.trace_name,
    sessionId: row.sessionId ?? row.session_id,
    environment: row.environment,
    release: row.release,
  } as Observation;
}

export function readObservationExport(path: string): Observation[] {
  const compressed = readFileSync(path);
  const text = (extname(path) === ".gz" ? gunzipSync(compressed) : compressed).toString("utf8").trim();
  if (!text) return [];
  const parsed = text.startsWith("[") ? JSON.parse(text) as unknown[] : text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
  return parsed.flatMap((row) => normalizeObservation(row) ?? []);
}

function main(): void {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
  if (!positionals.length) throw new Error("usage: bench:ingest:blob -- [--out path] <observations_v2.jsonl[.gz]>...");
  const rows = positionals.flatMap(readObservationExport);
  const traces = groupObservations(rows);
  const output = `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`;
  const path = resolve(values.out ?? "bench/imports/langfuse-blob.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
  writeFileSync(`${path}.manifest.json`, JSON.stringify({
    schemaVersion: "ketchupe-trajectory-v2",
    source: "langfuse-observations-v2-blob",
    files: positionals,
    traces: traces.length,
    observations: rows.length,
    sha256: createHash("sha256").update(output).digest("hex"),
  }, null, 2));
  console.log(`Imported ${traces.length} traces (${rows.length} observations) → ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
