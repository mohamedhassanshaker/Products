# @nextbot/teams

Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.7) — the
delegation trace-tree **data model + read path only**.

## Scope discipline

This module ships **only** `delegation_event` (LLD §14.7.2) and the query/
assembly that renders it as a tree (LLD §14.7.5's `GET /api/v1/admin/agent-runs/
{runId}/delegation-tree`). It does **not** ship:

- `team`/`team_version`/`team_member` (LLD §14.7.2's full Module E schema),
- the delegation executor (`teams/application/delegation-executor.ts` per LLD
  §14.7.3),
- `tool.kind`/`AgentAsTool` (LLD §14.7.1).

All of the above are Phase 14/BL-46's scope ("Multi-agent orchestration:
agent-as-tool + team delegation runtime") — building them here would be the
exact "partially-implemented" state ADR-0012 explicitly warns against ("a
partially-implemented evaluator... is *worse* than none, because it looks like
a control while leaving a hole" — the same reasoning applies to a
partially-built delegation runtime).

**Nothing in this module is reachable by a real running agent conversation.**
Every run's delegation tree is `{ roots: [] }` today, because nothing writes
`delegation_event` rows yet.

## Disclosed schema decisions

- `delegation_event.team_version_id`/`from_member_id`/`to_member_id` are
  FK-less — `team_version`/`team_member` don't exist as tables yet. Mirrors
  `mcp-registry`'s `artifact_mcp_pin` (LLD §14.3.5): referential integrity is
  enforced by the writing service (Phase 14), not a DB constraint, until the
  referenced tables exist.
- Not monthly-partitioned yet, despite LLD §14.7.2 calling for it — mirrors
  `domain_event`'s own established precedent (plain table until real write
  volume exists to justify partition-maintenance infrastructure).
- `DelegationTreeNode.memberKey` is nullable (LLD has it as a required
  `Type.String()`) — `team_member` (the table it would resolve from) doesn't
  exist yet, so it's always `null` in this build. Additive field, no breaking
  change once Phase 14 populates it.
- `agentLabel` is resolved via a direct read of `agent-platform`'s
  `agent_definition`/`agent_definition_version` tables through the shared
  `@nextbot/db` schema package (not that module's own application/domain
  API) — an already-established pattern in this codebase for a read-only
  cross-cutting join.

## Rendering foundation

`@nextbot/ui`'s `DelegationTree` component renders whatever the tree query
returns. It is deliberately **not wired into any existing live console page**
this phase (e.g. the Runtime Traces screen) — there's no real data to render
yet, and attaching it to an already-shipped screen's design before Phase 14
has real rows to show would be premature UI surface, not a foundation.
