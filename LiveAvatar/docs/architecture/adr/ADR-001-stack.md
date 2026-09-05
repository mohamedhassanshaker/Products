# ADR-001 — Stack, architecture style, deployment topology, and AI boundary

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Nexus architecture phase
- **Context sources:** `docs/PRODUCT_SPECIFICATION.md` (approved), `docs/BACKLOG.md`, `docs/architecture/HLD.md`, `docs/architecture/LLD.md`
- **Supersedes / superseded by:** —

---

## Context

The Conversational Avatar Platform is an operator-managed, multi-tenant SaaS control plane (11 screens, RBAC, YAML-driven provider configuration) bolted to a hard-real-time media and AI pipeline (WebRTC transport, GPU speech recognition, remote LLM inference, GPU speech synthesis, GPU avatar rendering) with a p95 budget of 3.0 s from utterance end to first avatar motion.

Those two halves have almost nothing in common: one is CPU-light request/response CRUD with complex authorization; the other is long-lived streaming with GPU-adjacent latency budgets. The spec locks the split explicitly (§9.1: *"Agent runtime = LiveKit Agents (Python…). Control plane = separate API… NestJS will **not** drive WebRTC."*), so this ADR's job is to record which defaults were kept, which were deviated from, and exactly which spec requirement forced each deviation.

Defaults kept as-is get one line. The deviations get the words.

---

## Decision summary

| Dimension | Decision | Default? |
|---|---|---|
| Control-plane stack | **Stack A — NestJS + Angular**, Nest serves the Angular `dist/`s and exposes `/api` | Default (admin-heavy SaaS with complex RBAC) |
| Second runtime | **Python `apps/agent` on LiveKit Agents**, LangGraph *or* Pydantic AI per deployment | **Deviation — §1** |
| Conversation AI orchestrator | Python agent process. **Not** Google ADK, **not** NestJS | **Deviation — §2** |
| Architecture style | **Modular monolith** control plane + one additional deployable | Default (§5 confirms no microservice split) |
| Deployment topology | **Multi-container**: `web`, `agent`, `livekit`, `postgres`, `redis` | **Deviation — §4** |
| AI provider-agnostic boundary | Registry + adapters **in Python**, not TypeScript | **Deviation — §3** |
| TS schema library | **TypeBox** across API, forms, and shared contracts | Default for a project with an AI subsystem |
| Python schema library | **Pydantic v2** for runtime config and structured LLM output | **Documented addition — §7** |
| Database | **PostgreSQL 16**, row-level `tenant_id` isolation | Locked by spec §9.1 |
| API style | **REST** + OpenAPI 3 | Default |
| Data locality | On-prem media/speech; **text-only** to remote LLMs by default | **Explicit security decision — §6** |
| Monorepo tooling | **pnpm workspaces**, no Nx | **Deviation — §8.4** |

---

## §1 — Deviation: a second runtime (Python) for the agent

**Decision.** The conversation pipeline runs in a separate Python deployable (`apps/agent`) built on `livekit-agents`, with LangGraph or Pydantic AI selected per deployment by `agent.runtime`. NestJS keeps tenants, auth, config, tokens, records, and dashboards, and never attaches to LiveKit as a media client.

**Concrete requirement that forces it.**

- Spec §1.2 and §9.1: *"Agent runtime on LiveKit Agents (Python; LangGraph or Pydantic AI behind `ILLMProvider`). NestJS does **not** drive WebRTC."* — a locked decision, not a preference.
- FR-TRANSPORT-3: *"NestJS/control plane **must not** attach as a media SFU client."*
- FR-AGENT-1: the STT → LLM(+tools) → TTS → avatar loop *"Runtime is LiveKit Agents (Python)… NestJS does not run this loop."*
- FR-CONFIG-2 makes the framework choice **tenant-configurable** (`agent.runtime: langgraph | pydantic-ai`). Both are Python libraries with no TypeScript equivalent, so a TypeScript-only runtime cannot satisfy a published config.
- FR-STT-2 / FR-AVATAR-1: faster-whisper and the bitHuman local runtime are Python/native GPU components driven in-process; the mature client/binding ecosystem for all four media hops (LiveKit Agents, Deepgram, faster-whisper, Fish Speech, bitHuman) is Python.

