// Service-admin ingestion: bounded Langfuse v2 observation reads → versioned central trajectory envelopes.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { TRAJECTORY_SCHEMA_VERSION } from "../../electron/agent/telemetry.ts";

type Observation = Record<string, unknown> & {
  id: string;
  traceId: string;
  traceName?: string;
  release?: string;
  environment?: string;
  sessionId?: string;
  startTime: string;
};

export type TrajectoryEnvelope = {
  schemaVersion: typeof TRAJECTORY_SCHEMA_VERSION;
  traceId: string;
  traceName: string;
  release: string | null;
  environment: string | null;
  sessionId: string | null;
  observations: Observation[];
};

export function groupObservations(rows: Observation[]): TrajectoryEnvelope[] {
  const groups = new Map<string, Observation[]>();
  for (const row of rows) groups.set(row.traceId, [...(groups.get(row.traceId) ?? []), row]);
  return [...groups.entries()].flatMap(([traceId, observations]) => {
    const ordered = observations.sort((left, right) => left.startTime.localeCompare(right.startTime));
    const context = ordered.find((item) => item.traceName) ?? ordered[0];
    if (!context || !["agent.run", "index.sync", "app.session"].includes(context.traceName ?? "")) return [];
    return [{
      schemaVersion: TRAJECTORY_SCHEMA_VERSION,
      traceId,
      traceName: context.traceName ?? "",
      release: context.release ?? null,
      environment: context.environment ?? null,
      sessionId: context.sessionId ?? null,
      observations: ordered,
    }];
  });
}

const iso = (value: string, name: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${name} must be an ISO date`);
  return parsed.toISOString();
};

async function fetchObservations(options: { host: string; auth: string; from: string; to: string; environment?: string }): Promise<Observation[]> {
  const rows: Observation[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({
      fields: "core,basic,time,io,metadata,model,usage,metrics,trace_context",
      limit: "1000",
      fromStartTime: options.from,
      toStartTime: options.to,
      ...(options.environment ? { environment: options.environment } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const response = await fetch(`${options.host.replace(/\/+$/, "")}/api/public/v2/observations?${query}`, { headers: { Authorization: options.auth } });
    if (!response.ok) throw new Error(`Langfuse observations ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json() as { data?: Observation[]; meta?: { cursor?: string | null } };
    rows.push(...(body.data ?? []));
    cursor = body.meta?.cursor ?? undefined;
  } while (cursor);
  return rows;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    from: { type: "string" },
    to: { type: "string" },
    out: { type: "string" },
    environment: { type: "string", default: "production" },
  } });
  if (!values.from || !values.to) throw new Error("usage: bench:ingest -- --from <ISO> --to <ISO> [--out path]");
  const from = iso(values.from, "from");
  const to = iso(values.to, "to");
  if (from >= to) throw new Error("from must be before to");
  const host = process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? "";
  if (!publicKey || !secretKey) throw new Error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required on the bench host");
  const rows = await fetchObservations({ host, auth: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`, from, to, environment: values.environment });
  const traces = groupObservations(rows);
  const output = `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`;
  const path = resolve(values.out ?? `bench/imports/${from.slice(0, 10)}_${to.slice(0, 10)}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
  writeFileSync(`${path}.manifest.json`, JSON.stringify({
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    source: "langfuse-observations-v2",
    from,
    to,
    environment: values.environment,
    traces: traces.length,
    observations: rows.length,
    sha256: createHash("sha256").update(output).digest("hex"),
  }, null, 2));
  console.log(`Imported ${traces.length} traces (${rows.length} observations) → ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
