import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";
import { EnvironmentSchema } from "./common.js";
import { BackendType, ConnectorAuthMethod, McpTransport } from "./connectors.js";
import { ApprovalTier } from "./tool-registry.js";

/**
 * Phase 3 (BL-34, LLD §14.3.2/§14.3.4) — the 9-step MCP enrolment wizard's contracts.
 * Builds on Phase 0's `mcp-registry` (ADR-0014) tables/behavior, which are untouched
 * here — these schemas describe the wizard's per-step request/response shapes only.
 */

export const McpCriticality = Type.Union([
  Type.Literal("Low"),
  Type.Literal("Medium"),
  Type.Literal("High"),
  Type.Literal("BusinessCritical"),
]);
export type McpCriticalityValue = Static<typeof McpCriticality>;

export const McpManifestItemKind = Type.Union([Type.Literal("Tool"), Type.Literal("Resource"), Type.Literal("Prompt")]);
export type McpManifestItemKindValue = Static<typeof McpManifestItemKind>;

export const RwClass = Type.Union([Type.Literal("Read"), Type.Literal("Write")]);
export type RwClassValue = Static<typeof RwClass>;

/** Step 1 — identify. */
export const McpIdentifyRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  backendType: BackendType,
  ownerUserId: Type.String({ format: "uuid" }),
  criticality: McpCriticality,
});
export type McpIdentifyRequest = Static<typeof McpIdentifyRequestSchema>;

/** Step 2 — transport and endpoint, one entry per environment (FR-MCP-19). */
export const McpTransportBindingSchema = Type.Object({
  environment: EnvironmentSchema,
  transport: McpTransport,
  endpointUrl: Type.Optional(Type.String({ format: "uri", pattern: "^https://" })),
  stdioCommand: Type.Optional(
    Type.Object({ command: Type.String(), args: Type.Array(Type.String()), env: Type.Record(Type.String(), Type.String()) }),
  ),
});
export type McpTransportBinding = Static<typeof McpTransportBindingSchema>;

export const McpTransportRequestSchema = Type.Object({
  bindings: Type.Array(McpTransportBindingSchema, { minItems: 1 }),
});
export type McpTransportRequest = Static<typeof McpTransportRequestSchema>;

/** Step 3 — authentication, credential captured SEPARATELY per environment
 * (FR-MCP-16 step 3: sandbox testing must never reach a live system). */
export const McpAuthBindingSchema = Type.Object({
  environment: EnvironmentSchema,
  authMethod: ConnectorAuthMethod,
  credentialPlaintext: Type.Optional(Type.String({ minLength: 1 })),
  credentialLabel: Type.Optional(Type.String()),
});
export type McpAuthBinding = Static<typeof McpAuthBindingSchema>;

export const McpAuthRequestSchema = Type.Object({
  bindings: Type.Array(McpAuthBindingSchema, { minItems: 1 }),
});
export type McpAuthRequest = Static<typeof McpAuthRequestSchema>;

/** Step 4 — discovery handshake response. */
export const McpDiscoveredItemSchema = Type.Object({
  kind: McpManifestItemKind,
  name: Type.String(),
  descriptionSource: Type.String(),
  schemaHash: Type.String(),
  suggestedIoClass: Type.Union([RwClass, Type.Null()]),
  suggestedApprovalTier: Type.Union([ApprovalTier, Type.Null()]),
  heuristicReason: Type.Union([Type.String(), Type.Null()]),
});
export type McpDiscoveredItem = Static<typeof McpDiscoveredItemSchema>;

export const McpDiscoverResponseSchema = Type.Object({
  manifestHash: Type.String(),
  itemCount: Type.Integer(),
  emptyNotice: Type.Optional(Type.Literal("No tools discovered — this server currently has nothing to enrol")),
  items: Type.Array(McpDiscoveredItemSchema),
  probedEnvironment: EnvironmentSchema,
});
export type McpDiscoverResponse = Static<typeof McpDiscoverResponseSchema>;

/** Step 5 — classification. Omitted `ioClass`/`approvalTier`/`enabled` fail closed
 * (Tier3 + disabled) at the service layer, never at the schema layer, so a partial
 * submission (an admin classifying a subset then coming back later) is still valid. */
export const McpClassifyItemSchema = Type.Object({
  kind: McpManifestItemKind,
  name: Type.String(),
  ioClass: Type.Optional(RwClass),
  approvalTier: Type.Optional(ApprovalTier),
  enabled: Type.Optional(Type.Boolean()),
  descriptionOverride: Type.Optional(Type.String()),
  knowledgeIngestionCandidate: Type.Optional(Type.Boolean()),
});
export type McpClassifyItem = Static<typeof McpClassifyItemSchema>;

export const McpClassifyRequestSchema = Type.Object({ items: Type.Array(McpClassifyItemSchema) });
export type McpClassifyRequest = Static<typeof McpClassifyRequestSchema>;

/** Step 6 — grouping (single-valued, §14.3.3 — no bridge table). */
export const McpGroupingItemSchema = Type.Object({
  kind: McpManifestItemKind,
  name: Type.String(),
  capabilityGroupId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
});
export type McpGroupingItem = Static<typeof McpGroupingItemSchema>;

export const McpGroupingRequestSchema = Type.Object({ items: Type.Array(McpGroupingItemSchema) });
export type McpGroupingRequest = Static<typeof McpGroupingRequestSchema>;

