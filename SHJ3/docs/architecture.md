# SHJ3 — Architecture

> Status: **Accepted** · Last updated: 2026-09-08
> Decisions here are binding. Each is backed by an ADR in [`adr/`](./adr/). Changing one means writing a new ADR, not editing this file in place.

---

## 1. What SHJ3 is

An agentic government-services assistant for the Emirate of Sharjah, plus the backoffice that builds, governs and operates it.

Two audiences, two very different surfaces:

| Audience | Surface | Screens |
|---|---|---|
| **Citizens / residents** | Assistant widget on the Sharjah portal, and WhatsApp | 3 |
| **Government staff** | Backoffice: agent authoring, knowledge, operations, governance | 14 |

The functional baseline is [`SHJ3-wireframes-guide.md`](./SHJ3-wireframes-guide.md); the validated requirements derived from it are in [`requirements/`](./requirements/README.md).

---

## 2. Architecture style

**Modular monolith, spanning two runtimes.**

The chosen style is a modular monolith: enforced module boundaries inside a single deployable. The chosen stack, however, is polyglot — TypeScript for the web tier, Python for the agent runtime — so "single deployable" is not literally achievable. The resolution recorded in [ADR-0001](./adr/0001-modular-monolith-across-two-runtimes.md):

> There are exactly **two** deployables, split along a language boundary that is also a real operational boundary. Inside each, module boundaries are enforced as strictly as they would be in a single-process monolith. Two is not microservices, and the split is not permitted to grow without an ADR.

```
                         ┌──────────────────────────────────────┐
   Citizen (web)  ─────▶ │                                      │
   Citizen (WhatsApp) ─▶ │      shj3-web  (Next.js, Node 22)    │
   Staff (backoffice) ─▶ │      web UI + BFF + config API       │
                         │                                      │
                         └───────────────┬──────────────────────┘
                                         │ internal HTTP (mTLS in-cluster)
                                         │ + SSE for token streaming
                         ┌───────────────▼──────────────────────┐
                         │                                      │
                         │      shj3-ai  (FastAPI, Python 3.12) │
                         │      agent runtime + Graph RAG        │
                         │                                      │
                         └──────────────────────────────────────┘
```

### Why the boundary sits there

It is not an arbitrary language split. The two sides have genuinely different operational profiles:

| | `shj3-web` | `shj3-ai` |
|---|---|---|
| Workload | Request/response, sub-100 ms, CPU-light | Long-running, multi-second, token-streaming |
| Scaling driver | Concurrent staff + page views | Concurrent conversations + re-index jobs |
| Failure blast radius | A screen 500s | Conversations degrade to fallback |
| Deploy cadence | High (UI changes) | Lower (runtime changes are riskier) |
| Resource shape | Memory-light, no GPU | Memory-heavy, GPU-adjacent (embeddings) |

Putting a 90-second Graph RAG re-index in the same process as the backoffice UI would make one starve the other. That is the justification, and it is the only one accepted.

### What is explicitly forbidden

- A third deployable without a new ADR.
- `shj3-web` reaching into Neo4j or Qdrant. Those stores belong to `shj3-ai`.
- `shj3-ai` writing to SQL Server tables it does not own (see §6).
- Any module importing another module's internals rather than its public port.

---

## 3. Module map

Sixteen modules, derived from the 17 wireframe screens plus the two mandatory in-product modules (theming, user guide) and the tenancy substrate.

