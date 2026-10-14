// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openAgentDb } from "../db/openAgentDb.ts";
import { createThread, ensureWorkspace, getRun, getRunAction } from "../agent/store.ts";
import { WorkSources } from "../work/sources.ts";
import { loadWorkbook } from "../work/mapping.ts";
import { BusinessFlow } from "./flow.ts";
import { dailyCashTool } from "./dailyCash.ts";
import type { BusinessTool, ToolResult } from "./contracts.ts";
import type { BusinessInput } from "../../src/app-types/BusinessTool.types.ts";

let folder: string;
let db: ReturnType<typeof openAgentDb>;
let output: Buffer;
let input: BusinessInput;
let tool: BusinessTool;
let threadId: string;
let flow: BusinessFlow;
const emit = vi.fn();
const success = (): ToolResult => ({ status: "completed", summary: "테스트 업무 완료", file: { name: "테스트결과.xlsx", bytes: output }, checks: [{ name: "정답 비교", passed: true }], externalData: { rate: "fixture-only" } });
const makeFlow = (tools = [tool], timeout = 1000) => new BusinessFlow(db, tools, join(folder, "output"), emit, async (bytes) => { await loadWorkbook(bytes); }, timeout);
const start = () => flow.workflows()[0].start({ threadId, workspaceId: "default", text: "테스트 엑셀 만들어줘" }).runId;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "business-tool-")); db = openAgentDb(join(folder, "agent.sqlite"));
  ensureWorkspace(db); threadId = createThread(db, "default").id; emit.mockReset();
  const book = new ExcelJS.Workbook(); book.addWorksheet("자료").addRows([["금액"], [100]]); output = Buffer.from(await book.xlsx.writeBuffer());
  const path = join(folder, "source.xlsx"); await writeFile(path, output);
  const sources = new WorkSources(db); const [source] = await sources.register([path], "file"); const [file] = await sources.files(source.id);
  input = { values: { businessDate: "2026-10-15" }, files: { source: [file] } };
  tool = { id: "fixture", title: "테스트 업무", version: "1.0", description: "테스트 전용", fields: [{ key: "businessDate", type: "date", label: "기준일", required: true }, { key: "source", type: "file", label: "원천", required: true }], execute: vi.fn(async () => success()) };
  flow = makeFlow();
});
afterEach(async () => { await flow.stop(); db.close(); await rm(folder, { recursive: true, force: true }); });

it("executes a registered tool using selected bytes and delivers only verified artifacts", async () => {
  const runId = start(); const action = getRunAction(db, runId)!;
  await flow.submit(runId, action.id, input);
  expect(getRun(db, runId).status).toBe("completed");
  expect(tool.execute).toHaveBeenCalledWith(expect.objectContaining({ values: input.values, files: { source: [{ bytes: output, fingerprint: expect.any(String), name: "source.xlsx" }] } }));
  const [artifact] = flow.artifacts(threadId); expect(artifact).toMatchObject({ runId, version: "1.0", name: "테스트결과.xlsx" });
  const path = await flow.artifactPath(artifact.id); expect(path).toContain(folder);
  await writeFile(path, "modified"); await expect(flow.artifactPath(artifact.id)).rejects.toThrow("변경");
  await expect(flow.submit(runId, action.id, input)).rejects.toThrow("이미 처리");
  expect(JSON.parse(String(db.prepare("SELECT audit FROM business_artifacts").get()!.audit)).externalData).toEqual({ rate: "fixture-only" });
});

it("persists additional structured input across DB reopen and pins the tool version", async () => {
  vi.mocked(tool.execute).mockResolvedValueOnce({ status: "needs_input", question: "어떤 계좌인가요?", checkpoint: { fx: { value: "1300.00", date: "2026-10-15", source: "fixture" } }, fields: [{ key: "account", type: "text", label: "계좌", required: true }] });
  const runId = start(); const first = getRunAction(db, runId)!;
  await flow.submit(runId, first.id, input);
  expect(getRun(db, runId).status).toBe("waiting_user");
  await flow.stop(); db.close(); db = openAgentDb(join(folder, "agent.sqlite")); flow = makeFlow();
  const next = getRunAction(db, runId)!;
  expect(next).toMatchObject({ type: "business_tool", input, question: "어떤 계좌인가요?" });
  await expect(flow.submit(runId, first.id, input)).rejects.toThrow("변경된 입력");
  await expect(flow.submit(runId, next.id, input)).rejects.toThrow("계좌");
  await expect(flow.submit(runId, next.id, { ...input, values: { ...input.values, businessDate: "2026-10-16", account: "001" } })).rejects.toThrow("기준 정보");
  const updated = makeFlow([{ ...tool, version: "2.0" }]);
  await expect(updated.submit(runId, next.id, input)).rejects.toThrow("업무 버전");
  await flow.submit(runId, next.id, { ...input, values: { ...input.values, account: "001" } });
  expect(getRun(db, runId).status).toBe("completed");
  expect(tool.execute).toHaveBeenLastCalledWith(expect.objectContaining({ checkpoint: { fx: { value: "1300.00", date: "2026-10-15", source: "fixture" } } }));
});

it("does not reuse answers when the pinned source changed", async () => {
  vi.mocked(tool.execute).mockResolvedValueOnce({ status: "needs_input", question: "확인", fields: [{ key: "confirm", type: "text", label: "확인", required: true }] });
  const runId = start(); await flow.submit(runId, getRunAction(db, runId)!.id, input);
  await writeFile(join(folder, "source.xlsx"), "changed");
  await flow.submit(runId, getRunAction(db, runId)!.id, { ...input, values: { ...input.values, confirm: "yes" } });
  expect(getRun(db, runId).status).toBe("failed"); expect(tool.execute).toHaveBeenCalledTimes(1); expect(flow.artifacts(threadId)).toEqual([]);
});

