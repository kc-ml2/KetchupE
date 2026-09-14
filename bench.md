# KetchupE Bench

이 문서는 KetchupE의 중앙 trajectory 수집, benchmark 실행, production 사례의 golden dataset 승격, self-evolution 실험 절차를 설명한다. 사용자가 로컬 JSONL을 직접 내보내는 흐름은 제품에서 제거했다.

## 1. 목표와 경계

KetchupE client는 실행 사실을 OTLP 한 경로로 보낸다. 서비스 관리자는 Langfuse에서 trace를 관찰하고, 별도 bench 환경에서 API 또는 Blob Export를 읽어 평가한다.

```text
KetchupE Desktop
  ├─ agent.run
  ├─ index.sync / embed.batch
  └─ SQLite telemetry_outbox
          │ OTLP/HTTP
          ▼
KetchupE Telemetry Gateway
  ├─ public ingest token 확인
  ├─ 크기·스키마 검사
  ├─ 이메일·전화번호·secret 마스킹
  └─ Langfuse secret 주입
          ▼
Langfuse
  ├─ trace/session/dashboard
  ├─ annotation queue / dataset
  └─ Observations API v2 또는 observations_v2 Blob Export
          ▼
bench/
  ├─ parse → chunk → retrieval → RAG
  ├─ policy → agent trajectory
  └─ calibration → resource → evolution advice
```

역할은 다음처럼 제한한다.

- 로컬 SQLite: 네트워크 실패와 앱 재시작을 견디는 outbox 및 사용자 로컬 기록
- Langfuse: 중앙 운영 관측, 사례 선별, annotation, experiment 조회
- Bench dataset: 사람의 검토를 거쳐 고정된 재현 가능한 평가 사례
- Bench runner: KetchupE 코드/profile 변경 전후 비교
- Advisor: 실패 단계를 보고 한 축의 다음 실험을 추천할 뿐 profile 수정이나 배포는 하지 않음

## 2. Phase별 구현 상태

### Phase 0 — 수집 계약

구현됨:

- `ketchupe-trajectory-v2` 계약: `bench/contracts/trajectory-v2.schema.json`
- score namespace 분리: `runtime/*`, `agent/*`, `user/*`
- `completed`를 정답으로 오인하지 않도록 `runtime/completed`로 명명
- 설치·tenant·thread·source·chunk·memory ID를 설치별 HMAC으로 처리
- profile hash 필드명을 `policyProfileSha`, `retrievalProfileSha`, `answerProfileSha`로 명시
- hidden chain-of-thought는 수집하지 않고 action, reason code, confidence, evidence sufficiency만 수집

### Phase 1 — 중앙 OTLP 수집

구현됨:

- 사용자 Langfuse host/key/toggle UI와 메시지의 JSONL 다운로드 버튼 제거
- 배포 시 고정되는 `KETCHUPE_OTLP_ENDPOINT` 하나로 모든 trace와 feedback 전송
- Langfuse public/secret key는 client가 아니라 `scripts/telemetry-gateway.ts`만 보유
- 이전 score 전송도 OTLP `evaluator` observation으로 변환하므로 client outbound는 OTLP endpoint 하나
- 앱/OS/architecture/CPU 수/RAM bucket/embedding backend를 resource attribute로 기록
- Tomato collection sync를 `index.sync`, embedding을 `embed.batch`로 기록
- 실패 payload는 SQLite `telemetry_outbox`에 남겨 지수 backoff로 재시도
- 앱 재시작 시 `running` run을 `cancelled`로 닫고 남아 있던 outbox marker로 terminal trajectory를 전송

현재 trace는 terminal checkpoint 단위로 전송한다. 매 token 또는 미완료 span을 원격에 반복 전송하지 않는다. 실행 중 UI streaming은 Electron event channel의 책임이고, 중앙 trace는 재현 가능한 완료 observation의 책임이다. `waiting_user`는 재개 시 같은 run을 계속 사용하므로 종료로 보지 않는다.

### Phase 2 — Bench 경계와 중앙 ingest

구현됨:

