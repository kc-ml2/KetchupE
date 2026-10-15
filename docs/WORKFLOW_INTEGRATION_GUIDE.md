# 케찹이 워크플로 추가 가이드

기준: 2026-10-16의 실제 코드. 대상은 KetchupE 담당자입니다. 외부 팀에는 [MCP 제작·전달 가이드](MCP_PROVIDER_GUIDE.md)를 먼저 공유하세요. 이 문서의 발주 조회는 **추가 구현 예시**이며 현재 제공 기능이 아닙니다.

## 1. 먼저 확장 지점을 고르기

| 추가하려는 기능 | 구현 경로 | 기존에 재사용할 것 |
| --- | --- | --- |
| XLSX 원천 → 추가 확인 → 검증된 XLSX | `BusinessTool` 등록 | BusinessFlow, 입력 카드, worker, checkpoint, 결과 검증·저장 |
| 새 목적·여러 단계·독자적인 재개 상태가 있는 업무 | `AgentWorkflow` 실행기 등록 | Dispatcher, 대화, 공통 start/resume/cancel IPC |
| 일반 질문에서 쓸 외부 조회 도구 하나 | Harness의 도구 계약 확장 | 기존 `chat` workflow의 policy·budget·trace |

**MCP 연결과 workflow 등록은 별개입니다.** `McpConnection`에 endpoint를 넣어도 라우터·policy·업무 탭에 자동 노출되지 않습니다. 현재는 앱에 포함된 코드를 등록하는 방식이며 원격 manifest나 외부 SKILL 파일을 설치해 실행하지 않습니다.

## 2. Workflow의 실제 계약

원본: [workflows.ts](../electron/agent/workflows.ts), [router.ts](../electron/agent/router.ts), [runLifecycle.ts](../electron/agent/runLifecycle.ts).

```ts
// 실제 계약의 핵심 필드. 타입 정의의 원본은 링크한 소스입니다.
type WorkflowHandle = { runId: string; done: Promise<void> };
type Workflow = {
  id: string;
  kind: string;
  description: string;
  examples?: readonly string[];
  requiredInputs?: readonly string[];
  start: (input: {
    workspaceId: string;
    threadId: string;
    text: string;
    mode?: string;
  }) => WorkflowHandle;
  resume?: (runId: string, text: string) => WorkflowHandle;
  cancel: (runId: string) => void;
};
```

- `id`는 라우팅 선택값입니다. `mode: "doc"`에서 `doc`에 해당합니다. `kind`는 DB에 저장되어 재개·취소 소유자를 찾습니다. 둘 다 registry 안에서 고유해야 하며 `auto`는 ID로 사용할 수 없습니다.
- `start`는 **동기적으로 run을 생성하고 handle을 반환**합니다. 오래 걸리는 작업은 `done`으로 추적합니다. 최초 입력 대기까지만 진행했다면 `done`은 resolve되어도 run은 `waiting_user`입니다.
- `requiredInputs`는 라우팅 설명입니다. 누락 검사·사용자 질문은 실행기가 해야 합니다. 목록에 썼다고 자동 입력 폼이 생기지 않습니다.
- `resume`는 일반 텍스트 재개가 가능할 때만 제공합니다. Canvas의 anchor 선택/편집, BusinessFlow의 카드 제출은 전용 IPC를 사용합니다.
- 실행기는 입력·업무 검증, tool scope, deadline·취소, DB 상태·메시지·trace·이벤트를 책임집니다. Dispatcher가 이를 대신 구현하지 않습니다.

Dispatcher는 workspace·빈 입력·중복 시작을 검사합니다. 열린 run이 있으면 새로 라우팅하지 않고 저장된 kind의 실행기에 재개를 요청합니다. `running` 작업에 새 메시지를 보내면 재개 검증에서 거부됩니다. `waiting_user` 작업을 끝내거나 취소해야 다른 workflow를 시작할 수 있습니다.

자동 라우터는 등록된 모든 route의 설명·예시·필수 입력을 봅니다. `matches`는 현재 후보를 걸러내는 조건이 아닙니다. `$id`는 명시 선택이며, 알 수 없는 ID나 모델 실패를 다른 업무로 임의 대체하지 않습니다.

