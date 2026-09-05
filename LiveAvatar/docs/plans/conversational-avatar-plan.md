# Conversational Avatar Platform — Phased Development Plan

**Status:** Phase 1 implemented, awaiting QA  
**Backlog:** `docs/BACKLOG.md` (P0 phases 1–7). **P2 items BL-026–BL-032 are out of scope forever** — billing, self-serve signup, GPU autoscaler actions, white-label, email/PagerDuty destinations, recording capture, schema-per-tenant isolation.  
**UX:** `docs/design/UX_GUIDELINES.md` (baseline + Phase 1 screens). No Figma.  
**Stack:** ADR-001 — NestJS 11 + Prisma 7 + Postgres 16 + Angular 20 (admin + conversation SPAs) + Python agent (second deployable). pnpm workspaces, not Nx.

This plan covers **all seven P0 backlog phases** as technical slices. Each phase leaves the system compileable and deployable. Implementation order follows `docs/BACKLOG.md` Phase/Priority; technical slices inside a phase follow data/domain → use-cases → API → frontend data-access → UI → tests.

---

## Plan Phase 1 — Platform skeleton, tenancy, admin auth, Screen 3

**Status:** implemented, awaiting QA  
**Goal:** An operator can seed the first account, sign in, invite admins, and create/list/pause tenants from the admin SPA; every tenant-scoped write is isolated.

**Backlog item(s):** BL-001, BL-002, BL-003, BL-004

**Scope — in:**
- Workspace: `pnpm-workspace.yaml`, root scripts, ESLint layer boundaries, `.env.example`, `docker-compose.dev.yml` (Postgres 16 + Redis), `logs/` gitignored
- `packages/contracts`: error codes + messages, auth/tenant/common TypeBox schemas
- `apps/api` four-layer modules: `platform`, `auth`, `tenants`, `admin-users`; `common/` (errors, TypeBox pipe, idempotency, TenantContext + TenantScopeGuard, AdminJwtGuard, RolesGuard, PrismaService + tenantGuard)
- Prisma schema: full LLD §4.1 models (one migration) + §4.2 CHECK/FTS SQL; APIs only for Phase 1 routes
- Admin SPA: login, invite-accept, Screen 3 deployments, sidebar shell, builder placeholder
- Conversation SPA: placeholder page only
- `apps/agent`: `pyproject.toml` + README stub, no runtime

**Scope — out:** provider catalog/registry/probes, Agent Builder, LiveKit, STT/LLM/TTS, avatars, logs/dashboard/GPU/alerts/residency screens, conversation tokens, P2 items.

**Deliverables:**
- `POST/GET/PATCH /api/tenants`, `POST /api/tenants/{id}/status`, `GET /api/health`
- `POST /api/auth/{login,refresh,logout,seed,invites,invites/accept}`, `GET /api/auth/{me,invites}`, `DELETE /api/auth/invites/{id}`
- No `POST /api/auth/register`
- Admin UI at `/admin`; conversation placeholder at `/c`
- Unit tests (login, seed, create tenant, isolation) + Supertest e2e + Angular login/list tests

**Exit gate:**
- `tsc`/build green; lint + full tests + ≥80% coverage on added files
- FR-TENANT-1–5 and FR-AUTH-1,2,3,5 acceptance (seed → login → create → list; bad login; duplicate slug; admin cannot create; unassigned admin empty list; A cannot GET B → 404; no register)
- Security: guards on every admin route, Argon2id, no secrets in git, login rate limit, conversation-shaped JWTs rejected
- UX: WCAG 2.2 AA patterns from `UX_GUIDELINES.md` (auth cards, empty states, role-gated actions)

---

## Plan Phase 2 — Provider catalog, registry, probes, contracts, Agent Builder

**Status:** not started  
**Goal:** An operator can register provider endpoints (credential refs only), probe them, and draft/publish Example A/B YAML from Agent Builder Screen 2 with live validation.

**Backlog item(s):** BL-005, BL-006, BL-007, BL-008, BL-009

**Scope — in:**
- `apps/api` modules: `providers`, `deployment-config` (four layers); seed `ProviderDefinition` catalog including LiveAvatar + hosting badges
- Provider Registry CRUD (no secrets in YAML/body); probe use-case + stored `last_probe_*`; rate limit 30/tenant/min
- `packages/contracts` Agent Builder YAML TypeBox schema (LLD §6) + combination validation
- Admin SPA Screen 2 (dispatch `nexus-ux` if guidelines lack Screen 2 detail) + Screen 4 provider registry
- Static combination rules (FR-PROVIDER-4/5, FR-CONFIG-2)

**Scope — out:** LiveKit rooms/tokens, runtime adapters, avatar video, session logs, P2.

**Deliverables:** catalog + credential APIs (LLD §5.4), config validate/save (LLD §5.5), published Example A/B fixtures, secrets rejected (`CONFIG_SECRET_IN_YAML` / `PROVIDER_SECRET_IN_BODY`).

**Exit gate:** Example A and B publish; secrets rejected; probes stored; unit + API + builder UI tests; coverage ≥80% on new files; security review of credential_ref handling.

---

## Plan Phase 3 — LiveKit rooms, tokens, Screens 9–10

**Status:** not started  
**Goal:** An end user completes preflight, receives a session-bound LiveKit token (≤2h), joins a namespaced room, mutes, and ends the call (agent may still be a stub).

**Backlog item(s):** BL-010, BL-011, BL-012

