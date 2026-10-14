import { WorkSourcesFlow } from "../agent/workSourcesFlow.ts";
import { createThread, ensureWorkspace, getRun, getRunAction } from "../agent/store.ts";
// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openAgentDb } from "../db/openAgentDb.ts";
import { extractRows, inspectWorkbook, loadWorkbook } from "../work/mapping.ts";
import type { WorkbookJob } from "../work/reader.ts";
import type { AgentRuntime } from "../agent/runtime.ts";
import type { SourceProfile } from "../../src/app-types/WorkSource.types.ts";

const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), paths: [] as string[], read: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mock.handlers.set(name, handler) }, BrowserWindow: { fromWebContents: () => null }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: mock.paths }) } }));
vi.mock("../work/reader.ts", () => ({ readWorkbookJob: mock.read }));
import { registerWorkSourceHandlers } from "./workSourceHandlers.ts";

let flow: WorkSourcesFlow;
let folder: string; let db: ReturnType<typeof openAgentDb>;
const invoke = (name: string, ...args: unknown[]) => mock.handlers.get(`work:${name}`)!({ sender: {} }, ...args);
const profile: SourceProfile = { id: "", name: "입출금", revision: 0, mapping: { sheet: "자료", headerRow: 1, firstDataRow: 2, columns: [{ field: "accountId", header: "계좌", type: "text", required: true }], filters: [] } };
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "work-ipc-")); db = openAgentDb(":memory:");
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("자료").addRows([["계좌"], ["00123"]]);
  const path = join(folder, "source.xlsx"); await writeFile(path, Buffer.from(await workbook.xlsx.writeBuffer())); mock.paths = [path];
  mock.read.mockImplementation(async (_path: string, job: WorkbookJob) => {
    const book = await loadWorkbook(job.bytes);
    return job.action.kind === "inspect" ? inspectWorkbook(book, job.fingerprint, job.action.sheet, job.action.headerRow) : extractRows(book, job.fingerprint, job.action.mapping);
  });
  flow = new WorkSourcesFlow(db, () => undefined);
  registerWorkSourceHandlers({ db, workSourcesFlow: flow } as AgentRuntime, "worker");
});
afterEach(async () => { db.close(); mock.handlers.clear(); mock.read.mockReset(); await rm(folder, { recursive: true, force: true }); });

it("connects a native selection through inspection, validated extraction and persisted profile", async () => {
  const [source] = await invoke("pickSources", "file");
  const [file] = await invoke("listFiles", source.id);
  const overview = await invoke("inspect", file);
  expect((await invoke("preview", file, overview.fingerprint, profile.mapping)).matchedRows).toBe(1);
  const saved = await invoke("saveProfile", file, overview.fingerprint, profile);
  expect(invoke("listProfiles")).toEqual([saved]);
  await writeFile(mock.paths[0], "changed");
  await expect(invoke("saveProfile", file, overview.fingerprint, saved)).rejects.toThrow("원본 파일이 변경");
  expect(invoke("listProfiles")[0].revision).toBe(1);
});

it("does not save a profile with missing required data or no matched rows", async () => {
  const [source] = await invoke("pickSources", "file"); const [file] = await invoke("listFiles", source.id); const overview = await invoke("inspect", file);
  const empty = { ...profile, mapping: { ...profile.mapping, filters: [{ field: "accountId", operator: "equals", value: "missing" }] } };
  await expect(invoke("saveProfile", file, overview.fingerprint, empty)).rejects.toThrow("대상 행");
  expect(invoke("listProfiles")).toEqual([]);
});

it("continues the owning workflow only with a current file, mapping and action", async () => {
  const workspace = ensureWorkspace(db);
  const thread = createThread(db, workspace.id);
  const { runId } = flow.start({ threadId: thread.id, workspaceId: workspace.id, text: "일일자금일보 작성" }, "daily_cash");
  const action = getRunAction(db, runId)!;
  const [source] = await invoke("pickSources", "file"); const [file] = await invoke("listFiles", source.id);
  const overview = await invoke("inspect", file);
  const saved = await invoke("saveProfile", file, overview.fingerprint, profile);
  const selection = { file, fingerprint: overview.fingerprint, profileId: saved.id, profileRevision: saved.revision };
  await expect(invoke("submitSelection", runId, "stale", selection)).rejects.toThrow("변경된 입력");
  await expect(invoke("submitSelection", runId, action.id, { ...selection, profileRevision: 2 })).rejects.toThrow("매핑이 변경");
  await invoke("submitSelection", runId, action.id, selection);
  expect(getRun(db, runId).status).toBe("abstained");
  expect(getRunAction(db, runId)).toBeUndefined();
  await expect(invoke("submitSelection", runId, action.id, selection)).rejects.toThrow("변경된 입력");
});
it("rejects completion after cancellation while the workbook is being read", async () => {
  const workspace = ensureWorkspace(db); const thread = createThread(db, workspace.id);
  const { runId } = flow.start({ threadId: thread.id, workspaceId: workspace.id, text: "연결" }, "work_sources");
  const action = getRunAction(db, runId)!;
  const [source] = await invoke("pickSources", "file"); const [file] = await invoke("listFiles", source.id);
  const overview = await invoke("inspect", file); const saved = await invoke("saveProfile", file, overview.fingerprint, profile);
  const implementation = mock.read.getMockImplementation()!;
  mock.read.mockImplementationOnce(async (...args) => { flow.cancel(runId); return implementation(...args); });
  await expect(invoke("submitSelection", runId, action.id, { file, fingerprint: overview.fingerprint, profileId: saved.id, profileRevision: saved.revision })).rejects.toThrow("변경된 입력");
  expect(getRun(db, runId).status).toBe("cancelled");
});
it("returns only the files chosen in the dialog, even when others are already connected", async () => {
  const other = join(folder, "other.xlsx"); await writeFile(other, await readFile(mock.paths[0]));
  mock.paths = [other]; await invoke("pickSources", "file");
  mock.paths = [join(folder, "source.xlsx"), other];
  expect((await invoke("pickFiles", true)).map((file: { name: string }) => file.name)).toEqual(["source.xlsx", "other.xlsx"]);
  expect(invoke("listSources")).toHaveLength(2);
});
