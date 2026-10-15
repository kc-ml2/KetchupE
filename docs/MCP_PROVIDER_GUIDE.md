# 외부 팀용 MCP 제작·전달 가이드

기준: 2026-10-16의 KetchupE 코드. 이 문서는 **외부 팀이 조회·계산 기능을 제공하고, 케찹이 담당자가 사용자 입력·진행·재개를 연결하는 협업 계약**입니다. 아래 `order_status` 예시는 신규 연동 설계이며 현재 설치된 기능이 아닙니다. 앱 쪽 작업은 [워크플로 추가 가이드](WORKFLOW_INTEGRATION_GUIDE.md)를 보세요.

## 1. Workflow, Tool, MCP의 차이

| 용어 | 의미 | 예시 / 담당 |
| --- | --- | --- |
| Workflow | 사용자의 한 업무를 끝내는 절차. 입력 확인·도구 호출·질문·재개·취소·결과 표시를 관리 | 발주번호 받기 → 발주 조회 → 결과 표시; 케찹이 |
| Tool | 정해진 입력을 받아 한 기능을 수행하는 함수 | `get_purchase_order(order_id)`; 외부 팀 |
| MCP server | Tool 목록·스키마·호출을 표준 프로토콜로 제공하는 서버 | 사내 구매 시스템의 읽기 API를 MCP로 제공; 외부 팀 |
| Adapter | 서버 결과를 앱의 타입·오류·출처로 바꾸는 코드 | `PurchaseClient`; 케찹이 |

하나의 workflow가 여러 MCP/로컬 Tool을 사용할 수 있고 같은 Tool을 여러 workflow에서 재사용할 수 있습니다. **MCP가 workflow를 자동 생성하거나 대화 UI를 직접 소유하지 않습니다.** 외부 서버에 내부 업무 절차가 있어도 케찹이와의 입력·결과·대기 계약은 명시해야 합니다.

## 2. 먼저 제공 형태를 선택하세요

| 요구 | 권장 전달물 | 현재 앱과의 관계 |
| --- | --- | --- |
| 사내 API/DB를 원격 조회 | MCP endpoint + 도구 계약 + 테스트 계정 | 서버별 adapter와 workflow 또는 Harness 연결 필요 |
| 로컬 XLSX를 계산해 XLSX 생성 | TypeScript `BusinessTool` 구현 + fixture·정답 | 기존 BusinessFlow와 worker 재사용 가능 |
| 오래 걸리는 원격 보고서 작업 | start/status/cancel/result 계약 제안 | 원격 job 추적·polling·복원은 앱에 추가 구현 필요 |
| ERP 등록·발송·송금 등 외부 변경 | 별도 실행·확정·중복 방지 계약 | 현재 조회/로컬 계산 경로에 그대로 넣을 수 없음 |

로컬 Tool을 주는 경우 [BUSINESS_TOOLS.md](BUSINESS_TOOLS.md)의 `BusinessTool` 타입이 납품 계약입니다. Python 서비스나 HTTP API를 주는 경우 MCP로 감싸거나 별도 typed adapter를 합의합니다. 모델에게 실행할 코드나 shell 명령을 반환하는 방식은 사용하지 않습니다.

## 3. MCP 서버가 제공할 것

### 연결

현재 [McpConnection](../electron/agent/mcp.ts)은 공식 TypeScript client의 **Streamable HTTP**와 서버별 독립 연결을 사용합니다. endpoint 경로와 trailing slash, 인증 방식, 배포 버전, 호환 protocol/SDK 버전을 함께 전달하세요. 현재 앱은 토큰 callback으로 발급된 Bearer token을 사용하며 범용 OAuth 로그인 UI·임의 서버 설치 UI는 없습니다.

SDK로 MCP의 연결 및 도구 호출 절차를 구현하세요. 일반 REST `POST /execute`만 제공하면 현재 MCP client에 바로 연결할 수 없습니다. 새 protocol 기능이나 MCP Tasks·elicitation에 의존하려면 먼저 앱 지원을 협의해야 합니다. 프로토콜의 transport 규칙은 [MCP Streamable HTTP 명세](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)를 참고하고, 실제 호환성은 이 저장소의 lockfile과 probe로 확인합니다.

현재 client는 연결 시 `listTools()` 한 번으로 목록을 읽습니다. 필요한 도구가 첫 응답에 있도록 제공하거나, 앱 담당자와 도구 목록 pagination 처리를 먼저 추가하세요. 서버 기능을 늘려도 앱의 allowlist와 업무 연결에 포함되지 않으면 실행되지 않습니다.

### 도구 계약

