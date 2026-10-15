// @vitest-environment node
import { expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { dailyCashTool, applyEdits } from "./dailyCash.ts";
import { fixtureBooks } from "./dailyCash/fixtures.ts";
import { readCashStatus } from "./dailyCash/cashStatus.ts";
import { readWeekly } from "./dailyCash/weekly.ts";
import { parseHana } from "./dailyCash/hana.ts";
import { Money } from "./dailyCash/values.ts";
import type { BusinessTool } from "./contracts.ts";
vi.mock("./dailyCash/hana.ts", async (original) => ({ ...await original<typeof import("./dailyCash/hana.ts")>(), fetchHana: vi.fn(async (day: string) => ({ date: day, requestedDate: day, round: "10", publishedAt: "테스트 고시", source: "fixture-only", fetchedAt: "2026-10-14T00:00:00Z", responseHash: "fixture", perUnit: { USD: "1400", JPY: "9.5", CNY: "200" } })) }));
async function setup() {
  const books = fixtureBooks(); const file = async (book: ExcelJS.Workbook, name: string) => ({ bytes: Buffer.from(await book.xlsx.writeBuffer()), name, fingerprint: name });
  const input: Parameters<BusinessTool["execute"]>[0] = { values: { workDate: "2026-10-14", actualEdits: "확인", planEdits: "확인" }, files: { previousReport: [await file(books.report, "전일일보.xlsx")], weeklyPlans: [await file(books.weekly, "계획.xlsx")], cashStatus: [await file(books.status, "261013_자금현황표[KC].xlsx")] }, checkpoint: {}, signal: new AbortController().signal };
  return { books, input, file };
}
async function confirm(input: Parameters<BusinessTool["execute"]>[0]) {
  const review = await dailyCashTool.execute(input);
  expect(review.status, JSON.stringify(review)).toBe("needs_input");
  if (review.status !== "needs_input") throw new Error("review");
  const code = review.question.match(/확인 [a-f0-9]{12}/)?.[0]; expect(code, review.question).toBeTruthy();
  return dailyCashTool.execute({ ...input, checkpoint: review.checkpoint ?? {}, values: { ...input.values, review: code! } });
}
it("appends a dated sheet, redeems a maturity, reconciles KC cash and returns a real PNG", async () => {
  const { input } = await setup(); const result = await confirm(input);
  expect(result.status, JSON.stringify(result.status === "failed" ? result : {})).toBe("completed");
  if (result.status !== "completed") return;
  const b = new ExcelJS.Workbook(); await b.xlsx.load(Buffer.from(result.file.bytes) as unknown as ExcelJS.Buffer);
  expect(b.getWorksheet("261012")!.getCell("H10").value).toBe(100000);
  const s = b.getWorksheet("261013")!;
  expect(s.model.merges).toEqual(b.getWorksheet("261012")!.model.merges);
  expect(s.getCell("C131").master.address).toBe("B131");
  expect(s.getCell("D10").value).toBe(100000); expect(s.getCell("H10").result).toBe(109000);
  expect(s.getCell("G51").value).toBe(10000); expect(s.getCell("H51").result).toBe(0);
  expect(s.getCell("G248").value).toBe(109000); expect(s.getCell("H237").result).toBe(107000);
  expect(s.getCell("K23").value).toBe(9.5); expect(s.getCell("H27").formula).toBe("H26");
  expect(s.getCell("J23").result).toBe(0); expect(s.pageSetup.printArea).toBe("A1:M248");
  expect(Buffer.from(result.image!.bytes).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); expect(result.image!.bytes.length).toBeGreaterThan(10000);
  expect(result.externalData?.matured).toHaveLength(1);
});
it("matches the KC file date to the report date (work date minus one), not the work date", async () => {
  const { input, books, file } = await setup(); input.files.cashStatus = [await file(books.status, "261014_자금현황표[KC].xlsx")];
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "failed", message: expect.stringContaining("기준일 2026-10-14와 일보 기준일 2026-10-13") });
});
it("carries sub-won interest fractions forward and reconciles them against whole-won KC balances", async () => {
  const { input, books, file } = await setup(); books.report.getWorksheet("261012")!.getCell("H10").value = 100000.27878; input.files.previousReport = [await file(books.report, "전일일보.xlsx")];
  const result = await confirm(input); expect(result.status, JSON.stringify(result.status === "failed" ? result : {})).toBe("completed");
  if (result.status !== "completed") return;
  const b = new ExcelJS.Workbook(); await b.xlsx.load(Buffer.from(result.file.bytes) as unknown as ExcelJS.Buffer); const s = b.getWorksheet("261013")!;
  expect(s.getCell("D10").value).toBe(100000.27878); expect(s.getCell("H10").result).toBe(109000.27878);
});
it("prefills today, the previous report, the weekly plan and the report-date KC file from connected folders", () => {
  const wf = (name: string) => ({ sourceId: "s", relativePath: name, name });
  const files = ["261013_일일자금일보 .xlsx", "261014_일일자금일보.xlsx", "일일자금일보 샘플.xlsx", "일일자금일보 업무흐름.xlsx", "주간자금계획서_1002.xlsx", "주간자금계획서_1009.xlsx", "주간자금계획서_1016.xlsx", "261014_자금현황표[KC].xlsx", "261013_자금현황표[KC].xlsx"].map(wf);
  const suggested = dailyCashTool.suggest!(files, "2026-10-15");
  expect(suggested.values.workDate).toBe("2026-10-15");
  expect(suggested.files.previousReport.map((f) => f.name)).toEqual(["261013_일일자금일보 .xlsx"]);
  expect(suggested.files.weeklyPlans.map((f) => f.name)).toEqual(["주간자금계획서_1009.xlsx"]);
  expect(suggested.files.cashStatus.map((f) => f.name)).toEqual(["261014_자금현황표[KC].xlsx"]);
  expect(dailyCashTool.suggest!(files, "2026-10-19").files.weeklyPlans.map((f) => f.name)).toEqual(["주간자금계획서_1016.xlsx"]);
});
it("reads a truly empty cell as 0 but still asks for a formula without a saved result", async () => {
  const { input, books, file } = await setup(); const s = books.report.getWorksheet("261012")!;
  s.getCell("I30").value = null; input.files.previousReport = [await file(books.report, "전일일보.xlsx")];
  expect((await confirm(input)).status).toBe("completed");
  s.getCell("I30").value = { formula: "H30*1" } as ExcelJS.CellValue; input.files.previousReport = [await file(books.report, "전일일보.xlsx")];
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "needs_input", fields: [expect.objectContaining({ key: "cell_I30", type: "number" })] });
  input.values.cell_I30 = "0"; expect((await confirm(input)).status).toBe("completed");
});
it("asks for actual execution, rather than treating weekly plans as actuals", async () => {
  const { input } = await setup(); delete input.values.actualEdits;
  const result = await dailyCashTool.execute(input); expect(result).toMatchObject({ status: "needs_input", fields: [expect.objectContaining({ key: "actualEdits", type: "movements", rows: [{ index: 1, direction: "in", description: "정기예금 만기 원금", party: "테스트은행", amount: "10000" }, expect.objectContaining({ index: 2, direction: "out", amount: "1000" })] }), expect.objectContaining({ key: "planEdits", type: "movements", rows: [expect.objectContaining({ index: 1, direction: "out", amount: "2000" })] })] });
});
it("rejects duplicate weekly versions and an already existing target sheet", async () => {
  const { input, books, file } = await setup(); input.files.weeklyPlans.push(input.files.weeklyPlans[0]);
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "failed", message: expect.stringContaining("중복") });
  input.files.weeklyPlans.pop(); books.report.addWorksheet("261013"); input.files.previousReport = [await file(books.report, "전일일보.xlsx")];
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "failed", message: expect.stringContaining("이미") });
});
it("requires explicit values for missing formula caches and does not silently use zero", async () => {
  const { books, input, file } = await setup(); books.report.getWorksheet(1)!.getCell("H21").value = { formula: "D21+E21-G21" }; input.files.previousReport = [await file(books.report, "전일.xlsx")];
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "needs_input", fields: [expect.objectContaining({ key: "cell_H21", type: "number", label: expect.stringContaining("H21") })] });
});
it("stops when actual account cash differs from ledger or a term has not settled", async () => {
  const { books, input, file } = await setup(); const s = books.status.getWorksheet(1)!; s.getCell("O2").value = 108000; s.getCell("O4").value = 108000; input.files.cashStatus = [await file(books.status, "261013_자금현황표[KC].xlsx")];
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "needs_input", fields: expect.arrayContaining([expect.objectContaining({ key: "cashChanges" })]) });
});
it("requires corrections when planned executions do not reconcile the holding cash", async () => {
  const { input } = await setup(); input.values.actualEdits = '{"changes":[{"index":2,"amount":"2000"}]}';
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "needs_input", question: expect.stringContaining("실적 내역과 원화 계좌잔고") });
});
it("parses merged KC identifiers separately per currency and rejects incorrect totals", () => {
  const { status } = fixtureBooks(); const s = status.getWorksheet(1)!;
  expect(readCashStatus(status).total.toString()).toBe("109000"); s.getCell("O4").value = 1;
  expect(() => readCashStatus(status)).toThrow("환종별합계");
});
it("extracts both directions of holding cash, ignores other categories and totals", () => {
  const { weekly } = fixtureBooks(); const s = weekly.getWorksheet(1)!;
  const parsed = readWeekly(weekly, "wrong-filename-date.xlsx"); expect(parsed.movements.map((m) => m.amount.toString())).toEqual(["10000", "1000", "2000"]);
  s.getCell("C7").value = "사업현금"; expect(readWeekly(weekly, "weekly").movements).toHaveLength(2);
});
it("supports changed amounts, omitted and unplanned transactions without float arithmetic", () => {
  const rows = [{ date: "2026-10-13", direction: "out" as const, description: "test", party: "test", amount: new Money("0.1"), source: "fixture" }];
  expect(applyEdits(rows, '{"changes":[{"index":1,"amount":0}],"add":[{"direction":"in","description":"추가","amount":"0.2"}]}', "2026-10-13")[0].amount.plus("0.1").toString()).toBe("0.3");
  expect(() => applyEdits(rows, '{"changes":[{"index":2,"amount":1}]}', "2026-10-13")).toThrow();
});
it("parses Hana base rates at the correct column and converts JPY per 100 units", () => {
  const html = '<p class="txtRateBox">기준일 : <strong>2026년10월13일</strong> 고시일시 : 2026년10월14일 07시 (1206회차)</p><th>매매 기준율</th>' + [["USD", "1400"], ["JPY (100)", "950"], ["CNY", "200"]].map(([c, rate]) => `<tr>${[c, "999", "1", "999", "1", "999", "999", "999", rate, "1", "1"].map((v) => `<td>${v}</td>`).join("")}</tr>`).join("");
  expect(parseHana(html, "2026-10-13")).toMatchObject({ date: "2026-10-13", round: "1206", perUnit: { USD: "1400", JPY: "9.5", CNY: "200" } });
  expect(() => parseHana(html.replace("JPY (100)", "JPY"), "2026-10-13")).toThrow("단위");
});
it("keeps JPY and CNY separate and uses KC foreign balances with per-unit FX rates", async () => {
  const { books, input, file } = await setup(); const p = books.report.getWorksheet(1)!; p.getCell("H23").value = 100; p.getCell("I23").value = 900; p.getCell("H26").value = 200; p.getCell("I26").value = 40000;
  const k = books.status.getWorksheet(1)!;
  k.addRow([4, "테스트은행", "FXJPY", "JPY 테스트", "FXJPY", "JPY", 900, 100, 0, 0, 0, 0, 900, 100, 100, 0, "보통예금"]);
  k.addRow([5, "테스트은행", "FXCNY", "CNY 테스트", "FXCNY", "CNY", 40000, 200, 0, 0, 0, 0, 40000, 200, 200, 0, "보통예금"]);
  input.files.previousReport = [await file(books.report, "전일.xlsx")]; input.files.cashStatus = [await file(books.status, "261013_현황.xlsx")]; input.values.accountBindings = '{"FXJPY:JPY":"H23","FXCNY:CNY":"H26"}';
  const result = await confirm(input); expect(result.status, JSON.stringify(result.status !== "completed" && result)).toBe("completed");
  if (result.status !== "completed") return;
  const b = new ExcelJS.Workbook(); await b.xlsx.load(Buffer.from(result.file.bytes) as unknown as ExcelJS.Buffer); const s = b.getWorksheet("261013")!;
  expect(s.getCell("H25").result).toBe(100); expect(s.getCell("H27").result).toBe(200); expect(s.getCell("F242").value).toBe(40950);
});
it("never combines a months-old daily report with a current KC snapshot", async () => {
  const { books, input, file } = await setup(); books.report.getWorksheet(1)!.name = "260528"; input.files.previousReport = [await file(books.report, "old.xlsx")];
  expect(await dailyCashTool.execute(input)).toMatchObject({ status: "failed", message: expect.stringContaining("너무 오래") });
});
it("re-asks for confirmation when actual or next-day plan changes after review", async () => {
  const { input } = await setup(); const result = await dailyCashTool.execute(input); if (result.status !== "needs_input") throw new Error("review");
  input.values.review = result.question.match(/확인 [a-f0-9]{12}/)![0]; input.checkpoint = result.checkpoint!;
  input.values.planEdits = '{"changes":[{"index":1,"amount":3000}]}';
  const updated = await dailyCashTool.execute(input); expect(updated.status).toBe("needs_input"); if (updated.status === "needs_input") expect(updated.question.match(/확인 [a-f0-9]{12}/)![0]).not.toBe(input.values.review);
});
