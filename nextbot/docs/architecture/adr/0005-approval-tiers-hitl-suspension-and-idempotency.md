# ADR-0005 — Approval tiers, durable HITL suspension, and idempotency

**Status:** Accepted · 2026-08-15
**Context refs:** FR-MCP-05, FR-MCP-04, FR-AI-03 (write-retry rule), FR-ADM-04, FR-AGT-09, NFR-10, success metric "zero unauthorized tool executions"

## 1. Context

Every write tool call executes under Tier 1 (autonomous), Tier 2 (customer confirmation), or Tier 3
(human approval). Tier 3 pauses execution for an unbounded period. Three requirements make this the
most correctness-sensitive mechanism in the platform:

- A pending Tier-3 approval blocks **only that tool call**, not the conversation — the customer keeps
  chatting about other things (FR-MCP-05 concurrency rule).
- Duplicate approval actions (double-clicked "Approve") must execute the underlying call **at most
  once** (FR-MCP-05 idempotency rule).
- Write steps must never be blind-retried by the orchestration core (FR-AI-03).

And a business constraint: "zero unauthorized (un-permissioned or wrong-tier) tool executions" is
listed as a hard trust metric, not an optimisation target.

## 2. Decision

### 2.1 Tier resolution is snapshotted, not re-derived

The effective tier is computed once, at the moment the call is proposed, from the tool's configured
tier plus any `Require-Approval` outcome from the permission matrix (FR-MCP-04), and written onto the
`ToolCall` row (`approval_tier`). A later config change does not retroactively alter a pending call's
tier — an approver approves what they were shown. Escalating rules (a matrix rule that *raises* a
call to Tier 3) can only raise, never lower, the tool's configured tier.

### 2.2 Suspension is per tool call, at the run level, durably in Postgres

`ToolCall` is created in `status=Pending` **before** any dispatch, carrying `approval_status` and the
idempotency key. The run's own state moves to `awaiting_customer` (Tier 2) or `awaiting_approval`
(Tier 3), the ADK graph's checkpoint is serialised into the run record, and **the worker is
released** — a suspended run consumes a row, not a process. This is what makes 10 000 concurrent
conversations (NFR-3) affordable alongside multi-day approvals.

Because the conversation must stay usable while a Tier-3 call is pending, a conversation may have a
suspended tool call **and** an active run for a subsequent turn simultaneously. The unit of
suspension is the `ToolCall` + its checkpoint, not the conversation; the run record models a *turn*,
not the whole conversation lifetime.

### 2.3 Idempotency: server-issued key, claimed by unique constraint

The key is generated **server-side** by the Data Plane's tier engine, never supplied by a client or a
model, and is unique per proposed call. The Gateway's egress pipeline performs the claim as a
conditional state transition — `UPDATE tool_call SET status='Dispatching' WHERE id=$1 AND
status='Pending'` inside the same transaction that records the attempt — backed by a unique index on
`idempotency_key`. Zero rows updated means someone else already claimed it, and the second actor
returns the first actor's outcome rather than dispatching. The key is also forwarded to the MCP
server (as an `Idempotency-Key`-equivalent) where the tool declares support, giving end-to-end
at-most-once rather than merely at-most-once-from-NextBot.

Consequences of the "at most once, never blind retry" stance:

- Read-classified tools may be retried automatically by the runtime.
- Write-classified tools are retried **only** if the tool declares idempotency-key support or an
  admin has explicitly opted that tool in (FR-AI-03). Otherwise a failed write halts and follows the
  configured fallback (retry / skip / escalate / alternative tool).
- A dispatched-but-unknown-outcome call (timeout after send) is recorded as `Failed` with an explicit
  `outcome_unknown` flag and never auto-retried. Surfacing "we don't know" is correct; guessing is
  not.

### 2.4 Decision handling

Tier 2: the confirmation card carries the `toolCallId`. "Cancel" transitions the call to
`Rejected`/aborted with **no** backend mutation and resumes the run with a cancellation result.

Tier 3: the call enters the Approval Queue, itself an RBAC module (FR-ADM-04) — a user who can see
the connector cannot necessarily approve. Three actions:
`Approve` → claim + dispatch + resume; `Reject` → terminal, with the rejection reason relayed into
the conversation; `Request More Info` → the pending call is **retained** (not discarded) while a
follow-up question is injected into the conversation, and the call remains claimable once answered.

All three decisions are append-only records (NFR-10): a correction is a new compensating record, and
`UPDATE`/`DELETE` is revoked at the database grant level, not merely avoided in code (ADR-0001 §5).

### 2.5 Resume is idempotent

Resume is driven by the durable run state plus the decision record, so a duplicated resume message
(queue redelivery, double-click, operator retry) converges: the run's state transition is itself a
conditional update guarded by an optimistic-concurrency version column, and the tool dispatch behind
it is protected by §2.3. At-least-once queue delivery is therefore safe, which lets us use a
simple durable queue instead of an exactly-once one.

## 3. Alternatives considered

**Keep the graph in memory and hold the worker during approval.** Rejected outright: a multi-day
Tier-3 approval would pin a process, and any pod restart would lose the run.

**Client-supplied idempotency keys.** Rejected: the client (or a model) could reuse or forge a key,
turning an at-most-once guarantee into a replay vector.

**A distributed lock (Redis) for the claim.** Rejected as the primary mechanism: lock expiry under
a slow MCP call would permit a double dispatch. The database unique constraint plus conditional
transition has no such window. Redis is used for coordination hints only, never as the correctness
boundary.

**Suspend the whole conversation on Tier 3.** Rejected — directly contradicts FR-MCP-05's stated
concurrency behaviour.

## 4. Consequences

- The run record needs an explicit state enum, a serialised checkpoint blob, and a version column;
  the LLD must specify these and the legal transitions as a table, because implicit state machines
  are where this class of bug lives.
- The Trace Viewer and Runtime Observability (FR-AGT-09) list suspended runs with a Resume action,
  reading the same state — no parallel bookkeeping.
- Approval-queue latency becomes a product metric (escalation SLA), so pending-approval age is a
  first-class ClickHouse metric (ADR-0008).
- QA acceptance test, mandatory: fire N concurrent Approve requests for one `toolCallId` and assert
  exactly one MCP dispatch and N−1 idempotent no-ops.
