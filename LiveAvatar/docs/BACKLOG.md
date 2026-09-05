# Conversational Avatar Platform — Backlog

Authoritative build order for `nexus-dev`. Priority follows the spec MVP line: **P0 = full-platform v1**; **P2 = deferred**. There is no P1 cut — the user asked for all 11 screens and both avatar adapters in v1.

Phases are ordered by dependency (skeleton before config, tokens before media, media before avatar, observability last so it has hops to display).

| ID | FR ref(s) | Title | Priority | Phase | Depends on | Rationale |
|---|---|---|---|---|---|---|
| BL-001 | FR-TENANT-1, FR-TENANT-2, FR-TENANT-3, FR-TENANT-4, FR-TENANT-5 | Tenant CRUD, pause/activate, row-level isolation + room namespace | P0 | 1 | — | Every later record and LiveKit room is tenant-scoped; without this nothing else can persist safely. |
| BL-002 | FR-AUTH-1, FR-AUTH-2, FR-AUTH-5 | Admin login, 8h JWT / 7d refresh, logout, admin-API guard | P0 | 1 | — | Screens 1–8 are unusable without auth; conversation tokens must be rejected on admin routes. |
| BL-003 | FR-AUTH-3 | Operator seed + invite-only admin users (no self-signup) | P0 | 1 | BL-002 | Locked auth model; first operator bootstrap unblocks human use of the control plane. |
| BL-004 | FR-TENANT-2, FR-CONFIG-5 | Deployment / customer list (Screen 3) + deep link to builder | P0 | 1 | BL-001, BL-002 | Operator needs a home for tenants before config exists; click-through is the navigation spine. |
| BL-005 | FR-PROVIDER-1, FR-PROVIDER-6 | Seed provider catalog + self-hosted/remote badges | P0 | 2 | BL-001 | Agent Builder dropdowns and combination rules need the built-in catalog (including LiveAvatar). |
| BL-006 | FR-PROVIDER-2, FR-PROVIDER-7 | Per-tenant Provider Registry: endpoints + credential refs, no secrets in YAML | P0 | 2 | BL-005, BL-002 | Secrets-never-in-YAML is a hard constraint; published configs cannot exist without refs. |
| BL-007 | FR-PROVIDER-3 | Provider connection / health probe | P0 | 2 | BL-006 | Dashboard and Screen 4 status depend on stored probe results, not live calls every paint. |
| BL-008 | FR-PROVIDER-4, FR-PROVIDER-5, FR-CONFIG-2 | Adapter contracts + static combination validation + YAML schema | P0 | 2 | BL-005 | Invalid mixes must fail at save; schema is the shared contract for builder, runtime, and alerts UI. |
| BL-009 | FR-CONFIG-1, FR-CONFIG-3, FR-CONFIG-4 | Agent Builder (Screen 2): dropdowns, draft/publish, live preview | P0 | 2 | BL-006, BL-008, BL-004 | Core operator workflow; Example A/B configs are created here; unblocks session start checks. |
| BL-010 | FR-AUTH-4, FR-TRANSPORT-1, FR-TRANSPORT-3, FR-TRANSPORT-4 | LiveKit rooms, namespace naming, control-plane token issuer, session row lifecycle | P0 | 3 | BL-001, BL-009 | Media never flows through NestJS; rooms + session-bound tokens (≤2h) are the join contract. |
| BL-011 | FR-CALL-1, NFR-6 | Pre-call / permissions (Screen 9): mic, preflight, avatar preview, token issue | P0 | 3 | BL-010 | End users have no accounts; this screen is the only legal way to mint a conversation token. |
| BL-012 | FR-CALL-2, FR-TRANSPORT-2 | Live conversation (Screen 10): LiveKit JS SDK, avatar surface, mute, end-call, reconnect | P0 | 3 | BL-011 | Required conversation UX; can join a room before STT/LLM/TTS are wired (agent stub). |
| BL-013 | FR-STT-1, FR-STT-2, FR-STT-3, FR-STT-4 | STT adapters (Deepgram self-hosted + faster-whisper) + streaming partials + hop metrics | P0 | 4 | BL-008, BL-010 | First hop of the production baseline; captions and LLM input depend on finals/partials. |
| BL-014 | FR-LLM-1, FR-LLM-2, FR-LLM-3, FR-LLM-4 | Remote LLM adapters (OpenAI/Anthropic/Google), fallback/retry, residency strip, hop metrics | P0 | 4 | BL-008, BL-013 | Swappable intelligence layer; failover + residency must exist before any production call. |
| BL-015 | FR-TTS-1, FR-TTS-2, FR-TTS-3, FR-TTS-4 | TTS adapters (Fish Speech default + ElevenLabs) + stream to avatar + hop metrics | P0 | 4 | BL-008, BL-014 | Avatar is driven by TTS audio; Fish Speech is the production default. |
| BL-016 | FR-AGENT-1, FR-AGENT-2, FR-AGENT-3, FR-AGENT-4, FR-AGENT-5 | LiveKit Agents runtime (LangGraph or Pydantic AI): tools, memory, RAG hook, orchestration | P0 | 4 | BL-010, BL-013, BL-014, BL-015 | NestJS must not drive WebRTC; this process is the only legal pipeline host. |
| BL-017 | FR-CALL-3 | Live captions from STT partials on Screen 10 | P0 | 4 | BL-012, BL-013 | In-scope conversation UX; cheap once STT partials exist; accessibility (NFR-4). |
| BL-018 | FR-AVATAR-1, FR-AVATAR-3, FR-AVATAR-4, FR-AVATAR-5 | bitHuman adapter: external TTS drive, LiveKit video publish, hops, crash degrade | P0 | 5 | BL-015, BL-016, BL-012 | Production-default avatar; proves the primary `IAvatarProvider` path (Example A). |
| BL-019 | FR-AVATAR-2 | Alibaba LiveAvatar second adapter + documented feature-gap copy in Agent Builder | P0 | 6 | BL-018, BL-008 | Explicitly in v1 to validate the abstraction (Example B); lip-sync + LiveKit publish are blockers. |
| BL-020 | FR-SESS-1, FR-SESS-2, FR-SESS-3, FR-PRIV-3, FR-PRIV-4 | Session logs / transcripts (Screen 5), hop breakdown, retention purge | P0 | 7 | BL-016, BL-001 | Operators cannot debug latency or content without persisted hops and searchable logs. |
| BL-021 | FR-DASH-1, FR-DASH-2 | Dashboard (Screen 1): volume, errors, per-provider health | P0 | 7 | BL-007, BL-020, BL-004 | Cross-tenant operability goal; consumes probes + session aggregates already stored. |
| BL-022 | FR-GPU-1, FR-GPU-2, FR-GPU-3 | GPU / node health monitor (Screen 6), heartbeat ingest, autoscaler status display only | P0 | 7 | BL-002 | Required screen; must not implement scale actions — status/heartbeats only. |
| BL-023 | FR-ALERT-1, FR-ALERT-2, FR-ALERT-3, FR-ALERT-4 | Alerts & failover UI (Screen 7) + degraded-mode speech + in-app events | P0 | 7 | BL-009, BL-014, BL-015 | Runtime failover already specified on LLM; this ships the operator config surface and event list. |
| BL-024 | FR-PRIV-1, FR-PRIV-2 | Data residency / privacy settings (Screen 8) + snapshot-at-session-start enforcement | P0 | 7 | BL-009, BL-014 | Default policy is created with the tenant; this screen is the operator control and publish gate. |
| BL-025 | FR-CALL-4, FR-CALL-5 | Post-call summary (Screen 11): transcript, optional LLM summary, feedback, bound token | P0 | 7 | BL-012, BL-014, BL-020 | Completes the 11-screen inventory; feedback is the only end-user write path. |
| BL-026 | — | Billing, invoices, usage marketplace | P2 | — | — | Locked non-goal; do not implement. |
| BL-027 | — | Public self-serve signup / customer marketplace | P2 | — | — | Tenants are operator-managed; contradicts FR-AUTH-3. |
| BL-028 | — | GPU autoscaler implementation (scale up/down) | P2 | — | BL-022 | Screen 6 remains monitoring-only in v1. |
| BL-029 | — | White-label branding / per-tenant conversation theming | P2 | — | — | Functional WCAG client only in v1. |
| BL-030 | FR-ALERT-4 | Email / PagerDuty alert destinations | P2 | — | BL-023 | In-app `AlertEvent` is enough for v1. |
| BL-031 | FR-PRIV-1 | Recording capture pipeline | P2 | — | BL-024 | Flag + default-off only; warn in UI if enabled. |
| BL-032 | FR-TENANT-5 | Schema-per-tenant (or DB-per-tenant) isolation | P2 | — | — | Named alternative; v1 is row-level only. |

