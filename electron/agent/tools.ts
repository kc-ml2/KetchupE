import { AgentError, EVIDENCE_SNIPPET_MAX_CHARS, type AgentErrorCode, type Evidence, type Locator } from "./contracts.ts";
import type { ChunkRecord, SearchMode, SearchResult, Tomato, TomatoSearch } from "../tomato/tomato.ts";

/** Retrieval surface the harness depends on; backed by an in-process Tomato or the utility-process client. */
export interface SearchTools {
  search(query: string, collections: string[]): Promise<TomatoSearch>;
  neighbors(chunkId: string, before: number, after: number): Promise<ChunkRecord[]>;
}

export type RetrievalSettings = { mode: SearchMode; topK: number };

export function tomatoTools(tomato: Pick<Tomato, "search" | "getNeighbors">, settings: RetrievalSettings): SearchTools {
  return {
    search: (query, collections) => tomato.search(query, { collections, mode: settings.mode, limit: settings.topK }),
    neighbors: (chunkId, before, after) => tomato.getNeighbors(chunkId, before, after),
  };
}

export type EvidenceSource = { evidenceId: string; sourceId: string; chunkId: string; path: string; title: string; locator: Locator };

export function resultToEvidence(result: SearchResult, evidenceId: string): { evidence: Evidence; source: EvidenceSource } {
  const locator: Locator = result.page ? { pageStart: result.page, pageEnd: result.pageEnd ?? result.page } : {};
  return {
    evidence: {
      evidenceId,
      sourceId: result.sourceId,
      chunkId: result.chunkId,
      title: result.title,
      breadcrumb: result.breadcrumb,
      locator,
      snippet: result.snippet.slice(0, EVIDENCE_SNIPPET_MAX_CHARS),
      score: result.score,
    },
    source: { evidenceId, sourceId: result.sourceId, chunkId: result.chunkId, path: result.path, title: result.title, locator },
  };
}

export function chunkToEvidence(chunk: ChunkRecord, evidenceId: string, score: number): { evidence: Evidence; source: EvidenceSource } {
  const locator: Locator = chunk.pageStart ? { pageStart: chunk.pageStart, pageEnd: chunk.pageEnd ?? chunk.pageStart } : {};
  return {
    evidence: {
      evidenceId,
      sourceId: chunk.sourceId,
      chunkId: chunk.chunkId,
      title: chunk.title,
      breadcrumb: chunk.breadcrumb,
      locator,
      snippet: chunk.body.replace(/\s+/g, " ").trim().slice(0, EVIDENCE_SNIPPET_MAX_CHARS),
      score,
    },
    source: { evidenceId, sourceId: chunk.sourceId, chunkId: chunk.chunkId, path: chunk.path, title: chunk.title, locator },
  };
}

export function normalizeQuery(query: string): string {
  return query.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, code: AgentErrorCode, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentError(code, `timed out after ${ms}ms`)), ms);
    signal?.addEventListener("abort", () => reject(new AgentError("CANCELLED", "cancelled")), { once: true });
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
