import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import type { KetchupEAgentAPI } from "@app-types/Agent.types";
import type { BusinessAction } from "@app-types/BusinessTool.types";
import BusinessToolPanel, { BusinessArtifacts } from "./BusinessToolPanel";

beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true; }; });
const file = { sourceId: "local", relativePath: "source.xlsx", name: "source.xlsx" };
const action: BusinessAction = { id: "action", type: "business_tool", title: "일일자금일보", question: "자료를 지정하세요", fields: [{ key: "date", label: "기준일", type: "date", required: true }, { key: "source", label: "입출금 내역", type: "file", required: true }], input: { values: {}, files: {} } };
const apiFixture = () => ({ listWorkSources: vi.fn().mockResolvedValue([{ id: "local" }]), listWorkFiles: vi.fn().mockResolvedValue([file]), submitBusinessInput: vi.fn().mockResolvedValue(undefined), pickWorkFiles: vi.fn().mockResolvedValue([]), listBusinessArtifacts: vi.fn().mockResolvedValue([]), openBusinessArtifact: vi.fn().mockResolvedValue(undefined) }) as unknown as KetchupEAgentAPI;

it("collects declared inputs without a mapping editor and passes the owning action", async () => {
  const api = apiFixture(); render(<BusinessToolPanel api={api} runId="run" action={action} onClose={vi.fn()} />);
  await screen.findByRole("option", { name: "source.xlsx" });
  fireEvent.change(screen.getByLabelText("기준일 *"), { target: { value: "2026-10-15" } });
  fireEvent.change(screen.getByLabelText("입출금 내역 연결된 자료에서 고르기"), { target: { value: JSON.stringify(file) } });
  fireEvent.click(screen.getByRole("button", { name: "이 자료로 실행" }));
  await waitFor(() => expect(api.submitBusinessInput).toHaveBeenCalledWith("run", "action", { values: { date: "2026-10-15" }, files: { source: [file] } }));
  expect(screen.queryByText("검증한 매핑 저장")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "폴더 선택" })).not.toBeInTheDocument();
});
it("adds several picked files to a multi-file field and lets one be removed", async () => {
  const api = apiFixture(); const second = { sourceId: "s2", relativePath: "", name: "국민.xlsx" };
  vi.mocked(api.pickWorkFiles).mockResolvedValue([file, second]);
  const multi: BusinessAction = { ...action, fields: [{ ...action.fields[1], multiple: true }] };
  render(<BusinessToolPanel api={api} runId="run" action={multi} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "파일 추가…" }));
  await screen.findByText("국민.xlsx");
  expect(api.pickWorkFiles).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "source.xlsx 빼기" }));
  fireEvent.click(screen.getByRole("button", { name: "이 자료로 실행" }));
  await waitFor(() => expect(api.submitBusinessInput).toHaveBeenCalledWith("run", "action", { values: {}, files: { source: [second] } }));
});
it("keeps a rejected input visible for correction", async () => {
  const api = apiFixture(); vi.mocked(api.submitBusinessInput).mockRejectedValue(new Error("자료 확인 필요"));
  render(<BusinessToolPanel api={api} runId="run" action={{ ...action, input: { values: { date: "2026-10-15" }, files: { source: [file] } } }} onClose={vi.fn()} />);
  await screen.findByText("source.xlsx");
  fireEvent.click(screen.getByRole("button", { name: "이 자료로 실행" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("자료 확인 필요");
});
it("reloads completed artifacts and opens by artifact ID rather than renderer path", async () => {
  const api = apiFixture(); const view = render(<BusinessArtifacts api={api} threadId="thread" running={true} />);
  await waitFor(() => expect(api.listBusinessArtifacts).toHaveBeenCalled());
  vi.mocked(api.listBusinessArtifacts).mockResolvedValue([{ id: "artifact", runId: "run", name: "일보.xlsx", toolId: "daily_cash", version: "1.0" }]);
  view.rerender(<BusinessArtifacts api={api} threadId="thread" running={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "일보.xlsx 열기 · v1.0" }));
  expect(api.openBusinessArtifact).toHaveBeenCalledWith("artifact");
});

it("still offers available files when an older source no longer exists", async () => {
  const api = apiFixture();
  vi.mocked(api.listWorkSources).mockResolvedValue([{ id: "gone", name: "gone", kind: "file", displayPath: "/gone" }, { id: "local", name: "local", kind: "file", displayPath: "/local" }]);
  vi.mocked(api.listWorkFiles).mockImplementation(async (id) => { if (id === "gone") throw new Error("missing"); return [file]; });
  render(<BusinessToolPanel api={api} runId="run" action={action} onClose={vi.fn()} />);
  await screen.findByRole("option", { name: "source.xlsx" });
  expect(screen.getByRole("alert")).toHaveTextContent("일부 연결된 자료");
});
it("edits planned movements in a table and submits the amount changes and added rows as edits JSON", async () => {
  const api = apiFixture();
  const rows = [{ index: 1, direction: "out" as const, description: "전력비", party: "한전", amount: "202230" }, { index: 2, direction: "out" as const, description: "인터넷", party: "SKB", amount: "63000" }];
  const table: BusinessAction = { ...action, fields: [{ key: "actualEdits", label: "10/14 실적", type: "movements", required: true, rows }], input: { values: {}, files: {} } };
  render(<BusinessToolPanel api={api} runId="run" action={table} onClose={vi.fn()} />);
  await screen.findByText("전력비");
  fireEvent.change(screen.getByLabelText("2번 실제 금액"), { target: { value: "55550" } });
  fireEvent.click(screen.getByRole("button", { name: "계획에 없는 거래 추가" }));
  fireEvent.change(screen.getByLabelText("추가 거래 구분"), { target: { value: "in" } });
  fireEvent.change(screen.getByLabelText("추가 거래 적요"), { target: { value: "현금반납" } });
  fireEvent.change(screen.getByLabelText("추가 거래 거래처"), { target: { value: "박정경" } });
  fireEvent.change(screen.getByLabelText("추가 거래 금액"), { target: { value: "48200" } });
  fireEvent.click(screen.getByRole("button", { name: "이 자료로 실행" }));
  await waitFor(() => expect(api.submitBusinessInput).toHaveBeenCalledTimes(1));
  const submitted = vi.mocked(api.submitBusinessInput).mock.calls[0][2];
  expect(JSON.parse(submitted.values.actualEdits)).toEqual({ changes: [{ index: 2, amount: "55550" }], add: [{ direction: "in", description: "현금반납", party: "박정경", amount: "48200" }] });
});
