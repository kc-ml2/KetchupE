# KetchupE

KetchupE는 로컬 문서를 검색하고 LiteLLM을 통해 근거 있는 답변과 문서 초안을 만드는 Electron 기반 RAG agent client입니다. 제품 구조의 정본은 [KETCHUPE_V3_ARCHITECTURE.md](KETCHUPE_V3_ARCHITECTURE.md), 코드 흐름은 [KETCHUPE_V3_CODE_GUIDE.md](KETCHUPE_V3_CODE_GUIDE.md)를 보세요.

## 핵심 기능

- 등록한 로컬/rclone/Notion export 폴더를 Tomato가 parse, chunk, index하고 변경을 자동 동기화합니다.
- embedding 준비 전이나 실패 시에도 BM25 keyword 검색으로 계속 동작합니다.
- Harness가 `SEARCH / ASK / VERIFY / ANSWER / STOP`을 명시적으로 실행하고 예산과 citation을 강제합니다.
- 답변은 LiteLLM SSE로 표시하며 `[[eN]]` 근거를 실제 로컬 문서와 연결합니다.
- thread, message, memory, trajectory는 로컬 SQLite에 유지됩니다.
- RAG와 문서 작성 Canvas는 등록형 workflow로 연결됩니다. 새 기능은 실행기와 라우팅 메타데이터를 등록하며 공통 시작·재개·취소 IPC를 재사용합니다.
- 완료된 trajectory와 index 통계는 서비스 소유 OTLP gateway를 통해 Langfuse로 전송됩니다.

## 이번 리팩토링 (2026-10-12)

| 변경 영역 | 반영한 내용 |
| --- | --- |
| 기능 확장 | `WorkflowDispatcher`에 RAG·Canvas를 등록. 고유 ID/kind·설명·후보 판별·실행 함수를 연결하면 공통 시작·재개·취소 IPC를 재사용 |
| 실행 관리 | workspace·빈 입력·중복 등록·잘못된 mode 검사, 라우팅 중 thread별 중복 시작 차단, 저장된 실행 종류의 소유자에게 재개·취소 전달 |
| 대기 중 취소 | RAG ASK·Canvas의 waiting_user run도 영속 취소. 기존 메시지·초안·trace를 보존하고 새로운 이벤트를 보내며 종료 후 이벤트 sequence 상태를 정리 |
| runtime 구성 | 활성 collection 조회와 종료 telemetry callback의 중복 제거, 기존 `tomatoTools()` 재사용, 공통 RunHandle 분리 |
| 모델 호출 | 현재 설정 적용 adapter 분리, AbortSignal별 사용량 격리, 실패한 호출도 종료 trace 기록, schema 오류의 reported usage 보존과 stale usage 제거 |
| 응답 검사·예산 | tool 응답과 JSON text fallback을 같은 schema로 검증. forced-tool 오류에서 text만 복구하며 SDK HTTP 자동 재시도는 중지. 잘못된 policy에는 예산 안에서 추가 시도 1회 |
| timeout·장애 | abort listener 정리와 이미 취소된 signal 처리, 모델 목록·telemetry 양쪽 요청 timeout, `Retry-After` 전달·자동 재전송 반영, gateway의 400/413/502/504 구분 |
| MARU MCP | 현재 onboarding의 두 read 도구·Bearer 인증 유지. runtime/probe의 endpoint 설정 통일, 30초 연결 확인, 진단 출력의 credential·signed URL 제거 |
| UI·계약 | 등록된 텍스트 workflow에 재연결할 수 있도록 shared RunKind/시작 mode 계약과 useAgentRun 갱신. Canvas 구조화 입력은 기존 전용 IPC 유지 |
| 설계·문서 | decision ladder·DDIA 12장·일곱 시나리오별 충족 여부, MARU 권한 위임 가능성과 local ACL의 남은 경계를 실제 코드와 대조 |