/** Step 7 — runtime policy (LLD §14.3.2 `McpRuntimePolicySchema`). */
export const McpRuntimePolicySchema = Type.Object(
  {
    timeoutMs: Type.Integer({ minimum: 1000, maximum: 120000, default: 15000 }),
    retryMax: Type.Integer({ minimum: 0, maximum: 5, default: 1 }),
    retryBackoff: Type.Union([Type.Literal("none"), Type.Literal("linear"), Type.Literal("exponential")]),
    circuitErrorRatePct: Type.Number({ minimum: 1, maximum: 100, default: 5 }),
    circuitOpenSeconds: Type.Integer({ minimum: 10, default: 60 }),
    perToolRateLimit: Type.Optional(
      Type.Object({ perMinute: Type.Optional(Type.Integer()), perConversation: Type.Optional(Type.Integer()) }),
    ),
    costAttributionTag: Type.Optional(Type.String({ maxLength: 64 })),
    egressAllowlist: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type McpRuntimePolicy = Static<typeof McpRuntimePolicySchema>;

/** Step 8 — dry run. Requires an already-classified Read tool (fail-closed: a write
 * or unclassified tool can never be the dry-run target). */
export const McpDryRunRequestSchema = Type.Object({
  toolName: Type.String(),
  environment: EnvironmentSchema,
  args: Type.Optional(Type.Unknown()),
});
export type McpDryRunRequest = Static<typeof McpDryRunRequestSchema>;

export const McpDryRunResponseSchema = Type.Object({
  toolName: Type.String(),
  environment: EnvironmentSchema,
  rawResult: Type.Unknown(),
  ranAt: Type.String({ format: "date-time" }),
});
export type McpDryRunResponse = Static<typeof McpDryRunResponseSchema>;

/** Step 9 — enrol. */
export const McpEnrolResponseSchema = Type.Object({
  serverId: Type.String({ format: "uuid" }),
  serverVersionId: Type.String({ format: "uuid" }),
  version: Type.Integer(),
  manifestHash: Type.String(),
  bindings: Type.Array(
    Type.Object({ environment: EnvironmentSchema, connectorId: Type.String({ format: "uuid" }), reachability: Type.String() }),
  ),
  materialisedToolIds: Type.Array(Type.String({ format: "uuid" })),
  auditLogEntryId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
});
export type McpEnrolResponse = Static<typeof McpEnrolResponseSchema>;

/** Drift review (reuses Phase 0's `mcp_drift_event`/reconciler unchanged). */
export const McpDriftReviewDecisionSchema = Type.Object({
  driftEventId: Type.String({ format: "uuid" }),
  action: Type.Union([Type.Literal("Accept"), Type.Literal("Reject")]),
  ioClass: Type.Optional(RwClass),
  approvalTier: Type.Optional(ApprovalTier),
  enabled: Type.Optional(Type.Boolean({ default: false })),
  capabilityGroupId: Type.Optional(Type.String({ format: "uuid" })),
  note: Type.Optional(Type.String()),
  schemaJsonForAccepted: Type.Optional(Type.Unknown()),
  descriptionSourceForAccepted: Type.Optional(Type.String()),
});
export type McpDriftReviewDecision = Static<typeof McpDriftReviewDecisionSchema>;

export const McpDriftReviewRequestSchema = Type.Object({
  decisions: Type.Array(McpDriftReviewDecisionSchema, { minItems: 1 }),
});
export type McpDriftReviewRequest = Static<typeof McpDriftReviewRequestSchema>;

// ---- Errors (LLD §14.3.4's error-code table) ----

export class McpServerNameDuplicateError extends DomainError {
  readonly code = "MCP_SERVER_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`An MCP server named '${name}' already exists.`);
  }
}

export class McpBindingRequiredError extends DomainError {
  readonly code = "MCP_BINDING_REQUIRED";
  readonly httpStatus = 422;
  constructor() {
    super("At least one environment binding is required before this server can leave Draft.");
  }
}

export class McpDiscoveryFailedError extends DomainError {
  readonly code = "MCP_DISCOVERY_FAILED";
  readonly httpStatus = 502;
  constructor(detail: string) {
    super(`Discovery failed: ${detail}`);
  }
}

export class McpVersionImmutableError extends DomainError {
  readonly code = "MCP_VERSION_IMMUTABLE";
  readonly httpStatus = 409;
  constructor() {
    super("This MCP server version is immutable and cannot be edited — drift produces a new version.");
  }
}

export class McpDraftNotFoundError extends DomainError {
  readonly code = "MCP_DRAFT_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Enrolment draft '${id}' was not found.`);
  }
}

export class McpWizardStepOutOfOrderError extends DomainError {
  readonly code = "MCP_WIZARD_STEP_OUT_OF_ORDER";
  readonly httpStatus = 409;
  constructor(expected: number, got: number) {
    super(`This draft is at step ${expected}; step ${got} cannot be completed yet.`);
  }
}

export class McpDryRunRequiresReadToolError extends DomainError {
  readonly code = "MCP_DRY_RUN_REQUIRES_READ_TOOL";
  readonly httpStatus = 422;
  constructor(name: string) {
    super(`'${name}' is not a classified, enabled Read tool — the dry run can only invoke a read-only tool.`);
  }
}

export class McpDriftAlreadyResolvedError extends DomainError {
  readonly code = "MCP_DRIFT_ALREADY_RESOLVED";
  readonly httpStatus = 409;
  constructor(id: string) {
    super(`Drift event '${id}' has already been resolved.`);
  }
}

export class McpDriftNoteRequiredError extends DomainError {
  readonly code = "MCP_DRIFT_NOTE_REQUIRED";
  readonly httpStatus = 422;
  constructor() {
    super("A note is required when rejecting a drift event.");
  }
}
