import { Type, type Static } from "@sinclair/typebox";
import { ScopeDescriptorSchema } from "./authz.js";
import { ApprovalTier } from "./tool-registry.js";
import { DomainError } from "./errors.js";

/**
 * Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.7.2/§14.7.5) —
 * the delegation trace-tree's read-side contract; **extended by Phase 14 (BL-46,
 * FR-ORC-01/03-11)** with the full Module E surface (`team`/`team_version`/
 * `team_member`, the authored team artifact, the delegation chain shape every
 * downstream surface renders, and this module's named domain errors).
 */
export const DelegationOutcome = Type.Union([
  Type.Literal("Answered"),
  Type.Literal("NotMine"),
  Type.Literal("Escalated"),
  Type.Literal("Failed"),
  Type.Literal("Denied"),
  Type.Literal("BudgetExceeded"),
  Type.Literal("FallbackUsed"),
  Type.Literal("Timeout"),
  /** Phase 14 (BL-46, FR-ORC-04) — the delegation hop itself was Tier-2/Tier-3 and
   * suspended into the Approval Queue rather than completing (LLD §14.7.3 step 5
   * executes a delegation as an ordinary tool call, so tiering applies to the hop
   * as well as to whatever the specialist then does). Additive; the eight prior
   * values keep their exact meaning. */
  Type.Literal("AwaitingApproval"),
]);
export type DelegationOutcomeValue = Static<typeof DelegationOutcome>;

/**
 * LLD §14.7.5's `DelegationTreeNodeSchema`, with one disclosed narrowing:
 * `memberKey` is nullable here (LLD has it as a plain required `Type.String()`).
 * `team_member` (the table `memberKey` actually lives on) doesn't exist as a
 * table yet in this build (Phase 14) — a real `delegation_event` row's
 * `to_member_id` therefore cannot be resolved to a human-readable key today.
 * `null` is the honest value until that join target exists; Phase 14 can then
 * populate it without a breaking schema change (adding a value to an
 * already-nullable field is additive).
 */
export const DelegationTreeNodeSchema = Type.Recursive((Self) =>
  Type.Object({
    delegationEventId: Type.String({ format: "uuid" }),
    depth: Type.Integer(),
    agentLabel: Type.String(),
    memberKey: Type.Union([Type.String(), Type.Null()]),
    reason: Type.String(),
    outcome: DelegationOutcome,
    tokensIn: Type.Integer(),
    tokensOut: Type.Integer(),
    costUsd: Type.String(),
    latencyMs: Type.Union([Type.Integer(), Type.Null()]),
    spanId: Type.String(),
    toolCallIds: Type.Array(Type.String({ format: "uuid" })),
    children: Type.Array(Self),
  }),
);
export type DelegationTreeNode = Static<typeof DelegationTreeNodeSchema>;

export const DelegationTreeResponseSchema = Type.Object({
  agentRunId: Type.String({ format: "uuid" }),
  roots: Type.Array(DelegationTreeNodeSchema),
});
export type DelegationTreeResponse = Static<typeof DelegationTreeResponseSchema>;

// ===========================================================================
// Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01/03-11, LLD §14.7)
// ===========================================================================

/**
 * FR-ORC-04/06/08 — the ONE shape every downstream surface renders a delegation
 * chain from: the Approval Queue's `approval_request.risk_summary.delegationChain`,
 * the escalation's `ai_context_snapshot.delegationChain`, and the audit entry's
 * `details.delegationChain`. Declared once here so the three can never drift.
 *
 * `agentLabel` is `"<definitionName>@<version>"`; `memberKey` is the team member's
 * authored key (`null` for the supervisor's own root entry, which has no member row).
 */
export const DelegationChainEntrySchema = Type.Object(
  {
    depth: Type.Integer({ minimum: 0 }),
    agentLabel: Type.String(),
    memberKey: Type.Union([Type.String(), Type.Null()]),
    reason: Type.String(),
    outcome: Type.Union([DelegationOutcome, Type.Null()]),
  },
  { additionalProperties: false },
);
export type DelegationChainEntry = Static<typeof DelegationChainEntrySchema>;

export const TeamStatus = Type.Union([Type.Literal("Active"), Type.Literal("Archived")]);
export type TeamStatusValue = Static<typeof TeamStatus>;

