import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";
import { ChannelTypeSchema, EnvironmentSchema } from "./common.js";
import { BackendType } from "./connectors.js";

export const ApprovalTier = Type.Union([Type.Literal("Tier1"), Type.Literal("Tier2"), Type.Literal("Tier3")]);
export type ApprovalTierValue = Static<typeof ApprovalTier>;

export const RuleScope = Type.Union([Type.Literal("Tool"), Type.Literal("Connector"), Type.Literal("BackendType")]);
export type RuleScopeValue = Static<typeof RuleScope>;

export const PermissionEffect = Type.Union([
  Type.Literal("Allow"),
  Type.Literal("Deny"),
  Type.Literal("RequireApproval"),
]);
export type PermissionEffectValue = Static<typeof PermissionEffect>;

/** LLD §3.6 `PermissionConditionSchema`. `expression` is a CEL-subset string,
 * evaluated sandboxed by the resolver's caller — this schema only validates shape. */
export const PermissionConditionSchema = Type.Object({
  channelTypes: Type.Optional(Type.Array(ChannelTypeSchema)),
  roleIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  recognizedTasks: Type.Optional(Type.Array(Type.String())),
  customerSegments: Type.Optional(Type.Array(Type.String())),
  environments: Type.Optional(Type.Array(EnvironmentSchema)),
  expression: Type.Optional(Type.String()),
});
export type PermissionCondition = Static<typeof PermissionConditionSchema>;

export const CreatePermissionRuleRequestSchema = Type.Object({
  scope: RuleScope,
  toolId: Type.Optional(Type.String({ format: "uuid" })),
  connectorId: Type.Optional(Type.String({ format: "uuid" })),
  backendType: Type.Optional(BackendType),
  ordinal: Type.Integer({ minimum: 0 }),
  conditions: PermissionConditionSchema,
  effect: PermissionEffect,
  requiredTier: Type.Optional(ApprovalTier),
  enabled: Type.Optional(Type.Boolean()),
});
export type CreatePermissionRuleRequest = Static<typeof CreatePermissionRuleRequestSchema>;

/** Result shape of `permission-resolver.ts`'s `resolve()` (LLD §3.6). */
export const PermissionResolutionSchema = Type.Object({
  effect: PermissionEffect,
  tier: Type.Union([ApprovalTier, Type.Null()]),
  matchedRuleId: Type.Union([Type.String(), Type.Null()]),
  reason: Type.String(),
});
export type PermissionResolution = Static<typeof PermissionResolutionSchema>;

// ---------------------------------------------------------------------------
// Capability groups (Phase 6, BL-28, FR-MCP-17) — management screen over the
// existing `capability_group` table (LLD §14.3.3: no new table, no bridge table).
// ---------------------------------------------------------------------------

export const CreateCapabilityGroupRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  guidanceText: Type.Optional(Type.String({ maxLength: 2000 })),
  priorityWeight: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type CreateCapabilityGroupRequest = Static<typeof CreateCapabilityGroupRequestSchema>;

/** `guidanceText: null` explicitly clears the field (distinct from omitting it, which
 * leaves the existing value untouched) — mirrors this codebase's existing PATCH
 * convention of "only supplied keys change." */
export const UpdateCapabilityGroupRequestSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  guidanceText: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  priorityWeight: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type UpdateCapabilityGroupRequest = Static<typeof UpdateCapabilityGroupRequestSchema>;

export class CapabilityGroupNameDuplicateError extends DomainError {
  readonly code = "CAPABILITY_GROUP_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A capability group named '${name}' already exists.`);
  }
}

export class ToolNotFoundError extends DomainError {
  readonly code = "TOOL_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Tool '${id}' was not found.`);
  }
}

export class PermissionRuleInvalidError extends DomainError {
  readonly code = "PERMISSION_RULE_INVALID";
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`Invalid permission rule: ${reason}`);
  }
}
