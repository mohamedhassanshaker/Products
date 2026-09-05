# Agent Builder v2 — UX Scope

Per-tab scope decisions for the 8-tab builder redesign specified in `docs/v2/AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md` §A9. Written for `nexus-ux`/`nexus-dev` when each phase in `docs/v2/BACKLOG.md` actually starts building — follows the exact per-screen template `docs/design/UX_GUIDELINES.md` already uses (User flow / Screen states / IA / Accessibility / Heuristics / Responsive / Error messaging), opening each tab with a **Scope decision** box in the style of `UX_GUIDELINES.md` §10.1, so the same "what's in vs. deferred" discipline that kept v1's Agent Builder from over-building applies here too. When a phase ships, its section here should be folded into `UX_GUIDELINES.md` as a new numbered section (continuing past its current §18), exactly like every other phase — this file is a staging area, not a permanent second UX doc.

Today's Agent Builder is one single-page screen (`apps/web/projects/admin/src/app/features/agent-builder/pages/agent-builder-page/`) with dropdowns, a system-prompt textarea, a memory toggle, an RAG enable-toggle + free-text field, and read-only tool display — no tabs, no canvas, no test-call, no diff view. Every scope decision below is written against that starting point.

**Shared components to reuse across tabs, not rebuild per tab** (establish these once, in the earliest phase that needs them, per `docs/v2/ARCHITECTURE_NOTES.md`):
- The `AgentBuilderStore` NgRx SignalStore + 400ms debounced `validate` pattern (`agent-builder.store.ts`) — every new tab's draft state merges the same way `patchDraft()` does today.
- A single **budget-bar** component — used by the turn-budget panel (Phase 10) and the retrieval-pipeline budget total (Phase 12b); build it once in Phase 10.
- A single **Test-call harness** component — used by Reasoning (Phase 9), Skills editor (Phase 13), and Knowledge playground (Phase 12b); build it once in Phase 9 against the shared backend endpoint (`docs/v2/BACKLOG.md` BL-037).
- The existing "show-disabled-with-reason rather than hide" pattern (`UX_GUIDELINES.md` §10.5's greyed provider options) — reused for HITL's Whisper/Post-hoc gate types and any other "coming later" affordance below, instead of silently omitting the option.

---

## Tools tab (new — Phase 8)

### Scope decision
**In scope:** full CRUD table (create/edit/delete a `ToolDefinition`), test-invoke action, attach/detach to "always available" (agent-level), base-prompt token-cost banner (mirrors the existing system-prompt byte counter pattern). **Stubbed:** the consequential-tool banner (A6.2's bottom section) renders and flags tools marked `consequential`, but shows "Gating not available yet — coming in a later phase" instead of blocking publish, since HITL gates don't exist until Phase 14. **Deferred:** nothing else — this tab has no reuse dependency on later phases.

### User flow
1. New top-level "Tools" route/tab, replacing the read-only "{n} tools enabled" line in today's builder (`UX_GUIDELINES.md` §10.6) — that line becomes a link into this tab once it exists (§10.10 already flags this transition).
2. List view: table of tenant tools (name, method+URL, lane, consequential flag, attach status). "+ New tool" opens a create form (name, HTTP method/URL, credential ref, args schema, timeout, per-session/per-turn caps).
3. "Test" action on any row invokes the tool with a sample payload and shows raw response — reuses the same test-harness backend as Phase 9's Test-call feature where possible, or a lighter single-call variant if the harness isn't ready yet.
4. Attach/detach toggles which tools are "always available" (agent-level, base-prompt cost) vs. dormant (only reachable via a skill/graph node once those exist).

### Screen/component states
Same state vocabulary as today's builder (loading/empty/invalid/valid/conflict/save-in-flight) — reuse `agent-builder.store.ts`'s pattern rather than inventing a new one for this tab.

### Information architecture
New tab in the (still-single-page-until-Phase-16) builder nav; until the 8-tab shell (Phase 16) exists, this can ship as a second route reached the same way Residency/Alerts are reached today (separate route, not yet unified under one shell).

### Accessibility
Table follows the existing `mat-table` + `aria-describedby` field-error pattern used elsewhere in the admin app; token-cost banner is `aria-live="polite"`, coalesced (same rule as the system-prompt byte counter, §10.7 precedent).

### Relevant heuristics
Visibility of system status (token-cost banner updates live); error prevention (consequential tools flagged even before gating exists, so nothing ships silently unflagged).

### Responsive
Table collapses to stacked cards below the project's existing breakpoint (reuse the pattern already fixed for the Sessions table after its phone-layout defect history — do not reintroduce that bug class in a new table).

### Error/validation messaging
New codes needed: `TOOL_NAME_REQUIRED`, `TOOL_URL_INVALID`, `TOOL_CREDENTIAL_MISSING` (mirrors `CONFIG_CREDENTIAL_MISSING`'s inline-with-link pattern) — exact wording to be finalized when the phase starts, following the existing "verbatim UI sentence, precise placement" table format from `UX_GUIDELINES.md` §10.9.

---

## Reasoning tab (new — Phase 9, extended Phases 10, 11, 15)

### Scope decision
**In scope (Phase 9):** a **structured node-card list**, not a drag-and-drop canvas — each node is a card (type icon, name, est. latency, lane) in an "Add node ▾" ordered/branching list; Router branches render as indented sub-lists rather than canvas fan-out. A modal/side-panel inspector carries A3.7's field content (not its visual layout). This gets every node type's config surface and validation without a layout/connection-drawing engine. **Extended (Phase 10):** turn-budget sub-panel inline in the tab. **Extended (Phase 11):** Parallel/Loop inspector cards in the same list pattern. **Extended (Phase 15):** Sub-agent/Handoff/State cards. **Deferred:** true drag-and-drop canvas with free-form positioning/edge-drawing/zoom-pan (`docs/v2/BACKLOG.md` BL-079) — real UI investment with no functional payoff over the list form; revisit only if the list proves unreadable past ~15 nodes in practice. Parallel node's "Timing preview" gantt bar (A3.7) — show the numbers in a table row instead of a bar chart in v1.

### User flow
1. Tab shows the node list, defaulting to a single LLM node for a fresh/minimal agent (R-G1 — the builder ships the simple case as the default).
2. "Add node ▾" inserts a card at a chosen position; clicking a card opens its inspector (lane, budget, type-specific fields, `on_error`/`on_deadline` edges).
3. Router node's branches render as an indented tree under the card; each branch target is itself a node reference into the same list.
4. Save/validate reuses the existing debounced-validate flow; new inline errors surface per-node (mirrors the existing per-layer inline-error pattern from §10.3, extended from "layer" to "node id").
5. "Run test call" (Phase 9's shared harness) executes the graph against a sample utterance and shows node-by-node results inline or in a side panel.

### Screen/component states
Extends the existing vocabulary with a node-level state: each card shows its own last-test status (not-run / pass / fail) once the harness exists (Phase 9). Loading/empty/invalid/valid/conflict states otherwise identical to today's builder.

### Information architecture
Reasoning becomes the builder's primary tab (replaces today's LLM dropdown section). Until Phase 16's shell, reached as its own route.

### Accessibility
Node cards are a `role="list"`/`role="listitem"` structure (not a bare `<div>` grid) so screen readers get correct list semantics; the inspector is an APG dialog/panel matching the existing Reload-confirm dialog pattern (§10.7 precedent — reuse, don't reinvent). Router's indented branches use proper nested-list markup, not visual indentation alone.

### Relevant heuristics
Visibility of system status (per-node test status, live validation); error prevention (Publish structurally blocked while any node fails a V-rule, same disabled-with-tooltip pattern as today's Publish button); recognition over recall (node type icons consistent across every surface that shows a graph — this tab, session detail's node trace, the test-harness output).

### Responsive
Below the project's two-column breakpoint, the node list and inspector follow the same tab-based fallback pattern as today's Configuration/Preview split (§10.4) rather than inventing a new responsive strategy.

### Error/validation messaging
New per-node codes needed for V-2 (loop guards), V-4 (cycle detection), V-5 (`on_error`/`on_deadline` presence) — each attaches to the specific node card, never only a global banner, following the existing non-negotiable "inline at the specific field" rule (§10.3's explicit requirement, carried forward).

---

## Knowledge tab (new — Phases 12a "Sources" sub-tab, 12b "Pipeline"/"Playground" sub-tabs)

### Scope decision
**In scope (12a):** per-source ingestion config form (parser, chunk strategy — fixed-size only, size/overlap, embed model) + re-index button with a coarse cost/duration estimate, replacing today's RAG enable-toggle + free-text `index_ref` field entirely. **In scope (12b):** Pipeline sub-tab — the six-stage retrieval form (A7.4) with per-stage budget and a running total vs. retrieval budget, reusing the budget-bar component built in Phase 10 (don't build a second one); Playground sub-tab — query input + stage-by-stage table output (A7.5), reusing the Phase 9 test-harness endpoint. **Deferred:** "Save as eval case" and "Compare to v12" buttons (`docs/v2/BACKLOG.md` BL-078 — the latter needs config version diff UI, which is deferred even though the backend capability lands in Phase 9); semantic/heading-aware chunking options in the Sources form (BL-071 — form ships with "Fixed" pre-selected and the other options visibly present-but-disabled with a "coming soon" note, same pattern as HITL's gate types below); crawl-type source (BL-072 — "Upload" only in v1).

### User flow
1. Sources sub-tab: table of knowledge sources, "+ New source" opens the ingestion config form, "Re-index" shows the cost/duration estimate before confirming (same confirm-before-cost-action pattern as any other irreversible/costly operation in the admin app).
2. Pipeline sub-tab: six-stage form (rewrite/hybrid-search/filter/rerank-disabled/threshold/inject), each stage showing its estimated latency contribution against the shared budget-bar.
3. Playground sub-tab: free-text query + optional conversation-context field, "Run" shows each stage's output (candidates, scores, filtered/injected chunks) in the same stage-by-stage table format as A7.5's wireframe.

### Screen/component states
Sources: per-row staleness indicator (V-9) using the same warning-badge pattern as other "needs attention" rows elsewhere in the admin app. Pipeline/Playground: standard loading/running/result states, no new vocabulary needed.

### Information architecture
Three sub-tabs under one "Knowledge" tab (`mat-tab-group` nested one level, consistent with how today's builder already uses `mat-tab-group` for the <1280px Configuration/Preview fallback).

### Accessibility
Stage-by-stage playground table needs the same `aria-live="polite"` summary-only announcement rule as today's preview pane (§10.7 precedent) — do not re-announce the full result table on every run, only a summary ("3 chunks injected, 356ms").

### Relevant heuristics
Match between system and real world (playground shows the exact same pipeline stages an operator configured, in the same order); help & documentation (re-index cost estimate shown before commit, same as any destructive/costly action pattern elsewhere).

### Responsive
Sources table follows the same stacked-card fallback as the Tools tab; Pipeline form and Playground output are single-column below the breakpoint (too dense to usefully split, same reasoning as today's Configuration/Preview stacking rule).

### Error/validation messaging
New codes: `KNOWLEDGE_SOURCE_STALE` (V-9, warn unless referenced by a published-path skill), `KNOWLEDGE_PIPELINE_BUDGET_EXCEEDED` (V-10) — inline at the Pipeline tab's running-total line, not a global banner.

---

## Skills tab (new — Phase 13)

### Scope decision
**In scope:** Skills library (table view, tenant-scope only) + Skill editor (A5.5's fields: name, description with live token counter, triggering mode, instructions, tools/knowledge attachment, HITL gate fields shown-but-disabled until Phase 14, budget, environment toggles as UI-only labels per the multi-env descope) + base-prompt cost panel (reuses the Tools tab's token-cost component). Skill editor's embedded test panel reuses the Phase 9 shared Test-call harness component rather than rebuilding A5.5's mockup's own panel. **Deferred:** platform-library "adopt" flow (`docs/v2/BACKLOG.md` BL-074 — Skills library ships with only the tenant section, the "Platform library" section from A5.4's wireframe is omitted, not shown-disabled, since there's genuinely nothing behind it yet); "Extract from prompt" AI-assist button (BL-073 — omitted from the editor entirely for the same reason).

### User flow
1. Skills library: table (name, version, tools count, knowledge sources, HITL indicator, budget, used-by agents, 7-day trigger count). "+ New skill" opens the editor.
2. Editor: name/description (with the ~15-token live counter — this is the field that becomes the base-prompt cost, make that relationship visible in the UI copy, not just the number), triggering mode radio (model-decided vs. router-decided, with the same latency-tradeoff helper text A5.5 specifies), instructions textarea (same byte-counter pattern as the agent's system prompt), tools/knowledge attach panels (reuse Tools tab's attach-panel component), HITL section shown with a "configure gates in the HITL tab once published, Phase 14" note until that phase ships.
3. Test panel: reuses the shared harness — enter a sample utterance, see trigger decision + node-by-node result, same as Reasoning tab's test flow.
4. Publish creates a new immutable `SkillVersion`; a "used by N agents" warning shows before publishing an edit to an already-attached skill (mirrors the spirit of A5.3 UC-S2's "pinned-version warning tells the admin exactly which agents are affected").

### Screen/component states
Same debounced-validate/dirty/conflict vocabulary as the agent config editor — Skills gets its own draft/published status per version, reusing `agent-builder.store.ts`'s pattern rather than a new one.

### Information architecture
New top-level tab; Skill editor is a detail route off the library (`/admin/tenants/:id/skills/:skillId`), consistent with how other list→detail flows already work in the admin app (e.g. Sessions list → Session detail).

### Accessibility
Description token counter and instructions byte counter both `aria-live="polite"`, coalesced — same rule already established for the system-prompt counter (§10.7 precedent), applied consistently rather than reinvented per field.

### Relevant heuristics
Consistency & standards (skill editor reuses the exact counter/dirty/publish pattern from the main builder, so an admin already familiar with one understands the other immediately); recognition over recall ("used by N agents" is shown, not something the admin has to go check).

### Responsive
Editor form + test panel follow the same two-column/tab-fallback pattern as the main builder (§10.4).

### Error/validation messaging
New codes: `SKILL_DESCRIPTION_REQUIRED`, `SKILL_INSTRUCTIONS_REQUIRED`, `SKILL_TOOL_REF_UNKNOWN` (mirrors `CONFIG_CREDENTIAL_MISSING`'s inline pattern).

---

## HITL tab + Reviewer console (new — Phase 14)

### Scope decision
**In scope:** HITL config screen (A8.4) supporting **Blocking, Deferred, and Pre-speech gate types only** — the gate-type radio still lists all 5 options for forward-compatibility, but Whisper and Post-hoc render disabled with a "Coming soon" reason, following the exact greyed-option-with-reason pattern `UX_GUIDELINES.md` §10.5 already established for providers without credentials — never silently hidden. Reviewer console (A8.5): queue + detail panel, **minus** live audio ("🔊 listen") and caller-history enrichment (those need session/caller data plumbing beyond this doc's scope — ship without them, note as a fast-follow, don't stub a broken button for either). Caller-side hold UX (A8.7): both states (waiting, deferred outcome) — this is a conversation-SPA change, not an admin-app one. **Deferred:** Supervisor whisper console (`docs/v2/BACKLOG.md` BL-075) — entirely separate screen, not part of this phase at all, not even a disabled placeholder (it's a genuinely different real-time surface, not a variant of this tab).

### User flow
1. HITL tab: table of active gates (trigger, type, reviewers, SLA, 7-day hit/approval rate) + "+ Add gate" opens the config form.
2. Config form: trigger (tool/skill/graph-node picker + condition), gate type radio (3 enabled, 2 disabled-with-reason), reviewers + notification channels, SLA, hold-treatment text (entry/periodic/approved/denied), timeout behavior (with the `auto_approve` written-acknowledgement checkbox required per R-H2/V-8), reviewer permissions checkboxes.
3. **Reviewer console** is a separate top-level screen (not nested under the builder — reviewers are often a different persona than the tenant admin who configures gates), reached from its own nav entry once a tenant has ≥1 active gate. Queue shows pending items sorted by SLA-remaining; selecting one shows the detail panel (proposed action with editable fields, why-the-agent-proposed-this, transcript excerpt, approve/deny/edit-and-approve actions, timeout countdown).
4. Caller-side hold UX: agent's hold-treatment speech plays; a lightweight visual state ("Getting approval… usually takes under a minute", progress indicator) appears on the conversation SPA's call screen, matching A8.7's mockup content.

### Screen/component states
Gate list: same table pattern as Tools. Config form: standard debounced-validate. Reviewer console: **real-time-ish** via the same short-poll mechanism the backend uses for decision delivery (§6.2 of `ARCHITECTURE_NOTES.md`) — the queue re-fetches on an interval; no websocket needed for v1.

### Information architecture
HITL tab lives in the builder (gate configuration is a config-authoring task); Reviewer console is a separate top-level route/nav item (an operational task, performed by reviewers who may not be builder admins) — do not conflate the two into one screen.

### Accessibility
Reviewer console's countdown timer is `aria-live="polite"`, announced only at meaningful thresholds (not every second — same coalescing discipline as every other live region in this app); approve/deny/edit-and-approve buttons are clearly labeled with the action's consequence in the accessible name (not just icon buttons); the gate-type radio's disabled options carry an explicit reason in their accessible description, not just visual greying (§10.7 precedent).

### Relevant heuristics
Error prevention (writtenacknowledgement required before `auto_approve` can be selected — a deliberate friction point per R-H2, not a bug); visibility of system status (SLA countdown, live queue); help & documentation (disabled gate-type options explain what's missing, same as the disabled-Publish tooltip pattern).

### Responsive
Reviewer console's two-pane (queue + detail) layout follows the same ≥1280px-two-column/<1280px-tabbed-fallback rule as the main builder (§10.4) — this is now the third screen reusing that exact breakpoint rule, worth extracting into a shared layout pattern rather than re-implementing a third time.

### Error/validation messaging
New codes: `HITL_GATE_INCOMPLETE` (R-H1's six mandatory fields), `HITL_REVIEWER_COVERAGE_MISSING` (V-7), `HITL_AUTO_APPROVE_ACK_REQUIRED` (V-8) — all inline at the specific form field, following the established rule.

---

## Overview / Dynamics / Privacy tabs + 8-tab shell (Phase 16)

### Scope decision
**Overview:** read-only composition of the other 7 tabs' already-built state (Media Pipeline, Reasoning, Capabilities, Behaviour summary cards + right-rail budget/cost/validation) — no new logic, which is why it's sequenced last. **In scope:** all summary cards from A9.2 except the Diff button (needs BL-078, deferred — omit the button, don't show it disabled, since there's nothing behind it at all). **Dynamics:** plain new form (barge-in, endpointing, verbosity, no-input, call limits) — net-new fields with no A3–A8 dependency, follows the same field-pattern as the Tools attach form. **Privacy:** relabel/relocate the existing standalone Residency screen under the new tab shell — no new logic, a navigation change only. **Shell:** `mat-tab-group` wrapping all 8 tabs, replacing every standalone route (Tools/Reasoning/Knowledge/Skills/HITL/Dynamics/Privacy) built in earlier phases with a unified tabbed container — this is a routing/composition change, not new feature work, which is why the shell itself ships last even though sub-features exist earlier.

### User flow
Overview is the landing view when opening the builder; the right-rail always shows current turn-budget/cost/validation state regardless of which tab is active (persist across tab switches, don't recompute per tab).

### Screen/component states
Overview has no independent state — it renders whatever state the other tabs' stores already hold. Validation summary aggregates every tab's Gate A/B errors into one count.

### Information architecture
Tab order matches A9.1's table: Overview, Pipeline, Reasoning, Skills, Tools, Knowledge, Dynamics, HITL, Privacy — this becomes the canonical order once the shell ships.

### Accessibility
Standard APG tabs (`mat-tab-group` already used for the <1280px fallback today) — arrow-key navigation between all 8 tabs now, not just 2.

### Relevant heuristics
Recognition over recall (Overview surfaces everything in one place instead of requiring a click through 7 tabs to understand an agent's current state).

### Responsive
Below the breakpoint, tabs scroll horizontally rather than wrapping (standard `mat-tab-group` behavior) — verify this doesn't reintroduce the table/toolbar-overflow bug class this project has hit repeatedly; test explicitly at 375/414/768px before calling Phase 16 done.

### Error/validation messaging
No new codes — Overview aggregates existing ones from every other tab.
