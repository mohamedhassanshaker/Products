import { Type, type Static } from "@sinclair/typebox";
import { ChannelTypeSchema, EnvironmentSchema } from "./common.js";
import { ApprovalTier } from "./tool-registry.js";
import { RwClass } from "./mcp-registry.js";
import { ConnectorTrustLevelSchema, PiiContextSchema, PiiMaskActionSchema } from "./audit-pii.js";
import { DomainError } from "./errors.js";

/**
 * Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2) — the
 * permission-intersection evaluator's contract surface. Everything here is a pure
 * data shape; the algorithm itself lives in `@nextbot/authz` (`domain/intersect.ts`).
 *
 * Reused vocabulary (deliberately NOT re-declared): `ApprovalTier` (§3.6,
 * `tool-registry.ts`), `RwClass` (§3.5, `mcp-registry.ts`), `ChannelTypeSchema`/
 * `EnvironmentSchema` (`common.ts`), and the PII masking-context matrix's own
 * `PiiContextSchema`/`PiiMaskActionSchema`/`ConnectorTrustLevelSchema`
 * (`audit-pii.ts`) — LLD §14.2.1's `MaskingContext`/`MaskAction`/`TrustLevel`
 * dimensions are exactly these three, aliased below rather than duplicated, so a
 * change to the PII masking vocabulary can never silently drift out of sync with
 * the evaluator's own idea of the same concept.
 */
export const MaskingContext = PiiContextSchema;
export const MaskAction = PiiMaskActionSchema;
export const TrustLevel = ConnectorTrustLevelSchema;
export type TrustLevelValue = Static<typeof TrustLevel>;

/** LLD §14.2.2 — every artifact kind whose declared scope can appear as a `chain`
 * element or as the tenant floor. */
export const ScopeOrigin = Type.Union([
  Type.Literal("TenantPolicy"),
  Type.Literal("AgentVersion"),
  Type.Literal("Skill"),
  Type.Literal("TeamVersion"),
  Type.Literal("TeamMember"),
  Type.Literal("WorkflowVersion"),
  Type.Literal("WorkflowNode"),
  Type.Literal("KnowledgeCollection"),
  Type.Literal("Channel"),
]);
export type ScopeOriginValue = Static<typeof ScopeOrigin>;

/** `'*'` is a *bounded* top (LLD §14.2.1): `'*' ∧ ['a']` is `['a']`, never `'*'` —
 * an artifact declaring `tools: '*'` inherits exactly the caller's set, it can
 * never widen it. */
export const IdSetSchema = Type.Union([Type.Literal("*"), Type.Array(Type.String({ format: "uuid" }))]);
export type IdSet = Static<typeof IdSetSchema>;

/** LLD §14.2.1's `budget` dimension — every field `min`s across the chain,
 * `undefined` treated as `+∞` (E9). Deliberately independent of `model_budget`
 * (§3.10): the evaluator is not the cost backstop, `orchestration` still applies
 * that separately. */
