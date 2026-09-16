# SHJ3 — Requirements Baseline (index)

> Status: **Validated, extended** · Last updated: 2026-09-16
> Functional baseline: [`../SHJ3-wireframes-guide.md`](../SHJ3-wireframes-guide.md) (17 screens, 1011 lines).
> Binding architecture: [`../architecture.md`](../architecture.md) and [`../adr/`](../adr/).
> Supersedes the single-file `../requirements.md`, which now redirects here.

This folder is the requirements baseline for SHJ3 — an agentic government-services assistant for the Emirate of Sharjah, plus the backoffice that builds, governs and operates it. It converts the screen-by-screen wireframe specification into numbered, testable requirements, **plus every requirement added after the wireframe baseline was validated** — most significantly the Pipeline Designer (see [`orchestration.md`](./orchestration.md) §5.5.2).

**It is the single upstream artefact for every later phase.** `../data-model.md`, `../api.md`, `../testing.md` and the user-guide entries all trace to the IDs assigned here. `../testing.md` builds its traceability matrix from these IDs; a requirement with no passing test is an incomplete requirement.

## Why this is a folder, not one file

The original `requirements.md` grew to 754 lines covering 17 modules plus cross-module invariants, non-functional requirements, tenant isolation and risks in one document. Splitting by module keeps each module's requirements reviewable on their own, keeps diffs scoped to the module actually changing (the Pipeline Designer delivery touched only `orchestration.md`, not the other 16), and mirrors the real module boundaries already enforced in the codebase (`apps/web/src/modules/*`, `apps/ai`'s own module layout). The ID scheme, numbering and permanence rule are unchanged — an ID assigned in the old single file means exactly the same thing in its new home.

## 1. Purpose and how to use this document set

**It is the single upstream artefact for every later phase.** `../data-model.md`, `../api.md`, `../testing.md` and the user-guide entries all trace to the IDs assigned here. `../testing.md` builds its traceability matrix from these IDs; a requirement with no passing test is an incomplete requirement.

### 1.1 ID scheme

| Form | Meaning |
|---|---|
| `FR-<CODE>-<nn>` | Functional requirement |
| `NFR-<CODE>-<nn>` | Non-functional requirement |
| `RISK-<nnn>` | Risk or open question |

Functional codes: `PLAT` `IAM` `CONV` `AGENT` `ORCH` `TOOL` `KNOW` `FLOW` `HAND` `CHAN` `VERI` `PAY` `GOV` `EVAL` `ANLY` `THEME` `GUIDE`.
Non-functional codes: `SEC` `PERF` `A11Y` `I18N` `OBS` `DATA` `OPS`.