- 이름은 업무 의미가 분명하고 안정적으로 유지합니다. `execute_anything`, 임의 SQL, 임의 파일 경로 입력 대신 명확한 기능 단위를 제공합니다.
- 입력·출력 JSON Schema, 정상·빈 결과·오류 예시, 단위·날짜 기준·시간대·반올림 규칙을 전달합니다. 금액은 통화와 decimal 문자열을 함께 정의하는 등 손실 없는 표현에 합의합니다.
- 서버가 입력을 검증하고 인증 주체의 권한을 검사합니다. 모델이 보낸 `user_id`로 다른 사용자 권한을 선택하지 않습니다.
- pagination·총량 제한·잘림 여부·기준 시각을 명시합니다. 빈 결과를 성공한 전체 조회로 오해하게 만들지 않습니다.
- `structuredContent`에 기계 판독 결과를 넣고 호환용 `content`에도 같은 JSON을 직렬화할 수 있습니다. `outputSchema`를 선언하면 반환 구조가 이를 충족해야 합니다. [MCP Tools 명세](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

이 항목 중 업무 필드·오류 코드·시간 제한은 아래 예시의 **프로젝트 계약**이며 MCP가 자동으로 정해주는 값이 아닙니다.

## 4. 예시: 발주 상태 조회

외부 팀은 읽기 도구 `get_purchase_order`를 만들고, 케찹이는 `order_status` workflow를 만듭니다. 발주번호가 없으면 케찹이가 먼저 묻습니다. 서버는 자연어로 번호를 추측하지 않습니다.

### tools/list에 노출할 정의

```json
{
  "name": "get_purchase_order",
  "description": "인증된 사용자가 접근할 수 있는 발주의 현재 상태를 조회한다. 발주를 생성하거나 수정하지 않는다.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "order_id": { "type": "string", "pattern": "^PO-[0-9]{4}-[0-9]{6}$" }
    },
    "required": ["order_id"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "schema_version": { "const": "purchase-order.v1" },
      "order_id": { "type": "string", "pattern": "^PO-[0-9]{4}-[0-9]{6}$" },
      "state": { "enum": ["approved", "shipping", "received"] },
      "as_of": { "type": "string", "format": "date-time" }
    },
    "required": ["schema_version", "order_id", "state", "as_of"],
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true, "destructiveHint": false }
}
```

정상 `tools/call`의 인수와 결과 본문 예시입니다. SDK가 JSON-RPC envelope를 처리합니다.

```json
{ "name": "get_purchase_order", "arguments": { "order_id": "PO-2026-000123" } }
```

```json
{
  "content": [{
    "type": "text",
    "text": "{\"schema_version\":\"purchase-order.v1\",\"order_id\":\"PO-2026-000123\",\"state\":\"shipping\",\"as_of\":\"2026-10-16T09:00:00+09:00\"}"
  }],
  "structuredContent": {
    "schema_version": "purchase-order.v1",
    "order_id": "PO-2026-000123",
    "state": "shipping",
    "as_of": "2026-10-16T09:00:00+09:00"
  },
  "isError": false
}
```

정상 결과가 없는 경우의 프로젝트 오류 예시입니다. 성공용 `structuredContent`를 함께 넣지 않습니다.

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"code\":\"ORDER_UNAVAILABLE\",\"message\":\"조회 가능한 발주를 찾을 수 없습니다.\",\"retryable\":false}" }]
}
```

인증 오류(HTTP 401), 도구 실행 실패(`isError`), 정상 업무 결과를 구분하세요. 이 예시는 존재하지 않음과 권한 없음의 상세 차이를 노출하지 않는 계약입니다. rate limit·일시 장애에는 재시도 가능 여부와 대기 시간을 별도로 합의합니다. 서버 내부 traceback·SQL·인증키를 오류 메시지에 넣지 않습니다.

### 서버 구현 순서

1. 외부 팀의 언어에 맞는 공식 MCP server SDK로 Streamable HTTP endpoint를 만듭니다. 연결 코드는 SDK 예제를 사용하고 버전을 고정합니다.
2. 위 도구 정의를 등록합니다. handler에서 입력 검증 → 인증 주체 확인 → 발주 접근 권한 검사 → 업무 API 조회 → 결과 schema 검증 순서로 처리합니다.
3. handler는 조회 데이터만 반환합니다. 사용자 추가 질문, 채팅방 ID, 케찹이 SQLite 접근은 필요하지 않습니다.
4. 개발 endpoint에서 케찹이 담당자와 initialize/list/call 및 실패 응답을 검증한 뒤 운영 endpoint를 넘깁니다.

예제 handler의 업무 부분을 의사 코드로 표현하면 다음과 같습니다. `purchaseApi`와 `principal`은 외부 팀이 구현하는 시스템이며 제공된 SDK 함수명이 아닙니다.

```text
get_purchase_order(args, principal):
  validate(args, inputSchema)
  record = purchaseApi.readAuthorized(principal, args.order_id)
  if record is absent: return ORDER_UNAVAILABLE as tool error
  result = {schema_version, order_id, state, as_of}
  validate(result, outputSchema)
  return {structuredContent: result, content: [JSON text of result], isError: false}