export const BudgetSchema = Type.Object(
  {
    usdPerTurn: Type.Optional(Type.Number({ minimum: 0 })),
    seconds: Type.Optional(Type.Number({ minimum: 0 })),
    maxSteps: Type.Optional(Type.Integer({ minimum: 0 })),
    maxDepth: Type.Optional(Type.Integer({ minimum: 0 })),
    maxFanOut: Type.Optional(Type.Integer({ minimum: 0 })),
    maxDelegations: Type.Optional(Type.Integer({ minimum: 0 })),
    maxHops: Type.Optional(Type.Integer({ minimum: 0 })),
    maxExpansions: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type Budget = Static<typeof BudgetSchema>;

/**
 * LLD §14.2.1/§14.2.2 — one level of the scope lattice. `additionalProperties:
 * false` is **load-bearing** (edge case E2): an unrecognised dimension name (an
 * older/newer artifact YAML) must fail closed at structural validation, never be
 * silently dropped.
 */
export const ScopeDescriptorSchema = Type.Object(
  {
    origin: ScopeOrigin,
    /** uuid | 'tenant' | `${skillName}@${version}` — appears verbatim in the trace. */
    originId: Type.String(),
    /** Human-readable, rendered in the Approval Queue + trace tree. */
    originLabel: Type.String(),

    capabilityGroupIds: Type.Optional(IdSetSchema),
    toolIds: Type.Optional(IdSetSchema),
    /** Deny-shaped: meet is **union**, deny only ever grows. */
    deniedToolIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
    knowledgeCollectionIds: Type.Optional(IdSetSchema),
    channelTypes: Type.Optional(Type.Union([Type.Literal("*"), Type.Array(ChannelTypeSchema)])),
    environments: Type.Optional(Type.Union([Type.Literal("*"), Type.Array(EnvironmentSchema)])),
    rwClasses: Type.Optional(Type.Array(RwClass)),
    autonomyCeiling: Type.Optional(ApprovalTier),
    minRequiredTier: Type.Optional(ApprovalTier),
    trustLevel: Type.Optional(TrustLevel),
    /** `Partial` — LLD §14.2.1's `⊤` for this dimension is `{}` (no context has a
     * declared floor yet), so every context key must be independently optional;
     * a bare `Type.Record` over a closed literal-union key set is fully
     * *required* by TypeBox's own semantics (see `iam.ts`'s `PermissionMatrixSchema`,
     * which deliberately wants that — this dimension deliberately does not). */
    maskingFloor: Type.Optional(Type.Partial(Type.Record(MaskingContext, MaskAction))),
    allowOutOfRegionInference: Type.Optional(Type.Boolean()),
    /** Deny-shaped in spirit (stricter wins): meet is logical **OR**. */
    refuseWhenUngrounded: Type.Optional(Type.Boolean()),
    minCitations: Type.Optional(Type.Integer({ minimum: 0 })),
    budget: Type.Optional(BudgetSchema),
    /** Deny-shaped: meet is **union**. */
    piiContextsRequiringReeval: Type.Optional(Type.Array(MaskingContext)),
  },
  { additionalProperties: false },
);
export type ScopeDescriptor = Static<typeof ScopeDescriptorSchema>;

/** What the caller is actually trying to do right now (LLD §14.2.2). Omitting a
 * field means that dimension is evaluated for *scope* (the fold still narrows it)
 * but not for *permission* (no requested-capability check fires against it). */
export const RequestedCapabilitySchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("ToolCall"),
      Type.Literal("AgentDelegation"),
      Type.Literal("SkillActivation"),
      Type.Literal("WorkflowNode"),
      Type.Literal("KnowledgeRetrieval"),
      Type.Literal("ModelCall"),
    ]),
    toolId: Type.Optional(Type.String({ format: "uuid" })),
    /** The tool's ONE capability group (§14.3.3); absent ⇒ Ungrouped. */
    toolCapabilityGroupId: Type.Optional(Type.String({ format: "uuid" })),
    toolRwClass: Type.Optional(RwClass),
    toolApprovalTier: Type.Optional(ApprovalTier),
    knowledgeCollectionIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
    channelType: Type.Optional(ChannelTypeSchema),
    environment: Type.Optional(EnvironmentSchema),
    targetRegion: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type RequestedCapability = Static<typeof RequestedCapabilitySchema>;

export const PermissionIntersectionInputSchema = Type.Object(
  {
    tenantId: Type.String({ format: "uuid" }),
    /** origin MUST be 'TenantPolicy' — checked at structural-validation step 0. */
    tenantPolicy: ScopeDescriptorSchema,
    /** Caller-first, callee-last. `chain[0].origin` must NOT be 'TenantPolicy'. */
    chain: Type.Array(ScopeDescriptorSchema, { minItems: 1 }),
    requested: Type.Optional(RequestedCapabilitySchema),
    /**
     * **Disclosed, additive completion of LLD §14.2.3 step 4g**: the algorithm's
     * pseudocode compares `requested.targetRegion` against "the tenant residency
     * region", but §14.2.2's formal contract never says how the evaluator itself
     * learns that value — it isn't a lattice dimension (only
     * `allowOutOfRegionInference`, a boolean gate, is). Rather than guess at an
     * implicit source, this optional field carries it explicitly: the caller
     * (which already has `TenantContext`/`tenant_data_policy.residencyRegion`)
     * supplies it, and step 4g's comparison is only performed when BOTH
     * `requested.targetRegion` and this field are present — omitting either means
     * "not applicable to this call" (RequestedCapabilitySchema's own documented
     * convention), never a residency violation by default.
     */
    tenantResidencyRegion: Type.Optional(Type.String()),
    /** Delegation/sub-workflow depth of `chain`'s last element. */
    depth: Type.Integer({ minimum: 0 }),
    /** Run-so-far consumption, for the budget/depth ceilings in step 2. */
    consumed: Type.Optional(
      Type.Object({
        usd: Type.Number(),
        seconds: Type.Number(),
        steps: Type.Integer(),
        delegations: Type.Integer(),
        fanOut: Type.Integer(),
      }),
    ),
  },
  { additionalProperties: false },
);
export type PermissionIntersectionInput = Static<typeof PermissionIntersectionInputSchema>;

