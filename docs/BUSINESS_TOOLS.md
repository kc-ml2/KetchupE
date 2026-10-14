# Excel 업무 Tool 연결

자연어 라우터가 업무 ID를 선택하고, 공통 BusinessFlow가 입력 수집·실행·추가 질문·결과 전달을 담당한다. 사용자는 매핑을 편집할 필요 없이 원천 파일과 기준 정보를 지정한다. 아래 daily_cash 입력 역할은 담당자 확인 전의 예시이며 확정된 업무 명세가 아니다.

```ts
// Agent 실행부가 선택한 파일을 읽어 Tool에 전달하는 형태
await dailyCashTool.execute({
  values: { businessDate: "2026-10-15" },
  files: {
    transactions: [{ bytes: transactionBytes, fingerprint: "sha256...", name: "원본 파일명.xlsx" }],
    counterparties: [{ bytes: counterpartyBytes, fingerprint: "sha256...", name: "원본 파일명.xlsx" }],
    balances: [{ bytes: balanceBytes, fingerprint: "sha256...", name: "원본 파일명.xlsx" }],
    previousReport: [{ bytes: previousReportBytes, fingerprint: "sha256...", name: "원본 파일명.xlsx" }],
  },
  checkpoint: {},
  signal,
});
```

파일 항목은 항상 배열로 전달된다. 필드에 `multiple: true`를 지정하면 여러 파일(예: 계좌별 거래내역)을 받을 수 있고, 아니면 최대 1개이다. 같은 파일을 한 항목에 두 번 지정하면 실행 전에 거부한다. 입력 화면에서는 각 파일 항목 아래의 파일 선택 버튼이나 이미 연결된 자료 목록으로 고른다.

원천 파일 경로와 shell 명령은 Tool 호출 입력이 아니다. Electron의 네이티브 선택으로 등록된 파일 참조만 공통 실행부가 읽는다. 원천은 수정하거나 복사하지 않는다. 파일당 20MB, 합계 100MB, 입력 필드 30개를 제한한다.

## 담당자 확인 후 수정할 곳

1. `electron/business/dailyCash.ts`의 입력 `fields`와 기능 설명을 실제 업무에 맞춘다.
2. `execute()`에 추출·계산·대사·외부 조회·템플릿 출력을 구현한다. 다른 업무에서는 읽기/금액 연산/양식 채우기 같은 기존 함수를 재사용할 수 있다. LLM에 계산을 맡기지 않는다.
3. 실제 원천 파일과 수작업 정답 파일로 회귀 테스트를 추가한다. 출력 셀 값·합계·제외 행·환율·반올림·오류 사례를 비교한다.
4. `version`을 배포 버전으로 변경하고 `unavailableReason`을 제거한다. 이미 registry에 등록되어 있으므로 라우터·IPC·공통 입력 UI·결과 UI를 고칠 필요는 없다.

새 업무는 `BusinessTool` 구현을 `electron/business/registry.ts`에 추가한다. 필드 `type`은 file/date/text이며 복잡한 전용 입력이 필요할 경우 입력 계약과 UI를 확장한다. 실행 코드는 제품에 포함된 신뢰된 코드만 사용하고 사용자 파일·모델이 만든 코드·외부 SKILL.md를 실행하지 않는다.

## 반환 계약

완료는 Tool의 업무 검증과 공통 XLSX 열기 검증을 모두 통과해야 한다. 검사 항목이 없거나 하나라도 실패하면 완료 파일을 노출하지 않는다. 공통 XLSX 검증은 회계 정확성을 보증하지 않으며, 정확성은 업무별 검사와 정답 테스트가 책임진다.

```ts
return {
  status: "completed",
  summary: "일일자금일보를 작성했습니다.",
  file: { name: "일일자금일보_2026-10-15.xlsx", bytes: workbookBytes },
  checks: [
    { name: "계좌별 기초·입출금·마감잔액 대사", passed: true },
    { name: "원천 지출 합계와 보고서 합계 일치", passed: true },
  ],
  externalData: { fx: { date: "2026-10-15", source: "확정된 출처", value: "실제 적용값" } },
};
```