## 3. 예제 A — 외부 MCP로 발주 상태 조회

### 업무 흐름과 소유권

```text
“발주 상태 확인해줘” / mode=order_status
  → OrderStatusFlow.start: run + 사용자 메시지 저장
  → 번호 없음: “조회할 발주번호를 알려주세요.” → waiting_user
  → resume("PO-2026-000123"): 번호 검증 → running
  → PurchaseClient.getOrder → MCP get_purchase_order
  → schema·요청 ID 일치 확인 → 상태와 기준 시각을 메시지로 저장
  → completed
```

외부 팀은 권한 있는 발주 조회와 결과 계약을 책임집니다. 앱은 번호 입력·재개, 서버 연결, 오류 표시, timeout/취소, 기록을 책임집니다. 정해진 상태를 그대로 표시하는 업무라면 추가 LLM 호출이 필요하지 않습니다.

### MCP adapter 예제

아래는 `electron/agent/purchase.ts`에 넣을 수 있는 예제입니다. 파일은 이 문서에서 설명만 하며 실제 제품 코드로 추가하지 않았습니다. 도구 schema는 [외부 팀 예제](MCP_PROVIDER_GUIDE.md)와 같습니다. endpoint와 token은 runtime이 주입합니다.

```ts
import { z } from "zod";
import { AgentError } from "./contracts.ts";
import { McpConnection } from "./mcp.ts";

const orderId = z.string().regex(/^PO-[0-9]{4}-[0-9]{6}$/);
const orderSchema = z.object({
  schema_version: z.literal("purchase-order.v1"),
  order_id: orderId,
  state: z.enum(["approved", "shipping", "received"]),
  as_of: z.iso.datetime({ offset: true }),
}).strict();

export class PurchaseClient {
  private readonly connection: McpConnection;

  constructor(endpoint: URL, token: string, appVersion: string) {
    if (endpoint.protocol !== "https:") throw new Error("HTTPS endpoint required");
    this.connection = new McpConnection({
      id: "purchase", endpoint, clientName: "ketchupe", clientVersion: appVersion,
      token: async () => token,
      allowedTools: ["get_purchase_order"],
    });
  }

  async getOrder(id: string, signal: AbortSignal) {
    const parsedId = orderId.safeParse(id);
    if (!parsedId.success) throw new AgentError("INTERNAL", "발주번호 형식을 확인해 주세요.");
    const deadline = AbortSignal.timeout(30_000);
    try {
      const result = await this.connection.callTool(
        "get_purchase_order", { order_id: parsedId.data },
        AbortSignal.any([signal, deadline]),
      );
      if (result.isError) throw new AgentError("TOOL_UNAVAILABLE", "발주를 조회하지 못했습니다.");
      let payload: unknown = result.structuredContent;
      if (payload === undefined) {
        const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
        try { payload = JSON.parse(text); }
        catch { throw new AgentError("TOOL_UNAVAILABLE", "잘못된 발주 응답입니다."); }
      }
      const parsed = orderSchema.safeParse(payload);
      if (!parsed.success || parsed.data.order_id !== parsedId.data) {
        throw new AgentError("TOOL_UNAVAILABLE", "발주 응답을 확인할 수 없습니다.");
      }
      return parsed.data;
    } catch (error) {
      if (signal.aborted) throw new AgentError("CANCELLED", "작업을 중단했습니다.");
      if (deadline.aborted) throw new AgentError("TOOL_TIMEOUT", "발주 조회 시간이 초과되었습니다.");
      throw error;
    }
  }

  close() { return this.connection.close(); }
}
```

이 예제는 서버 오류를 사용자에게 안전한 공통 오류로 바꾸며 자동 재시도하지 않습니다. 운영에서 오류별 대응이 필요하면 외부 팀의 오류 JSON을 별도 schema로 파싱해 허용된 코드만 매핑합니다. 원격 `readOnlyHint`만 믿거나 서버의 자유 텍스트를 시스템 지시로 사용하지 않습니다.

### 실행기에서 구현할 상태

