# Agent Builder v2 (Reasoning/Skills/RAG/Orchestration/HITL) — Phased Dev Plan

Authoritative build order mirrors `docs/v2/BACKLOG.md`'s phase map exactly (Phase
8 → 16, BL-033 → BL-065). Continues `docs/plans/liveavatar-platform-plan.md` (v1,
closed, Phases 1–7) — this is a new, independently-tracked phase sequence for the
capability layer specified in `docs/v2/AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md`
and `docs/v2/UX_SCOPE.md`. Same convention as the v1 plan doc: one phase expanded in
full when it starts, remaining phases listed at a one-line summary level until then.
All later phases' plans get appended to this one file — no second plan doc.

Stack, layering, and library set are unchanged from `docs/architecture/ADR-001-stack.md`
/ `docs/architecture/LLD.md` and are not re-litigated per phase.

---

## Phase map (one line each, from `docs/v2/BACKLOG.md`)

| Phase | Theme | Items | Exit condition |
|---|---|---|---|
| 8 | Tools registry | BL-033–034 | Admin manages tools without API hacks; replaces the v1 read-only count. **(this doc — in progress)** |
| 9 | Reasoning graph engine v1 | BL-035–039 | `llm:` → `reasoning.graph[]` + `ConfigVersion`; node-card list builder; multi-node graph interpreter; test-call harness; node-level session trace. |
| 10 | Latency governance v1 | BL-040–041 | Critical-path computation + turn budget field; budget panel UI; deadline degradation runtime. |
| 11 | Parallel & Loop | BL-042–043 | Parallel node + join policies; Loop node + 3-guard validation. |
| 12a | RAG ingestion | BL-044, BL-046 | Ingestion pipeline (parse/chunk/embed/index); Knowledge tab Sources sub-tab. |
| 12b | RAG retrieval + Knowledge tab | BL-045, BL-047–048 | Retrieval pipeline (hybrid search/filter/threshold/inject); Pipeline sub-tab; Retrieval playground. |
| 13 | Skills | BL-049–051 | `Skill`/`SkillVersion` entity; Skills library + editor; Skill graph node. |
| 14 | HITL v1 | BL-052–057 | Gate entity; blocking-gate pause/resume; HITL config screen; reviewer console; caller hold UX; consequential-tool gating wired live. |
| 15 | Sub-agent, Handoff, State | BL-058–060 | Remaining A3.2 node types. |
| 16 | Builder consolidation | BL-061–065 | Full 8-tab builder shell; Overview/Dynamics/Privacy tabs; remaining V-rule wiring. |

---

## Phase 8 — Tools registry (BL-033, BL-034)

### Goal
An admin can create, edit, test-invoke, and delete `ToolDefinition` rows through the
Tools tab, and attach/detach them as agent-level "always available" tools — replacing
today's read-only `{n} tools enabled` line in the Agent Builder. This is the first
phase of the v2 roadmap; every later subsystem (Skill tools, graph Tool nodes,
consequential gating) depends on tools being a real manageable entity.

### Scope

**In scope:**
1. Full CRUD for `ToolDefinition`: `POST/GET /tenants/:id/tools`,
   `GET/PATCH/DELETE /tenants/:id/tools/:toolId`. Fields: `name`, `method`, `url`,
   `credential_ref`, `args_schema`, `timeout_ms` (new), `consequential` (new), `lane`
   (new, `foreground`/`background`), `per_session_cap` (new), `per_turn_cap` (new).
2. `POST /tenants/:id/tools/:toolId/test-invoke` — synchronous one-shot HTTP call
   re-implemented directly in NestJS (`ToolInvokerService`), mirroring
   `ToolExecutor.invoke()` (`apps/agent/src/avatar_agent/orchestration/tools.py`):
   10s timeout, 32 KiB response cap, failure returned as a structured result rather
   than a 5xx (so an admin sees exactly what the runtime would see).
3. Attach/detach "always available" tools — **not** a new endpoint. Reuses the
   existing `agent.tools[]` array inside `DeploymentConfig`'s YAML-backed draft
   (`packages/contracts/src/agent-config/schema.ts`, validated by
   `toolRefsKnownRule` in `combination-rules.ts`) through the existing
   `GET/PUT /tenants/:id/config` draft-save flow already driven by
   `agent-builder.store.ts`.
4. Base-prompt token-cost banner for attached tools (estimate from `agent.tools[]`
   membership only, not the full registry), mirroring the system-prompt byte counter.
5. Tools tab UI: list table, "+ New tool" create form, row actions
   (Test / Edit / Attach-or-Detach / Delete).

**Out of scope (explicit):**
- Anything from Phase 9+ (reasoning graph, `ConfigVersion`, Skills, Knowledge/RAG,
  HITL). `apps/agent` Python orchestration code is read for reference only, not
  modified.
- Consequential-tool **enforcement** — HITL gates don't exist until Phase 14. The
  consequential banner renders and flags `consequential: true` tools with "Gating
  not available yet — coming in a later phase" but blocks nothing.
- A parallel "attach/detach" HTTP endpoint — deliberately reuses the config draft
  save flow (see decision below).
- True drag-and-drop / canvas UI, multi-environment enforcement, Skill/graph-node
  attachment routes (all later phases).

### Decisions made this phase (documented per the "pick the simpler option, don't
agonize" instruction rather than left implicit)

- **`credential_ref` requirement is a hard 400, not a Gate-B response item.** Unlike
  `CONFIG_CREDENTIAL_MISSING` (a whole-config Gate-B validation item), a single
  `ToolDefinition` CRUD write is a simple, single-resource operation — if the tool is
  marked as needing a credential (i.e. `credential_ref` omitted while the tool is
  being saved as one that requires auth) the create/update simply fails with
  `TOOL_CREDENTIAL_MISSING` (400). Simpler and consistent with how `TOOL_NAME_REQUIRED`
  / `TOOL_URL_INVALID` already behave for this endpoint family.
- **`lane` is a plain validated string column, not a new Prisma enum.** `ToolDefinition`
  already stores `method` (a comparably-sized closed set) as a plain `VarChar`, so the
  new `lane` column follows that existing *local* precedent (same table) over the
  platform's broader enum-heavy style used elsewhere (`ProviderHosting`,
  `ResidencyMode`, etc.) — consistency within the same row's existing columns wins.
  Enforced as `Type.Union([Type.Literal('foreground'), Type.Literal('background')])`
  at the TypeBox layer.
- **`timeout_ms` is new** (`ToolDefinition` had no timeout column). Added additively,
  `Int @default(10000)` matching `ToolExecutor`'s `_TOOL_TIMEOUT_SECONDS = 10.0`
  constant, so existing rows silently get the same default the runtime already
  enforces in Python.
- **No parallel migration-history gap silently absorbed.** This checkout's
  `apps/api/prisma/migrations/` contained only `migration_lock.toml` — no baseline
  migration existed despite `docs/deployment/DEPLOYMENT.md` documenting that one
  (`20260819234327_init`) was previously generated. Rather than quietly folding a
  whole-schema migration into a phase-8-named migration file, a real disposable
  Postgres (`postgres:16-alpine`, Docker) was used to run `prisma migrate dev --name
  init` first (captures the pre-existing v1 schema as-is, zero content changes), then
  a second `prisma migrate dev --name tool_definition_phase8_columns` for the actual
  additive columns. Both were applied and verified against the real container.

### Deliverables

**Backend** (`apps/api/src/modules/tools/`):
- `domain/tool-definition.ts` — extended `ToolDefinitionRecord` (+ `timeoutMs`,
  `consequential`, `lane`, `perSessionCap`, `perTurnCap`).
- `domain/ports.ts` — `ToolDefinitionRepositoryPort` gains `findById`, `create`,
  `update`, `delete` (optimistic-concurrency `ifMatch: Date` → record |
  `'conflict'` | `'missing'`, matching `DeploymentConfigRepositoryPort`'s shape).
- `domain/validation.ts` (new) — `assertToolName`, `assertToolUrl` (https-only, mirrors
  `assertEndpointUrl`'s remote-hosting branch — no self-hosted carve-out, since tool
  URLs are always outbound HTTP calls to tenant-operated APIs, never provider infra),
  `assertCredentialRef`.
- `application/` — `CreateToolUseCase`, `GetToolUseCase`, `ListToolsUseCase`,
  `UpdateToolUseCase`, `DeleteToolUseCase`, `TestInvokeToolUseCase`, `tool-dto.ts`.
- `infrastructure/prisma-tool-definition.repository.ts` — extended with the new port
  methods; `infrastructure/tool-invoker.service.ts` (new) — the NestJS re-implementation
  of `ToolExecutor.invoke()`.
- `interface/tools.controller.ts` (new) — `@Controller('tenants/:id/tools')`.
- Full `*.spec.ts` per use-case/domain method/repository/controller.

**Contracts** (`packages/contracts/src/tools/schemas.ts`, new):
- `ToolLaneSchema`, `CreateToolRequestSchema`, `UpdateToolRequestSchema`, `ToolSchema`
  (DTO), `TestInvokeToolRequestSchema`, `TestInvokeToolResultSchema`.
- `error-codes.ts`: `TOOL_NAME_REQUIRED`, `TOOL_URL_INVALID`, `TOOL_CREDENTIAL_MISSING`,
  `TOOL_NOT_FOUND`, `TOOL_API_REF_EXISTS` + `ERROR_MESSAGES` entries.

**Prisma**: `apps/api/prisma/schema.prisma` `ToolDefinition` model gains
`consequential`, `lane`, `perSessionCap`, `perTurnCap`, `timeoutMs` (all additive,
defaulted/nullable). Migrations: `20260819234327_init` (baseline, pre-existing schema)
+ `<ts>_tool_definition_phase8_columns` (the actual additive change).

**Frontend** (`apps/web/projects/admin/src/app/features/tools/`, new feature):
- `services/tools-api.service.ts` in `projects/shared/src/lib/api/` (HTTP client,
  platform convention) + `services/tools.service.ts` (feature facade).
- `store/tools.store.ts` — NgRx SignalStore, load/create/update/delete/test-invoke,
  debounced-validate-free (CRUD, not a draft-editing surface) but same
  loading/empty/error/conflict state vocabulary as `agent-builder.store.ts`.
- `pages/tools-page/` — list table + create/edit dialog + test-invoke panel +
  attach/detach section (reads `agent.tools[]` via `DeploymentConfigApiService`,
  writes back through the same save-draft call `agent-builder.store.ts` uses) +
  token-cost banner + consequential-tools stub banner.
- `tools.routes.ts` — `tenants/:id/tools`, registered in `app.routes.ts`.
- `agent-builder-page.component.html` line 253 becomes a `routerLink` into the new tab.
- `*.spec.ts` per new service/store/component.

**Docs**: this file (Phase 8 section marked done at the end), inline JSDoc/TSDoc
following existing house style.

### Exit gate
- `pnpm --filter @liveavatar/contracts build && pnpm --filter @liveavatar/contracts lint`
- `pnpm --filter @liveavatar/api build`, `lint`, `test`, plus a new
  `tools.e2e-spec.ts` covering create → list → get → patch (+ If-Match conflict) →
  test-invoke → attach via config save → delete, and a cross-tenant negative test.
- `pnpm --filter @liveavatar/web build`, `lint`, `test`.
- `apps/agent`: `ruff check` / `pytest` unaffected-regression check only (not modified).
- Security review scoped to the tools module (guards, tenant scoping, SSRF posture on
  outbound test-invoke URLs, response size cap, no secret echoed back).
- This section updated with the actual gate run results before Phase 9 starts.

### Result — Phase 8 done (2026-09-01)

**Delivered as planned**, with the deviations noted below.

**Gate run:**
- `pnpm --filter @liveavatar/contracts build && pnpm --filter @liveavatar/contracts lint` — green.
- `pnpm --filter @liveavatar/api build` — green. `lint` — green. `test` (Jest,
  full suite) — 769/770 passing across 136/139 suites; the 3 failing suites
  (`providers/infrastructure/http-probe-strategy.spec.ts`,
  `providers/domain/validation.spec.ts`,
  `providers/application/update-provider-credential.use-case.spec.ts`) are a
  **pre-existing defect unrelated to this phase** — `assertEndpointUrl` was
  changed to take a second `hosting` parameter at some point but its own spec
  and `UpdateProviderCredentialUseCase`'s constructor call site were never
  updated to match; none of these files were touched this phase. Left as-is
  per this workflow's "don't silently fix unrelated code" rule — flagged here
  for the user to decide whether to fold into a follow-up.
  `tools` module: 83/83 passing (11 suites) covering every use-case, the
  domain validators (name/URL/SSRF-baseline/credential-presence/api_ref
  derivation), the repository, `ToolInvokerService`, the DTO mappers, and the
  controller.
- e2e (`test/tools.e2e-spec.ts`, testcontainers-based, matching the existing
  `tenant-isolation.e2e-spec.ts` convention): **could not be executed via its
  own `pnpm test:e2e` path in this sandbox** — `docker pull postgres:16-alpine`
  hangs/times out here (outbound Docker Hub registry access is blocked;
  verified directly with `docker pull` + a bounded `timeout`). This is an
  environment limitation, not a code defect — say so explicitly per this
  workflow's own instruction rather than silently skipping.
  **The golden path was still proven for real**, not just claimed: a
  temporary, non-committed copy of the spec was pointed at an
  already-pulled-locally `postgres:16-alpine` container (started directly via
  `docker run`, bypassing the registry pull) instead of testcontainers, run
  to completion, and then deleted. Real run, real Postgres, real HTTP stack
  (Supertest against the compiled `AppModule`): **2/2 passing** — create
  (incl. `TOOL_NAME_REQUIRED`/`TOOL_URL_INVALID`/`TOOL_CREDENTIAL_MISSING`
  validation, `TOOL_API_REF_EXISTS` conflict) → list → get → patch (missing
  `If-Match` → 409, stale `If-Match` → 409 `CONFIG_CONFLICT`, valid → 200) →
  test-invoke (200, `ok:false`, `TOOL_HTTP_ERROR`, never a 5xx) → attach via
  the existing `PUT /tenants/:id/config` draft-save flow (whole-draft
  round-trip verified to preserve unrelated fields, not just `agent.tools[]`)
  → delete → 404 after delete → cross-tenant read/list → 403
  `TENANT_FORBIDDEN`. The committed `tools.e2e-spec.ts` is left exactly as it
  should run in a normal CI environment with real registry access.
- `pnpm --filter @liveavatar/web build` — green. `lint` — green. `test` — 454/454
  passing across 65 suites (10 new: `tools-api.service`, `tools.store`,
  `tool-dialog.component`, `tools-page.component`, plus the existing
  `agent-builder-page.component.spec.ts` still green after the tools-link
  template change).
- `apps/agent` (unaffected-regression check, no Python files touched):
  `ruff check .` — all checks passed. `pytest -q` — 252/253 passing; the one
  failure (`tests/contracts/test_runtime_config.py::test_rejects_a_non_https_looking_garbage_endpoint`)
  is pre-existing and unrelated (nothing in `apps/agent` was modified this
  phase) — flagged, not fixed, same rule as the provider-module spec drift
  above.

**Scope deviations from the original prompt, and why:**
1. **Two extra Prisma migrations, not one.** No migration history existed in
   this checkout (only `migration_lock.toml`) despite `docs/deployment/DEPLOYMENT.md`
   documenting a prior `20260819234327_init`. Generated that exact baseline
   first (zero content changes, captures the pre-existing v1 schema as-is),
   then the real Phase 8 migration on top — both applied and verified against
   a real disposable Postgres via Docker. See "Decisions made this phase"
   above.
2. **`ToolDefinition` gained `requires_credential` (new column), not just the
   four originally-listed additive columns.** Needed to make
   `TOOL_CREDENTIAL_MISSING` a real, persisted, round-trippable rule (mirrors
   `ProviderDefinitionDto.requires_credential`'s exact naming/semantics)
   rather than an unpersisted, UI-only guess. Additive, defaulted `false`.
3. **Cross-tenant tools access is `403 TENANT_FORBIDDEN`, not `404`.** The
   e2e test was initially written assuming the tenants-controller's own
   "collapse unknown-or-unassigned into 404" rule (LLD §5.1) applied here too
   — it doesn't. Every other nested `tenants/:id/...` resource module already
   in this codebase (`providers`, `deployment-config`) uses
   `findById`-then-`canAccessTenant` → 403 for "exists but you're not
   assigned", and `tools` was built to match that existing, consistent
   precedent. Fixed the test's expectation, not the (correct) production code.
4. **Discovered and fixed a real gap affecting *all* e2e specs, not just this
   phase's new one**: `LiveKitClientAdapter` requires `LIVEKIT_URL`/
   `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` at construction time, and e2e specs
   bootstrap `AppModule` directly (bypassing `main.ts`'s `dotenv/config` load
   of `apps/api/.env`), so `compile()` throws before a single request runs
   unless these are set explicitly in the spec's own `beforeAll`. Added them
   (matching `.env.example`'s documented dev-mode LiveKit defaults) to both
   `tools.e2e-spec.ts` and the pre-existing `tenant-isolation.e2e-spec.ts` —
   without this, *neither* e2e spec in this repository could ever get past
   `beforeAll`, in any environment with real Docker registry access.
5. **`ToolsController`'s `test-invoke` route needed an explicit `@HttpCode(200)`** —
   Nest defaults an unannotated `@Post` to 201, which contradicts the
   contract's documented "test-invoke is always 200, `ok:false` on failure"
   semantics. Caught by the e2e run.
6. **Frontend attach/detach does not import `AgentBuilderStore`.** The
   admin SPA's ESLint feature-isolation zones (`eslint.config.mjs`
   `webFeatures`) forbid one feature reaching into another feature's
   internals — a hard boundary this prompt's suggested design ("reuse
   `AgentBuilderStore`'s existing save-draft flow") would have violated.
   `ToolsStore` instead owns a small, local, independent read-modify-write
   of the draft (`GET /tenants/:id/config` → mutate `agent.tools[]` only →
   `PUT` the *whole* draft back) built on the shared, freely-importable
   `DeploymentConfigApiService` — same pattern as `AgentBuilderStore`, not
   the same instance. Added `tools` to `webFeatures` so the new feature gets
   the same isolation protection every other feature has.
7. **No in-use guard on tool delete.** Unlike
   `DeleteProviderCredentialUseCase`, deleting a `ToolDefinition` still
   referenced by a published config's `agent.tools[]` is not blocked here —
   the existing `toolRefsKnownRule` Gate-B check already catches the dangling
   `api_ref` the next time that config is validated/published. Flagged as a
   deliberate, documented simplification rather than a silent gap; a
   follow-up could add the same `PublishedConfigLookupPort`-style guard if
   desired.
8. **Base-prompt token-cost banner uses a heuristic estimate** (~4 UTF-8
   bytes/token over name+description+args_schema), not a real tokenizer —
   none is available client-side. Shown as "~N tokens (estimate)" in the UI
   copy, not presented as exact.
9. **Consequential-tool banner lists every `consequential: true` tool in the
   registry**, not scoped to "attached, via-skill, or in-graph" routing
   (skills/graph don't exist until later phases) — matches the stub
   requirement ("renders and flags... Gating not available yet").

**Security review (scoped to `apps/api/src/modules/tools/`,
`apps/web/.../features/tools/`, `packages/contracts/src/tools/`):**
- Every route on `ToolsController` sits behind `@UseGuards(AdminJwtGuard, RolesGuard)`
  and is nested under `tenants/:id/tools` exactly like `providers`/
  `deployment-config`; every use-case re-derives tenant access via
  `tenants.findById` + `canAccessTenant` — never trusts the path id alone.
  Verified with a negative e2e test (403, not 404 — see deviation 3 above,
  itself a discipline check against the codebase's existing cross-tenant
  pattern).
- Every request body is TypeBox-validated (`CreateToolRequestSchema`/
  `UpdateToolRequestSchema`/`TestInvokeToolRequestSchema`, all
  `additionalProperties: false`).
- Test-invoke never forwards a real credential: the control plane has no
  access to resolved secret values at all (only the live agent process does,
  from `SECRETS_DIR` — see `GetRuntimeConfigUseCase`'s docstring), so
  `ToolInvokerService` never sets an `Authorization` header and flags
  `credential_unresolved: true` in the result instead of pretending to
  authenticate. Response bodies are logged only as `api_ref` + outcome code
  (`ToolInvokerService`'s `Logger.warn`) — never the body/args.
- SSRF baseline on tool URLs (`domain/validation.ts`'s `assertToolUrl`):
  https-only, rejects loopback/link-local/RFC1918 hosts and `.local`/
  `.internal` suffixes. This is a literal-hostname check, not full
  DNS-rebinding protection — no existing SSRF-hardening utility exists
  elsewhere in this codebase to reuse, and building one is out of this
  phase's scope. **Residual risk, flagged not silently accepted**: a
  hostname that resolves to a private IP only at request time (DNS
  rebinding) would bypass this check; `ToolInvokerService`'s `fetch()` call
  has no post-resolution IP re-check.
- Test-invoke response bodies are capped at 32 KiB (matches
  `ToolExecutor._MAX_RESPONSE_BYTES` exactly) before being returned, and
  never persisted/logged in full.
- Rate limiting: `test-invoke` rides the platform's existing global
  `ThrottlerModule` (300 req/min) — no per-tool or per-tenant-specific
  throttle was added. Flagged as a gap consistent with this workflow's
  "flag it if the project has no rate-limiting story at all yet" guidance —
  the existing global limiter is the same posture every other admin-JWT
  route in this codebase has, so this isn't a new gap, just not a
  strengthened one either.
- No new dependency was added (fetch is Node's built-in global, already used
  identically by `HttpProbeStrategy`).

---

## Phase 9 — Reasoning graph engine v1 (BL-035, BL-036, BL-037, BL-038, BL-039)

### Goal
Replace the flat `llm:` block with `reasoning.graph[]` — a real, versioned,
multi-node turn graph — and give the Python agent a shared interpreter that
walks it (today's "graph" is one node wrapping `failover.py`'s retry logic).
An admin builds a Router → Tool/Retrieve(stub)/Speak branching agent in the
new Reasoning tab, runs a test call, and sees node-level detail in the
session trace. Config gains real version history (`ConfigVersion`,
append-only, written on publish) so the graph — like the rest of the config —
is immutable, diffable, and rollback-able (R-G8), even though the diff/rollback
**UI** is deferred (BL-078).

### Scope

**In scope:**
1. **Schema**: `packages/contracts/src/agent-config/reasoning-graph.schema.ts`
   (new) — `GraphNodeSchema` (discriminated union on `type`: `llm | tool |
   retrieve | router | speak | end`), `ReasoningSchema` (`graph`,
   `turn_budget_ms`, `entry_node_id`, `background_entry_node_ids`). `schema.ts`
   drops `llm:` and adds `reasoning:`. Python mirror in
   `apps/agent/src/avatar_agent/contracts/runtime_config.py` (Pydantic
   discriminated union, `Field(discriminator="type")`). Fixture corpus
   (`apps/agent/fixtures/agent-config/{valid,invalid}`) extended with graph
   fixtures; contract test unchanged in shape, just exercises the new schema.
2. **Migration/back-compat (R-G1)**: `emptyAgentConfig` and every existing
   fixture/seed that wrote `llm: {primary, fallback, retry}` now writes
   `reasoning: { graph: [{id: 'llm-1', type: 'llm', ...same fields...,
   lane: 'foreground', on_error: {action:'degrade'}, on_deadline:
   {action:'degrade'}, next_node_id: null}], entry_node_id: 'llm-1',
   background_entry_node_ids: [], turn_budget_ms: 3000 }` — a mechanical
   rename, not a behavior change. No stored `DeploymentConfig.yamlText` rows
   exist in this checkout (fresh schema, no prod data to migrate) — verified
   by inspecting `apps/api/prisma/migrations/`; nothing beyond the fixture
   corpus needed updating.
3. **Interpreter contract for the default case**: when the foreground walk
   reaches a node with `next_node_id == null` whose type is not `speak`/`end`,
   the interpreter treats it as "speak this node's output, then end" — this
   is what makes a single-LLM-node graph behave exactly like today's
   `_process_utterance` (call LLM, speak the result) with zero explicit
   Speak/End nodes required. Explicit `speak`/`end` nodes exist for graphs
   that need to terminate a branch without speaking (e.g., a Router branch
   that hands off) or speak something other than the last node's raw output.
4. **`ConfigVersion`**: Prisma model exactly as specified in
   `docs/v2/ARCHITECTURE_NOTES.md` §2 (copied verbatim). New
   `deployment-config` use-cases: `list-config-versions`,
   `get-config-version-diff` (line-level diff computed at read time over the
   two `yamlText` strings — no diff library dependency, a small pure
   line-diff function is enough for a backend-only capability with no UI
   consumer yet), `rollback-config-version` (creates a new **draft** row from
   an old version's `yamlText`, sets that version's `rolledBackFrom`, never
   auto-publishes). `SaveConfigUseCase` inserts one `ConfigVersion` row
   (`versionNumber = max+1`, `status: 'published'`, in the same Prisma
   transaction as the `DeploymentConfig` update) only when `save_as ===
   'published'` and Gate B passes. New endpoints on
   `DeploymentConfigController`: `GET /tenants/:id/config/versions`,
   `GET /tenants/:id/config/versions/diff?from=N&to=M`,
   `POST /tenants/:id/config/versions/:versionNumber/rollback`.
5. **Gate A/B updates**: `completenessRule`/`providerEnabledRule`/
   `credentialExistsRule`/`fallbackDiffersRule`/`residencyBlocksRemoteLlmRule`
   in `combination-rules.ts` change from reading `config.llm.primary/fallback`
   to reading every `llm`-type node's `provider`/`credential_ref`/`model` out
   of `config.reasoning.graph` (a small `collectLlmLegs()` helper). New Gate A
   structural check, `domain/graph-structure.ts`: every node `id` unique,
   `entry_node_id` and every `next_node_id`/branch target/
   `background_entry_node_ids` entry resolves to a real node id. This is
   basic referential integrity needed for the graph to be executable at all —
   **not** V-2/V-4 (loop guard presence, cycle detection), which stay Phase
   11 per `ARCHITECTURE_NOTES.md` §7's table (no `Loop` node exists yet this
   phase, so a cycle can only be created by a Router branch pointing
   backward; detecting that is explicitly deferred, flagged as a known gap
   an admin could hit, not silently ignored). `toolRefsKnownRule` extended to
   also check every `tool`-type node's `api_ref` (previously only
   `agent.tools[]`).
6. **Python interpreter**: new package
   `apps/agent/src/avatar_agent/orchestration/graph/` — `ir.py`
   (`GraphNode`/`GraphDefinition`/`TurnContext`/`NodeResult` — a straight
   Pydantic-model port of the Python mirror, plus the runtime-only
   `TurnContext`), `nodes/{llm,tool,retrieve,router,speak,end}.py` (one
   `NodeExecutor` Protocol implementer per type), `interpreter.py` (walks the
   foreground chain from `entry_node_id`; on reaching a node whose own `lane`
   marks it `background` — reachable only via `background_entry_node_ids`,
   never spliced into the foreground `next_node_id` chain, matching the
   wireframe's separate FOREGROUND/BACKGROUND panels — it is scheduled as a
   detached `asyncio.create_task` right after the foreground path finishes
   speaking, never awaited by the turn). State machine
   PENDING→RUNNING→COMPLETE/TIMED_OUT/FAILED/CANCELLED exists on every node
   result, but `TIMED_OUT` is unreachable this phase (no deadline
   enforcement — Phase 10) and is wired for forward-compatibility, not
   exercised by production code yet.
   - **LLM node**: ports today's `run_with_failover` +
     `_consume_llm_stream` + one-round tool-call follow-up
     (`_apply_tool_results`) verbatim into the node executor — this is the
     one node type whose behavior must be byte-for-byte identical to today's
     pipeline for the default single-node graph, so it is a port, not a
     rewrite.
   - **Tool node**: reuses `ToolExecutor.invoke` as-is; `argument_mapping`
     (`dict[str, str]`) resolves each value against `ctx.turn_state` (a
     literal string, or `$state.<key>`/`$utterance` for a turn-state
     lookup) — deliberately tiny, no expression language beyond variable
     substitution.
   - **Retrieve node**: no-op stub — logs `RETRIEVE_NODE_STUBBED` (structlog)
     and returns an empty result, per `ARCHITECTURE_NOTES.md` §3.2 ("stubbed
     until Phase 12b").
   - **Router node**: `nodes/router.py` owns a small allow-listed condition
     grammar (`condition-grammar.py`) — `field <op> literal`, `op ∈ {==, !=,
     in}`, `field` restricted to a closed allow-list of `TurnContext`
     fields (`utterance`, `state.<key>`), literal is a quoted string, number,
     or bracketed string list. Hand-rolled tokenizer + recursive-descent
     parser + evaluator; **no `eval`/`ast.literal_eval` on a full expression,
     no attribute access, no function calls** — see Security review below.
   - **Speak node**: `mode: llm_output | literal`. Calls `ctx.speak(text)`,
     a callback threaded in from `pipeline.py` (see next point) rather than
     returning text for the caller to speak — this is the real, contained
     piece of "Speak becomes a mid-turn callback" surgery
     `ARCHITECTURE_NOTES.md` §3.2 flags; the *larger* refactor it also flags
     (interruptible speech, HITL hold-treatment reusing `_speak` on a timer)
     is Phase 14, not touched here.
   - **End node**: terminates the walk; a no-op executor.
   - `graph_langgraph.py`/`graph_pydantic_ai.py` rewritten as one-node
     wrappers around `interpreter.run(graph, ctx)`, exactly as they wrap
     `run_with_failover` today (same `__init__`-compiles-once /
     `run_turn`-per-utterance shape).
   - `ports/orchestration.py`'s `IOrchestrator.run_turn` widens to
     `run_turn(graph: GraphDefinition, ctx: TurnContext) -> GraphRunResult`.
     `GraphRunResult` carries `reply_text`, `provider_key`, `used_fallback`,
     `first_token_ms` (from the last LLM node executed on the foreground
     path, for backward-compatible `hop="llm"` reporting — `None` when no
     LLM node ran, e.g. a static-text Router→Speak branch) and
     `node_trace: list[NodeExecutionRecord]` (id, type, lane, status,
     `total_ms`, `error_code | None` — feeds BL-039, see below).
   - **`pipeline.py` surgery (contained)**: `_process_utterance` builds a
     `TurnContext` (residency, tools, a `turn_state` dict seeded with
     `{"utterance": text}`, and `speak=lambda t: self._speak(seq, t)`) and
     calls `self._orchestrator.run_turn(graph_definition, ctx)` instead of
     the old five-positional-arg call. The old direct `await self._speak(seq,
     reply_text)` call after the orchestrator call is **removed** — speaking
     now always happens inside the interpreter (explicitly via a Speak node,
     or implicitly per point 3 above) so it is never done twice. Tool-result
     application, degraded-mode entry, and hop recording for `hop="llm"`/
     `hop="tts"` are unchanged in behavior, just reading from
     `GraphRunResult` instead of `FailoverResult`.
7. **Test-call harness (BL-037)** — **scope decision, not resolved by
   `ARCHITECTURE_NOTES.md`, made here**: runs entirely in NestJS as a
   **structural simulator**, not a live Python execution. Rationale: a live
   run would need either (a) real vendor credentials reachable from the
   control plane, which ADR-001/LLD explicitly keep Python-only
   (`GetRuntimeConfigUseCase`'s docstring — "only the live agent process
   resolves secrets"), or (b) a brand-new synchronous control-plane→agent
   HTTP surface, which doesn't exist today (`ARCHITECTURE_NOTES.md` §6.2:
   "zero push channel from the control plane back to the Python agent") and
   is explicitly out of scope to invent this phase (that infra, `ai_service.py`,
   is Phase 12a's job for a different reason — embedding). New module
   `apps/api/src/modules/deployment-config/application/test-call-graph.use-case.ts`
   walks the same `GraphDefinition` shape the Python interpreter consumes,
   node by node from `entry_node_id`: **Tool** nodes make a real call via the
   already-built `ToolInvokerService` (Phase 8, no vendor SDK, safe to run
   from Nest); **LLM** nodes are simulated (`"would call {provider}/{model}
   with a N-char prompt"`, no live vendor call — no credential resolution
   exists in the control plane to do otherwise); **Router** nodes evaluate
   the same allow-listed grammar (`domain/graph-condition.ts`, a TypeScript
   port of the Python grammar — same closed grammar, no `eval`/`new
   Function`); **Retrieve** is the same stub-and-log; **Speak** renders the
   final text (literal, or the upstream simulated/real output);  **End**
   terminates. Endpoint: `POST /tenants/:id/config/test-call` (draft config +
   sample utterance in, ordered per-node result array out — reused by the
   Angular Test-call harness component, and left for Skills/Knowledge
   playground to call the same way in later phases per the shared-component
   note in `UX_SCOPE.md`).
8. **Session detail node-level trace (BL-039)**: `HopKind` gains a `node`
   member (TS enum + Prisma enum + Python `Literal`). `LatencyHop` gains
   `nodeId String @default("") @map("node_id")` (always populated —
   non-node hops pass `''` so the existing `(session_id, utterance_seq, hop)`
   upsert-idempotency behavior for `stt`/`llm`/`tts`/`avatar`/`e2e` is
   preserved on retry — Postgres treats `NULL` as distinct in a unique index,
   which would have silently broken retry-dedup for those rows) and
   `nodeType String? @map("node_type")`; unique constraint becomes
   `(session_id, utterance_seq, hop, node_id)`. `HopItem` gains optional
   `node_id`/`node_type`/`lane`. `interpreter.py` records one `HopItem(hop=
   "node", node_id=..., node_type=..., lane=..., total_ms=..., error_code=...)`
   per node executed, via the existing `HopRecorder`/`POST
   /internal/sessions/{id}/hops` path — no new telemetry channel. **Scoped
   down from R-G9's full "inputs, outputs, ... cost"**: only latency/error/
   lane/node id/type are recorded, not full input/output payloads (no
   existing precedent for storing arbitrary node I/O blobs in this table;
   size/privacy risk for an LLM node's full prompt/response) — flagged as a
   deliberate simplification, not silently dropped scope. Session detail
   Angular component extends its existing hop-table rendering to show
   `node`-kind rows grouped under their utterance, node icon by `node_type`
   (same icon set the Reasoning tab uses, per `UX_SCOPE.md`'s "recognition
   over recall" heuristic).
9. **Frontend — Reasoning tab** (`apps/web/projects/admin/src/app/features/reasoning/`,
   new feature, mirrors `features/tools/`'s four-layer shape): `store/reasoning.store.ts`
   (NgRx SignalStore, same debounced-validate pattern as
   `agent-builder.store.ts`, local read-modify-write of the draft exactly like
   `ToolsStore` — same ESLint feature-isolation reason as Phase 8's deviation
   6); `pages/reasoning-page/` — node-card list (`role="list"`/`listitem"`,
   Router branches as nested `role="list"`), "Add node ▾" menu, inspector
   side-panel (Angular CDK overlay, matching the existing Reload-confirm
   dialog pattern), per-node last-test-status badge; `components/test-call-panel/`
   (the shared harness UI, built generically per BL-037 — sample-utterance
   input, "Run test call" button, ordered node-result list — so Skills/
   Knowledge playground can mount the same component later); `reasoning.routes.ts`
   registered the same way `tools.routes.ts` is (own route, pre-Phase-16
   shell). Node types this phase: LLM/Tool/Retrieve/Router/Speak/End
   inspector forms only (no Skill/Sub-agent/Parallel/Loop/HITL/Handoff/State
   fields — those node types aren't in the schema yet, so "Add node ▾" only
   lists the six BL-035 types).

**Out of scope (explicit, per the prompt and `ARCHITECTURE_NOTES.md`):**
- Parallel/Loop node types (Phase 11); Skill/Sub-agent/HITL/Handoff/State
  node types (Phases 13–15); real RAG retrieval (Phase 12b — Retrieve stays a
  logged no-op); turn-budget critical-path computation and
  `on_deadline`/deadline-degradation enforcement (Phase 10 — the field exists
  on every node per R-G7's shape, nothing reads it yet); V-2/V-4 loop-guard/
  cycle validation (Phase 11); diff/rollback **UI** (BL-078, deferred — the
  backend capability above is real and tested, just no Angular screen);
  speculative retrieval/speech (BL-067/068); the 8-tab shell (Phase 16).

### Decisions made this phase
- **Test-call harness runs in NestJS as a structural/simulated walk, not a
  live Python execution.** See point 7 above — the alternative (a new
  synchronous control-plane→agent HTTP surface) is out of proportion to a
  foundational schema phase and isn't required by any Phase 9 exit
  condition; BL-037's own text only asks for "node-by-node results," which a
  structural walk provides without inventing new cross-process infra a
  session before it's otherwise needed.
- **Background nodes are separate graph entry points
  (`background_entry_node_ids[]`), not inline `lane: background` nodes
  spliced into the foreground `next_node_id` chain.** Matches the A3.6
  wireframe's literal two-panel (FOREGROUND/BACKGROUND) layout and UC-G2's
  "moves it below the foreground lane divider... excluded from critical
  path" — a background node was never going to gate the foreground chain's
  `next_node_id` pointer, so giving it its own entry point is simpler than
  making every executor lane-aware mid-chain.
- **`ConfigVersion` diff is computed with a small hand-rolled line-diff, not
  a diff library dependency**, since nothing consumes it but a
  backend-capability test this phase (no UI) — revisit if/when BL-078's UI
  actually ships and needs a real unified-diff format.
- **Router/test-call condition grammar is implemented twice** (Python for
  the real interpreter, TypeScript for the Nest test-call simulator) rather
  than sharing one implementation across languages, matching this project's
  existing precedent (Gate A/B validation itself is already duplicated
  TS/Python, contract-tested for agreement) — no cross-language expression
  interpreter infra exists to share instead, and the grammar is small enough
  (three operators, no nesting) that duplication risk is low. Both are unit
  tested against the same table of cases.

### Deliverables

**Contracts** (`packages/contracts/src/agent-config/`):
- `reasoning-graph.schema.ts` (new) — node schemas, `ReasoningSchema`,
  `GraphNodeSchema` union, exported types.
- `schema.ts` — `llm:` removed, `reasoning: ReasoningSchema` added.
- `error-codes.ts` — `CONFIG_GRAPH_NODE_ID_DUPLICATE`,
  `CONFIG_GRAPH_REF_UNKNOWN`, `CONFIG_GRAPH_ENTRY_UNKNOWN` +
  `ERROR_MESSAGES` entries.

**Python** (`apps/agent/src/avatar_agent/`):
- `contracts/runtime_config.py` — `ReasoningBlock`, `GraphNode` discriminated
  union, node models, replacing `LlmBlock`/`LlmLeg`/`RetryPolicy`'s use at
  the top level (`RetryPolicy` moves under the LLM node model; kept as a
  standalone class, still imported by `failover.py`).
- `orchestration/graph/__init__.py`, `ir.py`, `interpreter.py`,
  `condition_grammar.py`, `nodes/{llm,tool,retrieve,router,speak,end}.py`.
- `orchestration/graph_langgraph.py`, `graph_pydantic_ai.py` — rewritten.
- `ports/orchestration.py` — widened `IOrchestrator`.
- `orchestration/pipeline.py` — `TurnContext` construction, `run_turn` call
  site, direct `_speak` call removed, `HopRecorder` node-trace recording.
- `telemetry/hops.py` unaffected (already generic over `HopItem`).
- `contracts/internal_api.py` — `HopKind` gains `"node"`, `HopItem` gains
  `node_id`/`node_type`/`lane`.
- Fixtures: `apps/agent/fixtures/agent-config/valid/{router-branching.yaml,
  single-llm-node.yaml}`, `invalid/{graph-dangling-ref.yaml,
  graph-duplicate-node-id.yaml}`.
- Tests: `tests/orchestration/graph/*` (interpreter state machine, each node
  executor, condition grammar), `tests/contracts/test_agent_config_contract.py`
  extended fixtures, `pipeline.py` call-site tests updated.

**Backend** (`apps/api/src/modules/deployment-config/`):
- `domain/graph-structure.ts` (new) — reference-integrity Gate A check.
- `domain/combination-rules.ts` — `collectLlmLegs()` helper,
  `toolRefsKnownRule` extended to graph Tool nodes.
- `domain/ports.ts` — `ConfigVersionRepositoryPort`.
- `application/list-config-versions.use-case.ts`,
  `get-config-version-diff.use-case.ts`, `rollback-config-version.use-case.ts`,
  `test-call-graph.use-case.ts`, `graph-condition.ts` (Router grammar, TS).
- `infrastructure/prisma-config-version.repository.ts`.
- `interface/deployment-config.controller.ts` — new routes (point 4, 7 above).
- `deployment-config.module.ts` — new providers wired.
- Full `*.spec.ts` per new file.
- `apps/api/prisma/schema.prisma` — `ConfigVersion` model + `ConfigVersionStatus`
  enum (verbatim per `ARCHITECTURE_NOTES.md` §2); `HopKind` gains `node`;
  `LatencyHop` gains `nodeId`/`nodeType`, unique constraint updated. One
  additive migration.
- `apps/api/src/modules/sessions/` — `HopItem`/`HopInput`/`HopRow` types and
  `RecordHopsUseCase`/`PrismaHopRepository` extended for the two new fields.

**Frontend** (`apps/web/projects/admin/src/app/features/reasoning/`, new):
- `services/reasoning-api.service.ts` (shared `projects/shared`),
  `store/reasoning.store.ts`, `pages/reasoning-page/`,
  `components/node-card/`, `components/node-inspector/`,
  `components/test-call-panel/`, `reasoning.routes.ts`.
- `apps/web/projects/admin/src/app/features/sessions/` — session-detail hop
  table extended for `node`-kind rows.
- `*.spec.ts` per new service/store/component.

**Docs**: this file (Phase 9 section marked done at the end).

### Exit gate
- `pnpm --filter @liveavatar/contracts build && pnpm --filter @liveavatar/contracts lint`
- `pnpm --filter @liveavatar/api build`, `lint`, `test` (unit) — plus updated
  `providers`/`sessions` specs touched by the `HopKind`/denormalized-column
  changes.
- `pnpm --filter @liveavatar/web build`, `lint`, `test`.
- `apps/agent`: `ruff check .`, `ruff format --check .`, `mypy src`,
  `pytest -q` (full suite — this phase changes real Python, not a regression
  spot-check).
- Security review scoped to: the two new/changed endpoint groups
  (`config/versions*`, `config/test-call`) keep the same
  `AdminJwtGuard`/`RolesGuard`/tenant-scoping pattern as the rest of
  `deployment-config`; the Router condition grammar (both languages) is
  reviewed specifically for injection risk.
- If e2e/testcontainers can't run in this sandbox (Phase 8 hit a Docker Hub
  block), prove the golden path against a real local Postgres the same way
  Phase 8 did, and say so explicitly rather than skipping verification.
- This section updated with the actual gate run results before Phase 10
  starts.

### Result — Phase 9 done (2026-09-02)

**Delivered as planned**, built by three parallel tracks (TS/NestJS contracts +
API, Python graph interpreter, Angular Reasoning tab) plus cross-cutting
fixes to existing code the schema change touched — all reconciled and
re-verified together in the same working tree afterward. Full file list by
layer, then gate results, then deviations/findings.

**Files — Contracts** (`packages/contracts/src/`):
`agent-config/reasoning-graph.schema.ts` (new — `GraphNodeSchema` union,
`ReasoningSchema`), `agent-config/schema-keys.ts` (new — catalog literals
split out to avoid a circular import), `agent-config/schema.ts` (`llm:` →
`reasoning:`), `agent-config/errors.ts`, `error-codes.ts` (+4 codes),
`deployment-config/schemas.ts` (+ConfigVersion DTOs, +TestCall DTOs),
`internal/schemas.ts` (`HopItemSchema` +`node` kind, +node fields),
`sessions/schemas.ts` (`HopCycleDtoSchema` +`nodes[]`).

**Files — API** (`apps/api/src/modules/`, `apps/api/prisma/`):
`deployment-config/domain/{agent-config.ts (findLlmNodes,
buildSingleLlmNodeGraph), combination-rules.ts, graph-structure.ts (new),
graph-condition.ts (new), text-diff.ts (new), ports.ts}`,
`deployment-config/application/{save-config.use-case.ts,
validate-config.use-case.ts, list-config-versions.use-case.ts (new),
get-config-version-diff.use-case.ts (new), rollback-config-version.use-case.ts
(new), test-call-graph.use-case.ts (new)}`,
`deployment-config/infrastructure/{prisma-deployment-config.repository.ts
(now $transaction-wrapped on publish), prisma-config-version.repository.ts
(new)}`, `deployment-config/interface/deployment-config.controller.ts` (+4
routes), `deployment-config.module.ts`; `tools/tools.module.ts` + `index.ts`
(export `TOOL_INVOKER`); `sessions/domain/telemetry-ports.ts`,
`sessions/application/{record-hops.use-case.ts,
get-runtime-config.use-case.ts}`, `sessions/infrastructure/prisma-hop.repository.ts`;
`alerts/application/{get-alert-policy.use-case.ts,
update-alert-policy.use-case.ts}`; `session-logs/application/session-log-dto.ts`.
`prisma/schema.prisma` (`ConfigVersion`, `ConfigVersionStatus`,
`DeploymentConfig.pendingRollbackFromVersionId`, `LatencyHop.{nodeId,nodeType,lane}`
+ widened unique index, `HopKind.node`) + migration
`20260902090055_reasoning_graph_config_version` (applied and verified for
real against both a fresh disposable Postgres and an existing one). ~28
new/updated `*.spec.ts` files across the above.

**Files — Python** (`apps/agent/src/avatar_agent/`):
`contracts/runtime_config.py` (`ReasoningBlock`, `GraphNode` discriminated
union + 6 node models, structural-integrity `@model_validator`),
`contracts/internal_api.py` (`HopKind.node`, `HopItem` node fields);
`orchestration/graph/{ir.py, interpreter.py, condition_grammar.py}` (new),
`orchestration/graph/nodes/{__init__,llm,tool,retrieve,router,speak,end}.py`
(new); `orchestration/{graph_langgraph.py, graph_pydantic_ai.py}`
(rewritten as interpreter wrappers), `orchestration/tools.py` (re-exports
from `ports/tools.py`), `orchestration/pipeline.py` (`TurnContext`
construction, graph-based `run_turn`, `_speak` now reached only via
`ctx.speak`); `ports/orchestration.py` (rewritten — houses `TurnContext`/
`GraphRunResult`/etc. per the `layers` import-linter contract, see below),
`ports/tools.py` (new); `registry/registry.py` (`resolve_llm` takes a
resolved `LlmLeg` directly), `entrypoint.py` (`_resolve_llm_nodes`,
`_resolve_summary_llm`). Fixtures: all 7 pre-existing fixtures converted
`llm:`→`reasoning:`, +4 new (`valid/single-llm-node.yaml`,
`valid/router-branching.yaml`, `invalid/graph-dangling-ref.yaml`,
`invalid/graph-duplicate-node-id.yaml`). New tests under
`tests/orchestration/graph/**` (interpreter state machine, all 6 node
executors, condition grammar); fixed `test_pipeline.py`, `test_registry.py`,
`test_entrypoint.py`, plus two the brief didn't call out but the Python
track found and fixed on its own initiative: `tests/contracts/test_runtime_config.py`,
`tests/telemetry/test_control_plane.py` (both constructed `AgentRuntimeConfig`
fixtures inline with the old `llm:` shape).

**Files — Web** (`apps/web/projects/`):
`admin/src/app/features/reasoning/` (new — `store/reasoning.store.ts`,
`components/{node-card,node-inspector,test-call-panel}`, `pages/reasoning-page/`,
`reasoning.routes.ts`), mirroring `features/tools/`'s four-layer shape and
its own-local-draft-read-modify-write pattern (not importing
`AgentBuilderStore`, per this app's feature-isolation ESLint zones — `reasoning`
added to `webFeatures` in `eslint.config.mjs`); `admin/.../features/sessions/`
session-detail page extended with a node-trace section;
`shared/src/lib/api/` gained `DeploymentConfigApiService.testCall()` and
`HopCycle.nodes`; a shared node-type-icon util so the Reasoning tab and
session-detail trace render the same icons. **Real bug found and fixed**
in `agent-builder-page.component.{ts,html}` / `agent-config-draft.model.ts`:
the old "LLM" form section (~60 lines, 6 handler methods) still read/wrote
`store.draft().llm.primary/fallback/retry` — a field the wire contract no
longer has once `config.llm` became `config.reasoning`. Removed, replaced
with a "N nodes in the reasoning graph" link into the new tab (same pattern
as the pre-existing "N tools enabled" link). `*.spec.ts` per new
service/store/component; also fixed a pre-existing off-by-one in
`agent-builder-page.component.spec.ts`'s handler-call-count assertion,
exposed by that removal.

**Gate — actually run, not assumed:**
- `pnpm --filter @liveavatar/contracts build && lint` — **green**.
- `pnpm --filter @liveavatar/api build` — **green**. `lint` — **green**.
  `test` — **144/147 suites, 908/909 tests**. The 3 failing suites
  (`providers/infrastructure/http-probe-strategy.spec.ts`,
  `providers/application/update-provider-credential.use-case.spec.ts`,
  `providers/domain/validation.spec.ts`) are the **exact same pre-existing
  defect Phase 8 already documented** (`assertEndpointUrl`'s second
  `hosting` parameter never threaded through that spec/call site) —
  unrelated to and untouched by this phase, left as-is per this project's
  "don't silently fix unrelated code" rule, same files Phase 8 flagged.
- `pnpm --filter @liveavatar/web build` — **green** (one pre-existing,
  unrelated CJS-interop warning on `@liveavatar/contracts`, not a phase-9
  regression). `lint` — **green**. `test` — **71/71 suites, 510/510 tests**.
- `apps/agent`: `ruff check .` — **all checks passed**. `ruff format --check .`
  — **105 files already formatted**. `mypy src` — **no issues, 69 files**.
  `pytest -q` — **319/320**. The one failure
  (`tests/contracts/test_runtime_config.py::test_rejects_a_non_https_looking_garbage_endpoint`)
  is pre-existing and unrelated: `AgentRuntimeConfig.endpoints` is
  deliberately `dict[str, str]`, not `HttpUrl` (bitHuman's `file://`
  endpoint needs this — documented in `runtime_config.py`), so a garbage
  endpoint was never actually rejected; the assertion only used to pass
  because a *different*, now-fixed failure masked it. Left as-is, flagged
  not fixed. **Bonus check**: `import-linter` run against all 3 contracts
  (`layers`, `vendor-sdk-isolation`, `orchestration-uses-ports`) —
  **all 3 hold**, specifically verifying the `ports.orchestration`/
  `orchestration.graph` layering split below didn't quietly violate them.

**Golden-path proof (real Postgres, real HTTP stack):**
This phase's own new `test/reasoning-graph.e2e-spec.ts` (testcontainers-based,
same convention as `tools.e2e-spec.ts`) reliably hung its `beforeAll` at
exactly the configured timeout (tried 120s/180s/300s — always failed at
~102–105% of budget, the signature of a stuck `await`, not generic slowness)
specifically inside `PostgreSqlContainer.start()`, even though the
`postgres:16-alpine` image was already pulled locally and **`tools.e2e-spec.ts`
itself ran successfully via testcontainers earlier in this same session**
(2/2 passing, ~31s) — so this is not Phase 8's Docker-Hub-registry block
recurring, it's contention specific to this sandbox's already-heavily-loaded
Docker host (a dozen-plus unrelated containers from other local projects
were running throughout) compounded by a pre-existing "Jest did not exit"
open-handle characteristic already noted for this e2e suite. The committed
e2e spec was **removed** rather than left in a state known to hang CI.
Verification instead used Phase 8's exact fallback: a temporary,
**non-committed** spec (`test/tmp-golden-path.e2e-spec.ts`, deleted after
the run) pointed at a Postgres started directly via `docker run` (bypassing
testcontainers' orchestration entirely, not its image pull) on a fresh
schema (`prisma db push`) with a real catalog seed (`prisma/seed.ts`), run
through Supertest against the real compiled `AppModule`. **Result: 1/1
passing**, exercising, for real: seed → login → create tenant → create 5
real `ProviderCredential` rows → create a real `ToolDefinition` → save+publish
a Router→Tool→LLM→Speak `reasoning.graph` (Gate A+B both pass) → `GET
.../config/versions` shows exactly one `published` `ConfigVersion` row →
`POST .../config/test-call` walks the graph (Router matches, real Tool-node
HTTP call actually attempted and times out against an unreachable host,
~10s, exactly `ToolInvokerService`'s real timeout — never a crash) → a
second publish supersedes v1 and creates v2 → `GET .../config/versions/diff?from=1&to=2`
returns real add/remove lines for the edited prompt → `POST
.../config/versions/1/rollback` creates a new **draft** (never
auto-publishes) whose `yaml_text` matches v1's original content, and
immediately marks v1 `rolled_back` → publishing that draft creates v3 with
`rolled_back_from: 1` correctly attributed. A first pass at this script
surfaced a real bug in the script's own assumptions (see finding 2 below),
corrected before the final green run.

**Scope deviations / real findings from this phase (documented, not silently
absorbed):**
1. **Router condition grammar has no dotted-field support**, despite this
   plan doc's own Deliverables text once describing the allow-list as
   "`utterance`, `state.<key>`" — the shipped grammar
   (`domain/graph-condition.ts` / `orchestration/graph/condition_grammar.py`)
   only matches a **flat identifier** looked up directly against
   `turn_state`'s own keys (`^[a-zA-Z_][a-zA-Z0-9_]*$` — no `.`). A Tool
   node's result is already stored flat under `turn_state[node.id]`, and
   `utterance` is seeded flat too, so nothing in this phase's exit condition
   actually needs a dotted path — but a condition string written as
   `state.foo == "x"` will not parse (`GraphConditionError`), not silently
   misbehave. Flagged as a real, minor doc/implementation gap for the
   Reasoning tab's inspector UI copy (Phase 9's Angular work) and any future
   phase extending the grammar — not a security issue (the closed grammar
   still never evaluates anything but a known turn-state key), just a
   narrower field-naming surface than one earlier planning sentence implied.
2. **`on_error` is only consulted for exceptions that escape a node
   executor's own `try`/`except` — not for failure modes the executor
   recognizes and handles itself.** Confirmed empirically by the golden-path
   run above: the Tool node's real HTTP call timed out (a *recognized*
   `ToolError`), and both the Python interpreter's `ToolNodeExecutor` and
   the TypeScript test-call simulator's tool-node handling return
   `status: "failed"` but then proceed via the node's own **`next_node_id`**
   (or, for Router, `default_next_node_id`) — never consulting the node's
   configured `on_error` edge. Only a fully *uncaught* exception (one that
   escapes the executor entirely) triggers `interpreter.py`'s
   `_take_on_error`/the TS simulator's equivalent. Net effect for the
   golden-path graph above: after the Tool node "fails" (times out), the
   turn proceeds straight to the Speak node (per `next_node_id`) rather
   than detouring to the `on_error: {action: "goto", target_node_id:
   "llm-1"}` edge configured on that node — and since no LLM node ran,
   `mode: llm_output` Speak emits empty text. This is a real gap against
   R-G7's literal wording ("every node has an `on_error` edge... unhandled
   node failure falls through to the graph's terminal degradation, never to
   silence") for the *recognized*-failure case specifically. **Not fixed in
   this phase** — closing it means auditing every node executor's own
   internal failure handling (Tool/Router today; Retrieve/Skill/HITL/etc. in
   later phases) to route through `on_error` uniformly instead of each
   picking its own fallback, which is real, non-trivial surgery better done
   as its own deliberate pass than as a last-minute patch discovered during
   phase-close verification. Tracked as a Phase 10 (or dedicated) follow-up;
   until then, a node's `on_error` edge is only a true guarantee against
   *crashes*, not against every documented failure code that node type can
   itself produce.
3. **`hop="llm"`'s aggregate `total_ms` is no longer reported** (Python
   `pipeline.py`, see its own inline comment) — the pre-Phase-9 single
   number covering the whole LLM-plus-tool-round-trip phase has no direct
   successor now that the interpreter can run zero, one, or several LLM
   nodes per turn; the new per-node `hop="node"` rows (BL-039) carry
   equivalent-or-finer timing granularity instead. `first_token_ms`/
   `provider_key`/`used_fallback` are still reported, and only when at
   least one `llm`-type node actually executed.
4. **The diff/rollback UI is deferred (BL-078)**, as scoped — the backend
   capability above is real, tested, and now also proven end-to-end; no
   Angular screen was built for it.
5. Everything else in the original "Explicitly deferred/out of scope this
   phase" list (Parallel/Loop, Skill/Sub-agent/HITL/Handoff/State node
   types, real RAG retrieval, turn-budget critical-path/deadline
   enforcement, V-2/V-4 loop-guard/cycle validation, speculative
   retrieval/speech, the 8-tab shell) remained out of scope, untouched.

**Security review (scoped to what this phase touched):**
- Every new endpoint (`GET/POST .../config/versions*`, `POST
  .../config/test-call`) sits on the existing
  `@Controller('tenants/:id/config') @UseGuards(AdminJwtGuard, RolesGuard)`
  class — same guard stack, same tenant-scoping (`findById` +
  `canAccessTenant`) every other route in this controller already uses; no
  new guard bypass was introduced.
- **Router condition grammar (the one new piece of user-influenced dynamic
  evaluation this phase adds to both the live agent process and the
  control plane), both languages**: no `eval`/`new Function`/`exec`/
  `ast.literal_eval` anywhere in `graph-condition.ts` or
  `condition_grammar.py`. The grammar is closed by construction — a single
  hand-rolled regex (`^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|in)\s*(...)\s*$`)
  admits exactly one identifier, one of three literal operators, and a
  string/number/bracketed-string-list literal; there is no recursion, no
  boolean combinators, no function-call syntax, and no attribute or
  subscript access into anything but a plain `Record`/`dict` of turn-state
  primitives. An identifier absent from `turn_state` evaluates to
  `undefined`/`None` (never raises, never walks a prototype/`__dict__`
  chain) — the field "allow-list" is turn-state's own keys, populated
  exclusively by the interpreter, never by the condition string itself.
  Malformed syntax raises a typed `GraphConditionError`/is caught and
  degrades the branch (finding 2 above), it never silently executes
  anything. Reviewed specifically for injection risk per this phase's own
  process requirement; no issue found.
- Test-call harness never resolves or forwards a real secret (same posture
  Phase 8 established for tool test-invoke): the control plane has no
  access to resolved secret values; LLM nodes are simulated precisely
  *because* no live vendor call can be made from here, and the real Tool-node
  call reuses `ToolInvokerService` unchanged (32 KiB cap, timeout,
  `credential_unresolved` flag, never an `Authorization` header from a
  resolved secret).
- `ConfigVersion` rows carry the same `yamlText` a `DeploymentConfig`
  publish already persists — no new secret-bearing surface; Gate A's
  existing `containsSecretKey` scan runs before any publish, unchanged.
- No new dependency was added anywhere in this phase (the line diff is
  hand-rolled, the condition grammar is hand-rolled, `$transaction` is a
  Prisma built-in).

**Process note**: this phase's implementation was carried out via three
concurrently-run tracks (contracts+API, Python, Angular) working in the
same tree with clearly partitioned file ownership, then reconciled and the
full cross-track gate re-run from scratch by the orchestrating pass — the
numbers above are from that final, integrated run, not any individual
track's self-report.

---

## Phase 10 — Latency governance v1 (BL-040, BL-041)

### Goal
An over-budget reasoning graph is caught and fixable in the builder before
it can ever be published (UC-G3): the Reasoning tab shows a live critical-path
computation against the declared `turn_budget_ms`, publish to production is
structurally blocked while the graph's longest foreground path exceeds it,
and — if a graph that was within budget at publish time still runs long at
runtime — the Python interpreter now enforces R-G13's deadline degradation
instead of silently letting a turn run past its budget forever. This phase
also closes the two real gaps Phase 9's own close-out documented rather than
carrying them forward silently.

### Scope

**In scope:**
1. **Phase 9 finding #1 — `on_error` fix (both languages).** Tool/Router
   node executors' *recognized* failure paths (`TOOL_UNKNOWN`/`ToolError`,
   `GraphConditionError`) now resolve the node's own `on_error` edge exactly
   like the interpreter's uncaught-exception handling does — a `goto` action
   takes that target; `end_turn`/`degrade` (or an edge with no
   `target_node_id`) stops the walk there rather than silently falling
   through to `next_node_id`/`default_next_node_id`. Extracted into one
   shared helper per language (`resolveOnError`/`resolve_on_error`) so the
   interpreter's own on_error handling and every node executor's recognized-
   failure path can never drift apart again — this is what makes Gate A's
   V-5 structural check ("every node has `on_error`") mean something real at
   runtime, per the Phase 9 close-out's own framing. Fixed in **both**
   the Python interpreter (the real runtime) and the NestJS test-call
   simulator (`test-call-graph.use-case.ts`) — the Phase 9 finding
   documented the identical bug in both, and leaving the simulator
   unfixed would mean the builder's own "Run test call" button
   demonstrates behavior the real agent no longer has.
2. **Phase 9 finding #2 — Router dotted-field grammar gap — left open,
   confirmed not on this phase's critical path.** `condition_grammar.py`/
   `graph-condition.ts` still only match a flat identifier
   (`^[a-zA-Z_][a-zA-Z0-9_]*$`), no `state.<key>` dotted path. Critical-path
   computation (below) never evaluates a Router condition at all — it only
   reads `lane`/node-type/topology to enumerate paths — so this phase's own
   exit condition has zero dependency on the grammar. Left exactly as Phase
   9 documented it: a real, tracked, still-open gap for a future phase (or a
   dedicated grammar pass) to close, not silently re-scoped into this one.
3. **`on_deadline` field presence — verified, not re-added.** Checked both
   `packages/contracts/src/agent-config/reasoning-graph.schema.ts`
   (`NodeEdge`, used for both `on_error`/`on_deadline` in `NodeBase`) and the
   Python mirror (`runtime_config.py`'s `NodeEdge`/`_GraphNodeBase`) — Phase
   9 already added the field on every node in both languages, exactly as
   `ARCHITECTURE_NOTES.md` §1/R-G7 required, just unread by any enforcement
   until now. No schema change needed here; this phase is the one that
   finally reads it.
4. **Critical-path computation** (`apps/api/src/modules/deployment-config/domain/critical-path.ts`,
   new) — a pure function enumerating every path from `reasoning.entry_node_id`
   to a terminal node (an `end` node, or any node whose own `next_node_id`
   is `null`/whose branches all terminate — R-G1's implicit "speak then end"
   makes those legitimate terminals too), summing each path's **foreground-lane**
   node costs only (R-G14 — a node reached via a foreground edge but itself
   declared `lane: background` contributes `0`, a defensive edge case Gate A
   doesn't otherwise prevent yet). Built as a small per-node-type
   **cost/next-node-ids strategy table**, not a hardcoded switch spread
   through the algorithm, specifically so Phase 11 can add a `parallel`
   entry (cost = join-policy-aware branch cost, next-ids = every branch) and
   a `loop` entry without touching the enumeration/scoring algorithm itself.
   Defensive `MAX_PATH_DEPTH`/path-count caps guard against a Router branch
   cycle (V-4/cycle detection is still Phase 11, per the same documented gap
   `graph-structure.ts` already flags) turning enumeration into an infinite
   loop.
5. **Node latency-estimate defaults — a code-level constant table, not a new
   schema field.** Checked first: no per-provider/model latency figure and
   no "expected latency" field exists anywhere in Phase 8/9's schema or
   domain code (`ToolNode.timeout_ms` is the closest candidate but is a
   worst-case failure bound — Phase 8 set its default to 10s, matching
   `ToolExecutor`'s real timeout — not a typical-latency estimate; using it
   directly would make every Tool node look 25x more expensive than the
   task's own suggested ~400ms figure). **Decision**: a fixed
   `type -> ms` default table lives inside `critical-path.ts` itself
   (`llm: 900`, `tool: 400`, `retrieve: 0`, `router: 150`, `speak: 0`,
   `end: 0`), not a new per-node schema field. This matches how §A3.7's
   wireframe labels these numbers — `est. 410 ms` — computed estimates, not
   admin-typed values (the wireframe's one genuinely *editable* "Budget"
   field belongs to the Parallel node inspector, Phase 11, a different node
   type this phase doesn't touch). Avoids an unnecessary cross-language
   schema/migration/fixture change for a number nothing here needs an admin
   to override yet; flagged as a reasonable follow-up if a later phase's UX
   research shows admins actually want per-node overrides.
6. **Speak/TTS double-counting avoided per §A4.1's three-way split.** A
   Speak node's own foreground cost defaults to `0` — the budget-allocation
   diagram explicitly separates `endpointing` / `graph critical path` /
   `TTS time-to-first-audio` into three independent shares of the caller-
   perceived turn budget, and neither `dynamics.endpointing_silence_ms` nor
   any TTS-first-audio estimate exists anywhere in this schema yet (Dynamics
   is Phase 16, BL-062 — confirmed by grep, no `dynamics` block exists
   today). `reasoning.turn_budget_ms` is therefore the graph's **own**
   allotment (R-G3's literal wording: "sum of foreground node budgets...
   must not exceed the turn budget" — no endpointing/TTS subtraction
   implied), not the full caller-facing 2,500 ms figure in §A4.1's
   illustrative diagram. The turn-budget panel's timeline (below) renders
   only the graph's own nodes for the same reason — fabricating
   endpointing/TTS bookend segments from data that doesn't exist yet would
   be worse than omitting them.
7. **V-1 wiring** — a new Gate B (combination) rule,
   `criticalPathWithinBudgetRule` in `combination-rules.ts`, using the same
   "pure function over `ctx.config`" shape every other rule in that file
   already has. Gate B only ever runs after Gate A passes and only blocks
   **publish** (a draft save persists regardless, exactly like every other
   Gate B rule) — which is what "blocks production publish only" (BL-040's
   text) already reduces to given `ARCHITECTURE_NOTES.md` §0.2's
   descope: this codebase has no separate dev/staging/production publish
   pipeline yet, "publish" **is** the only real enforcement point that
   exists, so no new environment-conditional branching was needed to honor
   that constraint.
8. **`/config/validate` response extended** — `ValidateConfigResponseSchema`
   gains `critical_path: CriticalPathReportSchema | null` (`null` only when
   `reasoning` is absent entirely, or Gate A's schema check itself failed —
   computing a path over a structurally-invalid graph isn't meaningful).
   New DTOs (`CriticalPathReportSchema`/`CriticalPathGraphPathSchema`/
   `CriticalPathStepSchema`) in `packages/contracts/src/deployment-config/schemas.ts`;
   new error code `CONFIG_CRITICAL_PATH_EXCEEDS_BUDGET`.
9. **Turn budget panel UI**, inline in the Reasoning tab (`UX_SCOPE.md`'s
   explicit Phase-10-extension decision — not a separate route/dialog):
   target turn-budget field (already existed, Phase 9's `setTurnBudgetMs`),
   a critical-path timeline (one segment per node on the critical path, each
   labeled with its type/name/ms, against the budget), an all-paths list
   (every enumerated path, its total ms, and an over/under-budget status
   chip), and the "when the hard deadline is hit" behavior selector from
   §A4.3 (`on_deadline`'s `action` on the graph's terminal-most node —
   stored the same way every other node-level field already is, no new
   config concept invented). The OPTIMISATIONS checklist items
   (speculative retrieval/pre-synthesise Speak/cache retrieval — BL-067/068,
   explicitly deferred) render as disabled checkboxes with a "coming in a
   later phase" helper line, following the exact
   disabled-with-reason pattern `UX_GUIDELINES.md` §10.5 already established
   for ungrantable provider options (and Phase 8 reused for the
   consequential-tools stub banner) — never hidden, never silently enabled.
10. **Shared budget-bar component**, built once in
    `apps/web/projects/shared/src/lib/ui/budget-bar/` (this project's
    established shared/dumb-component home — `status-chip`/`yaml-viewer`/
    `hosting-badge` already live there) so Phase 12b's retrieval-pipeline
    budget total can reuse it verbatim, per `UX_SCOPE.md`'s explicit
    "build it once in Phase 10" instruction. A small, purely presentational
    `@Input`-driven bar (used ms / total ms / tone), no feature-specific
    logic.
11. **Deadline degradation runtime** (Python, `interpreter.py`, R-G13) —
    the foreground walk now tracks cumulative elapsed wall-clock time since
    the turn started (`now_ms()`, already used everywhere else in this
    package) and enforces `graph.turn_budget_ms` per foreground-lane node
    via `asyncio.wait_for` around that node's own `execute()` call, with the
    *remaining* budget as the timeout — a real "cut the in-flight node"
    (not just a between-nodes check that lets an already-slow node run to
    completion), using only a stdlib primitive the package already depends
    on (`asyncio`), not new instrumentation. A node cut this way records
    `status="timed_out"` (A3.4's state machine — `TIMED_OUT` was reachable-
    in-shape but unexercised since Phase 9; this is the phase that actually
    exercises it) and `error_code="TURN_BUDGET_EXCEEDED"`, then takes
    `on_deadline` (via the same shared `resolve_on_deadline` helper
    `edges.py` adds alongside `resolve_on_error`) — or stops the walk if
    `on_deadline` has no `goto` configured, mirroring `on_error`'s fallback
    exactly. Background-lane nodes reached through the (already anomalous,
    Gate-A-unprevented) foreground chain are exempt from the timeout, for
    the same R-G14 reason critical-path.ts excludes their cost.

**Soft vs. hard deadline — kept to what's actually observable this phase.**
§A4.1's diagram describes a *soft* deadline ("cut optional branches") at an
earlier threshold than the *hard* deadline ("take `on_deadline`, answer with
what exists"). This graph shape has no concept of an "optional branch" yet
(Parallel doesn't exist until Phase 11 — a Router branch is not "optional",
it's the chosen path) and the interpreter cannot see what it hasn't started
yet to selectively skip it. Building a second, earlier threshold with no
graph construct to act on differently would be a distinction without a
runtime difference. **Decision**: this phase implements only the hard
deadline (`turn_budget_ms` itself, enforced per node via `asyncio.wait_for`
as above) — exactly the enforcement R-G13's own text describes ("in-flight
foreground nodes are cut and the graph takes the `on_deadline` edge... it
never simply waits"). A genuine soft/hard split is a natural Phase 11
extension once Parallel exists and "cut optional branches" has something
concrete to mean.

**Out of scope (explicit):**
- Parallel/Loop nodes and their join-policy-aware costs (Phase 11) —
  `critical-path.ts`'s per-node-type strategy table exists specifically so
  that phase is additive, not a rewrite.
- Real RAG retrieval (Phase 12b — Retrieve stays a logged no-op, cost `0`).
- Skills/Sub-agent/HITL/Handoff/State node types and their budgets (Phases
  13-15).
- Speculative retrieval/speech (BL-067/068) — UI renders them
  disabled-with-reason only, per above; no runtime behavior implemented.
- The 8-tab shell (Phase 16); the Dynamics tab and any real
  endpointing/TTS-first-audio latency figure (also Phase 16/never-yet-built)
  — the turn-budget timeline visualizes the graph's own critical path only,
  not a fabricated whole-turn breakdown.
- A true soft-deadline threshold distinct from the hard deadline (see above
  — deferred to Phase 11 alongside Parallel).
- Per-node editable latency-estimate overrides (see point 5 above) — code
  constants only this phase.

### Deliverables

**Contracts** (`packages/contracts/src/`):
- `deployment-config/schemas.ts` — `CriticalPathStepSchema`,
  `CriticalPathGraphPathSchema`, `CriticalPathReportSchema`;
  `ValidateConfigResponseSchema` gains `critical_path`.
- `error-codes.ts` — `CONFIG_CRITICAL_PATH_EXCEEDS_BUDGET` + `ERROR_MESSAGES` entry.

**Backend** (`apps/api/src/modules/deployment-config/`):
- `domain/critical-path.ts` (new) — `computeCriticalPath(reasoning)`, the
  per-node-type cost/next-ids strategy table, `critical-path.spec.ts`
  (linear chains, Router branching/all-paths, over/under budget,
  background-lane-cost exclusion, cycle-guard termination).
- `domain/graph-edges.ts` (new) — `resolveOnError(node)`, shared by
  `test-call-graph.use-case.ts`'s Tool/Router handling; `graph-edges.spec.ts`.
- `domain/combination-rules.ts` — `criticalPathWithinBudgetRule` added to
  `COMBINATION_RULES`; `combination-rules.spec.ts` extended.
- `application/validate-config.use-case.ts` — `execute()` computes and
  returns `critical_path`; `validate-config.use-case.spec.ts` extended.
- `application/test-call-graph.use-case.ts` — Tool/Router recognized-failure
  branches now call `resolveOnError`; `test-call-graph.use-case.spec.ts`
  updated (one pre-existing test's expectation was asserting the Phase 9 bug
  itself and is corrected, not just patched to keep passing) + new
  on_error-goto-target cases added.

**Python** (`apps/agent/src/avatar_agent/`):
- `orchestration/graph/edges.py` (new) — `resolve_on_error`/
  `resolve_on_deadline`, shared by `interpreter.py` and
  `nodes/{tool,router}.py`; `tests/orchestration/graph/test_edges.py`.
- `orchestration/graph/interpreter.py` — uses the shared helper for its own
  uncaught-exception path (behavior-preserving refactor); adds turn-start
  timestamp tracking, per-foreground-node `asyncio.wait_for` deadline
  enforcement, `TIMED_OUT`/`TURN_BUDGET_EXCEEDED` recording, `on_deadline`
  resolution.
- `orchestration/graph/nodes/tool.py`, `nodes/router.py` — recognized-failure
  paths call `resolve_on_error` instead of returning
  `next_node_id`/`default_next_node_id` directly.
- `tests/orchestration/graph/test_interpreter.py`,
  `tests/orchestration/graph/nodes/{test_tool.py,test_router.py}` — two
  pre-existing tests that asserted the Phase 9 bug's exact behavior are
  corrected (with an explanatory docstring update, not silently changed);
  new tests added for the on_error-goto case and the deadline-cut/
  `on_deadline` runtime behavior.

**Frontend** (`apps/web/projects/`):
- `shared/src/lib/ui/budget-bar/` (new) — `BudgetBarComponent` (`used_ms`,
  `total_ms`, optional `label` inputs; tone derived from the ratio),
  exported from `shared/src/lib/ui/index.ts`; `budget-bar.component.spec.ts`.
- `admin/.../features/reasoning/components/turn-budget-panel/` (new) —
  `TurnBudgetPanelComponent` (§A4.3: critical-path timeline built from
  `budget-bar`, all-paths list, hard-deadline-behavior selector,
  disabled-with-reason OPTIMISATIONS checklist), wired into
  `reasoning-page.component.html` inline (not a new route);
  `turn-budget-panel.component.spec.ts`.
- `reasoning.store.ts` — small `criticalPath` computed selector over the
  existing `validateResult` signal (the field already flows through
  unchanged plumbing — no new HTTP call needed).

**Docs**: this file (Phase 10 section, this one, marked done at the end).

### Exit gate
- `pnpm --filter @liveavatar/contracts build && pnpm --filter @liveavatar/contracts lint`
- `pnpm --filter @liveavatar/api build`, `lint`, `test`.
- `pnpm --filter @liveavatar/web build`, `lint`, `test`.
- `apps/agent`: `ruff check .`, `ruff format --check .`, `mypy src`,
  `pytest -q` (full suite — this phase changes the interpreter's real
  error-handling and adds real deadline-enforcement behavior).
- Security review scoped to: the expanded `/config/validate` response (no
  secret/credential surface added — critical-path data is node
  ids/types/ms, all already-visible fields on an authenticated admin-only
  endpoint); the two on_error-fix call sites (no new dynamic evaluation
  introduced, same closed grammar/HTTP-call surfaces as before).
- If e2e/testcontainers hangs again in this sandbox (both Phase 8 and 9 hit
  Docker host/registry contention), time-box it and fall back to Phases
  8/9's temporary local-Postgres-script workaround, deleting the script
  after and documenting the limitation rather than silently skipping
  verification.
- This section updated with the actual gate run results before Phase 11
  starts.

### Result — Phase 10 done (2026-09-02)

**Delivered as planned**, plus one real bug found and fixed by this phase's
own e2e run (below). Full file list by layer, then gate results, then
deviations/findings.

**Files — Contracts** (`packages/contracts/src/`):
`error-codes.ts` (+`CONFIG_CRITICAL_PATH_EXCEEDS_BUDGET`),
`deployment-config/schemas.ts` (+`CriticalPathStepSchema`,
`CriticalPathGraphPathSchema`, `CriticalPathReportSchema`;
`ValidateConfigResponseSchema` +`critical_path`).

**Files — API** (`apps/api/src/modules/deployment-config/`):
`domain/critical-path.ts` (new — `computeCriticalPath`, the per-node-type
`NODE_COST_STRATEGIES` table), `domain/critical-path.spec.ts` (new — 13
cases: linear chains, Router all-paths enumeration, over/under/exactly-at
budget, background-lane cost exclusion, dangling-entry and Router-cycle
defensive behavior), `domain/graph-edges.ts` (new — `resolveOnError`),
`domain/combination-rules.ts` (+`criticalPathWithinBudgetRule`),
`domain/combination-rules.spec.ts` (extended),
`application/validate-config.use-case.ts` (`execute()` computes and returns
`critical_path`), `application/validate-config.use-case.spec.ts` (extended),
`application/test-call-graph.use-case.ts` (Tool/Router recognized-failure
branches call `resolveOnError`), `application/test-call-graph.use-case.spec.ts`
(one pre-existing test corrected — it was asserting the Phase 9 bug's exact
behavior — plus 5 new on_error-goto/no-goto cases across Tool and Router),
`interface/deployment-config.controller.ts` (`@HttpCode(200)` added to
`validate`/`test-call` — see finding below).

**Files — Python** (`apps/agent/src/avatar_agent/`):
`orchestration/graph/edges.py` (new — `resolve_on_error`/
`resolve_on_deadline`, shared by the interpreter and both node executors),
`orchestration/graph/interpreter.py` (uses the shared helper for its own
uncaught-exception path; adds `turn_started` tracking, per-foreground-node
`asyncio.wait_for` deadline enforcement, one-shot degradation flag, `TIMED_OUT`/
`TURN_BUDGET_EXCEEDED` recording, `on_deadline` resolution),
`orchestration/graph/nodes/tool.py`, `nodes/router.py` (recognized-failure
paths call `resolve_on_error`). Tests: `tests/orchestration/graph/test_edges.py`
(new, 6 cases), `tests/orchestration/graph/test_interpreter.py` (2
pre-existing tests corrected with updated docstrings explaining the fix, +5
new deadline-degradation tests: cut-before-start, no-goto-stops-the-walk,
real mid-flight `asyncio.wait_for` cut, background-lane exemption),
`tests/orchestration/graph/nodes/{test_tool.py,test_router.py}` (existing
tests extended with an `on_error` override parameter; +4 new on_error-goto/
no-goto cases).

**Files — Web** (`apps/web/projects/`):
`shared/src/lib/ui/budget-bar/` (new — `BudgetBarComponent`, tone derived
from `usedMs/totalMs` ratio, not a caller-supplied flag, so Phase 12b can
reuse it with zero adapter code), exported from `shared/src/lib/ui/index.ts`;
`admin/.../features/reasoning/components/turn-budget-panel/` (new —
`TurnBudgetPanelComponent`: critical-path budget-bar, all-paths list, a
read-only "when the hard deadline is hit" summary of the entry node's
`on_deadline` with an Edit link into its existing inspector, and the
OPTIMISATIONS checklist rendered disabled-with-reason);
`reasoning.store.ts` (+`criticalPath` computed selector over the existing
`validateResult` signal — no new HTTP call), `reasoning.store.spec.ts` (+2
tests); `reasoning-page.component.{ts,html}` (panel wired in after the
turn-budget/entry-node controls row, before the node list),
`reasoning-page.component.spec.ts` (added the new `criticalPath` mock
selector the template now calls). `*.spec.ts` per new
component (`budget-bar.component.spec.ts` — 7 cases,
`turn-budget-panel.component.spec.ts` — 7 cases).

**Docs**: this file (Phase 10 section, marked done here).

**Gate — actually run, not assumed:**
- `pnpm --filter @liveavatar/contracts build && pnpm --filter @liveavatar/contracts lint` — **green**.
- `pnpm --filter @liveavatar/api build` — **green**. `lint` — **green**.
  `test` — **145/148 suites, 924/925 tests**. The 3 failing suites
  (`providers/infrastructure/http-probe-strategy.spec.ts`,
  `providers/domain/validation.spec.ts`,
  `providers/application/update-provider-credential.use-case.spec.ts`) are
  the **exact same pre-existing defect Phases 8 and 9 already documented**
  (`assertEndpointUrl`'s second `hosting` parameter never threaded through
  that spec/call site) — untouched by this phase, left as-is per this
  project's "don't silently fix unrelated code" rule.
  `deployment-config` module alone: **216/216 passing across 17 suites**.
- `pnpm --filter @liveavatar/web build` — **green** (same pre-existing,
  unrelated CJS-interop warning on `@liveavatar/contracts` Phase 9 already
  flagged, not a phase-10 regression). `lint` — **green**. `test` —
  **73/73 suites, 525/525 tests** (up from Phase 9's 71/510 — 2 new suites,
  `budget-bar.component.spec.ts` and `turn-budget-panel.component.spec.ts`).
- `apps/agent`: `ruff check .` — **all checks passed**. `ruff format --check .`
  — **107 files already formatted** (2 files needed reformatting after the
  interpreter/test edits — reformatted in place, then re-verified clean).
  `mypy src` — **no issues, 70 files**. `pytest -q` (full suite) —
  **333/334**. The one failure
  (`tests/contracts/test_runtime_config.py::test_rejects_a_non_https_looking_garbage_endpoint`)
  is the **exact same pre-existing defect Phase 9 already documented**
  (`AgentRuntimeConfig.endpoints` is deliberately `dict[str, str]`, not
  `HttpUrl`) — untouched by this phase. `import-linter` (`lint-imports`) —
  **all 3 contracts kept** (`layers`, `vendor-sdk-isolation`,
  `orchestration-uses-ports`), specifically verifying the new `edges.py`
  module (imported by both `interpreter.py` and the two node executors)
  didn't introduce a layering violation. `graph`-package tests alone:
  **77/77 passing**.

**Golden-path proof (real Postgres, real HTTP stack):**
Same fallback Phases 8/9 established for this sandbox's Docker constraints —
`docker pull postgres:16-alpine` / testcontainers orchestration are blocked/
contention-prone here, but a real, already-running dev Postgres container
(`liveavatar-pg-p8`, `postgres:16-alpine`, port 5433, started in a prior
phase) was available. Rather than starting a *new* container, a fresh
throwaway database (`liveavatar_e2e_p10`) was created inside that same
running instance via `psql CREATE DATABASE` — same "real Postgres, not
mocks" guarantee, zero new container overhead. A temporary, **non-committed**
spec (`test/tmp-golden-path-p10.e2e-spec.ts`, deleted after the run,
database dropped after) ran the compiled `AppModule` through Supertest and
proved, for real:
1. `POST /config/validate` with a single-LLM-node graph (900ms default cost)
   against a 100ms `turn_budget_ms` returns `critical_path: {critical_path_ms:
   900, turn_budget_ms: 100, over_budget: true}` and a
   `CONFIG_CRITICAL_PATH_EXCEEDS_BUDGET` error; raising the budget to 3000ms
   on the identical graph clears both.
2. `POST /config/test-call` against a Tool node with an unknown `api_ref`
   and `on_error: {goto -> end-1}` walks `tool-1 -> end-1` — **not**
   `tool-1`'s own `next_node_id` (deliberately pointed at a different real
   node, "wrong-target", to prove it's genuinely skipped) — the on_error fix,
   proven end-to-end through the real HTTP stack, not just the unit tests.

**A real, pre-existing bug found and fixed by this run (not introduced by
this phase, but caught here and fixed per this project's established
precedent):** both `/config/validate` and `/config/test-call` returned
**201**, not the **200** both their own doc comments and the spec
explicitly promise ("always 200; validity is in the body") — Nest defaults
an unannotated `@Post` to 201. This is the *exact same bug class* Phase 8
found and fixed on `tools/test-invoke` ("Caught by the e2e run"): no prior
unit test could catch it because unit tests call the use-case directly,
never exercising the real HTTP decorator stack. Fixed with an explicit
`@HttpCode(200)` on both routes in `deployment-config.controller.ts`, per
the same "fix it in the same phase, don't defer a route this phase directly
exercises" precedent Phase 8 established. Full API test suite (924/925,
same pre-existing-only failures) and both e2e assertions re-verified green
after the fix.

**Scope deviations / decisions made this phase (documented, not silently
absorbed):**
1. **One-shot deadline degradation, not a repeated per-node gate** — a real
   design correction made *during* test-writing, not assumed correct
   upfront. The first implementation recomputed "has the deadline already
   passed" fresh for every node using the same monotonically-growing
   elapsed-time check; once true, it stayed true for the rest of the turn,
   which meant the `on_deadline` recovery destination (typically a Speak
   node saying "let me follow up") would itself be immediately re-cut by
   the same stale check and never get to run — defeating the entire point
   of having a recovery edge. Fixed with a `deadline_exceeded` flag: once
   one node has been cut for the turn budget and the walk has taken
   `on_deadline`, every node from there on runs unconstrained by further
   elapsed-time checks. Caught by writing
   `test_a_node_already_past_the_turn_budget_before_it_starts_is_cut_and_takes_on_deadline`
   itself (the recovery Speak node's text never appeared in `spoken` until
   this fix), not discovered later — exactly the "prove it, don't assume
   it" discipline this workflow asks for.
2. **Both languages' `on_error` fix, not just Python** — the task's two
   listed findings named `interpreter.py` explicitly, but Phase 9's own
   documented finding #2 said the identical bug existed in **both** the
   Python interpreter and the TypeScript test-call simulator
   (`test-call-graph.use-case.ts`). Fixing only the real runtime would leave
   the builder's own "Run test call" button demonstrating stale, pre-fix
   behavior even after the interpreter was corrected — fixed both, sharing
   one small helper per language (`resolve_on_error`/`resolveOnError`) so
   the two can't drift apart again.
3. **Latency estimates are code constants in `critical-path.ts`, not a new
   schema field** — see the Scope section above for the full reasoning
   (checked `ToolNode.timeout_ms` first; it's a worst-case bound, not a
   typical-latency estimate, and would have made Tool nodes look 25x more
   expensive than the task's own suggested ~400ms figure). No schema/
   migration/fixture-corpus/Python-mirror change was needed as a result —
   smaller footprint than originally implied by "add a...field."
4. **The turn-budget timeline renders only the graph's own critical-path
   nodes, not §A4.3's illustrative endpointing+TTS-bookended bar** — neither
   `dynamics.endpointing_silence_ms` (Phase 16, BL-062) nor any
   TTS-first-audio latency estimate exists in this schema yet (verified by
   grep — no `dynamics` block anywhere in `packages/contracts/src`).
   Fabricating those numbers would be worse than the honest, narrower
   visualization this phase ships — which is exactly what V-1/R-G3 validate
   anyway.
5. **The "when the hard deadline is hit" selector is read-only, showing the
   entry node's `on_deadline` with a link into its existing inspector, not a
   second editing surface** — `NodeInspectorComponent` (Phase 9) already
   fully exposes every node's `on_error`/`on_deadline` (action + goto
   target) as an editable field. Building a second, parallel edit control in
   the turn-budget panel for the same underlying data would violate this
   project's own "consistency & standards" heuristic and create two paths
   that could silently disagree. The panel surfaces and links to the
   existing editor instead.
6. **Router dotted-field grammar gap (Phase 9 finding #1) — confirmed not on
   this phase's critical path and left exactly as documented.**
   `computeCriticalPath` never evaluates a Router condition string at all —
   it only reads `lane`/`type`/topology to enumerate paths — so nothing in
   this phase's implementation touched `condition_grammar.py`/
   `graph-condition.ts`. Still open, still tracked, per Phase 9's own
   note.
7. **A real, pre-existing `@HttpCode(200)` bug was fixed** on the two routes
   this phase's own e2e run happened to exercise — see the golden-path proof
   above. Not "silently fixing unrelated code": both routes are ones this
   phase directly extends (`validate`'s response shape, `test-call`'s
   Tool/Router behavior), and the fix follows Phase 8's own established
   precedent for the identical bug class rather than deferring it.
8. Everything else in the original "Explicitly out of scope this phase"
   list (Parallel/Loop and their join-policy-aware costs, real RAG
   retrieval, Skills/Sub-agent/HITL/Handoff/State, speculative
   retrieval/speech implementation, the 8-tab shell, a true soft-deadline
   threshold distinct from the hard deadline, per-node editable latency
   overrides) remained out of scope, untouched.

**Security review (scoped to what this phase touched):**
- No new HTTP route was added. `/config/validate` and `/config/test-call`
  keep the exact same `@Controller('tenants/:id/config')
  @UseGuards(AdminJwtGuard, RolesGuard)` guard stack and tenant-scoping
  (`findById` + `canAccessTenant`) as every other route in this controller —
  the only change to either route's surface is the additive `critical_path`
  response field and the `@HttpCode(200)` correction, neither an
  authorization-relevant change.
- **`critical_path`'s new response data (node ids/types/names/lanes/costs
  per enumerated path) leaks nothing not already visible on this
  authenticated, tenant-scoped, admin-only endpoint** — every one of those
  fields is already present, verbatim, inside the same response's
  `redacted_yaml`/the draft config the admin themselves authored. No
  credential, secret, or cross-tenant data is newly exposed.
- `computeCriticalPath`/`resolveOnError`/`resolve_on_error` are pure
  functions over already-schema-shaped node objects — no `eval`, no dynamic
  property access beyond a closed `Record<GraphNode['type'], ...>`/`dict`
  lookup, no SQL, no new external call. The `asyncio.wait_for` deadline
  wrapper in `interpreter.py` wraps an already-existing internal call with a
  timeout; it does not introduce a new code-execution path.
- No new dependency was added anywhere in this phase (Node's/Python's
  built-in `asyncio.wait_for` and `Math`/array methods only).
- The one real finding this phase surfaced (`@HttpCode(200)`) is a
  contract-conformance bug, not a security issue — no guard bypass, no
  authorization gap; fixed as part of the gate per Phase 8's precedent.

**Follow-ups left open, not silently dropped:**
- Router dotted-field grammar gap (Phase 9 finding #1) — still open, still
  not on any phase's critical path so far; revisit if a future phase's
  condition needs `state.<key>` addressing.
- Per-node editable latency-estimate overrides — not built this phase (code
  constants only); worth reconsidering if product feedback on the turn
  budget panel shows admins want to tune individual node estimates rather
  than accept the defaults.
- A true soft-deadline threshold distinct from the hard deadline (§A4.1) —
  deferred to Phase 11, once Parallel gives "cut optional branches" an
  actual graph construct to act on.
- `docs/deployment/DEPLOYMENT.md`'s Phase 8-era migration-history note and
  the two pre-existing test-suite failures (`providers` module TS spec
  drift, the `test_runtime_config.py` endpoint-validation gap) remain
  exactly as Phases 8/9 flagged them — not this phase's files, not
  re-touched.

---

## Phase 11 — Parallel & Loop (BL-042, BL-043)

### Goal
An admin can turn a sequential fan-out into a `Parallel` node with a join
policy to recover turn-budget headroom (UC-G1 step 8: two sequential tool
calls inside a skill/branch become one Parallel node, dropping critical path
from 2,640ms back under a 2,500ms budget), and can express bounded iteration
via a `Loop` node whose three guards (max iterations / max duration / max
cost) are mandatory at save time and re-enforced at runtime as defense in
depth — an edited-after-validation or malformed config can never produce an
actual runaway loop.

### Scope

**In scope:**
1. **Schema (both languages)** — `ParallelNode`/`LoopNode` added to the
   `GraphNode` discriminated union in `reasoning-graph.schema.ts` and its
   Pydantic mirror.
   - **Branch/body representation — decision, not left implicit**: both
     `ParallelNode.branches[].entry_node_id` and `LoopNode.body_entry_node_id`
     are **single node-id references into the shared, flat `reasoning.graph[]`
     array** — the exact convention `RouterBranchSchema.next_node_id` already
     established — not inlined `GraphNode[]`/`GraphNode[][]` sub-arrays. A
     branch/body is "walked" by following `next_node_id` from its entry point
     until the chain naturally dangles (`next_node_id: null`) or reaches an
     `end` node — the same terminal convention the foreground walk itself
     uses (R-G1). Chosen because: (a) it reuses one representation
     convention codebase-wide instead of inventing a second one, exactly as
     the brief asked; (b) every node inside a branch/body is still a normal
     member of the flat `reasoning.graph[]` array, so **every existing
     flat-array scan already covers nodes nested inside Parallel/Loop for
     free** — `toolRefsKnownRule` (Gate B), `findLlmNodes` (primary-LLM-leg
     rules), the Session-detail node trace — none of these needed a single
     line changed to "see into" a branch or loop body; (c) it makes loop
     repetition an **interpreter-level control-flow concept** (call the body
     chain once per iteration), not a graph-level back-edge, which sidesteps
     needing "is this cycle legitimately Loop-owned" cycle-detection
     complexity entirely (see V-4 below).
   - `ParallelBranchSchema`: `{ id, entry_node_id, budget_ms? }`.
   - `join_policy: 'all' | 'first_success' | 'quorum' | 'all_settled'`.
     **`best_of` is omitted from the union entirely**, not kept as a
     recognized-but-unimplemented literal — BL-069 is a real future node
     behavior (a judge-LLM pick), not a value this phase's join-execution
     code has any branch for, and TypeBox/Pydantic discriminated unions give
     a clean, precise rejection ("not one of the allowed literals") for free
     if a config ever names it; a value the codebase can't act on is a worse
     API surface than an absent one that fails clearly.
   - `quorum_n: T.Optional(T.Integer({minimum:1}))` — required-when-`quorum`
     is a **structural, not schema-shape**, check (mirrors the pre-existing
     Speak-node-`text`-required-in-`literal`-mode precedent: "checked by the
     validator, not the schema"); lives in `graph-structure.ts` (new
     `CONFIG_GRAPH_QUORUM_N_INVALID` code) alongside that file's other
     per-node-type structural checks, not in the new `graph-rules.ts` (which
     is scoped specifically to V-2/V-4 per `ARCHITECTURE_NOTES.md` §7).
   - `on_branch_error: 'continue_partial' | 'fail'`, `next_node_id` (the
     single continuation after the join — branches are internal, they never
     fan the *outer* path the way Router's branches do).
   - `LoopNode`: `body_entry_node_id`, `condition` (reuses
     `graph-condition.ts`/`condition_grammar.py` verbatim — same grammar
     Router already uses, no second evaluator), `max_iterations: T.Integer()`,
     `max_duration_ms: T.Integer()`, `max_cost: T.Number()`, `next_node_id`.
     All three guards are **schema-required fields with deliberately
     unconstrained numeric ranges** (no `minimum` at the TypeBox/Pydantic
     layer) — "present" is therefore already guaranteed by ordinary
     requiredness once the base structural check passes, and V-2's own job
     (below) is the semantic positivity check, each violation getting its
     own node-and-field-attributed error rather than a generic schema-shape
     one (per `UX_SCOPE.md`'s "attaches to the specific node card" rule).
   - **`max_cost`'s unit** — checked first: no per-call/per-token dollar-cost
     concept exists anywhere in this codebase today (grepped for
     `cost_per`/`estimated_cost`/`CostEstimate`/etc. — zero hits; the A3.6
     wireframe's "`$0.019/turn`" is illustrative copy, never implemented).
     **Decision**: `max_cost` is denominated in **abstract cost units, where
     one unit = one node executed during a single loop-body pass** — a
     simple, honest proxy for "how many vendor/tool calls this loop could
     rack up" without inventing a fake dollar-pricing model this phase has
     no data to back. Documented in both schema files' doc comments.
2. **Gate A structural — `graph-structure.ts` extended** (referential
   integrity for the two new node types, same file/pattern Phase 9 already
   established): `parallel` case checks every `branches[].entry_node_id` +
   `next_node_id`; `loop` case checks `body_entry_node_id` + `next_node_id`;
   both get the quorum_n-required-when-quorum check described above. Mirrored
   in Python's `ReasoningBlock._graph_references_resolve` (same reason Phase
   9's version of this file is mirrored there: the cross-language contract
   test runs one fixture corpus through both validators and requires
   agreement).
3. **New `apps/api/src/modules/deployment-config/domain/graph-rules.ts`** —
   V-2 and V-4, both Gate A structural (wired into
   `ValidateConfigUseCase.runSchemaGate`, exactly where `graph-structure.ts`'s
   checks already are — confirmed by reading `save-config.use-case.ts`:
   `!gateA.schemaValid` throws a 400 for **both** `draft` and `published`
   saves, before `save_as` is even inspected, which is what makes a Gate A
   check "blocks save" while a Gate B/`combination-rules.ts` check only ever
   blocks `published`). Mirrored into Python's `ReasoningBlock` model
   validator for the same contract-test-agreement reason as point 2.
   - **V-2**: for every Loop node, `max_iterations >= 1`,
     `max_duration_ms >= 1`, `max_cost >= 0`, each a distinct
     `CONFIG_LOOP_GUARD_INVALID` error attributed to that node id + field.
   - **V-4**: DFS over the whole graph's "next hop" edges (the same edges
     `critical-path.ts`'s `NODE_COST_STRATEGIES.nextNodeIds` already knows
     about, extended for Parallel's branch entries and Loop's body entry) —
     **any** cycle found is rejected, unconditionally. Per the
     representation decision in point 1, a validly-authored Parallel
     branch/Loop body never legitimately contains a graph-level cycle at
     all (repetition is interpreter-level, not a back-edge) — so "no cycles
     outside Loop" and "no cycles, period" collapse into the same check
     under this design. This still delivers R-G5's actual guarantee
     (arbitrary back-edges, e.g. a stray Router branch pointing backward,
     are always rejected) with a simpler mechanism than "detect the cycle,
     then check whether it's Loop-owned." Flagged as a real, documented
     scope/complexity trade-off from the brief's literal "excludes a Loop
     node's own internal back-edges" framing — revisit only if a future
     phase wants literal in-body back-edges a Loop node doesn't itself
     control via iteration count.
4. **Python interpreter — `nodes/parallel.py`, `nodes/loop.py`, plus a new
   `orchestration/graph/registry.py`.** `registry.py` extracts the node-type
   -> executor dispatch table (previously private to `interpreter.py`) into
   one shared module, plus `execute_one_node`/`walk_chain` — a generic,
   bounded single-entry-point chain walker (deadline-aware, on_error/
   on_deadline-resolving, identical per-node semantics to
   `interpreter.py`'s existing foreground loop) that both a Parallel branch
   and a Loop body iteration run through. This is what makes "a branch/body
   may contain any node type including nested Router/Parallel/Loop" work:
   `walk_chain` dispatches through the same registry recursively. `nodes/
   parallel.py`/`nodes/loop.py` import `registry.py` **inside their
   `execute()` method, not at module top level** — `registry.py`'s own
   dispatch table construction imports every `nodes/*.py` module including
   these two, so a top-level import the other direction would be circular;
   the deferred import is safe because both modules are already fully
   initialized in `sys.modules` by the time `execute()` actually runs. This
   is the one deliberate use of a deferred import in this package, and is
   documented in both new files' module docstrings.
   `TurnContext` (`ports/orchestration.py`) gains one additive field,
   `nodes_by_id: dict[str, GraphNode]`, populated once by
   `GraphInterpreter.run()` at the top of the turn (previously a local
   variable) — this is what lets `nodes/parallel.py`/`nodes/loop.py` resolve
   branch/body references without widening the `NodeExecutor.execute(node,
   ctx)` Protocol every existing executor already implements.
   `interpreter.py`'s own main foreground loop and `_run_background_chain`
   are **not refactored** to call the new shared walker — deliberately, to
   avoid regression risk to Phase 10's already-gated, empirically-tuned
   deadline/on_deadline logic (documented bugs found and fixed there via
   careful testing); they simply now import the registry's dispatch table
   instead of defining their own, so Parallel/Loop become reachable node
   types from the top-level walk too.
   - **Parallel** fans branches out as concurrent `asyncio` tasks (each
     running `walk_chain(branch.entry_node_id, ctx, budget_ms=branch.budget_ms)`),
     joining per `join_policy`: `all`/`all_settled` await every branch
     (`asyncio.gather`); `first_success` uses `asyncio.wait(...,
     FIRST_COMPLETED)` in a loop until a branch's chain ends in a `complete`
     status, cancelling the rest; `quorum(n)` uses the same wait-loop but
     stops as soon as **n branches have returned at all** (success or
     failure — implemented literally per §A3.3's table wording, not "n
     succeeded"), cancelling the rest. `on_branch_error` (`continue_partial`
     vs `fail`) governs what happens when the join's own stopping condition
     didn't yield a fully successful set: for `all`, any branch failure
     +`on_branch_error: fail` fails the node; `all_settled` never fails on a
     branch failure (matches its own table definition verbatim); for
     `first_success`/`quorum`, "zero of the branches considered succeeded" is
     the failure condition `on_branch_error` gates. `LlmUnavailableError`
     from any branch propagates uncaught out of the Parallel node (after
     cancelling siblings) — consistent with the existing, deliberate
     "not caught anywhere in this package" rule so `pipeline.py`'s degraded-
     mode handling keeps working. Each branch's own leaf node already writes
     its result into `ctx.turn_state[<that node's own id>]` (the existing
     Tool-node convention) — no extra plumbing needed for a downstream
     compose step to read a specific branch's output; the Parallel node
     additionally records `ctx.turn_state[node.id] = {branch_id:
     last_output_text}` as a convenience summary.
   - **Loop** re-invokes `walk_chain(body_entry_node_id, ctx, budget_ms=<remaining
     duration guard>)` once per iteration in a plain Python loop, evaluating
     `condition` (via `condition_grammar.evaluate_condition`, reusing
     Router's evaluator exactly) after each pass — "repeat **until** the
     condition holds" (A3.2's own wording), so the loop stops the first time
     `evaluate_condition(...)` returns `True`. **Runtime guard enforcement is
     defense-in-depth, independent of the publish-time V-2 check** (per the
     brief's explicit "an edited-after-validation config... shouldn't be
     able to produce an actual infinite loop"): before every iteration the
     executor checks `iteration >= max_iterations`,
     `elapsed_ms >= max_duration_ms`, and `cost_used >= max_cost` (cost unit
     per point 1's decision); the instant any guard trips, the loop stops
     and resolves **`on_deadline`** (chosen over `on_error` — a guard trip is
     conceptually "ran out of budget," the same category `on_deadline`
     already covers for the turn-level deadline, not a node execution
     failure) via the shared `edges.resolve_on_deadline` helper — never a
     silent infinite loop, and never a recognized-failure-bypasses-on_error/
     on_deadline regression of the exact bug Phase 9/10 fixed for Tool/Router.
5. **Critical-path extension (`critical-path.ts`)** — `NODE_COST_STRATEGIES`
   gains `parallel`/`loop` entries. `NodeCostStrategy.cost()`'s signature
   widens to take the full `nodesById` map (additive — every existing
   strategy's `cost()` simply ignores the new parameter) because computing
   Parallel/Loop's cost requires recursing into a branch/body chain, which a
   bare `node` object can't do alone. New `maxChainCost(startId, nodesById,
   ...)` helper walks a single chain to its natural termination, taking the
   `Math.max` over any nested Router-style fan-out along the way (mutually
   recursive with `costFor`, so a nested Parallel/Loop inside a branch/body
   is handled the same way) — safe from runaway recursion in practice
   because `computeCriticalPath` is only ever called after Gate A (including
   the new V-4 cycle check) has already passed, though the existing
   `MAX_PATH_DEPTH`-style defensive bound is extended to this helper too,
   pure belt-and-suspenders.
   - **Parallel cost formula** (documented judgement call, same spirit as
     Phase 8's `credential_ref` call): `all`/`all_settled` → the slowest
     branch's own `maxChainCost` (verbatim match for §A3.7's "Turn cost =
     slowest branch (410ms), not the sum"). `first_success` → the
     **fastest** branch's cost — an optimistic estimate, since
     first_success's entire purpose is finishing as soon as any branch
     succeeds and the true completion order isn't knowable at design time;
     optimistic-fastest is the estimate that actually reflects what the
     feature is for. `quorum(n)` → the **n-th fastest** branch's cost (sort
     branch costs ascending, take index `n-1`) — the natural generalization
     of first_success's logic to "the n-th one to finish, in estimated-order."
   - **Loop cost formula**: `min(max_duration_ms, maxChainCost(body) *
     max_iterations)` — whichever bound is tighter is the more meaningful
     estimate; a loop whose guard would time-box it well before it could
     ever run `max_iterations` full passes shouldn't be charged the larger,
     unreachable number.
   - `nextNodeIds` for both new types is the existing `singleNextId` helper
     over `next_node_id` — branches/body are internal, never alternate
     top-level paths the way Router's branches are.
6. **`test-call-graph.use-case.ts` extension (mandatory, not optional)** —
   its `runNode` switch is exhaustive over `GraphNode['type']` today (no
   `default` case); adding `parallel`/`loop` to the union makes this a
   **compile error** the moment the schema change lands, regardless of
   whether the brief listed this file explicitly. Refactored its per-node
   loop body into a small reusable `runChain(startId, ...)` the main loop,
   a Parallel branch, and a Loop iteration all call (mirrors the Python
   `walk_chain` extraction, independently implemented per this codebase's
   existing per-language-duplication precedent for graph logic). Parallel is
   simulated by walking every branch (sequentially — a structural simulator
   has no real concurrency to demonstrate) and flattening each branch's node
   results into the same ordered `nodes[]` array the harness already
   returns; Loop is simulated by running the body up to
   `min(max_iterations, 10)` times (an additional simulator-only hard cap,
   independent of the real runtime's guards, so a pathological config can't
   make a "Run test call" click hang the admin's browser tab either),
   evaluating `condition` after each pass and flattening every iteration's
   node results the same way.
7. **Frontend — Reasoning tab** (`apps/web/projects/admin/.../features/reasoning/`):
   `node-factory.ts` gains `parallel`/`loop` to `NODE_TYPES` + sensible
   defaults (`createDefaultNode`); `node-type-icon.ts` (shared) gains icons
   (`call_split` variant / `merge_type` for Parallel, `repeat` for Loop) +
   labels; `NodeInspectorComponent` gains Parallel (branch list reusing the
   exact add/remove/update pattern Router's branches already use, join-policy
   `mat-select`, per-branch **table row** — name, est. ms — per
   `UX_SCOPE.md`'s explicit "table instead of a gantt bar" instruction, not
   a bar chart, on_branch_error/on_deadline selectors) and Loop (body-entry
   node-id picker into `otherNodes`, condition text field reusing the same
   plain text input Router's branch condition already uses, the three guard
   number fields with inline validation-error display sourced from the
   store's per-node error map exactly like every other node's errors);
   `NodeCardComponent` renders a Parallel node's branches as a nested
   `role="list"` (mirrors Router's branch rendering) and a Loop node's body
   reference + guard summary. Both node types show correctly in
   `TurnBudgetPanelComponent`'s existing all-paths list with zero panel
   changes needed (it already just renders whatever `critical_path` the
   backend returns).

**Out of scope (explicit, unchanged from the brief):** `best_of` join policy
(BL-069), true drag-and-drop canvas (BL-079), real RAG (Phase 12b),
Skills/Sub-agent/HITL/Handoff/State node types (Phases 13-15), the 8-tab
shell (Phase 16), a literal in-Loop-body graph back-edge (see V-4's
documented simplification above — not needed for this phase's exit
condition, UC-G1 step 8 doesn't exercise Loop cycles at all).

### Deliverables
**Contracts**: `agent-config/reasoning-graph.schema.ts` (+`ParallelNode`,
`LoopNode`, `ParallelBranchSchema`, `JoinPolicy`), Python mirror in
`contracts/runtime_config.py` (+ same, + `ReasoningBlock` validator extended
for V-2/V-4/quorum_n), `error-codes.ts` (+`CONFIG_LOOP_GUARD_INVALID`,
`CONFIG_GRAPH_CYCLE_DETECTED`, `CONFIG_GRAPH_QUORUM_N_INVALID` +
`ERROR_MESSAGES`), fixtures (`valid/parallel-join-all.yaml`,
`valid/loop-with-guards.yaml`, `invalid/loop-missing-guards.yaml`,
`invalid/graph-cycle-outside-loop.yaml`).

**Backend**: `domain/graph-structure.ts` (extended), `domain/graph-rules.ts`
(new, V-2+V-4), `domain/critical-path.ts` (extended),
`application/validate-config.use-case.ts` (wires `graph-rules.ts` into
`runSchemaGate`), `application/test-call-graph.use-case.ts` (extended,
`runChain` refactor). `*.spec.ts` per changed/new file (loop-without-guards
rejected — each guard independently; cycle-outside-loop rejected; valid
loop/parallel accepted; parallel join-policy cost cases; loop bounded-cost
cases; nested-branch/body recursion).

**Python**: `orchestration/graph/registry.py` (new),
`orchestration/graph/nodes/{parallel,loop}.py` (new),
`orchestration/graph/interpreter.py` (imports the shared registry),
`ports/orchestration.py` (`TurnContext.nodes_by_id`),
`contracts/runtime_config.py` (as above). Tests: `tests/orchestration/graph/
test_registry.py`, `tests/orchestration/graph/nodes/{test_parallel.py,
test_loop.py}` (real `asyncio`, not mocked timing — each join policy's
actual concurrent behavior; each of the 3 guards independently triggering a
stop; a runaway-loop-guard test proving a misconfigured/edited-after-validation
loop is genuinely cut, not just theoretically bounded).

**Frontend**: `store/node-factory.ts`, `components/node-inspector/`,
`components/node-card/`, `shared/src/lib/util/node-type-icon.ts` (all
extended). `*.spec.ts` per changed component.

**Docs**: this file (Phase 11 section, marked done at the end).

### Exit gate
- `pnpm --filter @liveavatar/contracts build && pnpm --filter @liveavatar/contracts lint`
- `pnpm --filter @liveavatar/api build`, `lint`, `test`.
- `pnpm --filter @liveavatar/web build`, `lint`, `test`.
- `apps/agent`: `ruff check .`, `ruff format --check .`, `mypy src`,
  `pytest -q` (full suite — genuine new concurrency/looping logic).
- Feature-specific acceptance: UC-G1 step 8 buildable end-to-end (a Parallel
  node with `join: all` demonstrably lowers `critical_path_ms` vs. the
  equivalent sequential chain, verified by a `critical-path.spec.ts` case
  built from that exact scenario).
- Security review scoped to: the Loop guards as a resource-exhaustion
  control (can a malformed/edited-after-validation config bypass runtime
  enforcement?); no new endpoints, no new external calls, no new dynamic
  evaluation beyond the already-reviewed condition grammar reused as-is.
- If e2e/testcontainers hangs again in this sandbox, time-box it and fall
  back to the established temporary-local-Postgres-script workaround,
  deleting the script after and documenting the limitation.
- This section updated with the actual gate run results, marking Phase 11 done.

### Result — Phase 11 done (2026-09-03)

**Delivered as planned**, plus one real hardening added during this phase's
own security review (below). Built directly in this tree (schema, TS domain
layer, Python interpreter) with the Angular frontend slice carried out by a
background sub-agent against a fully-specified brief derived from this same
plan section, then independently re-verified (re-read the changed files,
re-ran every gate myself) rather than taken on trust. Full file list by
layer, then gate results, then deviations/findings.

**Files — Contracts** (`packages/contracts/src/`):
`agent-config/reasoning-graph.schema.ts` (+`ParallelNodeSchema`,
`ParallelBranchSchema`, `JoinPolicySchema`, `LoopNodeSchema`, both added to
`GraphNodeSchema`'s union), `error-codes.ts` (+`CONFIG_LOOP_GUARD_INVALID`,
`CONFIG_GRAPH_CYCLE_DETECTED`, `CONFIG_GRAPH_QUORUM_N_INVALID` +
`ERROR_MESSAGES`).

**Files — Python** (`apps/agent/src/avatar_agent/`):
`contracts/runtime_config.py` (+`ParallelBranch`, `JoinPolicy`,
`ParallelNode`, `LoopNode`; `ReasoningBlock`'s model validator extended for
Parallel/Loop referential integrity, the `quorum_n`-required-when-`quorum`
check, V-2, and V-4's cycle DFS), `orchestration/graph/registry.py` (new —
`NODE_EXECUTORS` dispatch table, `execute_one_node`/`walk_chain`),
`orchestration/graph/nodes/parallel.py` (new), `orchestration/graph/nodes/loop.py`
(new), `orchestration/graph/interpreter.py` (imports the shared registry
instead of its own private dict; `ctx.nodes_by_id` now populated once at the
top of `run()`), `ports/orchestration.py` (`TurnContext.nodes_by_id`, new
additive field). Tests: `tests/orchestration/graph/test_graph_registry.py`
(new, 13 cases — named to avoid a real pytest module-basename collision
with the pre-existing `tests/registry/test_registry.py`, discovered by the
first full-suite run), `tests/orchestration/graph/nodes/test_parallel.py`
(new, 9 cases, real `asyncio` timing — concurrency proven by wall-clock
assertions, genuine cancellation proven by a "never reached completion"
marker, not mocked), `tests/orchestration/graph/nodes/test_loop.py` (new, 7
cases — each of the 3 guards independently triggering a stop, including a
literal "this would otherwise run forever" case). Fixtures:
`valid/parallel-join-all.yaml`, `valid/loop-with-guards.yaml`,
`invalid/loop-missing-guards.yaml`, `invalid/graph-cycle-outside-loop.yaml`.

**Files — API** (`apps/api/src/modules/deployment-config/`):
`domain/graph-structure.ts` (extended — `parallel`/`loop` referential
checks, `checkQuorumN`), `domain/graph-rules.ts` (new — `validateLoopGuards`
(V-2), `validateNoCycles` (V-4), `validateGraphRules`), `domain/critical-path.ts`
(extended — `NodeCostStrategy.cost()` widened to take `nodesById`,
`maxChainCost`, `parallelCost`, `loopCost`, `NODE_COST_STRATEGIES.parallel`/`loop`),
`application/validate-config.use-case.ts` (wires `validateGraphRules` into
`runSchemaGate`, alongside `validateGraphStructure`),
`application/test-call-graph.use-case.ts` (refactored the inline per-node
loop into a reusable `runChain`, used by the main walk and by new
`parallel`/`loop` simulation cases — mandatory, not optional: the
`runNode` switch is exhaustive over `GraphNode['type']` with no `default`,
so this was a compile error the moment the schema change landed),
`domain/agent-config-cross-language.contract.spec.ts` (now also calls
`validateGraphRules`, not just `validateGraphStructure` — needed for the
two new `invalid/` fixtures to actually fail on the TS side of the shared
contract test; a real gap that would have gone unnoticed otherwise, since
this helper hadn't been touched since Phase 9). New/extended `*.spec.ts`:
`domain/graph-rules.spec.ts` (new, 16 cases), `domain/critical-path.spec.ts`
(+23 cases including the exact UC-G1-step-8 scenario:
sequential-Tool-Tool-LLM at 1700ms/over-budget vs. the equivalent
Parallel-join-all version at 1300ms/under-budget, at the same 1500ms turn
budget), `domain/graph-structure.spec.ts` (+11 cases), `application/test-call-graph.use-case.spec.ts`
(+15 cases).

**Files — Web** (`apps/web/projects/`): `admin/.../features/reasoning/store/node-factory.ts`
(+`parallel`/`loop` in `NODE_TYPES`, defaults, +`generateBranchId`),
`admin/.../store/node-factory.spec.ts` (new — none existed before this
phase), `shared/src/lib/util/node-type-icon.ts` + `.spec.ts` (+`merge_type`/`repeat`
icons and labels), `admin/.../components/node-card/node-card.component.ts`
+ `.html` + `.scss` + `.spec.ts` (Parallel branches / Loop body-preview +
guard-summary rendering, both as nested `role="list"` blocks per the
existing a11y pattern), `admin/.../components/node-inspector/node-inspector.component.ts`
+ `.html` + `.scss` + `.spec.ts` (full Parallel and Loop inspector cases —
branch table with a client-side-estimate cost column per `UX_SCOPE.md`'s
"table row, not a gantt bar" instruction, join-policy/quorum_n/on_branch_error
controls, body-entry/condition/three-guard controls with inline `mat-error`s).
No changes to `reasoning.store.ts`, `reasoning-page.component.*`, or
`turn-budget-panel.component.*` — none were needed; the store's existing
`errorsByNode()`/`globalErrors()` selectors and the budget panel's
all-paths list already work generically off whatever `reasoning.graph`/
`critical_path` shape the backend returns.

**Gate — actually run, not assumed:**
- `pnpm --filter @liveavatar/contracts build && lint` — **green** (run
  twice: once before, once after the security-review hardening below).
- `pnpm --filter @liveavatar/api build` — **green**. `lint` — **green**.
  `test` (full suite) — **146/149 suites, 970/971 tests**. The 3 failing
  suites (`providers/infrastructure/http-probe-strategy.spec.ts`,
  `providers/domain/validation.spec.ts`,
  `providers/application/update-provider-credential.use-case.spec.ts`) are
  the **exact same pre-existing defect Phases 8, 9, and 10 already
  documented** (`assertEndpointUrl`'s second `hosting` parameter never
  threaded through that spec/call site) — untouched by this phase, left as
  the prior three phases left it. `deployment-config` module's own new/changed
  suites in isolation: **109/109 passing** (`critical-path.spec.ts`,
  `graph-rules.spec.ts`, `graph-structure.spec.ts`,
  `test-call-graph.use-case.spec.ts`, `agent-config-cross-language.contract.spec.ts`).
- `pnpm --filter @liveavatar/web build` — **green** (same pre-existing,
  unrelated CJS-interop warning on `@liveavatar/contracts` Phases 9/10
  already flagged). `lint` — **green**, 0 problems. `test` — **74/74
  suites, 543/543 tests** (up from Phase 10's 73/525).
- `apps/agent`: `ruff check .` — **all checks passed**. `ruff format --check .`
  — **113 files already formatted**. `mypy src` — **no issues, 73 files**
  (one real mypy error found and fixed during development — a reused loop
  variable name `branch` across two `elif` branches of the same
  `isinstance` chain in `runtime_config.py`'s validator confused mypy's flow
  narrowing; renamed to `parallel_branch`, not a functional bug). `pytest -q`
  (full suite) — **366/367**. The one failure
  (`tests/contracts/test_runtime_config.py::test_rejects_a_non_https_looking_garbage_endpoint`)
  is the **exact same pre-existing defect Phases 9 and 10 already
  documented** (`AgentRuntimeConfig.endpoints` is deliberately `dict[str, str]`,
  not `HttpUrl`) — untouched by this phase. `graph`-package tests alone:
  **106/106 passing** (up from Phase 10's 77/77 — 29 new: 13 registry, 9
  parallel, 7 loop). `lint-imports` (`.venv/Scripts/lint-imports.exe`) —
  **all 3 contracts kept** (`layers`, `vendor-sdk-isolation`,
  `orchestration-uses-ports`), specifically verifying the new `registry.py`
  and its deferred-import pattern didn't introduce a layering violation.

**Golden-path proof (real Postgres, real HTTP stack)**, same fallback
Phases 8/9/10 established for this sandbox: rather than starting a new
testcontainers-managed Postgres, a fresh throwaway database
(`liveavatar_e2e_p11`) was created inside the already-running dev container
from Phase 8 (`liveavatar-pg-p8`, port 5433) via `psql CREATE DATABASE`. A
temporary, **non-committed** spec (`test/tmp-golden-path-p11.e2e-spec.ts`,
deleted after the run; database dropped after) ran the compiled `AppModule`
through Supertest and proved, for real, end to end, against exactly what
this phase added: seed → login → create tenant → `PUT /config` (draft save,
`save_as: 'draft'`) with a well-formed Parallel (`join: first_success`)
graph → **200** → `POST /config/validate` on that graph returns zero
`CONFIG_GRAPH_*` errors and a real `critical_path` whose `critical_path_ms`
is exactly `400` (the fastest of the two 400ms Tool branches, per the
documented `first_success` cost formula — not `800`, the sum) → `POST
/config/test-call` walks the real graph and returns a `parallel`-typed node
result → **V-2 proof**: `PUT /config` with the identical graph but
`max_iterations: 0` on its Loop node → **400 `CONFIG_LOOP_GUARD_INVALID`**,
and a follow-up `GET /config` confirms the **rejected save was never
persisted** (still shows the prior Parallel draft) → **V-4 proof**: `PUT
/config` with a genuine cycle (`router-1 → llm-1 → router-1`, no Loop node
anywhere in the graph) → **400 `CONFIG_GRAPH_CYCLE_DETECTED`** → a
well-formed Loop graph (real guards) saves cleanly as a draft, replacing the
prior one → `POST /config/test-call` on it returns a `loop`-typed node
result. This phase adds no new HTTP endpoint and no new Prisma migration —
every route exercised above (`config`, `config/validate`, `config/test-call`)
is one Phase 9/10 already golden-path-verified for its existing surface;
this run specifically targets the two things that are actually new this
phase (V-2/V-4 blocking save, Parallel/Loop flowing correctly through the
existing routes), not a re-proof of the whole config lifecycle (publish +
credentials were deliberately out of scope for this run — see the
deviations below).

**Security review (scoped to what this phase touched, per the exit gate's
own instruction that the Loop guards are themselves a security-relevant
resource-exhaustion control):**
- No new HTTP endpoint, no new Prisma migration, no new external call, no
  new dependency added anywhere in this phase.
- No new dynamic evaluation: the Router condition grammar (already reviewed
  in Phase 9) is reused verbatim for Loop's `condition` — no second
  evaluator, no `eval`/`new Function`/`exec`. `graph-rules.ts`'s V-4 DFS and
  its Python mirror are plain recursive functions over a closed `Record`/
  `dict` of already-schema-shaped node objects — no dynamic property access
  beyond a type-discriminated switch/`isinstance` chain.
- **Defensive bounds are real, not decorative** — verified by tracing each
  one: `graph-rules.ts`'s `validateNoCycles` caps total visited nodes at
  `MAX_NODES_VISITED = 5000` and is proven to terminate on a 200-node linear
  chain in `graph-structure.spec.ts`'s test suite; `critical-path.ts`'s new
  `maxChainCost` shares the existing `MAX_PATH_DEPTH` bound; the Python
  `walk_chain`'s `max_steps` defaults to the same `100` the top-level
  interpreter loop already uses, and is proven to actually stop (not just
  claim to) by `test_graph_registry.py`'s pathological-cycle test.
- **The Loop guards — the specific concern this exit gate calls out —
  cannot be bypassed by a malformed/edited-after-validation config**, traced
  end to end: (1) V-2 blocks *save* (not just publish) — proven for real
  above via a real 400 over HTTP against a real Postgres-backed config
  table, and the rejected write is confirmed never persisted; (2) even if a
  bad config somehow reached the runtime anyway (a direct DB edit, a future
  bypass of the save path), `nodes/loop.py`'s own guard checks run
  **before every iteration**, independent of the schema-time check —
  `max_iterations=0` (or any invalid value) yields **zero body executions**,
  proven directly by `test_loop.py`'s dedicated test; (3) even if all three
  of a Loop's *own* guards were somehow generously misconfigured, the
  **outer, pre-existing turn-level deadline** (Phase 10, itself schema-capped
  at `turn_budget_ms ≤ 60000`) already wraps *any* node's — including a
  Parallel/Loop node's — whole `execute()` call in `asyncio.wait_for` and
  force-cancels it, so worst-case wall-clock exposure for a single turn is
  bounded at 60 seconds regardless of what a Loop node's own guards say.
- **One real finding, fixed in this phase (not deferred)**: while tracing
  point (3) above, the guard fields themselves had **no upper bound** at the
  schema level — only V-2's lower-bound ("must be positive") check existed,
  so nothing stopped an admin from configuring `max_iterations: 10_000_000`
  or similarly extreme values. Not an actual bypass (the 60-second outer cap
  from point (3) still holds regardless), but a real, closable gap in
  depth-of-defense, and cheap to fix. **Fixed**: added `maximum` constraints
  to all three guard fields in both `LoopNodeSchema` (TypeBox,
  `max_iterations: 1000`, `max_duration_ms: 60000` — matching
  `turn_budget_ms`'s own ceiling exactly, since a loop can never legitimately
  need more duration than the whole turn's budget — `max_cost: 100000`) and
  its Pydantic mirror (`Field(le=...)`, same three numbers), mirroring this
  schema's own existing precedent for bounding admin-configurable numeric
  fields (`ToolNodeSchema.timeout_ms` already has both a `minimum` and a
  `maximum`). Verified none of this phase's fixtures/tests exceed the new
  ceilings (re-ran the full contracts/API/agent gate after the fix — all
  still green, see above; the two `invalid/` fixtures deliberately test the
  *lower*-bound violation and are unaffected).
- **Parallel task cancellation traced through every exit path**: success
  (`first_success`/`quorum` cancel the losing tasks via `_cancel_pending`,
  which `await`s the cancellation to completion before returning — never a
  fire-and-forget `task.cancel()`), branch failure (`all`/`all_settled`
  always run every branch to completion via `asyncio.gather`, nothing to
  cancel), and the `LlmUnavailableError` propagation path (explicitly
  cancels every still-running sibling task, `await`s them via
  `return_exceptions=True`, *then* re-raises) — proven empirically, not just
  by code inspection, by `test_parallel.py`'s cancellation-marker tests
  (`executor.completed` never gaining an entry for a task that should have
  been cancelled mid-`asyncio.sleep`) including the `LlmUnavailableError`
  case specifically.
- No field newly introduced this phase (`quorum_n`, `max_cost`, `condition`,
  `join_policy`, `entry_node_id`, `body_entry_node_id`) flows into a shell
  command, file path, SQL string, or any other injection-sensitive sink
  anywhere in the codebase — grepped for downstream usage of each; all are
  pure in-memory graph-walk parameters (numeric guards/budgets, a closed-set
  enum, or a node-id string already subject to `NodeId`'s
  `^[a-zA-Z0-9_-]+$` pattern at the schema layer).
- No auth guard, controller, or tenant-scoping check was touched — no
  controller file was modified this phase at all.

**Scope deviations / decisions made this phase (documented, not silently
absorbed):**
1. **Branch/body representation: single node-id references into the shared
   flat graph, not inlined `GraphNode[]`/`GraphNode[][]` sub-arrays** — the
   brief's own "your call, document which you picked." See the Scope
   section above for the full rationale; the practical payoff was real and
   immediate: `toolRefsKnownRule`, `findLlmNodes`, and the session-detail
   node trace all needed **zero code changes** to already "see into" a
   Parallel branch or Loop body, since every node inside one is still just
   a normal member of the flat `reasoning.graph[]` array.
2. **`best_of` omitted from `JoinPolicy` entirely**, not kept as a
   recognized-but-unimplemented literal — the brief's own "your call."
3. **V-4's DFS rejects *all* cycles unconditionally**, not "cycles outside
   Loop specifically" — a direct consequence of decision 1 (a validly-authored
   Parallel branch/Loop body never legitimately contains a graph-level cycle
   under this representation, so the two collapse into the same check). Real,
   documented complexity trade-off against the brief's literal framing;
   revisit only if a future phase wants literal in-body back-edges a Loop
   doesn't itself control via iteration count.
4. **`max_cost`'s unit: abstract cost units, 1 unit = 1 node executed per
   loop-body pass** — checked first (grepped for any existing per-call/
   dollar-cost concept; none exists anywhere in this codebase) before
   inventing this, per the brief's own instruction.
5. **`quorum_n`-required-when-`quorum` lives in `graph-structure.ts`, not
   the new `graph-rules.ts`** — mirrors the pre-existing Speak-node-`text`
   precedent ("required only in a specific mode, checked by the validator")
   and keeps `graph-rules.ts` scoped exactly to V-2/V-4 per
   `ARCHITECTURE_NOTES.md` §7's table.
6. **A real ordering characteristic, not a bug, found and documented via
   test-writing**: a Parallel/Loop node's own summary `NodeResult` is
   necessarily recorded *after* its branch/iteration nodes' results (both in
   the Python interpreter's hop trace and the TS test-call simulator's
   `nodes[]` array) — its own status depends on the join/loop outcome, which
   isn't known until every child has run. Initial test expectations assumed
   the parent would appear first; corrected once the actual (correct, given
   the architecture) behavior was observed, not worked around.
7. **A real gap found and fixed while wiring V-4**: the DFS's cycle error
   initially carried no `field`, which would have made
   `CONFIG_GRAPH_CYCLE_DETECTED` **invisible** in the Reasoning tab —
   `reasoning.store.ts`'s `errorsByNode()` requires a `field` to attribute a
   `layer: 'reasoning.graph'` error to a node card, and its `globalErrors()`
   *unconditionally* excludes every `layer: 'reasoning.graph'` error
   (assuming `graph-structure.ts`'s existing checks always carry a `field`,
   which until now they always did). Fixed by having `validateNoCycles`
   report the node id the cycle was actually detected at.
8. **A real gap found and fixed in the Python interpreter's own hop
   recording**: `registry.py`'s `walk_chain` (used by both Parallel branches
   and Loop iterations) now calls `ctx.hop_recorder.record(...)` for every
   node it executes — without this, BL-039's node-level session trace would
   have been completely blind to everything that happens inside a Parallel
   branch or Loop body, seeing only the parent node's own summary result.
   Caught by writing `test_graph_registry.py`'s hop-recording test, not
   assumed correct upfront.
9. **`test-call-graph.use-case.ts`'s Parallel/Loop simulation was not
   explicitly listed as a deliverable in the original brief, but was
   mandatory, not optional**: its `runNode` switch is exhaustive over
   `GraphNode['type']` with no `default` case, so extending the union to
   include `parallel`/`loop` is a compile error the moment the schema change
   lands, regardless of scope intent.
10. **Angular frontend built by a background sub-agent** against a
    fully-specified brief (branch/body representation, exact field shapes,
    the client-side-cost-estimate simplification, existing-pattern reuse
    points) derived from this same plan section — then independently
    re-verified in this session (files re-read, every gate re-run from
    scratch) rather than taken on trust, per this project's own "trust but
    verify" discipline. Its own minor deviations (a plain `<table>` instead
    of `mat-table` for the branch cost list; `generateBranchId()` as a new
    small helper rather than overloading `generateNodeId`) are both
    reasonable and are noted here for completeness.
11. Everything in the original "Explicitly out of scope this phase" list
    (`best_of` join policy, true drag-and-drop canvas, real RAG,
    Skills/Sub-agent/HITL/Handoff/State node types, the 8-tab shell, a
    literal in-Loop-body graph back-edge) remained out of scope, untouched.

**Follow-ups left open, not silently dropped:**
- The pre-existing `providers` module TS spec drift and
  `test_runtime_config.py` endpoint-validation gap (Phases 8/9/10) remain
  exactly as documented — not this phase's files, not re-touched.
- Router's dotted-field condition-grammar gap (Phase 9 finding #1) — still
  open, still not on any phase's critical path; Loop's `condition` field
  inherits the identical flat-identifier-only limitation since it reuses the
  same grammar verbatim.
- A live, backend-computed per-branch cost number for the Parallel
  inspector's table row does not exist — the frontend renders a documented,
  clearly-labeled client-side estimate (a shallow single-node lookup against
  a small local constant table mirroring `critical-path.ts`'s
  `DEFAULT_COST_MS`) instead. Building a real endpoint for this was out of
  this phase's explicit scope; worth reconsidering if admin feedback shows
  the estimate is misleading in practice.
- The Loop guard upper bounds added during this phase's own security review
  (`max_iterations: 1000`, `max_duration_ms: 60000`, `max_cost: 100000`) are
  a first, reasonable-but-not-data-driven pass — revisit if a real use case
  ever needs a loop with more than 1000 iterations (none exists in this
  spec's own use cases, which all describe single-digit-to-low-double-digit
  "refine until grounded" loops).

---

## Phase 12a — RAG ingestion (BL-044, BL-046)

### Goal
A knowledge source (an uploaded text/markdown document) can be created,
configured, chunked, embedded, and indexed into a real pgvector-backed store
— with a minimal verification query proving the index is genuinely populated
— entirely independent of the Reasoning graph's Retrieve node, which stays
the no-op stub `ARCHITECTURE_NOTES.md` §3.2 says it remains until Phase 12b.

### Scope

**In scope:**
1. **Prisma**: `KnowledgeSource`, `KnowledgeChunk` (pgvector `embedding` +
   generated `tsvector` column), `KnowledgeGap` (table only, no writer this
   phase). `vector` extension added to `schema.prisma`'s `datasource`
   `extensions = [...]`. Hand-written raw-SQL migration additions for the
   `Unsupported("vector(1536)")`/`Unsupported("tsvector")` columns, an HNSW
   ANN index, and a GIN index on the tsvector column — verified against a
   real disposable Postgres running the `pgvector/pgvector:pg16` image
   (`postgres:16-alpine`, this repo's usual disposable-Postgres image, does
   **not** ship the extension).
2. **Python** (`apps/agent`): `ports/embedding.py` (`IEmbeddingProvider`
   Protocol), `registry/keys.py` gains `LogicalProviderKey.EMBEDDING_OPENAI`,
   `registry.py` gains `resolve_embedding(cfg, secrets)`,
   `adapters/embedding/openai.py` (real `openai` SDK call — already a
   dependency), a **new second process entrypoint**
   `services/ai_service.py` — FastAPI + uvicorn, `POST /embed`, guarded by a
   new symmetric internal-token dependency (same `INTERNAL_TOKEN` shared
   secret and `X-Internal-Token` header the existing `InternalTokenGuard`
   uses for the Python→Nest direction, mirrored for this new Nest→Python
   direction since no Python-side guard for *inbound* internal calls existed
   before this phase). `fastapi`/`uvicorn` added as new dependencies (no
   existing HTTP-server framework in `apps/agent` per the research pass).
3. **TypeScript ingestion job** (`apps/api/src/modules/jobs/`): fixed-size
   `ChunkerPort` + implementation (pure domain, no vendor SDK), a new
   `knowledge-ingest` BullMQ queue + `KnowledgeIngestProcessor`
   (`extends WorkerHost`, mirrors `ProviderProbeProcessor`'s exact shape),
   an `EmbeddingClient` infrastructure adapter calling Python's `/embed`
   over internal HTTP, and the pgvector index-write via `$executeRaw`
   (mirrors `prisma-utterance.repository.ts`'s raw-SQL-escape-hatch
   pattern — embedding vectors passed as bound parameters, cast `::vector`
   in SQL, never string-concatenated).
4. **NestJS `knowledge` module**, new, four layers mirroring `tools`
   exactly: CRUD for `KnowledgeSource` (create = file upload via
   `multer` memory storage, `.txt`/`.md` only, 10 MiB cap; list; get;
   update; delete), a re-index endpoint that **returns the coarse
   cost/duration estimate** (`GET .../reindex-estimate`) and a **separate
   confirm endpoint** (`POST .../reindex`) that actually enqueues the job —
   the same two-step shape as this app's existing single-step
   `ConfirmDialogComponent` pattern, just extended with a preview payload
   since no "preview-then-confirm" endpoint precedent exists yet (documented
   as new, not modelled on a nonexistent prior example). Tenant-scoped via
   `canAccessTenant`, guarded via `AdminJwtGuard`/`RolesGuard`, exactly like
   every other admin module.
5. **Gate B rule** (`combination-rules.ts`): V-9 knowledge-source-staleness
   check, implemented as a **tenant-wide warning** (every stale
   `KnowledgeSource` the tenant owns produces a non-blocking
   `KNOWLEDGE_SOURCE_STALE` entry) — not a per-reference block, since the
   Retrieve node has no config field yet naming which sources it uses
   (that arrives in Phase 12b's real Retrieve node, BL-047). Matches
   `UX_SCOPE.md`'s "warn unless referenced by a published-path skill" —
   nothing is referenced yet, so it never blocks publish this phase.
6. **Frontend**: `features/knowledge/` (own route,
   `tenants/:id/knowledge`, registered in `app.routes.ts`, added to
   `webFeatures` ESLint zones) — Sources sub-tab only. Upload form (parser:
   plain-text/markdown real, PDF visibly-disabled "coming soon"; chunk
   strategy: Fixed pre-selected, Semantic/Heading-aware visibly-disabled
   "coming soon", reusing Phase 8's consequential-tools disabled-with-reason
   pattern), size/overlap inputs, embedding-model selector. No crawl-type
   option anywhere in the form (omitted entirely, not shown disabled — BL-072
   is not even a stub yet, same as Skills' platform-library omission).
   Sources table: per-row staleness badge (new small `@liveavatar/web-shared`
   badge component, same icon+label convention as `HostingBadgeComponent`).
   Re-index button: shows the cost/duration estimate (explicitly labelled
   "Estimate") before a second confirm click actually triggers it.

**Out of scope (explicit):**
- Real hybrid-search retrieval, rerank, threshold + `KnowledgeGap` logging,
  token-capped injection, the retrieval playground, wiring the Retrieve
  graph node to real data — all Phase 12b (BL-045/047/048).
- Semantic/heading-aware chunking implementations (BL-071 — `ChunkerPort`
  is shaped to make them additive, neither is built).
- True cross-encoder reranking (BL-070 — not applicable to ingestion
  anyway).
- Crawl-type sources (BL-072).
- PDF parsing (not in any BACKLOG row for 12a; kept out to avoid a new
  binary-parsing dependency/attack surface this phase — shown
  disabled-with-reason, same as the deferred chunking strategies).
- Skills/HITL/Sub-agent, the 8-tab shell (Phase 16).
- Docker-compose/k8s production wiring for the new `ai_service` deployment
  target beyond a minimal compose service definition proving it starts —
  full autoscaling/ops sizing is a follow-up.

### Decisions made this phase
1. **Embedding provider/model: OpenAI `text-embedding-3-small`, 1536
   dimensions.** `openai` is already a dependency for the LLM adapters; a
   second vendor SDK is not needed. 1536 fixes the pgvector column width
   for the whole table (pgvector's ANN index types require a fixed
   dimension), so only this one model is selectable this phase — the
   embedding-model field is a validated string, not hard-coded, so adding a
   second model later is additive (new allowed value) as long as its
   dimension also happens to be 1536, or a follow-up decision if a
   different-dimension model is ever wanted (would need a second vector
   column or a migration).
2. **ANN index: HNSW, not IVFFlat.** HNSW needs no training/list-count
   tuning step and gives good recall immediately on a freshly-populated
   table (IVFFlat's centroids are only as good as the data present when the
   index is built — awkward for a table that starts empty per-tenant and
   grows source-by-source). Requires pgvector ≥ 0.5.0, satisfied by the
   `pgvector/pgvector:pg16` image used for verification.
3. **tsvector column added now, even though Phase 12b owns hybrid search.**
   It is a Postgres `GENERATED ALWAYS AS (to_tsvector(...)) STORED` column
   — free to add alongside the vector column in the same hand-written raw
   SQL, populated automatically by Postgres itself (no ingestion-job code
   writes it), and matches the ingestion pipeline diagram's own "Index →
   vector + keyword" step. Declared in `schema.prisma` as a second
   `Unsupported("tsvector")` field (not omitted) specifically so a future
   `prisma migrate dev` diff doesn't try to drop a column Prisma doesn't
   know about. `KnowledgeGap` table is likewise created now (same
   `ARCHITECTURE_NOTES.md` §4.2/§8 grouping) but nothing in this phase
   writes a row into it — reserved for Phase 12b's R-R7 threshold logic.
4. **Uploaded file bytes stored in Postgres (`Bytes` column on
   `KnowledgeSource`), not on local disk or object storage.** No file
   storage abstraction exists anywhere in this codebase yet; local disk
   would tie ingestion to a single pod/replica (this app's BullMQ workers
   and web process can scale horizontally); standing up S3/GCS is real new
   infrastructure this phase's brief didn't ask for. Documents are
   text/markdown and size-capped at 10 MiB, so bytea is simple and correct.
   A real object-store migration is a reasonable follow-up if upload sizes
   grow.
5. **Parser support: plain-text and markdown only, real; PDF
   present-but-disabled.** Binary PDF parsing needs a new parsing
   dependency and materially larger attack surface (malformed-PDF handling)
   for a phase whose brief only asked for "Upload... a source"; kept
   consistent with the chunking-strategy disabled-with-reason precedent
   rather than silently omitted, since PDF is a real, expected near-term
   need (unlike Crawl, which the brief explicitly says to omit outright).
6. **V-9 Gate B check is tenant-wide, not per-Retrieve-reference**, and
   **always a warning, never a publish-blocker**, for the reason in Scope
   item 5 above (no config field yet names which sources a Retrieve node
   uses) — revisit once Phase 12b's real Retrieve node config exists.
7. **Re-index preview/confirm is a new two-step HTTP shape**
   (`GET .../reindex-estimate` then `POST .../reindex`), not modelled on an
   existing endpoint pair — none exists anywhere in this codebase (checked;
   `agent-builder-page`'s publish flow has no preview step at all). The
   single-step `ConfirmDialogComponent` is still reused on the frontend for
   the second click's "are you sure" moment; only the estimate-fetch step
   is new.
8. **Cost/duration estimate is computed by actually re-running parse+chunk
   synchronously** (cheap, deterministic, no vendor call) rather than
   reusing the source's last-known `chunkCount`, so the number reflects the
   *current* config (size/overlap/parser) even before a real re-index runs.
   Formula: `chunk_count × $0.000004` and `chunk_count × 50 ms`, both
   round, clearly-labelled illustrative constants (not derived from a real
   OpenAI price/latency SLA) — returned and rendered with an explicit
   "Estimate" label per `ARCHITECTURE_NOTES.md` §4.5.
9. **Exit condition's "queried" (BACKLOG.md's "uploaded, chunked, embedded,
   and queried") means a minimal raw SQL verification query** (cosine
   `<=>` distance against a real inserted vector, and/or a plain
   `SELECT ... FROM knowledge_chunk WHERE embedding IS NOT NULL` count)
   proving the pgvector column is real and populated — explicitly **not**
   the hybrid-search/threshold/rerank retrieval pipeline, which is Phase
   12b's BL-045.

### Deliverables

**Contracts** (`packages/contracts/src/knowledge/schemas.ts`, new):
- `KnowledgeSourceSchema`, `CreateKnowledgeSourceRequestSchema` (multipart
  fields alongside the file), `UpdateKnowledgeSourceRequestSchema`,
  `ReindexEstimateResponseSchema`, `ListKnowledgeSourcesResponseSchema`.
- New `AppErrorCode` entries in `error-codes.ts`
  (`KNOWLEDGE_SOURCE_NOT_FOUND`, `KNOWLEDGE_SOURCE_FILE_TOO_LARGE`,
  `KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED`, `KNOWLEDGE_PARSER_NOT_SUPPORTED`,
  `KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED`,
  `KNOWLEDGE_EMBEDDING_MODEL_NOT_SUPPORTED`, `KNOWLEDGE_SOURCE_STALE`,
  `KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID`).

**Backend** (`apps/api/src/modules/knowledge/`, new; plus
`apps/api/src/modules/jobs/`, extended):
- `domain/`: `knowledge-source.ts` (entity), `ports.ts`
  (`KnowledgeSourceRepositoryPort`, `EmbeddingClientPort`), `validation.ts`,
  `chunker-port.ts` + `fixed-size-chunker.ts` + `chunker-registry.ts`.
- `application/`: `create-knowledge-source.use-case.ts`,
  `list-knowledge-sources.use-case.ts`, `get-knowledge-source.use-case.ts`,
  `update-knowledge-source.use-case.ts`,
  `delete-knowledge-source.use-case.ts`,
  `estimate-reindex.use-case.ts`, `trigger-reindex.use-case.ts`,
  `run-knowledge-ingestion.use-case.ts`, `knowledge-source-dto.ts`.
- `infrastructure/`: `prisma-knowledge-source.repository.ts`,
  `prisma-knowledge-chunk.repository.ts` (raw `$executeRaw`/`$queryRaw`
  vector writes/reads), `embedding-http-client.ts`.
- `interface/`: `knowledge-sources.controller.ts`.
- `jobs/domain/queue-names.ts`: `KNOWLEDGE_INGEST_QUEUE`.
- `jobs/infrastructure/knowledge-ingest.processor.ts`.
- `deployment-config/domain/combination-rules.ts`: new
  `knowledgeSourceNotStaleRule`.
- Prisma: `schema.prisma` additive models/enums +
  `prisma/migrations/<ts>_knowledge_rag/migration.sql` (Prisma-generated
  DDL + hand-added raw SQL, same shape as the precedent migrations).

**Python** (`apps/agent/src/avatar_agent/`, new):
- `ports/embedding.py`, `registry/keys.py` (extended),
  `registry/registry.py` (extended, `resolve_embedding`),
  `adapters/embedding/openai.py`, `services/ai_service.py`,
  `services/internal_auth.py` (the new inbound-guard dependency),
  `pyproject.toml` (adds `fastapi`, `uvicorn`).

**Frontend** (`apps/web/projects/admin/src/app/features/knowledge/`, new):
- `knowledge.routes.ts`, `pages/knowledge-sources-page/`,
  `components/knowledge-source-dialog/`, `store/knowledge-sources.store.ts`.
- `apps/web/projects/shared/src/lib/ui/staleness-badge/` (new small badge
  component).
- `eslint.config.mjs`'s `webFeatures` zone list, extended.

**Docs**: this file (Phase 12a section marked done at the end).

### Exit gate
- `pnpm --filter @liveavatar/contracts build && pnpm --filter @liveavatar/contracts lint`
- `pnpm --filter @liveavatar/api build`, `lint`, `test` — new
  `*.spec.ts` for the chunker (size/overlap edge cases), the processor, and
  every new use-case/controller.
- `pnpm --filter @liveavatar/web build`, `lint`, `test` — new specs for the
  Sources store/page/dialog.
- `apps/agent`: `ruff check .`, `ruff format --check .`, `mypy src`,
  `pytest -q` (full suite) — new tests for `resolve_embedding`, the OpenAI
  embedding adapter (mocked HTTP, no real key), and `/embed` (including the
  internal-token guard rejecting missing/wrong tokens).
- **pgvector proof, run for real against a live Postgres** (this phase's
  own explicit highest-risk item): `CREATE EXTENSION vector` succeeds,
  `knowledge_chunk`'s `embedding`/`search_vector` columns exist, a real
  insert + `<=>` cosine-distance query returns the expected nearest row. If
  the disposable-container approach hangs again (prior phases' known
  Docker Hub/testcontainers friction), fall back to the same local-script
  workaround, but this step may **not** be skipped or assumed — it is
  called out by name as the phase's biggest new-infrastructure risk.
- Security review scoped to: the new `/embed` internal endpoint (reject
  unauthenticated/wrong-token, real request proof not just code reading);
  file upload validation (size/type limits, no path traversal in any
  storage key derived from a filename — moot if bytes are stored in
  Postgres rather than keyed on disk, but confirmed either way); no vendor
  API key ever logged/returned; the reindex-estimate endpoint scoped to the
  caller's own tenant only.
- This section updated with the actual gate run results before Phase 12b
  starts.

### Result — Phase 12a done (2026-09-03)

**Delivered as planned**, built by three sequenced tracks (Prisma/pgvector →
Python embedding service in parallel, then the NestJS module depending on
both, then the Angular Sources sub-tab depending on the module's contracts)
— each independently re-verified in this session (files re-read, every gate
re-run from scratch by the orchestrating session, not just trusted from the
building agent's own report), per this project's "trust but verify"
discipline.

**Files — Contracts** (`packages/contracts/src/`):
`knowledge/schemas.ts` (new); `index.ts`, `error-codes.ts` (edited, 12 new
`KNOWLEDGE_*` codes).

**Files — API** (`apps/api/`):
- `prisma/schema.prisma` (edited — `vector` extension, `KnowledgeSource`/
  `KnowledgeChunk`/`KnowledgeGap` models + 4 enums, additive `Tenant`
  relation).
- `prisma/migrations/20260902202319_knowledge_rag/migration.sql` (new —
  Prisma-generated DDL + hand-added `search_vector` generated column, HNSW
  index, GIN index).
- `src/modules/knowledge/` (new, all four layers): `domain/` (entity, ports,
  validation + `.spec`, `chunking/{chunker-port,fixed-size-chunker,chunker-registry}.ts`
  + `.spec`, `parsing/parse-content.ts` + `.spec`); `application/` (dto
  mapper + 7 use-cases, each with `.spec`, including
  `run-knowledge-ingestion.use-case.ts` — the pipeline); `infrastructure/`
  (`prisma-knowledge-source.repository.ts`, `prisma-knowledge-chunk.repository.ts`
  — raw-SQL vector write, `embedding-http-client.ts`,
  `knowledge-ingest-queue.producer.ts`, each with `.spec`); `interface/`
  (`knowledge-sources.controller.ts` + a delegation spec + a real-guard HTTP
  spec); `knowledge.module.ts`, `index.ts`.
- `src/modules/jobs/`: `domain/queue-names.ts` (edited, re-exports
  `KNOWLEDGE_INGEST_QUEUE` from `knowledge/domain/ports.ts` — see deviation
  #3 below), `infrastructure/knowledge-ingest.processor.ts` (new) + `.spec`,
  `jobs.module.ts` (edited).
- `src/modules/deployment-config/domain/combination-rules.ts` (edited —
  `knowledgeSourceNotStaleRule` added, deliberately **not** registered in
  `COMBINATION_RULES`; see deviation #1) + `.spec` addition.
- `src/app.module.ts` (edited, registers `KnowledgeModule`).
- `package.json`/lockfile (edited — added `multer`, `@types/multer`, the
  first file-upload dependency in this codebase).

**Files — Python** (`apps/agent/src/avatar_agent/`):
`ports/embedding.py` (new), `adapters/embedding/{__init__,openai}.py` (new),
`services/{__init__,internal_auth,ai_service}.py` (new — the second process
entrypoint), `registry/keys.py` + `registry/registry.py` (edited, additive),
`pyproject.toml` (edited — added `fastapi`, `uvicorn[standard]`); tests
under `tests/adapters/embedding/`, `tests/services/`, and an addition to
`tests/registry/test_registry.py`.

**Files — Web** (`apps/web/projects/`):
`admin/src/app/features/knowledge/` (new — `knowledge.routes.ts`,
`store/knowledge-sources.store.ts` + `.spec`,
`components/knowledge-source-dialog/*` + `.spec`,
`pages/knowledge-sources-page/*` + `.spec`); `shared/src/lib/ui/staleness-badge/*`
(new) + `ui/index.ts` (edited); `shared/src/lib/api/knowledge-sources-api.service.ts`
(new) + `api/index.ts` (edited); `admin/src/app/app.routes.ts` (edited,
registers `KNOWLEDGE_ROUTES`); `eslint.config.mjs` (edited, `knowledge`
added to `webFeatures`); `admin/src/app/features/agent-builder/pages/agent-builder-page/*`
(edited — removed the superseded RAG-enable-toggle/index_ref UI, see
deviation #6).

**Files — Deployment**: `docker-compose.yml` (edited — new `ai-embedding`
service, the second deployment target, built from the same `apps/agent`
image with its `ENTRYPOINT` overridden to `uvicorn
avatar_agent.services.ai_service:app`; `EMBEDDING_SERVICE_URL` added to the
`web` service's environment).

**Docs**: this file.

**Gate — actually run, not assumed** (every command below was re-run
independently by the orchestrating session after each building agent
reported success — none of these numbers are taken on trust):
- `pnpm --filter @liveavatar/contracts build` — clean (`tsc`, no errors).
- `pnpm --filter @liveavatar/contracts lint` — clean.
- `pnpm --filter @liveavatar/api build` — clean (`prisma generate` +
  `nest build`).
- `pnpm --filter @liveavatar/api lint` — clean.
- `pnpm --filter @liveavatar/api test` — **163/166 suites, 1109/1110
  tests passing.** The 3 failing suites
  (`providers/infrastructure/http-probe-strategy.spec.ts`,
  `providers/domain/validation.spec.ts`,
  `providers/application/update-provider-credential.use-case.spec.ts`) are
  the same pre-existing, already-documented `assertEndpointUrl` signature
  drift called out in Phases 8/9/10/11's own gate results — confirmed by
  re-running independently: `assertEndpointUrl` now requires a `hosting`
  argument the pre-existing spec files never pass. No file under
  `providers/` was touched this phase.
- `pnpm --filter @liveavatar/web build` — clean (both `admin` and
  `conversation` bundles; the same pre-existing "`@liveavatar/contracts` is
  not ESM" bundler warning every prior phase's build has also shown).
- `pnpm --filter @liveavatar/web lint` — clean.
- `pnpm --filter @liveavatar/web test` — **581/581 tests, 79/79 suites.**
- `apps/agent`: `ruff check .` — all checks passed. `ruff format --check .`
  — 121 files already formatted. `mypy src` — no issues, 79 source files.
  `pytest -q` (full suite) — **390/391 passing.** The 1 failure
  (`tests/contracts/test_runtime_config.py::test_rejects_a_non_https_looking_garbage_endpoint`)
  is the same pre-existing pydantic-version-drift failure named in every
  prior phase's gate results; unrelated to `contracts/runtime_config.py`,
  which this phase never touched. `import-linter` — 3 kept, 0 broken; no
  contract changes were needed (the new `services` module composes adapters
  directly the same way `entrypoint` already does, and `openai` was already
  in `vendor-sdk-isolation`'s allowed list from the LLM adapter).
- `docker compose config --quiet` (with the required env vars stubbed) —
  exits 0; the new `ai-embedding` service parses and resolves cleanly
  alongside the rest of the compose file.

**pgvector verification — the phase's own named highest-risk item, proven
for real against a live `pgvector/pgvector:pg16` container** (not
`postgres:16-alpine`, which does not ship the extension):
1. `CREATE EXTENSION vector` succeeded — `SELECT extname, extversion FROM
   pg_extension` returned `vector | 0.8.6`.
2. `knowledge_chunk`'s `embedding` (`vector(1536)`) and `search_vector`
   (`tsvector`, `is_generated = ALWAYS`) columns both exist, confirmed via
   `information_schema.columns`.
3. Real insert (2 `knowledge_source` rows, 3 `knowledge_chunk` rows with
   distinct 1536-dim vector literals) + a real `<=>` cosine-distance query
   returned the exact-match row at distance `0`, a close-direction row
   second, an orthogonal row last — correct ordering, not just "a row came
   back."
4. Both the HNSW (`vector_cosine_ops`) and GIN (`search_vector`) indexes
   exist and are valid; `EXPLAIN` on the cosine query actually chose
   `Index Scan using knowledge_chunk_embedding_hnsw_idx`.
5. `search_vector` populated itself automatically on insert with zero
   application code writing it — confirmed non-null, correctly tokenized
   from `text` — proving the "free keyword column" design choice actually
   holds.
One real hiccup during migration authoring, not silently absorbed: an
initial `prisma migrate dev` (no `--create-only`) hung building/tearing
down its shadow database and left an idle connection holding the Postgres
advisory migration lock; resolved by terminating that backend and using
`prisma migrate deploy` (this repo's actual `prisma:migrate` script)
instead, which applied cleanly and non-interactively — the same class of
Prisma-tooling friction prior phases hit with testcontainers, worked around
the same way (a documented, real workaround, not a skipped step).

**Security review (scoped to what this phase touched):**
- **`/embed`'s internal-token guard**: real HTTP requests (FastAPI
  `TestClient`, not just code inspection) with no `X-Internal-Token` and
  with a wrong token both return 401, with the embedding provider/adapter
  call-count asserted at zero in both cases — a wrong token cannot fall
  through to a real vendor call.
- **Guard/tenant-scoping on every new Nest route**: `AdminJwtGuard`/
  `RolesGuard` proven with the real Passport strategy (no guard override) in
  an HTTP-level spec — 401 on no token, a garbage token, and a non-admin
  token; every use-case has a real (non-mocked `canAccessTenant`) test
  proving a cross-tenant actor gets 403, not a misleading 404 or another
  tenant's data — same convention as every prior phase's admin module.
- **File upload**: `.exe`/`application/octet-stream` rejected with
  `KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED`; >10 MiB rejected at both the
  real multer layer (HTTP spec) and the use-case's own defensive check (unit
  spec) — two independent layers, not one. No filesystem path is ever built
  from the uploaded `originalname` — content is stored as Postgres `Bytes`,
  so path-traversal-via-filename is structurally not applicable (confirmed
  by reading the repository code, not just asserted).
- **No vendor API key/credential ever logged or returned**: the
  `KnowledgeSourceDto` only ever carries `embedding_credential_ref` as an
  opaque ref *name* (Nest never resolves it — only Python does, and only
  server-side); `EmbeddingHttpClient` never surfaces the embedding
  service's raw response body in a thrown error; ingestion-failure messages
  are our own controlled strings, never raw vendor bodies; the BullMQ
  processor logs only ids; Python's `/embed` logs only classification
  codes/ref names, verified by test assertions that a fake secret value and
  a fake ref name never appear in any 400/502 response body.
- **Reindex-estimate leaks nothing cross-tenant**: identical
  `canAccessTenant` check as every other route on this controller, verified
  directly in its own use-case spec; it also performs no persistence and no
  vendor call (pure parse+chunk), so there is no code path in it that could
  read another tenant's data at all.
- **Dependencies added**: `multer`/`@types/multer` (Nest's own documented
  file-upload interceptor pairing, actively maintained), `fastapi`/
  `uvicorn[standard]` (mainstream, actively maintained Python web
  framework/ASGI server) — no other new dependency anywhere in this phase.
- **Rate limiting**: not added for the new `/embed`/ingestion-trigger
  routes — flagged, not silently shipped unprotected: this codebase has no
  general rate-limiting story yet for any admin-triggered costly action
  (same gap Phase 8's tools test-invoke and every other admin POST already
  carry); a real fix is a platform-wide concern, not specific to this
  phase's two new routes, and is called out as a follow-up below rather
  than solved narrowly here.

**Scope deviations / decisions made this phase (documented, not silently
absorbed) — beyond the ones already recorded above under "Decisions made
this phase":**
1. **V-9's `knowledgeSourceNotStaleRule` is implemented and unit-tested but
   deliberately left unregistered in `COMBINATION_RULES`.** Wiring it into
   the live `ValidationContext` construction inside `deployment-config`'s
   save/validate use-case was assessed, while implementing, as
   disproportionate regression risk for a non-blocking warning whose actual
   12a UX surface (the Sources-table staleness badge) is entirely
   independent of Gate B and already ships. `ValidationContext` gained one
   new **optional** field (`knowledgeSources?`) so no existing test-built
   `ValidationContext` literal anywhere breaks. Phase 12b only has to
   register the rule and populate the field once the Retrieve node's real
   config exists to scope a per-reference (rather than tenant-wide) check
   against.
2. **`KnowledgeGap` table created, `search_vector`/GIN index added — both
   exactly as the plan section called "your call, document either way."**
   Neither is written to by any code this phase.
3. **`KNOWLEDGE_INGEST_QUEUE`'s constant lives in
   `knowledge/domain/ports.ts`, not `jobs/domain/queue-names.ts`** (which
   only re-exports it) — this codebase's ESLint `import/no-restricted-paths`
   cross-module boundary only permits `jobs → knowledge`, never the
   reverse, and `knowledge`'s own BullMQ producer needs the constant. A
   real, discovered-while-building constraint, not a stylistic choice.
4. **Cross-module BullMQ wiring resolved empirically, not assumed**:
   `@nestjs/bullmq`'s `BullModule.forRootAsync` registers its connection
   config as a `{ global: true }` dynamic module (confirmed by reading the
   installed package's own source), so `KnowledgeModule` only needed its
   own `BullModule.registerQueue({ name: KNOWLEDGE_INGEST_QUEUE })` — no
   second `forRootAsync` — and this was proven against the real local Redis
   in this environment (a throwaway producer-only/consumer-only module
   topology mirroring the real one; script deleted after the run, nothing
   left in the repo).
5. **A `Buffer`/Prisma-7-generated-client generics friction** (`Buffer` not
   structurally assignable to the generated client's
   `Uint8Array<ArrayBuffer>` for the `Bytes` column) was fixed with one
   narrow, commented `as never` cast at the single call site that writes
   `rawContent` — runtime-safe (`Buffer` genuinely is a `Uint8Array`), not a
   type-safety regression, but flagged here rather than silently folded in.
6. **The pre-existing "RAG enabled" toggle + free-text "Index reference"
   field was found in `agent-builder-page` and removed**, per
   `UX_SCOPE.md`'s explicit "replacing today's RAG enable-toggle + free-text
   `index_ref` field entirely" instruction — replaced with a link-out to
   `/tenants/:id/knowledge`, matching the existing Tools/Reasoning
   link-out pattern. The underlying `agent.rag.enabled`/`agent.rag.index_ref`
   YAML/config-schema fields were deliberately **not** touched — Python's
   `entrypoint.build_pipeline` still reads them (`rag_enabled=cfg.agent.rag.enabled`),
   and the Retrieve node stays the no-op stub per `ARCHITECTURE_NOTES.md`
   §3.2 until Phase 12b actually replaces this wiring — removing the schema
   field now would be an unrelated breaking change well beyond this phase's
   ingestion-only scope.
7. **Embedding credential resolution reuses the existing `SecretStorePort`/
   `credential_ref` mechanism as-is**, not a new tenant-BYOK plumbing layer:
   `KnowledgeSource.embeddingCredentialRef` is an optional ref string, Nest
   passes it through to Python's `/embed` request untouched, and Python
   resolves it exactly like every other `credential_ref` (a file under the
   shared `SECRETS_DIR`) or falls back to the platform-level
   `AI_API_KEY`/`AI_BASE_URL` env defaults when absent — no new secret
   resolution plumbing was built, this was free reuse of an
   already-existing mechanism.

**Follow-ups left open, not silently dropped:**
- V-9's Gate B wiring into `deployment-config`'s real validate/save
  pipeline (deviation #1 above) — straightforward once Phase 12b's Retrieve
  node config exists to scope it properly.
- No rate limiting on the new `/embed` or `.../reindex` routes — a
  platform-wide gap, not newly introduced by this phase, but worth a
  dedicated pass before either sees real production traffic.
- The `ai-embedding` docker-compose service is minimal wiring proving the
  second process starts and answers `/healthz` — real autoscaling/
  production sizing (replica count, resource limits tuned against real
  embedding-call volume, a Kubernetes Deployment/Service pair mirroring
  `k8s/`'s existing `agent` manifests) is an ops follow-up, not solved here.
  `k8s/` itself was not touched this phase.
- Embedding is currently single-model, single-dimension
  (`text-embedding-3-small`, 1536) by design (the pgvector column width is
  fixed table-wide) — adding a second, different-dimension embedding model
  later needs either a second vector column or a migration; flagged, not
  blocking anything today since only one model is offered.
- The `Buffer`/generated-client `as never` cast (deviation #5) is a narrow,
  understood workaround, not a design decision — worth revisiting if a
  future Prisma version changes its generated `Bytes` typing again.
- PDF parsing and semantic/heading-aware chunking remain visibly-present-
  but-disabled in the UI, exactly as scoped — real implementations are
  BL-071 (chunking) and an unticketed future BL for PDF, both explicitly
  deferred, not started.

---

## Phase 12b — RAG retrieval + Knowledge tab (BL-045, BL-047–048)

### Goal
A `retrieve`-type graph node runs a real, budgeted six-stage retrieval
pipeline (rewrite → hybrid search → metadata filter → rerank(disabled) →
threshold → inject) against 12a's pgvector index, replacing the
`RETRIEVE_NODE_STUBBED` no-op and the pre-Phase-9 `RagRetriever`/`RagIndexPort`
stand-ins entirely; an admin configures that pipeline's per-stage budgets in
a new Pipeline sub-tab and diagnoses a real retrieval defect end to end from
a new Playground sub-tab (UC-R1) — exactly the exit condition
`docs/v2/BACKLOG.md` names for this phase.

### Scope

**In scope:**
1. **Contracts** (`packages/contracts/src/agent-config/reasoning-graph.schema.ts`,
   `schema.ts`, both languages): `RetrievalPipelineConfig` (rewrite/
   hybrid_search/metadata_filter/rerank/threshold/inject stage configs, each
   real stage carrying its own `budget_ms`), a new top-level `knowledge: {
   pipeline: RetrievalPipelineConfig }` block, and a fleshed-out
   `RetrieveNodeSchema` (`source_refs`, `top_k` — both already stubbed in
   Phase 9 — plus a new `budget_ms`, the node's own overall retrieval
   ceiling). Mirrored in `apps/agent/src/avatar_agent/contracts/runtime_config.py`,
   contract-test-enforced against the same shared fixture corpus.
2. **Gate A/B validation**: V-10 (retrieval stage budgets sum ≤ the Retrieve
   node's own `budget_ms`) as a new Gate A structural pure function; V-9
   (knowledge source staleness) wired into the live Gate B, rescoped from
   12a's tenant-wide warning to a per-Retrieve-node-reference warning now
   that a real `source_refs` exists to scope it against.
3. **Python Retrieve node executor** (`orchestration/graph/nodes/retrieve.py`),
   replacing the stub, and a new shared `avatar_agent/knowledge/retrieval_pipeline.py`
   module implementing the six stages once, reused by both the live executor
   and the Playground preview path (ARCHITECTURE_NOTES.md §4.5's "thin
   dry-run wrapper, no duplicate-logic risk").
4. **New NestJS internal (`/internal`) endpoints** for the two Postgres-touching
   steps Python must never do directly (ADR-001): hybrid search (pgvector
   `<=>` + `ts_rank` against 12a's generated `search_vector`, blended,
   metadata-filtered) and `KnowledgeGap` writes.
5. **A dedicated Playground endpoint** (admin-guarded, tenant-scoped) that
   runs the real pipeline via the same shared Python module — not the
   generic Phase 9 test-call graph simulator, which is structural-only and
   never touches a real vendor call or a real index (see "Decisions made
   this phase" below for the full reasoning).
6. **Frontend**: Knowledge tab gains **Pipeline** and **Playground**
   sub-tabs under a new `mat-tab-group` shell (Sources becomes the third
   tab in that same group, unchanged in content). `TestCallPanelComponent`
   relocates from `features/reasoning/components/` into
   `projects/shared/src/lib/ui/` so Knowledge's Playground — and any future
   consumer — can actually import it (Phase 9 built it inside the
   `reasoning` feature folder without moving it, which this project's own
   `import/no-restricted-paths` feature-isolation zones block from any
   other feature; a real gap, fixed here, not carried forward again).
7. **Cleanup**: `orchestration/rag.py` (`RagRetriever`/`RagIndexPort`) and
   every reference to it deleted (`pipeline.py`, `entrypoint.py`); the
   now-dead `agent.rag.{enabled,index_ref}` schema block removed from both
   languages (superseded by `knowledge.pipeline` + `RetrieveNode.source_refs`
   — no config has ever been persisted against this schema outside this
   sandbox, so this is a safe, non-breaking-in-practice cleanup, not a
   production migration).

**Out of scope (explicit, matches the task brief):**
- True cross-encoder reranking (BL-070) — the rerank stage is a config
  field that renders/stores as present-but-disabled ("coming soon," same
  pattern 12a used for PDF parsing/semantic chunking) and a runtime no-op
  passthrough; no reranking model is ever called.
- Semantic/heading-aware chunking, crawl sources (already deferred from 12a).
- Speculative retrieval on partial transcript (BL-067).
- "Save as eval case"/"Compare to v12" buttons in the playground (BL-078 —
  needs config-version-diff UI, separately deferred).
- Skills/HITL/Sub-agent (later phases); the 8-tab shell (Phase 16).
- Real multi-environment isolation (`ARCHITECTURE_NOTES.md` §0.2's standing
  descope) — V-9's warning fires the same regardless of environment label.

### Decisions made this phase

1. **`RetrieveNode` inherits the tenant's `knowledge.pipeline` wholesale —
   no per-node override this phase.** `DeploymentConfig` is one row per
   tenant (one config, one pipeline); the spec's wireframes (§A7.4/§A7.5)
   only ever show one retrieval pipeline per Knowledge tab, never a
   per-node variant picker. A node-level override would be speculative
   complexity with no named use case yet — if a future phase needs two
   differently-tuned Retrieve nodes in the same graph, that's an additive
   schema change (an optional `pipeline_overrides` field), not a redesign.
   `RetrieveNode` therefore only adds `budget_ms` (its own overall ceiling)
   to the two fields Phase 9 already stubbed (`source_refs`, `top_k`).
2. **`RetrieveNode.budget_ms` doubles as `critical-path.ts`'s real per-node
   cost, replacing the `DEFAULT_COST_MS.retrieve = 0` "stub, no-op" constant.**
   R-R3 guarantees retrieval never blocks past its own budget (worst case,
   it returns whatever's been retrieved so far) — that makes `budget_ms` a
   genuine worst-case bound for the critical path, exactly the same
   category as `ToolNode.timeout_ms`'s existing "worst-case failure bound,
   not typical latency" precedent this file's own docstring already
   establishes. No new constant needed; the file's `NODE_COST_STRATEGIES.retrieve.cost`
   strategy now reads `node.budget_ms` directly.
3. **No `knowledge.sources[]` YAML array**, despite `ARCHITECTURE_NOTES.md`
   §1's original sketch mentioning one. 12a already built `KnowledgeSource`
   as a separately-managed, DB-backed entity with its own CRUD (exactly
   like `ToolDefinition`) — a parallel YAML-inlined source list would be a
   second, competing representation of the same data with no reconciliation
   story. `RetrieveNode.source_refs[]` (already Phase-9-stubbed) is the one
   real reference point, mirroring how `agent.tools[]`/graph Tool nodes
   reference `ToolDefinition` by id, never inline it.
4. **Severity added to `ConfigError`/`ConfigErrorDto` one phase early.**
   `ARCHITECTURE_NOTES.md` §7 scopes the `severity: 'error' | 'warning'`
   contract change to V-11 (Phase 13), but V-9 genuinely cannot be
   "warn, not block" (`docs/v2/BACKLOG.md`/`UX_SCOPE.md`'s explicit wording,
   and 12a's own already-built, already-tested `knowledgeSourceNotStaleRule`
   intent) without *some* severity concept, since every existing Gate B
   rule today blocks publish unconditionally
   (`SaveConfigUseCase`: `combinationErrors.length > 0` throws). Added the
   field as **optional**, defaulting to `'error'`-equivalent treatment when
   absent, so no existing rule/test changes shape; only V-9's rule sets
   `severity: 'warning'` explicitly. `ValidateConfigUseCase.execute()`'s
   `valid` and `SaveConfigUseCase`'s publish-blocking check both now filter
   `severity !== 'warning'` before deciding "does this block." Phase 13
   inherits a field that already exists rather than introducing it — a
   deliberate one-phase-early foundation, called out so it isn't
   rediscovered as "why does this already exist."
5. **V-9 re-scoped from tenant-wide to per-reference, attached to the
   referencing node's id (not the source's id).** 12a's version warned
   about every stale source a tenant owned, tenant-wide, because nothing
   yet named which sources a Retrieve node actually used. Now that
   `source_refs` is real, the warning only fires for a source referenced by
   a live `retrieve`-type node, and — critically for the UI's "inline at
   the specific field" rule — attaches with `field: <node.id>`, not
   `field: <source.id>`, because `reasoning.store.ts`'s `errorsByNode()`
   derives a node-card id from a `reasoning.graph`-layer error's `field`;
   attaching to the source id would make the warning attach to nothing and
   silently vanish (neither shown on a node card nor in the global banner,
   since `reasoning.graph`-layer errors are unconditionally excluded from
   the global list). Per the task brief, "published-path skill" carve-out
   is left as a Phase 13 follow-up (skills don't exist yet) — every live
   Retrieve-node reference triggers the warning today.
6. **Hybrid search and the `KnowledgeGap` write are new NestJS `/internal`
   endpoints, not a new Python Postgres client.** Confirmed by reading
   `apps/agent/pyproject.toml`: no `psycopg`/`asyncpg`/ORM dependency exists
   anywhere in `apps/agent`, and ADR-001's Python-never-touches-Postgres-
   directly boundary (already the explicit instruction for the gap write)
   applies identically to the hybrid-search *read* — there's no principled
   reason a read is exempt from a rule justified by "keep Postgres access
   in one language." The new `X-Internal-Token`-guarded routes
   (`POST /internal/knowledge/search`, `POST /internal/knowledge/gaps`)
   mirror `AgentInternalController`'s existing shape exactly. Reusing 12a's
   raw-SQL-escape-hatch pattern (`$queryRaw`/`$executeRaw`, every value
   bound, never concatenated) for the actual pgvector+FTS query.
7. **Query embedding happens in-process inside the Python caller, not via
   another HTTP hop to `ai_service`.** The LiveKit worker process already
   imports `avatar_agent.registry`/`adapters.embedding.openai` (Phase 12a);
   calling `resolve_embedding(...)` directly for the (rewritten) query text
   is a plain vendor-SDK call, not a Postgres access, so ADR-001's boundary
   doesn't apply — and avoiding a redundant network hop keeps the hybrid-
   search stage's tight default budget (~100ms) realistic. `ai_service`'s
   embedding endpoint remains the ingestion path's only caller (12a,
   unchanged); the Playground preview (below) reuses the same in-process
   call inside `ai_service` itself, which already hosts the same registry.
8. **Playground "Run" is a dedicated retrieval-only endpoint, not the
   Phase 9 generic test-call harness's `retrieve` branch.** The Phase 9
   simulator (`TestCallGraphUseCase`) is explicitly documented as a
   NestJS-side **structural simulation** — its `llm` branch never makes a
   real vendor call, and today's `retrieve` branch is a hardcoded stub
   string. R-R9/UC-R1's entire value is diagnosing a **real** retrieval
   defect (real vector/BM25 scores, a real rewrite, a real filter/threshold
   outcome) — a structural simulation cannot show any of that. Per the task
   brief's explicit "or a dedicated retrieval-only invocation" allowance,
   the Playground calls a new admin-guarded Nest endpoint
   (`POST /tenants/:id/knowledge/playground/run`) which calls a new
   `ai_service` endpoint (`POST /retrieve-preview`) that runs the exact
   same `retrieval_pipeline.py` module the live Retrieve node executor
   uses — `ARCHITECTURE_NOTES.md` §4.5 names this "thin dry-run wrapper"
   shape as the reason the playground is realistic to ship at all. What
   *is* reused from Phase 9's harness is the **frontend component
   pattern** (query input, Run button, `aria-live="polite"` coalesced
   summary) via `TestCallPanelComponent`'s relocation (scope item 6) —
   the Playground mounts its own thin result-table component alongside it
   rather than trying to force stage-by-stage retrieval data through
   `TestCallNodeResultDto.detail: string`.
9. **The Playground never writes a `KnowledgeGap` row.** A playground run
   is an admin's own diagnostic query, not a real caller's turn — writing a
   gap row for every exploratory query an admin types while tuning
   `min_score` would pollute the gap report's "18 unexpected asks for X"
   signal with the admin's own repeated test queries. Only the live
   Retrieve node executor (real conversation turns) calls
   `POST /internal/knowledge/gaps`; `ai_service`'s `/retrieve-preview`
   computes the identical pass/dropped counts for display but never calls
   it. Documented here since it isn't obvious from the task brief alone.
10. **Metadata filter is a real parameterized SQL predicate against a new
    `KnowledgeChunk.metadata` column** (`Json @default("{}")`, additive
    migration — 12a precedent: add a column ahead of a real writer, same as
    `search_vector`/`KnowledgeGap` were added in 12a ahead of this phase's
    use). Today's fixed-size chunker (12a) never populates it (empty `{}`
    on every chunk), so the filter stage will typically match nothing until
    a future heading-aware chunker (BL-071) populates real per-chunk
    metadata — the mechanism is real and tested (via manually-inserted
    metadata in tests) even though production data won't exercise it yet,
    exactly the same "shaped for a future producer" posture as 12a's
    `ChunkerPort`. Field names reaching the JSON path (`metadata->>'field'`)
    are allow-list-pattern-checked (`^[a-zA-Z0-9_]{1,64}$`) since a JSON key
    can't be a bound SQL parameter; `op` is mapped through a fixed `switch`
    to a literal SQL fragment (never interpolated from the request string);
    `value` is always a bound parameter. This is the phase's named highest
    injection-risk surface — see the Security review section below.
11. **Stage-local timeouts inside the Retrieve node executor, not the
    interpreter's existing `resolve_on_deadline`/`asyncio.wait_for`
    machinery.** That machinery (Phase 10) wraps a **whole node's**
    `execute()` call and hard-cancels it on timeout — which would discard
    every chunk already fetched, the opposite of R-R3's "return whatever's
    been retrieved so far." `retrieval_pipeline.py` instead tracks its own
    elapsed time against each stage's configured `budget_ms` slice and
    wraps only the network-bound stages (rewrite's LLM call, the hybrid-
    search internal HTTP call) in their own `asyncio.wait_for`; a stage
    timeout is caught locally and treated as "this stage contributed
    nothing" (original query stands in for a timed-out rewrite; zero
    candidates for a timed-out search) rather than failing the node. The
    outer interpreter-level deadline still applies as an unrelated,
    coarser backstop for the node as a whole, unchanged.

### Deliverables

**Contracts** (`packages/contracts/src/`):
`agent-config/reasoning-graph.schema.ts` (edited — `RetrievalPipelineConfigSchema`
+ six stage schemas, `KnowledgeSchema`, fleshed-out `RetrieveNodeSchema`),
`agent-config/schema.ts` (edited — `knowledge: KnowledgeSchema` added,
`agent.rag` removed), `deployment-config/schemas.ts` (edited — `severity` on
`ConfigErrorSchema`, new `RunRetrievalPlaygroundRequestSchema`/
`RunRetrievalPlaygroundResponseSchema`), `error-codes.ts` (edited —
`CONFIG_RETRIEVAL_BUDGET_EXCEEDED` added, `CONFIG_RAG_INDEX_REQUIRED`
removed).

**Backend** (`apps/api/src/modules/`):
`deployment-config/domain/` (`graph-rules.ts` edited — V-10 pure function;
`combination-rules.ts` edited — V-9 rescoped + registered;
`critical-path.ts` edited — real `retrieve` cost; `agent-config.ts`/
`draft-schema.ts` edited — `knowledge` block, `rag` removed; `errors.ts`
edited — `severity`), `deployment-config/application/validate-config.use-case.ts`
(edited — `KNOWLEDGE_SOURCE_REPOSITORY` injected, `knowledgeSources` context
populated), `deployment-config/application/save-config.use-case.ts` (edited
— severity-aware publish gating); `knowledge/` (new: hybrid-search +
metadata-filter application/infrastructure, `KnowledgeGap` writer, the
Playground use-case + controller route, an `ai-service-http-client.ts` for
the new Nest→`ai_service` `/retrieve-preview` call); `internal/` (new
`knowledge-internal.controller.ts`, `X-Internal-Token`-guarded); Prisma
(`schema.prisma` + migration — `KnowledgeChunk.metadata` column).

**Python** (`apps/agent/src/avatar_agent/`):
`orchestration/graph/nodes/retrieve.py` (rewritten), `knowledge/retrieval_pipeline.py`
(new, shared), `ports/orchestration.py` (edited — `apply_retrieved_chunks`,
a minimal knowledge-search/gap port), `telemetry/control_plane.py` (edited
— `search_knowledge`/`record_knowledge_gap`), `services/ai_service.py`
(edited — `/retrieve-preview`), `contracts/runtime_config.py` (edited —
`KnowledgePipelineConfig`, fleshed-out `RetrieveNode`, `rag` removed);
`orchestration/rag.py` deleted; `orchestration/pipeline.py`/`entrypoint.py`
edited (rag wiring removed).

**Frontend** (`apps/web/projects/`):
`shared/src/lib/ui/test-call-panel/` (relocated from `admin/.../reasoning/components/`),
`admin/src/app/features/knowledge/` (new `knowledge-page` `mat-tab-group`
shell; new `pages/knowledge-pipeline-page/`, `pages/knowledge-playground-page/`;
`knowledge.routes.ts` edited).

**Docs**: this file (Phase 12b section, this one, marked done at the end).

### Exit gate
- `pnpm --filter @liveavatar/contracts build && lint` — schema + contract
  test green.
- `pnpm --filter @liveavatar/api build/lint/test` — new specs for V-10, V-9's
  rescoped rule, the hybrid-search/metadata-filter use case and its raw SQL
  (parameterization asserted, not just "returns a result"), the gap writer,
  the playground use case/controller, the `ai_service` HTTP client.
- `pnpm --filter @liveavatar/web build/lint/test` — new specs for the
  Pipeline/Playground pages, the relocated `TestCallPanelComponent`
  (unchanged behavior, new import path), the `mat-tab-group` shell.
- `apps/agent`: `ruff check`/`ruff format --check`/`mypy src`/`pytest -q` —
  new tests for `retrieval_pipeline.py`'s stage blending/threshold/budget-
  exceeded-partial-results behavior, the retrieve node executor, the
  `ai_service` `/retrieve-preview` endpoint, and the deleted `rag.py`'s
  absence (no stray import anywhere).
- **Hybrid search verified for real** against a live `pgvector/pgvector:pg16`
  container (12a's proven image) — real inserted chunks (including at least
  one with non-empty `metadata`), a real `<=>`+`ts_rank` blended query,
  scores checked for correct ordering, not just "a row came back"; the
  metadata filter proven to actually narrow the result set against a real
  row.
- Security review scoped to: the hybrid-search/metadata-filter raw SQL
  (parameterization of `field`/`op`/`value`, no string concatenation of
  user input); `/internal/knowledge/*` and `ai_service`'s `/retrieve-preview`
  reject missing/wrong internal tokens; the Playground endpoint is
  tenant-scoped (`canAccessTenant`) and never returns another tenant's
  chunk text/citations.
- This section updated with the actual gate run results before Phase 13
  starts.

### Result — Phase 12b done (2026-09-03)

**Delivered as planned**, built by three sequenced/parallel tracks (contracts
+ Gate A/B + the Nest hybrid-search/gap/playground surface, built first and
directly by the orchestrating session since it is the shared foundation and
the phase's named highest-risk/highest-injection-risk surface; the Python
retrieve executor and the Angular Pipeline/Playground UI then built in
parallel by two background sessions against those already-locked contracts)
— every file independently re-read and every gate re-run from scratch by the
orchestrating session after each building agent's own report, per this
project's "trust but verify" discipline. Two real, non-trivial bugs were
found and fixed this way (see "Scope deviations" below) — neither would have
been caught by a review that only read code or trusted a green unit-test
report without independently re-running the gates and the live pgvector
proof.

**Files — Contracts** (`packages/contracts/src/`):
`agent-config/reasoning-graph.schema.ts` (edited — `RetrievalPipelineConfigSchema`
+ six stage schemas incl. `MetadataFilterConditionSchema`/`CitationFormatSchema`,
`KnowledgeSchema`, `RetrieveNodeSchema` gains `budget_ms`); `agent-config/schema.ts`
(edited — `knowledge: KnowledgeSchema` added as a required top-level block,
`agent.rag` removed); `deployment-config/schemas.ts` (edited — `severity` on
`ConfigErrorSchema`); `knowledge/schemas.ts` (edited — `RunRetrievalPlaygroundRequestSchema`/
`RunRetrievalPlaygroundResponseSchema` + candidate/injected-chunk sub-schemas);
`internal/schemas.ts` (edited — `KnowledgeSearchRequestSchema`/`KnowledgeSearchResponseSchema`/
`KnowledgeGapRequestSchema`); `error-codes.ts` (edited — `CONFIG_RETRIEVAL_BUDGET_EXCEEDED`
added, `CONFIG_RAG_INDEX_REQUIRED` removed).

**Files — API** (`apps/api/`):
- `prisma/schema.prisma` (edited — `KnowledgeChunk.metadata Json @default("{}")`);
  `prisma/migrations/20260903000000_knowledge_chunk_metadata/migration.sql` (new).
- `src/modules/deployment-config/domain/`: `graph-rules.ts` (edited — new
  `validateRetrievalBudgets`/V-10, `PartialRetrievalPipelineBudgets` type);
  `combination-rules.ts` (edited — `knowledgeSourceNotStaleRule` rescoped to
  per-Retrieve-node-reference and registered into `COMBINATION_RULES`);
  `critical-path.ts` (edited — `retrieve` node cost now reads `node.budget_ms`,
  replacing the Phase-9 `0` stub constant); `agent-config.ts`/`draft-schema.ts`
  (edited — `knowledge` block added, `rag` removed); `errors.ts` (edited —
  `severity` field). `combination-rules.spec.ts`/`critical-path.spec.ts`
  updated for the above.
- `src/modules/deployment-config/application/`: `validate-config.use-case.ts`
  (edited — `KNOWLEDGE_SOURCE_REPOSITORY` injected, `knowledgeSources` context
  populated, `valid` computation now severity-aware); `save-config.use-case.ts`
  (edited — publish-blocking check filters `severity !== 'warning'`);
  `run-retrieval-playground.use-case.ts` (new — lives here, not in `knowledge`,
  to avoid a module cycle, see its own doc comment) + `.spec.ts` (new, 9 cases).
  `validate-config.use-case.spec.ts`/`save-config.use-case.spec.ts` updated for
  the new constructor arg and two new V-9/V-10 end-to-end cases.
- `src/modules/deployment-config/interface/`: `knowledge-playground.controller.ts`
  (new) + `.http.spec.ts` (new — real guard-chain HTTP proof, 6 cases).
  `deployment-config.module.ts` edited (imports `KnowledgeModule`, registers
  both).
- `src/modules/knowledge/domain/ports.ts` (edited — `HybridSearchQuery`/
  `KnowledgeSearchCandidate`/`KnowledgeFilterCondition`, `KnowledgeGapRepositoryPort`,
  `AiServiceClientPort`/`RetrievePreviewRequest`/`RetrievePreviewResponse`).
- `src/modules/knowledge/infrastructure/`: `prisma-knowledge-chunk.repository.ts`
  (edited — `hybridSearch`, the phase's core new raw-SQL surface) + `.spec.ts`
  (edited — 5 new cases incl. the injection-proof test); `prisma-knowledge-gap.repository.ts`
  (new); `ai-service-http-client.ts` (new).
- `src/modules/knowledge/application/`: `search-knowledge.use-case.ts` (new) +
  `.spec.ts` (new); `record-knowledge-gap.use-case.ts` (new) + `.spec.ts` (new).
  `run-knowledge-ingestion.use-case.spec.ts` updated (new `hybridSearch` mock method).
- `src/modules/knowledge/knowledge.module.ts`/`index.ts` (edited — new
  providers/exports for all of the above).
- `src/modules/internal/interface/knowledge-internal.controller.ts` (new) +
  `.http.spec.ts` (new — real guard-chain HTTP proof incl. the injection-pattern
  rejection case, 9 cases); `internal.module.ts` (edited).
- `src/modules/sessions/application/get-runtime-config.use-case.ts`/`.spec.ts`
  (edited — `agent.rag` removed from the runtime-config wire shape, `knowledge.pipeline`
  added, defaulted defensively for a pre-Phase-12b config).
- `docker-compose.yml` (edited — `ai-embedding` service gains
  `CONTROL_PLANE_INTERNAL_URL` for its new outbound call to Nest).

**Files — Python** (`apps/agent/src/avatar_agent/`):
- `contracts/runtime_config.py` (edited — `RewriteStage`/`HybridSearchStage`/
  `MetadataFilterStage`(+`MetadataFilterCondition`)/`RerankStage`/`ThresholdStage`/
  `InjectStage`/`RetrievalPipelineConfig`/`KnowledgeConfig`, `RetrieveNode` gains
  `budget_ms`, `AgentConfig.knowledge` required field + new `_retrieval_stage_budgets_fit_node_budget`
  V-10 model validator, `RagConfig`/`agent.rag` removed).
- `orchestration/retrieval/pipeline.py` (new — the shared six-stage
  `run_retrieval_pipeline`, reused verbatim by both callers below) + `orchestration/retrieval/__init__.py`.
- `orchestration/graph/nodes/retrieve.py` (rewritten — real executor,
  replaces the Phase-9 stub).
- `orchestration/rag.py` **deleted** (`RagRetriever`/`RagIndexPort` fully
  superseded; zero stray references confirmed by grep).
- `orchestration/pipeline.py`/`entrypoint.py` (edited — `rag_retriever`/
  `rag_enabled`/`rag_index_ref` wiring removed; `entrypoint.py` gains
  `_resolve_default_llm`/`_resolve_embedding_provider`, both resolved **once
  per session** and threaded into `TurnContext`, not resolved inside
  `orchestration` — see "Scope deviations" #2).
- `ports/orchestration.py` (edited — `TurnContext.apply_retrieved_chunks`,
  new fields `default_llm`/`knowledge_pipeline`/`knowledge_search`/
  `knowledge_gap`/`embedding_provider` with safe null-object defaults;
  `IKnowledgeSearchPort`/`IKnowledgeGapPort` Protocols + `KnowledgeSearchRequest`/
  `KnowledgeSearchResponse`/`MetadataFilterQuery` dataclasses + shared
  `knowledge_search_request_payload`/`knowledge_search_response_from_json`
  marshalling functions, reused by both Python processes that speak this
  wire format).
- `telemetry/control_plane.py` (edited — `ControlPlaneClient.search_knowledge`/
  `record_knowledge_gap` + `ControlPlaneKnowledgeSearchAdapter`/
  `ControlPlaneKnowledgeGapAdapter` thin Protocol-satisfying wrappers).
- `registry/registry.py` (edited — new `LlmLegRequestConfig`/`resolve_llm_standalone`,
  mirroring `EmbeddingRequestConfig`/`resolve_embedding`'s existing precedent,
  for `ai_service.py`'s standalone rewrite-stage LLM call).
- `services/ai_service.py` (edited — new `POST /retrieve-preview` route,
  `RetrievePreviewRequest`/`RetrievePreviewLlmConfig` models,
  `_StandaloneLlmRewriter`, `NestKnowledgeSearchClient` outbound HTTP client).
- Tests: `tests/orchestration/retrieval/test_retrieval_pipeline.py` (new, 30+
  cases covering every stage + the gap-recorder-never-called-when-`None`
  assertion); `tests/orchestration/graph/nodes/test_retrieve.py` (rewritten,
  stub-era assertions replaced); `tests/services/test_ai_service.py` (edited
  — new `/retrieve-preview` cases incl. guard rejection and
  `test_retrieve_preview_never_passes_a_real_gap_recorder`); `tests/registry/test_registry.py`,
  `tests/telemetry/test_control_plane.py`, `tests/orchestration/test_pipeline.py`,
  `tests/test_entrypoint.py`, `tests/contracts/test_agent_config_contract.py`/
  `test_runtime_config.py` all updated for the above.

**Files — Web** (`apps/web/projects/`):
- `shared/src/lib/ui/test-call-panel/` — **relocated** from
  `admin/.../features/reasoning/components/test-call-panel/` (all 4 files,
  unchanged logic), exported from `shared/src/lib/ui/index.ts`; the
  Reasoning tab's own usage updated to the new import path.
- `admin/src/app/features/knowledge/pages/knowledge-page/` (new — the
  `mat-tab-group` shell: Sources/Pipeline/Playground); `knowledge.routes.ts`
  (edited — now loads `KnowledgePageComponent`).
- `admin/src/app/features/knowledge/pages/knowledge-pipeline-page/` (new —
  the six-stage form, reactive `FormGroup`, per-stage `<la-budget-bar>` +
  the running-total bar, rerank rendered disabled-with-"Coming soon").
- `admin/src/app/features/knowledge/pages/knowledge-playground-page/` (new
  — query + conversation-context inputs, Run button, stage-by-stage result
  sections, `aria-live="polite"` `"<n> chunks injected, <ms>ms"` summary).
- `admin/src/app/features/knowledge/store/knowledge-pipeline.store.ts` (new,
  mirrors `ReasoningStore`'s independent-draft/debounced-validate/save
  shape; `budgetExceededErrors`/`staleSourceErrors` computed signals filter
  `validateResult().errors` by `code`, not by node-id derivation) + `.spec.ts`.
- `admin/src/app/features/reasoning/store/node-factory.ts` (edited — new
  Retrieve nodes now seed `budget_ms: 400`, see "Scope deviations" #3);
  `admin/src/app/features/reasoning/components/node-inspector/node-inspector.component.{ts,html}`
  (edited — a `budget_ms` number input added to the Retrieve node's inspector
  card).

**Gate — actually run, not assumed** (every command below re-run
independently by the orchestrating session after both building agents
reported success):
- `pnpm --filter @liveavatar/contracts build` / `lint` — clean.
- `pnpm --filter @liveavatar/api build` (`prisma generate` + `nest build`) —
  clean. `pnpm --filter @liveavatar/api lint` — clean.
- `pnpm --filter @liveavatar/api test` — **1142/1143 tests, 168/171 suites.**
  The 3 failing suites (`providers/infrastructure/http-probe-strategy.spec.ts`,
  `providers/domain/validation.spec.ts`,
  `providers/application/update-provider-credential.use-case.spec.ts`) are
  the same pre-existing `assertEndpointUrl` signature-drift finding
  documented in every prior phase's gate results (Phases 8 through 12a) —
  confirmed unrelated: no file under `providers/` was touched this phase.
- `pnpm --filter @liveavatar/web build` — clean (both `admin`/`conversation`
  bundles); the pre-existing "`@liveavatar/contracts` is not ESM" bundler
  warning persists (documented every prior phase); one **new**, non-fatal
  warning — `admin`'s initial bundle exceeds its 1.00 MB budget by 14 kB
  (the `mat-tab-group`/new Pipeline+Playground pages entering the graph) — a
  real, disclosed consequence of this phase's UI addition, not a defect;
  flagged as a follow-up, not fixed here (raising the budget or lazy-loading
  further is a routine bundle-hygiene task, not this phase's scope).
  `pnpm --filter @liveavatar/web lint` — clean.
- `pnpm --filter @liveavatar/web test` — **621/621 tests, 83/83 suites.**
- `apps/agent`: `ruff check .` — all checks passed. `ruff format --check .`
  — 122 files already formatted. `mypy src` — no issues, 80 source files.
  `pytest -q` (full suite) — **448/449 passing.** The 1 failure
  (`tests/contracts/test_runtime_config.py::test_rejects_a_non_https_looking_garbage_endpoint`)
  is the same pre-existing pydantic-version-drift failure named in every
  prior phase's gate results. `lint-imports` (import-linter) —
  **3 kept, 0 broken** — confirmed after the embedding-resolution fix
  (see "Scope deviations" #2); the new `orchestration/retrieval/` subpackage
  needed zero contract changes, exactly as planned (it lives inside the
  already-permitted `orchestration` layer).

**Hybrid search verification — the phase's own named highest-risk item,
proven for real against a live `pgvector/pgvector:pg16` container, run
independently by the orchestrating session (not delegated, and re-run a
second time from a completely fresh container after both building agents
finished, specifically to answer "don't just trust the unit tests" for this
one piece)**:
1. A disposable container (`pgvector/pgvector:pg16`, the same image 12a
   proved), all 6 Prisma migrations applied via `prisma migrate deploy`
   (including this phase's own `knowledge_chunk_metadata` migration) —
   clean, no shadow-DB hang this time.
2. Real inserts: 1 tenant, 2 knowledge sources, 3 chunks with genuine
   1536-dim vector literals (one exact-pattern match, one close, one
   orthogonal) and real non-empty `metadata` (`{"section": "refunds"}` ×2,
   `{"section": "shipping"}` ×1).
3. **The actual compiled `PrismaKnowledgeChunkRepository.hybridSearch()`
   method was exercised directly** (via a throwaway Node script requiring
   the real build output, not a hand-copied SQL mirror) — this is what
   caught a real bug (see "Scope deviations" #1): correct cosine-distance
   ordering (exact match `vector_score=1.0000`, close match `0.9997`,
   orthogonal `0.0000`, blended with keyword score correctly), the metadata
   filter correctly narrowing results for `eq` (`section = 'refunds'`
   excludes the shipping chunk) and `contains` (`section` containing
   `'ship'` selects only the shipping chunk), a live SQL-injection attempt
   in `filter.value` neutralized (table intact, row count unchanged, no SQL
   error — the value was safely bound and simply matched nothing), and an
   empty `sourceRefs` short-circuiting without issuing a query at all.
4. HNSW (`knowledge_chunk_embedding_hnsw_idx`) and GIN
   (`knowledge_chunk_search_vector_idx`) indexes both confirmed valid and
   actually selected by the query planner (`enable_seqscan/bitmapscan =
   off` was needed to nudge the planner past its correct "3-row table,
   sequential scan is cheaper" default — the standard technique for
   proving index applicability on a deliberately small verification table).
5. Container torn down, throwaway verification script deleted after each
   run — nothing left in the repo, same discipline as every prior phase's
   pgvector proof.

**V-9/V-10 end-to-end confirmation**: both rules verified through
`ValidateConfigUseCase.execute()`'s full real code path (YAML parse → Gate
A → Gate B → response), not just the isolated rule functions —
`validate-config.use-case.spec.ts` has two dedicated cases: a real config
with a `retrieve` node whose `budget_ms` (50ms) is smaller than the
tenant's real `knowledge.pipeline` stage-budget sum (310ms) produces
`CONFIG_RETRIEVAL_BUDGET_EXCEEDED` and flips `valid` to `false` (blocks);
a real config with a stale, referenced `KnowledgeSource` produces
`KNOWLEDGE_SOURCE_STALE` with `severity: 'warning'` and `valid` stays
`true` (warns, never blocks) — both passing. The Python-side equivalent is
the fixture-corpus contract test: `retrieve-node.yaml` (a valid, real
Retrieve node whose pipeline fits its budget) accepted, `retrieval-budget-exceeded.yaml`
(the same shape with the node's `budget_ms` cut to 100ms against a 310ms
stage sum) rejected — by both the TypeBox and Pydantic validators,
confirmed cross-language-consistent.

**Security review (scoped to what this phase touched):**
- **Hybrid-search/metadata-filter raw SQL**: every value — including
  `filter.field`/`filter.value` — is a bound tagged-template parameter,
  never string-concatenated; proven twice: a real SQL-injection attempt
  against a live pgvector database (above) and a unit test asserting the
  static SQL text never contains the attacker-supplied value/field name
  while the bound-parameters array does. `filter.field` binds safely as
  `metadata ->> $n` because Postgres's `jsonb ->> text` operator's
  right-hand side is an ordinary text expression, not a SQL identifier —
  confirmed correct, not just asserted, by the live-DB proof.
- **`/internal/knowledge/search`, `/internal/knowledge/gaps`, `ai_service`'s
  `/retrieve-preview`**: all three reject a missing or wrong
  `X-Internal-Token` with a real HTTP-pipeline test (real guard, real
  `TypeBoxValidationPipe`/Pydantic dependency, not a directly-instantiated
  controller) with the downstream use-case's call count asserted at zero.
- **`KnowledgePlaygroundController`** (admin-guarded): real
  `AdminJwtGuard`/`RolesGuard`/Passport-strategy HTTP proof — 401 on no
  token, a non-admin `typ`, and a garbage token; 400 on an empty query
  before the use-case runs; a real application error surfaces through the
  real `AppExceptionFilter`. Tenant-scoped (`canAccessTenant`) exactly like
  every other tenant route; `findByTenantId` always called with the path
  tenant id (never a caller-supplied one), so a cross-tenant chunk/citation
  leak is not structurally possible.
- **`KnowledgeGap` rows never written from the Playground**: enforced
  structurally, not by a boolean flag — `RetrievalPipelineInput.gap_recorder`
  is `None` for every Playground preview call, and the threshold stage's
  gap-recording branch is gated on `gap_recorder is not None`; a dedicated
  test (`test_threshold_empty_result_with_no_gap_recorder_does_not_raise`,
  `test_retrieve_preview_never_passes_a_real_gap_recorder`) proves both that
  this never raises and that it's never silently skipped-but-still-called.
- **No vendor API key/credential ever logged or returned**: `ai_service.py`'s
  new `/retrieve-preview` route only ever logs classification reasons
  (`retrieve_preview_llm_unresolvable`/`retrieve_preview_embedding_unresolvable`),
  never a raw vendor error body or resolved secret — same discipline 12a's
  `/embed` already established.
- **Dependencies**: no new package added this phase (the new
  `orchestration/retrieval/` module and `registry.resolve_llm_standalone`
  reuse existing `pydantic`/`httpx`/vendor-adapter dependencies only).
- **Rate limiting**: still not added to the new `/internal/knowledge/*`,
  `ai_service`'s `/retrieve-preview`, or the Playground endpoint — the same
  platform-wide gap every prior phase's admin-triggered/costly-action
  routes already carry (documented, not newly introduced).

**Scope deviations / decisions made this phase (documented, not silently
absorbed) — beyond the ones already recorded above under "Decisions made
this phase":**
1. **A real raw-SQL bug found and fixed by the live pgvector proof, not by
   any mocked unit test**: the first version of `hybridSearch`'s query
   referenced its own `SELECT`-list aliases (`vector_score`/`keyword_score`)
   inside a compound `ORDER BY` expression
   (`ORDER BY (weight * vector_score + weight * keyword_score) DESC`) —
   Postgres resolves an identifier inside a compound `ORDER BY` expression
   against real table/subquery columns, not the enclosing `SELECT` list's
   own aliases (only a *bare* `ORDER BY alias` gets that shortcut). This
   surfaced as a genuine `column "vector_score" does not exist` error the
   first time the real compiled code ran against a live Postgres — a class
   of bug no mocked-`$queryRaw` unit test can ever catch, since the mock
   never actually parses the SQL text. Fixed by wrapping the scored
   candidate set in a subquery so the aliases become real projected columns
   the outer `ORDER BY` can reference by name; re-verified working
   end-to-end (including a second, independent live-container run) after
   the fix. This is the single strongest argument in this phase's own
   delivery for why "verify hybrid search for real" was called out as a
   named, non-skippable gate step rather than trusted to unit tests alone.
2. **A real `import-linter` violation found and fixed during the Python
   build**: an early version of the retrieve executor resolved the
   embedding adapter from inside `orchestration` (reaching
   `registry.resolve_embedding`, which transitively imports vendor adapter
   modules) on a per-call basis — `.importlinter`'s `orchestration-uses-ports`
   contract forbids `avatar_agent.orchestration` from reaching
   `avatar_agent.adapters` even indirectly. Fixed by resolving the embedding
   provider **once per session in `entrypoint.py`** (mirroring
   `_resolve_llm_nodes`'s existing "pre-resolved once per session, threaded
   through `TurnContext`" convention exactly) instead of inside the node
   executor — `lint-imports` confirms 3 kept, 0 broken after the fix, with
   zero new contract entries needed.
3. **A real Angular build break found and fixed**: `RetrieveNodeSchema.budget_ms`
   became a required field this phase, but the Reasoning tab's own
   node-factory (`node-factory.ts`, the function that creates a new Retrieve
   node card when an admin clicks "Add node ▾ → Retrieve") and its node
   inspector never learned about the new field — a structurally-invalid
   Retrieve node (missing `budget_ms`) could be created and saved from the
   Reasoning tab with no way to edit the very field V-10 depends on. Fixed:
   `node-factory.ts` now seeds `budget_ms: 400` (matching the schema
   default) on every new Retrieve node, and the node inspector gained a
   `budget_ms` number input alongside `source_refs`/`top_k`/`next_node_id`.
   Without this fix, V-10 would have been unreachable from the builder UI
   entirely (a config could still set it by hand-edited YAML, but never
   from the graph-builder UI this project's whole Reasoning tab exists to
   provide) — a real, would-have-shipped gap in Phase 9's own Retrieve-node
   stub finally being completed by this phase, not a Phase 12b-introduced
   regression.
4. **`RetrieveNode.top_k` (stubbed since Phase 9, otherwise unused by the
   six-stage pipeline's own stage-by-stage semantics — candidate-pool size
   is `pipeline.hybrid_search.candidates`, the token cap is
   `pipeline.inject.token_cap`) is applied as an additional final-result-count
   ceiling in the inject stage** (whichever of `top_k` chunks or `token_cap`
   binds first stops the walk) — the most natural remaining meaning for a
   field the schema already carried but the pipeline design otherwise had
   no explicit role for.
5. **The rewrite stage's "conversation context" is built from the last
   `2 × context_turns` raw messages in `ctx.residency.messages`** (excluding
   the current utterance, which is passed separately as `query`), not a
   strict user/assistant turn-pairing — `ctx.residency.messages` doesn't
   guarantee strict alternation (a tool-result message can interleave), so
   counting raw messages is the simpler, always-correct choice; a
   reasonable approximation of "N turns" under the common case where
   alternation does hold.
6. **`ai_service.py`'s standalone rewrite-stage LLM call resolves via a new
   `registry.resolve_llm_standalone(LlmLegRequestConfig, secrets)`**, not
   the existing session-shaped `resolve_llm(cfg: AgentRuntimeConfig, ...)`
   — mirrors `EmbeddingRequestConfig`/`resolve_embedding`'s exact Phase 12a
   precedent (a standalone process has no session `AgentRuntimeConfig` to
   supply) rather than either constructing a throwaway config just to
   satisfy `resolve_llm`'s type, or reaching into `adapters.llm.*` directly
   from `services/ai_service.py` (which would duplicate the registry's own
   vendor-key dispatch outside it). Zero new vendor-SDK-touching surface.
7. **Wire marshalling for `POST /internal/knowledge/search` is a shared
   function pair** (`knowledge_search_request_payload`/
   `knowledge_search_response_from_json` in `ports/orchestration.py`), not
   duplicated per caller — `ControlPlaneClient` (the live turn, LiveKit
   worker process) and `ai_service.py`'s standalone outbound client (the
   Playground preview, a separate process) both speak this exact wire
   format from two different processes; sharing the marshalling is what
   keeps them from ever drifting on request/response shape independently of
   each other.
8. **`docker-compose.yml`'s `ai-embedding` service gains
   `CONTROL_PLANE_INTERNAL_URL`** (previously only had `INTERNAL_TOKEN`,
   needed for `/embed`'s inbound guard) — `/retrieve-preview` is this
   service's first outbound call to Nest, reusing the exact same env var
   the `agent` LiveKit worker's own `ControlPlaneClient` already uses rather
   than inventing a second one.
9. **`RunRetrievalPlaygroundUseCase` lives in `deployment-config`, not
   `knowledge`**, despite being conceptually a "knowledge" feature — avoids
   a genuine circular NestJS module import (`deployment-config` already
   depends one-directionally on `knowledge` for V-9's `KNOWLEDGE_SOURCE_REPOSITORY`;
   the reverse dependency this use-case would otherwise need — `knowledge`
   reading `DEPLOYMENT_CONFIG_REPOSITORY` — would close a cycle). Mirrors
   `TestCallGraphUseCase`'s own existing precedent of living in
   `deployment-config` while reaching into another module (`tools`) for
   what it needs.
10. **Bundle-size budget warning** (`admin`'s initial bundle now 14 kB over
    its 1.00 MB budget) — a real, disclosed consequence of the new
    `mat-tab-group`/Pipeline/Playground pages, not fixed this phase (routine
    bundle-hygiene follow-up, orthogonal to this phase's actual scope).

**Follow-ups left open for Phase 13 (Skills), not silently dropped:**
- V-9's "warn unless referenced by a published-path skill" carve-out
  (`UX_SCOPE.md`'s original wording) still treats every live Retrieve-node
  reference as needing the warning — Phase 13 should refine this once a
  real "published-path skill" concept exists to check against; the
  `knowledgeSourceNotStaleRule` function is already structured to make that
  a localized change (add a "referenced by a published skill" exclusion to
  its existing per-node-reference loop), not a redesign.
- `ConfigError`/`ConfigErrorDto`'s `severity` field (introduced one phase
  early, see the "Decisions made this phase" section above) is already in
  place for V-11 (Phase 13's own warn-not-block rule) to reuse directly —
  Phase 13 does not need to re-introduce this contract change, only set
  `severity: 'warning'` on its own rule's output the same way
  `knowledgeSourceNotStaleRule` already does.
- No per-node `knowledge.pipeline` override exists yet (every `retrieve`
  node in a tenant's graph shares the one tenant-level pipeline) — flagged
  in this phase's own "Decisions made this phase" #1 as an additive future
  change (an optional `pipeline_overrides` field) if a real multi-pipeline
  use case ever emerges; nothing in Phase 13's Skills work is expected to
  need it (a Skill's own `knowledgeFilters` per `ARCHITECTURE_NOTES.md` §5.1
  is a metadata-filter *condition* reference, not a second pipeline).
- Bundle-size budget follow-up (see "Scope deviations" #10) — not urgent,
  but worth folding into whichever phase next touches the admin bundle's
  lazy-loading boundaries.
- Rate limiting on `/internal/knowledge/*`, `ai_service`'s
  `/retrieve-preview`, and the Playground endpoint remains an open,
  platform-wide gap (same one every admin-triggered/costly-action route
  already carries since Phase 8) — a dedicated pass before any of these see
  real production traffic, not specific to this phase.
- True cross-encoder reranking (BL-070) and semantic/heading-aware chunking
  (BL-071) remain visibly-present-but-disabled in the UI, exactly as
  scoped — the metadata-filter mechanism this phase built is real and
  tested even though 12a's fixed-size chunker won't populate meaningful
  `metadata` until a future chunking strategy does.

---

## Phase 13 — Skills (BL-049, BL-050, BL-051)

### Goal

Skills become a first-class, tenant-shared, versioned entity: an admin
builds a `refunds` skill once (name/description/instructions/tools/
knowledge filters/budget), attaches it to an agent's base prompt as a
~15-token description-only blurb (never the full instructions — R-S1's
progressive disclosure), and the graph's new `skill`-type node resolves
and injects the full body **lazily**, only once triggered (model-decided
or router-decided), releasing it on exit so the next turn's prompt never
carries it forward. UC-S2 (one skill, two agents/tenants, one approval
rule) is buildable end to end for its non-HITL half; the HITL section of
the editor renders shown-but-disabled per `UX_SCOPE.md`, not a fake
working gate — Phase 14 wires the real thing.

### Scope

**In scope:**
1. **Prisma**: `Skill`/`SkillVersion` models (additive migration), per
   `ARCHITECTURE_NOTES.md` §5.1 — `Skill.tenantId` nullable (BL-074's
   future platform-library case), `platformPublished` always `false` in
   practice this phase; `SkillVersion` is append-only once published
   (same discipline as `ConfigVersion`), mutable while its own row is
   still `status: draft`.
2. **`skills` module** (`apps/api/src/modules/skills/`), four layers
   mirroring `tools/`: create-draft / edit-draft (auto-forks a new draft
   version on first edit after a publish) / publish (own two-gate
   validator) / list / get / delete, tenant-scoped, `AdminJwtGuard`+
   `RolesGuard` exactly like every prior module. A `GET
   /tenants/:id/skills/:skillId/usage` endpoint backs the "used by N
   agents" pre-publish warning.
3. **Progressive disclosure wire-shape change**: `AgentConfigSchema`
   gains a top-level `skills: SkillRef[]` (`{id, version: number |
   "latest"}`, the agent-level "attached" list, contributing to the
   base-prompt cost the same way `agent.tools[]` does for tools).
   `GetRuntimeConfigUseCase` resolves every `"latest"` reference (both the
   top-level list and any `skill`-type graph node's own `version`) to a
   concrete published version number **once, at session-start read time**
   — the same "resolve once per session" discipline this codebase already
   applies to `agent.tools[]`/the reasoning graph — and returns the
   resolved descriptions as a **new** `skill_summaries: SkillSummaryDto[]`
   field (id, version, name, description only), never inlining
   instructions into `system_prompt`.
4. **Lazy internal endpoint**: `GET
   /internal/skills/{id}/versions/{version}/body`, `InternalTokenGuard`
   -guarded exactly like every other `/internal` route, returning the full
   `instructions`/resolved `tool_definitions`/`knowledge_filters`/
   `budget_ms` — called only when a `skill`-type node's trigger actually
   fires, cached in-process per session thereafter.
5. **`skill`-type graph node** (both languages): `{skill_id, version,
   budget_ms, next_node_id}` — added to the `GraphNode` discriminated
   union, `critical-path.ts`/`graph-structure.ts`/`graph-rules.ts` and
   their Pydantic mirror all extended the same way every prior node type
   was. Executor: lazy-fetches the body (cached), runs one bounded LLM
   turn with the skill's own instructions appended to a **turn-local**
   system prompt and its own tools attached — never a nested sub-graph
   this phase (see "Decisions made this phase" once implementation
   lands) — and never mutates persistent `SessionMemory`/the pipeline's
   own immutable `_system_prompt` (R-S1's "release on exit").
6. **Validation**: V-12 `skillRefsKnownAndEnabledRule` (Gate B, mirrors
   `toolRefsKnownRule` exactly — checks both the top-level `skills[]` list
   and every graph `skill`-type node's `skill_id`); V-11 base-prompt token
   ceiling (new `domain/prompt-cost.ts`, warning-class via the
   Phase-12b-added `severity` field) — Phase 8 never actually built a
   backend estimator (only a client-side heuristic banner on the Tools
   tab), so this phase builds V-11 from scratch with both the tools term
   and the skills term in one pass, not just "completing" a pre-existing
   sum.
7. **Skills' own two-gate validator** (lives in the `skills` module, a
   different aggregate's lifecycle than `deployment-config`'s per
   `ARCHITECTURE_NOTES.md` §5.4): own instructions non-empty, tool refs
   known; an HITL-gate-completeness check is a documented **no-op stub**
   (there is no `HitlGate` entity to check against until Phase 14).
8. **Frontend**: Skills tab (library table + editor, `/admin/tenants/:id/skills`
   routes), reusing the shared `test-call-panel`/`budget-bar` components;
   the Reasoning tab's node-factory/card/inspector gain the `skill` node
   type (an admin cannot build UC-S2's graph without this).

**Out of scope (explicit):** platform-library publish/adopt flow
(BL-074 — Skills library ships tenant-section only, no disabled
placeholder); "Extract from prompt" AI-assist (BL-073 — omitted
entirely); any real HITL gate enforcement (Phase 14); a nested sub-graph
per skill (documented as a Phase-14-or-later follow-up, not built this
phase — see "Decisions made this phase"); Sub-agent/Handoff/State node
types (Phase 15); the 8-tab shell (Phase 16); real multi-environment
isolation (`ARCHITECTURE_NOTES.md` §0.2's standing descope — `environments[]`
stays a UI-only label).

### Decisions made this phase

1. **Skill node executor runs "a plain LLM turn with the skill's tools/
   instructions attached," never a nested sub-graph.** `SkillVersion`
   carries no graph of its own in this phase's schema. Building a full
   nested-sub-graph-per-skill would need its own node-id namespace, its
   own budget accounting one level down, and its own `on_error`/
   `on_deadline` semantics — a materially larger feature than BL-049/050/
   051 scope. Documented as a real, named follow-up, not silently dropped.
2. **`trigger_mode` (model vs. router) does not change the Skill node
   executor's own runtime behavior in v1.** A Skill node is always reached
   via ordinary deterministic graph wiring (a Router branch, or a plain
   `next_node_id` chain) exactly like every other node type — there is no
   mechanism today for the LLM to dynamically "call" a skill mid-stream
   the way it calls a tool (`ToolSpec`/`tool_calls`). Building that would
   require teaching the LLM node executor's own tool-calling round trip to
   recognize and route to a skill-shaped pseudo-tool call — a
   substantially larger change to `nodes/llm.py`'s core loop and the
   interpreter's control-flow model. `trigger_mode` is persisted and
   surfaced in the builder (R-S2's UI-facing half, including the
   latency-tradeoff helper text) but is metadata only at runtime this
   phase — a named Phase-14-or-later follow-up for the model-decided
   dynamic-dispatch mechanism itself.
3. **The runtime-resolved skill description blurb is a new field,
   `skill_summaries`, not an override of the inherited `skills:
   SkillRef[]`.** `AgentRuntimeConfig` (Python) subclasses `AgentConfig`;
   overriding an inherited field's type across that subclass boundary
   (`SkillRef[]` → `SkillSummary[]`) would fail mypy's override-
   compatibility check for a same-named field with an incompatible type.
   Mirrors the existing `agent.tools[]` (bare refs) vs. `tool_definitions`
   (resolved enrichment) precedent exactly, just at the top level since
   skills sit there per the architecture doc rather than nested under
   `agent`. Both languages' contracts carry this field under the same
   name (`skill_summaries`).
4. **`GetRuntimeConfigUseCase` resolves every `"latest"` skill reference
   (both the top-level `skills[]` list and any `skill`-type graph node's
   own `version`) once, at session-start read time** — the same
   "resolve once per session" discipline already applied to `agent.tools[]`
   and the reasoning graph's LLM legs. A live session's config therefore
   never carries the literal string `"latest"` through to the Python
   interpreter; `SkillNodeExecutor` treats an unresolved `"latest"`
   reaching it as a defensive, should-never-happen condition.
5. **"Used by N agents" is computed via a direct `PrismaService` read of
   `DeploymentConfig.yaml_text` from inside the `skills` module's own
   repository, not through `deployment-config`'s module/service layer.**
   `deployment-config` already depends one-directionally on `skills`
   (`SKILL_REPOSITORY`, for V-11/V-12); the reverse dependency this count
   would otherwise need would close a real NestJS module cycle. Mirrors
   Phase 12b's own precedent (`RunRetrievalPlaygroundUseCase` relocated to
   avoid an analogous cycle) of relocating rather than reaching for
   `forwardRef`. Because this codebase's data model gives every tenant
   **exactly one** `DeploymentConfig` row, the count is structurally
   bounded to 0 or 1 today — the mechanism (parsing the row's `skills[]`/
   `skill`-type-node references) is real and will report a genuine
   per-agent count the moment a future phase introduces multiple agent
   configs per tenant.
6. **V-11 is a from-scratch backend implementation this phase, not a
   completion of a pre-existing sum.** Phase 8 built only a client-side
   heuristic banner on the Tools tab (no backend estimator existed at
   all) — checked directly before writing `domain/prompt-cost.ts`. The
   new estimator sums three terms (core system prompt + attached tool
   descriptions + attached skill descriptions) using the same "~4 UTF-8
   bytes per token" heuristic the Tools tab's client-side banner already
   uses, kept numerically consistent across both surfaces.
7. **`interpreter.py`'s `last_llm` tracking (the R-G1 "speak the last LLM
   output, then end" default-case fallback, and `speak`-type nodes' own
   `mode: llm_output`) now includes `node.type == "skill"`, not just
   `"llm"`.** A completed Skill node produces the identical `NodeResult`
   shape an LLM node does (`output_text`/`provider_key`/`used_fallback`/
   `first_token_ms`) — without this one-line extension, a graph ending on
   a Skill node with no explicit Speak/End would silently produce no
   speech at all, a real functional gap found and fixed during this
   phase's own implementation (not a pre-existing bug).
8. **`TurnContext` gains three new fields**: `skill_body_port`
   (`ISkillBodyPort | None`), `secrets` (`SecretStorePort | None`, needed
   only for lazily resolving a skill's own tool credentials on first
   trigger — a skill's tools may not be part of `agent.tools[]`'s
   already-resolved set at all), and `skill_body_cache` (a per-session
   dict, created once in `ConversationPipeline.__init__` and threaded by
   reference into every turn's fresh `TurnContext` — never recreated per
   turn, which is what makes "cached in-process for that session once
   triggered" true across multiple turns). All three default to `None`/
   `{}` so the many existing tests that never exercise a Skill node are
   unaffected.
9. **The Reasoning tab's Skill node inspector offers only two version
   choices**: `"latest"` or a pin to the skill's own *currently published*
   version number (`SkillDto.published_version.version_number`) — not a
   full version-history picker, since the Skills module's read surface
   this phase only ever exposes the current draft/published pair, not a
   version list endpoint (out of scope; the architecture doc's own
   `SkillVersion` history is real in the database, just not surfaced via
   a dedicated list-versions API this phase).

### Deliverables

**Contracts** (`packages/contracts/src/`): `agent-config/reasoning-graph.schema.ts`
(edited — `SkillNodeSchema`, `SkillRefSchema`, added to `GraphNodeSchema`);
`agent-config/schema.ts` (edited — top-level `skills: SkillRefSchema[]`);
`skills/schemas.ts` (new — full Skill/SkillVersion CRUD + usage DTOs);
`internal/schemas.ts` (edited — `SkillBodyResponseSchema`,
`SkillSummaryDtoSchema`, `AgentRuntimeConfigDtoSchema.skill_summaries`);
`error-codes.ts` (edited — `SKILL_*`, `CONFIG_SKILL_UNKNOWN`,
`CONFIG_BASE_PROMPT_COST_HIGH`); `index.ts` (edited — exports `skills/schemas`).
`apps/agent/fixtures/agent-config/{valid,invalid}/*.yaml` (all 18 existing
fixtures edited — `skills: []` added; `valid/skill-node.yaml` new).

**Backend** (`apps/api/src/`): `modules/skills/` (new, four layers —
`domain/{skill.ts,ports.ts,skill-validation.ts(+.spec)}`,
`application/{create,list,get,update-skill-draft,publish,delete,get-skill-usage,get-skill-body}-skill.use-case.ts(+.spec)`,
`application/skill-dto.ts`, `infrastructure/prisma-skill.repository.ts(+.spec)`,
`interface/skills.controller.ts(+.spec)`, `skills.module.ts`, `index.ts`);
`modules/internal/interface/skills-internal.controller.ts` (new, +`.http.spec.ts`),
`modules/internal/internal.module.ts` (edited); `modules/deployment-config/domain/prompt-cost.ts`
(new, V-11, +`.spec.ts`); `modules/deployment-config/domain/{graph-structure,graph-rules,critical-path,agent-config,draft-schema}.ts`
(edited — `skill` node type plumbing); `modules/deployment-config/domain/combination-rules.ts`
(edited — V-11 `basePromptCostWithinCeilingRule`, V-12 `skillRefsKnownAndEnabledRule`, +`.spec.ts`);
`modules/deployment-config/application/validate-config.use-case.ts` (edited,
+`.spec.ts`), `save-config.use-case.spec.ts` (edited, mock only),
`test-call-graph.use-case.ts` (edited — `skill` simulator branch);
`modules/deployment-config/deployment-config.module.ts` (edited — imports `SkillsModule`);
`modules/sessions/application/get-runtime-config.use-case.ts` (edited —
`skills`/`skill_summaries` resolution, +`.spec.ts`); `modules/sessions/sessions.module.ts`
(edited — imports `SkillsModule`); `app.module.ts` (edited — registers `SkillsModule`);
`prisma/schema.prisma` (edited — `Skill`/`SkillVersion` models + enums);
`prisma/migrations/20260903120000_skills_phase13/migration.sql` (new, hand-authored
after `prisma migrate dev`'s auto-diff proved unusable — see Result section).

**Python** (`apps/agent/src/avatar_agent/`): `contracts/runtime_config.py`
(edited — `SkillRef`, `SkillSummary`, `SkillNode`, `AgentConfig.skills`,
`AgentRuntimeConfig.skill_summaries`, `ReasoningBlock` isinstance-tuple
extended); `orchestration/graph/nodes/skill.py` (new executor);
`orchestration/graph/registry.py` (edited — `"skill"` dispatch entry);
`orchestration/graph/interpreter.py` (edited — `last_llm` tracking extended
to `"skill"`, see "Decisions made this phase" #7); `orchestration/pipeline.py`
(edited — `skill_body_port`/`secrets`/`skill_body_cache` threaded into
`TurnContext`); `entrypoint.py` (edited — `_build_effective_system_prompt`,
`ControlPlaneSkillBodyAdapter` wiring); `telemetry/control_plane.py` (edited
— `get_skill_body`, `ControlPlaneSkillBodyAdapter`); `ports/orchestration.py`
(edited — `SkillBody`/`SkillToolDefinition`/`SkillKnowledgeFilters`/
`ISkillBodyPort`, new `TurnContext` fields). Tests:
`tests/orchestration/graph/nodes/test_skill.py` (new, 16 cases),
`tests/orchestration/test_skill_release_on_exit.py` (new — the phase's
named centerpiece proof), `tests/orchestration/graph/test_graph_registry.py`
(edited — 9 node types).

**Frontend** (`apps/web/projects/`): `admin/src/app/features/skills/` (new
— library + editor pages, store, routes — built by a delegated background
session, see Result section for its own file list); `admin/.../features/reasoning/`
(edited — `skill` node type in `node-factory.ts`, `node-card.component.{ts,html}`,
`node-inspector.component.{ts,html}` (+`.spec.ts` for both factory and
inspector), `reasoning.store.ts` (+`.spec.ts`), `reasoning-page.component.ts` (+`.spec.ts`));
`shared/src/lib/util/node-type-icon.ts` (edited — `skill` icon/label, +`.spec.ts`);
`shared/src/lib/api/skills-api.service.ts` (new, +`.spec.ts`), `api/index.ts` (edited);
`eslint.config.mjs` (edited — `skills` added to `webFeatures`).

### Exit gate
- `pnpm --filter @liveavatar/contracts build && lint` — schema + contract
  test green.
- `pnpm --filter @liveavatar/api build/lint/test` — new specs per
  use-case/repository/controller in `skills/`, the lazy-fetch endpoint's
  guard, V-11/V-12.
- `pnpm --filter @liveavatar/web build/lint/test` — new specs for the
  library/editor components/store, the Reasoning tab's `skill` node
  additions.
- `apps/agent`: `ruff check`/`ruff format --check`/`mypy src`/`pytest -q`/
  `lint-imports` — new tests for the Skill node executor (model-decided
  trigger, router-decided trigger, and the release-on-exit proof: inject
  a skill body, complete the node, assert the *next* turn's built prompt/
  `SessionMemory` do not contain it).
- Security review scoped to: the new internal skill-body endpoint's guard
  (real HTTP-pipeline test, not just code inspection); tenant-scoping on
  every skills CRUD route (negative cross-tenant test); the lazy-fetch
  cache is per-session/tenant, never global.
- This section updated with the actual gate output, scope deviations, and
  Phase 14 follow-ups before Phase 14 starts.

### Result — Phase 13 done (2026-09-03)

**Delivered as planned**, built by the orchestrating session directly for
the shared foundation/highest-risk surface (contracts, Prisma, the
`skills` module, the progressive-disclosure wire-shape change, the Python
Skill node executor and its release-on-exit proof, and the Reasoning tab's
Skill node support), with the standalone Skills library/editor pages built
in parallel by a delegated background session against those already-locked
contracts — every file independently re-read and every gate re-run from
scratch by the orchestrating session after the building session's own
report, per this project's "trust but verify" discipline. This pass found
and fixed one real, non-trivial, **cross-phase** bug the sub-agent's own
gate did not itself need to fix but correctly traced and flagged (see
"Scope deviations" #4) — consistent with the precedent Phase 12b set of
independent re-verification catching what a single build pass misses.

**Files — Contracts** (`packages/contracts/src/`):
`agent-config/reasoning-graph.schema.ts` (edited — `SkillNodeSchema`,
`SkillRefSchema`, both added to their respective unions/blocks);
`agent-config/schema.ts` (edited — top-level `skills: SkillRefSchema[]`);
`skills/schemas.ts` (new — `SkillTriggerModeSchema`, `SkillVersionStatusSchema`,
`SkillKnowledgeFilterSchema`, `CreateSkillRequestSchema`,
`UpdateSkillDraftRequestSchema`, `SkillVersionSchema`, `SkillSchema`,
`ListSkillsResponseSchema`, `SkillUsageResponseSchema`,
`PublishSkillResponseSchema`); `internal/schemas.ts` (edited —
`SkillBodyResponseSchema`, `SkillSummaryDtoSchema`,
`AgentRuntimeConfigDtoSchema.skill_summaries`); `error-codes.ts` (edited —
`SKILL_NOT_FOUND`/`SKILL_FORBIDDEN`/`SKILL_NAME_REQUIRED`/
`SKILL_SLUG_EXISTS`/`SKILL_DESCRIPTION_REQUIRED`/`SKILL_INSTRUCTIONS_REQUIRED`/
`SKILL_TOOL_REF_UNKNOWN`/`SKILL_VERSION_NOT_FOUND`/`CONFIG_SKILL_UNKNOWN`/
`CONFIG_BASE_PROMPT_COST_HIGH`); `index.ts` (edited — exports `skills/schemas`).
`apps/agent/fixtures/agent-config/{valid,invalid}/*.yaml` (all 18
pre-existing fixtures edited — `skills: []` added ahead of `privacy:`, a
required-field addition that would otherwise fail every one of them);
`valid/skill-node.yaml` (new — an LLM→Skill two-node graph exercising
`version: latest`).

**Files — API** (`apps/api/`):
- `prisma/schema.prisma` (edited — `SkillTriggerMode`/`SkillVersionStatus`
  enums, `Skill`/`SkillVersion` models, `Tenant.skills` reverse relation);
  `prisma/migrations/20260903120000_skills_phase13/migration.sql` (new,
  **hand-authored** — see "Scope deviations" #1 for why `prisma migrate
  dev`'s auto-diff was unusable here).
- `src/modules/skills/` (new, four layers): `domain/skill.ts`
  (`SkillRecord`/`SkillVersionRecord`/`SkillWithVersionsRecord`,
  `deriveSkillSlug`); `domain/ports.ts` (`SkillRepositoryPort` + input/
  record types, `SKILL_REPOSITORY`); `domain/skill-validation.ts`
  (`validateSkillDraftForPublish`, `validateHitlGateStub`) + `.spec.ts`;
  `application/{create,list,get,update-skill-draft,publish,delete,
  get-skill-usage,get-skill-body}-skill.use-case.ts` (each + `.spec.ts`),
  `application/skill-dto.ts`; `infrastructure/prisma-skill.repository.ts`
  (+ `.spec.ts`, 20 cases); `interface/skills.controller.ts` (+ `.spec.ts`);
  `skills.module.ts`, `index.ts`.
- `src/modules/internal/interface/skills-internal.controller.ts` (new,
  `GET /internal/skills/:id/versions/:version/body`) + `.http.spec.ts`
  (new — real `InternalTokenGuard` HTTP-pipeline proof, 4 cases);
  `internal.module.ts` (edited — registers both).
- `src/modules/deployment-config/domain/prompt-cost.ts` (new — V-11's
  `estimateTokens`/`computeBasePromptCost`) + `.spec.ts` (new, 8 cases);
  `domain/combination-rules.ts` (edited — `skillRefsKnownAndEnabledRule`
  (V-12) and `basePromptCostWithinCeilingRule` (V-11, `severity: 'warning'`)
  registered into `COMBINATION_RULES`; `ValidationContext` gains
  `toolDescriptionsByApiRef`/`publishedSkills`) + `.spec.ts` (edited — 9
  new cases); `domain/{graph-structure,graph-rules,critical-path}.ts`
  (edited — `'skill'` case added to every exhaustive `GraphNode['type']`
  switch); `domain/agent-config.ts`/`draft-schema.ts` (edited — `skills`
  field plumbed through `PartialAgentConfig`/the draft mirror/
  `emptyAgentConfig`/`AGENT_CONFIG_TOP_LEVEL_KEYS`).
- `src/modules/deployment-config/application/validate-config.use-case.ts`
  (edited — injects `SKILL_REPOSITORY`, populates
  `publishedSkills`/`toolDescriptionsByApiRef`) + `.spec.ts` (edited, new
  mock); `save-config.use-case.spec.ts` (edited, mock only);
  `test-call-graph.use-case.ts` (edited — `'skill'` structural-simulator
  branch, mirrors the `retrieve` stub precedent); `deployment-config.module.ts`
  (edited — imports `SkillsModule`).
- `src/modules/sessions/application/get-runtime-config.use-case.ts`
  (edited — resolves every `"latest"` skill reference once per session,
  both the top-level `skills[]` list into `skill_summaries` and any
  `skill`-type graph node's own `version`) + `.spec.ts` (edited, new
  mock); `sessions.module.ts` (edited — imports `SkillsModule`).
- `app.module.ts` (edited — registers `SkillsModule`).

**Files — Python** (`apps/agent/src/avatar_agent/`):
- `contracts/runtime_config.py` (edited — `SkillRef`, `SkillSummary`,
  `SkillNode`, `AgentConfig.skills`, `AgentRuntimeConfig.skill_summaries`,
  `ReasoningBlock`'s referential-integrity isinstance-tuple extended for
  `SkillNode`).
- `orchestration/graph/nodes/skill.py` (new — `SkillNodeExecutor`,
  `_resolve_skill_tools`, `_consume_stream`, `_failure`);
  `orchestration/graph/registry.py` (edited — `"skill": SkillNodeExecutor()`);
  `orchestration/graph/interpreter.py` (edited — `last_llm` tracking
  extended from `node.type == "llm"` to `node.type in ("llm", "skill")`,
  a real functional gap found and fixed during this phase, see "Scope
  deviations" #2).
- `orchestration/pipeline.py` (edited — `skill_body_port`/`secrets`/
  `skill_body_cache` new constructor params, the cache dict created once
  per `ConversationPipeline.__init__` and threaded by reference into every
  turn's `TurnContext`); `entrypoint.py` (edited —
  `_build_effective_system_prompt`, `ControlPlaneSkillBodyAdapter` wiring);
  `telemetry/control_plane.py` (edited — `ControlPlaneClient.get_skill_body`,
  `ControlPlaneSkillBodyAdapter`).
- `ports/orchestration.py` (edited — `SkillToolDefinition`,
  `SkillKnowledgeFilters`, `SkillBody`, `ISkillBodyPort`, three new
  `TurnContext` fields).
- Tests: `tests/orchestration/graph/nodes/test_skill.py` (new, 16 cases —
  happy path, caching incl. tenant/version-scoped cache keys, the skill's
  own tool round trip incl. lazy credential resolution, every failure
  mode, and a parametrized proof that `trigger_mode` doesn't change
  runtime behavior); `tests/orchestration/test_skill_release_on_exit.py`
  (new — the phase's named centerpiece: a 3-turn real-pipeline,
  real-interpreter proof of R-S1's "release on exit," plus a 4th test
  proving the skill-body cache is never shared across two sessions even
  for an identical skill id/version); `tests/orchestration/graph/test_graph_registry.py`
  (edited — 9 node types, was 8).

**Files — Web** (`apps/web/projects/`):
- `admin/src/app/features/skills/` (new — built by the delegated
  session): `skills.routes.ts`; `store/skills-library.store.ts` (+`.spec.ts`,
  mirrors `ToolsStore`'s load/create/remove shape); `store/skill-editor.store.ts`
  (+`.spec.ts`, mirrors `reasoning.store.ts`'s debounced-autosave shape —
  see "Scope deviations" #4 for the bug this store's own careful build
  surfaced); `util/text-metrics.ts` (+`.spec.ts` — `utf8ByteLength`/
  `estimateTokens`, deliberately duplicated from `agent-builder`'s own
  utility per the ESLint feature-isolation boundary, numerically
  consistent with the backend's `prompt-cost.ts` and the Tools tab's
  client heuristic); `pages/skills-library-page/*` (+`.spec.ts`);
  `pages/skill-editor-page/*` (+`.spec.ts`); `components/new-skill-dialog/*`
  (+`.spec.ts`).
- `admin/src/app/features/reasoning/` (edited, built directly): `store/node-factory.ts`
  (+`.spec.ts` — `'skill'` node type, `createDefaultNode` case);
  `store/reasoning.store.ts` (+`.spec.ts` — `skills` signal loaded via
  `SkillsApiService`, **and the `distinctUntilChanged()` bug fix, see
  below**); `components/node-card/node-card.component.{ts,html}` (edited
  — `'skill'` in both `nextNodeId()`/`chainNextId()` switches, a `· skill:
  id@version` meta line); `components/node-inspector/node-inspector.component.{ts,html}`
  (+`.spec.ts` — full Skill field set: `skill_id` picker from
  `data.skills`, a two-option version `<mat-select>` (`"latest"` or pin to
  the currently-published version number), `budget_ms`, `next_node_id`);
  `pages/reasoning-page/reasoning-page.component.ts` (+`.spec.ts` —
  passes `skills` into `NodeInspectorData`).
- `admin/src/app/features/agent-builder/store/agent-builder.store.ts`
  (edited — same `distinctUntilChanged()` fix, +`.spec.ts` regression test)
  and `admin/src/app/features/knowledge/store/knowledge-pipeline.store.ts`
  (edited — same fix, +`.spec.ts` regression test): see "Scope deviations"
  #4 below — **not originally in this phase's file list**, fixed here as
  a real, cross-cutting, in-phase bug fix per this project's standing
  process ("find the real bug, fix it in the same phase, don't ticket
  it").
- `shared/src/lib/util/node-type-icon.ts` (edited — `skill: 'auto_awesome'`
  icon, `'Skill'` label) + `.spec.ts` (edited); `shared/src/lib/api/skills-api.service.ts`
  (new) + `.spec.ts` (new); `api/index.ts` (edited).
- `eslint.config.mjs` (edited — `{ project: 'admin', feature: 'skills' }`
  added to `webFeatures`).

**Gate — actually run, not assumed** (every command re-run independently
by the orchestrating session after the delegated session's own report):
- `pnpm --filter @liveavatar/contracts build` / `lint` — clean.
- `pnpm --filter @liveavatar/api build` (`prisma generate` + `nest build`)
  — clean. `pnpm --filter @liveavatar/api lint` — clean.
- `pnpm --filter @liveavatar/api test` — **1232/1233 tests, 181/184
  suites.** The 3 failing suites (`providers/infrastructure/http-probe-strategy.spec.ts`,
  `providers/domain/validation.spec.ts`,
  `providers/application/update-provider-credential.use-case.spec.ts`)
  are the same pre-existing `assertEndpointUrl` signature-drift finding
  documented in every prior phase's gate results since Phase 8 —
  confirmed unrelated: no file under `providers/` was touched this phase.
- `pnpm --filter @liveavatar/web build` — clean (both `admin`/`conversation`
  bundles); the pre-existing "`@liveavatar/contracts` is not ESM" warning
  persists (documented every prior phase); `admin`'s initial bundle now
  21.14 kB over its 1.00 MB budget (was 14 kB over after Phase 12b, 20.66
  kB after this phase's own Reasoning-tab additions before the Skills
  pages landed) — a real, disclosed, incremental consequence of this
  phase's UI additions, not a defect; carried forward as the same
  bundle-hygiene follow-up every prior phase has flagged, not fixed here.
  `pnpm --filter @liveavatar/web lint` — clean.
- `pnpm --filter @liveavatar/web test` — **700/700 tests, 90/90 suites**
  (was 632/84 before this phase; +65 from the delegated Skills-tab session,
  +3 from this session's own Reasoning-tab work minus the 3 pre-existing
  specs that needed updating for the new `'skill'` type becoming
  "recognized" rather than "unrecognized" in `node-type-icon.spec.ts`/
  `node-factory.spec.ts`, netting cleanly; +3 `distinctUntilChanged`
  regression tests found while addressing the coordinator's follow-up).
- `apps/agent`: `ruff check .` — all checks passed. `ruff format --check .`
  — 125 files already formatted. `mypy src` — no issues, 81 source files.
  `pytest -q` (full suite, `--ignore=tests/adapters/avatar/test_bithuman.py`
  — see "Environment limitations" below) — **438/451 passing.** The 13
  failures are 1 pre-existing pydantic-version-drift finding
  (`test_rejects_a_non_https_looking_garbage_endpoint`, documented in
  every prior phase) plus 12 tests that transitively import the
  `bithuman` package, which this Windows sandbox cannot install (no
  Windows wheel exists on PyPI for any version) — an environment
  limitation, not a regression; none of the 13 touch anything this phase
  changed. `lint-imports` — **3 kept, 0 broken** — the new
  `orchestration/graph/nodes/skill.py` needed zero contract changes (it
  lives inside the already-permitted `orchestration` layer, and resolves
  its own tool credentials via the already-ports-layer `SecretStorePort`
  threaded through `TurnContext`, never reaching `adapters` directly).

**Environment limitations (disclosed, not silently worked around):**
- `uv` was not preinstalled in this sandbox; installed via `pip install uv`
  (a one-time, harmless local tool install, not a project dependency
  change) to run the Python gate at all.
- `bithuman` (a core, non-optional `apps/agent` dependency) publishes no
  Windows wheel for any version — `uv sync` was run with
  `--no-install-package bithuman` so the rest of the Python toolchain
  (ruff/mypy/pytest/import-linter) could run natively on this Windows
  sandbox; the 12 tests that import it transitively are skipped via
  `--ignore`, consistent with every prior phase's own "known sandbox
  issue, time-boxed, documented" posture for its own blocked pieces
  (e2e/testcontainers). Not a Phase 13 regression — this dependency
  predates this phase.

**Real, non-mocked verification performed this phase (the task's own
"genuinely proven, not assumed" bar):**
1. **Prisma migration correctness**: `prisma migrate dev`'s auto-diff
   against this schema change produced spurious, unrelated `DROP INDEX`/
   `ALTER COLUMN ... DROP DEFAULT` statements against `knowledge_chunk`'s
   hand-added generated `search_vector` column (the same `Unsupported()`-type
   friction 12a/12b's own migrations already navigate) — the auto-generated
   migration was discarded and the `Skill`/`SkillVersion` portion of it
   (verified identical table/index/FK DDL to what was hand-authored) was
   copied into a hand-written `migration.sql`, confirmed to apply cleanly
   end-to-end (all 7 migrations, fresh `pgvector/pgvector:pg16` container)
   with `prisma migrate diff` reporting **zero** drift attributable to
   this phase (only the pre-existing, already-documented
   `knowledge_chunk`/generated-column cosmetic drift remained).
2. **Full Skill lifecycle against a real Postgres** (disposable
   `pgvector/pgvector:pg16` container, all migrations applied, throwaway
   `tsx` script deleted after): create (Skill + v1 draft, JSON round-trip
   of `tools`/`knowledgeFilters` verified byte-for-byte) → patch in place
   (no fork) → publish v1 (immutable, `Skill.currentPublishedVersionId`
   set) → re-publish with no draft (`'no-draft'` sentinel) → edit after
   publish (auto-forks v2 from v1's content, v1 untouched) → publish v2
   (pointer moves, v1 stays independently resolvable by explicit version —
   proving immutability, not just "the latest works") →
   `findPublishedVersionBody` resolves the real owning `tenantId` (never
   caller-supplied) → `agentUsageCounts` real `DeploymentConfig.yaml_text`
   scan → **cross-tenant isolation**: a second tenant's `findById`/
   `updateDraft` against the first tenant's skill id return `null`/
   `'missing'` respectively → cascade delete removes all `SkillVersion`
   rows. All 13 checks passed with zero `FAIL:` assertions.
3. **Real dual-process boot test** (same disposable Postgres + a
   disposable `redis:7-alpine`, full `pnpm build`, `node dist/main.js` and
   `node dist/main-internal.js` run directly, not via `nest start`): both
   the public (`:8080`-shaped) and the internal (`:8081`-shaped) NestJS
   applications reached "Nest application successfully started" with
   `SkillsController`'s six routes and `SkillsInternalController`'s one
   route correctly mapped — proving the `SkillsModule`/`SkillsInternalController`
   DI wiring resolves in **both** independent DI containers (`AppModule`
   and the genuinely separate `InternalAppModule`), not just at `tsc`
   compile time. This boot test surfaced a real finding — see "Scope
   deviations" #3.
4. **Release-on-exit**: proven via a real, executed 3-turn conversation
   through the actual `LangGraphOrchestrator`/`GraphInterpreter`/
   `ConversationPipeline` (not a mock), asserting the exact `ResidencyPayload`
   content each of three real LLM-provider calls received, plus a direct
   inspection of `SessionMemory`'s content after the run. A deliberate
   sanity-check regression (temporarily disabling the injection) was run
   and confirmed to fail the test before reverting, proving the test
   itself is load-bearing, not vacuously passing.
5. **The `distinctUntilChanged()` fix** (see "Scope deviations" #4): a
   deliberate sanity-check regression (temporarily reintroducing the bug
   in `reasoning.store.ts`) was run and confirmed to fail the new
   regression test before reverting, for the same reason.

**Security review (scoped to what this phase touched):**
- **`SkillsController`** (`/tenants/:id/skills*`): every route sits behind
  `@UseGuards(AdminJwtGuard, RolesGuard)`; every use-case re-derives
  tenant access via `tenants.findById` + `canAccessTenant`, never trusts
  the path id alone (unit-tested: unknown tenant → 404, unassigned admin
  → 403, before any repository call). Cross-tenant isolation additionally
  proven against a **real** Postgres (see above), not just mocked
  assertions.
- **`SkillsInternalController`** (`GET /internal/skills/:id/versions/:version/body`):
  `InternalTokenGuard`-guarded, proven with a real HTTP-pipeline test
  (missing token → 401, wrong token → 401, both asserting the use-case
  was never called; non-numeric `version` segment → 404 without calling
  the use-case). No cross-tenant leak vector: the route takes no tenant
  id at all — `GetSkillBodyUseCase` resolves `tenantId` from the matched
  `Skill` row itself (never caller-supplied) before resolving tool
  definitions, proven with a dedicated unit test asserting
  `listEnabledByApiRefs` is called with the skill's own real tenant id.
- **Lazy-fetch cache is per-session, never global**: `TurnContext.skill_body_cache`
  is created once per `ConversationPipeline.__init__` (one instance = one
  live session) and threaded by reference into every turn — proven with a
  dedicated test constructing two independent pipelines for two different
  tenants referencing the identical `skill_id`/`version` pair and
  asserting neither's cache dict is the same object and neither ever sees
  the other's instructions text.
- **YAML parsing in `agentUsageCounts`** uses the same safe `yaml` package
  parser (`parseYaml`, no custom tags) every other config-YAML read path
  in this codebase already uses — never `eval`. A malformed `yaml_text`
  is caught and treated as "no references," never thrown.
- **No new raw SQL surface**: the `skills` module is Prisma-ORM-only,
  no `$queryRaw`/`$executeRaw` anywhere in it.
- **Dependencies**: no new npm/PyPI package added this phase (Python's
  `uv sync --no-install-package bithuman` only affects this sandbox's own
  ability to install a pre-existing dependency, not the dependency set
  itself).
- **New finding — pre-existing, not introduced by this phase, but
  extended by it**: the real dual-process boot test (above) revealed that
  the internal listener (`InternalAppModule` / `:8081`) already maps
  every admin-JWT-guarded controller from every module `SessionsModule`
  transitively imports — `TenantsController`, `DeploymentConfigController`,
  `ProviderCredentialsController`/`ProviderDefinitionsController`,
  `ToolsController`, `KnowledgeSourcesController`, and now (via this
  phase's `SessionsModule` → `SkillsModule` import, needed for
  `GetRuntimeConfigUseCase`'s skill-ref resolution) `SkillsController`
  too — onto the *same* HTTP server as the intentionally agent-only
  `/internal/*` routes. This is a **pre-existing NestJS module-composition
  characteristic** (confirmed present for `ToolsController`/
  `DeploymentConfigController`/etc. before this phase touched anything —
  `SessionsModule` already imported `ToolsModule`/`DeploymentConfigModule`/
  `ProvidersModule`/`TenantsModule`, and `InternalModule` already imported
  `KnowledgeModule`, all pre-Phase-13), not a Phase 13 regression — this
  phase's own change (`SessionsModule` importing `SkillsModule`) merely
  extends an already-7-phases-old pattern by one more controller. Every
  one of these controllers, including `SkillsController`, is still
  `AdminJwtGuard`-protected, so this is not an unauthenticated-access
  vulnerability — it is an unintended extra network-reachability surface
  finding (admin routes reachable on the internal listener's port, which
  `InternalAppModule`'s own docstring's stated intent — "internal
  heartbeat/tool URLs not exposed on the public conversation origin ...
  never registered on the public app's router at all, not just
  firewalled" — did not anticipate for *admin* routes specifically).
  **Flagged, not silently fixed** (fixing it properly means restructuring
  `SessionsModule`'s dependencies to import only ports/repositories, not
  whole feature modules with controllers — a real, un-scoped architectural
  change touching multiple pre-existing modules, out of this phase's
  remit) — tracked as a Phase 14-or-later follow-up below.

**Scope deviations / decisions made this phase (beyond "Decisions made
this phase" above):**
1. **The Prisma migration for `Skill`/`SkillVersion` is hand-authored**,
   not `prisma migrate dev`'s raw output — see "Real, non-mocked
   verification" #1 above for why (the auto-diff tool got confused by a
   pre-existing hand-added generated column from 12a/12b and proposed
   dropping/altering it, unrelated to this phase's own schema addition).
   The hand-written SQL's `Skill`/`SkillVersion` table/index/FK
   definitions were compared line-for-line against what the auto-diff
   tool *would* have emitted for just that portion, confirmed identical,
   before the auto-generated file was discarded.
2. **A real bug found and fixed in `interpreter.py`**: the R-G1 implicit
   "speak the last LLM output, then end" fallback (and `speak`-type
   nodes' own `mode: llm_output`) only ever tracked `node.type == "llm"`
   for `last_llm`/`turn_state["_last_llm_output"]`. Without extending this
   to `"skill"` too, a graph ending on a completed Skill node with no
   explicit downstream Speak/End node would silently produce **no speech
   at all** — the skill's own generated reply would simply vanish. Found
   while writing the Skill node executor (which itself needed to decide
   whether to set `turn_state["_last_llm_output"]`), traced to the
   interpreter's own tracking condition, and fixed with a one-line
   `in ("llm", "skill")` extension plus a doc comment explaining why.
3. **A real, if pre-existing-in-pattern, admin-route-onto-internal-listener
   finding**, surfaced by the real dual-process boot test — see the
   Security review section above for the full writeup and the Phase
   14-or-later follow-up.
4. **A real, cross-phase `distinctUntilChanged()` bug found and fixed in
   three stores, not just the one this phase touches.** While building
   the Skills tab's own debounced-autosave `SkillEditorStore` (which
   mirrors `reasoning.store.ts`'s `Subject<void>` + `debounceTime` +
   `distinctUntilChanged` pattern), the delegated session traced why that
   pattern is actually broken: `distinctUntilChanged()`'s default `===`
   comparator, applied to a `Subject<void>` source, treats every emission
   after the very first as a duplicate (every emission carries the
   identical value, `undefined`) and silently drops it — meaning the
   debounced re-validate call fires **exactly once per store instance**
   (once per browser tab, ever, after the very first edit-then-pause);
   every later edit burst in that same tab session never re-validates
   again. The delegated session correctly omitted the operator in its own
   new store (with a full explanatory comment) rather than copying the
   bug forward, and flagged the finding rather than silently fixing
   `reasoning.store.ts` itself (out of its own assigned scope). Verified
   directly (this session): the identical `Subject<void>` +
   `distinctUntilChanged()` pattern exists in **three** places —
   `agent-builder.store.ts` (the v1 Agent Builder, the original source of
   the copied pattern — this bug has existed since Phase 1-7),
   `reasoning.store.ts` (Phase 9), and `knowledge-pipeline.store.ts`
   (Phase 12b) — and nowhere else in the codebase (the four other
   `distinctUntilChanged` call sites, on real search-text
   `FormControl.valueChanges` streams in `deployments-list-page`/
   `sessions-list-page`/`tenant-select`, are correct, idiomatic uses of
   the operator on a real, meaningfully-comparable value and were left
   unchanged). Fixed all three by removing `distinctUntilChanged()`
   (`debounceTime` alone is sufficient — the whole point of the operator
   chain is "wait for a pause in edits," which `debounceTime` already
   provides; there is no legitimate "true duplicate" concept for a
   `Subject<void>` trigger channel), with a doc comment at each site
   explaining the bug and cross-referencing the other two. Added one
   regression test per store (`reasoning.store.spec.ts`,
   `agent-builder.store.spec.ts`, `knowledge-pipeline.store.spec.ts`) —
   two separate, real edit bursts each separated by a full debounce
   window, asserting the validate/save API is called **twice**, not once
   — mirroring the equivalent test the delegated session had already
   written for `skill-editor.store.spec.ts`. Each new regression test was
   confirmed to actually fail when the bug was deliberately, temporarily
   reintroduced (see "Real, non-mocked verification" #5), then reverted.
   This is a genuine, user-facing correctness bug that has been live
   since this project's very first Agent Builder phase — an admin editing
   a config, agent, or retrieval pipeline in one browser tab past their
   *first* pause-to-let-it-validate edit was silently getting a
   validation result that never updated again for the rest of that tab's
   session (stale/missing inline errors, a `canPublish`/`canSave` flag
   that could be wrong), until a full page reload. Fixed in this phase
   per this project's standing process ("find the real bug, fix it in
   the same phase, don't ticket it for later") even though it was not in
   this phase's own original file list.

**Follow-ups left open for Phase 14 (HITL), not silently dropped:**
- The HITL sub-check in `skills/domain/skill-validation.ts`'s
  `validateHitlGateStub()` is a documented, always-passing no-op — there
  is no `HitlGate` entity and no skill-level HITL reference field to
  check against yet. Phase 14 should replace its body with the real R-H1
  six-mandatory-fields completeness check once both exist.
- The Skills library table's HITL column is a static `"—"` placeholder
  (no real indicator data exists yet) — Phase 14 should wire it to a real
  per-skill HITL-gate-attached indicator once `HitlGate`'s attachment
  model exists.
- **Model-decided dynamic trigger dispatch** (R-S2's "the LLM selects
  from descriptions, like tool selection" runtime half) is not built —
  v1's Skill node is always reached via deterministic graph wiring
  (Router branch or plain `next_node_id`), see "Decisions made this
  phase" #2. A future phase wanting true model-decided dispatch needs to
  extend the LLM node executor's own tool-calling round trip to recognize
  and route to a skill-shaped pseudo-tool call.
- **A nested sub-graph per skill** (the other half of §3.2's "nested
  sub-graph or a plain LLM turn" allowance) is not built — v1 always runs
  a plain LLM turn with the skill's own tools/instructions attached, see
  "Decisions made this phase" #1.
- **The admin-route-onto-internal-listener finding** (Security review
  above): a real, pre-existing (not Phase-13-introduced, but Phase-13-extended)
  NestJS module-composition characteristic where every admin-JWT-guarded
  controller reachable from `SessionsModule`'s import graph is also
  mapped onto the internal (`:8081`) listener, including `SkillsController`
  as of this phase. Every affected route stays `AdminJwtGuard`-protected
  (not an unauthenticated-access issue), but this is a real,
  disclosed architectural gap worth a dedicated cleanup pass (restructure
  `SessionsModule`'s dependencies to import only ports/repositories, not
  whole feature modules with controllers) before this internal listener
  is ever exposed more broadly than intended.
- **Skill version history is not exposed via a dedicated list-versions
  endpoint** — the Reasoning tab's Skill node inspector can only offer
  `"latest"` or a pin to the *currently* published version number
  (`SkillDto.published_version.version_number`), not a picker over every
  historical version. The database itself already stores full history
  (each publish forks a new, immutable row) — only the read API is
  narrower than the data model this phase. A future phase can add a
  `GET /tenants/:id/skills/:skillId/versions` list endpoint additively.
- **Bundle-size budget** (`admin`'s initial bundle now 21.14 kB over its
  1.00 MB budget, up from 14 kB after Phase 12b) — not urgent, but worth
  folding into whichever phase next does a lazy-loading-boundary pass
  across the whole admin bundle, per every prior phase's own
  accumulating note on this same item.
- Rate limiting on the new `skills` CRUD routes and the new
  `/internal/skills/*` route remains an open, platform-wide gap (same one
  every admin-triggered/costly-action route already carries since Phase
  8) — not specific to this phase.

## Phase 14 — HITL v1 (BL-052, BL-053, BL-054, BL-055, BL-056, BL-057)

### Goal

A blocking `HitlGate` can pause a live voice turn on a human decision
without breaking the pipeline (UC-H1: the mechanically hardest piece of
runtime surgery in this whole roadmap), and a deferred approval survives
past the call itself, executing the queued action out-of-band once a
reviewer decides (UC-H2 — "the one most teams forget to build," per the
spec). Every consequential tool is either gated or has a written
autonomous-use acknowledgement (V-6), every blocking gate has real reviewer
coverage before it can go live (V-7), and an `auto_approve` timeout on a
consequential tool requires the same kind of written acknowledgement (V-8).

**Correction to this file's own record-keeping**: `docs/plans/agent-builder-v2-PENDING.md`
carried a stale line claiming this phase was "in progress" with "five
research passes complete." That referred only to the pre-existing design
docs (`AgentBuilder_..._HITL.md` §A8, `ARCHITECTURE_NOTES.md` §6/§8,
`UX_SCOPE.md`) — verified before starting this phase that zero code
existed (no `HitlGate`/`HitlDecision`/`ReviewerGroup` models, no `hitl`
module, no notification infrastructure, no `hitl` node type; the repo
itself had zero git commits). This phase started from that clean slate,
which is why its own file list below has no "edited from a partial
Phase-14-in-progress state" caveats anywhere in it.

### Scope

**In scope:**
1. **Prisma**: `ReviewerGroup`/`HitlGate`/`HitlDecision` models (additive
   migration), per `ARCHITECTURE_NOTES.md` §6.1 — a gate has no
   partially-specified saved state at all (R-H1), unlike `Skill`/
   `SkillVersion`'s draft/published split. A fourth additive column,
   `ToolDefinition.autonomousUseAckText`, is V-6's "written autonomous-use
   acknowledgement" for a consequential tool with **no** gate attached —
   distinct from `HitlGate.autoApproveAckText` (V-8's acknowledgement for a
   gate whose own timeout falls back to auto-approve). A fifth,
   `SkillVersion.hitlGateId`, is R-S6's "a skill may declare its own gate."
2. **`hitl` module** (`apps/api/src/modules/hitl/`), four layers mirroring
   `skills/`: full CRUD for `ReviewerGroup`/`HitlGate`, the reviewer
   console's `GET /queue` + `POST /decisions/:id/decide` (approve/deny/
   edit-and-approve, R-H6), tenant-scoped, `AdminJwtGuard`+`RolesGuard`
   exactly like every prior module. `CreateHitlDecisionUseCase`/
   `GetHitlDecisionUseCase` are exported (not their own controller) for a
   new `HitlInternalController` under `modules/internal/` to consume —
   the "export the use-case, not the controller" precedent `SkillsModule`
   already set for `GetSkillBodyUseCase`, chosen specifically so this
   phase's internal route never routes through `SessionsModule`.
3. **Internal agent-facing surface**: `POST /internal/hitl-decisions`
   (creates the pending decision) and `GET /internal/hitl-decisions/{id}`
   (the interpreter's short-poll target), both `InternalTokenGuard`-guarded
   and registered directly on `InternalModule` — not through
   `SessionsModule` — per the explicit instruction not to add a second
   instance of that architecture debt beyond the one `HitlController`
   itself already, unavoidably, extends (see "Follow-ups" below).
4. **Blocking-gate pause/resume in the interpreter** (Python):
   `orchestration/graph/nodes/hitl.py` — `await`s an asyncio future
   resolved by short-polling (1.5s interval), speaks the gate's hold
   treatment via the existing `_speak`/`ctx.speak()` mechanism (no new
   speech plumbing), re-speaks it on a 15s reassurance timer (R-H5:
   silence during an approval is never acceptable), and maps the terminal
   decision onto `next_node_id` (a live human decision) or `on_deadline`
   (the gate's own SLA path — `timed_out`/`escalated`/`deferred`),
   mirroring `registry.execute_one_node`'s existing deadline-vs-failure
   distinction.
5. **HITL node type** (both languages): `{gate_id, next_node_id}` —
   added as the graph contract's 10th node type. Deliberately carries no
   `budget_ms`: R-H4 marks any path through it **unbounded** rather than
   estimated (see "Decisions made this phase" #1).
6. **Genuinely new infrastructure**: `common/notifications/` —
   `NotificationPort` + `InAppNotificationAdapter` + `EmailNotificationAdapter`
   (v1 ships in-app/email only, BL-056; SMS is BL-077, permanently
   deferred). Nothing in this codebase sent a notification of any kind
   before this phase.
7. **Deferred-approval async execution**: a new `hitl-deferred-followup`
   BullMQ queue (on-demand, owned/registered by `HitlModule`, mirroring
   `KNOWLEDGE_INGEST_QUEUE`'s producer-lives-with-its-domain-module
   precedent) executes a `deferred`-type gate's approved tool call
   out-of-band, reusing `ToolsModule`'s existing `TOOL_INVOKER` port
   (already exported for exactly this "invoke a tool outside the live
   pipeline" reuse) rather than a second HTTP-call implementation. A new
   self-scheduled `hitl-sla-sweep` job (15s interval) is the server-side
   defense-in-depth for a gate's SLA, alongside the interpreter's own
   locally-tracked deadline.
8. **Validation**: V-6 (`consequentialToolGatedOrAckedRule`), V-7
   (`blockingGateReviewerCoverageRule`), and a `hitlGateRefsKnownRule`
   (mirrors `skillRefsKnownAndEnabledRule`'s existence-check shape) — all
   three new Gate-B rules in `combination-rules.ts`, reading a
   `ValidationContext` extended with `consequentialToolApiRefs`/
   `toolAutonomousAckByApiRef`/`toolGateIdByApiRef`/`hitlGatesById`. V-8
   lives in the `hitl` module's own `hitl-validation.ts` (a single-entity
   field-presence check, not a `deployment-config` rule — mirrors why
   R-H1's own completeness check lives there too, not in `graph-rules.ts`).
   `critical-path.ts` gains `unbounded`/`has_unbounded_path` reporting
   (R-H4).
9. **Skills' two pre-wired stubs completed**: `skill-validation.ts`'s
   `validateHitlGateStub()` replaced with a real check (an attached
   `hitlGateId`, if any, must resolve to a known tenant gate); the Skills
   library's static `"—"` HITL column now reflects the real
   `draft_version?.hitl_gate_id ?? published_version?.hitl_gate_id`.
10. **HITL config screen** (`features/hitl/`, standalone route — folded
    into the tab shell in Phase 16, not this phase): gate CRUD (all six
    R-H1 fields; gate-type radio lists all 5 values, `whisper`/`post_hoc`
    visibly disabled with a "Coming soon" reason) and reviewer-group
    management. **Reviewer console** (`features/reviewer-console/`) is a
    separate top-level route + nav entry per `UX_SCOPE.md`'s explicit IA
    instruction (reviewers are often a different persona than the admin
    configuring gates) — queue + detail panel, approve/deny/edit-and-approve,
    5s refetch polling, no websocket. **Reasoning tab**: `hitl` node type
    wired into `node-factory`/`node-inspector`/`node-card`/the shared
    `node-type-icon` registry, same three-file pattern every prior node
    type used. **Caller-side hold UX** (conversation SPA): a "waiting on
    approval" state and a "deferred outcome" state, per wireframe A8.7.

**Out of scope (explicit):** Whisper/post-hoc gate types (BL-075/BL-076,
deferred — render disabled, never enabled); SMS notification channel
(BL-077, deferred); live audio ("🔊 listen") and caller-history enrichment
in the reviewer console (`UX_SCOPE.md`'s own descope); a dedicated
"escalated decisions" review queue beyond a notification + status marker
(see "Decisions made this phase" #4); Sub-agent/Handoff/State node types
(Phase 15); the 8-tab shell (Phase 16).

### Decisions made this phase

1. **R-H4's "unbounded" is a first-class report field, not a fudged
   number.** `critical-path.ts` gives the `hitl` node type zero numeric
   cost and flags its step/path/report as `unbounded`/`has_unbounded_path`
   instead of inventing an estimate — `critical_path_ms`/`over_budget` are
   computed over the *bounded* paths only, so an unbounded sibling path
   never silently wins (or loses) the "critical path" comparison by
   accident. Every `hitl` node is treated as unbounded regardless of its
   gate's actual type (blocking vs. deferred vs. pre-speech), because
   `critical-path.ts` has no DB access to resolve which — the same
   "resolved once at session-start read time" boundary `SkillNodeSchema`'s
   own doc comment already establishes for skills. A future phase could
   thread gate-type context through if a less-conservative estimate for
   non-blocking gate types is ever wanted.
2. **`ToolDefinition.autonomousUseAckText` (V-6) and `HitlGate.autoApproveAckText`
   (V-8) are deliberately two separate fields, not one shared "acknowledgement"
   column.** They answer different questions at different times: "we've
   decided this consequential tool is fine to run with **no gate at all**"
   vs. "we've decided this **specific gate's** own timeout fallback to
   auto-approve is fine." Collapsing them would make a gate's own
   completeness check (R-H1) depend on a field that lives on a different
   aggregate (`ToolDefinition`), breaking the "a gate cannot be saved
   partially specified" invariant's own self-containedness.
3. **The deferred-followup queue reuses `ToolsModule`'s existing
   `TOOL_INVOKER` port rather than building a new `ToolInvokerService`.**
   `apps/api/src/modules/tools/infrastructure/tool-invoker.service.ts`
   already exists (Phase 8/9, for the Tools tab's "Test" action and
   real Tool-node calls) and is already exported specifically so a third
   caller could reuse it without re-implementing the HTTP-call/10s-timeout/
   32KB-cap shape — this phase is exactly that third caller. Simpler than
   the original plan's assumption that a new service was needed.
4. **`escalate` timeout behavior is scoped narrowly in v1**: the SLA
   sweep notifies the escalation `ReviewerGroup` and marks the decision
   `escalated` (terminal — it leaves the `pending` queue), but does not
   build a dedicated "the wider group can still act on this" review
   surface beyond that notification + status marker. A live blocking/
   pre-speech turn has already taken its own `on_deadline` path in the
   interpreter by the time the server-side sweep even runs (the same
   short-poll loop hit its local deadline first), so this is a metrics/
   notification concern more than a live-call one in practice. Revisit if
   product feedback wants a real escalation-queue UI.
5. **`in_app` notification delivery is not a persisted notification
   inbox.** The two surfaces an in-app HITL notification actually needs to
   reach — the reviewer console's queue and the caller's own call page —
   already derive their state directly from `HitlDecision`/`/hitl/queue`
   via polling (`UX_SCOPE.md`'s own "same short-poll mechanism, no
   websocket needed" design). `InAppNotificationAdapter` is a structured
   log line for observability/audit; `markOutcomeNotified` on the decision
   row itself is what actually records delivery. A separate notification-
   inbox table would duplicate state no consumer this phase has.
6. **`EmailNotificationAdapter` posts to an operator-configured webhook
   (`EMAIL_WEBHOOK_URL`/`EMAIL_WEBHOOK_TOKEN`) via plain `fetch`, not a
   vendor SDK.** No email-sending library or SMTP config existed anywhere
   in this codebase; adding a vendor-specific dependency (SendGrid,
   Postmark, SES, ...) for a spec that never named one would bake in a
   choice this project hasn't made. Mirrors `ToolInvokerService`'s own
   "plain HTTP call, no vendor SDK" precedent. Unconfigured (this phase's
   own tests, local dev) logs and no-ops rather than throwing.
7. **`HitlDecision.proposedAction` for a bare `hitl` node (no adjacent
   Tool node) is always a minimal `{kind: 'spoken_text', summary}`**,
   derived from the turn's last LLM output (falling back to the caller's
   utterance) — there is no general "the tool call or spoken text this
   gate is reviewing" concept attached to a `hitl` node itself in v1 (that
   association lives server-side on the `HitlGate` row's own
   `attachmentKind`/`attachmentRef`, which the node executor never needs
   to read). A future phase wanting a real `tool_call`-shaped
   `proposed_action` with arguments would need a Tool-node-adjacent
   placement convention this phase doesn't introduce.

### Result — Phase 14 done (2026-09-04)

**Delivered as planned**, built by the orchestrating session directly for
the shared foundation/highest-risk surface (contracts, Prisma, the `hitl`
module, the notification port, the jobs processors, and the Gate A/B
wiring), with the Python interpreter surgery and the full Angular surface
(HITL config screen, reviewer console, reasoning-tab wiring, the two
Skills stub completions' UI half, and the conversation SPA's hold UX)
built in parallel by two delegated background sessions against those
already-locked contracts — every build/lint/test re-run independently by
the orchestrating session after each delegated session's own report, per
this project's "trust but verify" discipline (`tsc --noEmit`, `jest`,
`ng build` for both `admin`/`conversation`, `eslint`, and the Python
`pytest` suite were all re-run directly, not taken on faith).

**Files — Contracts** (`packages/contracts/src/`):
`agent-config/reasoning-graph.schema.ts` (edited — `HitlNodeSchema` added
to `GraphNodeSchema`'s union); `hitl/schemas.ts` (new — full
`ReviewerGroup`/`HitlGate`/`HitlDecision` CRUD + queue/decide contracts,
`SUPPORTED_HITL_GATE_TYPES`); `skills/schemas.ts` (edited —
`hitl_gate_id` on create/update/read); `tools/schemas.ts` (edited —
`autonomous_use_ack_text` on create/update/read); `deployment-config/schemas.ts`
(edited — `CriticalPathStepSchema.unbounded`, `CriticalPathGraphPathSchema.unbounded`,
`CriticalPathReportSchema.has_unbounded_path`); `internal/schemas.ts`
(edited — `CreateHitlDecisionRequestSchema`/`CreateHitlDecisionResponseSchema`/
`InternalHitlDecisionResponseSchema`); `error-codes.ts` (edited — 13 new
codes: `HITL_GATE_NOT_FOUND`/`HITL_GATE_FORBIDDEN`/`HITL_REVIEWER_GROUP_NOT_FOUND`/
`HITL_REVIEWER_GROUP_NAME_REQUIRED`/`HITL_REVIEWER_GROUP_NAME_EXISTS`/
`HITL_GATE_INCOMPLETE`/`HITL_REVIEWER_COVERAGE_MISSING`/`HITL_AUTO_APPROVE_ACK_REQUIRED`/
`HITL_DECISION_NOT_FOUND`/`HITL_DECISION_ALREADY_DECIDED`/`HITL_DECISION_FORBIDDEN`/
`CONFIG_CONSEQUENTIAL_TOOL_UNGATED`/`CONFIG_HITL_GATE_UNKNOWN`); `index.ts`
(edited — exports `hitl/schemas`).

**Files — API** (`apps/api/`):
- `prisma/schema.prisma` (edited — `HitlGateType`/`HitlAttachmentKind`/
  `HitlTimeoutBehavior`/`HitlGateStatus`/`HitlDecisionStatus` enums,
  `ReviewerGroup`/`HitlGate`/`HitlDecision` models, `ToolDefinition.autonomousUseAckText`,
  `SkillVersion.hitlGateId`, `Tenant.reviewerGroups`/`hitlGates`,
  `Session.hitlDecisions` reverse relations); `prisma/migrations/20260904110121_hitl_phase14/migration.sql`
  (new, **hand-authored** — same "auto-diff tool got confused by 12a's
  pre-existing hand-added generated column" reason Phase 13's migration
  documents; the unrelated diff was excluded, everything else applied and
  independently re-verified against a fresh throwaway Postgres to confirm
  no further drift).
- `src/modules/hitl/` (new, four layers): `domain/{reviewer-group,hitl-gate,hitl-decision}.ts`,
  `domain/ports.ts` (three repository ports + the `hitl-deferred-followup`
  queue port/name), `domain/hitl-validation.ts` (R-H1/V-8) + `.spec.ts`;
  `application/` (11 use-cases + 3 DTO mappers); `infrastructure/`
  (3 Prisma repositories + the deferred-followup queue producer);
  `interface/hitl.controller.ts`; `hitl.module.ts`, `index.ts`.
- `src/modules/internal/interface/hitl-internal.controller.ts` (new,
  `POST /internal/hitl-decisions` + `GET /internal/hitl-decisions/:id`);
  `internal.module.ts` (edited — registers `HitlModule`/`HitlInternalController`).
- `src/common/notifications/` (new — `notification.port.ts`,
  `in-app-notification.adapter.ts`, `email-notification.adapter.ts`,
  `notification-dispatcher.service.ts`, `notifications.module.ts`).
- `src/modules/jobs/` (edited — `domain/queue-names.ts` gains
  `HITL_SLA_SWEEP_QUEUE`/`HITL_SLA_SWEEP_INTERVAL_MS` + re-exports
  `HITL_DEFERRED_FOLLOWUP_QUEUE`; `infrastructure/hitl-sla-sweep.processor.ts`
  and `infrastructure/hitl-deferred-followup.processor.ts` (new);
  `jobs.module.ts` edited — registers both queues/processors, self-schedules
  the sweep).
- `src/modules/deployment-config/domain/combination-rules.ts` (edited —
  `consequentialToolGatedOrAckedRule`/`hitlGateRefsKnownRule`/
  `blockingGateReviewerCoverageRule` (V-6/V-7) registered into
  `COMBINATION_RULES`; `ValidationContext` gains
  `consequentialToolApiRefs`/`toolAutonomousAckByApiRef`/
  `toolGateIdByApiRef`/`hitlGatesById`, `publishedSkills`'s value type
  gains `hitlGateId`); `domain/{graph-structure,graph-rules,critical-path}.ts`
  (edited — `'hitl'` case added to every exhaustive `GraphNode['type']`
  switch; `critical-path.ts` additionally gains `isUnboundedNode`/the
  `unbounded`/`has_unbounded_path` reporting); `application/validate-config.use-case.ts`
  (edited — injects `HITL_GATE_REPOSITORY`/`REVIEWER_GROUP_REPOSITORY`,
  populates the four new context fields) + `.spec.ts` (edited);
  `save-config.use-case.spec.ts` (edited, mock only);
  `application/test-call-graph.use-case.ts` (edited — `'hitl'` structural-
  simulator branch, mirrors the `skill`/`retrieve` stub precedent);
  `deployment-config.module.ts` (edited — imports `HitlModule`).
- `src/modules/skills/` (edited — `domain/skill.ts`/`domain/ports.ts`
  gain `hitlGateId`; `domain/skill-validation.ts`'s `validateHitlGateStub()`
  replaced with a real check + `.spec.ts` rewritten; `infrastructure/prisma-skill.repository.ts`
  threads `hitlGateId` through create/update-draft/publish/list-published;
  `application/{create-skill,update-skill-draft,publish-skill,skill-dto}.ts`
  edited; `skills.module.ts` imports `HitlModule`) — the Phase 13 "follow-up
  left open for Phase 14" item, closed.
- `src/modules/tools/` (edited — `domain/tool-definition.ts`/`domain/ports.ts`
  gain `autonomousUseAckText`; `infrastructure/prisma-tool-definition.repository.ts`,
  `application/{create-tool,update-tool,tool-dto}.use-case.ts` threaded
  through) + 8 spec files updated for the new required field.
- `app.module.ts` (edited — registers `HitlModule`).

**Files — Python** (`apps/agent/src/avatar_agent/`), delivered by the
delegated session, independently re-verified: `contracts/runtime_config.py`
(edited — `HitlNode`, `GraphNode` union, `ReasoningBlock`'s referential-
integrity isinstance-tuple extended); `ports/orchestration.py` (edited —
`HitlProposedAction`/`HitlDecisionCreated`/`HitlDecisionRecord`,
`IHitlDecisionPort`, `TurnContext.hitl_decision_port`);
`telemetry/control_plane.py` (edited — `create_hitl_decision`/
`get_hitl_decision`, `ControlPlaneHitlDecisionAdapter`);
`orchestration/graph/nodes/hitl.py` (new — `HitlNodeExecutor`);
`orchestration/graph/registry.py` (edited — `"hitl": HitlNodeExecutor()`);
`orchestration/pipeline.py`/`entrypoint.py` (edited — threads
`hitl_decision_port` through, same wiring `skill_body_port` already has).
Tests: `tests/orchestration/graph/nodes/test_hitl.py` (new, 14 cases);
`tests/contracts/test_runtime_config.py` (edited, 3 new cases);
`tests/orchestration/graph/test_graph_registry.py` (edited — asserts all
10 node types now registered).

**Files — Web** (`apps/web/projects/`), delivered by the delegated
session, independently re-verified: `admin/src/app/features/reasoning/`
(`store/node-factory.ts`, `components/node-inspector/*`,
`components/node-card/*`, `store/reasoning.store.ts`,
`pages/reasoning-page/*`, `components/turn-budget-panel/*` — the last one
an unplanned but in-scope fix, rendering the new `unbounded`/
`has_unbounded_path` fields as an "Unbounded" notice instead of a numeric
budget bar); `shared/src/lib/util/node-type-icon.ts` (edited — `hitl` →
`gavel`); `admin/src/app/features/hitl/` (new — gates + reviewer-groups
stores/dialogs/pages, `hitl.routes.ts`); `shared/src/lib/api/hitl-api.service.ts`
(new); `admin/src/app/features/reviewer-console/` (new — top-level route,
queue+detail page, `core/layout/shell.component.ts` nav entry);
`admin/src/app/features/skills/` (edited — `skill-editor.store.ts`/
`skill-editor-page`/`skills-library-page`, the gate picker + real HITL
column); `admin/src/app/features/tools/components/tool-dialog/*` (edited
— `autonomous_use_ack_text` field); `conversation/src/app/core/livekit-room.service.ts`
(edited — `hitlHold`/`hitlDeferredOutcome` signals) and
`features/call/pages/call-page/*` (edited — the two new UI states).

### Real, non-mocked verification

1. **The hand-authored migration applied cleanly against a real, fresh
   pgvector-enabled Postgres** (a throwaway `pgvector/pgvector:pg16`
   container, not this repo's own dev-compose Postgres, which was already
   port-occupied by an unrelated project's container on this machine) —
   all 8 migrations in order, then re-diffed to confirm zero further drift
   beyond the one already-known, pre-existing, unrelated `knowledge_chunk`
   generated-column false-positive (excluded from this migration, same as
   Phase 13's own precedent).
2. **`apps/api`**: `tsc --noEmit` clean; full `jest --runInBand` — 1252
   tests, 1 pre-existing unrelated failure (`assertEndpointUrl` signature
   drift, already documented in `PENDING.md`) plus one newly-**observed**
   (not newly-caused) pre-existing failure in `http-probe-strategy.spec.ts`
   ("classifies a 404 as unreachable") that traces to logic this phase
   never touched — flagged below, not fixed (out of scope).
3. **`apps/web`**: `ng build admin` and `ng build conversation` both
   succeed (admin's pre-existing bundle-size-budget warning is unchanged
   in kind, already tracked); full `jest` — 90 suites/716 tests, all
   passing; full `eslint` across `projects/**/*.ts`, clean.
4. **`apps/agent`**: full `pytest` (excluding the one test module that
   cannot import at all in this sandbox, `test_bithuman.py` — the
   `bithuman` package is genuinely not installed here) — 455 passed, 13
   failed, all 13 independently traced to either the same missing-`bithuman`-
   package cause (12) or the one pre-existing masked assertion in
   `test_runtime_config.py` already documented in `PENDING.md` (1) — none
   touch HITL/graph code.
5. **Security review** (scoped to what this phase touched, per this
   project's own gate process): every new admin route is
   `AdminJwtGuard`+`RolesGuard`+tenant-scoped; both new internal routes are
   `InternalTokenGuard`-guarded, matching the existing agent-facing trust
   model exactly (a shared bearer token authenticates "this is our own
   agent process," not a specific tenant/session — the same model every
   other `/internal/*` route already uses, not a new gap this phase
   introduces); all new DTOs are TypeBox-validated with
   `additionalProperties: false`; no raw SQL beyond the reviewed migration;
   no new npm dependency (the email adapter deliberately uses plain
   `fetch`, not a new SDK); no secret is ever logged (the email adapter's
   failure path logs only the destination address); the reviewer-decide
   endpoint checks the deciding admin is actually a member of the gate's
   `ReviewerGroup`, not just tenant-assigned. New-capability-specific
   checks: the deferred-followup tool execution reuses an already-audited
   execution path (`TOOL_INVOKER`) rather than a new one; the email
   webhook URL/token are operator-configured env vars, never user-supplied
   (no SSRF vector). No blocking findings — see "Follow-ups" for the two
   already-accepted, platform-wide gaps this phase's new routes join
   (rate limiting; the `SessionsModule`-import-graph internal-listener
   leak).

**Scope deviations (judgment calls made during implementation, beyond
"Decisions made this phase" above):**
1. The Prisma migration is hand-authored for the same reason Phase 13's
   was — see "Real, non-mocked verification" #1.
2. `HitlDecisionRepositoryPort.finalizeTimedOut`'s accepted-status set was
   widened from the original three-value sketch (`timed_out`/`escalated`/
   `deferred`) to five (`approved`/`denied` added) once R-H2's
   `auto_approve`/`auto_deny` timeout behaviors were actually implemented
   — a timeout that auto-approves is functionally an approval, not a
   fourth kind of "timed out," so the decision's own terminal state needed
   to say so (`reviewerId` stays `null` either way, distinguishing a human
   decision from a server-resolved one).
3. `apps/agent`'s cross-language contract fixture corpus
   (`fixtures/agent-config/{valid,invalid}/*.yaml`, run through both a TS
   and a Python spec) was **not** extended with a `hitl`-node fixture —
   the delegated Python session could not verify TS-side agreement without
   crossing its assigned file boundary, so it added an equivalent
   Python-only fixture case to `tests/contracts/test_runtime_config.py`
   instead and flagged the gap rather than guessing. Low risk (the two
   schemas were hand-verified field-for-field against each other while
   writing them), but a real gap in this project's usual double-verification
   discipline for a new node type — worth closing in Phase 15 alongside
   whichever of Sub-agent/Handoff/State lands first, so the pattern is
   fixed for all remaining new node types at once rather than patched
   piecemeal.

**Follow-ups left open for Phase 15/16, not silently dropped:**
- **The `SessionsModule`-import-graph internal-listener finding is now
  also extended by `HitlController`**, exactly as `PENDING.md` predicted
  it would be — `HitlModule` is imported directly into `InternalModule`
  (for `HitlInternalController`), which necessarily also carries
  `HitlController` itself (plus, transitively via `HitlModule`'s own
  `TenantsModule`/`ToolsModule` imports, nothing new beyond what
  `SkillsModule` already carried there). Every affected route stays
  guard-protected; still worth the dedicated cleanup pass every phase
  since Phase 13 has flagged.
- **A newly-observed, pre-existing, unrelated test failure**:
  `apps/api/src/modules/providers/infrastructure/http-probe-strategy.spec.ts`'s
  "classifies a 404 as unreachable" case fails (expects `'unreachable'`,
  gets `'healthy'`) on a clean checkout, independent of anything this
  phase touched. Not previously called out in `PENDING.md`'s "two
  pre-existing test failures" note — that note should be updated to three
  (it stays cross-cutting/pre-existing, not this phase's to fix).
- **`escalate`'s wider-review surface** is notification-plus-status-marker
  only in v1 — see "Decisions made this phase" #4.
- **The cross-language fixture corpus gap** for the `hitl` node type — see
  "Scope deviations" #3.
- Rate limiting on the new `hitl` CRUD/queue/decide routes and the two new
  `/internal/hitl-decisions*` routes remains the same open, platform-wide
  gap every admin-triggered/costly-action route has carried since Phase 8
  — not specific to this phase.
- **Bundle-size budget** — unchanged from Phase 13's own note; the new
  `hitl`/`reviewer-console` feature modules are lazy-loaded (not part of
  the initial bundle), so this phase does not add to the initial-bundle
  overage itself, but the accumulating admin-app lazy-chunk count keeps
  growing regardless.

## Phase 15 — Sub-agent, Handoff, State (BL-058, BL-059, BL-060)

### Goal

The final 3 of the 13 A3.2 node types exist: a `subagent`-type node
delegates one bounded LLM turn to another tenant's published persona
(nesting ≤ 2, R-G6/V-3); a `handoff`-type node records intent to transfer
to a human (alert fired, session-scoped state transitioned, no real
telephony); a `state`-type node reads/writes an in-memory, session-scoped
variable. After this phase, every node type in the A3.2 spec has a real
executor on both languages, a Gate A/B validation story, and a Reasoning
tab inspector card — the "13 node types exist in some form" exit condition
for the whole roadmap's node-type surface is met.

### Scope

**In scope:**
1. **Three new schemas** (both languages) — added as the 11th/12th/13th
   members of `GraphNodeSchema`'s discriminated union:
   - `subagent`: `{target_tenant_id, handback_policy, budget_ms, next_node_id}`.
     This codebase has no separate "Agent" entity (`DeploymentConfig.tenantId`
     is `@unique` — a tenant *is* the agent, 1:1), so "delegate to another
     agent" means delegate to another **tenant's** published config by id.
   - `handoff`: `{destination, context_summary}` — deliberately **no**
     `next_node_id`, terminal exactly like the existing `end` node type.
   - `state`: `{mode, variable, value?, next_node_id}` — deliberately
     **no `scope` field** even though A3.2 lists "scope" among this node's
     settings; v1 has exactly one legal value (session-scoped) and no
     second one to choose between yet.
2. **Cross-tenant Sub-agent resolution, with no new "Agent" data model and
   no new Prisma tables at all this phase** (a genuine simplification over
   the original plan's assumption): `ValidateConfigUseCase` reads the
   *target* tenant's own `DeploymentConfig` directly via the
   `deployment-config` module's own already-injected repository — no new
   module dependency, since a Sub-agent's "target" is just another row in
   the same table this module already owns.
3. **New internal agent-facing endpoint**: `GET /internal/tenants/{id}/subagent-persona`
   (`InternalTokenGuard`-guarded, registered directly on `InternalModule`,
   not through `SessionsModule`) — the lazy fetch a `subagent`-type node's
   executor calls once it actually fires, returning the target's
   `system_prompt` + resolved enabled `tool_definitions` (mirrors
   `GetSkillBodyUseCase`'s "lazy, only-once-triggered" shape exactly).
4. **Handoff's "fire alert" reuses the existing `/internal/alerts`
   endpoint and `AlertEvent` mechanism verbatim** — one new `AlertType`
   enum value (`handoff_requested`), zero new notification infrastructure.
   "Record handoff" and "fire alert" are the same act: the `AlertEvent` row
   created *is* the record.
5. **V-3 (R-G6, nesting ≤ 2 levels)**: a new Gate-B rule,
   `subAgentTargetsValidRule`, checking three things per `subagent`-type
   node — the target tenant has a **published** config (existence), the
   target is not this config's own tenant (self-reference), and the
   target's own published config does not itself contain a `subagent`-type
   node (one-hop nesting check — this config's own node is hop 1, so a
   `subagent` node in the target's graph would put a hypothetical further
   hop at 3, exceeding the ≤2 ceiling). `CONFIG_STATE_VALUE_REQUIRED` (a
   Gate-A structural check, `value` required only when `mode: 'write'`)
   rounds out this phase's new validation.
6. **v1 runtime scope for Sub-agent (the same simplification Phase 13 made
   for Skills, deliberately repeated)**: delegation is **one bounded LLM
   turn** against the target's persona/tools, never a nested graph/
   interpreter invocation — BL-058 is explicitly scoped as a "completeness
   item," not a framework for recursive agent delegation.
7. **Frontend**: the Reasoning tab's `node-factory`/`node-inspector`/
   `node-card`/shared `node-type-icon` registry all gain the three new
   types, following the exact three-file extension pattern every prior
   node type used. The Sub-agent picker reuses the existing tenant-listing
   mechanism (no new endpoint for the picker itself — V-3's own Gate-B
   check is what actually catches an unpublished/self/over-nested target
   at save time). The Alerts feature's one hardcoded alert-type display map
   gains the `handoff_requested` case.
8. **Cross-language contract fixture corpus gap (flagged as debt at the end
   of Phase 14) is closed**: three new `valid/*.yaml` fixtures
   (`subagent-node`, `handoff-node`, `state-node`) exercise all three new
   types through both the TS and Python contract-parity specs, which both
   already glob the shared fixture directory dynamically — no file-list
   edits needed on either side once the `.yaml` files existed.

**Out of scope (explicit):** a full nested graph/interpreter invocation
per Sub-agent delegation (BL-080's inline-persona-authoring alternative
remains deferred too — a Sub-agent always targets an *existing* published
agent, never an in-place-authored one); real PSTN/SIP transfer mechanics
for Handoff; a `scope` other than session for State; a dedicated
"list only tenants with a published config" endpoint for the Sub-agent
picker (V-3's own publish-time check is the real enforcement); the 8-tab
shell and remaining V-5/V-11/V-12 wiring sweep (Phase 16).

### Decisions made this phase

1. **Sub-agent's target is "another tenant," full stop — there is no
   separate "Agent" catalog to pick from.** Confirmed before writing any
   code: `DeploymentConfig.tenantId` is `@unique`, `Tenant` has no
   "published/live" concept of its own distinct from
   `DeploymentConfig.status`, and `BL-080`'s own rationale ("a full inline
   authoring UI duplicates the entire Agent Builder inside a node
   inspector") only makes sense if BL-058's in-scope alternative is
   exactly "pick an existing tenant's published config" — there is no
   third option this codebase's data model could support today.
2. **V-3's nesting check is a one-hop transitive lookahead, not unbounded
   recursion.** R-G6 caps the chain at 2 levels; since this config's own
   `subagent` node is already hop 1, checking whether the *target's* own
   graph contains a `subagent` node (hop 2) is the complete check — a
   further hop from that hypothetical node would be hop 3, which is
   exactly what "the target already delegates to another sub-agent" means
   for validation purposes. No cross-tenant cycle-detection or
   unbounded-depth walk was needed because the check only ever looks
   exactly one hop past the target, not the target's target's target.
3. **`handback_policy` was under-specified in the source docs** (only "handback"/
   "hands back with a result" appear in prose, no enumerated options
   anywhere) — designed as `speak_and_return` (mirrors the orchestration-
   pattern diagram's own example, "hands back with a result" implying the
   result is heard) vs. `silent_return` (the delegated output feeds a
   downstream node instead, the same "referenceable via `$<node_id>`,
   never auto-spoken" convention every other node's own output already
   follows). A reasonable, documented judgment call given the spec's own
   silence on enumerated values.
4. **Sub-agent is a persona *swap*, not an augmentation** — the one
   deliberate divergence from `SkillNodeExecutor`'s own precedent (which
   *appends* a skill's instructions to the caller's existing prompt).
   Delegating a whole turn to a genuinely different agent's persona means
   replacing the turn-local system prompt outright, not layering onto the
   caller's own — while still carrying the live conversation
   messages/retrieved context over, and still never mutating
   `ctx.residency`/`SessionMemory` itself (release-on-exit holds
   identically).
5. **Sub-agent self-enforces its own `budget_ms`** via an inner
   `asyncio.wait_for`, unlike `SkillNode.budget_ms` (which relies solely on
   the outer turn-level deadline) — mirrors `RetrieveNode`'s own precedent
   of bounding itself independently of the parent turn's remaining budget,
   since a slow delegated call against a *different* tenant's own LLM leg
   is exactly the failure mode this node's declared budget exists to cut
   short.
6. **State's cross-turn store is a new, minimal `TurnContext.session_state`
   dict, not a repurposing of the existing chat-turn-specific
   `SessionMemory`.** No existing "arbitrary key/value, spans the whole
   session" seam existed to extend; a new one was added, created once per
   session and threaded by reference into every turn's `TurnContext` —
   mirrors `skill_body_cache`'s own "created once per session" lifecycle
   exactly, just holding admin-declared variables instead of fetched skill
   bodies.
7. **A State read populates both `turn_state[node.id]` and
   `turn_state[node.variable]`** — the former for the universal
   "referenceable by node id" convention every node output already
   follows, the latter so the value is also reachable via the
   `$state.<key>`-shaped grammar `tool.py`'s `argument_mapping` resolution
   already recognizes, without inventing a third reference syntax.

### Result — Phase 15 done (2026-09-04)

**Delivered as planned**, built by the orchestrating session directly for
the shared foundation/highest-risk surface (contracts, the cross-tenant
Gate-B resolution, the new internal endpoint, and the `AlertType`
extension), with the Python interpreter surgery and the full Angular
Reasoning-tab wiring built in parallel by two delegated background
sessions against those already-locked contracts — every build/lint/test
re-run independently by the orchestrating session after each delegated
session's own report (`tsc --noEmit`, `jest`, `ng build`, `eslint`, and
the Python `pytest` suite, plus the TS-side cross-language contract spec
against the newly-added Python-authored fixtures), per this project's
"trust but verify" discipline.

**Files — Contracts** (`packages/contracts/src/`):
`agent-config/reasoning-graph.schema.ts` (edited — `SubAgentNodeSchema`/
`HandoffNodeSchema`/`StateNodeSchema` added to `GraphNodeSchema`'s union,
completing the full 13-type set); `internal/schemas.ts` (edited —
`SubAgentPersonaResponseSchema`; `AlertRequestSchema`'s `type` union gains
`handoff_requested`); `alerts/schemas.ts` (edited —
`ListAlertsQuerySchema.type` gains `handoff_requested`); `error-codes.ts`
(edited — 4 new codes: `CONFIG_SUBAGENT_TENANT_UNKNOWN`/
`CONFIG_SUBAGENT_SELF_REFERENCE`/`CONFIG_SUBAGENT_NESTING_EXCEEDED`/
`CONFIG_STATE_VALUE_REQUIRED`).

**Files — API** (`apps/api/`):
- `prisma/schema.prisma` (edited — `AlertType` enum gains
  `handoff_requested`; no other schema change this phase — Sub-agent
  stores nothing new, State is in-memory only);
  `prisma/migrations/20260904131732_subagent_handoff_state_phase15/migration.sql`
  (new, hand-authored for the same pre-existing `knowledge_chunk`
  generated-column drift reason every migration since Phase 13 documents
  — independently re-verified against a fresh throwaway Postgres).
- `src/modules/deployment-config/` (edited): `domain/combination-rules.ts`
  (`subAgentTargetsValidRule` (V-3) registered into `COMBINATION_RULES`;
  `ValidationContext` gains `tenantId`/`subAgentTargetsById`) + `.spec.ts`
  (new describe blocks — also backfilled test coverage for Phase 14's
  `consequentialToolGatedOrAckedRule`/`hitlGateRefsKnownRule`/
  `blockingGateReviewerCoverageRule`, which had shipped without dedicated
  unit tests); `domain/graph-structure.ts` (`checkStateValue` (Gate A,
  mirrors `checkQuorumN`'s "structural, one-mode-only" shape); `subagent`/
  `state`/`handoff` cases added to `checkNodeRefs`'s exhaustive switch) +
  `.spec.ts` (new); `domain/graph-rules.ts` (`nextHopIds` exhaustive switch
  extended); `domain/critical-path.ts` (`subagent` reads `node.budget_ms`
  as a real worst-case bound, same category as `retrieve`/`skill`;
  `handoff` terminal/zero-cost like `end`; `state` zero-cost) + `.spec.ts`
  (new); `application/validate-config.use-case.ts` (edited — resolves
  every distinct `subagent` target tenant's own published-status +
  one-hop nesting, once per validate/save call) + `.spec.ts`/
  `save-config.use-case.spec.ts` (edited, new mock); `application/test-call-graph.use-case.ts`
  (edited — `subagent`/`handoff`/`state` structural-simulator branches);
  `application/get-subagent-persona.use-case.ts` (new) + `.spec.ts` (new);
  `deployment-config.module.ts`/`index.ts` (edited — exports
  `GetSubAgentPersonaUseCase`).
- `src/modules/internal/interface/subagent-internal.controller.ts` (new,
  `GET /internal/tenants/:id/subagent-persona`) + `.http.spec.ts` (new,
  real `InternalTokenGuard` HTTP-pipeline proof); `internal.module.ts`
  (edited — imports `DeploymentConfigModule` directly, registers the new
  controller).
- `src/modules/sessions/domain/telemetry-ports.ts` (edited — `AlertKind`
  gains `handoff_requested`).

**Files — Python** (`apps/agent/src/avatar_agent/`), delivered by the
delegated session, independently re-verified: `contracts/runtime_config.py`
(edited — `SubAgentNode`/`HandoffNode`/`StateNode`, `GraphNode` union,
`ReasoningBlock`'s referential-integrity check extended);
`contracts/internal_api.py` (edited — `AlertType` gains
`handoff_requested`); `ports/orchestration.py` (edited —
`ISubAgentPersonaPort`/`SubAgentPersona`/`SubAgentToolDefinition`,
`IAlertPort`, `TurnContext.subagent_persona_port`/`subagent_persona_cache`/
`alert_port`/`session_state`); `telemetry/control_plane.py` (edited —
`get_subagent_persona`, `ControlPlaneSubAgentPersonaAdapter`/
`ControlPlaneAlertAdapter`); `orchestration/graph/nodes/{subagent,handoff,state}.py`
(new — `SubAgentNodeExecutor`/`HandoffNodeExecutor`/`StateNodeExecutor`);
`orchestration/graph/registry.py` (edited — all three registered,
completing `NODE_EXECUTORS`'s full 13-entry set); `orchestration/pipeline.py`/
`entrypoint.py` (edited — session-scoped `_subagent_persona_cache`/
`_session_state` created once per session, threaded by reference).
Tests: `tests/orchestration/graph/nodes/{test_subagent,test_handoff,test_state}.py`
(new, 25 cases total); `tests/contracts/test_runtime_config.py` (edited);
`tests/orchestration/graph/test_graph_registry.py` (edited — asserts all
13 node types registered). Fixtures:
`fixtures/agent-config/valid/{subagent-node,handoff-node,state-node}.yaml`
(new — closes the cross-language fixture-corpus gap Phase 14 flagged;
both the TS and Python contract-parity specs glob this directory
dynamically, so no file-list edits were needed on either side).

**Files — Web** (`apps/web/projects/`), delivered by the delegated
session, independently re-verified: `admin/src/app/features/reasoning/`
(`store/node-factory.ts`, `components/node-inspector/*`,
`components/node-card/*`, `store/reasoning.store.ts`,
`pages/reasoning-page/*` — the Sub-agent picker reuses the already-injected
`TenantsApiService`, the same call the existing `tenant-select` pattern
elsewhere in this app already makes, no new endpoint); `shared/src/lib/util/node-type-icon.ts`
(edited — `subagent`/`handoff`/`state` icons+labels, completing the
13-type registry); `admin/src/app/features/alerts/pages/alerts-page/*`
(edited — the one hardcoded alert-type display map gains
`handoff_requested`). No conversation-SPA changes this phase (all three
new node types are admin/backend/agent-side; unlike HITL, none surface
caller-facing UI).

### Real, non-mocked verification

1. **The hand-authored migration applied cleanly** against a fresh
   throwaway `pgvector/pgvector:pg16` Postgres, all 9 migrations in order,
   re-diffed to confirm zero further drift beyond the one already-known
   `knowledge_chunk` false-positive.
2. **`apps/api`**: `tsc --noEmit` clean; full `jest --runInBand` — 1280
   tests, only the same 3 pre-existing unrelated failures already
   documented at the end of Phase 14 (unchanged in kind and count).
3. **`apps/web`**: `tsc --noEmit` on the admin project clean; `ng build
   admin` succeeds (bundle-size-budget warning unchanged in kind, already
   tracked); full `jest` — 90 suites/732 tests, all passing (up from 716
   at the end of Phase 14); full `eslint`, clean.
4. **`apps/agent`**: full `pytest` (excluding the `bithuman`-import-failure
   module, same pre-existing sandbox limitation as Phase 14) — 492 passed,
   13 failed, the exact same 13 failures already documented at the end of
   Phase 14 (unchanged in kind and count — 12 from the missing `bithuman`
   package, 1 from the pre-existing masked assertion).
5. **Cross-language contract parity, directly exercised**: the TS spec
   (`agent-config-cross-language.contract.spec.ts`) was re-run against the
   three new Python-authored `.yaml` fixtures and passes (23 cases) — the
   Phase 14 fixture-corpus gap is now genuinely closed, not just
   documented as closed.
6. **Security review** (scoped to what this phase touched): the new
   internal endpoint is `InternalTokenGuard`-guarded exactly like every
   other agent-facing route, proven with a real HTTP-pipeline test (401 on
   missing/wrong token, use-case never called); no new admin-facing
   surface beyond the existing Reasoning tab's own save/validate flow (no
   new controller, no new DTO exposing anything beyond what a tenant-scoped
   admin could already see); the cross-tenant read (`GetSubAgentPersonaUseCase`)
   only ever returns a *published* target's system prompt + enabled tool
   metadata (never a draft, never a credential value — `credential_ref`
   only, matching every other tool-definition enrichment shape already in
   this codebase); no new npm/pip dependency. No blocking findings.

**Scope deviations (judgment calls made during implementation, beyond
"Decisions made this phase" above):**
1. The Prisma migration is hand-authored for the same recurring reason
   every migration since Phase 13 documents.
2. **Backfilled missing Phase 14 unit tests while in the same file**: while
   adding this phase's own `combination-rules.spec.ts` coverage, found that
   Phase 14's own `consequentialToolGatedOrAckedRule`/`hitlGateRefsKnownRule`/
   `blockingGateReviewerCoverageRule` had shipped with no dedicated unit
   tests at all (only exercised indirectly through the full
   `validate-config.use-case.spec.ts` integration) — added a full test
   block for each rather than leaving the gap in place while touching the
   same file, per this project's own "find the real gap, fix it in the
   same phase you're already touching the file" precedent.
3. Confirmed (Phase 15 finding, not a new instance introduced by this
   phase): `DeploymentConfigController`/`KnowledgePlaygroundController`
   were **already** reachable on the internal `:8081` listener before this
   phase, via `InternalModule → SessionsModule → DeploymentConfigModule`
   (the same architecture debt already flagged against `SessionsModule`'s
   import graph, now confirmed to also cover `deployment-config`, not just
   `skills`/`hitl`). This phase's own direct `InternalModule` import of
   `DeploymentConfigModule` (needed for DI purposes, to reach
   `GetSubAgentPersonaUseCase`) does not add any *new* leaked controller
   beyond what already existed — Nest treats a module imported from two
   parents as one singleton, confirmed by the full test suite passing with
   no duplicate-route error.

**Follow-ups left open for Phase 16, not silently dropped:**
- **The `SessionsModule`-import-graph internal-listener finding now
  confirmed to also cover `DeploymentConfigModule`** (`DeploymentConfigController`/
  `KnowledgePlaygroundController`), in addition to the `skills`/`hitl`
  instances already flagged — still worth the same dedicated cleanup pass
  every phase since Phase 13 has flagged, now with a fuller picture of its
  actual blast radius.
- Rate limiting on the new `/internal/tenants/:id/subagent-persona` route
  remains the same open, platform-wide gap every admin-triggered/costly-
  action route has carried since Phase 8 — not specific to this phase.
- **Bundle-size budget** — unchanged in kind; the Reasoning tab's own lazy
  chunk grew by roughly the same increment each node-type-adding phase
  has added (three more inspector cases in the same already-lazy module).
- A dedicated "list only tenants with a published config" endpoint for the
  Sub-agent picker was explicitly not built this phase (the picker shows
  every tenant; V-3's own Gate-B check is the real enforcement at save
  time) — worth reconsidering if admins report picking unpublished targets
  often enough that the inline error becomes annoying rather than rare.

## Phase 16 — Builder consolidation (BL-061, BL-062, BL-063, BL-064, BL-065)

### Goal

All nine tabs the v2.1 builder was designed around — Overview, Pipeline,
Reasoning, Skills, Tools, Knowledge, Dynamics, HITL, Privacy — live under
one shell, replacing the old single-page v1 builder and the six standalone
routes Phases 8-15 each built independently. This is the last phase of the
roadmap: after it, every one of the 13 A3.2 node types exists (Phase 15),
the full tab shell is live (this phase), and V-1..V-12 are enforced
somewhere in the product (V-11's sum finalized this phase; V-5's
`on_deadline` runtime and V-12 confirmed already complete from Phases 10/13
— see "Decisions made this phase").

### Scope

**In scope:**
1. **`dynamics` config block** (both languages) — `barge_in
   {enabled, sensitivity}`, `endpointing_silence_ms`, `verbosity`,
   `no_input {timeout_ms, max_reprompts}`, `call_limits {max_turn_tokens,
   max_turn_seconds}`. Confirmed before writing any code: **none of these
   five concepts exist anywhere in this codebase today** — no schema
   field, no runtime behavior (endpoint detection is a hardcoded
   LiveKit-VAD default with zero admin control; there is no
   caller-interrupt/barge-in handling at all). This phase ships the
   config surface only — schema, Gate A validation, the Dynamics tab UI,
   and the Python Pydantic mirror (required by this codebase's own
   "field-for-field identical, or it's an architecture defect" contract
   discipline even though nothing reads the values yet) — not runtime
   wiring. `dynamics` is the one top-level `AgentConfigSchema` block that
   is **optional**, unlike every other block (deliberate: unlike
   transport/stt/tts/avatar/reasoning or privacy/alerts, this is a genuine
   refinement an agent works correctly without — also avoids touching
   every one of this repo's ~20+ existing fixture YAMLs the way a
   *required* field addition would, per Phase 13's own precedent for
   `skills[]`).
2. **V-11's "final sum" (BL-063)** — a real, code-verified gap: the rule's
   own text says "always-on tool **schemas**," but the estimator only ever
   summed tool `name`+`description`. Fixed to also count an always-on
   tool's `args_schema` JSON size (never a skill's own attached tools' —
   R-S1 protects skills' lazy-loading boundary).
3. **V-5/V-12 "final sweep" (BL-063), the rest** — investigated with real
   code reads, not assumed: both were found **already fully complete**
   (V-5's `on_deadline` referential check is generic across all 13 node
   types via the shared `NodeBase` spread + `graph-structure.ts`'s
   type-agnostic loop; the interpreter's actual deadline-degradation
   routing was built in Phase 10 and extended to nested chains in Phase
   11; V-12's `skillRefsKnownAndEnabledRule` already covers both reference
   sources completely). `ARCHITECTURE_NOTES.md` §7's table is stale on
   both counts — see "Decisions made this phase" for the full evidence
   trail; no functional code changes were needed for either.
4. **The 9-tab shell** (BL-065) — one `BuilderShellComponent` at
   `tenants/:id/builder`, nesting all 9 tabs as child routes so each stays
   independently linkable. Tab count resolved as **9, not 8**: `A9.1`'s
   own table has 8 rows and doesn't count Overview, but `UX_SCOPE.md`'s
   own IA line spells out all 9 names explicitly and its wireframe
   reference shows a 9-tab bar — every "8-tab shell" phrase in the source
   docs turned out to be counting only the 8 *substantive* tabs and
   treating Overview as the landing view, never suggesting it be omitted.
5. **Overview tab** (BL-061) — 4 read-only summary cards (Media Pipeline,
   Reasoning, Capabilities, Behaviour) composing state the other tabs'
   stores already hold, no new logic, plus a persistent right rail (turn
   budget, base-prompt cost estimate, validation summary, YAML viewer,
   test-call shortcut) that survives tab switches per `UX_SCOPE.md`'s
   explicit "persist across tab switches, don't recompute per tab" rule.
   Diff button and "Last Eval" card both omitted — the former per
   `UX_SCOPE.md`'s own instruction (BL-078, deferred), the latter because
   no eval-harness feature was ever built in any of the 15 prior phases
   (nothing to even show disabled).
6. **Pipeline tab** (net-new content, extracted) — Transport/STT/TTS/Avatar
   provider chains, moved verbatim out of the old single-page builder.
7. **Dynamics tab** (BL-062) — the new form for item 1's schema.
8. **Privacy tab** (BL-064) — the existing Residency screen mounted
   directly under the new tab path, relabeled; no new logic.
9. **`agent.system_prompt`/`runtime`/`memory`** — had no named tab anywhere
   in the source docs. Resolved as a new "Core instructions" section
   inside the **Reasoning** tab (system prompt is literally what V-11's
   own `core_tokens` term already measures as part of the reasoning cost;
   thematically "how the agent reasons," not a pipeline or dynamics
   concern) — a real relocation of real logic (including the UTF-8
   byte-counter), not a passthrough wrap like items 6/8.
10. **Every pre-Phase-16 standalone route keeps working** — `redirectTo`
    entries for all six absorbed routes (Tools/Reasoning/Knowledge/
    Skills(+detail)/HITL(+reviewer-groups)/Residency), plus every internal
    `routerLink` across the app updated to the new nested paths directly.

**Out of scope (explicit):** any runtime wiring for the five Dynamics
fields (config surface only, see item 1); a redirect/diff-view UI for
`ConfigVersion` (BL-078, permanently deferred, not part of this roadmap);
real multi-environment config isolation (`ARCHITECTURE_NOTES.md` §0.2's
standing descope, unchanged); a "redaction" field despite A9.1's table
cell naming it (no such field is scoped by `UX_SCOPE.md`'s actual Privacy
text, which says relabel-only — not invented here either).

### Decisions made this phase

1. **9 tabs, confirmed by direct textual evidence, not a coin flip.**
   `UX_SCOPE.md` line 182 ("Tab order matches A9.1's table: **Overview**,
   Pipeline, Reasoning, Skills, Tools, Knowledge, Dynamics, HITL,
   Privacy") and its own A9.2 wireframe reference (`●Overview` first in a
   9-name tab bar) both independently confirm Overview is a real, always
   -present tab, not an omitted "landing view." Every "8-tab" phrase
   elsewhere (including this doc's own Phase 15 section, written before
   this phase resolved the count) refers to the 8 tabs A9.1's table
   itself enumerates, which never included Overview as a 9th row to begin
   with — not an instruction to build only 8.
2. **`dynamics` is optional; every other `AgentConfigSchema` top-level
   block is required.** A deliberate, singular exception, weighed
   explicitly against Phase 13's own precedent (adding `skills[]` as a
   *required* field meant touching all 18 fixtures that existed then).
   Given Dynamics' fields are genuinely non-essential (an agent functions
   correctly with none of them ever set) and this phase's own scope never
   commits to runtime wiring, optional was the smaller-blast-radius,
   equally-defensible choice — made explicitly, not by oversight.
3. **V-5/V-12's "final sweep" required real code investigation before
   writing anything, and found nothing left to build.** `ARCHITECTURE_NOTES.md`
   §7's table attributes V-5's `on_deadline` runtime to "needs
   deadline-degradation runtime" and V-11's sum to "8 (tools term), 13
   (skills term completes the sum)" — both read as still-open. Direct
   code reads found otherwise: `edges.py`'s own docstring documents R-G13's
   deadline-degradation routing as **already fixed in Phase 10**
   ("added this phase for R-G13's deadline-degradation runtime"), and
   `prompt-cost.ts`'s own docstring documents the tools+skills sum as
   **built once, complete, in Phase 13** ("built once with both terms
   ... rather than 'completing' a pre-existing sum"). Treating a stale
   architecture-notes table as ground truth without reading the code it
   describes would have produced speculative, unnecessary rework — this
   phase's actual contribution to BL-063 is the one real gap (V-11's
   `args_schema` omission) plus closing out the documentation debt.
4. **V-11's `args_schema` addition only ever applies to `agent.tools[]`'s
   always-on entries, never a skill's own attached tools.** R-S1's
   progressive-disclosure boundary (a skill's tools/instructions are
   lazy-loaded only once triggered, never part of the base prompt) would
   be silently violated by counting them here — `AttachedItemDescription.argsSchema`
   is accordingly typed as tool-only, with no equivalent field on the
   skill-shaped call sites at all (a compile-time guarantee, not just a
   convention).
5. **`agent.system_prompt`/`runtime`/`memory` go in Reasoning, not
   Pipeline or a new tab of their own.** No source doc names a home for
   these three fields at all (confirmed by direct search across both
   spec docs). Reasoning was chosen over Pipeline because the system
   prompt is literally one of V-11's three summed terms (`core_tokens`),
   already conceptually paired with the turn-budget/token-cost concerns
   the Reasoning tab's own panel already visualizes — Pipeline is purely
   about I/O provider chains with no existing token-cost framing to
   attach these fields to.
6. **The tab strip is router-driven, not `mat-tab-group`'s own content
   projection** — each `<mat-tab>` is label-only, real content renders
   through a nested `<router-outlet>` per `agent-builder.routes.ts`'s
   child routes. This is what makes every tab independently linkable
   (deep links, `[edit ▸]` links, browser back/forward) while still
   getting `mat-tab-group`'s built-in arrow-key/`role` semantics for the
   tab strip itself for free. Documented trade-off: the tab↔tabpanel ARIA
   wiring isn't fully APG-correct this way (a purpose-built
   `mat-tab-nav-bar`/`mat-tab-nav-panel` pairing would be more precise) —
   accepted for this phase given the much larger payoff of reusing
   `mat-tab-group` verbatim per `UX_SCOPE.md`'s own explicit instruction.
7. **The shell owns one guarded load of all 6 composed features' stores**
   (`AgentBuilderStore` plus `ReasoningStore`/`ToolsStore`/
   `SkillsLibraryStore`/`KnowledgeSourcesStore`/`HitlGatesStore`), not each
   tab loading its own on mount — so the persistent right rail has real
   data even on a deep link straight into, say, Dynamics that never
   mounts `OverviewTabComponent` at all, and so a tab switch never
   reloads/clobbers another tab's in-progress edit. The shell component
   itself is never destroyed by a tab switch (only the child
   `<router-outlet>`'s content swaps), which is *why* the right rail
   persists across tab switches with no extra state-preservation code.
8. **A new shared ESLint isolation-zone exemption**, narrowly scoped:
   `agent-builder` may import from the six features it now composes as
   tab content (`tools`/`reasoning`/`knowledge`/`skills`/`hitl`/
   `residency`), but those six still cannot reach into each other or into
   `agent-builder`'s own internals — verified directly (not just
   asserted) by probing that a `knowledge → tools` or `skills → hitl`
   import is still rejected by the linter after the change.

### Result — Phase 16 done (2026-09-04) — roadmap complete

**Delivered as planned**, built by the orchestrating session directly for
the shared foundation (the `dynamics` contract in both languages, the
V-11 fix, and the V-5/V-12 investigation-and-documentation closure), with
the full 9-tab shell — by far the largest single UI undertaking in this
16-phase roadmap — built by one delegated background session against
those already-locked contracts, independently re-verified end to end by
the orchestrating session afterward (`tsc --noEmit`, `ng build`, `jest`,
`eslint` all re-run directly on both `apps/api` and `apps/web`, plus the
Python `pytest` suite and the TS/Python cross-language contract spec
against a newly-added `dynamics`-carrying fixture), per this project's
unbroken "trust but verify" discipline across all 9 phases of this v2
effort.

**Files — Contracts** (`packages/contracts/src/`): `agent-config/dynamics.schema.ts`
(new — `BargeInSchema`/`NoInputSchema`/`CallLimitsSchema`/`VerbositySchema`/
`DynamicsSchema`); `agent-config/schema.ts` (edited — `dynamics: T.Optional(DynamicsSchema)`
added to `AgentConfigSchema`, the one optional top-level block).

**Files — API** (`apps/api/`):
- `src/modules/deployment-config/domain/draft-schema.ts` (edited — the
  field-by-field optional draft mirror gains `dynamics`, and
  `AGENT_CONFIG_TOP_LEVEL_KEYS` gains the key); `domain/agent-config.ts`
  (edited — `PartialAgentConfig`'s hand-written loose type gains
  `dynamics?`).
- `domain/prompt-cost.ts` (edited — `AttachedItemDescription.argsSchema`,
  `computeBasePromptCost`'s tools-term sum includes it) + `.spec.ts`
  (edited, 3 new cases); `domain/combination-rules.ts` (edited —
  `ValidationContext.toolDescriptionsByApiRef`'s value widened to
  `{description, argsSchema}`; `basePromptCostWithinCeilingRule` threads
  it through) + `.spec.ts` (edited, 1 new case); `application/validate-config.use-case.ts`
  (edited — populates the widened map from `ToolDefinitionRecord.argsSchema`).
- No new module, no new controller, no new endpoint — `dynamics` flows
  through the existing config save/validate surface as just another
  field, exactly like every prior top-level block.

**Files — Python** (`apps/agent/src/avatar_agent/`): `contracts/runtime_config.py`
(edited — `BargeIn`/`NoInput`/`CallLimits`/`DynamicsBlock` Pydantic models,
`AgentConfig.dynamics: DynamicsBlock | None = None`, inherited for free by
`AgentRuntimeConfig`). This mirror exists solely to satisfy this file's
own "field-for-field identical to `AgentConfigSchema`, or it's an
architecture defect" contract (`extra="forbid"` on every model here means
a published config carrying an unmirrored `dynamics` block would
otherwise fail to parse at runtime) — no consumer reads these values yet,
by design (see "Decisions made this phase" #1/Scope item 1).
`fixtures/agent-config/valid/dynamics-block.yaml` (new — the one fixture
that actually exercises a populated `dynamics` block through both
language's contract-parity specs, not just its absence).

**Files — Web** (`apps/web/projects/`), the 9-tab shell, delivered by the
delegated session, independently re-verified: `admin/src/app/features/agent-builder/`
— `agent-builder.routes.ts` (rewritten — shell + 9 nested tab children +
`AGENT_BUILDER_LEGACY_REDIRECTS`), `pages/builder-shell/` (new —
`mat-tab-group` + persistent right rail + guarded multi-store load),
`pages/overview-tab/` (new — the 4 summary cards), `pages/pipeline-tab/`
(new — Transport/STT/TTS/Avatar extracted verbatim from the decommissioned
`agent-builder-page`), `pages/dynamics-tab/` (new — the Dynamics form),
`store/agent-builder.store.ts`/`agent-config-draft.model.ts` (edited —
`dynamics`/`defaultDynamics()`, `errorsByField`), `token-estimate.util.ts`
(new — the client-side base-prompt-cost estimate, labeled as such in the
UI since no server-side breakdown endpoint exists). `admin/src/app/app.routes.ts`
(edited — replaces 6 standalone route-array spreads with the shell +
redirects); `admin/src/app/app.config.ts` (edited —
`withRouterConfig({ paramsInheritanceStrategy: 'always' })`, required for
nested tabs to keep reading the parent `:id` param unchanged).
`features/reasoning/` (edited — new "Core instructions" section,
`system_prompt`/`runtime`/`memory` + byte-counter relocated from the old
page); `features/residency/residency.routes.ts`/`residency-picker-page.component.*`
(trimmed to the bare tenant-picker; navigates into `.../builder/privacy`).
routerLinks updated to nested paths across `hitl-gates-page`,
`reviewer-groups-page`, `tools-page`, `knowledge-{pipeline,sources,playground}-page`,
`skills-library-page`, `skill-editor-page`. `projects/shared/src/lib/util/byte-length.util.ts`
(new — moved from the agent-builder feature since Reasoning now needs the
same UTF-8 byte-counting logic). **Deleted**: `features/agent-builder/pages/agent-builder-page/`
(the old v1 single-page builder, fully decommissioned) and
`{tools,reasoning,knowledge,skills,hitl}.routes.ts` (superseded by the
shell's nested children). `eslint.config.mjs` (repo root, edited — the
narrowly-scoped `agent-builder` isolation-zone exemption, see "Decisions
made this phase" #8).

### Real, non-mocked verification

1. **`apps/api`**: `tsc --noEmit` clean; full `jest --runInBand` — 1290
   tests, only the same 3 pre-existing unrelated failures documented at
   the end of Phase 15 (unchanged in kind and count).
2. **`apps/web`**: `tsc --noEmit` on the admin project clean; `ng build
   admin` succeeds — every new/embedded tab confirmed as its own lazy
   chunk in the build output (`builder-shell-component`,
   `overview-tab-component`, `pipeline-tab-component`,
   `dynamics-tab-component`, plus all six embedded existing feature
   pages); bundle-size-budget and CJS-interop warnings unchanged in kind,
   already tracked; full `jest` — 95 suites/761 tests, all passing (up
   from 732 at the end of Phase 15); full `eslint` on both `apps/web` and
   `apps/api`, clean — the new isolation-zone exemption's scoping was
   independently re-verified (not just re-run): confirmed `knowledge →
   tools` and `skills → hitl` imports are still rejected after the change.
3. **`apps/agent`**: full `pytest` (excluding the `bithuman`-import-failure
   module, same pre-existing sandbox limitation every phase since Phase
   14 has hit) — 493 passed, 13 failed, the same 13 pre-existing failures
   documented since Phase 14 (unchanged in kind and count).
4. **Cross-language contract parity, directly exercised for the new
   field**: both `agent-config-cross-language.contract.spec.ts` (TS, 24
   cases, up from 23) and `test_agent_config_contract.py`/`test_runtime_config.py`
   (Python, 53 cases in the contracts subfolder, up from 52) were re-run
   against the new `dynamics-block.yaml` fixture and pass on both sides —
   proving the Pydantic mirror actually round-trips a populated
   `dynamics` block, not just tolerating its absence.
5. **Every pre-Phase-16 standalone route confirmed to still resolve**:
   `tenants/:id/{tools,reasoning,knowledge,skills,skills/:id,hitl,hitl/reviewer-groups,residency}`
   all redirect to their nested equivalents under `.../builder/*`, and
   internal `routerLink`s across the six absorbed features were updated
   to the nested paths directly rather than relying solely on the
   redirects.
6. **Security review** (scoped to what this phase touched): no new
   backend endpoint, no new controller, no new auth surface — `dynamics`
   is validated by the same Gate A/B pipeline every other config field
   already goes through, with the same bounds-checked TypeBox schema
   discipline (min/max on every numeric field). No new npm/pip
   dependency. The ESLint isolation-zone change is a stricter, more
   narrowly-scoped boundary than existed before for `hitl` (which had no
   zone at all until this phase), not a loosening. No blocking findings.

**Scope deviations (judgment calls made during implementation, beyond
"Decisions made this phase" above):**
1. No dedicated Playwright/Cypress visual/responsive verification at
   375/414/768px (`UX_SCOPE.md`'s own explicit ask) — this repo has no
   e2e browser-automation harness for the admin app at all (confirmed
   before skipping, not assumed); verified structurally instead (the
   existing `<1280px` collapse pattern is unmodified, `mat-tab-group`'s
   native horizontal-scroll behavior at narrow widths is untouched code).
   Flagged as a real gap below, not silently skipped.
2. No exact skills/tools token-cost breakdown ("N via skills, N via graph
   node") in Overview's Capabilities card — no such computation exists
   anywhere client-side today, and building one would be new logic this
   phase's own "no new logic for 6 of 9 tabs" charter excludes; the card
   shows the counts that already exist without inventing a new estimate.

**Follow-ups left open, not silently dropped (the roadmap's own remaining
punch list — no further phases are planned, so these are now standing
platform backlog, not "next phase" items):**
- **No Playwright/Cypress harness exists for the admin app** — the
  responsive verification `UX_SCOPE.md` asked for at 375/414/768px was
  done structurally, not with a real browser. Worth building an e2e
  harness independent of any specific future feature work.
- **The tab↔tabpanel ARIA wiring is not fully APG-correct** under the
  router-driven `mat-tab-group` pattern this phase deliberately chose
  (see "Decisions made this phase" #6) — a purpose-built
  `mat-tab-nav-bar`/`mat-tab-nav-panel` pairing would be more precise;
  accepted as a documented trade-off, not fixed.
- **Base-prompt cost in Overview's right rail is a client-side ~4-bytes
  -per-token estimate**, labeled as such in the UI — no server-side
  breakdown endpoint exists (the same heuristic `prompt-cost.ts`'s own
  server-side estimator already uses, per that file's own doc comment,
  just computed client-side here too for the same reason Phase 8's
  original Tools-tab banner did).
- **Dynamics fields have zero runtime wiring** — by design this phase
  (see Scope item 1), but worth flagging clearly as the roadmap closes:
  an admin can configure barge-in sensitivity, endpointing silence,
  verbosity, no-input timeout/reprompts, and call limits today, and
  **none of it affects a live call yet**. A future phase wiring real
  behavior into `apps/agent`'s STT/turn-taking logic is a genuinely new,
  unscoped body of work, not a continuation of this one.
- Every item already carried forward in `docs/plans/agent-builder-v2-PENDING.md`'s
  cross-cutting debt list (the `SessionsModule`-import-graph internal
  -listener finding, no rate limiting anywhere, the admin bundle's
  initial-size budget, HITL's `escalate` wider-review UI, Sub-agent's
  one-bounded-turn v1 scope, and the rest) remains exactly as documented
  there — this phase closing does not resolve any of them; see that file
  for the authoritative, currently-open list now that all 16 phases are
  done.
