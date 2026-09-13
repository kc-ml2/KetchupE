import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { blocksToChunks, parse, VERSION as KORDOC_VERSION, type IRBlock } from "kordoc";
import {
  blobToVector,
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROFILE,
  embedTexts,
  vectorToBlob,
} from "./embedding.ts";
import { CJK_RUN, estimateTokens, normalizeCjkForFts } from "./text.ts";

export { estimateTokens, normalizeCjkForFts };

const SCHEMA_VERSION = 1;
const PARSER_VERSION = `kordoc-${KORDOC_VERSION}+markdown-1`;
const CHUNKER_VERSION = "structure-1";
const SEARCH_VERSION = "fts5-cjk-1";
const SUPPORTED_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".hwp",
  ".hwpx",
  ".hml",
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);
const SKIP_NAMES = new Set([".git", "node_modules", "__pycache__", ".DS_Store", "Thumbs.db", "desktop.ini", ".Trash", "$RECYCLE.BIN"]);

export const DEFAULT_CHUNK_OPTIONS = { targetTokens: 600, maxTokens: 850, minTokens: 120, overlapTokens: 80 } as const;

export type OcrMode = "off" | "auto" | "force";
export type SearchMode = "keyword" | "semantic" | "hybrid";

export interface Collection {
  name: string;
  path: string;
  ocr?: OcrMode;
}

interface Config {
  schemaVersion: number;
  collections: Collection[];
}

export interface StructuralUnit {
  type: "text" | "table" | "code";
  text: string;
  breadcrumb: string[];
  page?: number;
  pageEnd?: number;
  blockRange?: [number, number];
}

export interface ParseArtifact {
  schemaVersion: number;
  sourceHash: string;
  parserVersion: string;
  ocrMode: OcrMode;
  title: string;
  markdown: string;
  units: StructuralUnit[];
  metadata?: Record<string, unknown>;
  warnings?: unknown[];
}

export interface TomatoChunk {
  chunkId: string;
  sourceId: string;
  sequence: number;
  type: StructuralUnit["type"];
  title: string;
  breadcrumb: string[];
  body: string;
  pageStart?: number;
  pageEnd?: number;
  tokenCount: number;
  contentHash: string;
  structuralAnchor: string;
}

interface Manifest {
  schemaVersion: number;
  source: {
    id: string;
    collection: string;
    absolutePath: string;
    relativePath: string;
    extension: string;
    size: number;
    mtimeMs: number;
    contentHash: string;
  };
  parserVersion: string;
  ocrMode: OcrMode;
  pipelineFingerprint: string;
  updatedAt: string;
  chunks: TomatoChunk[];
}

export interface UpdateReport {
  collection?: string;
  scanned: number;
  updated: number;
  unchanged: number;
  removed: number;
  failed: Array<{ path: string; error: string }>;
  pipelineFingerprint: string;
}

export interface SearchResult {
  id: string;
  chunkId: string;
  sourceId: string;
  score: number;
  collection: string;
  path: string;
  relativePath: string;
  title: string;
  breadcrumb: string[];
  page?: number;
  pageEnd?: number;
  snippet: string;
  mode?: SearchMode;
}

export interface TomatoSearch {
  results: SearchResult[];
  effectiveMode: SearchMode;
}

export interface ChunkRecord {
  chunkId: string;
  sourceId: string;
  collection: string;
  path: string;
  relativePath: string;
  sequence: number;
  title: string;
  breadcrumb: string[];
  body: string;
  pageStart?: number;
  pageEnd?: number;
  tokenCount: number;
}

export interface SourceRecord {
  sourceId: string;
  collection: string;
  path: string;
  relativePath: string;
  title: string;
  chunks: number;
}

export interface CollectionStatus extends Collection {
  sources: number;
  chunks: number;
  embedded: number;
}

export interface EmbeddingReport {
  collection?: string;
  total: number;
  embedded: number;
  skipped: number;
  model: string;
  dimensions: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  maxTokens?: number;
  minTokens?: number;
  overlapTokens?: number;
}

export class TomatoError extends Error {}

export const PIPELINE_PROFILE = {
  schemaVersion: SCHEMA_VERSION,
  parser: PARSER_VERSION,
  chunker: { version: CHUNKER_VERSION, ...DEFAULT_CHUNK_OPTIONS },
  lexical: SEARCH_VERSION,
  dense: EMBEDDING_PROFILE,
};

export const PIPELINE_FINGERPRINT = sha256(stableJson(PIPELINE_PROFILE));


function sanitizeFtsTerm(term: string): string {
  return term.replace(/[^\p{L}\p{N}'_]+/gu, " ").trim().toLowerCase();
}

function queryParts(query: string): Array<{ value: string; negative: boolean; phrase: boolean }> {
  const parts: Array<{ value: string; negative: boolean; phrase: boolean }> = [];
  const pattern = /(-?)"([^"]+)"|(-?)(\S+)/gu;
  for (const match of query.matchAll(pattern)) {
    const negative = (match[1] ?? match[3]) === "-";
    const value = (match[2] ?? match[4] ?? "").trim();
    if (value) parts.push({ value, negative, phrase: match[2] !== undefined });
  }
  return parts;
}