**Scope — in:**
- `apps/api` `transport`, `sessions`, `public` modules; room name = `{room_namespace}_…`; control-plane token issuer
- Session row lifecycle (pending → active → ended)
- Conversation SPA Screens 9–10 (dispatch `nexus-ux` for conversation surface); LiveKit JS SDK
- Admin JWT vs conversation/LiveKit token isolation already in Phase 1 guards — mint conversation tokens here
- `apps/agent` worker stub that can join a room without STT/LLM/TTS

**Scope — out:** STT/LLM/TTS adapters, captions, avatars, post-call summary, P2.

**Deliverables:** LLD §5.8 preflight + session start/end; conversation UI join/mute/end/reconnect; paused tenant → `403 TENANT_PAUSED`.

**Exit gate:** Golden path preflight → join → mute → end; token TTL ≤2h; media never through NestJS; tests + coverage + security (public token mint rate-limit, room namespace isolation).

---

## Plan Phase 4 — STT, LLM, TTS, agent runtime, captions

**Status:** not started  
**Goal:** A live call runs listen → think → speak with captions and hop metrics; LLM failover and residency strip are honored.

**Backlog item(s):** BL-013, BL-014, BL-015, BL-016, BL-017

**Scope — in:**
- `apps/agent` ports + registry + adapters: Deepgram / faster-whisper; OpenAI / Anthropic / Google (logical names only); Fish Speech / ElevenLabs
- Orchestration (LangGraph or Pydantic AI per config); tools, memory, RAG hook
- Hop rows via `/internal`; residency filter; failover / degraded speech
- Screen 10 live captions from STT partials
- No vendor SDK outside `adapters/`; no vendor model id literals outside fixtures

**Scope — out:** bitHuman / LiveAvatar video, operator log/dashboard screens, P2.

**Deliverables:** full pipeline; caption overlay; hop persistence; structured LLM output via Pydantic (never hand-parsed JSON).

**Exit gate:** Loop + captions + hops; failover/residency tests; import-linter green; coverage ≥80%; security (internal token, residency snapshot, no secrets in `/internal` responses).

---

## Plan Phase 5 — bitHuman avatar adapter

**Status:** not started  
**Goal:** Example A completes a live call with bitHuman video published to LiveKit, driven by Fish Speech TTS.

**Backlog item(s):** BL-018

**Scope — in:** `IAvatarProvider` bitHuman adapter; LiveKit video publish; hop metrics; crash → degrade (spoken message, no video)
**Scope — out:** LiveAvatar adapter, operator observability screens, P2.

**Deliverables:** Example A path; Agent Builder already has bitHuman in catalog from Phase 2.

**Exit gate:** Avatar video on Screen 10 for Example A; hops recorded; crash degrade tested; coverage + security (credential_ref only).

---

## Plan Phase 6 — Alibaba LiveAvatar adapter

**Status:** not started  
**Goal:** Example B completes a live call on a second `IAvatarProvider`; Agent Builder shows documented feature-gap copy.

**Backlog item(s):** BL-019

**Scope — in:** LiveAvatar adapter (lip-sync + LiveKit publish); feature-gap string from catalog surfaced in builder
**Scope — out:** new builder features beyond gap copy, P2.

**Deliverables:** second adapter; config-only Example B live call.

**Exit gate:** Example B call succeeds; gap copy visible; tests + coverage + security.

---

## Plan Phase 7 — Logs, dashboard, GPU, alerts, residency, Screen 11

**Status:** not started  
**Goal:** All 11 screens are live: operators can search session hops, see dashboard health, view GPU heartbeats (no scale actions), configure alerts/residency, and end-users get a post-call summary + feedback.

**Backlog item(s):** BL-020, BL-021, BL-022, BL-023, BL-024, BL-025

**Scope — in:**
- Screens 5, 1, 6, 7, 8, 11; APIs LLD §5.6–5.8 remainder
- Retention purge job (transcripts per policy); residency snapshot-at-start already used by Phase 4 — this ships the operator UI
- GPU heartbeat ingest + display only (`autoscaler: not_configured`)
- In-app `AlertEvent` list + degraded-mode message config (no email/PagerDuty — BL-030)
- Post-call summary (agent-written) + feedback (only end-user write path)

**Scope — out:** BL-026–BL-032 forever; GPU scale up/down; recording capture pipeline (flag + warn only if enabled).

**Deliverables:** remaining admin screens + conversation Screen 11; purge job; dashboard zeros when no tenants.

**Exit gate:** All 11 screens; latency visible; summary + feedback; no GPU scale endpoints; tests + coverage + security (summary token binding, feedback once).

---

## Overrides and notes

- No backlog reordering. Phase 1 includes the full Prisma schema (one migration) so later modules do not need a destructive reshape; unused tables have no APIs until their phase.
- Phase 1 UI required `nexus-ux` first because `UX_GUIDELINES.md` did not exist; later UI phases dispatch `nexus-ux` only when a new surface or novel pattern is not already covered.
- `apps/agent` is a second deployable; Phase 1 ships stub files only so the repo layout matches LLD §2.
- Default tenant side-effects (empty `DeploymentConfig`, default `DataResidencyPolicy`, default `AlertPolicy`, `room_namespace = slug`) are created in Phase 1 so FR-TENANT-1 is complete even though those screens ship in Phase 7 / 2.

## Phase status log

| Phase | Status | Notes |
|---|---|---|
| 1 | implemented, awaiting QA | BL-001–BL-004. UX guidelines followed. |
| 2 | not started | |
| 3 | not started | |
| 4 | not started | |
| 5 | not started | |
| 6 | not started | |
| 7 | not started | |