/** Identical ladder to `agent_definition_version`'s promotion ladder (LLD §14.7.2) —
 * deliberately the same six states, so a team version is promoted through exactly
 * the gate an agent version is, never a looser parallel one. */
export const TeamVersionStatus = Type.Union([
  Type.Literal("Draft"),
  Type.Literal("EvalGated"),
  Type.Literal("HumanReview"),
  Type.Literal("Approved"),
  Type.Literal("Production"),
  Type.Literal("Deprecated"),
]);
export type TeamVersionStatusValue = Static<typeof TeamVersionStatus>;

/** FR-ORC-03: `escalate` is "the default and only currently specified mode"
 * ("never silently degrade"). A one-value union is deliberate, not an oversight —
 * a future `Retry`/`Degrade` mode would be an additive union member plus its own
 * executor branch, never a silent reinterpretation of this one. */
export const TeamFailureMode = Type.Union([Type.Literal("Escalate")]);
export type TeamFailureModeValue = Static<typeof TeamFailureMode>;

export const TeamMemberFallbackAction = Type.Union([Type.Literal("Member"), Type.Literal("Escalate")]);
export type TeamMemberFallbackActionValue = Static<typeof TeamMemberFallbackAction>;

/**
 * FR-ORC-07's run-level ceilings. **Every field is required** — LLD §14.7.2's
 * "ALL required, no partial". A team whose author omits `maxFanOut` has not
 * expressed "unlimited fan-out", they have expressed nothing, and this phase
 * refuses to guess on a safety limit.
 */