function ftsExpression(value: string, phrase: boolean): string | undefined {
  const cleaned = sanitizeFtsTerm(value);
  if (!cleaned) return undefined;
  if (CJK_RUN.test(cleaned)) {
    CJK_RUN.lastIndex = 0;
    return `"${normalizeCjkForFts(cleaned).replaceAll('"', '""')}"`;
  }
  CJK_RUN.lastIndex = 0;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  if (phrase || words.length > 1) return `"${words.join(" ").replaceAll('"', '""')}"`;
  return `"${words[0]}"*`;
}

export function buildFtsQuery(query: string, joiner: "AND" | "OR" = "AND"): string {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const part of queryParts(query)) {
    const expression = ftsExpression(part.value, part.phrase);
    if (!expression) continue;
    (part.negative ? negative : positive).push(expression);
  }
  if (!positive.length) throw new TomatoError("검색어를 한 글자 이상 입력하세요.");
  let built = positive.join(` ${joiner} `);
  for (const excluded of negative) built += ` NOT ${excluded}`;
  return built;
}

function markdownUnits(markdown: string): { title?: string; units: StructuralUnit[] } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const units: StructuralUnit[] = [];
  const headings: string[] = [];
  let title: string | undefined;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#+\s*$/, "").trim();
      headings.length = level - 1;
      headings[level - 1] = text;
      title ??= text;
      index += 1;
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const breadcrumb = headings.filter(Boolean);
    if (/^\s*```/.test(line)) {
      const collected = [line];
      index += 1;
      while (index < lines.length) {
        collected.push(lines[index]);
        if (/^\s*```/.test(lines[index])) {
          index += 1;
          break;
        }
        index += 1;
      }
      units.push({ type: "code", text: collected.join("\n").trim(), breadcrumb });
      continue;
    }

    if (isTableStart(lines, index)) {
      const collected: string[] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        collected.push(lines[index]);
        index += 1;
      }
      units.push({ type: "table", text: collected.join("\n").trim(), breadcrumb });
      continue;
    }

    const isList = /^\s*(?:[-*+] |\d+[.)] |[가-힣A-Za-z][.)] )/.test(line);
    const collected = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (/^(#{1,6})\s+/.test(lines[index]) || isTableStart(lines, index) || /^\s*```/.test(lines[index])) break;
      const nextIsList = /^\s*(?:[-*+] |\d+[.)] |[가-힣A-Za-z][.)] )/.test(lines[index]);
      if (isList !== nextIsList && !/^\s+/.test(lines[index])) break;
      collected.push(lines[index]);
      index += 1;
    }
    units.push({ type: "text", text: collected.join("\n").trim(), breadcrumb });
  }

  return { title, units };
}

function isTableStart(lines: string[], index: number): boolean {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) return false;
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(lines[index + 1]);
}

function kordocUnits(blocks: IRBlock[]): StructuralUnit[] {
  return blocksToChunks(blocks, { granularity: "section" }).map((chunk): StructuralUnit => ({
    type: chunk.type === "table" ? "table" : "text",
    text: chunk.text.trim(),
    breadcrumb: chunk.breadcrumb,
    page: chunk.page,
    pageEnd: blocks.slice(chunk.blockRange[0], chunk.blockRange[1] + 1).findLast((block) => block.pageNumber)?.pageNumber,
    blockRange: chunk.blockRange,
  })).filter((unit) => unit.text.length > 0);
}

function splitTable(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const rows = text.split("\n");
  if (rows.length < 3) return splitText(text, maxTokens, 0);
  const header = rows.slice(0, 2);
  const parts: string[] = [];
  let current = [...header];
  for (const row of rows.slice(2)) {
    const candidate = [...current, row].join("\n");
    if (current.length > 2 && estimateTokens(candidate) > maxTokens) {
      parts.push(current.join("\n"));
      current = [...header, row];
    } else {
      current.push(row);
    }
  }
  if (current.length > 2) parts.push(current.join("\n"));
  return parts.flatMap((part) => estimateTokens(part) > maxTokens ? splitText(part, maxTokens, 0) : [part]);
}

function largestPrefixWithin(text: string, maxTokens: number): number {
  const chars = Array.from(text);
  let low = 1;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(chars.slice(0, mid).join("")) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return low;
}

function splitText(text: string, maxTokens: number, overlapTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const paragraphs = text.split(/\n{2,}|(?<=[.!?。！？])\s+/u).filter(Boolean);
  const parts: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
      continue;
    }
    flush();
    let rest = paragraph;
    while (estimateTokens(rest) > maxTokens) {
      const cut = largestPrefixWithin(rest, maxTokens);
      const chars = Array.from(rest);
      let boundary = cut;
      for (let cursor = cut; cursor > Math.max(1, cut - 120); cursor -= 1) {
        if (/\s|[.!?。！？,;]/u.test(chars[cursor - 1])) {
          boundary = cursor;
          break;
        }
      }
      const piece = chars.slice(0, boundary).join("").trim();
      if (piece) parts.push(piece);
      const overlapChars = overlapTokens > 0
        ? largestPrefixWithin(chars.slice(0, boundary).reverse().join(""), overlapTokens)
        : 0;
      rest = chars.slice(Math.max(0, boundary - overlapChars)).join("").trimStart();
    }
    current = rest;
  }
  flush();
  return parts;
}

