# KetchupE

KetchupE는 로컬 문서를 검색하고 LiteLLM을 통해 근거 있는 답변과 문서 초안을 만드는 Electron 기반 RAG agent client입니다. 제품 구조의 정본은 [KETCHUPE_V3_ARCHITECTURE.md](KETCHUPE_V3_ARCHITECTURE.md), 코드 흐름은 [KETCHUPE_V3_CODE_GUIDE.md](KETCHUPE_V3_CODE_GUIDE.md)를 보세요.

## 핵심 기능

- 등록한 로컬/rclone/Notion export 폴더를 Tomato가 parse, chunk, index하고 변경을 자동 동기화합니다.
- embedding 준비 전이나 실패 시에도 BM25 keyword 검색으로 계속 동작합니다.
- Harness가 `SEARCH / ASK / VERIFY / ANSWER / STOP`을 명시적으로 실행하고 예산과 citation을 강제합니다.
- 답변은 LiteLLM SSE로 표시하며 `[[eN]]` 근거를 실제 로컬 문서와 연결합니다.
- thread, message, memory, trajectory는 로컬 SQLite에 유지됩니다.
- 완료된 trajectory와 index 통계는 서비스 소유 OTLP gateway를 통해 Langfuse로 전송됩니다.

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

LiteLLM 설정은 개발 환경에서는 환경변수, 패키징 앱에서는 설정 화면과 `safeStorage`를 사용합니다.

```bash
LITELLM_API_KEY=... LITELLM_BASE_URL=... LITELLM_MODEL_ALIAS=... npm run dev
LITELLM_API_KEY=... npm run smoke:litellm
```

## 런타임

```text
등록 폴더
  → Tomato utility process: parse / chunk / embed / FTS5 + vector search
  → Harness main process: context / policy / budget / citation invariant
  → LiteLLM: policy / verify / answer
  → Renderer: 진행 상태 / SSE 답변 / citation
```

한 질문은 하나의 run입니다. `ASK`는 `waiting_user`로 멈췄다가 다음 사용자 메시지로 같은 run을 재개합니다. 실행 상태를 renderer 메모리에만 두지 않으므로 thread 이동과 앱 재시작 뒤에도 복구할 수 있습니다.

## 데이터 경계

| 데이터 | 위치와 역할 |
| --- | --- |
| `agent.sqlite` | thread, run, message, memory, interaction, trace와 telemetry outbox |
| Tomato DB/artifact | 로컬 corpus의 parse/chunk/index 결과 |
| 원본 문서 | 등록한 폴더에 그대로 유지; 앱 데이터로 복사하지 않음 |
| LiteLLM | 선택된 evidence와 prompt를 모델에 전달 |
| Langfuse | 중앙 운영 관측과 평가 후보 선별용 mirror |

Renderer는 파일시스템, SQLite, API key에 직접 접근하지 않습니다. `preload.js`의 좁은 typed IPC만 사용합니다.

## 중앙 telemetry

사용자용 telemetry 설정이나 JSONL export 기능은 없습니다. 공식 빌드는 다음 값을 고정하고, 실패한 전송은 SQLite `telemetry_outbox`에서 재시도합니다.

```dotenv
KETCHUPE_OTLP_ENDPOINT=https://telemetry.example.com/v1/traces
KETCHUPE_OTLP_TOKEN=public-ingest-token
KETCHUPE_TELEMETRY_CONTENT_MODE=ops
KETCHUPE_ENVIRONMENT=production
KETCHUPE_TENANT_ID=public
```

Desktop에는 Langfuse secret을 넣지 않습니다. [telemetry-gateway.ts](scripts/telemetry-gateway.ts)가 public ingest token과 OTLP payload를 검증하고 PII, secret, 절대 경로를 한 번 더 제거한 뒤 Langfuse secret을 주입합니다.

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

전송하는 trace는 다음과 같습니다.

| Trace/observation | 내용 |
| --- | --- |
| `agent.run` | 상태, release, variant, profile SHA, corpus snapshot, 최종 결과 |
| `policy.step.N` | state, action, reason code, confidence, evidence sufficiency, budget, outcome |
| `tool.*` | 검색 방식, rank/evidence, cache, latency, 오류 코드 |
| `model.*` | purpose, model alias, token, latency, finish reason |
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
├── agent/                  Harness, policy, context, memory, trace, telemetry, canvas
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
└── telemetry-gateway.ts
```

## License

MIT