export const TeamLimitsSchema = Type.Object(
  {
    maxDepth: Type.Integer({ minimum: 1, maximum: 8 }),
    maxFanOut: Type.Integer({ minimum: 1 }),
    maxDelegations: Type.Integer({ minimum: 1 }),
    runBudget: Type.Object(
      { usd: Type.Number({ minimum: 0 }), seconds: Type.Number({ minimum: 0 }) },
      { additionalProperties: false },
    ),
    thrashWindow: Type.Object(
      {
        /** How many prior hops to the SAME member are inspected for similarity. */
        repeats: Type.Integer({ minimum: 1 }),
        /** Cosine similarity at or above which two payloads count as "materially
         * similar" (FR-ORC-07's routing-thrash pattern). */
        similarityThreshold: Type.Number({ minimum: 0, maximum: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type TeamLimits = Static<typeof TeamLimitsSchema>;

/**
 * The authorable subset of `ScopeDescriptorSchema` a team version / team member
 * declares in YAML. `origin`/`originId`/`originLabel` are NOT authorable — the
 * service supplies them (`'TeamVersion'`/`'TeamMember'`, LLD §14.7.2) so an author
 * cannot mislabel a scope level and corrupt the evaluator's trace attribution.
 * `budget` is not authorable here either: for a team version it is projected from
 * `limits` (see `TeamLimitsSchema`), which is the single place run ceilings live.
 *
 * Id-shaped dimensions are real uuids (matching the lattice's own `IdSet` typing),
 * not names — Phase 12 recorded why casting names into uuid dimensions would be a
 * lossy, incorrect equivalence rather than a real check.
 */
export const TeamScopeSpecSchema = Type.Object(
  {
    capabilityGroupIds: Type.Optional(Type.Union([Type.Literal("*"), Type.Array(Type.String({ format: "uuid" }))])),
    toolIds: Type.Optional(Type.Union([Type.Literal("*"), Type.Array(Type.String({ format: "uuid" }))])),
    deniedToolIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
    rwClasses: Type.Optional(Type.Array(Type.Union([Type.Literal("Read"), Type.Literal("Write")]))),
    autonomyCeiling: Type.Optional(ApprovalTier),
    minRequiredTier: Type.Optional(ApprovalTier),
    trustLevel: Type.Optional(Type.Union([Type.Literal("Trusted"), Type.Literal("SemiTrusted"), Type.Literal("Untrusted")])),
  },
  { additionalProperties: false },
);
export type TeamScopeSpec = Static<typeof TeamScopeSpecSchema>;

/** One scoped member of a team version (FR-ORC-03). `agent` pins
 * `"<definitionName>@<version>"` — pinned by version, so promoting the member's
 * underlying agent definition never silently changes a production team. */
export const TeamMemberSpecSchema = Type.Object(
  {
    key: Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}$" }),
    agent: Type.String({ minLength: 3 }),
    delegationTier: ApprovalTier,
    invokeWhen: Type.String({ minLength: 1, maxLength: 2000 }),
    scope: Type.Optional(TeamScopeSpecSchema),
    /** FR-ORC-10 — what happens when THIS member is unavailable. `'Escalate'` is
     * the default; `'Member'` requires `fallbackMemberKey`. The supervisor never
     * silently answers in the specialist's place under either. */
    fallbackAction: Type.Optional(TeamMemberFallbackAction),
    fallbackMemberKey: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type TeamMemberSpec = Static<typeof TeamMemberSpecSchema>;

/** The authored team YAML artifact (LLD §14.7.2). Flat/top-level, matching
 * `SkillArtifactSchema`'s convention rather than `AgentDefinitionArtifactSchema`'s
 * `spec` wrapper. */
export const TeamArtifactSchema = Type.Object(
  {
    kind: Type.Literal("team"),
    name: Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}$" }),
    version: Type.Integer({ minimum: 1 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    supervisor: Type.Object(
      {
        /** `"<definitionName>@<version>"`. */
        agent: Type.String({ minLength: 3 }),
        /** A `model_route.name` — validated at save to be router-class
         * (FR-ORC-03: "a designated cheap chat.router-class model route ... never a
         * frontier model"). */
        route: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    limits: TeamLimitsSchema,
    /** Required, no default (FR-ORC-03's literal enforcement). */
    failureMode: TeamFailureMode,
    scope: Type.Optional(TeamScopeSpecSchema),
    members: Type.Array(TeamMemberSpecSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type TeamArtifact = Static<typeof TeamArtifactSchema>;

// --------------------------------------------------------------------------
// §14.7.5 request/response shapes
// --------------------------------------------------------------------------

export const CreateTeamRequestSchema = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}$" }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    /** Creating a team always creates its version 1 in one call — there is no
     * "empty" team with zero versions (same convention `CreateSkillRequestSchema`
     * already established). */
    artifact: TeamArtifactSchema,
  },
  { additionalProperties: false },
);
export type CreateTeamRequest = Static<typeof CreateTeamRequestSchema>;

export const UpdateTeamRequestSchema = Type.Object(
  { description: Type.Optional(Type.String({ maxLength: 2000 })), status: Type.Optional(TeamStatus) },
  { additionalProperties: false },
);
export type UpdateTeamRequest = Static<typeof UpdateTeamRequestSchema>;

export const CreateTeamVersionRequestSchema = Type.Object({ artifact: TeamArtifactSchema }, { additionalProperties: false });
export type CreateTeamVersionRequest = Static<typeof CreateTeamVersionRequestSchema>;

export const TransitionTeamVersionRequestSchema = Type.Object(
  { to: TeamVersionStatus, note: Type.Optional(Type.String({ maxLength: 2000 })) },
  { additionalProperties: false },
);
export type TransitionTeamVersionRequest = Static<typeof TransitionTeamVersionRequestSchema>;

export const TeamSandboxRunRequestSchema = Type.Object(
  {
    /** The customer-shaped task the supervisor routes. */
    task: Type.String({ minLength: 1, maxLength: 8000 }),
    /** An existing sandbox conversation to run against. The composition root
     * creates one when absent — `teams` never writes `message` rows (LLD §14.7.4). */
    conversationId: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);
export type TeamSandboxRunRequest = Static<typeof TeamSandboxRunRequestSchema>;

/** One warning from `POST .../validate` — a save-blocking condition in strict mode,
 * an advisory otherwise (LLD §14.7.2's `TEAM_SUPERVISOR_ROUTE_EXPENSIVE` is the
 * canonical example). */
export const TeamValidationWarningSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  path: Type.Union([Type.String(), Type.Null()]),
});
export type TeamValidationWarning = Static<typeof TeamValidationWarningSchema>;

export const TeamValidationResponseSchema = Type.Object({
  valid: Type.Boolean(),
  warnings: Type.Array(TeamValidationWarningSchema),
  errors: Type.Array(TeamValidationWarningSchema),
  /** The composed `ScopeDescriptor` this version would run under — the exact value
   * `POST /authz/simulate` resolves a `teamVersion` chain ref to. */
  scope: Type.Optional(ScopeDescriptorSchema),
});
export type TeamValidationResponse = Static<typeof TeamValidationResponseSchema>;

// --------------------------------------------------------------------------
// Domain errors
// --------------------------------------------------------------------------

export class TeamNotFoundError extends DomainError {
  readonly code = "TEAM_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Team ${id} was not found.`);
  }
}

export class TeamVersionNotFoundError extends DomainError {
  readonly code = "TEAM_VERSION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Team version ${id} was not found.`);
  }
}

export class TeamAlreadyExistsError extends DomainError {
  readonly code = "TEAM_ALREADY_EXISTS";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A team named '${name}' already exists in this tenant.`);
  }
}

/** Any save-time validation failure that isn't one of the specifically-named codes
 * below (an unresolvable `definitionName@version` pin, a duplicate member key, a
 * `fallbackMemberKey` naming a member that doesn't exist, …). */
export class TeamValidationError extends DomainError {
  readonly code = "TEAM_VALIDATION_FAILED";
  readonly httpStatus = 422;
  constructor(message: string, fields?: Array<{ path: string; code: string; message: string }>) {
    super(message, fields);
  }
}

/**
 * FR-ORC-03 / LLD §14.7.2 — the supervisor must be a designated cheap
 * `chat.router`-class route, never a frontier model. 422 in strict mode (the
 * default for a real save), a 200-with-warning from `POST .../validate`.
 */
export class TeamSupervisorRouteExpensiveError extends DomainError {
  readonly code = "TEAM_SUPERVISOR_ROUTE_EXPENSIVE";
  readonly httpStatus = 422;
  constructor(routeName: string, detail: string) {
    super(
      `Supervisor route '${routeName}' is not a router-class route: ${detail}. FR-ORC-03 requires a designated cheap chat.router-class route for classification/routing — never a frontier model.`,
      [{ path: "supervisor.route", code: "TEAM_SUPERVISOR_ROUTE_EXPENSIVE", message: detail }],
    );
  }
}

/** LLD §14.7.2 — a cycle among `team_member.fallback_member_id` would make
 * FR-ORC-10's fallback path loop forever at runtime. Rejected at save. */
export class TeamFallbackCycleError extends DomainError {
  readonly code = "TEAM_FALLBACK_CYCLE";
  readonly httpStatus = 422;
  constructor(cycle: string[]) {
    super(`Team member fallback chain forms a cycle: ${cycle.join(" -> ")}. Every fallback chain must terminate in an 'Escalate' action.`, [
      { path: "members", code: "TEAM_FALLBACK_CYCLE", message: cycle.join(" -> ") },
    ]);
  }
}

/** FR-ORC-11 — a supervisor-only sandbox run does not satisfy the promotion gate. */
export class TeamSandboxTopologyIncompleteError extends DomainError {
  readonly code = "TEAM_SANDBOX_TOPOLOGY_INCOMPLETE";
  readonly httpStatus = 422;
  constructor(missingMemberKeys: string[]) {
    super(
      `The referenced sandbox run did not exercise the whole team topology — no delegation was recorded for member(s): ${missingMemberKeys.join(", ")}. FR-ORC-11 requires the sandbox run to exercise every member before a team version may be Approved.`,
      missingMemberKeys.map((k) => ({ path: `members.${k}`, code: "TEAM_SANDBOX_TOPOLOGY_INCOMPLETE", message: "no delegation_event recorded for this member" })),
    );
  }
}

export class IllegalTeamVersionTransition extends DomainError {
  readonly code = "ILLEGAL_TEAM_VERSION_TRANSITION";
  readonly httpStatus = 409;
  constructor(from: TeamVersionStatusValue, to: TeamVersionStatusValue) {
    super(`A team version cannot move from ${from} to ${to}.`);
  }
}

/** The promotion gate's own refusals (missing sandbox run, self-approval, missing
 * eval run) — distinct from an illegal FSM edge, which is `ILLEGAL_TEAM_VERSION_
 * TRANSITION`. */
export class TeamPromotionBlockedError extends DomainError {
  readonly code = "TEAM_PROMOTION_BLOCKED";
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`This team version cannot be promoted: ${reason}`);
  }
}