export function chunkUnits(
  sourceId: string,
  title: string,
  units: StructuralUnit[],
  options: ChunkOptions = {},
): TomatoChunk[] {
  const settings = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  if (settings.minTokens <= 0 || settings.minTokens > settings.targetTokens || settings.targetTokens > settings.maxTokens) {
    throw new TomatoError("chunk 크기는 0 < min <= target <= max 순서여야 합니다.");
  }
  type Candidate = StructuralUnit & { anchor: string };
  const candidates: Candidate[] = [];
  units.forEach((unit, unitIndex) => {
    const pieces = unit.type === "table"
      ? splitTable(unit.text, settings.maxTokens)
      : splitText(unit.text, settings.maxTokens, settings.overlapTokens);
    pieces.forEach((piece, pieceIndex) => candidates.push({
      ...unit,
      text: piece,
      anchor: `${unit.breadcrumb.join(" > ") || "root"}:${unit.type}:${unit.blockRange?.join("-") ?? unitIndex}:${pieceIndex}`,
    }));
  });

  const merged: Candidate[] = [];
  let current: Candidate | undefined;
  const flush = () => {
    if (current) merged.push(current);
    current = undefined;
  };
  for (const candidate of candidates) {
    if (candidate.type === "table" || candidate.type === "code") {
      flush();
      merged.push(candidate);
      continue;
    }
    if (!current) {
      current = candidate;
      continue;
    }
    const sameSection = current.breadcrumb.join("\u0000") === candidate.breadcrumb.join("\u0000");
    const combined = `${current.text}\n\n${candidate.text}`;
    if (sameSection && estimateTokens(combined) <= settings.maxTokens && estimateTokens(current.text) < settings.targetTokens) {
      current = {
        ...current,
        text: combined,
        page: current.page ?? candidate.page,
        pageEnd: candidate.pageEnd ?? candidate.page ?? current.pageEnd,
        anchor: `${current.anchor}+${candidate.anchor}`,
      };
    } else {
      flush();
      current = candidate;
    }
  }
  flush();

  for (let index = merged.length - 1; index > 0; index -= 1) {
    const item = merged[index];
    const previous = merged[index - 1];
    if (
      item.type === "text" && previous.type === "text" &&
      item.breadcrumb.join("\u0000") === previous.breadcrumb.join("\u0000") &&
      estimateTokens(item.text) < settings.minTokens &&
      estimateTokens(`${previous.text}\n\n${item.text}`) <= settings.maxTokens
    ) {
      previous.text = `${previous.text}\n\n${item.text}`;
      previous.pageEnd = item.pageEnd ?? item.page ?? previous.pageEnd;
      previous.anchor = `${previous.anchor}+${item.anchor}`;
      merged.splice(index, 1);
    }
  }

  return merged.map((item, sequence) => {
    const contentHash = sha256(item.text);
    return {
      chunkId: sha256(`${sourceId}\u0000${CHUNKER_VERSION}\u0000${item.anchor}\u0000${contentHash}`).slice(0, 24),
      sourceId,
      sequence,
      type: item.type,
      title,
      breadcrumb: item.breadcrumb,
      body: item.text,
      pageStart: item.page,
      pageEnd: item.pageEnd ?? item.page,
      tokenCount: estimateTokens(item.text),
      contentHash,
      structuralAnchor: item.anchor,
    };
  });
}

export function chunkMarkdown(sourceId: string, title: string, markdown: string, options: ChunkOptions = {}): TomatoChunk[] {
  const parsed = markdownUnits(markdown);
  return chunkUnits(sourceId, parsed.title ?? title, parsed.units, options);
}

export class Tomato {
  readonly home: string;
  readonly fingerprint = PIPELINE_FINGERPRINT;

  readonly modelCache: string;

  constructor(home: string, options: { modelCache?: string } = {}) {
    this.home = resolve(home);
    this.modelCache = resolve(options.modelCache ?? process.env.TOMATO_MODEL_CACHE ?? join(this.home, "models"));
  }

  async init(): Promise<{ home: string; pipelineFingerprint: string }> {
    await Promise.all([
      mkdir(this.home, { recursive: true }),
      mkdir(join(this.home, "artifacts"), { recursive: true }),
      mkdir(join(this.home, "indexes", this.fingerprint.slice(0, 16)), { recursive: true }),
    ]);
    try {
      await readFile(this.configPath(), "utf8");
    } catch (error) {
      if (!isMissing(error)) throw error;
      await atomicJson(this.configPath(), { schemaVersion: SCHEMA_VERSION, collections: [] } satisfies Config);
    }
    this.openDb().close();
    return { home: this.home, pipelineFingerprint: this.fingerprint };
  }

  async registerCollection(folder: string, name: string, ocr: OcrMode = "off"): Promise<Collection> {
    validateCollectionName(name);
    await this.init();
    const resolved = await realpath(resolve(folder));
    if (!(await stat(resolved)).isDirectory()) throw new TomatoError(`폴더가 아닙니다: ${resolved}`);
    const config = await this.readConfig();
    if (config.collections.some((collection) => collection.name === name)) {
      throw new TomatoError(`이미 존재하는 collection 이름입니다: ${name}`);
    }
    if (config.collections.some((collection) => collection.path === resolved)) {
      throw new TomatoError(`이미 등록된 폴더입니다: ${resolved}`);
    }
    const collection: Collection = { name, path: resolved, ocr };
    config.collections.push(collection);
    await atomicJson(this.configPath(), config);
    await this.sync(name);
    return collection;
  }