it("rejects missing, extra, invalid dates and unregistered file paths before calling the tool", async () => {
  const runId = start(); const actionId = getRunAction(db, runId)!.id;
  await expect(flow.submit(runId, actionId, { ...input, values: {} })).rejects.toThrow("기준일");
  await expect(flow.submit(runId, actionId, { ...input, values: { businessDate: "2026-02-30" } })).rejects.toThrow("기준일");
  await expect(flow.submit(runId, actionId, { ...input, values: { ...input.values, rogue: "x" } })).rejects.toThrow("등록되지 않은");
  await flow.submit(runId, actionId, { ...input, files: { source: [{ ...input.files.source[0], relativePath: "../outside.xlsx" }] } });
  expect(tool.execute).not.toHaveBeenCalled(); expect(getRun(db, runId).status).toBe("failed");
});

it.each(["checks", "xlsx", "name", "throw"])("never publishes invalid output: %s", async (kind) => {
  vi.mocked(tool.execute).mockImplementation(async () => {
    if (kind === "throw") throw new Error("계산 실패");
    const result = success(); if (result.status !== "completed") throw new Error("fixture");
    if (kind === "checks") result.checks[0].passed = false;
    if (kind === "xlsx") result.file.bytes = Buffer.from("not excel");
    if (kind === "name") result.file.name = "../outside.xlsx";
    return result;
  });
  const runId = start(); await flow.submit(runId, getRunAction(db, runId)!.id, input);
  expect(getRun(db, runId).status).toBe("failed"); expect(flow.artifacts(threadId)).toEqual([]);
});

it("ignores late completion after cancellation and prevents simultaneous submissions", async () => {
  let resolve!: (result: ToolResult) => void;
  let entered!: () => void; const started = new Promise<void>((done) => { entered = done; });
  vi.mocked(tool.execute).mockImplementation(() => { entered(); return new Promise((done) => { resolve = done; }); });
  const runId = start(); const actionId = getRunAction(db, runId)!.id;
  const pending = flow.submit(runId, actionId, input); await started;
  await expect(flow.submit(runId, actionId, input)).rejects.toThrow("이미 처리");
  flow.cancel(runId); resolve(success()); await pending;
  expect(getRun(db, runId).status).toBe("cancelled"); expect(flow.artifacts(threadId)).toEqual([]);
});

it("rejects several files for a single-file field", async () => {
  const runId = start(); const [file] = input.files.source;
  await expect(flow.submit(runId, getRunAction(db, runId)!.id, { ...input, files: { source: [file, { ...file, name: "again.xlsx" }] } })).rejects.toThrow("하나만");
});

it("refuses the same file twice in a multi-file field before calling the tool", async () => {
  await flow.stop(); flow = makeFlow([{ ...tool, fields: tool.fields.map((field) => ({ ...field, multiple: field.type === "file" })) }]);
  const runId = start(); const [file] = input.files.source;
  await flow.submit(runId, getRunAction(db, runId)!.id, { ...input, files: { source: [file, file] } });
  expect(getRun(db, runId).status).toBe("failed"); expect(tool.execute).not.toHaveBeenCalled();
});

it("times out a tool that never returns", async () => {
  vi.mocked(tool.execute).mockImplementation(() => new Promise(() => undefined)); flow = makeFlow([tool], 30);
  const runId = start(); await flow.submit(runId, getRunAction(db, runId)!.id, input);
  expect(getRun(db, runId).status).toBe("failed"); expect(flow.artifacts(threadId)).toEqual([]);
});

it("reports the real daily cash tool as unavailable without producing a fake report", () => {
  flow = makeFlow([dailyCashTool]); const runId = start();
  expect(getRun(db, runId).status).toBe("abstained"); expect(getRunAction(db, runId)).toBeUndefined(); expect(flow.artifacts(threadId)).toEqual([]);
});

it("allows correcting a supplemental answer when the tool asks for it again", async () => {
  const question: ToolResult = { status: "needs_input", question: "유효한 계좌를 입력하세요", fields: [{ key: "account", type: "text", label: "계좌", required: true }] };
  vi.mocked(tool.execute).mockResolvedValueOnce(question).mockResolvedValueOnce(question).mockResolvedValueOnce(success());
  const runId = start(); await flow.submit(runId, getRunAction(db, runId)!.id, input);
  await flow.submit(runId, getRunAction(db, runId)!.id, { ...input, values: { ...input.values, account: "wrong" } });
  expect(getRunAction(db, runId)).toMatchObject({ lockedKeys: expect.arrayContaining(["businessDate", "source"]) });
  await flow.submit(runId, getRunAction(db, runId)!.id, { ...input, values: { ...input.values, account: "correct" } });
  expect(getRun(db, runId).status).toBe("completed");
});
it("does not publish when source access is revoked during execution", async () => {
  vi.mocked(tool.execute).mockImplementation(async () => { new WorkSources(db).remove(input.files.source[0].sourceId); return success(); });
  const runId = start(); await flow.submit(runId, getRunAction(db, runId)!.id, input);
  expect(getRun(db, runId).status).toBe("failed"); expect(flow.artifacts(threadId)).toEqual([]);
});