- 기존 `bench/`를 별도 repository로 옮길 수 있는 평가 경계로 유지
- Langfuse Observations API v2 cursor importer: `bench:ingest`
- Langfuse `observations_v2` JSON/JSONL/gzip importer: `bench:ingest:blob`
- Blob Export의 snake_case timestamp/core field를 API importer와 같은 camelCase envelope로 정규화
- import 결과를 `traceId`와 parent observation으로 재조립하고 manifest SHA-256 기록
- 실제 KetchupE Harness/Tomato를 그대로 호출해 production 동작을 재구현하지 않음

물리적인 remote repository 생성과 object storage bucket provisioning은 이 source repository가 할 수 없는 운영 작업이다. 분리 시 `bench/`, 관련 npm script, CI secret만 새 repository로 이동하고 KetchupE checkout/build SHA를 adapter 입력으로 고정한다.

### Phase 3 — 평가와 golden dataset 흐름

구현됨:

- parse, chunk, retrieval, policy, agent suite 유지
- frozen gold evidence만 주입해 generation을 retrieval과 분리하는 RAG suite 추가
- 실제 trace를 관리자 환경으로 가져오는 API/Blob ingest 추가
- dataset/profile/git/hardware fingerprint가 들어간 manifest 유지
- 동일 agent case 반복 실행의 `pass^k` 기록

Production trace는 곧바로 gold가 아니다. 다음 절차를 통과해야 한다.

1. 실패, 낮은 confidence, citation 오류, retry, correction, abandonment 사례를 우선 선별한다.
2. `redacted_eval` 콘텐츠만 Langfuse annotation queue에 올린다.
3. 관리자가 expected answer, relevant evidence, failure stage를 검토한다.
4. 두 번째 검토자와 PII 확인을 거친 사례만 frozen dataset version에 넣는다.
5. 원 trace ID, annotation version, corpus snapshot, scorer version을 보존한다.
6. 새 profile은 동일 frozen dataset과 held-out dataset을 모두 통과해야 한다.

### Phase 4 — Resource와 self-evolution advisor

구현됨:

- bench manifest에 architecture, CPU 수, RAM, embedding backend 기록
- agent suite에 latency, CPU, RSS, token, model/tool call 수 기록
- `bench:advise`가 suite별 실패와 resource budget을 읽어 다음 단일축 실험을 추천
- parser, chunking, retrieval, answer, policy, memory, resource 축을 분리
- 자동 profile 수정·자동 production 배포는 하지 않음

Self-evolution의 승격 순서는 고정한다.

```text
production 관측
  → failure stage 진단
  → 한 축의 후보 생성
  → frozen validation
  → held-out ID/OOD
  → 과거 사례 replay
  → 품질·latency·RSS·token Pareto 검사
  → 관리자 승인 canary
  → 승격 또는 rollback
```

## 3. 수집 설정

공식 빌드는 다음 값을 build environment에서 주입한다. 사용자는 앱에서 변경할 수 없다.

```dotenv
KETCHUPE_OTLP_ENDPOINT=https://telemetry.example.com/v1/traces
KETCHUPE_OTLP_TOKEN=public-ingest-token
KETCHUPE_TELEMETRY_CONTENT_MODE=ops
KETCHUPE_ENVIRONMENT=production
KETCHUPE_TENANT_ID=public
```

`KETCHUPE_OTLP_TOKEN`은 배포본에서 추출될 수 있는 public ingest credential이다. 비밀 값으로 간주하지 않는다. Gateway에서 rate limit와 교체가 가능해야 한다. Langfuse secret은 절대 client build에 넣지 않는다.

Gateway는 다음 값으로 실행한다.

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

운영 배포 시 TLS, IP/rate limit, request log의 body 제외는 reverse proxy에서 적용한다.

## 4. 콘텐츠 모드

| Mode | 전송 내용 | 용도 |
|---|---|---|
| `ops` | 자유 텍스트는 HMAC, 구조·수치·오류 코드만 유지 | 전체 설치의 기본 운영 관측 |
| `redacted_eval` | 이메일·전화번호·일반 secret을 마스킹한 질문·답변·검색 snippet | 관리자 평가 후보 |
| `internal_full` | path와 API key를 제외한 원문 | 사내 canary 및 공개·합성 corpus |