**IDs are permanent.** They are never reused, never renumbered and never recycled after deletion. A withdrawn requirement is marked *Withdrawn* in place, keeping its number burnt. This holds across the file split: every ID below was carried over unchanged from the single-file baseline, and new IDs (the Pipeline Designer's `FR-ORCH-15` onward) are appended after the last existing number in their code, never inserted between existing ones.

### 1.2 Conventions

- **Requirement statements** are written as "the system shall …" and are testable as written. Vague quality adjectives are not requirements.
- **Source** cites the wireframe screen and tab (`B6 tab 4`), the wireframe section (`§6`), an ADR (`ADR-0002`), or — for requirements added after the wireframe baseline — the delivery that added them (`Pipeline Designer delivery`).
- **Priority** is `MUST` (release-blocking), `SHOULD` (release-degrading if absent), `COULD` (deferrable without harm).
- **[ASSUMPTION]** marks a decision taken where the wireframe is silent or self-contradictory. The decision is stated and binding; it is not an open question. Where the wireframe genuinely contradicts itself, the contradiction is named and resolved in [`risks.md`](./risks.md).
- Every `[rule]` annotation in the wireframe guide is represented as at least one `MUST` requirement. Those annotations are the encoded business rules and are the highest-value test targets.

### 1.3 Reading order for implementers

[`tenant-isolation.md`](./tenant-isolation.md) first — it constrains every other requirement. Then the module file you are building, then [`cross-module.md`](./cross-module.md) for the invariants your module shares with its neighbours.

## 2. Scope

### 2.1 In scope

| Area | Content |
|---|---|
| Citizen assistant | Web widget (docked / expanded) embedded in the Sharjah portal; WhatsApp channel with channel-native rendering; voice input; human handover (A1–A3) |
| Backoffice | 14 wireframe screens: command centre, agent registry, agent designer wizard, orchestrator, tools & MCP registry, Graph RAG knowledge, flow designer, human agent workspace, IAM, channels, identity & transactions, guardrails, evaluation, governance & ops (B1–B14) — **plus the Pipeline Designer**, a delivery-added editor under `/orchestrator/pipelines` (see [`orchestration.md`](./orchestration.md)) |
| Multi-tenancy | Schema-per-tenant SQL Server, database-per-tenant Neo4j (logically partitioned per ADR-0009), collection-per-tenant Qdrant, key-prefix-per-tenant Redis; a tenant is a Sharjah government entity (ADR-0002) |
| Theming | In-product theming/skinning module, runtime tokens, named skins, JSON export/import, WCAG-gated save (Phase E, ADR-0007) |
| User guide | In-product guide module, one entry per page, searchable, deep-linkable, EN/AR (Phase F) |
| Deployment | Docker, Docker Compose, Kubernetes/Helm (ADR-0008) |
| Identity | Local staff accounts (Argon2id + TOTP) behind `IdentityProvider`; mock citizen verification behind `VerificationProvider` (ADR-0006) |
| Multi-agent orchestration | Three fixed execution modes (sequential/parallel/supervisor-worker) as the release-1 baseline, **superseded per-tenant by an arbitrary, versioned, loop-capable agent graph** (the Pipeline Designer) once a tenant activates one — see [`orchestration.md`](./orchestration.md) §5.5.2 |

### 2.2 Out of scope

| Item | Reason |
|---|---|
| CI/CD pipelines | Explicitly declined by the product owner (ADR-0008). Pre-commit hooks plus `pnpm verify` / `make verify` are the substitute. Tracked as RISK-002 |
| Bare VM / IIS / systemd deployment | Not selected (ADR-0008). Requires a new ADR |
| Live UAE PASS integration | Procurement dependency; the `VerificationProvider` port and mock adapter are in scope, the real adapter is not (ADR-0006, RISK-004) |
| Staff SSO (Entra ID / Keycloak) | Deferred by decision; the `IdentityProvider` port is in scope, the OIDC adapter is not (ADR-0006) |
| A third deployable | Forbidden without a superseding ADR (ADR-0001) |
| Alembic / any second SQL migration tool | Prisma is the sole schema owner (ADR-0005) |
| `shj3-web` direct access to Neo4j or Qdrant | Forbidden by ADR-0003; enforced by NetworkPolicy |
| Rebuilding the wireframe's visual language | The prototype's muted palette is deliberately low-fidelity (guide §1.3, §7.2). The production look comes from the design system, not from the prototype |
| Phase-2 legacy `RouterConfigs` column drop (`executionMode`, `agentSelectionScope`, `agentScopeListJson`, `maxLoopIterations`, `conflictResolution`, `responseMergePolicy`, `routingStrategy`, `minRoutingConfidence`) | Deliberately deferred to a later, separate wave after a release has passed with `activePipelineVersionId` in use, so `apps/ai` and `apps/web` stay independently deployable through the transition (see [`orchestration.md`](./orchestration.md) §5.5.2) |

### 2.3 Explicitly deferred (backlog)

The wireframe's §8 "Known gaps" are deliberate exclusions. Each is classified below. Two of the eight are **not** deferred, because later mandates cover them.

| Gap (guide §8) | Disposition | Rationale |
|---|---|---|
| Ontology designer | **Deferred** | The graph explorer browses entity *instances* (B6 tab 2); defining entity and relationship *types* is a separate authoring surface. The five entity types and four relationship types are fixed for this release (FR-KNOW-06), which is sufficient for the seeded journeys |
| Prompt / instruction library | **Deferred** | Reusable prompt templates with A/B variants and version history. The per-agent system prompt (B3 step 2) plus agent versioning (FR-AGENT-02) covers the release need; a shared library is an optimisation |
| Cost & quota management | **Partially deferred** | Per-call token and cost accounting against tenant, agent and conversation is **in scope and mandatory** (FR-ORCH-08, ADR-0004 rule 5) because retrofitting it is expensive and B4's cost ceilings cannot be enforced without it. The *management UI* — budgets, throttles, per-entity spend reporting — is deferred |
| Notifications & alerting | **Partially deferred** | The supervisor alert on the wait-time routing rule is in scope (FR-HAND-19) because the wireframe encodes it. A general subscription/notification system — who is told when a breaker trips or a suite fails — is deferred |
| Kiosk / IVR rendering | **Partially deferred** | Kiosk/IVR remains configurable as a channel (FR-CHAN-01) and Emirates ID scan remains a configurable verification method for it (FR-VERI-01). The rendered kiosk and IVR surfaces are deferred; the channel ships `Disabled` |
| Arabic RTL rendering of the assistant UI | **NOT deferred** | Phase E mandates LTR/RTL as a first-class theming control tied to language selection, and ADR-0007 lint-bans physical direction properties. The wireframe's gap is closed by FR-THEME-08, NFR-I18N-02 and NFR-I18N-04 |
| Bulk operations | **Deferred** | No multi-select on users, sources or rules. Single-record operations satisfy every wireframe rule; bulk is throughput, not capability |
| Empty and error states | **NOT deferred** | The wireframe assumes populated lists. Production cannot. Empty, loading, error and permission-denied states are a design-system deliverable for every list, table and canvas (FR-THEME-02 token compliance, NFR-A11Y-07) |

### 2.4 Sample data is illustrative, not content

Everything in the wireframe guide that looks like content is **sample data chosen to make behaviour legible** (guide §1.3). It is a fixture specification, not a content requirement.

| Category | Examples in the guide | Status |
|---|---|---|
| People | Sara Al Mazrouei, Omar Khan, Priya Nair, Ahmed Saeed, Lina Haddad, Ahmed R., Fatima S., Yousef M., Mariam A., Hassan T. | Fictional. Seed fixtures only |
| Figures | 1,284 conversations, 78% containment, AED 0.23/kWh, 4,210 sends, p95 240 ms | Illustrative. The p95 figures are adopted as **performance targets** in [`non-functional.md`](./non-functional.md) §7.2 — that is the one deliberate exception |
| Transcripts | The "Pay Utilities Bills → SEWA → account number → i have another inquiry" journey | Illustrative *as text*, **normative as a journey**. It is the canonical end-to-end path (architecture §8) and the reference case for E2E tests |
| Endpoints and identifiers | `mcp://sharjah-services.internal`, `https://api.sewa.ae/v1/bills/{account}`, `+971 800 7342`, `TXN-88213`, `#SC-88213` | Placeholders. Real endpoints, numbers and credentials come from configuration, never from this document |
| Model names | `claude-sonnet-5`, `claude-haiku-4.5`, `text-embedding-3-large`, `multilingual-e5` | Seeded defaults. Model identity is configuration (ADR-0004 rule 2) |
| Entities | SEWA, Sharjah Customs, Sharjah Libraries, Platform | **Normative as tenants** — these four are the seeded tenant set (ADR-0002) |

**Requirement on fixtures:** the seed set must be deterministic, because Phase D's E2E tests depend on a known starting state and the wireframe's cross-module wiring only demonstrates correctly from one (FR-PLAT-10, ADR-0008).

## 3. Actors and personas

Nine actors. Seven are backoffice roles from B9 tab 3; two are external.

| Actor | Type | Tenant scope | What they do | Permissions (B9 tab 3) |
|---|---|---|---|---|
| **Citizen / resident** | External, unauthenticated by default | None — bound to a channel session | Asks questions, follows suggested flows, uses free-text escape, supplies an account number, initiates a payment, rates answers, requests a human | No backoffice permission. Assurance level L0–L3 (FR-VERI-06) |
| **Super Admin** | Staff | All tenants (Platform) | Everything, including the two audited cross-tenant escape hatches: tenant provisioning and analytics rollups | All 8 |
| **Entity Admin** | Staff | One tenant | Publishes agents, manages knowledge and routing rules for their entity — including the Pipeline Designer (`orchestration:manage`). Cannot manage users or handle escalations | View dashboard, Manage agents, Publish agents, Manage knowledge, Manage routing rules, View analytics |
| **Agent Designer** | Staff | One tenant | Authors agents through the 10-step wizard. **Cannot publish** — separation of duties (B9 `[rule]`) | View dashboard, Manage agents |
| **Knowledge Manager** | Staff | One tenant | Adds and re-crawls sources, merges duplicate entities, resolves source conflicts, tunes retrieval | View dashboard, Manage knowledge |
| **Reviewer** | Staff | One tenant | Reads analytics and evaluation results; approves nothing by default | View dashboard, View analytics |
| **Live Agent** | Staff | One tenant | Sets presence, picks up escalated tickets, uses canned replies, resolves conversations. **No dashboard access** | Handle escalations |
| **Analyst** | Staff | One tenant | Reads dashboards and analytics; no build or operate rights | View dashboard, View analytics |
| **Supervisor** | Staff (derived) | One tenant | Receives the alert raised by the wait-time routing rule and re-prioritises the queue. **[ASSUMPTION]** The wireframe names "supervisor alert" (B8 rule 4) but seeds no supervisor role; a supervisor is an Entity Admin or a Live Agent holding a custom role with `Handle escalations` plus queue-management rights, created via *+ Add custom role* (FR-IAM-10) |

**Note on the human agent.** The wireframe treats "Live Agent" (the B9 role) and "the live human agent who receives a handover" (A3, B8) as the same person. They are. `Handle escalations` is the permission that makes a staff account eligible for the queue, and presence (FR-HAND-01) is what makes them available in it.

**Note on custom roles.** The 7-role set is the seeded baseline, not a closed enumeration. B9 tab 3 permits new roles with all permissions off, so authorisation logic must be driven by the permission set on the `Principal`, never by a role-name comparison (FR-IAM-12).

**Note on the Pipeline Designer's permission.** No new permission was added for it. `orchestration:manage` (already seeded for `Super Admin`/`Entity Admin`) governs the Pipeline Designer the same way it governs the legacy execution-mode panel — see [`orchestration.md`](./orchestration.md) §5.5.2's permission note for why a build/release split was considered and rejected.

## 4. Source-brief traceability

Every requirement in the original brief (`shj3.docx`, as recorded in guide §2.1) maps to at least one requirement in this set. Nothing from the brief is dropped.

| # | Requirement in `shj3.docx` | Wireframe evidence | Requirements |
|---|---|---|---|
| **R1** | "Imagine the Backoffice to build AI assistant agentic" | 10-step wizard; 4 agents with lifecycle controls (B2, B3) | [`agents.md`](./agents.md) FR-AGENT-01 … FR-AGENT-21; and, as the wider backoffice, all of [`orchestration.md`](./orchestration.md), [`tools.md`](./tools.md), [`knowledge.md`](./knowledge.md), [`flows.md`](./flows.md), [`handover.md`](./handover.md), [`channels.md`](./channels.md), [`governance.md`](./governance.md), [`evaluation.md`](./evaluation.md), [`analytics.md`](./analytics.md) |
| **R2** | "Don't consider digital Sharjah, make use any name it SHJ3" | Brand applied throughout; assistant identifies as "SHJ3 Assistant" (all screens) | [`theming.md`](./theming.md) FR-THEME-04, [`conversation.md`](./conversation.md) FR-CONV-03, FR-CONV-05, [`channels.md`](./channels.md) FR-CHAN-06 |
| **R3** | "Suggested flows is dynamic and also can be free text" | Condition node for free-text escape; conversation step 4 (A2, B7) | [`flows.md`](./flows.md) FR-FLOW-01 … FR-FLOW-09, especially FR-FLOW-07 (escape at every node) and FR-FLOW-09 (context preserved); [`conversation.md`](./conversation.md) FR-CONV-03, [`orchestration.md`](./orchestration.md) FR-ORCH-13 |
| **R4** | "Integrations for this will use MCP, API" | MCP registry with tool discovery; API connector builder (B3 step 4, B5) | [`tools.md`](./tools.md) FR-TOOL-03 … FR-TOOL-12, especially FR-TOOL-07 (registered ≠ callable) and FR-TOOL-11 (connector becomes a skill) |
| **R5** | "Multiple agents (tools, skills) can be assigned for one prompt" | Sequential, Parallel, Supervisor–worker with distinct traces (B4) — **superseded in delivery by the Pipeline Designer's arbitrary agent graph, which subsumes and generalises this requirement rather than replacing it** | [`orchestration.md`](./orchestration.md) FR-ORCH-01 … FR-ORCH-14 (the three fixed modes, still the release-1 default and the `activePipelineVersionId IS NULL` fallback path); FR-ORCH-15 … FR-ORCH-30 (the Pipeline Designer) |
| **R6** | "System must have graph RAG as knowledgebase" | Sources, entity graph, hybrid retrieval, conflict resolution (B6) | [`knowledge.md`](./knowledge.md) FR-KNOW-01 … FR-KNOW-26 |
| **R7** | "Include agent designer (like wizard to build agents)" | 10 steps, freely navigable, state persists (B3) | [`agents.md`](./agents.md) FR-AGENT-08 … FR-AGENT-18 |
| **R8** | "This assistant can be on web, WhatsApp, …" | Native WhatsApp rendering; 4 channels configurable (A1, B10) | [`channels.md`](./channels.md) FR-CHAN-01 … FR-CHAN-23, especially FR-CHAN-20 (channel-native rendering); [`conversation.md`](./conversation.md) FR-CONV-01 |

### 4.1 Reference-screenshot traceability

The five annotated screenshots in the brief (guide §2.2) drove the assistant UI. Each reproduced element maps to a requirement.

| Element in the brief's screenshots | Requirement |
|---|---|
| Header with sparkle icon, minimise (–), expand (⧉) | [`conversation.md`](./conversation.md) FR-CONV-01 |
| Grey disclaimer banner with × dismiss | FR-CONV-02 |
| Greeting bubble with five suggestion chips | FR-CONV-03 |
| The five specific chips (Pay SEWA Bills · Pay Utilities Bills · Sharjah Custom Services · Emirate of Sharjah Libraries · Jawaher Centre Booking) | FR-CONV-03 (as configurable Quick Actions, not hardcoded copy) |
| Right-aligned user bubbles, left-aligned assistant bubbles | FR-CONV-06, [`theming.md`](./theming.md) FR-THEME-08 (mirrored under RTL) |
| Per-message speaker (TTS), thumbs up, thumbs down, timestamps | FR-CONV-04, FR-CONV-12 |
| "Still Thinking…" processing state | FR-CONV-10 |
| Composer placeholder with mic | FR-CONV-05, FR-CONV-09 |
| Portal chrome — Home / Services / Support / About, عربي, Login | Out of scope — the host portal supplies its own chrome. The widget is embeddable inside it ([`channels.md`](./channels.md) FR-CHAN-08, FR-CHAN-09) |

## 5. Module index

Grouped by the 18 modules of the module map (17 wireframe modules plus the Pipeline Designer sub-module of `orchestration`). Priority: `MUST` release-blocking, `SHOULD` release-degrading, `COULD` deferrable without harm.

| § | Module | File | Scope |
|---|---|---|---|
| 5.1 | `platform` | [`platform.md`](./platform.md) | Tenancy substrate, provisioning, configuration |
| 5.2 | `iam` | [`iam.md`](./iam.md) | Users, teams, roles, sessions (B9) |
| 5.3 | `conversation` | [`conversation.md`](./conversation.md) | Assistant surface, turns, transcripts (A1, A2, A3) |
| 5.4 | `agents` | [`agents.md`](./agents.md) | Registry, versions, lifecycle, wizard (B2, B3) |
| 5.5 | `orchestration` | [`orchestration.md`](./orchestration.md) | Router, execution modes, traces (B4) — **and the Pipeline Designer** (§5.5.2, delivery-added) |
| 5.6 | `tools` | [`tools.md`](./tools.md) | Skills, MCP servers, API connectors, resilience (B3 step 4, B5) |
| 5.7 | `knowledge` | [`knowledge.md`](./knowledge.md) | Graph RAG (B6) |
| 5.8 | `flows` | [`flows.md`](./flows.md) | Flow designer and runtime (B7) |
| 5.9 | `handover` | [`handover.md`](./handover.md) | Escalation queue, routing rules, live agent workspace (B8) |
| 5.10 | `channels` | [`channels.md`](./channels.md) | Channels, widget studio, WhatsApp, campaigns, locales (B10, A1) |
| 5.11 | `verification` | [`verification.md`](./verification.md) | Providers, step-up, identity stitching (B11 tabs 1, 2, 5) |
| 5.12 | `payments` | [`payments.md`](./payments.md) | Gateways, transactions, receipts, refunds (B11 tabs 3, 4) |
| 5.13 | `governance` | [`governance.md`](./governance.md) | Policies, overrides, environments, audit, privacy (B12, B14) |
| 5.14 | `evaluation` | [`evaluation.md`](./evaluation.md) | Golden sets, regression runs, publish gate (B13) |
| 5.15 | `analytics` | [`analytics.md`](./analytics.md) | Command centre, explorer, feedback loop (B1) |
| 5.16 | `theming` | [`theming.md`](./theming.md) | In-product theming and skinning (Phase E, ADR-0007) |
| 5.17 | `userguide` | [`userguide.md`](./userguide.md) | In-product user guide (Phase F) |

Cross-cutting sets, not owned by one module:

| § | Set | File |
|---|---|---|
| 6 | Cross-module integration requirements | [`cross-module.md`](./cross-module.md) |
| 7 | Non-functional requirements (`SEC` `PERF` `A11Y` `I18N` `OBS` `DATA` `OPS`) | [`non-functional.md`](./non-functional.md) |
| 8 | Tenant isolation requirements | [`tenant-isolation.md`](./tenant-isolation.md) |
| 9 | Risks and open questions | [`risks.md`](./risks.md) |
| 10 | Glossary | [`glossary.md`](./glossary.md) |