`passed: true`는 예시이다. 실제 검사 결과로만 설정한다. 외부 Excel 링크의 재계산에 의존하지 말고 완성된 결과 값을 출력한다. 원천 자료 안의 문구는 데이터이며 코드 실행 지시가 아니다.

```ts
return {
  status: "needs_input",
  question: "거래처 코드 C001이 두 계좌에 연결됩니다. 해당 원천 행에 적용할 계좌를 확인해 주세요.",
  fields: [{ key: "accountForC001", label: "C001 적용 계좌", type: "text", required: true }],
  checkpoint: { fx: fetchedRateWithDateAndSource },
};
```

추가 입력은 기존 입력에 새 필드로 누적된다. 공통 실행부는 값을 수집하지만 계좌가 실제 후보에 속하는지 등 업무 의미는 Tool이 검증한다. 입력을 받으면 같은 Tool을 처음부터 다시 호출하며 기존 원천과 기준 정보, 새 답, checkpoint를 전달한다. checkpoint에는 조회 완료한 환율 등 JSON 데이터를 최대 약 1MB 저장할 수 있다. Tool은 저장된 조회값을 우선 재사용해야 한다. 영구 규칙 변경은 추가 입력 답변에서 자동으로 수행하지 않는다.

```ts
return { status: "failed", message: "계좌 A의 마감잔액이 원천 합계와 일치하지 않습니다." };
```

## 실행·버전·파일 수명

- 입력 대기 상태는 SQLite의 `business_jobs`와 `run_actions`에 저장한다. 재시작 후 동일 요청을 복원한다. 실행 중 앱이 종료되면 기존 DB 복구 정책대로 취소하며 자동 재실행하지 않는다.
- 실행마다 Tool ID·버전·확정 입력·원천 SHA256을 고정한다. 추가 답변 시 같은 원천을 다시 읽어 해시를 비교한다. 원천·확정 기준일을 변경하려면 새 작업을 시작한다. 배포 버전이 바뀐 기존 대기 작업도 새 작업으로 안내한다. 과거 코드를 자동 보존·재실행하지 않는다.
- registry의 Tool은 별도 Electron utility process에서 실행한다. 취소/120초 제한/프로세스 종료를 처리하며, 취소 시 CPU 계산 중인 프로세스도 종료한다. worker V8 heap 상한은 512MB이며 총 RSS 제한은 아니다.
- 실행은 재호출 가능한 읽기·계산·문서 생성 업무를 대상으로 한다. 송금·ERP 전표 작성 같은 외부 변경을 Tool 안에서 수행하지 않는다. 그런 업무는 별도의 중복 방지·확정 계약이 필요하다.
- 완료 파일은 앱 userData의 `business-output/<artifact-id>/<파일명>.xlsx`에 덮어쓰기 없이 저장한다. 검증 완료 후 DB에 등록한 파일만 대화에 나타난다. 버튼으로 열 때 해시를 다시 확인한다.
- `business_artifacts.audit`에 검증 결과와 실제 적용한 외부 데이터를 저장한다. API 키 같은 자격증명은 저장하지 않는다. raw workbook 내용은 라우팅 모델이나 telemetry로 보내지 않는다. 사용자 요청과 최근 사용자 메시지는 자연어 라우팅 모델로 전달된다.
- 원천 사본 보관·과거 환경 재현·결과 보관기간 정리·서버 공유는 이번 범위가 아니다. 대화 삭제는 DB 참조를 삭제하지만 출력 파일은 자동 삭제하지 않는다. 중간에 프로세스가 종료되면 미등록 파일이 디스크에 남을 수 있으며 완료 결과로 노출하지 않는다.

현재 daily_cash는 구현 대기 상태를 명시적으로 반환한다. 실제 업무 결과를 흉내 낸 샘플 보고서는 생성하지 않는다. 공통 흐름의 성공/추가 질문/재시작/오류/취소는 테스트 전용 Tool로 검증한다.