**Why pure Stack A cannot absorb it.** Stack A's runtime is Node. There is no Node host for LiveKit Agents' Python worker protocol, LangGraph, Pydantic AI, faster-whisper, or the bitHuman Python runtime. Re-implementing them in TypeScript would contradict the spec's locked runtime split and forfeit the vendor SDKs that FR-STT/FR-TTS/FR-AVATAR assume.

**Why Stack B (Next.js full-stack) cannot absorb it either.** Same runtime problem, and Stack B would additionally cost the control plane what makes Stack A the right choice for the other 8 screens: NestJS's DI-based module boundaries, guard/interceptor pipeline (RBAC + tenant scoping + audit + idempotency as cross-cutting concerns), and first-class OpenAPI. The product is *both* an enterprise admin SaaS *and* an AI media product; neither single-stack option covers both, so the split is the answer rather than a compromise on one half.

**Consequences accepted.** Two languages, two toolchains, two CI lanes, and one cross-language contract (the YAML/runtime-config schema) that can drift. Drift is mitigated concretely: `packages/contracts` exports the TypeBox schema as JSON Schema, and a CI contract test asserts the Pydantic mirror accepts/rejects exactly the same fixture corpus (LLD §6.3). Without that test this deviation would be the project's biggest silent-failure risk.

---

## §2 — Deviation: Google ADK is not used

**Decision.** No Google ADK (TypeScript) anywhere. The conversation orchestrator is LangGraph or Pydantic AI inside the Python agent; no LLM client of any kind exists in NestJS.

**Requirement.** Spec §9.1 names the orchestrator per deployment (`langgraph | pydantic-ai`) and FR-CONFIG-2 makes it an operator-visible config value. ADK is neither of those two values, so shipping it would either violate the config contract or add a third unused framework. Additionally, ADK-TS runs on Node — placing it in NestJS would put conversation LLM calls in the process the spec forbids from driving the media loop, and would create a second, competing AI boundary.

**Consequence.** The Nexus default "Google ADK for the AI framework" is replaced by "LangGraph *and* Pydantic AI, selectable per tenant." Both are behind `ILLMProvider` (LLD §7.1), so the orchestration choice never leaks into adapters or feature code.

---

## §3 — Deviation: the provider-agnostic AI boundary lives in Python

**Decision.** The §2-mandated registry is `apps/agent/src/avatar_agent/registry` with adapters in `adapters/`. `registry` is the only package that imports `adapters`; `adapters` is the only package that imports a vendor SDK. `orchestration` depends on `ports/` Protocols only. Enforced by `import-linter` contracts plus CI greps (LLD §3.5, §7.3).

**Requirement.** The AI subsystem *is* the Python process (§1). A TypeScript registry would be a registry for calls that never happen there. FR-PROVIDER-4 states the adapters are config-selected factories instantiated by the agent runtime, not the control plane.

**How the mandatory boundary properties are still met:**

| §2 rule | How it is satisfied here |
|---|---|
| No direct provider SDK import outside one registry module | `import-linter` `vendor-sdk-isolation` contract + CI grep; `orchestration` cannot even import `adapters` |
| Resolve by logical name, never a hardcoded vendor model id | `LogicalProviderKey` + `LogicalModelRole` enums (`conversation.primary`, `conversation.fallback`, `summary`). Concrete model ids come only from the tenant's published config (`llm.primary.model`, operator-owned per FR-LLM-1) or `AI_MODEL_*` env. A vendor model literal in code outside a fixture is a defect |
| Env-driven configuration | `AI_PROVIDER`, `AI_MODEL_CONVERSATION`, `AI_MODEL_SUMMARY`, `AI_BASE_URL`, `AI_API_KEY`, plus per-tenant `endpoint_url` + `credential_ref` overrides |
| On-prem is first-class (OpenAI-compatible `baseURL`) | `llm.openai-compatible` logical key wraps any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, internal gateway). The mechanism ships in v1 even though spec §7.2 defers an on-prem LLM *catalog entry* — so "point at a local model" is always an available operator remedy |
| Framework sits behind the registry | LangGraph / Pydantic AI live in `orchestration/`, reachable only via ports; feature code never calls them directly |
| Structured output via a typed schema, re-validated on return | Pydantic v2 models passed to the framework's structured-output facility and validated on the return path (`complete_structured`). Hand-parsing JSON from a free-text completion is prohibited and grep-checked |
| Fallback/retry when a provider is unreachable | FR-LLM-2 ladder in `orchestration/failover.py`: primary × `max_attempts` with `backoff_ms`, then fallback with the same policy, then degraded mode with the session still `active` (LLD §8.4) |