| # | Module | Owns | Runtime | Wireframe screens |
|---|---|---|---|---|
| 1 | `platform` | Tenant registry, provisioning, schema migration, config resolution | web | — (substrate) |
| 2 | `iam` | Users, teams, roles, the 7×9 permission matrix, sessions | web | B9 |
| 3 | `conversation` | Sessions, turns, transcripts, feedback, suggestion chips | web + ai | A1, A2, A3 |
| 4 | `agents` | Agent records, versions, lifecycle, wizard state, clone/rollback | web | B2, B3 |
| 5 | `orchestration` | Router, execution modes, hop/cost ceilings, merge policy, traces | **ai** | B4 |
| 6 | `tools` | Skills catalogue, MCP servers, API connectors, circuit breakers | web (config) + ai (execution) | B3.4, B5 |
| 7 | `knowledge` | Sources, ingestion, entity graph, retrieval tuning, conflicts, re-index | **ai** | B6 |
| 8 | `flows` | Flow definitions, nodes, free-text escape, handover triggers | web (author) + ai (execute) | B7 |
| 9 | `handover` | Escalation queue, agent presence, routing rules, canned replies, tester | web | B8 |
| 10 | `channels` | Channel config, widget studio, WhatsApp/BSP, templates, campaigns, locales | web | B10 |
| 11 | `verification` | Verification providers, step-up rules, identity stitching | web | B11.1, B11.2, B11.5 |
| 12 | `payments` | Gateways, transactions, receipts, refunds | web | B11.3, B11.4 |
| 13 | `governance` | Policies, per-agent overrides, environments, promotions, audit log, privacy | web (config) + ai (enforce) | B12, B14 |
| 14 | `evaluation` | Golden sets, regression runs, publish gate | web (config) + ai (execute) | B13 |
| 15 | `analytics` | Metrics, conversation explorer, feedback queues, knowledge gaps | web | B1 |
| 16 | `theming` | Design tokens, skins, tenant branding, import/export | web | Phase E |
| 17 | `userguide` | Guide entries, screenshots, search, deep links | web | Phase F |

### Module dependency rules

Modules form a layered dependency graph. An arrow means "may depend on"; the reverse is a violation caught in review and by the import linter.

```
      ┌─────────────────────────────────────────────────┐
      │  feature modules                                │
      │  conversation  agents  knowledge  flows  tools  │
      │  handover  channels  verification  payments     │
      │  evaluation  analytics  theming  userguide      │
      └───────────────┬─────────────────────────────────┘
                      │
      ┌───────────────▼─────────────────────────────────┐
      │  cross-cutting     governance      iam          │
      └───────────────┬─────────────────────────────────┘
                      │
      ┌───────────────▼─────────────────────────────────┐
      │  substrate         platform                     │
      └─────────────────────────────────────────────────┘
```

- A feature module **may not** import another feature module directly. Cross-feature work goes through a published port or a domain event.
- `governance` and `iam` are cross-cutting: every feature module may call them, never the reverse.
- `platform` depends on nothing. Everything may depend on it.
- Enforced mechanically by `eslint-plugin-boundaries` (web) and `import-linter` (ai). CI-less for now, so these run in pre-commit — see [`deployment.md`](./deployment.md).

---

## 4. Layering inside a module

Every module — in both runtimes — has the same four-layer shape. This is what makes the business logic agnostic of framework, database, cloud and UI library, per the project's non-negotiable rules.

```
modules/knowledge/
├── domain/          pure business logic. no imports from outside domain/.
│   ├── entities/        Source, GraphNode, RetrievalConfig, SourceConflict
│   ├── value-objects/   ChunkSize, HybridWeighting, GroundingConfidence
│   └── services/        ConflictResolutionPolicy, RetrievalPlanner
├── ports/           interfaces the domain needs. no implementations.
│   ├── SourceRepository        (persistence)
│   ├── GraphStore              (Neo4j, abstracted)
│   ├── VectorStore             (Qdrant, abstracted)
│   ├── EmbeddingProvider       (OpenAI, abstracted)
│   └── Reranker                (Cohere, abstracted)
├── application/     use cases. orchestrates domain + ports. no vendor imports.
│   └── AddSource, ReindexSource, ResolveConflict, RunRetrieval
└── adapters/        the only layer allowed to import a vendor SDK.
    ├── inbound/         FastAPI routers / Next.js route handlers
    └── outbound/        Neo4jGraphStore, QdrantVectorStore, OpenAIEmbedder,
                         CohereReranker, SqlAlchemySourceRepository
```

The rule that gives this teeth: **`domain/` and `application/` contain zero vendor imports.** No `neo4j`, no `qdrant_client`, no `openai`, no `@prisma/client`, no `next/*`. Grep for them there and the answer must be empty. That is the swap test — replacing Qdrant with pgvector, or OpenRouter with Bedrock, must not touch a domain file.