기존 SQLite 데이터를 삭제하거나 새로운 dependency를 추가하지 않습니다. 외부 SKILL.md 로더, multi-agent handoff, 사용자별 local ACL, 전역 실행 queue는 이번 변경에 포함하지 않습니다. 검증 범위와 남은 제약은 아래 항목과 아키텍처 문서에 명시합니다.

## 실행

Node.js 22.5 이상이 필요합니다. Electron 39의 내장 Node는 요구사항을 충족합니다.

```bash
npm install
npm run dev
npm run build
npm run build:electron
npm test
npm run test:electron
npm run typecheck:electron
```

LiteLLM 설정은 환경변수·공식 빌드 값이 우선하고, 저장된 설정이 fallback입니다. 저장하는 API key는 `safeStorage`로 암호화합니다.

```bash
LITELLM_API_KEY=... LITELLM_BASE_URL=... LITELLM_MODEL_ALIAS=... npm run dev
LITELLM_API_KEY=... npm run smoke:litellm
```

### MARU MCP 연결

현재 연결 계약의 기준은 [MARU onboarding](https://maru.ml2-alpha.com/onboarding.md)과 서버의 `tools/list`입니다. KetchupE는 예전 MARU의 REST/chat·OTP·refresh API를 호출하지 않고 공식 MCP client의 Streamable HTTP transport를 사용합니다.

Git에서 제외된 `.env`에 관리자에게 받은 사용자 token을 설정합니다. `MARU_API_TOKEN`에는 `Bearer` 접두어 없이 token만 넣습니다. 이미 값이 있으면 그대로 사용합니다.

```dotenv
MARU_API_TOKEN=<관리자에게 받은 사용자 API token>
MARU_MCP_ENDPOINT=https://maru.ml2-alpha.com/mcp
```

```bash
npm run probe:maru
npm run dev
```

`probe:maru`는 인증·도구 목록·현재 접근 가능한 storage를 확인하며 token과 signed download URL을 출력하지 않습니다. runtime과 probe는 같은 endpoint 설정을 사용합니다. 앱에서 "MARU에서 접근 가능한 스토리지를 보여줘"라고 요청하면 됩니다. token 변경 후에는 앱을 재시작합니다.

현재 도구는 `browse_storage`, `find_storage` 두 개입니다. `browse_storage()`의 최신 목록에서 storage를 선택하고 `find_storage`로 검색합니다. 팀/user ID는 지정하지 않으며 서버가 token 사용자의 현재 권한을 검사합니다. MCP client의 인증 필드가 token을 받으면 token만, Authorization header를 받으면 `Bearer <token>`을 넣습니다.

파일명이나 `matches`의 위치만으로 본문을 추정하지 않습니다. KetchupE는 선택한 문서의 exact lookup으로 URL을 갱신한 뒤 원문을 내려받아 Tomato로 읽습니다. 다운로드 URL은 MCP 결과에서 받은 그대로 사용합니다. 직접 MCP로 지원 본문을 읽을 때는 `include_content=true`와 `content.status`·`truncated`·storage별 오류를 확인해야 합니다.

## 런타임

```text
등록 폴더
  → Tomato utility process: parse / chunk / embed / FTS5 + vector search
  ↔ Electron main: runtime → WorkflowDispatcher
                            ├─ chat → Harness: context / policy / budget / citation
                            └─ doc → CanvasFlow: classify / ground / draft / edit
  ↔ LiteLLM: policy / verify / answer / canvas
  → Renderer: 진행 상태 / SSE 답변 / citation / 문서 편집
```

한 thread에는 열린 run이 최대 하나입니다. RAG의 `ASK`는 `waiting_user`로 멈췄다가 다음 사용자 메시지로 같은 run을 재개합니다. Canvas의 참고 문서 선택·편집은 전용 입력으로 이어갑니다. thread 이동 뒤 다시 연결할 수 있고, 앱 재시작 시 대기 중 run은 복구하며 실행 중이던 run은 취소 처리합니다. 대기 중 작업도 취소할 수 있습니다.

### 새 기능 등록

[runtime.ts](electron/agent/runtime.ts)의 등록 배열에 고유 `id`, DB에 저장할 `kind`, `description`, 후보 판별 `matches()`와 `start`·`cancel`·선택적 `resume`을 연결합니다. `mode: "auto"`는 자동 라우팅, 다른 mode는 등록 ID를 직접 선택합니다. 텍스트 기반 기능은 기존 대화 UI와 이벤트를 사용하고, 구조화된 입력·새 표현은 기능별 IPC/UI를 추가합니다.

공통 dispatcher는 입력·workspace·중복 실행을 검사하고 저장된 kind의 소유자에게 재개·취소를 전달합니다. 실행기는 자체 policy, budget, tool scope, 영속 상태와 trace를 담당합니다. 외부 SKILL.md 실행이나 동적 플러그인 로딩은 지원하지 않습니다. 자세한 계약은 [아키텍처 §21](KETCHUPE_V3_ARCHITECTURE.md#21-기능-확장을-위한-실행-경계-2026-10-12)을 보세요.

## 데이터 경계

| 데이터 | 위치와 역할 |
| --- | --- |
| `agent.sqlite` | thread, run, message, memory, interaction, trace와 telemetry outbox |
| Tomato DB/artifact | 로컬 corpus의 parse/chunk/index 결과 |
| 원본 문서 | 등록 폴더의 파일은 그대로 유지; MARU 원격 문서는 앱 관리 cache에 내려받아 인덱싱 |
| LiteLLM | 선택된 evidence와 prompt를 모델에 전달 |
| Langfuse | 중앙 운영 관측과 평가 후보 선별용 mirror |

Renderer는 파일시스템, SQLite, API key에 직접 접근하지 않습니다. `preload.js`의 좁은 typed IPC만 사용합니다.

로컬 저장은 네트워크 반출 금지를 뜻하지 않습니다. 선택된 문서 내용·대화·기억은 지정한 LiteLLM으로 전달되고 telemetry는 설정된 content mode에 따라 gateway로 전송됩니다. 첫 embedding model 준비에도 네트워크 다운로드가 필요합니다. 폐쇄망·리전 제한은 endpoint, 모델 사전 배포, 방화벽과 서버 운영까지 검증해야 합니다. workspace의 활성 collection은 검색 범위 선택이며 사용자별 ACL이나 tenant 인증이 아닙니다.

MARU 통합으로 **사용자별 token → 현재 팀 멤버십 → 팀에 연결된 storage** 권한을 서버에서 강제하는 것은 가능합니다. KetchupE는 현재 `MARU_API_TOKEN`의 사용자로 호출하며, 새 문서 읽기에서는 cache가 있어도 MARU의 exact file lookup을 먼저 수행합니다. 다만 로컬 대화·ASK 재개·citation 열기는 아직 서버 권한을 재검사하지 않으므로 전체 경로의 ACL이 완성된 상태는 아닙니다. 파일별 allow/deny ACL도 MARU의 현재 team/storage 모델과 구분해야 합니다.

2026-10-12 실제 서버에서 MCP 연결·허용 storage 조회와 인증 누락/오류 token의 401, 존재하지 않는 storage의 오류를 확인했습니다. 현재 onboarding과 배포 서버/KetchupE는 `browse_storage`·`find_storage` 계약으로 일치합니다. 앞서 검토한 GitHub commit snapshot의 명시적 team-scoped 도구는 현재 연결 설정의 기준으로 사용하지 않습니다. source·실서버·local cache 테스트의 범위와 통합 조건은 [아키텍처 §23](KETCHUPE_V3_ARCHITECTURE.md#23-maru-acl-통합-가능성-검증-2026-10-12)에 있습니다.

## System design 검증 상태

현재 설계의 기준은 **개인 PC의 로컬 corpus + 지정된 모델 서버 + 중앙 운영 관측**입니다. Enterprise multi-tenant RAG, GPU serving, multi-region 운영 전체를 충족하는 시스템으로 간주하지 않습니다. 제공된 decision ladder와 DDIA 12장, 일곱 시나리오를 실제 코드에 대조한 상세 결과는 [아키텍처 §22](KETCHUPE_V3_ARCHITECTURE.md#22-system-design-검증-2026-10-12)에 있습니다.

| 판단 질문 | 현재 구현과 trade-off |
| --- | --- |
| 데이터가 나갈 수 있는가, 누가 볼 수 있는가? | local 원본·DB, 지정 endpoint로 모델/telemetry 전송. local collection 필터는 ACL이 아님. MARU의 사용자·팀·storage 권한을 재사용할 수 있으나 local 재사용 경로의 권한 회수와 residency enforcement는 미완성 |
| 정답과 오답 비용은 무엇인가? | citation ID 검사, ASK/STOP, 선택적 VERIFY, Canvas 검토·확정. 모든 주장·수치의 사실성이나 강제 승인 흐름은 보장하지 않음 |
| 부하와 SLO는 무엇인가? | thread당 열린 run 1개, utility process, SSE, token/latency/TTFT trace. 전역 실행 제한·queue·RPS/p95 목표는 미정 |
| 무엇이 자주 바뀌는가? | source/chunk hash, parser/chunker/embedding profile, prompt/profile/corpus fingerprint. immutable model checkpoint pinning과 corpus 전체의 bench-gated 전환은 없음 |
| 무엇이 실패하고 어떻게 복구하는가? | keyword fallback, worker 지연 재시작, waiting run 복구, durable outbox. 분산 lease/fencing이나 exactly-once는 보장하지 않음 |

현재 RAG 기본 상한은 **6 steps / 8 model calls / 3 searches / 1 verify / 180초**이고 일반 tool 대기는 **30초**입니다. SDK HTTP 자동 재시도는 끄고 잘못된 policy에는 예산 안에서 한 번의 추가 시도만 허용합니다. 모델 목록 조회와 telemetry 양쪽 전송에도 30초 timeout이 있으며, telemetry 자동 재전송은 `Retry-After`를 반영합니다. 이 값들은 처리량·응답 시간 SLO가 아니며 Canvas 전체 실행이나 token 비용 상한에도 그대로 적용되지 않습니다.

대규모 검색은 현재 정확한 vector scan의 `O(N × 384)` 비용을 갖습니다. ANN 도입 시점은 고정 chunk 수로 선언하지 않고, corpus·동시 실행·출력 길이를 명시한 p95/p99·TTFT·CPU/RSS 측정으로 결정합니다. benchmark의 `pass^k`, 언어별 Recall@k, abstention 평가와 release gate는 외부 repository가 소유하며 이 README는 외부 성적을 검증 결과로 주장하지 않습니다.

## 중앙 telemetry

사용자용 telemetry 설정이나 JSONL export 기능은 없습니다. 공식 빌드는 다음 값을 고정하고, 실패한 전송은 SQLite `telemetry_outbox`에서 재시도합니다.

```dotenv
KETCHUPE_OTLP_ENDPOINT=https://telemetry.example.com/v1/traces
KETCHUPE_OTLP_TOKEN=public-ingest-token
KETCHUPE_TELEMETRY_CONTENT_MODE=ops
KETCHUPE_ENVIRONMENT=production
KETCHUPE_TENANT_ID=public
```

Desktop에는 Langfuse secret을 넣지 않습니다. [telemetry-gateway.ts](scripts/telemetry-gateway.ts)가 public ingest token과 OTLP envelope를 검사하고 이메일·전화번호·일부 secret·절대 경로 패턴을 한 번 더 제거한 뒤 Langfuse secret을 주입합니다. 패턴 기반 정리는 모든 PII의 제거를 보장하지 않습니다.

```dotenv
LANGFUSE_HOST=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
KETCHUPE_INGEST_TOKEN=public-ingest-token
PORT=4318
```

```bash
npm run telemetry:gateway
```

Langfuse를 셀프호스팅(v4)으로 옮길 때는 gateway의 `LANGFUSE_HOST`와 키 두 개만 바꿉니다. Desktop 빌드는 `KETCHUPE_OTLP_ENDPOINT`만 알기 때문에 다시 배포하지 않습니다.

전송하는 trace는 다음과 같습니다.

| Trace/observation | 내용 |
| --- | --- |
| `agent.run` | 상태, release, variant, profile SHA, corpus snapshot, 최종 결과 |
| `policy.step.N` | state, action, reason code, confidence, evidence sufficiency, budget, outcome |
| `tool.*` | 검색 방식, rank/evidence, cache, latency, 오류 코드 |
| `model.*` | purpose, model alias, token(cache 적중분 포함), latency, finish reason, `model.answer`의 첫 토큰 시각 |
| `agent.time_to_first_token` | 사용자 메시지부터 답변 첫 토큰까지의 대기(policy·검색 포함) |
| `index.sync` / `embed.batch` | collection 동기화와 embedding 집계 |
| `feedback.*` | `runtime/*`, `agent/*`, `user/*` evaluator 값 |

기본 `ops` 모드는 자유 텍스트와 식별자를 설치별 HMAC으로 바꿉니다. `redacted_eval`과 `internal_full`은 서비스 관리자가 배포 단위로 선택합니다. absolute path, API key, hidden chain-of-thought는 어떤 모드에서도 전송하지 않습니다.

## 외부 benchmark 경계

Benchmark runner, dataset, profile, Langfuse importer와 결과는 이 client repository에 두지 않습니다. 별도 benchmark repository가 다음을 소유합니다.

- Langfuse Observations API v2/Blob Export ingest
- parse, chunk, retrieval, frozen-evidence RAG, policy, end-to-end agent suite
- golden/held-out/replay dataset과 annotation 이력
- `pass^k`, calibration, latency/token/CPU/RSS 비교와 profile promotion gate

KetchupE의 책임은 `ketchupe-trajectory-v2` observation을 안정적으로 보내고 release/profile/corpus fingerprint를 남기는 데까지입니다. 외부 benchmark는 평가 대상 KetchupE commit SHA를 고정하고 제품의 Harness/Tomato adapter를 사용해야 하며 제품 로직을 복제하지 않습니다.

## 주요 디렉터리

```text
electron/
├── agent/                  runtime, workflows, router, Harness, context, trace, telemetry, canvas
├── tomato/                 parser, chunker, embedding, local retrieval
├── workers/                Tomato utility process entry
├── db/                     SQLite schema/open
├── ipc/                    main-process handlers
└── collectionWatchers.ts   folder watch, sync, embedding orchestration

src/
├── Pages/AgentPage.tsx
├── Features/Agent/
├── Features/Sidebar/
├── Contexts/ThreadsProvider.tsx
└── app-types/

scripts/
├── litellm-smoke.ts
├── maru-probe.ts            MCP 인증·도구·storage 연결 확인
└── telemetry-gateway.ts
```

## 검증

```bash
npm test -- --run
npm run typecheck:electron
npm run build
```

회귀 테스트는 세 번째 workflow 등록·라우팅·소유자별 재개/취소, 동시 시작 방지, waiting_user 취소, UI 재연결, timeout listener 정리, 동시 모델 사용량과 실패 trace, schema fallback·HTTP 재시도 차단, telemetry Retry-After 및 gateway 오류, MARU의 cache 재사용 전 권한 확인과 진단 redaction을 포함합니다. 최종 실행 결과는 전체 테스트 **103개 통과**, Electron typecheck·변경 TypeScript 파일 lint·production build 통과입니다.

실제 MARU MCP에서는 정상 token 연결·도구 목록·storage 5개 조회, 인증 누락·오류 token의 401, 존재하지 않는 storage 거부를 확인했습니다. 두 번째 사용자 token을 이용한 타 팀 접근, 운영 권한 회수 뒤 local history/resume/citation 차단, 대규모 부하/SLO와 signed installer는 아직 검증하지 않았습니다. 이는 local fixture 통과와 구분해야 합니다.

## License

MIT
