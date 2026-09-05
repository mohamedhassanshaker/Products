# ADR-0017 — Emergency rollback: the precise boundary of an audited promotion-gate bypass

**Status:** Accepted · 2026-08-28
**Context refs:** FR-AGT-30, FR-AGT-04, FR-AGT-05, FR-AGT-01, FR-ADM-03, FR-API-02, NFR-2, NFR-13,
spec §7.4 (Phase 6 / BL-27), §9.5, Blueprint §12.3 (gap G-02, severity 1, "highest risk-to-effort
item in the entire document"), HLD §15.9
**Decision owner:** Architecture phase (second wave, Blueprint Modules A–F)

## 1. Context

The shipped platform can deploy faster than it can recover. Promotion replaces the prior Production
deployment; the existing Rollback (FR-AGT-04/05) repoints traffic only to a version already in that
deployment's recent history. Anything older requires Restore, which authors a **new** version that
must then pass the full gate — eval run, reviewer ≠ author, sandbox conversation. During an
incident, that is minutes-to-hours of recovery time for an artifact that was in Production last
week and passed the gate then.

Any fix here is, by definition, a bypass of a gate the platform's entire trust story rests on. The
question this ADR answers is therefore not "should there be an emergency rollback" — FR-AGT-30 and
BL-27 already settle that — but **exactly where the bypass boundary sits**, so that it is a
recognition of a gate already satisfied rather than a hole in the gate.

## 2. Decision

### 2.1 The boundary, stated as an invariant

> Emergency rollback re-promotes an **existing, immutable version of the same agent definition that
> has a recorded passing gate outcome from a prior promotion to Production**. It creates nothing,
> changes nothing, and validates nothing new. It repoints traffic.

That sentence is the whole control surface. Its three clauses are each enforced independently:

| Clause | Enforcement |
|---|---|
| **Existing and immutable** | The target is an `agent_definition_version` row; the action has no create/update path. Nothing about the artifact can differ from what ran before, because the artifact is the same bytes. |
| **Of the same agent definition** | The target must share the current deployment's `agent_definition_id`. Cross-definition "rollback" is a promotion, not a rollback. |
| **Previously Production, with a recorded passing gate outcome** | Checked against the deployment history — not against the version's current *status*. A version that was Production and has since been superseded still qualifies. A Draft, Eval-Gated, Human-Review, or Approved-but-never-promoted version **never** qualifies, and no override exists. |

This is what makes the claim "not a weakening of the promotion gate" literally true rather than
rhetorical: the gate's guarantee is *"nothing reaches Production that has not passed"*, and this
action can only select from things that have already passed. It is only sound because versions are
immutable (ADR-0009 §2, spec §9.5 invariant 2) — if a version could be edited in place, "it passed
the gate once" would say nothing about what runs now, and this ADR would be indefensible.

### 2.2 Required inputs and mandatory side effects

- A **non-empty free-text reason** is required; blank fails validation with the exact message
  "A reason is required for emergency rollback" (FR-AGT-30).
- An **audit-log entry** (actor, source version, target version, reason, timestamp) is written in
  the same transaction as the repoint — via the existing transactional-outbox domain event, so it is
  a structural guarantee, not a call-site courtesy.
- The tenant's **administrators are notified**; this is never a silent action. The same event feeds
  the outbound webhook `deployment changed` (FR-API-02).
- The action is gated by RBAC on the existing deployments/agent-platform module at Write level
  (FR-ADM-02). It is **not** given its own privileged role: an actor who can promote can roll back.
  Inventing a special break-glass role here would create a second privilege ladder for the same
  capability, and the audit trail — not a scarcer role — is the control.

### 2.3 It is a repoint, and it inherits the repoint's performance bound

Emergency rollback is the same traffic-split row update plus Redis invalidation that ordinary
rollback is (HLD §12, NFR-2's <5 s bound), not a redeploy and not a re-promotion pipeline. That is
not an incidental property: this is the **primary incident-recovery mechanism**, so its latency is a
safety property. It completes within the same bound as ordinary rollback (FR-AGT-30, NFR-13).

### 2.4 What it deliberately does not do

- It does **not** mark the rolled-back-from version as bad, retract it, or block re-promotion. That
  is a separate human judgment; conflating "get traffic off this now" with "condemn this version"
  makes the fast action slower and the slow action less considered.
- It does **not** apply to workflows, teams, skills, or routes in this phase. Those artifacts gained
  a Production lifecycle only in Phases 7–9; extending the bypass to them requires the same
  "previously-Production with a recorded passing gate outcome" history to exist for each, and should
  be a deliberate extension of this ADR rather than an assumed generalization.
- It does **not** create a version. Restore (which authors a new version and re-enters the gate)
  remains the correct tool for "I want that old behavior *with edits*", and remains unchanged.

### 2.5 Visibility as the compensating control

Because the gate is bypassed, visibility is the control that replaces it: every emergency rollback
appears in the deployment history distinctly labelled (not indistinguishable from an ordinary
rollback), carries its reason inline, and is reportable — frequency of emergency rollback per tenant
is an operational health signal, and a tenant using it routinely is a signal about their promotion
practice, not about this feature.

## 3. Alternatives considered

**Fast-track the gate instead (re-run evals automatically, auto-approve, skip sandbox).** Rejected.
It is the same bypass with more moving parts and a worse property: it *re-evaluates* during an
incident, so the recovery path can fail for reasons unrelated to the incident (a flaky eval, an
unreachable judge model, a provider outage — quite possibly the very outage being recovered from).
Selecting a known-good immutable artifact cannot fail that way.

**Allow emergency promotion of any Approved version (not only previously-Production ones).**
Rejected: an Approved-but-never-promoted version has passed the gate but has never served real
traffic, so "it already worked in production" — the entire justification — does not hold. It also
widens the action from recovery to deployment, which is the slope this ADR exists to fence.

**Require a second approver (two-person rule) at rollback time.** Rejected for the emergency path:
it reintroduces a human-availability dependency into the mechanism whose sole purpose is removing
one, at 3 a.m., which is when it will be used. The reason string plus notification plus audit entry
plus post-hoc reviewability is the accepted trade, and it is the trade the Blueprint proposes.

**A dedicated break-glass role with time-boxed elevation** (the FR-ADM-09 pattern). Rejected here:
that pattern is right for *cross-tenant operator* access to data the operator normally cannot see.
Emergency rollback is a tenant admin acting on their own tenant's deployment, using a capability
they already hold in a different shape. Adding elevation ceremony to it would slow the incident path
without adding a real control.

**Do nothing (keep Restore as the only path).** Rejected: this is the status quo the Blueprint rates
as the highest risk-to-effort item in the document, and BL-27 schedules it as P0 Phase 6 ahead of
every other second-wave item.

## 4. Consequences

**Positive.** Recovery time drops from "author a version and pass the gate" to a <5 s repoint plus
human decision time (spec §7.4's "recovery time" metric). This is also the precondition that makes
progressive rollout/canary safe to build later (BL-48 depends on BL-27): a canary without a fast
rollback is a bigger risk than the feature it enables.

**Negative / accepted costs.**

- A real, deliberate bypass now exists in a system whose value proposition is that no bypass exists.
  Mitigated entirely by §2.1's boundary and §2.5's visibility — and the honest framing is that the
  gate's guarantee is unchanged in substance while the *narrative* "there are no exceptions" is not.
  This ADR is the place that says so out loud.
- It can be misused as a deployment mechanism by a tenant that keeps an old version around as a
  "safe" target and flips between two versions. Detectable in the deployment history; a policy
  problem, not an architectural one.
- Rolling back to an older version may reintroduce a fixed bug, and may point at MCP server
  versions, model routes, or skills whose pinned targets have since drifted (ADR-0014) or been
  deprecated (ADR-0011). Because all references are version-pinned, the old version resolves the old
  contracts — which is correct behavior, and the drift/deprecation badges are how it is visible.
  The rollback UI must surface those badges for the target version **before** confirming.

## 5. Consequences for the LLD

- The eligibility query ("previously Production for this definition, with a recorded passing gate
  outcome") over deployment history, and its index.
- The repoint transaction: deactivate current, activate target, traffic split 100%, audit event, all
  under the existing advisory-lock pattern that already guards concurrent promotion.
- The required-reason validation and its exact error string.
- Deployment-history labelling for the emergency variant, the admin notification, and the
  `deployment changed` webhook payload.
- Pre-confirmation badge surfacing (drift, deprecated model, deprecated skill pin) for the target
  version.

## 6. Verification

1. **Eligibility:** Draft, Eval-Gated, Human-Review, and Approved-never-promoted versions are all
   rejected; a previously-Production, now-superseded version is accepted.
2. **Cross-definition:** a previously-Production version of a *different* agent definition is
   rejected.
3. **Reason:** a blank reason fails with the exact FR-AGT-30 message; the stored audit entry contains
   actor, source, target, reason, timestamp.
4. **Immutability:** the target version's YAML and hash are byte-identical before and after; no new
   version row is created.
5. **Latency:** the repoint completes within the NFR-2/<5 s bound, measured in CI as the existing
   rollback timing test does.
6. **Concurrency:** two simultaneous emergency rollbacks on the same definition leave exactly one
   active deployment at 100% traffic (reuses the existing advisory-lock regression test).
7. **Notification/audit completeness:** the audit row and the administrator notification are emitted
   for every successful call, asserted by the existing audit-completeness test rather than a
   bespoke one.