**Post-call summary — one owner, stated explicitly.** The **agent** generates the summary at session end and `POST`s it to `/internal/sessions/{id}/summary`; the control plane only reads it (HLD §7.3). Rejected alternative: a small NestJS port calling the Python registry over HTTP — it would add a second AI code path, a second residency derivation, and an HTTP hop, to reuse a provider the agent already holds instantiated with the correct residency snapshot. The chosen option keeps **exactly one** LLM call site in the entire product.

---

## §4 — Deviation: multi-container topology

**Decision.** Five containers in production: `web` (NestJS + both Angular bundles + BullMQ workers), `agent` (Python), `livekit` (upstream SFU), `postgres`, `redis`. Self-hosted GPU workers (Deepgram, faster-whisper, Fish Speech, bitHuman) are operator-provisioned outside this repo's images and addressed by `ProviderCredential.endpoint_url`. Two images are built here.

**Concrete requirements that force the split (recorded before splitting, per the guide):**

1. **Different runtimes.** `agent` is Python 3.12 with `livekit-agents`; `web` is Node 22. One image cannot be both without shipping a two-runtime container that must be scaled as a unit — which defeats requirement 3.
2. **LiveKit is a different process and a third-party binary.** Spec §9.2 / FR-TRANSPORT-1 require self-hosted LiveKit as the SFU. It is an upstream server binary with its own config and lifecycle; it is not something the application image can absorb.
3. **Independent scaling on unrelated signals.** `web` scales on HTTP concurrency and is stateless; `agent` scales on *concurrent sessions*, where each job holds a WebRTC connection plus four open streams for the session's lifetime, and must **drain** (finish in-flight conversations, accept no new dispatch) on deploy. NFR-2 requires that control-plane downtime not drop in-flight rooms — impossible if they share a process. NFR-7's 50-concurrent-session target sizes `agent` replicas by `ceil(sessions / MAX_CONCURRENT_JOBS)`, a number with no relationship to admin request volume.
4. **Different resource profiles.** The agent sits adjacent to NVIDIA GPU workers under NFR-1's millisecond budgets (STT first-partial < 400 ms, avatar first-frame < 400 ms); the control plane is I/O-bound CRUD. Co-locating them means a dashboard aggregate query competes with a real-time audio pipeline for the same CPU.

**What was *not* split, deliberately.** No per-provider service, no separate STT/TTS/avatar *application* services, no separate token service, no separate SPA host. The control plane stays one deployable (§5) and the ten provider adapters stay in-process in the agent, because a config-selected factory (FR-PROVIDER-4) is a function call, not a network boundary — turning each adapter into a service would add ten deployables and network hops inside a 3.0 s end-to-end budget for zero isolation benefit.

**Consequences.** `nexus-deploy` builds exactly two images and wires five services (compose for local/CI, Kubernetes for staging/production). Rolling deploys must migrate first (`prisma migrate deploy` as a pre-deploy Job), then `web`, then `agent` with graceful drain.

---

## §5 — Default kept: modular monolith control plane