`ops` trace만으로 가능한 것은 latency, action, 검색 횟수, fallback, citation 형식, calibration 같은 구조 평가다. Answer correctness, semantic relevance, chunk evidence coverage를 중앙에서 다시 채점하려면 `redacted_eval` 또는 별도의 승인된 corpus snapshot이 필요하다.

Regex 마스킹은 완전한 개인정보 탐지기가 아니다. 민감 고객 환경에서는 gateway 앞단 DLP 또는 self-hosted Langfuse를 사용하고 `ops`를 기본값으로 유지한다.

## 5. Trace 계약

### `agent.run`

| Observation | 핵심 데이터 | 평가 용도 |
|---|---|---|
| `agent.run` | goal/answer, 상태, release, variant, profile SHA, corpus snapshot | 전체 결과와 버전 비교 |
| `policy.step.N` | state, action, reasonCode, difficulty, predictedSuccess, evidenceSufficiency, budget | action 품질과 metacognition |
| `tool.search_local_docs` | query, effective mode, ranked evidence, score, cache/error | retrieval과 fallback |
| `tool.get_document_context` | anchor와 이웃 evidence | multi-hop/context expansion |
| `model.policy/verify/answer` | model, purpose, token, latency, finish reason | model 비용과 실패 분리 |
| `feedback.*` | user reaction, 값, provenance, scorer version | 약한 production label |

Policy state는 Agent Lightning의 MDP 형태와 맞는 `state → action → observation → outcome/reward` 전이를 유지한다. hidden reasoning text는 필요하지 않다.

### `index.sync`

| Observation | 핵심 데이터 |
|---|---|
| `index.sync` | collection HMAC, scanned/updated/unchanged/removed/failed, pipeline fingerprint, duration |
| `embed.batch` | model, dimensions, total/embedded/skipped, duration |

현재 Tomato의 `UpdateReport`가 per-file parse/chunk latency를 제공하지 않으므로 중앙 trace도 sync aggregate까지만 사실로 기록한다. 존재하지 않는 세부 timing을 추정해 만들지 않는다. Per-file 최적화가 필요해지면 Tomato worker protocol에 측정값을 추가한다.

## 6. 실행 명령

Node.js 22.5 이상이 필요하다. `node:sqlite`가 없는 Node 20에서는 SQLite suite가 실행되지 않는다.

```bash
npm run bench:parse
npm run bench:chunk
npm run bench:retrieval
npm run bench:rag
npm run bench:policy -- --runs 3
npm run bench:agent -- --runs 3
```

LiteLLM을 사용하는 실제 모델 bench:

```bash
npm run bench:rag -- --client litellm --runs 3
npm run bench:agent -- --client litellm --runs 3
```

Langfuse에서 bounded time range를 가져온다.

```bash
LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
npm run bench:ingest -- \
  --from 2026-09-01T00:00:00Z \
  --to 2026-09-08T00:00:00Z
```

대량 데이터는 Langfuse Blob Export의 `observations_v2` 파일을 사용한다.

```bash
npm run bench:ingest:blob -- \
  --out bench/imports/week-36.jsonl \
  /secure/export/observations_v2/*.jsonl.gz
```

Baseline과 candidate 비교:

```bash
npm run bench:compare -- bench/results/<baseline> bench/results/<candidate>
```

실패 단계와 로컬 자원 한도를 이용한 다음 실험 추천:

```bash
npm run bench:advise -- \
  --latency-budget 3000 \
  --rss-budget 1024 \
  --token-budget 8000 \
  bench/results/<parse> \
  bench/results/<chunk> \
  bench/results/<retrieval> \
  bench/results/<rag> \
  bench/results/<policy> \
  bench/results/<agent>
```

## 7. Suite와 해석

| Suite | 격리하는 단계 | 주요 metric |
|---|---|---|
| parse | 원본 → canonical unit | parse success, required unit recall, locator accuracy, latency |
| chunk | canonical unit → chunk | gold span coverage, split violation, token p50/p95, over-max |
| retrieval | query → ranked chunks | Recall@5/8, MRR@10, nDCG@10, no-answer empty rate, p95 latency |
| RAG | frozen evidence → answer | answer correctness, citation validity/coverage, token, latency |
| policy | frozen PolicyState → decision | action/reason accuracy, difficulty macro-F1, Brier, ECE, risk-coverage, budget |
| agent | scripted user → complete trajectory | task success, `pass^k`, evidence gain, ASK/VERIFY, citation, token, CPU/RSS, failure stage |