export const DenyReason = Type.Union([
  Type.Literal("EMPTY_CAPABILITY_INTERSECTION"),
  Type.Literal("TOOL_NOT_IN_SCOPE"),
  Type.Literal("TOOL_EXPLICITLY_DENIED"),
  Type.Literal("RW_CLASS_NOT_PERMITTED"),
  Type.Literal("KNOWLEDGE_COLLECTION_NOT_IN_SCOPE"),
  Type.Literal("CHANNEL_NOT_IN_SCOPE"),
  Type.Literal("ENVIRONMENT_NOT_IN_SCOPE"),
  Type.Literal("RESIDENCY_VIOLATION"),
  Type.Literal("DELEGATION_DEPTH_EXCEEDED"),
  Type.Literal("DELEGATION_COUNT_EXCEEDED"),
  Type.Literal("FAN_OUT_EXCEEDED"),
  Type.Literal("STEP_BUDGET_EXCEEDED"),
  Type.Literal("COST_BUDGET_EXCEEDED"),
  Type.Literal("WALL_CLOCK_BUDGET_EXCEEDED"),
  Type.Literal("SCOPE_DIMENSION_UNKNOWN"),
  Type.Literal("SCOPE_MALFORMED"),
  Type.Literal("EVALUATOR_ERROR"),
]);
export type DenyReasonValue = Static<typeof DenyReason>;

