import type { BusinessTool } from "./contracts.ts";

// Replace the implementation and version after validating the operator's source/output fixtures.
export const dailyCashTool: BusinessTool = {
  id: "daily_cash", version: "0.0.0", title: "일일자금일보",
  description: "원천 엑셀로 완성된 일일자금일보를 생성하는 업무. 현재 담당자 업무 규칙 확인 전으로 실행 불가하며 미구현 상태를 안내한다.",
  examples: ["일일자금일보 작성해줘", "오늘 자금 현황을 일보로 만들어줘"],
  requiredInputs: ["기준일", "업무별 원천 엑셀"],
  // These roles are provisional; the common form reads the deployed tool's fields.
  fields: [
    { key: "businessDate", label: "기준일", type: "date", required: true },
    { key: "transactions", label: "입출금 내역", type: "file", required: true },
    { key: "counterparties", label: "거래처 정보", type: "file", required: true },
    { key: "balances", label: "잔액 자료", type: "file", required: true },
    { key: "previousReport", label: "전일 일보", type: "file", required: true },
  ],
  unavailableReason: "일일자금일보 계산·대사·출력 규칙을 아직 구현하지 않았습니다. 담당자 업무 확인 후 Tool을 연결하면 원천 자료로 완성된 엑셀을 생성할 수 있습니다.",
  async execute() { return { status: "failed", message: "일일자금일보 업무 규칙이 아직 구현되지 않았습니다." }; },
};