`OrderStatusFlow`는 새로 만들어야 합니다. 위 adapter나 다음 등록 코드만 추가하면 완성되는 것이 아닙니다. [WorkSourcesFlow](../electron/agent/workSourcesFlow.ts)의 질문·저장 패턴과 [Harness](../electron/agent/harness.ts)의 비동기 취소·종료 패턴을 참고하세요.

| 전환 | 저장·검증할 내용 | renderer 이벤트 |
| --- | --- | --- |
| start | `createRun(kind="order_status")`, 최초 user 메시지, `run.started` trace | 실행 단계 또는 첫 질문 |
| 번호 누락/오류 | 질문·현재 단계·schema version을 영속 저장; `waiting_user` | `ask_user`의 `question` |
| resume | DB의 kind·상태 확인; user 메시지 저장; 번호 검증 후 `running` | `status`의 `phase` |
| 조회 성공 | 안전한 결과와 출처·기준 시각을 assistant 메시지로 저장; `completed` | `completed`의 `text`, `outcome: "success"` |
| 조회 실패 | 오류 trace·run 상태를 `failed`로 종료 | `failed`의 `code`, `message` |
| 취소 | 실행 중 controller abort 또는 대기 run을 `cancelled`로 저장 | `failed`, `code: "CANCELLED"` |

실행별 AbortController, 단조 증가하는 이벤트 `seq`, 중복 재개 방지, 종료 후 늦은 응답 무시를 구현합니다. 비동기 실패는 실행기 안에서 상태·이벤트로 처리해 `done`의 unhandled rejection을 남기지 않습니다. 대기 중에는 살아 있는 Promise에 기대지 말고 DB에 저장한 상태에서 재개합니다. 새 테이블이 필요하면 [DB migration](../electron/db/openAgentDb.ts)을 추가합니다. token·signed URL은 메시지·checkpoint·trace에 저장하지 않습니다.

`cancelWaitingRun`은 대기 run의 상태/trace를 바꾸는 helper입니다. renderer 이벤트 전송과 실행기별 정리는 호출자가 해야 합니다. 원격 조회를 취소해도 서버 처리가 물리적으로 중단되는지는 서버 계약에 달려 있습니다.

### runtime 등록

다음은 **작성한 `orderStatusFlow` 인스턴스**를 [runtime.ts](../electron/agent/runtime.ts)의 `new WorkflowDispatcher(db, [...])` 배열에 넣는 등록 조각입니다.

```ts
{
  id: "order_status",
  kind: "order_status",
  description: "발주번호로 구매 시스템의 현재 발주 상태와 조회 기준 시각을 확인한다.",
  examples: ["PO-2026-000123 발주 상태 확인해줘", "발주 진행 상태 조회해줘"],
  requiredInputs: ["발주번호"],
  start: (input) => orderStatusFlow.start(input),
  resume: (runId, text) => orderStatusFlow.resume(runId, text),
  cancel: (runId) => orderStatusFlow.cancel(runId),
}
```

runtime은 환경/안전한 저장소에서 credential을 읽어 `PurchaseClient`와 실행기를 조립합니다. 키 미설정 시 기능을 제외할지 명시적으로 이용 불가를 안내할지 정하고, 둘 중 어느 경우에도 가짜 성공을 반환하지 않습니다. 종료 경로에 실행 취소·대기 작업 정리·`purchase.close()`를 연결합니다. 업무 데이터가 telemetry로 나가도 되는지 판단하고 [telemetry.ts](../electron/agent/telemetry.ts)의 내용 필터와 테스트를 함께 갱신합니다.

**UI:** 텍스트 질문/답변은 기존 `useAgentRun`과 `AgentMessages`를 사용할 수 있습니다. structured 입력이면 `RunAction` 타입, main handler, preload, renderer API와 컴포넌트를 함께 추가합니다. 단순한 텍스트 workflow 등록에는 새 IPC가 필요하지 않습니다. 주요 업무 버튼이 필요할 때만 [WorkflowLauncher](../src/Features/Agent/components/WorkflowLauncher.tsx)에 별도로 추가합니다. 필수 입력을 받기 전에는 버튼 제목만으로 실제 조회·생성을 수행하지 않습니다.