한 metric으로 합치지 않는다. 예를 들어 retrieval 결과에 gold evidence가 있는데 답변이 틀리면 `generation`, 답변 내용은 맞지만 source가 틀리면 `citation`, evidence 자체가 없으면 `retrieval`이다.

Metacognition은 자기 평가 문장의 그럴듯함이 아니라 다음으로 측정한다.

- predicted success와 실제 성공의 Brier/ECE
- confidence threshold별 coverage와 risk
- difficulty별 calibration
- 검색 이후와 verification 이후 confidence 변화
- 낮은 confidence에서 ASK/VERIFY/STOP을 적절히 선택했는지
- failure reflection이 실제 first failed stage를 맞혔는지

## 8. Production 데이터에서 benchmark 만들기

Langfuse importer 출력은 `bench/imports/`에 저장되며 gitignored다. 업무 원문을 Git에 commit하지 않는다.

권장 dataset tier:

1. `seed`: 구현자가 만든 합성 corpus. 빠른 smoke/regression용
2. `candidate`: production trace에서 선별됐으나 아직 label 검토 전
3. `gold`: expected answer/evidence/failure stage가 2인 검토된 고정 버전
4. `heldout-id`: 같은 업무 분포지만 evolution 과정에서 보지 않은 사례
5. `heldout-ood`: 다른 문서 형식, 난이도, 표현, hardware tier
6. `replay`: 과거 release가 해결했던 회귀 방지 사례

Langfuse dataset은 선별·annotation UI로 사용한다. 장기 재현의 정본은 private object storage의 immutable snapshot과 repository manifest hash다. Langfuse trace retention과 무관하게 동일 입력을 재실행할 수 있어야 한다.

## 9. Self-evolution 판정

후보 profile은 최소 다음 조건을 모두 만족해야 한다.

- frozen validation의 핵심 품질 metric이 하락하지 않음
- held-out ID에서 개선
- held-out OOD에서 큰 하락 없음
- replay에서 이전 성공을 잊지 않음
- 세 번 이상의 trial에서 `pass^k`가 악화되지 않음
- latency/RSS/token budget을 넘지 않음
- 변경 축이 하나라서 개선 원인을 설명할 수 있음

추적할 장기 metric:

- evolution gain: update 전후 held-out 성공률 차이
- forgetting: 기존 replay 성공률 하락
- failure avoidance rate: 같은 실패 패턴을 피한 비율
- token efficiency: 성공 task당 token/model call
- stability: snapshot과 trial 사이 분산
- transfer: 새 문서 형식과 다른 업무에 대한 개선
- update cost: annotation, experiment, model call 및 wall time

자동화는 `관측 → 추천 → offline experiment → gate`까지만 수행한다. Production promotion은 관리자 승인과 rollback 가능한 release가 필요하다.

## 10. 참고 연구와 프로젝트

### RAG와 chunking

