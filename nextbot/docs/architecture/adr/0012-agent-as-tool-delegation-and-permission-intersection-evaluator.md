# ADR-0012 — Agent-as-tool delegation, the Tool Execution Kernel, and the centralized permission-intersection evaluator

**Status:** Accepted · 2026-08-28
**Context refs:** FR-ORC-01, FR-ORC-02, FR-ORC-04, FR-ORC-05, FR-ORC-07, FR-ORC-08, FR-ORC-09,
FR-SEC-08, FR-SEC-09, FR-WF-03, FR-MCP-04, FR-MCP-05, FR-KB-08, spec §6.1a (Module E), §9.5,
Blueprint §10.4 / §12.1 / §13 closing box, HLD §15.4–15.5, ADR-0004, ADR-0005
**Decision owner:** Architecture phase (second wave, Blueprint Modules A–F)

## 1. Context

Module E introduces a supervisor agent that decides, at runtime, which specialist agent handles a
turn. Every existing control in the platform — the per-tool permission rule engine (FR-MCP-04), the
approval-tier engine (FR-MCP-05), the PEP at egress (FR-SEC-06), the Runtime Trace, the audit log —
was designed around a *single* agent calling an *MCP* tool. Delegation is the point at which each of
those can be routed around, and the Blueprint says so directly: without an intersection rule, "a
low-privilege supervisor delegating to a high-privilege specialist is a privilege-escalation
primitive" (§10.4 invariant 1), and orchestration "becoming a path around tool tiering" is named as
the primary risk the module introduces (§14.1).

The Blueprint's closing box makes this an ordering constraint, not a design preference: the
permission-intersection evaluator (FR-ORC-02) and the delegation trace tree (FR-ORC-08) **must ship
before the first team runs in production**, because retrofitting either means auditing every
existing team for escalation paths after the fact. BL-37 (Phase 8) is therefore a hard gate on
BL-46 (Phase 9). A partially-implemented evaluator — one module intersecting correctly and another
not — is *worse* than none, because it looks like a control while leaving a hole.

Two things must therefore be true structurally, not by discipline:

- there is exactly **one** implementation of "what may this call do", and
- there is **no code path** that invokes a tool, a specialist, a skill, or a retrieval without
  passing through it.

## 2. Decision

### 2.1 A specialist agent is a Tool Catalog entry, not a new invocation path

