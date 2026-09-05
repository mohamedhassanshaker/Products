import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";

/**
 * Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5) — Skills
 * library contracts. `SkillArtifactSchema` is the authored YAML shape verbatim from
 * the Blueprint's own §8.1 example: a flat, top-level object (no `spec` wrapper,
 * unlike `AgentDefinitionArtifactSchema`) — the skill's smaller, flatter field set
 * doesn't need one.
 */

export const SkillVersionStatus = Type.Union([Type.Literal("Draft"), Type.Literal("Published"), Type.Literal("Deprecated")]);
export type SkillVersionStatusValue = Static<typeof SkillVersionStatus>;

export const SkillStatus = Type.Union([Type.Literal("Active"), Type.Literal("Archived")]);
export type SkillStatusValue = Static<typeof SkillStatus>;

const ApprovalTier = Type.Union([Type.Literal("AutoApprove"), Type.Literal("RequireApproval"), Type.Literal("Forbidden")]);

const BudgetSchema = Type.Object(
  {
    maxCostUsdPerConversation: Type.Optional(Type.String()),
    maxLatencyMsP95: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const SkillArtifactSchema = Type.Object(
  {
    kind: Type.Literal("skill"),
    name: Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}$" }),
    version: Type.Integer({ minimum: 1 }),
    trigger: Type.String({ minLength: 1 }),
    scope: Type.Object(
      {
        capabilityGroups: Type.Array(Type.String()), // by name
        tools: Type.Array(Type.String()), // "payment.refund@billing_core"
        knowledge: Type.Array(Type.String()), // collection names (Phase 7+ resolves these)
        rwClasses: Type.Optional(Type.Array(Type.Union([Type.Literal("Read"), Type.Literal("Write")]))),
        autonomyCeiling: Type.Optional(ApprovalTier),
        budget: Type.Optional(BudgetSchema),
      },
      { additionalProperties: false },
    ),
    instructions: Type.String({ minLength: 1 }),
    successCriteria: Type.String({ minLength: 1 }),
    escalateWhen: Type.Array(Type.String()),
    evalCases: Type.Array(Type.String()), // eval-case keys, resolved by agent-platform at compose time
  },
  { additionalProperties: false },
);
export type SkillArtifact = Static<typeof SkillArtifactSchema>;

// ---------------------------------------------------------------------------
// Skill CRUD requests (LLD §14.5.4's endpoint list)
// ---------------------------------------------------------------------------

export const CreateSkillRequestSchema = Type.Object({
  name: Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}$" }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  /** The first version's artifact — creating a skill always creates version 1 in
   * one call (there is no "empty" skill with zero versions). */
  artifact: SkillArtifactSchema,
});
export type CreateSkillRequest = Static<typeof CreateSkillRequestSchema>;

export const CreateSkillVersionRequestSchema = Type.Object({
  artifact: SkillArtifactSchema,
});
export type CreateSkillVersionRequest = Static<typeof CreateSkillVersionRequestSchema>;

