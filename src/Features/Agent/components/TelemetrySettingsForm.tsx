import { useEffect, useState } from "react";
import type { KetchupEAgentAPI, TelemetryView } from "@app-types/Agent.types";

/** Langfuse mirror of the local trajectory: cross-user analysis, DAU/MAU, and A/B by variant. Off by default. */
const TelemetrySettingsForm = ({ api }: { api: KetchupEAgentAPI }): React.JSX.Element => {
  const [view, setView] = useState<TelemetryView | null>(null);
  const [secretKey, setSecretKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.getTelemetrySettings().then(setView);
  }, [api]);

  if (!view) return <p className="text-xs text-[#71717A]">불러오는 중…</p>;

  const update = (patch: Partial<TelemetryView>) => setView({ ...view, ...patch });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.setTelemetrySettings({ enabled: view.enabled, host: view.host, publicKey: view.publicKey, secretKey: secretKey || undefined, userId: view.userId, includeContent: view.includeContent, variant: view.variant });
      setSecretKey("");
      const result = view.enabled ? await api.testTelemetry() : { ok: true, message: "저장했습니다. (전송 꺼짐)" };
      setView(await api.getTelemetrySettings());
      setMessage(result.message);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const field = "w-full px-2 py-1.5 text-sm rounded border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#0F0F0F] text-[#18181B] dark:text-[#FAFAFA]";
  return (
    <form onSubmit={save} className="flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={view.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
        <span>Langfuse로 trajectory 전송</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#71717A]">Langfuse host</span>
        <input value={view.host} onChange={(event) => update({ host: event.target.value })} placeholder="https://cloud.langfuse.com" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#71717A]">public key</span>
        <input value={view.publicKey} onChange={(event) => update({ publicKey: event.target.value })} placeholder="pk-lf-…" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#71717A]">secret key {view.hasSecretKey ? "(저장됨, 변경 시에만 입력)" : ""}</span>
        <input type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="sk-lf-…" className={field} autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#71717A]">사용자 ID (이메일 등, DAU/MAU 집계용. 비우면 익명 install id)</span>
        <input value={view.userId} onChange={(event) => update({ userId: event.target.value })} className={field} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={view.includeContent} onChange={(event) => update({ includeContent: event.target.checked })} />
        <span>업무 원문 포함 (질문·답변·검색어·선택 context·evidence)</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#71717A]">A/B variant (현재 배정: {view.assignedVariant}, 변경은 재시작 후 적용)</span>
        <select value={view.variant} onChange={(event) => update({ variant: event.target.value })} className={field}>
          <option value="">자동 배정</option>
          {view.variants.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="self-start px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#0066FF] text-white">저장 및 연결 확인</button>
      {message && <p className="text-xs text-[#71717A]">{message}</p>}
      <p className="text-[11px] text-[#71717A]">끄면 원문은 hash로 전송됩니다. 켜면 evidence snippet·문서 제목·선택된 memory와 최근 대화도 전송됩니다. 절대 파일 경로와 API key는 전송하지 않습니다.</p>
      <p className="text-[11px] text-[#71717A]">조직 공용 Langfuse secret을 외부 배포 앱에 포함하지 마세요. 이 직접 연결은 사용자 소유 key 또는 내부 배포용입니다.</p>
    </form>
  );
};

export default TelemetrySettingsForm;
