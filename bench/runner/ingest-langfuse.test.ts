// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readObservationExport } from "./ingest-blob.ts";
import { groupObservations } from "./ingest-langfuse.ts";

describe("Langfuse trajectory ingestion", () => {
  it("groups and orders observations while dropping unrelated traces", () => {
    const grouped = groupObservations([
      { id: "step", traceId: "t1", traceName: "agent.run", type: "SPAN", startTime: "2026-01-01T00:00:02Z" },
      { id: "root", traceId: "t1", traceName: "agent.run", type: "SPAN", startTime: "2026-01-01T00:00:01Z" },
      { id: "other", traceId: "t2", traceName: "unrelated", type: "SPAN", startTime: "2026-01-01T00:00:00Z" },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].observations.map((item) => item.id)).toEqual(["root", "step"]);
  });

  it("reads observations_v2 JSONL gzip exports", () => {
    const home = mkdtempSync(join(tmpdir(), "langfuse-export-"));
    const path = join(home, "observations.jsonl.gz");
    try {
      writeFileSync(path, gzipSync(`${JSON.stringify({ id: "root", trace_id: "t1", trace_name: "agent.run", start_time: "2026-01-01 00:00:01.000000" })}\n`));
      expect(readObservationExport(path)).toMatchObject([{ traceId: "t1", traceName: "agent.run", startTime: "2026-01-01T00:00:01.000000Z" }]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
