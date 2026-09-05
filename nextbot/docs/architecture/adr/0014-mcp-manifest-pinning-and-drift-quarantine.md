# ADR-0014 — MCP manifest pinning and drift-as-new-item quarantine

**Status:** Accepted · 2026-08-28
**Context refs:** FR-MCP-16, FR-MCP-18, FR-MCP-19, FR-MCP-20, FR-MCP-21, FR-MCP-01, FR-MCP-02,
FR-MCP-08, FR-ADM-03, FR-API-02, NFR-14, spec §6.1a (Module A), §9.5 invariants 1/2,
Blueprint §6.1/§6.4, HLD §15.7, ADR-0004
**Decision owner:** Architecture phase (second wave, Blueprint Modules A–F)

## 1. Context

An MCP server is a third-party program the tenant does not necessarily control, whose tool schemas
the platform hands directly to a model as callable capabilities. Today NextBot re-discovers tools
and diffs schemas (FR-MCP-01/02), but nothing **pins** the discovered surface, so a server that
changes a tool's input schema changes agent behavior in production with no review. The Blueprint
rates this severity 1 and states the threat plainly: an in-place schema update "is exactly the
vector by which a compromised or updated server escalates its own privileges" (§6.4).

The mechanism must also cope with three realities: schemas change for benign reasons constantly;
servers go offline for reasons unrelated to drift; and reconciliation runs on a schedule, so it must
be idempotent or it will generate an alert every cycle and be muted within a week.

## 2. Decision

### 2.1 Pin the contract, resolve the endpoint

Every enrolled server has an immutable `mcp_server_version` carrying a `manifest_hash` computed over
its discovered tools **and resources and prompts** (FR-MCP-20) at approval time. Each item is an
`mcp_manifest_item` row with its own `schema_hash`.

- The **contract** (which items exist, with which schemas, at which approval tier) is pinned to a
  server version.
- The **endpoint** (URL, credential, reachability) is resolved from the `mcp_environment_binding`
  for the current environment (FR-MCP-19: one logical server, Sandbox/Staging/Production bindings
  under one identity, superseding one-connector-row-per-environment).

An agent, skill, or workflow pins `server@definitionVersion` and remains reproducible after the live
server drifts (FR-MCP-21). Every agent version records the `server_version_id` it was validated and
sandbox-tested against.

**Hash canonicalization matters and is part of the decision, not an implementation detail.**
`schema_hash` is computed over a canonical form of the JSON Schema — keys sorted, whitespace
normalized, `default`/`title`/`description` included (they reach the model, so they are part of the
contract) but property *ordering* and non-semantic formatting excluded. `manifest_hash` is computed
over the sorted list of `(kind, name, schema_hash, io_class, approval_tier)` tuples. Without this,
a server that serializes its schema differently on each boot would look like perpetual drift.

### 2.2 Drift is a new item, never an in-place update

The reconciler (a scheduled job in `apps/worker`, per-server configurable schedule) re-fetches the
live manifest and compares. Its semantics:

| Observation | Result |
|---|---|
| A tool/resource/prompt appears that is not in the pinned manifest | Enrols as a **new item, `enabled = false`, Tier 3**, pending human review at `/mcp/servers/[id]/drift`. Never auto-enabled. |
| An already-approved item's input schema changed | Treated as an **entirely new item** with a new identity `(name, schema_hash)`, `enabled = false`, Tier 3. The previously-approved item row is **left intact and remains callable** by anything pinned to it. Not an update, not merely a notification. |
| An item disappears from the live manifest | Recorded as a drift event of kind `removed`; the pinned item stays in the manifest (pinned agents keep their contract) and calls to it will fail at the server, surfacing through the existing circuit breaker (FR-MCP-08). |
| The manifest hash is unchanged | **No row written, no alert.** Idempotent by construction (hash-compared, not re-alerted per cycle). |
| The server is unreachable | **Not drift.** A health-status transition to `Offline` (FR-MCP-01/08), logged separately. |

The identity change is the whole security property: because a changed schema is a *different item*,
nothing that was approved for the old shape is automatically approved for the new one. Privilege
cannot be escalated by mutating a schema, only by getting a human to approve a new item.

### 2.3 Drift is visible where it matters, and changes nothing until approved

A drift event on a version an agent has pinned surfaces as a **warning badge on that agent version's
detail page**, and as an outbound webhook event (`drift detected`, FR-API-02). It does **not** change
production behavior: the agent keeps calling the pinned-shape tool until a human re-approves the new
manifest, at which point a new `mcp_server_version` exists and the agent must be re-pinned through
a new agent version — through the normal promotion gate.

A practical consequence worth stating: if the live server has genuinely changed its input schema,
calls against the pinned shape may start failing at the server. That surfaces as an ordinary tool
failure plus a drift badge — a loud, attributable, recoverable state. That is the intended trade:
**visible breakage beats silent behavior change.**

### 2.4 Discovery and reconciliation go through the Gateway Plane

