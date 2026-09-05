# ADR-0019 — Progressive rollout: where a canary binds, how the split resolver works, and how shadow evaluation runs without side effects

**Status:** Accepted · 2026-08-31
**Context refs:** FR-AGT-04, FR-AGT-05, FR-AGT-09/10, FR-OC-06, NFR-2, NFR-4/4a, BL-48 (Phase 17), BL-13
(never built), ADR-0017 (emergency rollback — unchanged, and depended upon), ADR-0004 (egress choke
point), ADR-0005 (approval tiers), ADR-0006/ADR-0011 (model gateway, data locality), ADR-0013 §7
(durable-executor placement precedent), HLD §12/§15.9, LLD §3.10, §7.4, §9.1, §15
**Decision owner:** Architecture phase (targeted correction/scoping dispatch, pre-Phase-17)
**Supersedes:** nothing. **Amends:** LLD §7.4 step 4 and LLD §9.1's sequence line (both factually
wrong about the current build — see §2 below). ADR-0017 is untouched and is a hard dependency.

---

## 1. Context — the premise Phase 17 was scheduled against does not exist

Phase 17 (BL-48) is written as "traffic-split canary on channel-to-version binding, and shadow
evaluation of a candidate version against live traffic with no customer exposure." Read naturally,
that is an *extension* of an existing canary system. Pre-dispatch verification against the working
tree on 2026-08-31 found no such system. This is the third doc-vs-reality gap this initiative has
found (after the capability-group HLD/LLD conflict and ADR-0013 §7's `apps/runtime`/BullMQ premise),
and it is recorded here in the same style: original text preserved, corrected in place, with the
concrete evidence.

| Claim in the docs | Actual state of the repository (verified 2026-08-31) |
|---|---|
| LLD §7.4 step 4: "resolve agent version via Deployment traffic split (weighted, sticky per conversationId hash so a conversation never flips versions mid-thread)" | No weighted resolver exists. The live path is `apps/gateway/src/lib/turn-pipeline-adapter.ts:115` — `const activeVersion = previewVersionId ? undefined : await findActiveAgentDefinitionVersion(ctx);`. No weighting, no stickiness, no channel, no agent-definition parameter. |
| LLD §9.1 sequence: `RT->>RT: resolve version (traffic split, sticky), create agent_run + span` | Same. Also `apps/runtime` (the `RT` participant) does not exist as a running process at all — already corrected by ADR-0013 §7; the live turn runs in `apps/gateway`. |
| implied: version resolution is per agent definition | `findActiveAgentDefinitionVersion(ctx)` (`agent-definition-repository.ts:235`) takes **only** a `TenantContext`. It returns the most recently promoted `Production` version **across all of the tenant's agent definitions**. Its own doc comment discloses this and states the limitation honestly: it is "a reasonable 'single active version' default for a tenant that has exactly one bot in production, which is the only configuration this build's Admin Console can actually produce." |
| implied: a channel selects which agent answers it | `channel.agent_definition_version_id` exists (migration `0010_channels.sql:19`) and is **read and written by nothing** — zero references in `packages/modules/channels`, zero in any live path, zero outside the Drizzle schema declaration itself. Its inline comment ("no FK to `agent_definition_version` yet — that table doesn't exist until Phase 10") is stale by many phases. It is vestigial. |
| implied: multiple active deployments at partial percentages are a thing | The `deployment` table's schema **is** correct — `traffic_split_pct`, `is_active`, and a real DB trigger `enforce_deployment_traffic_split_invariant()` (migration `0016`) enforcing `SUM(traffic_split_pct)=100` across active rows per `(tenant, agent_definition, environment)`. But `createInitialProductionDeployment()` is the only writer, its own doc comment discloses that "full canary/traffic-split editing … is BL-13's unbuilt Deployment & Canary Manager", and every promotion deactivates the prior row and inserts exactly one 100% row. **No code path has ever produced two simultaneously-active partial-percentage rows.** |
| implied: a Deployment & Canary Manager screen exists | It does not. There is no `/deployments` console route, no `GET/PUT /api/v1/admin/deployments`, and no `POST /api/v1/admin/deployments/promote-canary` (LLD §5.9 lists both as design intent only). The `deployment_action` enum already contains `SplitChange` and `PromoteCanary`; no code ever writes either value. |

**What is real and load-bearing, and which Phase 17 builds on rather than replaces:**

- `emergencyRollbackRepoint()` (ADR-0017, Phase 0/BL-27) — QA-approved, advisory-lock-serialized,
  transactional-outbox-audited. Its `UPDATE … WHERE is_active = true` matches *all* active rows, so
  it already collapses an N-row canary to a single 100% row correctly, with no code change.
- The trace tree (Phase 6) and `agent_run` / `agent_run_span` / OTel spans — real per-version run
  attribution, which is what makes canary-vs-stable and shadow-vs-live comparison possible at all.
- `EgressPort` (ADR-0004) as the single, structurally-enforced route out of `orchestration`.
- The `knowledge_ingestion_job` / `workflow.run-pump` durable work-table pattern (ADR-0013 §7).

**What fails is only the premise, not the goal.** Phase 17 is therefore larger than "add shadow
evaluation": it must first build the routing concept the platform has never had.

## 2. Decision

### 2.1 A canary binds to `(tenant, agent_definition, environment)` — not to a channel

BL-48's phrase "channel-to-version binding" is the outlier in this project's own documents, and it
is rejected as the binding unit for the traffic split. The binding unit is
`(tenant_id, agent_definition_id, environment)`, because:

1. **The spec already says so.** FR-AGT-04/05: "**Per agent/environment**, admins configure active
   version and optional traffic split across versions (e.g. 90/10 canary)". Channels appear nowhere
   in it.
2. **The shipped schema already says so.** `deployment` is keyed on exactly that triple; the
   `SUM=100` DB trigger is scoped to exactly that triple; the advisory-lock key that serializes
   promotion *and* emergency rollback is `hashtext("<tenant>:<agent>:<environment>")`. Binding a
   canary to a channel would make the shipped invariant meaningless (what does "100%" sum over?)
   and would silently desynchronize emergency rollback's lock key from the thing it must roll back.
3. **A per-channel version split is not a coherent product concept here.** Per-channel *rendering*
   degradation (FR-OC-06, `channel_capability`) is real and shipped. Per-channel *behavioral
   divergence of the same agent* is not something any FR asks for, and would multiply the canary
   surface by the channel count with no requirement behind it.

### 2.2 But the channel→agent-definition binding is real, missing, and in scope

The traffic-split resolver structurally requires an `agentDefinitionId`, and **today there is no way
to obtain one for a live turn** — which is the actual, deeper defect the BL-48 phrasing was groping
at. The resolution chain must therefore gain its missing first hop:

> **channel → agent definition** (which bot answers here) **→ deployment traffic split** → **version**
> (which build of that bot serves this conversation).

Together these two halves *are* "channel-to-version binding" — correctly factored into the part that
belongs on the channel (identity of the bot) and the part that belongs on the deployment (rollout
state of that bot). Concretely:

- `channel.agent_definition_version_id` is **dropped** (proven unused; keeping a vestigial column
  that looks like it does this job is worse than removing it).
- `channel.agent_definition_id uuid NULL REFERENCES agent_definition(id)` is added, editable from
  the existing channel admin screen.
- **Backfill preserves today's behavior exactly**: for each tenant with exactly one
  `agent_definition`, every channel is backfilled to it. Ambiguous tenants are left NULL.
- **NULL is a supported state, not an error.** A channel with no binding falls back to the existing
  tenant-wide `findActiveAgentDefinitionVersion()` lookup, which is retained (renamed
  `findActiveAgentDefinitionVersionTenantWideFallback`, its disclosure comment updated, **not
  deleted**) so no existing tenant, fixture, or test regresses.

### 2.3 The traffic-split resolver: deterministic-hash weighted selection, with stickiness that can never outlive an active deployment

New: `resolveTurnAgentVersion(ctx, { conversationId, agentDefinitionId, environment })` in
`agent-platform`. `agent-platform` may not depend on `conversations` or `channels` (LLD §14.1's
allow-list), so the composition root (`apps/gateway`) resolves `channelId → agentDefinitionId` and
passes ids down; the resolver never reads a `channel` or `conversation` row.

1. `previewVersionId` (sandbox preview) still short-circuits everything — unchanged.
2. Look up the sticky assignment for `(tenant, conversation, agent_definition)`.
3. **If an assignment exists and its `deployment` row is still `is_active`, use it.** If the
   assignment exists but its deployment is no longer active, **discard it and re-resolve.** This
   rule is not a detail — it is what keeps ADR-0017 true. Promotion, split change, rollback and
   emergency rollback all deactivate rows, so every one of them takes effect on the *next turn* of
   every in-flight conversation, inside the same NFR-2 <5 s bound. A stickiness that survived
   deactivation would silently make canary rollback ineffective for exactly the conversations that
   are experiencing the bad version.
4. Otherwise select weighted over the active deployments for the triple, **deterministically**:
   `bucket = sha256(conversationId + ":" + agentDefinitionId) mod 10000`, then walk the active rows
   ordered by `deployment.id` accumulating `traffic_split_pct * 100` until `bucket <` cumulative.
   Deterministic rather than `Math.random()` so the choice is reproducible in tests, re-derivable if
   the assignment row is lost, and stable per conversation independent of storage.
5. Persist the assignment (`ON CONFLICT … DO UPDATE`), then return the version.
6. Zero active deployments → `null`, i.e. today's honest "no agent run to trace yet" behavior,
   unchanged.

**No Redis routing cache.** LLD §3.10's `deploy:route:<tenant>:<agent>:<env>` cache (TTL 5 s +
pub-sub bust) is explicitly **deferred, not implemented, in Phase 17**. One indexed single-row
`SELECT` per turn is negligible beside a model call, and a 5 s TTL cache is in direct tension with
NFR-2's 5 s rollback bound — it would consume the entire budget before the repoint was even visible.
If a cache is ever added it must be bust-on-write, not TTL-only.