export const DeprecateSkillVersionRequestSchema = Type.Object({
  note: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type DeprecateSkillVersionRequest = Static<typeof DeprecateSkillVersionRequestSchema>;

// ---------------------------------------------------------------------------
// Where-used + upgrade-consumers (LLD §14.5.4, ADR-0015 §2.3/§2.4)
// ---------------------------------------------------------------------------

export const SkillWhereUsedResponseSchema = Type.Object({
  consumers: Type.Array(
    Type.Object({
      consumerKind: Type.Union([Type.Literal("AgentVersion"), Type.Literal("WorkflowVersion")]),
      consumerId: Type.String({ format: "uuid" }),
      consumerLabel: Type.String(), // "support_triage v2.4.0"
      consumerStatus: Type.String(), // Draft | Production | …
      pinnedSkillVersion: Type.Integer(),
      behindBy: Type.Integer(), // currentPublished - pinned
      /** An already-generated, still-unpromoted upgrade draft, if any. Non-null =>
       * a second upgrade-consumers run skips this consumer (idempotency). */
      pendingUpgradeDraftId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    }),
  ),
  currentPublishedVersion: Type.Union([Type.Integer(), Type.Null()]),
});
export type SkillWhereUsedResponse = Static<typeof SkillWhereUsedResponseSchema>;

export const UpgradeConsumersRequestSchema = Type.Object({
  toSkillVersionId: Type.String({ format: "uuid" }),
  /** Omit => every consumer currently behind `toSkillVersionId`. */
  consumerIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  dryRun: Type.Optional(Type.Boolean({ default: false })),
});
export type UpgradeConsumersRequest = Static<typeof UpgradeConsumersRequestSchema>;

export const UpgradeConsumersSkipReason = Type.Union([
  Type.Literal("AlreadyOnTargetVersion"),
  Type.Literal("PendingUpgradeDraftExists"), // idempotency guard, FR-AGT-12
  Type.Literal("ConsumerDeprecated"),
  Type.Literal("ValidationFailed"),
]);
export type UpgradeConsumersSkipReasonValue = Static<typeof UpgradeConsumersSkipReason>;

export const UpgradeConsumersResponseSchema = Type.Object({
  created: Type.Array(
    Type.Object({
      consumerId: Type.String({ format: "uuid" }),
      newDraftVersionId: Type.String({ format: "uuid" }),
      newVersionLabel: Type.String(), // "support_triage v2.5.0-draft"
    }),
  ),
  skipped: Type.Array(
    Type.Object({
      consumerId: Type.String({ format: "uuid" }),
      reason: UpgradeConsumersSkipReason,
      detail: Type.Optional(Type.String()),
    }),
  ),
});
export type UpgradeConsumersResponse = Static<typeof UpgradeConsumersResponseSchema>;

// ---------------------------------------------------------------------------
// Domain errors (LLD §11.2 pattern)
// ---------------------------------------------------------------------------

export class SkillNotFoundError extends DomainError {
  readonly code = "SKILL_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Skill '${id}' was not found.`);
  }
}

export class SkillVersionNotFoundError extends DomainError {
  readonly code = "SKILL_VERSION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Skill version '${id}' was not found.`);
  }
}

export class SkillNameDuplicateError extends DomainError {
  readonly code = "SKILL_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A skill named '${name}' already exists for this tenant.`);
  }
}

/**
 * ADR-0015 §2.2 / FR-AGT-11 — a skill (or an agent version composing one) names a
 * capability group, tool, or knowledge collection that does not exist or is not
 * enabled for the tenant. `fields` always names the exact offending path
 * (`scope.tools[1]`), never a generic "invalid scope" message.
 */
export class SkillReferenceNotFoundError extends DomainError {
  readonly code = "SKILL_REFERENCE_NOT_FOUND";
  readonly httpStatus = 422;
  constructor(path: string, message: string) {
    super(message, [{ path, code: "SKILL_REFERENCE_NOT_FOUND", message }]);
  }
}

/** Maps the `skill_version_immutable` Postgres trigger's raised exception (LLD
 * §14.5.1 enforcement layer 2) if it is somehow ever reached — every application
 * code path is expected to hit this only via a bug, never via ordinary use, since
 * the repository layer (enforcement layer 1) never exposes a generic update. */
export class SkillVersionImmutableError extends DomainError {
  readonly code = "SKILL_VERSION_IMMUTABLE";
  readonly httpStatus = 409;
  constructor(id: string) {
    super(`Skill version '${id}' is immutable and cannot be modified.`);
  }
}

/** A skill version cannot be published/deprecated because it (or the skill) is not
 * in the expected state — e.g. publishing an already-Published version. */
export class SkillVersionStatusInvalidError extends DomainError {
  readonly code = "SKILL_VERSION_STATUS_INVALID";
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
  }
}
