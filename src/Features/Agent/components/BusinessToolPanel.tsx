import { useEffect, useRef, useState } from "react";
import { LuFile } from "react-icons/lu";
import type { KetchupEAgentAPI } from "@app-types/Agent.types";
import type { BusinessAction, BusinessArtifact, BusinessInput } from "@app-types/BusinessTool.types";
import type { WorkFile, WorkSource } from "@app-types/WorkSource.types";

const control = "rounded border border-[#D4D4D8] dark:border-[#52525B] p-2 bg-white dark:bg-[#18181B] text-sm disabled:opacity-50";
const sameFile = (a: WorkFile, b: WorkFile) => a.sourceId === b.sourceId && a.relativePath === b.relativePath;
async function availableFiles(api: KetchupEAgentAPI, sources: WorkSource[]) {
  const results = await Promise.allSettled(sources.map((source) => api.listWorkFiles(source.id)));
  return { files: results.flatMap((result) => result.status === "fulfilled" ? result.value : []), missing: results.some((result) => result.status === "rejected") };
}
export default function BusinessToolPanel({ api, runId, action, onClose }: { api: KetchupEAgentAPI; runId: string; action: BusinessAction; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState<BusinessInput>(action.input);
  const [files, setFiles] = useState<WorkFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    void api.listWorkSources().then((sources) => availableFiles(api, sources)).then((result) => { if (alive) { setFiles(result.files); if (result.missing) setError("일부 연결된 자료를 찾을 수 없습니다. 필요한 파일을 다시 선택해 주세요."); } }).catch((cause) => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [api]);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="business-tool-title" className="w-[min(700px,94vw)] max-h-[90vh] rounded-xl bg-white dark:bg-[#18181B] text-[#18181B] dark:text-[#FAFAFA] p-6 backdrop:bg-black/40">
    <div className="flex justify-between gap-4"><h2 id="business-tool-title">{action.title}</h2><button type="button" onClick={onClose}>닫기</button></div>
    <p className="my-3 whitespace-pre-wrap">{action.question}</p>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { await api.submitBusinessInput(runId, action.id, input); }); }}>
      <fieldset disabled={busy} className="grid gap-3">
        {action.fields.map((field) => {
          const locked = action.lockedKeys?.includes(field.key);
          const label = `${field.label}${field.required ? " *" : ""}`;
          if (field.type !== "file") return <label key={field.key} className="grid gap-1 text-sm">{label}
            <input className={control} disabled={locked} type={field.type} required={field.required} maxLength={4000} value={input.values[field.key] ?? ""} onChange={(event) => setInput((current) => ({ ...current, values: { ...current.values, [field.key]: event.target.value } }))} />
          </label>;
          const chosen = input.files[field.key] ?? [];
          // Single-file fields replace the selection; multi-file fields append without duplicates.
          const choose = (picked: WorkFile[]) => setInput((current) => {
            const merged = field.multiple ? [...(current.files[field.key] ?? []), ...picked] : picked.slice(0, 1);
            const unique = merged.filter((file, index) => merged.findIndex((item) => sameFile(item, file)) === index);
            return { ...current, files: { ...current.files, [field.key]: unique } };
          });
          const remove = (file: WorkFile) => setInput((current) => ({ ...current, files: { ...current.files, [field.key]: (current.files[field.key] ?? []).filter((item) => !sameFile(item, file)) } }));
          return <fieldset key={field.key} disabled={locked} className="grid gap-1 text-sm">
            <legend>{label}{field.multiple ? " (여러 파일 가능)" : ""}</legend>
            <ul aria-label={`${field.label} 선택된 파일`} className="grid gap-1">
              {chosen.map((file) => <li key={`${file.sourceId}:${file.relativePath}`} className="flex justify-between gap-2"><span>{file.relativePath || file.name}</span><button type="button" onClick={() => remove(file)} aria-label={`${file.name} 빼기`}>빼기</button></li>)}
            </ul>
            <div className="flex gap-2">
              <button className={control} type="button" onClick={() => void perform(async () => choose(await api.pickWorkFiles(Boolean(field.multiple))))}>{field.multiple ? "파일 추가…" : "파일 선택…"}</button>
              {files.length > 0 && <select aria-label={`${field.label} 연결된 자료에서 고르기`} className={control} value="" onChange={(event) => { const file = files.find((item) => JSON.stringify(item) === event.target.value); if (file) choose([file]); }}>
                <option value="">연결된 자료에서 고르기</option>
                {files.filter((file) => !chosen.some((item) => sameFile(item, file))).map((file) => <option key={`${file.sourceId}:${file.relativePath}`} value={JSON.stringify(file)}>{file.relativePath || file.name}</option>)}
              </select>}
            </div>
          </fieldset>;
        })}
        <button className={control} type="submit">이 자료로 실행</button>
      </fieldset>
    </form>
    {busy && <p role="status">업무를 실행하고 있습니다. 대화의 작업 중단으로 취소할 수 있습니다.</p>}
  </dialog>;
}

export function BusinessArtifacts({ api, threadId, running }: { api: KetchupEAgentAPI; threadId: string; running: boolean }) {
  const [items, setItems] = useState<BusinessArtifact[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true; setItems([]); setError("");
    void api.listBusinessArtifacts(threadId).then((result) => { if (alive) setItems(result); }).catch((cause) => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [api, threadId, running]);
  return <div className="flex flex-wrap gap-2 mb-2">
    {items.map((item) => <button className={`${control} inline-flex items-center gap-1 text-black dark:text-white`} key={item.id} type="button" onClick={() => void api.openBusinessArtifact(item.id).catch((cause) => setError(String(cause)))}><LuFile aria-hidden />{item.name} 열기 · v{item.version}</button>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