`ports/` is where the four stores stop being four stores and become four interfaces.

---

## 5. Multi-tenancy

**Schema-per-tenant**, with per-tenant isolation carried into every store. Recorded in [ADR-0002](./adr/0002-schema-per-tenant-isolation.md).

A "tenant" is a Sharjah government entity: SEWA, Sharjah Customs, Sharjah Libraries, Platform.

| Store | Isolation unit | Resolution |
|---|---|---|
| SQL Server | **Schema per tenant** — `sewa.Agents`, `customs.Agents` | Prisma client bound to a schema at request scope |
| Neo4j | **Logical partition** — label `:Tenant_sewa` + `tenant_id` property | Community edition; mandatory tenant-aware query builder ([ADR-0009](./adr/0009-logical-graph-partitioning.md)) |
| Qdrant | **Collection per tenant** — `sewa_knowledge` | Collection name derived from tenant, never from user input |
| Redis | **Key prefix** — `sewa:session:…` | Prefixed client wrapper; raw client is not exported |

**The graph is the exception, and it is a real one.** No Neo4j Enterprise licence was available, so database-per-tenant is not implementable and [ADR-0009](./adr/0009-logical-graph-partitioning.md) amends ADR-0002 for that store alone. Three of four stores are defended by infrastructure; the graph is defended by code — a dual encoding (label *and* property), a query builder that makes unscoped Cypher unwritable, a static check banning raw Cypher outside the adapter, and a post-retrieval re-filter. Community also has no RBAC, so unlike SQL Server there is no database-level second line. This is tracked for the life of the system as **RISK-024**, not as an open decision.

### How isolation is enforced

Not by remembering to add a filter. Isolation lives in one place per runtime, below the application layer:

1. **Request enters** → middleware resolves the tenant from the authenticated principal (never from a header, query param or body the caller controls).
2. **Tenant context is bound** to the request scope — `AsyncLocalStorage` in Node, `contextvars` in Python.
3. **Data-access layer reads that context** and produces store handles already scoped to the tenant. There is no unscoped handle to obtain.
4. **The unscoped clients are not exported.** `getPrismaClient()` does not exist. Platform-global data goes through `getPlatformDb()`. Tenant-scoped SQL data goes through `getTenantDb()`, one Prisma Client per tenant built from **`prisma/tenant/schema.prisma`** — a separate schema file from platform's, deliberately not using Prisma's `multiSchema` feature ([ADR-0011](./adr/0011-split-platform-and-tenant-prisma-schemas.md) — see the note below for why the file split matters). Graph, vector and cache each have their own tenant-scoped handle, following the same rule: no unscoped client is ever reachable.

A use case therefore *cannot* express a cross-tenant query — the vocabulary for it is absent. That is the design intent: isolation is a property of the type system and module structure, not of developer discipline.

**Why two Prisma schema files, not one.** `getTenantDb()` is "one Prisma Client per tenant, differing only in the connection string's `schema=` parameter" — exactly as originally designed, and this mechanism is proven correct directly against a live database, for both reads and writes. What does **not** work is combining it with Prisma's `multiSchema` preview feature: `multiSchema`'s `@@schema()` attribute resolves to a literal schema name at `prisma generate` time, not per connection at runtime, so a *unified* schema file using `multiSchema` for both `platform` and `tenant_template` would silently emit identical SQL against the literal `tenant_template` schema regardless of which tenant a client was built for — a defect found and confirmed before any feature code depended on it (ADR-0010), then narrowed to its real cause and fixed by splitting the schema in two (ADR-0011) rather than by abandoning the ORM. The cost is five relationships that cross the platform/tenant boundary in the data model — Prisma cannot express a `@relation` across two separate generated clients, so those five become plain foreign-key fields joined in application code; every other tenant model keeps full ORM ergonomics. Read ADR-0011 before touching tenant-scoped SQL access or the Prisma schema files.

Two escape hatches exist, both deliberate and both audited: platform-level administration (tenant provisioning) and cross-tenant analytics rollups. Each lives in `platform`, requires the `Super Admin` role, and writes to the audit log.