### 2.4 A version must pass the ordinary promotion gate before it may receive *any* canary traffic

Canary is **not** a second route to production. `setTrafficSplit` requires every allocated version to
already hold `status = 'Production'` for that agent definition — i.e. it went through
`canPromote(Approved → Production)` (eval green, reviewer ≠ author, sandbox test recorded, graph type
installed) exactly as a 100% promotion does. Starting a 90/10 canary is therefore "promote the
candidate through the existing gate, then allocate it 10%", never "put an Approved version in front
of 10% of customers without the gate." This keeps ADR-0017's core claim — *nothing reaches production
traffic that has not passed* — literally true after Phase 17, and it means Phase 17 introduces **no
new gate-bypass surface at all**.

### 2.5 Shadow evaluation runs asynchronously, off the customer request path, with a non-executing egress port

Requirement: run a candidate version against real live traffic, capture its output/cost/latency/
tool-calls for comparison, and never let it answer a customer or cause a real side effect.

**Rejected — synchronous dual-run** (fire both in the turn, return only the primary's answer). It
puts a second full model round-trip inside the customer's request, doubling the NFR-2 latency
exposure and the failure surface of the live path; it consumes two `tenant_runtime_quota` concurrent
slots per turn (NFR-4/4a), so enabling an experiment can 429 real customers; and a shadow bug becomes
a live-path bug. Rejected outright.

**Chosen — asynchronous replay from a durable work table**, drained by `apps/worker`, following the
`knowledge_ingestion_job` / `workflow.run-pump` claim-lease-reclaim pattern that ADR-0013 §7
established as this codebase's durable-executor idiom:

1. When a live turn completes, the composition root — in the same best-effort, never-mask-the-
   customer-reply `try/catch` idiom already used for `triggerEscalation` and `recordSandboxTest` —
   enqueues a `shadow_run` row if an active `shadow_evaluation` exists for this
   `(tenant, agent_definition, environment)` and the sampling roll passes.
2. The row stores **pointers, not a transcript copy**: `live_agent_run_id`, `conversation_id`,
   `live_message_id`, `candidate_version_id`. The replay re-reads the conversation's messages up to
   that sequence. This is deliberate: duplicating customer text into a new table would create a new
   PII sink requiring its own retention-purge and DSR-cascade rules. Pointers create none.
3. `apps/worker` job `deployment.shadow-run-pump` (5 s, `FOR UPDATE SKIP LOCKED` + lease +
   attempt counter) and `deployment.shadow-lease-reaper` (60 s) execute the replay.
4. The replay calls the **same** `runTurnPipeline`, with a new additive
   `executionMode: "Live" | "Shadow"` input (default `"Live"`; every existing caller unchanged).
   Reusing the real pipeline is the point — a shadow run that took a different code path would not
   be evidence about anything.

**The four side-effect containments, each structural rather than by convention:**

| Side effect | Containment |
|---|---|
| Real MCP tool execution (writes to customer/backend systems) | The worker injects `createShadowEgressPort()` instead of `createMcpEgressPort()`. `EgressPort` is the *only* route out of `orchestration` (ADR-0004's choke point, enforced by the existing dependency-cruiser rule), so the shadow turn **physically cannot** reach an MCP server. The shadow port still validates the invocation against the tool's input schema — so a candidate that would have called a tool with bad arguments is still caught — and returns a synthetic `ShadowNotExecuted` result. |
| Approval-queue pollution / customer confirmation cards | `runTierEngine` gains a `ShadowSuppressed` outcome for Tier-2/3 in shadow mode: it records the tier it *would* have required and creates **no** `tool_call` row and **no** `approval_request`. This is deliberately a new, distinct outcome rather than reusing the existing `PolicyDenied{reason: no_conversation_context}` shortcut, because "the candidate wanted a Tier-3 call" is exactly the finding a reviewer needs, and mislabelling it a denial would hide it. |
| A customer seeing the shadow reply, or a shadow escalation landing in the queue | Automatic by call site: the worker never calls `insertMessage`, never publishes to the SSE channel, and never calls `triggerEscalation`. The shadow turn's `escalationSignal` is captured on the `shadow_run` row as data. Guardrail evaluation still runs, but `recordGuardrailEvent` is suppressed in shadow mode (the outcome is stored on `shadow_run` instead) so the Guardrail analytics screen is not polluted by traffic no customer ever saw. |
| Analytics/cost double-counting | `agent_run.trigger` gains `ShadowEvaluation`. **Phase 17 must exhaustively enumerate every existing reader of `agent_run` and exclude shadow runs** — per-version rollups (FR-AGT-09/10), the Runtime Traces list, cost dashboards, continuous eval. A single enum value with an audited consumer list is preferred over adding a redundant `is_shadow` boolean that could disagree with `trigger`. |

**Quota and budget.** Shadow runs claim a concurrency slot like any other run, but the pump enforces
its own per-tenant shadow ceiling and treats `QuotaExceededError` as *defer to the next tick*, never
as a failure — a shadow experiment must never be able to 429 a real customer. Shadow inference is
**real spend and is charged and attributed normally** through the Model Gateway against
`model_budget`; hiding it would be dishonest about the price of the experiment. `shadow_evaluation`
carries `sample_pct`, `max_runs` and `max_cost_usd` ceilings that auto-stop the experiment.

**Shadow results are evidence, never a gate.** A good shadow report does not promote anything, does
not satisfy the sandbox-test-before-promote gate, and does not shorten `canPromote`. Promotion
remains §2.4's path.

### 2.6 Data locality (mandatory statement, Nexus §2)

A shadow run sends real customer conversation content to a model provider **a second time**. This is
a genuine, deliberate security decision and is stated here rather than left implicit:

- The candidate version resolves its models through the **same** Model Gateway route machinery with
  the **same** residency and plan-tier governance (Phase 2, ADR-0006/ADR-0011). A shadow run can
  therefore never reach a provider or region the live run could not.
- Shadow evaluation is **off by default**, configured per agent definition, and enabling/disabling it
  is an RBAC-gated (`deployments` Write, same level as promotion — no new privilege ladder, per
  ADR-0017 §2.2's reasoning) and audit-logged action via the transactional outbox.
- No customer content is copied into new tables (§2.5 item 2), so retention purge and DSR cascade
  need no new targets beyond `shadow_run`'s own conversation-scoped cleanup.

### 2.7 How much of BL-13 Phase 17 must build

Phase 17's own exit gate ("a canary rollout can be emergency-rolled-back using Phase 0's mechanism
within the same latency bound") is only meaningful if a canary rollout is a real, buildable thing.
The minimum honest slice of BL-13 that Phase 17 must therefore deliver:

**In scope (Phase 17 builds it):**
- `setTrafficSplit()` — the first multi-row-active writer. One transaction, the **same**
  `pg_advisory_xact_lock(hashtext("<tenant>:<agent>:<env>"))` key as promotion and emergency rollback
  (non-negotiable: that shared key is what makes the three mutually exclusive), deactivate-all then
  insert-the-new-set, `SUM=100` validated in the domain *and* left to the existing `0016` trigger as
  the backstop, one `deployment_history` row with the already-existing `SplitChange` action, plus a
  `domain_event` outbox row in the same transaction.
- `promoteCanary()` — collapse to 100% for one allocated version; `deployment_history.action =
  'PromoteCanary'` (already in the enum). FR-AGT-04's "Promote canary to 100%".
- The resolver of §2.3, wired into **both** live entry points (widget and WhatsApp inbound).
- `channel.agent_definition_id` (§2.2) plus its admin edit surface and backfill.
- A Deployments & Canary panel on the agent-definition detail screen: current allocations, split
  editor, rollout history timeline, and per-version live metrics (run count, error rate, p50/p95
  latency, cost) read from the existing `agent_run` data.
- Shadow evaluation end to end (§2.5) plus its comparison view.

**Out of scope (explicitly not Phase 17's job):**
- A separate top-level "Deployment Manager" console area. The panel lives on the agent-definition
  detail screen where promotion already lives.
- Any new rollback action. Emergency rollback (Phase 0) already collapses an N-row canary correctly;
  Phase 17 adds a **test proving it**, not code.
- Automatic/metric-triggered canary progression ("auto-promote at 10%→50% if error rate < x"). A
  human decides. Auto-rollout is a separate future decision and must not be smuggled in.
- Staging/Sandbox rollout workflows beyond keeping `environment` a parameter (the column exists;
  only `Production` has a live resolver consumer).
- The Redis routing cache (§2.3).

## 3. Alternatives considered

**Bind the canary to the channel, literally as BL-48 words it.** Rejected — §2.1. It contradicts
FR-AGT-04's own wording, makes the shipped `SUM(traffic_split_pct)=100` trigger meaningless, and
desynchronizes the advisory-lock key that emergency rollback depends on. §2.2 preserves everything
useful in the phrase without any of that damage.

**Keep the tenant-wide `findActiveAgentDefinitionVersion` as the only resolution and split versions
within it.** Rejected: it cannot express which of two agent definitions answers a given channel, so
the moment a tenant has two bots the split is ambiguous and the "most recently promoted across all
definitions" heuristic actively picks the wrong bot. Retained only as the NULL-binding fallback.

**Random (non-deterministic) weighted selection with a stored assignment.** Rejected — §2.3 item 4.
Determinism costs nothing and buys reproducible tests plus a correct re-derivation when the
assignment row is absent.

**Sticky assignment that survives deployment deactivation** ("a conversation keeps its version until
it ends"). Rejected, and this is the most consequential rejection in this ADR: it would make
emergency rollback ineffective for in-flight conversations — the exact population being harmed by the
bad version — while appearing to succeed. Stickiness is bounded by the deployment's own lifetime.

**Synchronous dual-run shadow.** Rejected — §2.5.

**Shadow with a read-only/dry-run *tool* mode inside the MCP client** (let the shadow call real
servers but only "safe" tools). Rejected: it requires the platform to correctly classify every tool
in every tenant's registry as read-only, forever, including third-party MCP servers whose semantics
it cannot inspect. One misclassification is a real write against a real customer system. The
non-executing egress port needs no such classification to be correct.

**Replay onto a copied/forked conversation instead of the real one.** Rejected: it duplicates
customer content (a new PII sink and DSR/retention target) to buy isolation that the shadow egress
port and the call-site containments already provide for free.

## 4. Consequences

**Positive.**
- The platform gains, for the first time, a real answer to "which agent, and which version of it,
  answers this channel" — a gap that BL-48's premise assumed away and that would have blocked any
  honest canary.
- Emergency rollback (ADR-0017) becomes strictly more valuable and is unchanged: §2.3's stickiness
  rule makes it correct for N-row canaries too, and Phase 17 proves that by test rather than by
  assertion.
- No new gate-bypass surface (§2.4) and no new privilege ladder (§2.6).
- Shadow evaluation's containment rests on ADR-0004's existing structural choke point, not on
  reviewer discipline — the same "construct the property so nothing can vary" approach this project
  adopted after the Platform Manager console saga.

**Negative / accepted costs.**
- Shadow evaluation costs real money and real provider round-trips on real customer data. Mitigated
  by off-by-default, sampling, hard `max_runs`/`max_cost_usd` ceilings, unchanged residency
  governance, and explicit cost reporting — but the cost is real and the tenant must see it.
- Every existing `agent_run` aggregate must be audited for shadow exclusion (§2.5). Missing one is a
  silent analytics corruption, not a crash. This is called out as the single highest-risk item in the
  phase and belongs in QA's elevated-rigor list.
- A dropped column (`channel.agent_definition_version_id`) and a backfill. Both are safe here only
  *because* the column is provably unused; the ADR records the proof so the removal is not
  re-litigated later.
- `shadow_run` replays read historical messages, so a conversation purged by retention/DSR between
  enqueue and replay yields a shadow run that cannot execute. That must terminate the row as
  `Skipped(SourceGone)`, never as an error and never by resurrecting purged content.

## 5. Consequences for the LLD

Written as LLD §15 (new), and correcting §7.4 step 4 and §9.1 in place:
- `deployment_traffic_assignment` table (sticky assignment), `shadow_evaluation` and `shadow_run`
  tables, `channel.agent_definition_id`, the `run_trigger += 'ShadowEvaluation'` enum extension.
- The resolver algorithm and its exact ordering/hash rule.
- `setTrafficSplit` / `promoteCanary` transaction shape and their shared advisory-lock key.
- The `executionMode` input, the `ShadowSuppressed` tier outcome, and the shadow egress port.
- API contracts for `/api/v1/admin/deployments*` and `/api/v1/admin/shadow-evaluations*`.
- The `agent_run` reader audit list.

## 6. Verification

1. **Split invariant:** a 90/10 split writes two active rows; a 90/20 attempt is rejected by domain
   validation *and*, with validation bypassed, by the `0016` trigger.
2. **Concurrency:** a `setTrafficSplit`, a promotion, and an `emergencyRollbackRepoint` racing on the
   same `(tenant, agent, environment)` leave exactly one consistent active set summing to 100 —
   reusing the existing advisory-lock regression test's shape.
3. **Weighting:** over ≥10 000 distinct conversation ids, a 90/10 split lands within a tight band of
   90/10; the same conversation id always resolves to the same version for a fixed active set.
4. **Stickiness:** a conversation's second turn resolves to the same version as its first while the
   deployment stays active — and to the **new** version on the first turn after any deactivation.
5. **Exit gate (Phase 17's own):** an emergency rollback against a live 2-row canary collapses it to
   one 100% row and the *next* turn of an already-assigned conversation serves the rolled-back
   version, all within the NFR-2 <5 s bound, measured as the existing rollback timing test measures.
6. **Shadow — no execution:** a candidate whose turn selects a Tier-1 write tool produces a
   `shadow_run` recording the intended call, with **zero** MCP egress (asserted against a real MCP
   test server that records every request it receives) and zero `tool_call` rows.
7. **Shadow — no queue pollution:** a candidate that would make a Tier-3 call produces
   `ShadowSuppressed` with the tier recorded, and **zero** `approval_request` rows.
8. **Shadow — no customer exposure:** no `message` row, no SSE publish, no `escalation` row is
   created by any shadow run, asserted end to end through the real widget flow.
9. **Shadow — analytics exclusion:** with a shadow experiment running, every per-version rollup,
   trace list, and cost figure is byte-identical to the same query with the experiment disabled.
10. **Fallback preservation:** a channel with `agent_definition_id IS NULL` resolves exactly as the
    pre-Phase-17 build did, proven against the existing widget/WhatsApp integration suites unchanged.
11. **Purge safety:** a `shadow_run` whose source conversation was purged terminates `Skipped`.