```

## 5. 파일·장시간 실행·외부 변경

**파일:** 원격 서버는 사용자 PC의 `/Users/...` 경로를 읽을 수 없습니다. 파일 업로드가 필요한지, 서버가 이미 가진 문서 ID만 받을지 먼저 정합니다. 새 업로드는 전송 범위·크기·보관/삭제·권한 계약과 앱 구현이 필요합니다. 결과 파일도 URI 하나를 반환한다고 자동 저장되지 않습니다. ID, 파일명, MIME, byte 수, hash와 인증된 다운로드/만료 갱신 방식을 합의하고 앱 adapter가 검증해야 합니다. MARU의 구현을 참고할 수 있지만 임의 서버용 공통 다운로드 기능은 아닙니다.

**장시간 작업:** 현재 일반 Harness tool 대기는 기본 30초, 로컬 업무 worker는 120초입니다. MCP 연결 자체가 업무별 deadline을 정하지 않으므로 adapter가 취소 signal과 deadline을 연결해야 합니다. 더 긴 작업은 `start_report → get_report_status → cancel_report → get_report_result`처럼 job ID 기반 계약을 별도 설계합니다. 이는 현재 설치된 범용 기능이 아니며 workflow에 job ID 저장·polling·재연결을 구현해야 합니다. HTTP 연결 종료만으로 원격 업무가 취소되었다고 보장하지 않습니다.

**외부 변경:** 현재 BusinessFlow는 추가 입력마다 Tool을 다시 실행합니다. 전표 등록·발송 같은 부작용을 그대로 넣으면 중복 실행될 수 있습니다. 외부 변경이 필요하면 실행 전 확인 대상, idempotency key와 서버 중복 처리, 결과 조회, 취소 가능 시점, 실패 후 복구를 먼저 합의하고 전용 workflow를 만듭니다. `readOnlyHint` 같은 annotation은 권한 검사나 실행 방지 장치가 아닙니다.

## 6. 외부 팀 전달 체크리스트

아래 내용을 한 onboarding 문서와 fixture 묶음으로 전달하면 됩니다.

| 항목 | 전달할 내용 |
| --- | --- |
| 담당·운영 | 서비스 담당자, 개발/운영 endpoint, 장애 연락 경로 |
| 연결 | transport, protocol/SDK 호환 버전, 인증·발급·회수·만료 절차; 실제 키는 별도 전달 |
| 계약 | 도구 이름, 설명, 입력/출력 schema, schema/업무 규칙 version, 사용 단위·시간대 |
| 샘플 | 정상·빈 결과·입력 오류·권한 거부·일시 장애 JSON, 재현 가능한 테스트 데이터 |
| 권한 | principal 판정 방식, 조회 범위, 사용자 간 격리 검증 방법 |
| 수명·성능 | timeout, rate limit, pagination/크기 상한, cancel 의미, retry·중복 처리 |
| 결과 | 출처·기준 시각, 파일 검증·다운로드·만료/보관 정책 |
| 변경 | 호환성 정책, breaking change 사전 안내, 구버전 종료 일정 |
| 검수 | 업무 정답 fixture, 호출 순서 예시, 허용/거부 테스트 계정 |

최소 인수 테스트는 **정상 호출, 입력 오류, 무인증/권한 거부, timeout/취소, 잘못된 schema, 중복 요청**입니다. pagination·파일·원격 job이 있으면 각 경계도 추가합니다. 케찹이의 probe는 연결 확인이고 업무 정답을 보장하는 테스트는 따로 필요합니다.

## 참고

- [MCP Tools 명세](https://modelcontextprotocol.io/specification/2025-11-25/server/tools): 도구 schema와 결과 형식
- [MCP Transport 명세](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): Streamable HTTP 연결
- [현재 MCP client](../electron/agent/mcp.ts), [Trolley adapter](../electron/agent/trolley.ts): 현재 앱의 지원 범위
- [워크플로 추가 가이드](WORKFLOW_INTEGRATION_GUIDE.md): 케찹이 쪽 구현·등록·테스트