**Required test:** `tenant-isolation.spec` proves that a principal scoped to tenant A cannot read, write, retrieve or embed against tenant B — exercised across all four stores, including a direct attempt to forge the tenant in a request payload. A requirement with no passing test is an incomplete requirement, and this one gates every release.

---

## 6. Data ownership

Four stores, each with exactly one job. Recorded in [ADR-0003](./adr/0003-polyglot-persistence.md).

| Store | Role | Written by | Read by |
|---|---|---|---|
| **SQL Server** | System of record. All configuration, all records, all audit. | `shj3-web` (Prisma) | both |
| **Neo4j** | Knowledge graph — entities and relationships for Graph RAG | `shj3-ai` | `shj3-ai` |
| **Qdrant** | Vector index — chunk embeddings for hybrid retrieval | `shj3-ai` | `shj3-ai` |
| **Redis** | Ephemeral: chat sessions, circuit-breaker state, rate limits, campaign queue | both | both |

### The schema-ownership rule

**Prisma owns the SQL Server schema. Alembic does not exist in this project.**

`shj3-web` declares the schema and runs migrations. `shj3-ai` reads the same tables through SQLAlchemy models that are *generated* from the Prisma schema, never hand-written. Drift between the two is impossible because the generation step is checked in pre-commit: regenerate, and the diff must be empty.

`shj3-ai` has write access to exactly three table groups — conversation turns, orchestration traces, and re-index job status. Everything else is read-only to it, enforced at the database-user level, not just in code.

Rationale: two migration tools pointed at one database is the single most reliable way to corrupt a schema. One owner, generated consumers.

---

## 7. The agent runtime

`shj3-ai` is where the brief's agentic requirements live.

```
POST /v1/conversations/{id}/turns
        │
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 1. Guardrail pre-check      governance module           │
  │    prompt-injection filter, scope restriction           │
  ├─────────────────────────────────────────────────────────┤
  │ 2. Route                    orchestration module        │
  │    intent → agent(s) + confidence                       │
  ├─────────────────────────────────────────────────────────┤
  │ 3. Execute                  ADK, one of three modes     │
  │    sequential │ parallel │ supervisor–worker            │
  │      ├── tool calls      tools module (MCP + API)       │
  │      ├── retrieval       knowledge module (Graph RAG)   │
  │      └── flow state      flows module (slots, escape)   │
  ├─────────────────────────────────────────────────────────┤
  │ 4. Merge                    conflict + overlap policy   │
  ├─────────────────────────────────────────────────────────┤
  │ 5. Guardrail post-check     governance module           │
  │    grounding threshold, PII masking, refusal            │
  ├─────────────────────────────────────────────────────────┤
  │ 6. Stream + persist         turn, trace, sources        │
  └─────────────────────────────────────────────────────────┘
```

Steps 1 and 5 are not optional and not per-agent. They are the platform floor from B12 — a locked policy cannot be toggled by any role, so the check is structural, not configurable.

### Model access

**OpenRouter, reached through LiteLLM.** Recorded in [ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md).

| Concern | Choice | Why |
|---|---|---|
| Chat / reasoning | OpenRouter via LiteLLM | One key, one bill, model is configuration. Primary and fallback model per agent (B3 step 3) become config rows, not code. |
| Embeddings | OpenAI `text-embedding-3-large` | OpenRouter serves no embeddings endpoint. Matches the model already named in the spec; strong Arabic. |
| Reranking | Cohere `rerank-v3.5` | The reranker toggle in B6 tab 3 needs a real implementation. Multilingual. |

All three sit behind ports — `ChatModel`, `EmbeddingProvider`, `Reranker`. The domain never learns which vendor answered.

**Open risk:** embeddings and reranking send citizen text to OpenAI and Cohere, which conflicts with the *UAE — Sharjah data centre* residency default in B14 tab 4. This is tracked as **RISK-001** in [`requirements/risks.md`](./requirements/risks.md) and needs either a documented residency exception or a swap to the self-hosted BGE-M3 path. The port abstraction is what keeps that swap cheap.

---

## 8. Canonical data flow

The brief's worked example, traced through the architecture. Every screen is fed by this one journey, so it is the reference path for design and for tests.

```
Pay Utilities Bills → SEWA → account number → "i have another inquiry"
```

