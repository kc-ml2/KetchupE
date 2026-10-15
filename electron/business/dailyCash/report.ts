import ExcelJS from "exceljs";
import { compact, isoSheetDate, Money, money, numeric, raw, sameWon, sheetDate, sum, text, type Amount } from "./values.ts";
import type { KcAccount } from "./cashStatus.ts";
import type { Movement } from "./weekly.ts";
import type { Rates } from "./hana.ts";

export const cashRows = [9, 10, 11, 12, 13, 15, 21, 23, 24, 26, 28, 30];
/** 받을어음·적금 rows sit above the term-deposit sections and have been identical in every workbook seen (5월·10월). */
const noteRows = [35, 36, 37, 38, 39, 40, 41, 46];
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
export type Layout = ReturnType<typeof layout>;
/** Rows from 정기예금 downwards move whenever a deposit row is inserted or deleted, so every section below row 49 is located by its labels and 합계 formula. */
export function layout(s: ExcelJS.Worksheet) {
  const anchors = { A7: "단기성현금자산(원화)", A19: "단기성현금자산(외화)", A49: "정기예금현황(원화)" };
  for (const [cell, label] of Object.entries(anchors)) if (compact(s.getCell(cell)) !== label) throw new Error(`일보 양식 ${cell} (${label})이 변경되었습니다.`);
  const last = Math.min(s.rowCount, 600);
  const find = (column: string, predicate: (v: string) => boolean) => {
    const rows = range(1, last).filter((r) => predicate(compact(s.getCell(`${column}${r}`))));
    if (rows.length !== 1) throw new Error(`일보 ${column}열 표식을 유일하게 찾을 수 없습니다.`); return rows[0];
  };
  const first = (label: string, from: number, predicate: (r: number) => boolean) => {
    const row = range(from, last).find(predicate);
    if (!row) throw new Error(`일보 ${from}행 아래에서 ${label}을 찾을 수 없습니다.`); return row;
  };
  const sumRowAfter = (label: string, from: number) => first(`${label} 합계`, from, (r) => String(s.getCell(`D${r}`).formula ?? "").startsWith("SUM("));
  const header = (label: string, from: number) => first(label, from, (r) => compact(s.getCell(`A${r}`)) === label);
  const krwTermSum = sumRowAfter("정기예금(원화)", 51);
  const fxHeader = header("정기예금현황(외화)", krwTermSum); const fxTermSum = sumRowAfter("정기예금(외화)", fxHeader + 2);
  const trustHeader = header("신탁현황", fxTermSum); const trustSum = sumRowAfter("신탁", trustHeader + 2);
  const opening = first("기초금액", trustSum, (r) => compact(s.getCell(`A${r}`)).startsWith("기초금액("));
  const inSum = sumRowAfter("입금", opening + 1);
  const closing = first("마감잔액", inSum, (r) => compact(s.getCell(`A${r}`)).startsWith("마감잔액("));
  const outSum = closing - 1;
  const total = find("G", (v) => v === "총원화") + 1;
  const business = find("O", (v) => v === "사업부문자금현황표(KC)");
  if (closing > 500 || total !== closing + 11 || business !== closing + 1 || !String(s.getCell(`D${outSum}`).formula ?? "").startsWith("SUM(")) throw new Error("일보 집행내역/합계 배치가 확인된 양식과 다릅니다.");
  const businessRows = range(business + 1, business + 11);
  const krwTermRows = range(51, krwTermSum - 1); const fxTermRows = range(fxHeader + 2, fxTermSum - 1); const trustRows = range(trustHeader + 2, trustSum - 1);
  const termRows = [...krwTermRows, ...fxTermRows];
  const activeTerms = termRows.filter((r) => text(s.getCell(`C${r}`)));
  return { closing, total, businessRows, krwTermRows, fxTermRows, termRows, krwTermSum, fxTermSum, trustRows, trustSum, otherRows: [...noteRows, ...trustRows], activeTerms, opening, inSum, outSum };
}
// ponytail: every 외화 정기예금 row is treated as USD (K열이 $K$21). A JPY/CNY deposit fails the currency check in bindAccounts instead of being mis-rated.
export const currencyAt = (row: number, l: Layout) => [23, 24].includes(row) ? "JPY" : row === 26 ? "CNY" : [21, 28, 30].includes(row) || l.fxTermRows.includes(row) ? "USD" : "KRW";
export function priorAmounts(s: ExcelJS.Worksheet, overrides: Record<string, Amount>) {
  const l = layout(s); const values: Record<string, Amount> = {}; const missing: string[] = [];
  for (const row of [...cashRows, ...l.activeTerms, ...l.otherRows]) {
    for (const col of currencyAt(row, l) === "KRW" ? ["H"] : ["H", "I"]) {
      const key = `${col}${row}`;
      // 수식 없이 완전히 빈 셀은 Excel 산술과 같이 0이다. 수식인데 저장된 결과가 없는 셀만 담당자에게 묻는다.
      const cell = s.getCell(key); const blank = cell.value === null || cell.value === undefined || cell.value === "";
      try { values[key] = overrides[key] ?? (blank ? new Money(0) : money(cell)); }
      catch { missing.push(key); }
    }
  }
  return { values, missing };
}
const bankGroup = (v: string) => ["기업", "하나", "신한", "우리", "NH"].find((b) => v.includes(b) || (b === "NH" && v.includes("엔에이치")));
export function maturity(s: ExcelJS.Worksheet, row: number) {
  const m = text(s.getCell(`A${row}`)).match(/~\s*(\d{6})(?!\d)/);
  if (!m) throw new Error(`정기예금 ${row}행에 YYMMDD 만기일이 없습니다.`);
  return isoSheetDate(m[1]);
}
export function bindAccounts(s: ExcelJS.Worksheet, accounts: KcAccount[], previous: Record<string, Amount>, explicit: Record<string, string>, reportDate: string) {
  const l = layout(s); const bindings = new Map<string, string>(); const used = new Set<string>(); const unresolved: string[] = [];
  const businessTargets: Record<string, string> = { "33889000081904:KRW": "보통예금하나", "33889007370038:USD": "하나USD", "33889000330952:KRW": "MMT하나", "140002733206:KRW": "보통예금신한1", "140005948841:KRW": "보통예금신한2", "180007074373:CNY": "신한CNY", "180007074373:USD": "신한USD" };
  const allowed = new Set([...cashRows, ...l.termRows].map((r) => `H${r}`).concat(l.businessRows.map((r) => `P${r}`)));
  for (const a of accounts) {
    let target = explicit[a.key];
    if (!target && a.key === "140013557434:KRW") target = "H10";
    if (!target && a.key === "140013557473:KRW") target = "H11";
    if (!target && businessTargets[a.key]) { const row = l.businessRows.find((r) => compact(s.getCell(`O${r}`)) === businessTargets[a.key]); if (row) target = `P${row}`; }
    if (!target && a.product === "정기예금") {
      const candidates = l.activeTerms.filter((r) => !used.has(`H${r}`) && currencyAt(r, l) === a.currency && bankGroup(a.bank) !== undefined && bankGroup(text(s.getCell(`C${r}`))) === bankGroup(a.bank) && maturity(s, r) === a.maturity && previous[`H${r}`]?.eq(a.opening));
      // Equal bank/currency/maturity/principal slots are interchangeable; the review records each assignment.
      if (candidates.length) target = `H${candidates[0]}`;
    }
    if (!target) {
      // 은행·통화·원금은 같은데 만기만 다른 행이 있으면 대개 한쪽 자료의 만기 표기 오류다. 어느 셀을 봐야 하는지 알려준다.
      const near = a.product === "정기예금" ? l.activeTerms.filter((r) => !used.has(`H${r}`) && currencyAt(r, l) === a.currency && bankGroup(text(s.getCell(`C${r}`))) === bankGroup(a.bank) && previous[`H${r}`]?.eq(a.opening) && maturity(s, r) !== a.maturity) : [];
      const because = near.length ? ` → 일보 ${near.map((r) => `H${r}(만기 ${maturity(s, r)}, A${r} "${text(s.getCell(`A${r}`))}")`).join(", ")}와 은행·원금이 같지만 만기가 다릅니다. 전일 일보의 만기 표기 또는 KC 만기일을 확인해 고친 뒤 새 작업을 시작하세요.` : "";
      unresolved.push(`${a.key} / ${a.name} / ${a.currency} / 잔고 ${a.balance} / 만기 ${a.maturity ?? "없음"}${because}`); continue;
    }
    if (!allowed.has(target) || used.has(target)) throw new Error(`${a.key}: 일보 셀 ${target}이 허용되지 않거나 중복됩니다.`);
    const row = Number(target.slice(1));
    const expected = target[0] === "H" ? currencyAt(row, l) : /USD/.test(text(s.getCell(`O${row}`))) ? "USD" : /JPY/.test(text(s.getCell(`O${row}`))) ? "JPY" : /CNY/.test(text(s.getCell(`O${row}`))) ? "CNY" : "KRW";
    if (a.currency !== expected || (a.product === "정기예금") !== (target[0] === "H" && l.termRows.includes(row))) throw new Error(`${a.key}: 통화/정기예금 구분과 대상 셀이 다릅니다.`);
    if (l.termRows.includes(row) && target[0] === "H" && (!l.activeTerms.includes(row) || maturity(s, row) !== a.maturity)) throw new Error(`${a.key}: 전일 일보의 만기일/예금 항목과 다릅니다. 갱신된 전일 일보가 필요합니다.`);
    bindings.set(a.key, target); used.add(target);
  }
  for (const r of [...cashRows, ...l.activeTerms]) if (!used.has(`H${r}`) && previous[`H${r}`] && !previous[`H${r}`].isZero() && !(l.termRows.includes(r) && maturity(s, r) <= reportDate)) unresolved.push(`일보 H${r} (${text(s.getCell(`C${r}`))}, ${previous[`H${r}`]})에 대응하는 KC 계좌가 없습니다.`);
  return { bindings, unresolved };
}
function formula(s: ExcelJS.Worksheet, cell: string, expression: string, value: Amount) { s.getCell(cell).value = { formula: expression, result: value.toNumber() }; }
export function buildReport(book: ExcelJS.Workbook, previous: ExcelJS.Worksheet, reportDate: string, workDate: string, amounts: Record<string, Amount>, accounts: KcAccount[], bindings: Map<string, string>, actual: Movement[], plan: Movement[], rates: Rates, changes: Record<string, { incoming: Amount; outgoing: Amount }>) {
  const l = layout(previous); const name = sheetDate(reportDate);
  if (book.getWorksheet(name)) throw new Error(`${name} 시트가 이미 있습니다. 기존 시트를 덮어쓰지 않습니다.`);
  const s = book.addWorksheet(name); const id = s.id;
  const model = structuredClone(previous.model);
  s.model = { ...model, id, name };
  // ExcelJS 4.4 serializes `merges` but its model setter reads `mergeCells`.
  for (const range of model.merges) s.mergeCellsWithoutStyle(range);
  // Clear old calculations, including scratch checks; new report formulas are computed explicitly.
  const frozen: [string, ExcelJS.CellValue][] = [];
  s.eachRow((r) => r.eachCell((c) => { if (!c.isMerged || c.master.address === c.address) { if (c.type === ExcelJS.ValueType.Formula) frozen.push([c.address, null]); } }));
  for (const [address, value] of frozen) s.getCell(address).value = value;
  s.getCell("B2").value = `일 일 자 금 일 보\n${reportDate.replaceAll("-", ".")}`;
  s.getCell("M19").value = `${reportDate} 최종 고시`; s.getCell("M100").value = `${reportDate} 최종 고시`;
  for (const r of [19, 100]) { s.getRow(r).height = Math.max(s.getRow(r).height ?? 15, 30); s.getCell(`M${r}`).alignment = { ...s.getCell(`M${r}`).alignment, wrapText: true }; }
  for (const row of [...cashRows, ...l.termRows, ...l.otherRows]) {
    numeric(s.getCell(`D${row}`), amounts[`H${row}`] ?? new Money(0)); numeric(s.getCell(`E${row}`), 0); numeric(s.getCell(`G${row}`), 0);
    numeric(s.getCell(`H${row}`), amounts[`H${row}`] ?? new Money(0));
    if (currencyAt(row, l) !== "KRW") numeric(s.getCell(`I${row}`), amounts[`I${row}`] ?? new Money(0));
  }
  for (const row of l.activeTerms) if (maturity(previous, row) <= reportDate) {
    numeric(s.getCell(`G${row}`), amounts[`H${row}`]); numeric(s.getCell(`H${row}`), 0);
    if (currencyAt(row, l) !== "KRW") numeric(s.getCell(`I${row}`), 0);
  }
  for (const row of l.businessRows) numeric(s.getCell(`P${row}`), 0);
  for (const account of accounts) {
    const target = bindings.get(account.key)!; const row = Number(target.slice(1)); numeric(s.getCell(target), account.balance);
    s.getCell(target).note = `출처: 자금현황표/${account.source}; 계좌키 ${account.key}; 계좌잔고(O열)`;
    if (target[0] !== "H") continue;
    const flow = changes[account.key] ?? account;
    numeric(s.getCell(`E${row}`), flow.incoming); numeric(s.getCell(`G${row}`), flow.outgoing);
    if (l.termRows.includes(row) && maturity(previous, row) <= reportDate) { numeric(s.getCell(`G${row}`), amounts[`H${row}`]); numeric(s.getCell(`E${row}`), 0); }
    // 금일금액은 전일+증가-감소 수식값으로 두어 담당자 일보처럼 소수 원을 이월한다. KC 정수 잔고와는 1원 미만 차이만 허용한다.
    const closingAmount = money(s.getCell(`D${row}`)).plus(money(s.getCell(`E${row}`))).minus(money(s.getCell(`G${row}`)));
    if (!sameWon(closingAmount, account.balance)) throw new Error(`${account.key}: 전일금액+증가-감소와 계좌잔고가 일치하지 않습니다.`);
    if (currencyAt(row, l) !== "KRW") numeric(s.getCell(`I${row}`), account.bookKrw);
    formula(s, target, `D${row}+E${row}-G${row}`, closingAmount);
  }
  const totalRows: Record<number, number[]> = { 42: [35, 36, 37, 38, 39, 40, 41], 47: [46], [l.trustSum]: l.trustRows, 14: [10, 11, 12, 13], 16: [15], 17: [9, 14, 16], 22: [21], 25: [23, 24], 27: [26], 29: [28], 31: [30], [l.krwTermSum]: l.krwTermRows, [l.fxTermSum]: l.fxTermRows };
  for (const [target, children] of Object.entries(totalRows)) for (const col of ["D", "E", "G", "H", ...([22, 25, 27, 29, 31, l.fxTermSum].includes(Number(target)) ? ["I"] : [])]) {
    const vals = children.map((r) => { const v = raw(s.getCell(`${col}${r}`)); return v == null ? new Money(0) : money(s.getCell(`${col}${r}`)); });
    formula(s, `${col}${target}`, children.map((r) => `${col}${r}`).join("+"), sum(vals));
  }
  for (const row of [...cashRows.filter((r) => currencyAt(r, l) !== "KRW"), ...l.fxTermRows]) {
    const c = currencyAt(row, l) as keyof Rates["perUnit"]; const balance = money(s.getCell(`H${row}`)); const cost = money(s.getCell(`I${row}`)); const rate = new Money(rates.perUnit[c]);
    numeric(s.getCell(`K${row}`), rate); formula(s, `J${row}`, `IFERROR(I${row}/H${row},0)`, balance.eq(0) ? new Money(0) : cost.div(balance));
    formula(s, `L${row}`, `H${row}*K${row}`, balance.mul(rate)); formula(s, `M${row}`, `L${row}-I${row}`, balance.mul(rate).minus(cost));
  }
  const shortDate = (v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8))}`;
  for (const [items, descCol, amountCol, labelCol, day] of [[actual, "B", "D", "A", reportDate], [plan, "F", "H", "E", workDate]] as const) {
    s.getCell(`${labelCol}${l.opening}`).value = `기초금액(${shortDate(day)})`; s.getCell(`${labelCol}${l.closing}`).value = `마감잔액(${shortDate(day)})`;
    for (let r = l.opening + 1; r < l.closing; r++) { if (r === l.inSum || r === l.outSum) continue; s.getCell(`${descCol}${r}`).value = null; s.getCell(`${amountCol}${r}`).value = null; }
    for (const direction of ["in", "out"] as const) {
      const entries = items.filter((m) => m.direction === direction); const first = direction === "in" ? l.opening + 1 : l.inSum + 1; const last = direction === "in" ? l.inSum - 1 : l.closing - 2;
      if (entries.length > last - first + 1) throw new Error("집행내역이 고정 양식의 행 수를 초과합니다. 양식 확장이 필요합니다.");
      entries.forEach((m, i) => { const r = first + i; s.getCell(`${descCol}${r}`).value = `${m.description}${m.party ? ` / ${m.party}` : ""}`; numeric(s.getCell(`${amountCol}${r}`), m.amount); s.getCell(`${amountCol}${r}`).note = m.source; s.getRow(r).hidden = false; const label = String(s.getCell(`${descCol}${r}`).value); const lines = Math.max(1, Math.ceil([...label].reduce((n, ch) => n + (/[^\x00-\x7f]/.test(ch) ? 1 : 0.55), 0) / 25)); s.getRow(r).height = Math.max(s.getRow(r).height ?? 15, lines * 12 + 6); });
      formula(s, `${amountCol}${direction === "in" ? l.inSum : l.outSum}`, `SUM(${amountCol}${first}:${amountCol}${last})`, sum(entries.map((m) => m.amount)));
    }
  }
  numeric(s.getCell(`D${l.opening}`), money(s.getCell("D17"))); numeric(s.getCell(`H${l.opening}`), money(s.getCell("H17")));
  for (const col of ["D", "H"]) formula(s, `${col}${l.closing}`, `${col}${l.opening}+${col}${l.inSum}-${col}${l.outSum}`, money(s.getCell(`${col}${l.opening}`)).plus(money(s.getCell(`${col}${l.inSum}`))).minus(money(s.getCell(`${col}${l.outSum}`))));
  if (!money(s.getCell(`D${l.closing}`)).eq(money(s.getCell("H17")))) throw new Error("주요 집행내역의 마감잔액과 단기성 원화 금일금액이 다릅니다.");
  const bValues = accounts.filter((a) => bindings.get(a.key)?.startsWith("P"));
  const businessKrw = sum(bValues.filter((a) => a.currency === "KRW").map((a) => a.balance));
  const businessFx = sum(bValues.filter((a) => a.currency !== "KRW").map((a) => a.balance.mul(rates.perUnit[a.currency as keyof Rates["perUnit"]])));
  const holdingFx = sum(cashRows.filter((r) => currencyAt(r, l) !== "KRW").map((r) => money(s.getCell(`L${r}`))));
  const termFx = sum(l.fxTermRows.map((r) => money(s.getCell(`L${r}`))));
  const totals = [[holdingFx, money(s.getCell("H17"))], [businessFx, businessKrw], [termFx, money(s.getCell(`H${l.krwTermSum}`))]];
  totals.push([sum(totals.map((v) => v[0])), sum(totals.map((v) => v[1]))]);
  totals.forEach(([fx, krw], i) => { const row = l.total - 6 + i * 2; numeric(s.getCell(`F${row}`), fx); numeric(s.getCell(`G${row}`), krw); formula(s, `H${row}`, `F${row}+G${row}`, fx.plus(krw)); s.getRow(row).hidden = false; });
  // Old scratch checks referenced previous dates; replace with current checks, never stale cached booleans.
  s.getCell(`D${l.closing + 4}`).value = null; s.getCell(`D${l.closing + 5}`).value = null; s.getCell(`D${l.closing + 6}`).value = null;
  s.pageSetup.printArea = `A1:M${l.total}`; s.state = "visible";
  book.calcProperties.fullCalcOnLoad = true;
  return { sheet: s, totalKrw: totals[3][1], lastRow: l.total };
}