## 4. 예제 B — 로컬 Excel 업무 Tool 추가

원본 계약은 [business/contracts.ts](../electron/business/contracts.ts)입니다. 외부 팀은 업무 parser·계산·검증과 정답 fixture를 제공하고 앱 담당자는 registry에 연결합니다. `daily_cash`처럼 입력 확인을 여러 번 거치는 업무도 하나의 Tool로 구현할 수 있습니다.

```ts
// 새 BusinessTool.execute의 반환 형태 예시. 실제 입력/계산 구현은 업무별로 작성합니다.
return {
  status: "needs_input",
  question: "조회 기준일을 확인해 주세요.",
  fields: [{ key: "referenceDate", label: "조회 기준일", type: "date", required: true }],
  checkpoint: { schemaVersion: 1 },
};
```

현재 `execute`에는 `values: Record<string, string>`, 필드별 파일 **배열**(`bytes`, `fingerprint`, `name`), JSON `checkpoint`, `signal`이 전달됩니다. Tool은 `needs_input`, `completed`, `failed` 중 하나를 반환합니다. 추가 입력 후에는 같은 Tool을 처음부터 다시 호출하므로 checkpoint를 재사용하고 외부 변경을 반복하지 않아야 합니다.

추가 순서:

1. `electron/business/<업무>.ts`에 고유 `id`, `version`, 설명·예시, `fields`, `execute`를 구현합니다. 연결된 파일을 미리 채우려면 선택적으로 `suggest`를 구현합니다. 사용자가 첫 실행 전에 확인·변경할 수 있어야 합니다.
2. [registry.ts](../electron/business/registry.ts)의 `businessTools`에 추가합니다. runtime의 `businessFlow.workflows()`가 route를 만들고 [business.worker.ts](../electron/workers/business.worker.ts)도 같은 registry에서 ID·version으로 구현을 찾습니다. **별도로 동일 workflow를 runtime 배열에 중복 등록하지 않습니다.**
3. `needs_input`은 새 질문·필드·checkpoint를, `completed`는 summary·실제 XLSX bytes·비어 있지 않은 업무 검사 결과를 반환합니다. PNG는 선택 사항입니다. URL·PDF·텍스트만 반환하는 업무에는 현재 BusinessFlow 완료 계약이 맞지 않습니다.
4. 결과의 모든 `checks`가 통과하고 공통 XLSX 검증도 통과해야 파일을 저장합니다. Tool 버전·원천 해시·확정 입력을 고정하고 변경 시 새 작업으로 안내합니다.
5. 기존 필드(file/date/text/number/movements)와 `confirm` 안내 속성으로 표현할 수 있으면 [BusinessToolCard](../src/Features/Agent/components/BusinessToolCard.tsx)를 그대로 씁니다. 새 필드 종류는 shared type·`validateFields`·UI를 함께 확장합니다.

완료 파일·checkpoint의 구체적인 반환 예시와 크기 제한은 [BUSINESS_TOOLS.md](BUSINESS_TOOLS.md)에 있습니다. 작은 구현 예제는 [bankDailyTool](../electron/business/bankDaily.ts), 여러 확인 단계가 있는 예제는 [dailyCashTool](../electron/business/dailyCash.ts)을 보세요.

### BusinessTool에서 MCP도 쓰고 싶다면

현재 runtime은 registry Tool의 `execute`를 utility process 호출로 감쌉니다. **main에서 만든 MCP client 객체를 closure로 주입해도 worker로 전달되지 않습니다.** worker는 registry를 다시 로드하고 직렬화된 입력만 받습니다. 현재 `BusinessJob`에는 범용 credential/MCP 연결 주입 계약이 없습니다.

따라서 단순히 main의 `PurchaseClient`를 Tool에 붙인다고 가정하지 마세요. main에서 인증된 조회를 수행하고 검증된 데이터만 worker에 전달하는 계약을 추가하거나, MCP 조회와 계산 worker를 조합하는 별도 workflow를 만듭니다. credential은 사용자 입력·`values`·checkpoint·audit를 통해 전달하지 않습니다. worker가 종료되어도 원격 쓰기는 취소되지 않을 수 있으므로 이 경로에는 재호출 가능한 조회·계산만 연결합니다.