export const PermissionIntersectionResultSchema = Type.Object({
  decision: Type.Union([Type.Literal("Allow"), Type.Literal("Deny")]),
  /** Present on Allow. The narrowed scope the callee must execute under — the
   * caller MUST pass this (not its own scope) to the next hop. */
  effectiveScope: Type.Optional(ScopeDescriptorSchema),
  /** Present on Allow for kind='ToolCall'. NEVER lower than the tool's own tier
   * (step 5 is a `max` — E7). */
  requiredTier: Type.Optional(ApprovalTier),
  /** true ⇒ requiredTier > autonomyCeiling ⇒ route to the Approval Queue. This is
   * NEVER a deny (E6) — FR-WF-03/FR-ORC-04 require the call to *reach* the
   * Approval Queue rather than silently vanish. */
  requiresApproval: Type.Optional(Type.Boolean()),
  denyReason: Type.Optional(DenyReason),
  /** Names the dimension AND the narrowing origin. */
  denyDetail: Type.Optional(Type.String()),
  /** Per-dimension audit trail. Always populated, on Allow and Deny alike. */
  trace: Type.Array(
    Type.Object({
      dimension: Type.String(),
      before: Type.Unknown(),
      after: Type.Unknown(),
      narrowedBy: Type.Union([ScopeOrigin, Type.Null()]),
      narrowedByLabel: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  /** sha256 of the canonicalised `(tenantPolicy, chain, requested)` — the cache
   * key and the value written to `tool_call.scope_hash` / `delegation_event.scope_hash`. */
  scopeHash: Type.String(),
});
export type PermissionIntersectionResult = Static<typeof PermissionIntersectionResultSchema>;

// ---------------------------------------------------------------------------
// §14.2.7 — `POST /api/v1/admin/authz/simulate` (RBAC: security_settings:Read).
// Request carries artifact *references* (not inline scopes), so an admin can
// simulate without hand-writing YAML; the handler resolves each reference to a
// real `ScopeDescriptor` and then calls the exact same `evaluate()`/
// `evaluateOrDeny()` the runtime uses — never a parallel approximation.
// ---------------------------------------------------------------------------

export const AuthzSimulateChainRefSchema = Type.Union([
  Type.Object({ ref: Type.Literal("agentVersion"), id: Type.String({ format: "uuid" }) }),
  Type.Object({ ref: Type.Literal("skillVersion"), id: Type.String({ format: "uuid" }) }),
  Type.Object({ ref: Type.Literal("teamVersion"), id: Type.String({ format: "uuid" }) }),
  Type.Object({ ref: Type.Literal("teamMember"), id: Type.String({ format: "uuid" }) }),
  Type.Object({ ref: Type.Literal("workflowVersion"), id: Type.String({ format: "uuid" }) }),
  Type.Object({ ref: Type.Literal("workflowNode"), workflowVersionId: Type.String({ format: "uuid" }), nodeId: Type.String() }),
  Type.Object({ ref: Type.Literal("inline"), scope: ScopeDescriptorSchema }),
]);
export type AuthzSimulateChainRef = Static<typeof AuthzSimulateChainRefSchema>;

export const AuthzSimulateRequestSchema = Type.Object(
  {
    chain: Type.Array(AuthzSimulateChainRefSchema, { minItems: 1 }),
    requested: Type.Optional(RequestedCapabilitySchema),
    depth: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type AuthzSimulateRequest = Static<typeof AuthzSimulateRequestSchema>;

/** Verbatim `PermissionIntersectionResult` — trace included — so the console's
 * "what would this chain actually grant" preview is never an approximation of the
 * runtime's own answer. */
export type AuthzSimulateResponse = PermissionIntersectionResult;

/** A `chain` ref pointing at an artifact kind whose module doesn't persist a real
 * `ScopeDescriptor` yet in this build (teams/workflows are Phase 14/15; agent
 * versions don't carry a `scope_json` column this phase — see this module's
 * README). Disclosed limitation, not a silent gap: the caller is told exactly
 * which ref kind isn't resolvable yet and pointed at the `inline` escape hatch. */
export class AuthzRefNotYetSupportedError extends DomainError {
  readonly code = "AUTHZ_REF_NOT_YET_SUPPORTED";
  readonly httpStatus = 422;
  constructor(ref: string) {
    super(
      `Simulating a '${ref}' chain reference is not yet supported: the artifact kind this ref resolves to does not yet persist a real ScopeDescriptor in this build (its module/schema ships in a later phase). Use an 'inline' reference to simulate this dimension today.`,
    );
  }
}

/**
 * Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-14) — the guardrail
 * tightening-only invariant's own error: a Text/Design/Studio-authored agent
 * version attempted to declare a scope dimension LOOSER than the tenant floor
 * (`tenant_scope_policy`). `path` names the exact offending field — either a bare
 * lattice dimension name (e.g. `"refuseWhenUngrounded"`) or, for the per-context
 * `maskingFloor` dimension, `"maskingFloor.<Context>"` (e.g.
 * `"maskingFloor.Transcript"`) so the console can point at the exact matrix cell.
 * Thrown by `@nextbot/authz`'s `assertTightensOnly` and surfaced by
 * `agent-platform`'s single artifact validator — this blocks **saving as Draft**,
 * not merely promotion (FR-AGT-14's own wording), identically for every authoring
 * mode, since all three funnel through the same validator function.
 */
export class GuardrailLoosenedError extends DomainError {
  readonly code = "GUARDRAIL_LOOSENED";
  readonly httpStatus = 422;
  constructor(
    readonly path: string,
    readonly tenantValue: unknown,
    readonly proposedValue: unknown,
  ) {
    super(
      `Guardrail policy for '${path}' cannot be relaxed relative to the tenant default (tenant floor: ${JSON.stringify(tenantValue)}, proposed: ${JSON.stringify(proposedValue)}). Tenant policy is the floor, not the ceiling.`,
      [
        {
          path,
          code: "GUARDRAIL_LOOSENED",
          message: `Cannot relax '${path}' from tenant floor ${JSON.stringify(tenantValue)} to ${JSON.stringify(proposedValue)}. Tenant policy is the floor.`,
        },
      ],
    );
  }
}