Both the enrolment wizard's discovery handshake (FR-MCP-16 step 4) and the reconciler's re-fetch are
MCP egress and therefore go through `apps/gateway` (ADR-0004's single choke point), invoked by
`apps/web` and `apps/worker` respectively over the internal API. No new egress path is introduced,
and stdio servers reached through the Gateway Agent tunnel reconcile by the same route.

### 2.5 Fail-closed defaults throughout enrolment

Anything unclassified at wizard step 5 defaults to **Tier 3 and disabled** (FR-MCP-16). A server with
zero bindings cannot leave Draft (FR-MCP-19). A server exposing zero items is a valid degenerate
enrolment, not an error. Sandbox and production credentials are captured and vaulted separately
(FR-SEC-02 / ADR-0007) so version testing never reaches live systems. The dry run at step 8 invokes
one **read-only** tool against the sandbox credential before anything is enrolled. The enrolment
writes the definition and manifest hash to the audit log (FR-ADM-03).

### 2.6 Resources become knowledge candidates, not discards

`mcp_manifest_item` rows with `kind = 'resource'` are offered to the Knowledge subsystem as
ingestion candidates (FR-MCP-20 → FR-KB-02) rather than being dropped as they are today. The link is
a candidate offer, not an automatic ingestion: a resource becomes a `knowledge_source` only when a
human attaches it to a collection, carrying its ACL.

## 3. Alternatives considered

**Diff-and-notify (record the change in place, alert an admin).** Rejected — this is essentially
today's behavior plus an email. The changed schema is live the moment it changes; the alert races
the exploit. Quarantine-by-identity removes the race entirely.

**Auto-approve non-breaking changes (added optional field, widened enum, doc text).** Rejected for
this phase. "Non-breaking" is a *compatibility* judgment, not a *safety* judgment: a widened enum or
a new optional parameter is precisely how a tool's blast radius grows, and descriptions reach the
model and are themselves an injection surface. A cheap-diff-summary UI that makes an obviously
benign change one click to approve delivers most of the ergonomics at none of the risk.

**Pin by server, not by server version (always call the live shape).** Rejected: it makes
reproducibility impossible and would mean an eval run and a sandbox test prove nothing about what
runs in production tomorrow — which undermines the promotion gate itself.

**Treat unreachability as drift.** Rejected explicitly by FR-MCP-18's boundary rule: conflating an
outage with a schema change floods the drift queue during ordinary incidents and trains reviewers to
dismiss it. Health and drift are separate signals with separate surfaces.

**Reconcile on demand only (no schedule).** Rejected: drift MTTR is a tracked metric (spec §7.4,
target < 1 business day) and on-demand reconciliation means drift is discovered when something
breaks.

## 4. Consequences

**Positive.** The clearest privilege-escalation path in the shipped platform closes without changing
how agents call tools. Reproducibility becomes real: an agent version's tool contract is fixed at
promotion. Resources and prompts stop being discarded. Drift becomes a measurable operational
metric with an owner and an SLA.

**Negative / accepted costs.**

- Manifest item rows grow with every schema change on a chatty server, since old items are never
  deleted. Mitigated by retention on superseded, never-pinned items and by the drift screen's
  bulk-resolve; recorded here so it is a planned cleanup, not a surprise.
- A benign upstream change now requires a human click and, to reach production, a new agent version
  through the gate. That is real friction and it is the point; the drift screen should make the
  common case (one tool, obviously-benign diff) fast.
- Two credentials per server-environment increase vault surface. Already the platform's model
  (ADR-0007 per-tenant DEK), so no new mechanism — just more rows.
- The reconciler adds scheduled outbound load against tenant MCP servers. Bounded by a per-server
  configurable schedule and the existing per-connector concurrency caps and circuit breaker.

## 5. Consequences for the LLD

- `mcp_server`, `mcp_server_version`, `mcp_environment_binding`, `mcp_manifest_item`,
  `mcp_drift_event` schema (§6.1a shapes) and their relationship to the existing `Connector`/`Tool`
  rows, including the migration that makes `mcp_server` the enrolment-lifecycle parent without
  breaking existing tool references.
- The canonical hashing function for `schema_hash` and `manifest_hash` (exact normalization rules —
  this is a compatibility surface and must be specified once and never quietly changed).
- Reconciler job scheduling, per-server configuration, and the idempotency guard.
- The `agent_version → server_version` pin bridge and the badge query.
- Drift review screen contracts and the `drift detected` webhook payload (FR-API-02).
- **Capability-group membership (spec §6.1a's flagged open schema choice): keep the existing
  single-FK model** (`Tool.capability_group_id`), no `capability_group_item` bridge table — see
  HLD §15.7 for the rationale. The LLD should implement (a), not (b).

## 6. Verification

1. **Idempotency:** three consecutive reconciler runs against an unchanged server produce exactly
   zero `mcp_drift_event` rows and zero notifications.
2. **New tool:** a tool appearing on the live server enrols disabled at Tier 3 and is not callable
   by any agent until reviewed.
3. **Changed schema:** an approved tool whose input schema changes produces a new item; the original
   item row is unchanged and an agent pinned to the prior server version still resolves the original
   contract.
4. **Cosmetic change:** re-serializing the same schema with different key order produces no drift
   (canonicalization test).
5. **Unreachable:** a server that stops answering produces an `Offline` health transition and **no**
   drift event.
6. **Pinning:** an agent version validated against `server@3` continues to execute unchanged after
   `server@4` is created, and shows a warning badge.
7. **Enrolment fail-closed:** completing the wizard with an unclassified item yields
   `enabled = false, tier = 3`; a server with zero bindings cannot leave Draft.