| Step | What happens | Modules | Stores |
|---|---|---|---|
| Citizen opens widget | Channel config + theme + chips resolved | `channels`, `theming`, `conversation` | SQL Server |
| Taps "Pay Utilities Bills" | Turn posted; guardrail pre-check | `conversation`, `governance` | Redis (session) |
| Router picks billing agent (0.94) | Confidence recorded on the trace | `orchestration` | SQL Server (trace) |
| Agent calls `list_service_centres()` | MCP tool, breaker consulted first | `tools` | Redis (breaker) |
| Knowledge confirms 3 providers | Hybrid retrieval, 60/40 graph/vector, reranked | `knowledge` | Neo4j + Qdrant |
| Asks for SEWA account number | Slot `account_number` opened | `flows` | Redis |
| Slot triggers payment intent | Step-up rule: verified identity + OTP **before** the tool call | `verification` | SQL Server |
| Citizen types "another inquiry" | Free-text escape; context preserved, router re-evaluates | `flows`, `orchestration` | Redis |
| Tool failed twice earlier | Handover node fires; ticket carries the reason | `handover` | SQL Server |
| Payment settles | Transaction recorded, 7-year retention | `payments` | SQL Server |
| Conversation flagged 👎 | Enters the feedback queue → golden set | `analytics`, `evaluation` | SQL Server |

The last three rows are the point of the whole design: the conversation, the escalation, the transaction and the test case are the same event seen from four modules — not four features that happen to coexist.

---

## 9. Frontend architecture

Next.js App Router, TypeScript, shadcn/ui + Tailwind. Recorded in [ADR-0007](./adr/0007-design-system-and-runtime-theming.md).

```
app/
├── (assistant)/        citizen surface — SSR, public, minimal JS
│   └── widget/             embeddable; renders inside sharjah.ae
├── (backoffice)/       staff surface — authenticated, RBAC-gated
│   ├── command-centre/     B1
│   ├── agents/             B2, B3
│   ├── orchestrator/       B4
│   ├── tools/              B5
│   ├── knowledge/          B6
│   ├── flows/              B7
│   ├── handover/           B8
│   ├── iam/                B9
│   ├── channels/           B10
│   ├── identity/           B11
│   ├── guardrails/         B12
│   ├── evaluation/         B13
│   ├── governance/         B14
│   └── settings/appearance/  Phase E
├── (help)/             Phase F — user guide, deep-linkable
└── api/                BFF route handlers
```

| Concern | Approach |
|---|---|
| Rendering | Assistant widget SSR for first paint inside the portal; backoffice is client-rendered behind auth, since it is all interactive tables and editors |
| State | Server Components for reads; TanStack Query for mutations and polling; no global client store — the wireframe's cross-module wiring is server state, not client state |
| Forms | React Hook Form + Zod. The same Zod schemas validate in the route handler, so validation is declared once |
| RBAC | Permission checks in the route handler *and* the component tree. The server check is the real one; the client check only hides what the user cannot use |
| Theming | Runtime CSS custom properties. No hardcoded color, spacing, radius or font size in feature code — enforced by a Tailwind lint rule that fails on arbitrary values |
| i18n | `next-intl`, EN + AR, with `dir="rtl"` driven by locale. Logical CSS properties throughout (`padding-inline`, not `padding-left`) |
| A11y | WCAG 2.1 AA. Radix primitives supply keyboard and ARIA behaviour; contrast is validated at theme-save time, not by hand |

---

## 10. Cross-cutting concerns

| Concern | Where it lives | Note |
|---|---|---|
| **Tenant isolation** | Data-access layer, both runtimes | §5. Not a per-query responsibility. |
| **Authorization** | `iam` module, checked in every inbound adapter | 7 roles × 9 permissions from B9 (8 in the original wireframe, plus `appearance:manage`). Deny by default. |
| **Audit** | `governance`, written by an interceptor | Config changes, publishes, permission grants, data exports. Append-only — no update or delete grant exists on the table, for any role. |
| **Guardrails** | `governance`, enforced in the runtime pipeline | Locked policies are structural; only unlocked ones read config. |
| **PII masking** | Applied before persistence, not on read | A transcript is never stored unmasked, so a later bug cannot leak it. |
| **Observability** | OpenTelemetry across both runtimes | One trace id spans web → ai → tool call, which is what makes B14 tab 3 real rather than decorative. |
| **Circuit breakers** | `tools`, state in Redis | Shared across replicas — a breaker tripped on one pod is tripped on all. |
| **Secrets** | Environment only, via K8s secrets | Never in code, never in `docs/`. Config is validated at boot and the process refuses to start if a required secret is absent. |