- [RAGAS: Automated Evaluation of Retrieval Augmented Generation, EACL 2024](https://aclanthology.org/2024.eacl-demo.16/): context relevance, faithfulness, answer relevance를 분리하는 reference-free 평가. KetchupE도 retrieval과 generation score를 합치지 않는 근거로 사용했다.
- [ARES: An Automated Evaluation Framework for RAG Systems, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/): context relevance, answer faithfulness, answer relevance judge를 소량의 human annotation으로 보정한다. Production judge를 gold로 간주하지 않는 근거다.
- [BRIGHT, ICLR 2025](https://openreview.net/pdf?id=ykuc5q381b): keyword/semantic 표면 일치만으로 풀기 어려운 reasoning-intensive retrieval. 향후 held-out retrieval 난이도 설계에 사용한다.
- [HiChunk/HiCBench, 2025](https://arxiv.org/abs/2509.11552): 수동 chunk boundary와 evidence-dense QA를 결합해 chunking의 downstream 영향을 평가한다. `goldSpanCoverage`와 chunk→retrieval→RAG 연쇄 평가의 근거다.

### Agent와 trajectory

- [τ-bench, ICLR 2025](https://openreview.net/pdf?id=roNSXZpUDN): user–agent–tool 상호작용, 최종 상태, policy adherence와 반복 신뢰도 `pass^k`. KetchupE scripted user와 반복 trial에 반영했다.
- [Agent Lightning, 2025](https://arxiv.org/abs/2508.03680): agent 실행과 학습을 분리하고 trajectory를 MDP transition으로 표현한다. `PolicyTransition`과 중앙 trajectory contract의 근거다.
- [Uncertainty Calibration for Tool-Using Language Agents, EMNLP 2024](https://aclanthology.org/2024.findings-emnlp.978/): tool-use agent의 prompt 및 trajectory 선택 miscalibration. Brier/ECE/risk-coverage를 별도 축으로 유지하는 근거다.
- [The Confidence Dichotomy, ACL 2026](https://aclanthology.org/2026.acl-long.520/): evidence tool은 과신을 높일 수 있고 verification tool은 calibration을 개선할 수 있음을 분석한다. 검색 전후와 검증 후 confidence를 구분하는 근거다.

### Memory와 self-evolution

- [SEA-Eval, 2026](https://arxiv.org/abs/2604.08988): 단발 success가 아니라 sequential task stream의 success와 token consumption으로 evolutionary gain과 stability를 평가한다.
- [SEAGym, 2026](https://arxiv.org/abs/2606.17546): train batch, frozen update-validation, held-out ID/OOD, replay, cost snapshot을 분리한다. KetchupE 승격 gate의 직접적인 프로토콜 근거다.
- [EvoMemBench, 2026](https://arxiv.org/abs/2605.18421): in-episode/cross-episode와 knowledge/execution memory를 분리하며, memory가 쉬운 task에서는 손해가 될 수 있음을 보인다. Memory ablation과 negative transfer 평가에 반영한다.
- [BenchTrace, 2026](https://arxiv.org/abs/2605.29225): reflection의 실패 식별과 이후 실패 회피를 분리하고 failure avoidance rate를 제안한다. Advisor 추천과 실제 개선 효과를 구분하는 근거다.
- [TRACE, ICLR 2026](https://openreview.net/pdf?id=2H03gm4Rq6): trajectory로 더 어려운 task를 만들되 replay와 다단계 검증으로 재현성을 확인한다. 자동 생성 task는 이 검증을 갖추기 전에는 gold dataset에 넣지 않는다.

### Langfuse

- [Observations API v2](https://langfuse.com/docs/api-and-data-platform/features/observations-api): bounded time range, field group, cursor pagination, traceId grouping 방식
- [Blob Storage Export](https://langfuse.com/docs/api-and-data-platform/features/export-to-blob-storage): 대규모 `observations_v2`와 score export
- [Datasets](https://langfuse.com/docs/evaluation/experiments/datasets): production observation을 dataset item으로 승격하고 원 trace와 연결하는 흐름
- [Annotation Queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues): 운영 실패 사례의 관리자 검토
- [Experiments via OpenTelemetry](https://langfuse.com/docs/evaluation/experiments/experiments-via-opentelemetry): 별도 bench runner의 결과를 Langfuse experiment trace로 다시 연결하는 방식

## 11. 현재 의도적으로 남긴 제한

- 실제 telemetry domain, TLS, rate limit, Langfuse project와 object storage는 운영 환경에서 provision해야 한다.
- `redacted_eval`의 regex는 기본 방어선이다. 민감 tenant에는 DLP가 필요하다.
- Production golden dataset은 실제 관리자 annotation 없이는 만들 수 없으므로 seed dataset만 repository에 포함한다.
- 자동 prompt/profile 생성과 자동 배포는 구현하지 않았다. 충분한 gold/held-out/replay 사례가 쌓인 뒤 추가한다.
- 범용 agent adapter는 두 번째 실제 agent runtime이 들어올 때 추출한다. 지금은 KetchupE Harness와 Tomato를 직접 재사용한다.
