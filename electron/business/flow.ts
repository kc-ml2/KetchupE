import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgentStreamEvent, StartRunInput } from "../../src/app-types/Agent.types.ts";
import type { BusinessAction, BusinessArtifact, BusinessField, BusinessInput } from "../../src/app-types/BusinessTool.types.ts";
import { appendMessage, createRun, getRun, getRunAction, setRunStatus } from "../agent/store.ts";
import { TraceWriter } from "../agent/trace.ts";
import type { AgentWorkflow } from "../agent/workflows.ts";
import { WorkSources } from "../work/sources.ts";
import { businessInputSchema, type BusinessTool } from "./contracts.ts";

type Job = { toolId: string; version: string; input: BusinessInput; fingerprints: Record<string, string[]>; fields: BusinessField[]; checkpoint?: Record<string, unknown>; pendingKeys?: string[] };
const emptyInput = (): BusinessInput => ({ values: {}, files: {} });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fieldKey = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export class BusinessFlow {
  private readonly tools = new Map<string, BusinessTool>();
  private readonly pending = new Set<Promise<void>>();
  private readonly active = new Map<string, AbortController>();
  constructor(private readonly db: DatabaseSync, tools: BusinessTool[], private readonly outputDir: string,
    private readonly emit: (event: AgentStreamEvent) => void,
    private readonly validateWorkbook: (bytes: Uint8Array) => Promise<void>,
    private readonly timeoutMs = 120000) {
    for (const tool of tools) {
      if (this.tools.has(tool.id)) throw new Error("duplicate business tool");
      this.validateFields(tool.fields);
      this.tools.set(tool.id, tool);
    }
  }

  workflows(): AgentWorkflow[] {
    return [...this.tools.values()].map((tool) => ({ ...tool, kind: tool.id,
      start: (input) => this.start(tool, input), resume: (id, text) => this.resume(id, text), cancel: (id) => this.cancel(id),
    }));
  }

  private start(tool: BusinessTool, input: StartRunInput) {
    const runId = createRun(this.db, { threadId: input.threadId, goal: input.text, kind: tool.id, retrievalProfile: "local", policyProfile: `${tool.id}@${tool.version}`, answerProfile: "deterministic" });
    appendMessage(this.db, { threadId: input.threadId, runId, role: "user", content: input.text });
    new TraceWriter(this.db, runId).record("run.started", "runtime", { localOnly: true, toolId: tool.id, version: tool.version });
    this.save(runId, { toolId: tool.id, version: tool.version, input: emptyInput(), fingerprints: {}, fields: tool.fields });
    if (tool.unavailableReason) this.finish(runId, tool.unavailableReason, "abstained");
    else this.ask(runId, "기준 정보와 원천 파일을 지정해 주세요.");
    return { runId, done: Promise.resolve() };
  }

  private resume(runId: string, text: string) {
    this.job(runId);
    if (getRun(this.db, runId).status !== "waiting_user") throw new Error("입력 대기 중인 작업이 아닙니다.");
    if (/^(취소|중단|그만|cancel|stop)[.!\s]*$/i.test(text.trim())) this.cancel(runId);
    else {
      appendMessage(this.db, { threadId: getRun(this.db, runId).threadId, runId, role: "user", content: text });
      this.ask(runId, "입력 화면에서 확인 내용을 작성해 주세요. 확인되지 않은 대화 내용을 계산 입력으로 사용하지 않습니다.");
    }
    return { runId, done: Promise.resolve() };
  }

  submit(runId: string, actionId: string, raw: unknown): Promise<void> {
    const task = this.executeSubmission(runId, actionId, raw);
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  private async executeSubmission(runId: string, actionId: string, raw: unknown): Promise<void> {
    const job = this.job(runId);
    const tool = this.tools.get(job.toolId);
    if (!tool || tool.version !== job.version) throw new Error("업무 버전이 변경되었습니다. 현재 작업을 중단하고 새로 요청해 주세요.");
    if (getRunAction(this.db, runId)?.id !== actionId || this.active.has(runId)) throw new Error("이미 처리되었거나 변경된 입력 요청입니다.");
    const input = businessInputSchema.parse(raw);
    this.validateInput(job.fields, input);
    if (Object.entries(job.input.values).some(([key, value]) => value && input.values[key] !== value && (tool.fields.some((field) => field.key === key) || !job.pendingKeys?.includes(key))) || Object.keys(job.fingerprints).some((key) => JSON.stringify(input.files[key]) !== JSON.stringify(job.input.files[key]))) throw new Error("확정된 원천 자료나 기준 정보는 변경할 수 없습니다. 새 작업으로 요청해 주세요.");
    const controller = new AbortController();
    this.active.set(runId, controller);
    const timeout = setTimeout(() => controller.abort(new Error("업무 실행 시간이 초과되었습니다.")), this.timeoutMs);
    setRunStatus(this.db, runId, "running");
    this.event(runId, "status", { phase: "원천 자료 확인 및 업무 실행 중" });
    try {
      const files: Parameters<BusinessTool["execute"]>[0]["files"] = {};
      const sources = new WorkSources(this.db);
      let totalBytes = 0;
      for (const [key, list] of Object.entries(input.files)) {
        files[key] = [];
        for (const file of list) {
          const value = await sources.read(file);
          totalBytes += value.bytes.length;
          if (totalBytes > 100 * 1024 * 1024) throw new Error("원천 자료 합계는 100MB 이하여야 합니다.");
          files[key].push({ ...value, name: file.name });
        }
        const fingerprints = files[key].map((value) => value.fingerprint);
        if (new Set(fingerprints).size !== fingerprints.length) throw new Error("같은 파일이 두 번 지정되었습니다. 중복 파일을 빼고 다시 실행해 주세요.");
        if (job.fingerprints[key] && (JSON.stringify(job.fingerprints[key]) !== JSON.stringify(fingerprints) || JSON.stringify(job.input.files[key]) !== JSON.stringify(list))) throw new Error("원천 파일이 변경되었습니다. 새 작업으로 다시 실행해 주세요.");
      }
      controller.signal.throwIfAborted();
      job.input = input;
      job.fingerprints = Object.fromEntries(Object.entries(files).map(([key, list]) => [key, list.map((value) => value.fingerprint)]));
      this.save(runId, job);
      const result = await this.abortable(tool.execute({ values: input.values, files, checkpoint: job.checkpoint ?? {}, signal: controller.signal }), controller.signal);
      controller.signal.throwIfAborted();
      if (Object.values(input.files).flat().some((file) => !sources.list().some((source) => source.id === file.sourceId))) throw new Error("실행 중 자료 연결이 해제되었습니다.");
      if (result.status === "needs_input") {
        this.validateFields(result.fields);
        const merged = new Map(job.fields.map((field) => [field.key, field]));
        for (const field of result.fields) {
          if (merged.has(field.key) && merged.get(field.key)!.type !== field.type) throw new Error("추가 입력 항목의 형식이 변경되었습니다.");
          merged.set(field.key, field);
        }
        job.fields = [...merged.values()]; this.validateFields(job.fields);
        job.pendingKeys = result.fields.map((field) => field.key);
        job.checkpoint = result.checkpoint ?? job.checkpoint;
        if (JSON.stringify(job.checkpoint ?? {}).length > 1000000) throw new Error("업무 중간 상태가 너무 큽니다.");
        this.save(runId, job); this.ask(runId, result.question);
      } else if (result.status === "failed") this.fail(runId, result.message);
      else if (result.status === "completed") {
        if (!result.checks.length || result.checks.some((check) => check.passed !== true)) throw new Error("업무 검증을 통과하지 못했습니다.");
        if (!/^[^/\\:*?"<>|]{1,150}\.xlsx$/i.test(result.file.name) || [...result.file.name].some((char) => char.charCodeAt(0) < 32) || !(result.file.bytes instanceof Uint8Array) || result.file.bytes.length > 20 * 1024 * 1024) throw new Error("잘못된 출력 파일입니다.");
        await this.abortable(this.validateWorkbook(result.file.bytes), controller.signal);
        controller.signal.throwIfAborted();
        const id = randomUUID();
        await mkdir(this.outputDir, { recursive: true });
        const directory = join(this.outputDir, id);
        await mkdir(directory);
        const path = join(directory, result.file.name);
        await writeFile(path, result.file.bytes, { flag: "wx", mode: 0o600 });
        let transaction = false;
        try {
          controller.signal.throwIfAborted();
          this.db.exec("BEGIN"); transaction = true;
          this.db.prepare("INSERT INTO business_artifacts (id, run_id, name, fingerprint, audit) VALUES (?, ?, ?, ?, ?)").run(id, runId, result.file.name, hash(result.file.bytes), JSON.stringify({ checks: result.checks, externalData: result.externalData ?? {} }));
          this.finish(runId, `${result.summary}\n\n완성 파일: ${result.file.name}`, "completed", false);
          this.db.exec("COMMIT"); transaction = false;
        } catch (error) { if (transaction) this.db.exec("ROLLBACK"); await unlink(path); throw error; }
        this.event(runId, "completed", { text: `${result.summary}\n\n완성 파일: ${result.file.name}`, outcome: "success" });
      } else throw new Error("잘못된 업무 결과입니다.");
    } catch (error) {
      if (getRun(this.db, runId).status === "running") this.fail(runId, error instanceof Error ? error.message : String(error));
    } finally { clearTimeout(timeout); this.active.delete(runId); }
  }

  cancel(runId: string) {
    this.job(runId);
    const run = getRun(this.db, runId);
    if (run.status !== "running" && run.status !== "waiting_user") return;
    this.active.get(runId)?.abort(new Error("작업을 중단했습니다."));
    setRunStatus(this.db, runId, "cancelled", "CANCELLED");
    this.event(runId, "failed", { code: "CANCELLED", message: "작업을 중단했습니다." });
  }
  async stop() { for (const id of this.active.keys()) this.cancel(id); await Promise.allSettled([...this.pending]); }

  artifacts(threadId: string): BusinessArtifact[] {
    return this.db.prepare("SELECT a.id, a.run_id AS runId, a.name, j.payload FROM business_artifacts a JOIN runs r ON r.id = a.run_id JOIN business_jobs j ON j.run_id = r.id WHERE r.thread_id = ? AND r.status = 'completed' ORDER BY r.created_at").all(threadId).map((row) => {
      const job = JSON.parse(String(row.payload)) as Job;
      return { id: String(row.id), runId: String(row.runId), name: String(row.name), toolId: job.toolId, version: job.version };
    });
  }
  async artifactPath(id: string): Promise<string> {
    const row = this.db.prepare("SELECT a.fingerprint, a.name FROM business_artifacts a JOIN runs r ON r.id = a.run_id WHERE a.id = ? AND r.status = 'completed'").get(id);
    if (!row || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("완료된 결과 파일이 없습니다.");
    const path = join(this.outputDir, id, String(row.name));
    if (hash(await readFile(path)) !== row.fingerprint) throw new Error("결과 파일이 변경되었습니다.");
    return path;
  }
  private job(runId: string): Job {
    const row = this.db.prepare("SELECT payload FROM business_jobs WHERE run_id = ?").get(runId);
    if (!row) throw new Error("등록된 업무 실행이 아닙니다.");
    return JSON.parse(String(row.payload)) as Job;
  }
  private save(runId: string, job: Job) {
    this.db.prepare("INSERT INTO business_jobs (run_id, payload) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET payload = excluded.payload").run(runId, JSON.stringify(job));
  }
  private ask(runId: string, question: string) {
    const job = this.job(runId);
    const action: BusinessAction = { id: randomUUID(), type: "business_tool", title: this.tools.get(job.toolId)?.title ?? job.toolId, question, fields: job.fields, input: job.input, lockedKeys: [...Object.keys(job.fingerprints), ...Object.entries(job.input.values).filter(([key, value]) => value && (!job.pendingKeys?.includes(key) || this.tools.get(job.toolId)?.fields.some((field) => field.key === key))).map(([key]) => key)] };
    this.db.prepare("INSERT INTO run_actions (run_id, action) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET action = excluded.action").run(runId, JSON.stringify(action));
    setRunStatus(this.db, runId, "waiting_user");
    appendMessage(this.db, { threadId: getRun(this.db, runId).threadId, runId, role: "assistant", content: question });
    this.event(runId, "ask_user", { question, action });
  }
  private finish(runId: string, text: string, status: "completed" | "abstained", emit = true) {
    setRunStatus(this.db, runId, status);
    appendMessage(this.db, { threadId: getRun(this.db, runId).threadId, runId, role: "assistant", content: text });
    if (emit) this.event(runId, "completed", { text, outcome: status === "completed" ? "success" : "abstained" });
  }
  private fail(runId: string, message: string) {
    setRunStatus(this.db, runId, "failed", "TOOL_FAILED");
    appendMessage(this.db, { threadId: getRun(this.db, runId).threadId, runId, role: "assistant", content: message });
    this.event(runId, "failed", { code: "TOOL_FAILED", message });
  }
  private event(runId: string, type: AgentStreamEvent["type"], payload: unknown) {
    const traceType = type === "ask_user" ? "run.waiting_user" : type === "completed" ? "run.completed" : type === "failed" ? "run.failed" : "tool.started";
    const seq = new TraceWriter(this.db, runId).record(traceType, "runtime", { localOnly: true });
    this.emit({ runId, seq, type, payload });
  }
  private validateFields(fields: BusinessField[]) {
    if (!fields.length || fields.length > 30 || new Set(fields.map((field) => field.key)).size !== fields.length || fields.some((field) => !fieldKey.test(field.key) || ["__proto__", "constructor", "prototype"].includes(field.key) || !["text", "date", "file"].includes(field.type))) throw new Error("잘못된 업무 입력 정의입니다.");
  }
  private validateInput(fields: BusinessField[], input: BusinessInput) {
    for (const key of Object.keys(input.values)) if (!fields.some((field) => field.key === key && field.type !== "file")) throw new Error("등록되지 않은 입력입니다.");
    for (const key of Object.keys(input.files)) if (!fields.some((field) => field.key === key && field.type === "file")) throw new Error("등록되지 않은 파일 항목입니다.");
    for (const field of fields) {
      const value = field.type === "file" ? input.files[field.key]?.length : input.values[field.key]?.trim();
      if (field.required && !value) throw new Error(`${field.label}을 지정해 주세요.`);
      if (field.type === "file" && !field.multiple && (input.files[field.key]?.length ?? 0) > 1) throw new Error(`${field.label}은 파일 하나만 지정할 수 있습니다.`);
      if (field.type === "date" && value && (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new Error("유효한 기준일을 입력하세요.");
    }
  }
  private async abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let abort!: () => void;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true }); })]); }
    finally { signal.removeEventListener("abort", abort); }
  }
}