## 5. 기존 chat에 MCP 도구만 추가하는 경우

새 업무 절차 없이 일반 질의에서 쓸 조회 기능이라면 새 workflow 대신 Harness를 확장합니다. 현재 Harness의 tool schema는 고정되어 있어 `tools/list`의 임의 도구를 그대로 실행하지 않습니다.

| 수정 지점 | 필요한 변경 |
| --- | --- |
| 서버 adapter, `runtime.ts` | 연결·allowlist·credential·close·사용 가능 여부 |
| [tools.ts](../electron/agent/tools.ts) | `SearchTools` 의존성과 검증된 반환 타입 |
| [contracts.ts](../electron/agent/contracts.ts) | decision schema·검증·state availability·observation; 문서 provider가 추가되면 출처 타입도 확장 |
| [policy.ts](../electron/agent/policy.ts) | 언제 쓰는지, 인수, 실패/권한 한계와 prompt version |
| [harness.ts](../electron/agent/harness.ts) | 실제 호출, 예산·timeout·취소, evidence 또는 observation, start/resume context |
| telemetry·테스트 | 민감 결과 처리, 모든 policy 전략(`llm`, `always-search`, `gated`)의 동작 |

현재 MARU/Trolley는 이 경로입니다. Trolley의 `list_operations` 결과를 얻었다고 해당 Operation을 실행할 수 있는 것은 아닙니다. generic `execute`를 열지 말고 합의한 도구·schema·권한을 연결하세요. `sanitizeMcpResult`는 모델 context의 크기·민감 필드 정리용이며 업무 원본을 잘라서 계산하는 함수로 사용하지 않습니다.

## 6. 검증과 배포

| 검증 | 확인할 결과 |
| --- | --- |
| 서버 계약 | initialize/list/call, allowlist, 정상/빈/오류 응답, schema 불일치 거부 |
| 입력·라우팅 | 자연어·`$id`·명시 mode, 필수 입력 누락 시 질문부터 표시 |
| 상태 수명 | running/waiting 중복 실행 거부, 같은 run 재개, 재시작 후 대기 복원 |
| 취소·실패 | 실행 중·대기 중 중단, timeout, 늦은 응답 차단, 다른 run에 영향 없음 |
| UI | 입력창 위 상태, 이어가기, 카드/초안 재열기, 중단 대상 run 일치 |
| 데이터·권한 | 서버별 사용자 권한, credential/URL 비노출, 출처·시각, 오류 시 가짜 결과 없음 |
| 업무 정답 | fixture와 정답 비교, 실제 checks, 원천/Tool 버전 변경, 검증 실패 시 결과 미노출 |

현재 회귀 테스트의 출발점은 [workflows.test.ts](../electron/agent/workflows.test.ts), [router.test.ts](../electron/agent/router.test.ts), [trolley.test.ts](../electron/agent/trolley.test.ts), [business/flow.test.ts](../electron/business/flow.test.ts), [AgentPage.test.tsx](../src/Pages/AgentPage.test.tsx)입니다.

```bash
# Node 22.5+ 환경에서 실행
npx vitest run electron/agent/workflows.test.ts electron/agent/router.test.ts
npx vitest run electron/business/flow.test.ts src/Pages/AgentPage.test.tsx
npm run typecheck:electron
npm run build
```

새 adapter/실행기의 테스트와 서버별 probe도 추가합니다. probe는 실서버 연결만 확인하고 업무 정답·복원·취소 테스트를 대체하지 않습니다. 버전 변경으로 예전 checkpoint를 읽을 수 없다면 명시적으로 새 작업을 안내하며, 과거 데이터를 조용히 다른 의미로 재실행하지 않습니다.

외부 팀과의 인수 완료 기준은 **동일 fixture에 대한 계약 테스트 → 개발 서버 연동 → 앱에서 입력·대기·재개·취소·결과까지 확인**입니다. 서버만 만들었거나 registry에 이름만 추가한 상태를 workflow 완료로 보지 않습니다.
