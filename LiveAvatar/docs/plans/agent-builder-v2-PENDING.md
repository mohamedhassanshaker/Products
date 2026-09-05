# Agent Builder v2 — What's Pending

Snapshot as of 2026-09-04 (updated after Phase 16 landed — **the roadmap is complete**). Companion to `docs/plans/agent-builder-v2-plan.md` (the full phase-by-phase build record) — this file now tracks only the standing cross-cutting debt and post-roadmap follow-up; there are no more phases.

---

## 1. Phases — all 16 done

| Phase | Status | Scope |
|---|---|---|
| 8 – Tools registry | ✅ Done | — |
| 9 – Reasoning graph engine v1 | ✅ Done | — |
| 10 – Latency governance v1 | ✅ Done | — |
| 11 – Parallel & Loop | ✅ Done | — |
| 12a – RAG ingestion | ✅ Done | — |
| 12b – RAG retrieval + Knowledge tab | ✅ Done | — |
| 13 – Skills | ✅ Done | — |
| 14 – HITL v1 | ✅ Done | `HitlGate`/`HitlDecision`/`ReviewerGroup` models, blocking-gate pause/resume in the interpreter, HITL config screen, Reviewer console (separate top-level route), caller-side hold UX, deferred-approval async queue + new `NotificationPort` (in-app + email), consequential-tool gating wired live (V-6/V-7/V-8), Skills' stubbed HITL-completeness check made real. See `agent-builder-v2-plan.md`'s Phase 14 section for the full record — note that the "in progress / five research passes" line this row previously carried was inaccurate (verified at the time: zero HITL code existed anywhere in the repo); Phase 14 was executed start-to-finish in this pass. |
| 15 – Sub-agent, Handoff, State | ✅ Done | All 13 A3.2 node types now exist. Sub-agent delegates one bounded LLM turn to another tenant's published persona (nesting ≤2, V-3), Handoff records intent via the existing Alerts mechanism (new `AlertType: handoff_requested`, no real telephony transfer), State reads/writes an in-memory session-scoped variable. See `agent-builder-v2-plan.md`'s Phase 15 section for the full record — also closed the Phase-14-flagged cross-language contract fixture-corpus gap. |
| 16 – Builder consolidation | ✅ Done | All 9 tabs (Overview/Pipeline/Reasoning/Skills/Tools/Knowledge/Dynamics/HITL/Privacy) now live under one shell at `tenants/:id/builder`, replacing the old v1 single-page builder and every standalone route Phases 8–15 built. New `dynamics` config block (schema + Python mirror, no runtime wiring yet — see debt list). V-11's sum fixed to include tool `args_schema`; V-5's `on_deadline` runtime and V-12 confirmed already complete from Phases 10/13 (the architecture doc's table was stale, not the code). See `agent-builder-v2-plan.md`'s Phase 16 section for the full record. |

**Exit condition for the whole roadmap** (per `docs/v2/BACKLOG.md`): all 13 node types exist ✅, full 9-tab builder live ✅ (the shell's own nickname says "8-tab" but actually ships 9 — see Phase 16's "Decisions made this phase" #1), all V-1..V-12 enforced somewhere in the product ✅. **The Agent Builder v2 roadmap (Phases 8–16) is complete.**

---

## 2. Cross-cutting technical debt — the standing platform backlog

Carried forward across phases, each still open as of the end of Phase 16 (the roadmap's last phase — no future phase will pick these up automatically; they're now ordinary platform backlog):

- **Router condition grammar only supports flat field names**, not dotted `state.<key>` access (found Phase 9). Loop's `condition` field inherits the same limit (it reuses the identical grammar). Not on any phase's critical path so far — revisit if a future phase's condition needs dotted addressing.
- **No per-node latency-estimate overrides** — the turn-budget panel's costs are code constants, not admin-editable. Worth reconsidering if product feedback shows admins want to tune individual node estimates.
- **Parallel node's per-branch cost in the inspector is a client-side estimate**, not a live backend-computed number — no endpoint exists for it; out of scope when built, still open.
- **Loop's guard upper bounds** (`max_iterations: 1000`, `max_duration_ms: 60000`, `max_cost: 100000`, added as Phase 11's own security-review hardening) are a reasonable first pass, not data-driven.
- **V-9's "published-path skill" carve-out** — confirmed during Phase 14: still open. The staleness-warning rule still treats every live Retrieve-node reference as needing the warning; Phase 13's "published-path skill" concept was never wired into this specific rule (the rule remains structured for a localized change, not a redesign).
- **Embedding is single-model/single-dimension** (`text-embedding-3-small`, 1536) by design — the pgvector column width is fixed table-wide; a second embedding model needs either a second vector column or a migration.
- **`ai-embedding` compose service has no real autoscaling/production sizing** and no Kubernetes manifests (the rest of `apps/agent` has a `k8s/` Deployment/Service pair; this new second process doesn't yet).
- **No rate limiting anywhere** on admin-triggered/costly routes — a platform-wide gap that recurred in every phase's security review (`/embed`, `/reindex`, `/internal/knowledge/*`, `/internal/skills/*`, `/tenants/:id/hitl/*` and `/internal/hitl-decisions*` as of Phase 14, `/internal/tenants/:id/subagent-persona` as of Phase 15). Never blocking, always flagged, never fixed across all 16 phases.
- **Skills: no nested sub-graph per skill** — v1 always runs a plain LLM turn with the skill's tools/instructions attached, not the "or a nested sub-graph" half of §3.2's design allowance. Sub-agent (Phase 15) makes the identical simplification for the same reason.
- **Skills: no model-decided dynamic trigger dispatch** — v1's Skill node is always reached via deterministic graph wiring (a Router branch or a plain edge), not a live LLM tool-call-style selection from descriptions (the other half of R-S2).
- **No skill-version-history list endpoint** — the DB stores full immutable version history, but the Reasoning tab's Skill node inspector can only offer `"latest"` or the currently-published version, not a picker over every historical version.
- **A real, disclosed NestJS architecture finding, confirmed broader than originally documented**: every admin-JWT-guarded controller reachable from `SessionsModule`'s import graph also gets mapped onto the internal (`:8081`) listener (pre-existing, extended by Phase 13's `SkillsController`, Phase 14's `HitlController`, and Phase 15's confirmation that `DeploymentConfigController`/`KnowledgePlaygroundController` were already there too via `SessionsModule → DeploymentConfigModule`). Still guard-protected throughout, not an auth hole, but worth a dedicated cleanup pass (restructure `SessionsModule` to import only ports/repositories, not whole feature modules with controllers) before that internal listener is ever exposed more broadly. Never addressed across all 16 phases — the single largest standing architecture cleanup item this roadmap leaves behind.
- **Admin bundle over its initial-load size budget**, tracked every phase since Phase 12b and fixed by none of them (21.14 kB over as of Phase 13, ~36 kB over as of Phase 15/16 — Phase 16's own new tab components all land in already-lazy chunks, not the initial bundle, so the consolidation itself didn't worsen this, but never fixed it either). Needs a dedicated lazy-loading-boundary pass across the whole admin app.
- **HITL `escalate` timeout behavior has no dedicated wider-review queue UI** (Phase 14) — the SLA sweep notifies the escalation `ReviewerGroup` and marks the decision `escalated` (terminal, leaves the `pending` queue), but there is no surface for that wider group to still act on it beyond the notification. Revisit if product feedback wants a real escalation queue.
- **No dedicated "list only tenants with a published config" endpoint for the Sub-agent picker** (Phase 15) — the picker shows every tenant; V-3's own Gate-B check (existence/self-reference/nesting) is the real enforcement at save time, so an admin can pick an invalid target and only find out on save. Reconsider if this proves annoying in practice.
- **Sub-agent v1 is one bounded LLM turn, not a nested graph invocation** (Phase 15, same simplification as Skills) — a full nested-interpreter delegation (its own node-id namespace, its own budget accounting one level down) remains a real, larger, un-built feature.
- **Dynamics fields (barge-in/endpointing/verbosity/no-input/call limits) have zero runtime wiring** (Phase 16) — an admin can configure all five today and none of it affects a live call yet; endpoint detection remains a hardcoded LiveKit-VAD default, there is no caller-interrupt/barge-in handling anywhere in `apps/agent`. Wiring real behavior is a genuinely new, unscoped body of work, not a small follow-up.
- **No Playwright/Cypress e2e/visual-regression harness exists for the admin app** (surfaced concretely in Phase 16, but true throughout the roadmap) — `UX_SCOPE.md`'s explicit ask to verify the tab shell at 375/414/768px could only be done structurally (code-reading), not with a real browser.
- **The Phase 16 tab shell's ARIA wiring is not fully APG-correct** — `mat-tab-group` is used as a router-driven label strip rather than with its own content projection, which is what makes every tab independently deep-linkable, but a purpose-built `mat-tab-nav-bar`/`mat-tab-nav-panel` pairing would be more precise tab↔tabpanel semantics. A documented, accepted trade-off, not a defect, but worth revisiting if an accessibility audit flags it.
- **Overview's base-prompt cost estimate is client-side only** (Phase 16) — no server-side cost-breakdown endpoint exists; it reuses the same "~4 bytes/token" heuristic `prompt-cost.ts`'s real backend estimator uses, computed a second time in the browser, labeled as an estimate in the UI.
- **Three long-standing pre-existing test failures**, unrelated to this roadmap, re-confirmed unchanged through the end of Phase 16: a `providers` module TS spec drift (`assertEndpointUrl` signature, `apps/api`), a masked always-false assertion in `apps/agent/tests/contracts/test_runtime_config.py`, and `apps/api`'s `providers/infrastructure/http-probe-strategy.spec.ts`'s "classifies a 404 as unreachable" case (first observed during Phase 14). None of these are this roadmap's to fix, but whoever picks up this codebase next should know they predate — and outlived — all 16 phases.

## 3. Explicitly deferred (P2) — permanently out of this roadmap's v1 scope

Per `docs/v2/BACKLOG.md`'s "Deferred" table — not bugs, not forgotten, tracked on purpose as future backlog items (`BL-066`–`BL-080`):

- Real multi-environment (dev/staging/production) config isolation — `environments[]` fields stay UI-only labels until this lands.
- Speculative retrieval on partial transcript; speculative/pre-synthesised speech.
- `best_of` join policy (judge-node pattern) for Parallel.
- True cross-encoder reranking; semantic/heading-aware chunking; crawl-type knowledge sources; PDF source parsing.
- Skills "Extract from prompt" AI-assist; platform-library skill publish/cross-tenant adopt flow.
- Supervisor whisper console; post-hoc HITL review queue; SMS/telephony notification channel for deferred approvals.
- Config version diff view + rollback UI ("Compare to v12", Overview's Diff button) — the backend capability (`ConfigVersion`, list/diff/rollback use-cases) already shipped in Phase 9; only the UI is deferred.
- True drag-and-drop graph canvas (replacing the structured node-card list).
- Sub-agent inline persona authoring (a full node-inspector UI for designing a sub-agent in place, vs. Phase 15's "delegate to an already-published agent" scope).

## 4. Post-roadmap follow-up (agreed with the user, now unblocked)

- **Full e2e regression** (whole admin + conversation app, not just v2 features) and a **Word (.docx) user guide with screenshots for every screen in both apps** — was explicitly deferred until all 16 phases were done, confirmed twice with the user. **That condition is now met (Phase 16 landed 2026-09-04)** — this item is unblocked, not yet started. See the memory note `project_v2_e2e_and_userguide` for the full agreed scope and approach; raise it with the user rather than starting unprompted, since it's a substantial separate undertaking (whole-app regression + a screenshot-driven document deliverable), not a continuation of this roadmap's own phase work.