## Phase map

| Phase | Theme | Items | Exit condition |
|---|---|---|---|
| 1 | Platform skeleton + tenancy + admin auth | BL-001–BL-004 | Operator can seed, sign in, create/list/pause tenants. |
| 2 | Provider registry + deployment config + Agent Builder | BL-005–BL-009 | Example A and B YAML publish; secrets rejected; probes stored. |
| 3 | LiveKit transport + token issuer + screens 9–10 | BL-010–BL-012 | End user completes preflight, joins a room, mutes, ends (agent may be stub). |
| 4 | STT + remote LLM + TTS loop + captions | BL-013–BL-017 | Full listen→think→speak loop with captions and hop rows; failover/residency honored. |
| 5 | bitHuman avatar adapter | BL-018 | Example A: avatar video driven by Fish Speech over LiveKit. |
| 6 | Alibaba LiveAvatar adapter | BL-019 | Example B: second `IAvatarProvider` completes a live call (config only). |
| 7 | Logs, dashboard, GPU, alerts, residency, post-call | BL-020–BL-025 | All 11 screens live; latency visible; post-call summary + feedback. |

**P2 items (BL-026–BL-032) are not scheduled in any v1 phase.**

## Suggested next slice for `nexus-dev`

Start **Phase 1** (BL-001 → BL-004). Architecture may impose control-plane vs. schema prerequisites inside that phase; do not reorder Phase 2 ahead of a working tenant+auth spine.