A promoted specialist `definition@version` is registered as an entry in the existing Tool Catalog
(FR-MCP-03) with `kind = 'agent'` alongside the existing `kind = 'mcp'`, carrying the same
read/write classification, the same approval tier, the same `agent_tool_config` visibility and
priority weight, the same permission-rule rows, the same simulate preview, and the same
`ToolCall` recording. Delegation is a tool call. It reuses the whole existing apparatus rather than
acquiring a parallel one — which is the only reason FR-ORC-04 ("Tier 3 survives every delegation
hop") is achievable at all: it is not new enforcement, it is the enforcement that already exists,
reached by the same road.

Registration is not automatic. A specialist becomes callable only when an admin explicitly enrols it
and classifies it, defaulting to **disabled and Tier 3** if unclassified — the same fail-closed rule
as MCP manifest items (spec §9.5 invariant 1, FR-MCP-16 step 5).

### 2.2 One Tool Execution Kernel, in the Data Plane, below the orchestration layer

Every tool invocation in the platform — from a normal turn, a workflow node, a composed skill, a
delegated specialist, or a retrieval call — passes through a single kernel in `apps/runtime`, in
this fixed order:

```
resolve caller context
  → evaluate effective scope        (@nextbot/authz — §2.3)
  → resolve approval tier           (existing tier-engine, ADR-0005)
  → pre-call guardrails             (existing guardrail-eval)
  → mint/claim idempotency key      (existing, ADR-0005)
  → DISPATCH  ──┬─ kind='mcp'      → Gateway Plane egress (ADR-0004, PEP re-check)
                ├─ kind='agent'    → child run in the Data Plane (never leaves the cell)
                ├─ kind='skill'    → skill fragment execution in the current run
                └─ kind='workflow' → sub-workflow run (ADR-0013)
  → output-side guardrails          (FR-SEC-09: injection scan, output policy, groundedness)
  → record ToolCall + span + cost + delegation edge
```

The dispatch fork sits **below** tier resolution and guardrails, which is precisely what makes
FR-WF-03 and FR-ORC-04 structural: a Tier-3 tool reached from inside a workflow node or at
delegation depth 3 stops at the same Approval Queue, because the code that decides that runs before
anything knows which kind of callee it is. There is no second executor anywhere in the codebase; a
new dispatch kind is a new branch in this kernel, not a new pipeline.

`kind='agent'` dispatch creates a **child run** inside the Data Plane. It does not go to the Gateway
Plane, because delegation is not egress — nothing leaves the cell — so ADR-0004's choke point is
untouched. The child run is an ordinary run: its own tool calls re-enter this same kernel, one level
deeper.

### 2.3 One evaluator, in one leaf package, producing a Delegation Envelope

`@nextbot/authz` is a new **pure, I/O-free leaf package** (no database, no framework, no module
dependencies — same shape as `packages/contracts`, so it can be imported by every module and by all
four apps without creating a cycle). It exposes the single implementation of FR-ORC-02/FR-SEC-08:

> **effective scope = caller scope ∩ artifact scope ∩ tenant policy.** Composition narrows. It never
> unions, and there is no flag that makes it union.

"Scope" is the same shape everywhere: the permitted tool set, capability groups, knowledge
collection ACL tags, channel/environment/segment attributes, the maximum approval tier the caller
may auto-satisfy, and the PII trust level. The evaluator is applied uniformly to workflow nodes,
delegated agents, composed skills, and retrieval calls — one function, four callers.

Its output is a **Delegation Envelope**: `{ callerChain[], effectiveScope, depth, fanOut,
runBudgetRemaining, trustLevel, idempotencyKey }`, HMAC-sealed with a per-cell key. The envelope is
a **required field on the `ToolInvocation` contract** (`packages/contracts`), which has three
consequences:

1. The kernel cannot dispatch without one, so no caller can skip evaluation by construction rather
   than by review.
2. The Gateway Plane's PEP verifies the seal **and independently recomputes the intersection**
   against the policy bundle before egress — the existing "decide at selection, enforce at egress"
   pattern (HLD §5), now carrying an explicit caller chain instead of a single agent id.
3. A delegation that would grant a specialist a capability the supervisor does not hold produces an
   empty-or-narrower scope by arithmetic, and is rejected before the call executes (FR-ORC-02) — it
   cannot be "hidden in the UI" because the UI is not involved.

`trustLevel` in the envelope is what implements FR-ORC-05: the masking-context matrix is
re-evaluated at every hand-off keyed to the **receiving** agent's declared trust level, so a
supervisor holding unmasked PII cannot pass an unmasked transcript down by composition. And
FR-ORC-09 falls out of the kernel's ordering: output-side guardrails run **before** a tool result or
retrieved chunk crosses into another agent's context, not only before it reaches the customer.

### 2.4 Run-level limits belong to the run, not the member

`maxDepth`, `maxFanOut`, `maxDelegations`, cumulative cost, and wall-clock are decremented on the
**run** and carried in the envelope, so they are enforced across the whole delegation tree rather
than per member (FR-ORC-07). Exceeding any of them halts and routes to the team's declared
`failureMode` (`escalate`), never a silent degrade. Routing thrash — repeated delegation to the same
member with a materially similar payload — is detected by a payload-similarity counter on the run
and capped the same way.

### 2.5 The trace tree and the audit chain are the same data

Each dispatch writes a `delegation_event` (spec §6.1a) carrying `parent_span_id`, from/to agent
version, reason, depth, cost, and outcome. The Runtime Trace renders the tree from those rows
(FR-ORC-08); the Approval Queue renders the same chain as approver context (FR-ORC-04); the
Escalation record attaches the same chain (FR-ORC-06, one active escalation per conversation, chain
attached); the Audit Log records actor attribution as that chain, never a bare terminal-agent name.
One write, four readers — which is why the trace tree is a Phase 8 prerequisite rather than a
Phase 9 reporting nicety.

**Team routing decisions are internal-only** (user decision, spec §9.5 item 4): delegation appears
in the takeover panel, Runtime Traces, and the audit log, and never in the customer-facing
transcript or widget.

### 2.6 The ordering constraint, made structural

Because the envelope is a required contract field minted only by `@nextbot/authz`, and because
`kind='agent'` dispatch exists only inside the kernel, a team literally cannot run before the
evaluator exists. BL-37 is not "recommended before" BL-46; the code does not compile without it. A
CI test asserts that child-run creation with a missing or invalid envelope fails closed.

## 3. Alternatives considered

**A separate multi-agent invocation path (an "A2A-internal" style protocol between agents).**
Rejected. It would need its own permission model, its own tiering, its own trace and audit
attribution, and its own approval queue integration — four parallel implementations of controls that
already exist and are already audited. The Blueprint's own framing is that Module E is "mostly
registration and policy over machinery that already exists"; a parallel path throws that away and
reintroduces exactly the escalation surface FR-ORC-02 exists to close.

**Per-module intersection logic (each of workflows, teams, skills, retrieval does its own).**
Rejected explicitly by FR-SEC-08 and by the Blueprint §12.1 ("implemented once, centrally, in the
authorisation layer rather than separately in each module"). Four implementations means four drift
surfaces and a guarantee that is only as strong as the weakest one — and the weakest one is
invisible until an audit finds it.

**Enforcing "use the evaluator" with a lint rule / CI grep only.** Rejected as the *primary*
mechanism. It is the mechanism used for the provider-SDK ban, where the forbidden thing is an import
and therefore statically visible. Here the forbidden thing is *the absence of a call*, which lint
cannot see. Making the envelope a required field of the invocation contract turns an absence into a
type error. (The lint gate is still added, as a secondary check against a module constructing a
hand-rolled envelope.)

**Free-form agent-to-agent messaging with no declared topology.** Rejected by the spec itself
(§4.15): it cannot be reviewed, capped, or audited legibly. Teams declare a supervisor and a
version-pinned member list, or they do not exist.

**Union-with-explicit-grant (allowing a delegation to widen scope when an admin opts in).**
Rejected. Every widening mechanism becomes the default path under delivery pressure, and there is no
review surface that can reliably distinguish a legitimate widening from an escalation. If a
specialist needs a capability, the supervisor must hold it — which is a legible, reviewable
statement.

## 4. Consequences

**Positive.** Delegation inherits — rather than reimplements — permissions, tiering, approvals,
simulate preview, tracing, cost attribution, and audit. The intersection rule is one function with
one test suite. The escalation surface the Blueprint warns about is closed by arithmetic rather than
by vigilance. Workflow nodes (ADR-0013) get all of the above for free, because they use the same
kernel.

**Negative / accepted costs.**

- `ToolInvocation` is a breaking contract change (a new required field). It ships in Phase 8 with
  BL-37, ahead of any consumer that needs it, precisely so the break happens once and early.
- Every tool call now carries an HMAC seal computation. Measured cost is microseconds against a
  call path whose floor is a network round trip; recorded here so it is not rediscovered as a
  mystery.
- The kernel is a single point of failure in the correctness sense — a bug there is a platform-wide
  bug. Accepted deliberately: one place to get right and one place to test beats four places to keep
  in sync. Mitigated by §6's test matrix and by the PEP's independent recomputation, which means an
  evaluator bug must coincide with a PEP bug to become an egress.
- Intersection can produce surprising empty scopes ("the specialist can do nothing"), which is a
  usability problem. Mitigated by surfacing the *computed* effective scope in the team editor and in
  the simulate preview at authoring time, so the narrowing is visible before promotion, not
  discovered at runtime.
- Depth-N delegation multiplies model cost. Tracked explicitly as the "multi-agent cost delta"
  metric (spec §7.4) and capped by the run budget in §2.4.

## 5. Consequences for the LLD

- `Tool` gains a `kind` discriminant (`mcp | agent | skill | workflow`) plus the nullable reference
  to the target artifact version; `ToolCall` is reused unchanged (spec §6.2 already says so).
- `@nextbot/authz` public surface: the scope value object, `evaluateEffectiveScope()`, envelope
  minting/verification, and the intersection algebra's exact semantics for each scope dimension
  (set intersection, min-of-tier, min-of-trust-level).
- `ToolInvocation` / `ToolResult` contract revision (HLD §4) with the envelope field.
- The kernel's module placement, its port interfaces, and the four dispatch adapters.
- `delegation_event` schema and the trace-tree query that assembles it.
- `team`, `team_version`, `team_member` schema and the team validator (required `failureMode`,
  version-pinned members, supervisor bound to a `chat.router`-class route per FR-AGT-23).
- Approval Queue payload extension carrying the delegation chain.

## 6. Verification

1. **Escalation test (the load-bearing one):** a supervisor without tool X delegates to a specialist
   that holds tool X; the call is rejected before execution, and the rejection is attributable to
   the intersection, not to a downstream deny.
2. **Tier survival matrix:** a Tier-3 tool invoked from (a) a plain turn, (b) a workflow Tool-call
   node, (c) a workflow Agent node, (d) a depth-1 specialist, (e) a depth-3 specialist — all five
   reach the same Approval Queue and none executes before approval.
3. **Envelope-required test:** constructing a `ToolInvocation` without an envelope fails to compile;
   dispatching one with a tampered seal fails closed at both the kernel and the PEP.
4. **PII boundary test:** a high-trust supervisor delegating to a low-trust specialist passes a
   transcript masked to the *specialist's* level (FR-ORC-05).
5. **Injection-across-boundary test:** attacker-controlled text returned by a Fetch-class connector
   is screened before it enters the receiving specialist's context, not only before the customer
   sees it (FR-ORC-09).
6. **Budget test:** `maxDepth`/`maxDelegations`/cost/wall-clock are enforced at run level across a
   tree, and breach routes to `failureMode: escalate` — never a loop, never a silent answer.
7. **Single-escalation test:** three members independently tripping an escalation condition in one
   run produce exactly one `Escalation` record with the full chain attached (FR-ORC-06).
8. **No-second-executor test:** a CI grep/dependency-cruiser gate asserting no module outside the
   kernel constructs a tool dispatch or a child run.

`nexus-qa` should treat a failure in tests 1–3 as a release blocker, in the same class as ADR-0001's
cross-tenant isolation suite.