---

## 11. Authentication

**Local accounts now, SSO later — behind a port from day one.** Recorded in [ADR-0006](./adr/0006-identity-behind-a-port.md).

Two distinct identity problems, deliberately kept apart:

| Principal | Now | Later |
|---|---|---|
| **Staff** (backoffice) | Email + password (Argon2id) + TOTP, sessions in Redis | Entra ID or Keycloak via OIDC |
| **Citizen** (assistant) | Anonymous by default; mock verified identity for testing step-up | UAE PASS via OIDC — verified name, Emirates ID hash, mobile |

Both sit behind `IdentityProvider` and `VerificationProvider` ports. The mock citizen adapter is not a shortcut — it is what makes B11's step-up rules and the four assurance levels testable before UAE PASS credentials are issued. The tests written against the mock are the same tests that will validate the real adapter.

---

## 12. Deployment shape

Docker + Compose for local and staging parity, Helm for production. No CI/CD yet. See [`deployment.md`](./deployment.md).

```
Kubernetes namespace: shj3-{env}
├── shj3-web        Deployment · HPA on CPU · 2+ replicas
├── shj3-ai         Deployment · HPA on concurrency · 2+ replicas, larger limits
├── shj3-worker     Deployment · ingestion, re-index, campaigns
├── sqlserver       StatefulSet (dev) / managed instance (prod)
├── neo4j           StatefulSet · Community, single instance (no HA — derived store, rebuildable)
├── qdrant          StatefulSet
└── redis           StatefulSet / managed
```

Environments mirror B14 tab 1 — Development → UAT → Production — so the promotion flow in the product matches the promotion flow in the pipeline. That symmetry is intentional: the screen is not a simulation of an ops process that works differently in reality.

**Gap being carried knowingly:** no CI/CD was selected, so nothing enforces lint, typecheck and tests on a shared branch. Mitigation is pre-commit hooks plus `pnpm verify` / `make verify` as the single command a reviewer runs. This is logged as **RISK-002**; it is a real weakening of the project's own quality rules and should be revisited before more than one person commits.

---

## 13. Decision log

| ADR | Decision |
|---|---|
| [0001](./adr/0001-modular-monolith-across-two-runtimes.md) | Modular monolith across two runtimes |
| [0002](./adr/0002-schema-per-tenant-isolation.md) | Schema-per-tenant, carried into all four stores — *graph row amended by 0009* |
| [0003](./adr/0003-polyglot-persistence.md) | Four stores, one schema owner |
| [0004](./adr/0004-llm-gateway-and-retrieval-models.md) | OpenRouter for chat, OpenAI for embeddings, Cohere for rerank |
| [0005](./adr/0005-prisma-owns-schema-sqlalchemy-reads.md) | Prisma owns the schema; SQLAlchemy models are generated |
| [0006](./adr/0006-identity-behind-a-port.md) | Local auth now, SSO later, port from day one |
| [0007](./adr/0007-design-system-and-runtime-theming.md) | shadcn/ui + Tailwind with runtime CSS-variable tokens |
| [0008](./adr/0008-deployment-targets.md) | Docker, Compose, Helm; no CI/CD yet |
| [0009](./adr/0009-logical-graph-partitioning.md) | Logical graph partitioning on Neo4j Community — amends 0002 |
| [0010](./adr/0010-raw-sql-for-tenant-runtime-queries.md) | Raw schema-qualified SQL for tenant-scoped runtime queries — **superseded by 0011 the same day** |
| [0011](./adr/0011-split-platform-and-tenant-prisma-schemas.md) | Split platform and tenant Prisma schemas, drop `multiSchema` — supersedes 0010, amends 0005 |