One NestJS application, one Postgres schema, 19 modules with enforced boundaries (four layers each: `domain` / `application` / `infrastructure` / `interface`; cross-module imports only via a module's `index.ts`; ESLint `import/no-restricted-paths` zones — LLD §3.1, §3.4). The Python agent is a *second deployable*, not the start of a microservice fleet. No requirement in the spec forces independent deployment cadence or a compliance boundary between control-plane modules, so the microservices escape hatch is not taken.

---

## §6 — Data locality (explicit security decision, not left implicit)

| Hop | Where inference/processing runs | What crosses the tenant boundary |
|---|---|---|
| Transport (LiveKit) | on-prem, self-hosted | nothing |
| STT (Deepgram self-hosted / faster-whisper) | on-prem GPU | nothing — raw audio never leaves the cluster |
| LLM (OpenAI / Anthropic / Google) | **remote third-party API** | **text only** by default: system prompt + memory-window text + the current turn's final transcript (+ RAG text chunks) |
| TTS (Fish Speech) | on-prem GPU | nothing |
| TTS (ElevenLabs, optional) | remote | assistant reply text |
| Avatar (bitHuman) | on-prem GPU | nothing |
| Avatar (Alibaba LiveAvatar, optional) | remote / customer-hosted per vendor contract | TTS audio + rendered video round-trip |
| Post-call summary | in the agent, same provider and residency policy as the conversation | same as the conversation LLM |

**Enforcement.** `DataResidencyPolicy.send_to_remote_llm` defaults to `prompt_text_only` (FR-PRIV-1), is **snapshotted onto the session at start** so a mid-session change cannot widen an in-flight session (FR-PRIV-2), and is applied by a pure `build_payload` function whose `ResidencyPayload` result is the only type `ILLMProvider.complete_stream` accepts — an adapter physically cannot re-attach stripped content (LLD §8.5). `none` + a remote LLM is blocked at save (`CONFIG_RESIDENCY_BLOCKS_LLM`).

**Residual risk, accepted and surfaced.** Selecting ElevenLabs (TTS) or Alibaba LiveAvatar (avatar) moves audio/video off-prem, and the spec's residency control governs only the LLM hop. Mitigation is disclosure, not blocking: `hosting: remote` badges in the catalog and Agent Builder (FR-PROVIDER-6), documented feature gaps for LiveAvatar (FR-AVATAR-2), and the provider stack recorded in each session's snapshot. Tightening this into a hard save-time block would add a rule the spec does not define, so it is logged here rather than invented.

---

## §7 — Documented addition: two schema libraries, one per language

**TypeBox** is the single TypeScript schema library — NestJS request validation (via a `TypeBoxValidationPipe`), Angular Reactive Forms validation, env validation at bootstrap, and OpenAPI generation — chosen per the guide because this project has an AI subsystem. It replaces the NestJS CLI default (`class-validator` + `class-transformer`), which is a deliberate, guide-sanctioned deviation: one schema object per contract, shared by API and both SPAs through `packages/contracts`, is what makes the 11 screens' error semantics impossible to drift.

**Pydantic v2** is the single Python schema library — `AgentRuntimeConfig`, `/internal` request models, `pydantic-settings` for env, and structured LLM output. This is the Python analogue of §2's TypeBox rule (as §5.3 does for .NET with `JsonSchemaExporter`): one typed schema, validated on the return path, never hand-parsed JSON. It is recorded here as an explicit addition rather than a silent extra dependency.

**Drift control** is the CI contract test in LLD §6.3: TypeBox exports JSON Schema; a shared fixture corpus is run through both validators; disagreement fails the build. Two libraries are acceptable only because that test exists.

---

## §8 — Library decisions and §5.4 maturity checks

### 8.1 Stack A defaults kept without further comment

Prisma 7 (ORM) · Passport JWT + `@nestjs/jwt` (auth) · `@nestjs/swagger` (OpenAPI) · BullMQ + `@nestjs/bullmq` (jobs) · Pino via `nestjs-pino` (logging) · `@nestjs/config` with schema-validated env · Jest + Supertest (backend tests) · Angular Signals + NgRx SignalStore (state) · Angular Material (UI) · Reactive Forms · Jest + Web Test Runner (frontend unit) · Playwright (e2e). PostgreSQL and Redis as specified.

### 8.2 Deviations within Stack A

| Default | Chosen | Concrete requirement |
|---|---|---|
| `class-validator` + `class-transformer` | **TypeBox** | §7 above — AI subsystem present; one shared schema across API + both SPAs |
| Angular Material as the only UI kit | Material **only** (no PrimeNG) | Spec §1.2 excludes custom design language; screens are functional tables/forms/dropdowns. Material's accessibility record directly serves NFR-4 (WCAG 2.2 AA on all 11 screens) |
| One SPA per Angular app | **Two SPAs in one workspace** (`admin`, `conversation`) sharing a `shared` library | Screens 1–8 are admin-JWT authenticated; screens 9–11 are anonymous, public, and carry `livekit-client`. One bundle would ship admin code to anonymous users and admin routes to the public origin (NFR-3). Separate builds, one repo, one shared component library |

### 8.3 Additions requiring a §5.4 maturity check

| Library | Purpose | Maintained | License | Adoption | Verdict |
|---|---|---|---|---|---|
| `livekit-server-sdk` (Node) | Room create, token mint, agent dispatch | yes, tracks LiveKit releases | Apache-2.0 | official vendor SDK | Adopt — required by FR-AUTH-4 / FR-TRANSPORT-1 |
| `livekit-agents` + `livekit` (Python) | Agent worker + RTC | yes, active 1.x line | Apache-2.0 | official; the runtime the spec names | Adopt — mandated by §9.1 |
| `yaml` (eemeli) | Canonical YAML parse/emit | yes | ISC | de-facto Node YAML standard | Adopt — needed for FR-CONFIG-2 round-tripping with unknown-key detection; no unsafe loader |
| `@node-rs/argon2` | Argon2id password hashing | yes (napi-rs org) | MIT | widely used, prebuilt binaries | Adopt — NFR-3 allows Argon2id or bcrypt ≥12; Argon2id is the stronger option |
| `eslint-plugin-import` | `no-restricted-paths` module boundaries | yes | MIT | ubiquitous | Adopt — cheapest way to make LLD §3.1 boundaries mechanical. Chosen over `eslint-plugin-boundaries`/Nx tags to add no exotic dependency |
| `import-linter` | Python layer/vendor-isolation contracts | yes | BSD-2 | standard tool for this job in Python | Adopt — the only mechanical enforcement available for §3's registry rule |
| `langgraph` | Orchestration option A | yes, very active | MIT | large production adoption | Adopt — named by FR-CONFIG-2 |
| `pydantic-ai` | Orchestration option B | yes, active | MIT | growing, Pydantic-team backed | Adopt — named by FR-CONFIG-2. Younger than LangGraph; pin the minor version and keep it behind `ILLMProvider` so churn cannot reach feature code |
| `faster-whisper` | Self-hosted STT | yes | MIT | widely deployed | Adopt — FR-STT-2 |
| `bithuman` runtime / Alibaba LiveAvatar client | Avatar adapters | vendor-controlled; **the least mature dependencies in the stack** | vendor terms | vendor-specific | Adopt with a flag: both are named in v1 by FR-AVATAR-1/2. Pin versions deliberately, keep each behind `IAvatarProvider`, and treat "missing lip-sync or LiveKit publish" as a blocker (FR-AVATAR-2), not an accepted gap. These carry the highest schedule risk in the project |
| `uv` | Python dependency management | yes (Astral) | MIT/Apache-2.0 | broad adoption | Adopt — lockfile committed; `pip`+`requirements.txt` remains a fallback if CI friction appears |
| `ruff`, `mypy`, `pytest`, `pytest-asyncio`, `respx`, `structlog`, `httpx` | Python lint/types/tests/logs/HTTP | yes | MIT/BSD/Apache | standard | Adopt |
| `@axe-core/playwright` | Automated accessibility gate | yes (Deque) | MPL-2.0 | standard | Adopt — NFR-4 is a measurable acceptance criterion |
| `@testcontainers/postgresql` | Real-Postgres integration tests | yes | MIT | standard | Adopt — the tenant-isolation negative suite must run against real SQL, not a mock |

Nothing on this list fails a §5.4 criterion. The two vendor avatar runtimes are the only entries whose maturity is outside our control, and they are flagged accordingly rather than silently added.

### 8.4 Deviation: pnpm workspaces instead of Nx

**Requirement.** The repo holds three heterogeneous apps, one of which is Python. Nx would manage the two TypeScript apps well and the Python app not at all, so the build graph would be split regardless. pnpm workspaces + Angular CLI + Nest CLI + `uv` keeps each toolchain canonical (crucially: `nexus-dev` can follow stock NestJS and Angular documentation with no Nx-specific translation), at the cost of Nx's affected-graph caching — irrelevant at three apps. Module boundaries, which are Nx's other selling point, are enforced by ESLint zones and `import-linter` instead (LLD §3.4, §3.5).

---

## §9 — Isolation and persistence decisions

**Row-level `tenant_id` + LiveKit room namespaces**, locked by spec §9.1. Alternatives (schema-per-tenant, database-per-tenant) are compared in HLD §4.2 and explicitly excluded from v1 by spec §9.4.

**Deferred hardening: Postgres RLS.** Enforcement in v1 is a Prisma client extension (`tenantGuard`) that throws on any tenant-scoped query lacking a `tenant_id` filter, plus an `AsyncLocalStorage` tenant context, the `404`-not-`403` response policy, room-locked LiveKit grants, and a mandatory cross-tenant negative test suite (HLD §4.1). Row-Level Security policies keyed on `current_setting('app.tenant_id')` would add a database-level backstop, but require a `SET LOCAL` on every transaction through a pooled connection — real operational risk for coverage the extension already provides at the only layer that can produce the bug (application query construction). Recorded as a deferred hardening option, not a silent omission.

**PostgreSQL, not NoSQL**, because the spec's data model is 18 entities with dense FKs, multi-field uniqueness constraints stated as *validation errors*, transactional multi-row invariants (tenant creation, config publish), optimistic locking on `updated_at`, and aggregate/percentile reporting (HLD §6). Transcript search uses a Postgres GIN index on a generated `tsvector` — no separate search engine at v1 volumes.

**REST, not GraphQL**, because §4 of the spec pins HTTP status codes, a single error envelope, `Idempotency-Key`, and `If-Match` concurrency — all HTTP-native and all of which GraphQL would force us to re-specify (HLD §7.1).

---

## Consequences

**Positive.**

- Each half of the product is written in the language its ecosystem actually lives in, and scales on its own signal; control-plane deploys cannot drop live conversations (NFR-2), and conversation load cannot slow the admin API.
- Exactly one LLM call site exists in the entire system, behind one registry, one residency filter, and one structured-output mechanism — which is what makes FR-LLM-3 / FR-PRIV-2 auditable by grep rather than by inspection.
- Provider swapping is genuinely configuration-only (FR-PROVIDER-4), so the Example A / Example B abstraction proof in §8 of the spec is a test, not a refactor.
- Both v1 avatar adapters, both STT options, both TTS options, and all three LLM vendors plug into the same four Protocol classes; adding an eleventh provider is one file in `adapters/` plus one registry entry.

**Negative, and how each is contained.**

| Cost | Containment |
|---|---|
| Two languages, two CI lanes, two dependency ecosystems | One shared contract with a cross-language CI conformance test (LLD §6.3); the `/internal` API is the only runtime coupling |
| The YAML/runtime-config schema can drift between TypeBox and Pydantic | The fixture-corpus contract test fails the build on any disagreement — this is the single most important test in the repo |
| Five services to run locally | `deploy/` ships a one-command docker-compose with stub adapters so screens 1–10 are developable without GPUs |
| Vendor avatar runtimes (bitHuman, Alibaba LiveAvatar) are the least mature dependencies and the highest schedule risk | Both behind `IAvatarProvider`; version-pinned; BL-018 and BL-019 are separate backlog phases so a vendor problem is isolated to one phase rather than blocking the platform |
| Row-level isolation means one missing `WHERE` clause is a data breach | Five defence layers plus a mandatory negative suite (HLD §4.1); RLS remains available if audit requirements grow |
| The agent buffers telemetry when the control plane is down | Bounded in-memory buffer with retry; on overflow the conversation continues and the drop is logged — telemetry loss is preferred over dropping a live call, and this trade-off is deliberate |

---

## Open architectural questions

None blocking. The spec's §9.5 declares no open product questions, and no architectural decision in this record was left to `nexus-dev`. Two items are logged for future revision rather than resolution now:

1. **Postgres RLS** as defence-in-depth if a compliance requirement later demands database-level isolation (§9).
2. **A residency control for `remote` TTS/avatar providers** if off-prem audio/video ever needs to be blocked rather than merely disclosed (§6). Defining it now would mean inventing a requirement the spec does not state.