  async listCollections(): Promise<Collection[]> {
    await this.init();
    return (await this.readConfig()).collections;
  }

  async remove(name: string): Promise<void> {
    validateCollectionName(name);
    await this.init();
    const config = await this.readConfig();
    const next = config.collections.filter((collection) => collection.name !== name);
    if (next.length === config.collections.length) throw new TomatoError(`collection을 찾을 수 없습니다: ${name}`);
    const db = this.openDb();
    try {
      this.deleteCollectionRows(db, name);
    } finally {
      db.close();
    }
    await safeRemoveInside(this.home, this.artifactCollectionDir(name));
    config.collections = next;
    await atomicJson(this.configPath(), config);
  }

  async sync(collectionName?: string): Promise<UpdateReport> {
    await this.init();
    const config = await this.readConfig();
    const collections = collectionName
      ? config.collections.filter((collection) => collection.name === collectionName)
      : config.collections;
    if (collectionName && !collections.length) throw new TomatoError(`collection을 찾을 수 없습니다: ${collectionName}`);

    const total: UpdateReport = {
      collection: collectionName,
      scanned: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      failed: [],
      pipelineFingerprint: this.fingerprint,
    };
    const db = this.openDb();
    try {
      for (const collection of collections) {
        const report = await this.updateCollection(db, collection, collection.ocr ?? "off");
        total.scanned += report.scanned;
        total.updated += report.updated;
        total.unchanged += report.unchanged;
        total.removed += report.removed;
        total.failed.push(...report.failed);
      }
    } finally {
      db.close();
    }
    return total;
  }

