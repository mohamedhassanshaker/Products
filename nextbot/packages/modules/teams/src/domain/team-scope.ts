import type { ScopeDescriptor, TeamLimits, TeamScopeSpec } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-07, LLD §14.7.2) — composes
 * the `ScopeDescriptor` a `team_version` / `team_member` is stored with and handed
 * to `@nextbot/authz`'s evaluator as a chain level.
 *
 * Pure (`domain/`, no I/O).
 *
 * **This is where FR-ORC-07's run-level ceilings become the Phase 6 evaluator's own
 * enforcement rather than a second, independently-derived check.** The team
 * version's authored `limits` are projected onto the descriptor's `budget`
 * dimension, which `evaluate()`'s step 2 already checks against the run's real
 * `consumed` accumulator, producing `DELEGATION_DEPTH_EXCEEDED` /
 * `FAN_OUT_EXCEEDED` / `DELEGATION_COUNT_EXCEEDED` / `COST_BUDGET_EXCEEDED` /
 * `WALL_CLOCK_BUDGET_EXCEEDED`. The delegation executor never re-implements any of
 * those comparisons — it feeds the evaluator and routes the resulting `Deny` to
 * `failureMode`. `thrashWindow` is deliberately NOT projected: it is not a lattice
 * dimension (the lattice has no notion of payload similarity), so it stays the
 * executor's own guard, as LLD §14.7.3 step 2 specifies.
 *
 * An authored dimension that is absent is left OMITTED, never defaulted to a
 * concrete value: LLD §14.2.1's E3 treats an omitted dimension as the lattice top,
 * so omission means "this level adds no restriction" — which is materially
 * different from, say, an empty `toolIds` array (which means "no tool at all is
 * reachable" and is a legitimate, if severe, thing to author).
 */

/** Copies only the dimensions the author actually declared. */
function spreadDeclared(spec: TeamScopeSpec | undefined): Partial<ScopeDescriptor> {
  if (!spec) return {};
  return {
    ...(spec.capabilityGroupIds !== undefined ? { capabilityGroupIds: spec.capabilityGroupIds } : {}),
    ...(spec.toolIds !== undefined ? { toolIds: spec.toolIds } : {}),
    ...(spec.deniedToolIds !== undefined ? { deniedToolIds: spec.deniedToolIds } : {}),
    ...(spec.rwClasses !== undefined ? { rwClasses: spec.rwClasses } : {}),
    ...(spec.autonomyCeiling !== undefined ? { autonomyCeiling: spec.autonomyCeiling } : {}),
    ...(spec.minRequiredTier !== undefined ? { minRequiredTier: spec.minRequiredTier } : {}),
    ...(spec.trustLevel !== undefined ? { trustLevel: spec.trustLevel } : {}),
  };
}

/**
 * Builds `team_version.scope_json` (`origin: 'TeamVersion'`).
 *
 * @param teamLabel `"<teamName>@<version>"` — appears verbatim in the evaluator's
 *   per-dimension trace and in the Approval Queue, so it must be human-readable.
 */
export function composeTeamVersionScope(args: {
  teamVersionId: string;
  teamLabel: string;
  limits: TeamLimits;
  spec: TeamScopeSpec | undefined;
}): ScopeDescriptor {
  return {
    origin: "TeamVersion",
    originId: args.teamVersionId,
    originLabel: args.teamLabel,
    ...spreadDeclared(args.spec),
    budget: {
      maxDepth: args.limits.maxDepth,
      maxFanOut: args.limits.maxFanOut,
      maxDelegations: args.limits.maxDelegations,
      usdPerTurn: args.limits.runBudget.usd,
      seconds: args.limits.runBudget.seconds,
    },
  };
}

/** Builds `team_member.scope_json` (`origin: 'TeamMember'`). A member declares no
 * budget of its own — FR-ORC-07's ceilings are explicitly RUN-level, not
 * per-member, and letting a member author its own budget would be exactly the
 * per-member accounting that requirement rules out. */
export function composeTeamMemberScope(args: {
  memberId: string;
  memberLabel: string;
  spec: TeamScopeSpec | undefined;
}): ScopeDescriptor {
  return {
    origin: "TeamMember",
    originId: args.memberId,
    originLabel: args.memberLabel,
    ...spreadDeclared(args.spec),
  };
}