  async embedMissing(collectionName?: string, onProgress?: (completed: number, total: number) => void): Promise<EmbeddingReport> {
    await this.init();
    const config = await this.readConfig();
    if (collectionName && !config.collections.some((collection) => collection.name === collectionName)) {
      throw new TomatoError(`collection을 찾을 수 없습니다: ${collectionName}`);
    }
    const filter = collectionName ? "AND c.collection = ?" : "";
    const db = this.openDb();
    try {
      const totalRow = (collectionName
        ? db.prepare("SELECT COUNT(*) AS count FROM chunks c WHERE c.collection = ?").get(collectionName)
        : db.prepare("SELECT COUNT(*) AS count FROM chunks c").get()) as { count: number };
      const pending = (collectionName
        ? db.prepare(`
            SELECT c.* FROM chunks c
            LEFT JOIN embeddings e ON e.chunk_id = c.chunk_id
            WHERE (e.chunk_id IS NULL OR e.profile != ? OR e.content_hash != c.content_hash) ${filter}
            ORDER BY c.collection, c.source_id, c.sequence
          `).all(EMBEDDING_PROFILE, collectionName)
        : db.prepare(`
            SELECT c.* FROM chunks c
            LEFT JOIN embeddings e ON e.chunk_id = c.chunk_id
            WHERE e.chunk_id IS NULL OR e.profile != ? OR e.content_hash != c.content_hash
            ORDER BY c.collection, c.source_id, c.sequence
          `).all(EMBEDDING_PROFILE)) as Record<string, unknown>[];
      const total = Number(totalRow.count);
      let embedded = 0;
      const insert = db.prepare(`
        INSERT INTO embeddings (chunk_id, profile, dimensions, vector, content_hash, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          profile = excluded.profile,
          dimensions = excluded.dimensions,
          vector = excluded.vector,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
      `);
      for (let offset = 0; offset < pending.length; offset += 8) {
        const batch = pending.slice(offset, offset + 8);
        let vectors: Float32Array[];
        try {
          vectors = await embedTexts(batch.map(passageText), "passage", this.modelCache);
        } catch (error) {
          throw new TomatoError(`embedding model 준비 또는 추론 실패: ${errorMessage(error)}`);
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          const updatedAt = new Date().toISOString();
          batch.forEach((row, index) => insert.run(
            String(row.chunk_id),
            EMBEDDING_PROFILE,
            EMBEDDING_DIMENSIONS,
            vectorToBlob(vectors[index]),
            String(row.content_hash),
            updatedAt,
          ));
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        embedded += batch.length;
        onProgress?.(embedded, pending.length);
      }
      return {
        collection: collectionName,
        total,
        embedded,
        skipped: total - pending.length,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      };
    } finally {
      db.close();
    }
  }

  /** Searches the given collections. Falls back to keyword when embeddings are missing or fail. */
  async search(
    query: string,
    options: { collections: string[]; limit?: number; mode?: SearchMode },
  ): Promise<TomatoSearch> {
    await this.init();
    const limit = Math.max(1, Math.min(options.limit ?? 8, 100));
    const mode = options.mode ?? "hybrid";
    const collections = options.collections;
    if (!collections.length) return { results: [], effectiveMode: "keyword" };
    const db = this.openDb();
    try {
      if (mode !== "keyword") {
        try {
          if (mode === "semantic") {
            return { results: await this.semanticSearch(db, query, collections, limit), effectiveMode: "semantic" };
          }
          const candidates = Math.max(50, limit * 5);
          const semantic = await this.semanticSearch(db, query, collections, candidates);
          const keyword = this.keywordSearch(db, query, collections, candidates);
          return { results: reciprocalRankFusion(keyword, semantic, limit), effectiveMode: "hybrid" };
        } catch (error) {
          if (!(error instanceof TomatoError)) throw error;
        }
      }
      return { results: this.keywordSearch(db, query, collections, limit), effectiveMode: "keyword" };
    } finally {
      db.close();
    }
  }

  async getNeighbors(chunkId: string, before: number, after: number): Promise<ChunkRecord[]> {
    await this.init();
    const db = this.openDb();
    try {
      const anchor = db.prepare("SELECT source_id, sequence FROM chunks WHERE chunk_id = ?").get(chunkId) as
        | { source_id: string; sequence: number }
        | undefined;
      if (!anchor) throw new TomatoError(`chunk를 찾을 수 없습니다: ${chunkId}`);
      const rows = db.prepare(`
        SELECT * FROM chunks WHERE source_id = ? AND sequence BETWEEN ? AND ? ORDER BY sequence
      `).all(anchor.source_id, Number(anchor.sequence) - before, Number(anchor.sequence) + after) as Record<string, unknown>[];
      return rows.map(rowToChunk);
    } finally {
      db.close();
    }
  }

  async getChunks(chunkIds: string[]): Promise<ChunkRecord[]> {
    await this.init();
    if (!chunkIds.length) return [];
    const db = this.openDb();
    try {
      const rows = db.prepare(`SELECT * FROM chunks WHERE chunk_id IN (${chunkIds.map(() => "?").join(", ")})`).all(...chunkIds) as Record<string, unknown>[];
      const byId = new Map(rows.map((row) => [String(row.chunk_id), rowToChunk(row)]));
      return chunkIds.map((id) => byId.get(id)).filter((chunk): chunk is ChunkRecord => Boolean(chunk));
    } finally {
      db.close();
    }
  }

  async listSources(collections: string[]): Promise<SourceRecord[]> {
    await this.init();
    if (!collections.length) return [];
    const db = this.openDb();
    try {
      const rows = db.prepare(`
        SELECT source_id, collection, source_path, relative_path, MIN(title) AS title, COUNT(*) AS chunks
        FROM chunks WHERE collection IN (${collections.map(() => "?").join(", ")})
        GROUP BY source_id ORDER BY relative_path
      `).all(...collections) as Record<string, unknown>[];
      return rows.map((row) => ({
        sourceId: String(row.source_id),
        collection: String(row.collection),
        path: String(row.source_path),
        relativePath: String(row.relative_path),
        title: String(row.title),
        chunks: Number(row.chunks),
      }));
    } finally {
      db.close();
    }
  }

  async getSourceChunks(sourceId: string): Promise<ChunkRecord[]> {
    await this.init();
    const db = this.openDb();
    try {
      return (db.prepare("SELECT * FROM chunks WHERE source_id = ? ORDER BY sequence").all(sourceId) as Record<string, unknown>[]).map(rowToChunk);
    } finally {
      db.close();
    }
  }

  async status(): Promise<CollectionStatus[]> {
    await this.init();
    const config = await this.readConfig();
    const db = this.openDb();
    try {
      const statement = db.prepare(`
        SELECT COUNT(DISTINCT c.source_id) AS sources, COUNT(*) AS chunks, COUNT(e.chunk_id) AS embedded
        FROM chunks c
        LEFT JOIN embeddings e ON e.chunk_id = c.chunk_id AND e.profile = ? AND e.content_hash = c.content_hash
        WHERE c.collection = ?
      `);
      return config.collections.map((collection) => {
        const row = statement.get(EMBEDDING_PROFILE, collection.name) as { sources: number; chunks: number; embedded: number };
        return { ...collection, sources: Number(row.sources), chunks: Number(row.chunks), embedded: Number(row.embedded) };
      });
    } finally {
      db.close();
    }
  }

  private async updateCollection(db: DatabaseSync, collection: Collection, ocr: OcrMode): Promise<UpdateReport> {
    const report: UpdateReport = {
      collection: collection.name,
      scanned: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      failed: [],
      pipelineFingerprint: this.fingerprint,
    };
    const files = await scanFiles(collection.path, this.home);
    report.scanned = files.length;
    const seen = new Set<string>();
    const indexedSources = new Set((db.prepare("SELECT DISTINCT source_id FROM chunks WHERE collection = ?")
      .all(collection.name) as Array<{ source_id: string }>).map((row) => row.source_id));
    await mkdir(this.artifactCollectionDir(collection.name), { recursive: true });

    for (const absolutePath of files) {
      const relativePath = portableRelative(collection.path, absolutePath);
      const sourceId = sha256(`${collection.name}\u0000${relativePath}`).slice(0, 24);
      seen.add(sourceId);
      const sourceDir = join(this.artifactCollectionDir(collection.name), sourceId);
      const manifestPath = join(sourceDir, "manifest.json");
      const parsePath = join(sourceDir, "parse.json");
      const info = await stat(absolutePath);
      const existing = await readJson<Manifest>(manifestPath);

      if (
        existing?.source.size === info.size &&
        existing.source.mtimeMs === info.mtimeMs &&
        existing.pipelineFingerprint === this.fingerprint &&
        existing.ocrMode === ocr &&
        indexedSources.has(sourceId)
      ) {
        report.unchanged += 1;
        continue;
      }

      try {
        const buffer = await readFile(absolutePath);
        const contentHash = sha256(buffer);
        if (
          existing?.source.contentHash === contentHash &&
          existing.pipelineFingerprint === this.fingerprint &&
          existing.ocrMode === ocr &&
          indexedSources.has(sourceId)
        ) {
          existing.source.size = info.size;
          existing.source.mtimeMs = info.mtimeMs;
          await atomicJson(manifestPath, existing);
          report.unchanged += 1;
          continue;
        }

        let artifact = await readJson<ParseArtifact>(parsePath);
        if (!artifact || artifact.sourceHash !== contentHash || artifact.parserVersion !== PARSER_VERSION || artifact.ocrMode !== ocr) {
          artifact = await parseSource(absolutePath, buffer, contentHash, ocr);
          await atomicJson(parsePath, artifact);
        }
        const chunks = chunkUnits(sourceId, artifact.title || basename(absolutePath), artifact.units);
        if (!chunks.length) throw new Error("검색 가능한 텍스트를 찾지 못했습니다.");
        const manifest: Manifest = {
          schemaVersion: SCHEMA_VERSION,
          source: {
            id: sourceId,
            collection: collection.name,
            absolutePath,
            relativePath,
            extension: extname(absolutePath).toLowerCase(),
            size: info.size,
            mtimeMs: info.mtimeMs,
            contentHash,
          },
          parserVersion: PARSER_VERSION,
          ocrMode: ocr,
          pipelineFingerprint: this.fingerprint,
          updatedAt: new Date().toISOString(),
          chunks,
        };
        this.replaceSourceRows(db, manifest);
        await Promise.all([
          atomicJson(join(sourceDir, "chunks.json"), chunks),
          atomicJson(manifestPath, manifest),
        ]);
        report.updated += 1;
      } catch (error) {
        report.failed.push({ path: absolutePath, error: errorMessage(error) });
      }
    }

    for (const manifest of await this.collectionManifests(collection.name)) {
      if (seen.has(manifest.source.id)) continue;
      this.deleteSourceRows(db, manifest.source.id);
      await safeRemoveInside(this.home, join(this.artifactCollectionDir(collection.name), manifest.source.id));
      report.removed += 1;
    }
    return report;
  }

  private keywordSearch(db: DatabaseSync, query: string, collections: string[], limit: number): SearchResult[] {
    let rows = this.searchRows(db, buildFtsQuery(query), collections, limit * 8);
    if (!rows.length && queryParts(query).filter((part) => !part.negative).length > 1) {
      rows = this.searchRows(db, buildFtsQuery(query, "OR"), collections, limit * 8);
    }
    return rowsToResults(rows, query, limit, "keyword", (row) => Math.max(0, -Number(row.rank)));
  }

  private async semanticSearch(db: DatabaseSync, query: string, collections: string[], limit: number): Promise<SearchResult[]> {
    const placeholders = collections.map(() => "?").join(", ");
    const coverage = db.prepare(`
      SELECT COUNT(*) AS total, COUNT(e.chunk_id) AS embedded
      FROM chunks c
      LEFT JOIN embeddings e ON e.chunk_id = c.chunk_id AND e.profile = ? AND e.content_hash = c.content_hash
      WHERE c.collection IN (${placeholders})
    `).get(EMBEDDING_PROFILE, ...collections) as { total: number; embedded: number };
    const total = Number(coverage.total);
    const embedded = Number(coverage.embedded);
    if (!total) return [];
    if (embedded !== total) throw new TomatoError(`embedding이 완성되지 않았습니다 (${embedded}/${total}).`);
    const semanticQuery = queryParts(query).filter((part) => !part.negative).map((part) => part.value).join(" ").trim();
    if (!semanticQuery) throw new TomatoError("검색어를 한 글자 이상 입력하세요.");
    let queryVector: Float32Array;
    try {
      [queryVector] = await embedTexts([semanticQuery], "query", this.modelCache);
    } catch (error) {
      throw new TomatoError(`embedding query 추론 실패: ${errorMessage(error)}`);
    }
    const rows = db.prepare(`
      SELECT c.*, e.vector, e.dimensions FROM chunks c
      JOIN embeddings e ON e.chunk_id = c.chunk_id
      WHERE e.profile = ? AND e.content_hash = c.content_hash AND c.collection IN (${placeholders})
    `).all(EMBEDDING_PROFILE, ...collections) as Record<string, unknown>[];

    // ponytail: O(N×384) is simplest for local corpora; add sqlite-vec/HNSW only when measured p95 requires it.
    for (const row of rows) {
      if (!(row.vector instanceof Uint8Array) || Number(row.dimensions) !== EMBEDDING_DIMENSIONS) {
        throw new Error(`잘못된 embedding row: ${row.chunk_id}`);
      }
      row.semantic_score = cosineSimilarity(queryVector, blobToVector(row.vector));
    }
    rows.sort((left, right) => Number(right.semantic_score) - Number(left.semantic_score)
      || String(left.source_id).localeCompare(String(right.source_id))
      || Number(left.sequence) - Number(right.sequence));
    return rowsToResults(rows, semanticQuery, limit, "semantic", (row) => Number(row.semantic_score));
  }

  private searchRows(db: DatabaseSync, expression: string, collections: string[], limit: number): Record<string, unknown>[] {
    const placeholders = collections.map(() => "?").join(", ");
    return db.prepare(`
      SELECT c.*, bm25(chunks_fts, 0.0, 5.0, 2.0, 1.0) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.chunk_id = chunks_fts.chunk_id
      WHERE chunks_fts MATCH ? AND c.collection IN (${placeholders})
      ORDER BY rank, c.source_id, c.sequence
      LIMIT ?
    `).all(expression, ...collections, limit) as Record<string, unknown>[];
  }

  private replaceSourceRows(db: DatabaseSync, manifest: Manifest): void {
    db.exec("BEGIN IMMEDIATE");
    try {
      const currentChunks = new Map(manifest.chunks.map((chunk) => [chunk.chunkId, chunk.contentHash]));
      const reusableEmbeddings = (db.prepare(`
        SELECT e.* FROM embeddings e
        JOIN chunks c ON c.chunk_id = e.chunk_id
        WHERE c.source_id = ?
      `).all(manifest.source.id) as Record<string, unknown>[])
        .filter((row) => currentChunks.get(String(row.chunk_id)) === String(row.content_hash));
      this.deleteSourceRows(db, manifest.source.id, false);
      const insertChunk = db.prepare(`
        INSERT INTO chunks (
          chunk_id, source_id, collection, source_path, relative_path, source_type, title,
          breadcrumb, body, page_start, page_end, content_hash, pipeline_fingerprint,
          sequence, token_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = db.prepare("INSERT INTO chunks_fts (chunk_id, title, breadcrumb, body) VALUES (?, ?, ?, ?)");
      const restoreEmbedding = db.prepare(`
        INSERT INTO embeddings (chunk_id, profile, dimensions, vector, content_hash, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of manifest.chunks) {
        insertChunk.run(
          chunk.chunkId,
          chunk.sourceId,
          manifest.source.collection,
          manifest.source.absolutePath,
          manifest.source.relativePath,
          manifest.source.extension,
          chunk.title,
          JSON.stringify(chunk.breadcrumb),
          chunk.body,
          chunk.pageStart ?? null,
          chunk.pageEnd ?? null,
          chunk.contentHash,
          manifest.pipelineFingerprint,
          chunk.sequence,
          chunk.tokenCount,
          manifest.updatedAt,
        );
        insertFts.run(
          chunk.chunkId,
          normalizeCjkForFts(chunk.title),
          normalizeCjkForFts(chunk.breadcrumb.join(" ")),
          normalizeCjkForFts(chunk.body),
        );
      }
      for (const embedding of reusableEmbeddings) {
        restoreEmbedding.run(
          String(embedding.chunk_id),
          String(embedding.profile),
          Number(embedding.dimensions),
          embedding.vector as Uint8Array,
          String(embedding.content_hash),
          String(embedding.updated_at),
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private deleteSourceRows(db: DatabaseSync, sourceId: string, transaction = true): void {
    if (transaction) db.exec("BEGIN IMMEDIATE");
    try {
      const ids = db.prepare("SELECT chunk_id FROM chunks WHERE source_id = ?").all(sourceId) as Array<{ chunk_id: string }>;
      const deleteFts = db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
      for (const { chunk_id } of ids) deleteFts.run(chunk_id);
      db.prepare("DELETE FROM chunks WHERE source_id = ?").run(sourceId);
      if (transaction) db.exec("COMMIT");
    } catch (error) {
      if (transaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  private deleteCollectionRows(db: DatabaseSync, collection: string): void {
    db.exec("BEGIN IMMEDIATE");
    try {
      const ids = db.prepare("SELECT chunk_id FROM chunks WHERE collection = ?").all(collection) as Array<{ chunk_id: string }>;
      const deleteFts = db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
      for (const { chunk_id } of ids) deleteFts.run(chunk_id);
      db.prepare("DELETE FROM chunks WHERE collection = ?").run(collection);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private async collectionManifests(collection: string): Promise<Manifest[]> {
    const directory = this.artifactCollectionDir(collection);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const manifests = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readJson<Manifest>(join(directory, entry.name, "manifest.json"))));
    return manifests.filter((manifest): manifest is Manifest => Boolean(manifest));
  }

  private openDb(): DatabaseSync {
    const path = join(this.home, "indexes", this.fingerprint.slice(0, 16), "index.sqlite");
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        source_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        source_type TEXT NOT NULL,
        title TEXT NOT NULL,
        breadcrumb TEXT NOT NULL,
        body TEXT NOT NULL,
        page_start INTEGER,
        page_end INTEGER,
        content_hash TEXT NOT NULL,
        pipeline_fingerprint TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_source_id ON chunks(source_id);
      CREATE INDEX IF NOT EXISTS chunks_collection ON chunks(collection);
      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id) ON DELETE CASCADE,
        profile TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS embeddings_profile ON embeddings(profile);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        title,
        breadcrumb,
        body,
        tokenize='porter unicode61'
      );
    `);
    return db;
  }

  private async readConfig(): Promise<Config> {
    const config = await readJson<Config>(this.configPath());
    if (!config || config.schemaVersion !== SCHEMA_VERSION || !Array.isArray(config.collections)) {
      throw new TomatoError(`지원하지 않는 config입니다: ${this.configPath()}`);
    }
    for (const collection of config.collections) {
      if (!collection || typeof collection.name !== "string" || typeof collection.path !== "string" || !isAbsolute(collection.path)) {
        throw new TomatoError(`잘못된 collection 설정입니다: ${this.configPath()}`);
      }
      validateCollectionName(collection.name);
    }
    return config;
  }

  private configPath(): string {
    return join(this.home, "config.json");
  }

  private artifactCollectionDir(collection: string): string {
    return join(this.home, "artifacts", collection);
  }

}

function rowToChunk(row: Record<string, unknown>): ChunkRecord {
  return {
    chunkId: String(row.chunk_id),
    sourceId: String(row.source_id),
    collection: String(row.collection),
    path: String(row.source_path),
    relativePath: String(row.relative_path),
    sequence: Number(row.sequence),
    title: String(row.title),
    breadcrumb: JSON.parse(String(row.breadcrumb)) as string[],
    body: String(row.body),
    pageStart: row.page_start == null ? undefined : Number(row.page_start),
    pageEnd: row.page_end == null ? undefined : Number(row.page_end),
    tokenCount: Number(row.token_count),
  };
}

function passageText(row: Record<string, unknown>): string {
  const breadcrumb = JSON.parse(String(row.breadcrumb)) as string[];
  return [String(row.title), breadcrumb.join(" > "), String(row.body)].filter(Boolean).join("\n");
}

function rowsToResults(
  rows: Record<string, unknown>[],
  query: string,
  limit: number,
  mode: SearchMode,
  score: (row: Record<string, unknown>) => number,
): SearchResult[] {
  const perSource = new Map<string, number>();
  const results: SearchResult[] = [];
  for (const row of rows) {
    const sourceId = String(row.source_id);
    const count = perSource.get(sourceId) ?? 0;
    if (count >= 2) continue;
    perSource.set(sourceId, count + 1);
    results.push({
      id: `${row.collection}:${row.relative_path}#${row.chunk_id}`,
      chunkId: String(row.chunk_id),
      sourceId,
      score: score(row),
      collection: String(row.collection),
      path: String(row.source_path),
      relativePath: String(row.relative_path),
      title: String(row.title),
      breadcrumb: JSON.parse(String(row.breadcrumb)) as string[],
      page: row.page_start == null ? undefined : Number(row.page_start),
      pageEnd: row.page_end == null ? undefined : Number(row.page_end),
      snippet: makeSnippet(String(row.body), query),
      mode,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function reciprocalRankFusion(keyword: SearchResult[], semantic: SearchResult[], limit: number): SearchResult[] {
  const fused = new Map<string, { result: SearchResult; score: number }>();
  for (const results of [keyword, semantic]) {
    results.forEach((result, index) => {
      const item = fused.get(result.chunkId) ?? { result, score: 0 };
      item.score += 1 / (60 + index + 1);
      fused.set(result.chunkId, item);
    });
  }
  const ranked = [...fused.values()].sort((left, right) => right.score - left.score
    || left.result.chunkId.localeCompare(right.result.chunkId));
  const perSource = new Map<string, number>();
  const results: SearchResult[] = [];
  for (const item of ranked) {
    const source = `${item.result.collection}\u0000${item.result.path}`;
    const count = perSource.get(source) ?? 0;
    if (count >= 2) continue;
    perSource.set(source, count + 1);
    results.push({ ...item.result, score: item.score, mode: "hybrid" });
    if (results.length >= limit) break;
  }
  return results;
}

export async function parseSource(path: string, buffer: Buffer, contentHash: string, ocr: OcrMode): Promise<ParseArtifact> {
  const extension = extname(path).toLowerCase();
  if (extension === ".md" || extension === ".markdown" || extension === ".txt") {
    const markdown = buffer.toString("utf8").normalize("NFC");
    const parsed = markdownUnits(markdown);
    return {
      schemaVersion: SCHEMA_VERSION,
      sourceHash: contentHash,
      parserVersion: PARSER_VERSION,
      ocrMode: ocr,
      title: parsed.title ?? basename(path, extension),
      markdown,
      units: parsed.units,
    };
  }
  const result = await parse(buffer, {
    ocr: ocr === "force" ? "force" : ocr === "auto",
    removeHeaderFooter: true,
    filePath: path,
  });
  if (!result.success) throw new Error(`${result.code ?? "PARSE_ERROR"}: ${result.error}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceHash: contentHash,
    parserVersion: PARSER_VERSION,
    ocrMode: ocr,
    title: result.metadata?.title ?? basename(path, extension),
    markdown: result.markdown,
    units: kordocUnits(result.blocks),
    metadata: result.metadata as Record<string, unknown> | undefined,
    warnings: result.warnings,
  };
}

async function scanFiles(root: string, excludedRoot: string): Promise<string[]> {
  const files: string[] = [];
  const excluded = resolve(excludedRoot);
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (resolve(path) === excluded) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

function makeSnippet(body: string, query: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  const terms = queryParts(query).filter((part) => !part.negative).map((part) => sanitizeFtsTerm(part.value)).filter(Boolean);
  const lower = compact.toLowerCase();
  const found = terms.map((term) => lower.indexOf(term.toLowerCase())).find((index) => index >= 0) ?? 0;
  const start = Math.max(0, found - 90);
  const end = Math.min(compact.length, start + 280);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function validateCollectionName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new TomatoError("collection 이름은 영문·숫자로 시작하는 1~64자의 영문·숫자·_·-만 허용합니다.");
  }
}

async function atomicText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function safeRemoveInside(root: string, target: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`삭제 대상이 Tomato 홈 밖입니다: ${resolvedTarget}`);
  }
  await rm(resolvedTarget, { recursive: true, force: true });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
