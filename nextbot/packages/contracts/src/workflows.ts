import { Type, type Static } from "@sinclair/typebox";
import { ChannelTypeSchema } from "./common.js";
import { ApprovalTier } from "./tool-registry.js";
import { DomainError } from "./errors.js";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1/
 * §14.6.3) — Workflow Designer, authoring half only. This file is the contract
 * surface for the STATIC, AUTHORABLE graph: the workflow artifact schema (all 12
 * node kinds), promotion-ladder vocabulary, and the CRUD/validate/diff/transition
 * request-response shapes. **Deliberately excludes** anything from LLD §14.6.2/
 * §14.6.4 (durable execution) — no `workflow_run`/`workflow_run_step` shape, no
 * checkpoint/resume protocol. That is Phase 16's contract surface, added to this
 * same file (or a sibling) when that phase ships.
 *
 * **Disclosed, deliberate narrowing of `NodeBase.scope`**: the dispatch brief's own
 * LLD quote gives `scope: Type.Optional(ScopeDescriptorSchema)` verbatim — the full
 * evaluator-facing shape, whose `origin`/`originId`/`originLabel` fields exist to
 * attribute a lattice level to a specific persisted row (LLD §14.2.1/§14.2.2). No
 * other artifact in this codebase lets an author hand-write those three fields
 * (`agent-platform`'s guardrail block, `skills`' `scope`, `teams`' `TeamScopeSpecSchema`
 * all use a narrower AUTHORABLE projection, with origin/originId/originLabel
 * synthesized server-side once the real row exists — see `teams/domain/team-scope.ts`'s
 * own doc comment). Requiring a workflow author to hand-write an `originId` they
 * cannot know until after save would be both impossible (chicken-and-egg: the id
 * doesn't exist yet) and a structural violation of "an author can never mislabel a
 * scope level" (LLD §14.2.2's own invariant). `WorkflowScopeSpecSchema` below is that
 * same authorable projection, applied consistently to both `spec.scope` (the
 * workflow-version level) and every node's own `scope` — `workflows/domain/
 * workflow-scope.ts` composes the real `ScopeDescriptor` (origin `WorkflowVersion` /
 * `WorkflowNode`) from it server-side, mirroring `composeTeamVersionScope`/
 * `composeTeamMemberScope` exactly.
 */

// ---------------------------------------------------------------------------
// Status/kind vocabulary (mirrors packages/db/src/schema/workflows.ts's enums)
// ---------------------------------------------------------------------------

export const WorkflowStatus = Type.Union([Type.Literal("Active"), Type.Literal("Archived")]);
export type WorkflowStatusValue = Static<typeof WorkflowStatus>;

/** Identical ladder to `agent_definition_version`/`skill_version`/`team_version`
 * (LLD §14.6.1's own wording: "identical ladder"). See `domain/promotion-policy.ts`
 * for the one deviation this phase discloses: `HumanReview -> Approved` additionally
 * requires `sandbox_run_id IS NOT NULL`, and genuinely cannot be reached in THIS
 * phase's build because `workflow_run` doesn't exist until Phase 16. */
export const WorkflowVersionStatus = Type.Union([
  Type.Literal("Draft"),
  Type.Literal("EvalGated"),
  Type.Literal("HumanReview"),
  Type.Literal("Approved"),
  Type.Literal("Production"),
  Type.Literal("Deprecated"),
]);
export type WorkflowVersionStatusValue = Static<typeof WorkflowVersionStatus>;

export const WorkflowNodeKind = Type.Union([
  Type.Literal("Trigger"),
  Type.Literal("Agent"),
  Type.Literal("Skill"),
  Type.Literal("ToolCall"),
  Type.Literal("Router"),
  Type.Literal("HumanTask"),
  Type.Literal("Parallel"),
  Type.Literal("Join"),
  Type.Literal("Loop"),
  Type.Literal("SubWorkflow"),
  Type.Literal("Wait"),
  Type.Literal("End"),
]);
export type WorkflowNodeKindValue = Static<typeof WorkflowNodeKind>;

/** The terminal outcomes a run can resolve to. Reused verbatim for `EndNode.outcome`
 * AND for `HumanTaskNode`/`WaitNode`'s `onTimeout` (what outcome a timed-out
 * suspension resolves the run to) — one vocabulary, never two. Stored as a plain
 * enum-shaped value this phase; real runtime enforcement (actually resolving the run
 * to this outcome on timeout) is Phase 16's executor, which doesn't exist yet. */
export const WorkflowRunOutcome = Type.Union([
  Type.Literal("Resolved"),
  Type.Literal("Escalated"),
  Type.Literal("Transferred"),
  Type.Literal("Failed"),
]);
export type WorkflowRunOutcomeValue = Static<typeof WorkflowRunOutcome>;

// ---------------------------------------------------------------------------
// Scope (authorable subset — see this file's own doc comment above)
// ---------------------------------------------------------------------------

/** Same authorable dimensions as `TeamScopeSpecSchema` (`teams.ts`) — the lattice
 * dimensions an artifact can actually narrow today. `origin`/`originId`/`originLabel`
 * are never authorable; the application layer supplies them. */
export const WorkflowScopeSpecSchema = Type.Object(
  {
    capabilityGroupIds: Type.Optional(Type.Union([Type.Literal("*"), Type.Array(Type.String({ format: "uuid" }))])),
    toolIds: Type.Optional(Type.Union([Type.Literal("*"), Type.Array(Type.String({ format: "uuid" }))])),
    deniedToolIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
    knowledgeCollectionIds: Type.Optional(Type.Union([Type.Literal("*"), Type.Array(Type.String({ format: "uuid" }))])),
    rwClasses: Type.Optional(Type.Array(Type.Union([Type.Literal("Read"), Type.Literal("Write")]))),
    autonomyCeiling: Type.Optional(ApprovalTier),
    minRequiredTier: Type.Optional(ApprovalTier),
    trustLevel: Type.Optional(Type.Union([Type.Literal("Trusted"), Type.Literal("SemiTrusted"), Type.Literal("Untrusted")])),
  },
  { additionalProperties: false },
);
export type WorkflowScopeSpec = Static<typeof WorkflowScopeSpecSchema>;

// ---------------------------------------------------------------------------
// Node schemas (LLD §14.6.3 — all 12 kinds)
// ---------------------------------------------------------------------------

const NODE_ID_PATTERN = "^[a-z][a-z0-9_]{0,63}$";

const OnErrorSchema = Type.Union([
  Type.Literal("fail"),
  Type.Literal("continue"),
  Type.Literal("compensate"),
  Type.Literal("escalate"),
]);

const RetrySchema = Type.Object(
  {
    max: Type.Integer({ minimum: 0, maximum: 5 }),
    backoff: Type.Union([Type.Literal("none"), Type.Literal("linear"), Type.Literal("exponential")]),
  },
  { additionalProperties: false },
);

/** The fields every node kind shares (LLD §14.6.3's `NodeBase`). Spread into each
 * node's own `Type.Object` alongside its kind-specific fields — TypeBox has no
 * inheritance primitive that composes cleanly with a discriminated union AND
 * `additionalProperties: false` on every member, so this is a plain object-literal
 * helper, not a `Type.Composite`. */
function nodeBaseProps<K extends string>(kind: K) {
  return {
    id: Type.String({ pattern: NODE_ID_PATTERN }),
    kind: Type.Literal(kind),
    label: Type.Optional(Type.String({ maxLength: 200 })),
    scope: Type.Optional(WorkflowScopeSpecSchema),
    onError: Type.Optional(OnErrorSchema),
    retry: Type.Optional(RetrySchema),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 600_000 })),
  };
}

/** A conditional edge — `when` is a CEL-subset expression. **Disclosed narrowing**:
 * this phase stores/validates `when` as a non-empty string only; a real CEL
 * evaluator is Phase 16's runtime concern (there is no executor to evaluate it
 * against yet). */
export const EdgeSchema = Type.Object(
  { to: Type.String({ minLength: 1 }), when: Type.Optional(Type.String({ minLength: 1 })) },
  { additionalProperties: false },
);
export type Edge = Static<typeof EdgeSchema>;

/** `"$.variables.x"`-shaped expression mappings — used for every node kind that
 * maps run variables onto a callee's input, or a callee's output back onto a
 * variable. */
const MappingSchema = Type.Record(Type.String(), Type.String());

// --- Trigger -----------------------------------------------------------------

const ChannelEventSourceSchema = Type.Object(
  {
    kind: Type.Literal("ChannelEvent"),
    channelTypes: Type.Array(ChannelTypeSchema, { minItems: 1 }),
    event: Type.Union([
      Type.Literal("conversation.started"),
      Type.Literal("message.received"),
      Type.Literal("goal.recognized"),
    ]),
    goalPattern: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const WebhookSourceSchema = Type.Object(
  {
    kind: Type.Literal("Webhook"),
    path: Type.String({ minLength: 1 }),
    /** A credential-vault reference — a webhook trigger is NEVER unauthenticated. */
    signatureCredentialId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
);

const ScheduleSourceSchema = Type.Object(
  { kind: Type.Literal("Schedule"), cron: Type.String({ minLength: 1 }), timezone: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export const TriggerSourceSchema = Type.Union([ChannelEventSourceSchema, WebhookSourceSchema, ScheduleSourceSchema]);
export type TriggerSource = Static<typeof TriggerSourceSchema>;

export const TriggerNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Trigger"),
    source: TriggerSourceSchema,
    inputSchema: Type.Optional(Type.Unknown()),
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// --- Agent / Skill (pinned delegation) ---------------------------------------

export const AgentNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Agent"),
    /** PINNED — never a name (FR-WF-04's reproducibility invariant). */
    agentDefinitionVersionId: Type.String({ format: "uuid" }),
    inputMapping: MappingSchema,
    outputVariable: Type.String({ minLength: 1 }),
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const SkillNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Skill"),
    skillVersionId: Type.String({ format: "uuid" }),
    inputMapping: MappingSchema,
    outputVariable: Type.String({ minLength: 1 }),
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// --- ToolCall ------------------------------------------------------------------

const IdempotencySchema = Type.Object(
  {
    strategy: Type.Union([Type.Literal("RunScopedUuid"), Type.Literal("DerivedFromArgs"), Type.Literal("CallerSupplied")]),
    argPath: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const CompensationSchema = Type.Object(
  { toolId: Type.String({ format: "uuid" }), argMapping: MappingSchema },
  { additionalProperties: false },
);

/** `idempotency`/`compensation` are schema-OPTIONAL here — V5 (`graph-validator.ts`)
 * is what actually enforces they're present when the pinned tool's `rw_class` is
 * `'Write'`, a cross-field rule TypeBox alone cannot express. */
export const ToolCallNodeSchema = Type.Object(
  {
    ...nodeBaseProps("ToolCall"),
    toolId: Type.String({ format: "uuid" }),
    /** FR-MCP-21 reproducibility pin — the exact MCP server version this call was
     * authored/validated against. */
    mcpServerVersionId: Type.String({ format: "uuid" }),
    argMapping: MappingSchema,
    outputVariable: Type.String({ minLength: 1 }),
    idempotency: Type.Optional(IdempotencySchema),
    compensation: Type.Optional(CompensationSchema),
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// --- Router --------------------------------------------------------------------

/** `default` is schema-OPTIONAL, mirroring `Loop.maxIterations`/`Join.quorum`'s
 * pattern — V11 (`graph-validator.ts`) is what actually enforces "REQUIRED, no
 * implicit fallthrough" with its own dedicated `WORKFLOW_ROUTER_DEFAULT_REQUIRED`
 * code: a router with no matching branch and no declared default would otherwise
 * be a silent dead end. */
export const RouterNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Router"),
    mode: Type.Union([Type.Literal("Rules"), Type.Literal("Classifier")]),
    /** Classifier mode only — validated at save (`graph-validator.ts`) to resolve
     * to a cheap `chat.router`-class route, reusing the exact check Phase 14 built
     * for team supervisors (`@nextbot/model-gateway`'s `isRouterClassRoute`). */
    classifierRouteVersionId: Type.Optional(Type.String({ format: "uuid" })),
    branches: Type.Array(EdgeSchema, { minItems: 1 }),
    default: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

// --- HumanTask -------------------------------------------------------------------

export const HumanTaskNodeSchema = Type.Object(
  {
    ...nodeBaseProps("HumanTask"),
    /** Routes into one of the two EXISTING queues (`approvals`' Tier-3 Approval
     * Queue, `escalations`' `agent_queue`) — never a third, workflow-owned queue. */
    queue: Type.Union([Type.Literal("ApprovalQueue"), Type.Literal("EscalationQueue")]),
    /** ApprovalQueue only. The only tier a `HumanTask` node can author is `Tier3`
     * (the tier that always stops for approval regardless of autonomy ceiling) —
     * a `HumanTask` node IS the human-in-the-loop point, so a lower tier here would
     * be self-contradictory. */
    approvalTier: Type.Optional(Type.Literal("Tier3")),
    /** EscalationQueue only — a real `agent_queue.id` (V9). */
    escalationQueueId: Type.Optional(Type.String({ format: "uuid" })),
    escalationReason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    prompt: Type.String({ minLength: 1, maxLength: 4000 }),
    timeoutSeconds: Type.Integer({ minimum: 60, maximum: 604_800 }),
    onTimeout: WorkflowRunOutcome,
    next: Type.String({ minLength: 1 }),
    onReject: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

// --- Parallel / Join -------------------------------------------------------------

export const ParallelNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Parallel"),
    branches: Type.Array(Type.String({ minLength: 1 }), { minItems: 2 }),
    joinNodeId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** `quorum` is schema-OPTIONAL — V11 (`graph-validator.ts`) enforces it's present
 * if and only if `mode === 'Quorum'`. */
export const JoinNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Join"),
    parallelNodeId: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal("All"), Type.Literal("Any"), Type.Literal("Quorum")]),
    quorum: Type.Optional(Type.Integer({ minimum: 1 })),
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// --- Loop --------------------------------------------------------------------------

/** `maxIterations` is schema-OPTIONAL, mirroring `JoinNode.quorum`/
 * `ToolCallNode.idempotency`'s pattern — V4 (`graph-validator.ts`) is the rule that
 * actually enforces "MANDATORY, no default" with its own dedicated
 * `WORKFLOW_LOOP_CAP_REQUIRED` code and message, exactly as LLD §14.6.3 assigns it
 * a rule number rather than leaving it to a generic structural-validation error.
 * `over`/`whileCondition` are both optional and not mutually exclusive at the
 * schema level — a loop may iterate a collection AND additionally bound itself by
 * a condition; V4 only requires the iteration cap. */
export const LoopNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Loop"),
    over: Type.Optional(Type.String({ minLength: 1 })),
    whileCondition: Type.Optional(Type.String({ minLength: 1 })),
    maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    bodyEntryNodeId: Type.String({ minLength: 1 }),
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// --- SubWorkflow ---------------------------------------------------------------

export const SubWorkflowNodeSchema = Type.Object(
  {
    ...nodeBaseProps("SubWorkflow"),
    /** PINNED — an exact `workflow_version.id`, never a name (reproducibility,
     * same discipline as `agentDefinitionVersionId`/`skillVersionId`). */
    workflowVersionId: Type.String({ format: "uuid" }),
    inputMapping: MappingSchema,
    outputVariable: Type.String({ minLength: 1 }),
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// --- Wait ------------------------------------------------------------------------

export const WaitNodeSchema = Type.Object(
  {
    ...nodeBaseProps("Wait"),
    mode: Type.Union([Type.Literal("Timer"), Type.Literal("ExternalEvent")]),
    durationSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
    eventKey: Type.Optional(Type.String({ minLength: 1 })),
    timeoutSeconds: Type.Integer({ minimum: 1, maximum: 2_592_000 }),
    onTimeout: WorkflowRunOutcome,
    next: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// --- End ---------------------------------------------------------------------------

export const EndNodeSchema = Type.Object(
  { ...nodeBaseProps("End"), outcome: WorkflowRunOutcome, message: Type.Optional(Type.String({ maxLength: 2000 })) },
  { additionalProperties: false },
);

export const WorkflowNodeSchema = Type.Union([
  TriggerNodeSchema,
  AgentNodeSchema,
  SkillNodeSchema,
  ToolCallNodeSchema,
  RouterNodeSchema,
  HumanTaskNodeSchema,
  ParallelNodeSchema,
  JoinNodeSchema,
  LoopNodeSchema,
  SubWorkflowNodeSchema,
  WaitNodeSchema,
  EndNodeSchema,
]);
export type WorkflowNode = Static<typeof WorkflowNodeSchema>;

// ---------------------------------------------------------------------------
// Run limits + the whole graph artifact
// ---------------------------------------------------------------------------

/** FR-WF safety ceilings. **ALL required, no schema-level defaults** — an author
 * who omits one has expressed nothing, not "unlimited" (same discipline
 * `TeamLimitsSchema` established for FR-ORC-07). */
export const WorkflowRunLimitsSchema = Type.Object(
  {
    maxSteps: Type.Integer({ minimum: 1 }),
    maxCostUsd: Type.Number({ minimum: 0 }),
    maxWallClockSeconds: Type.Integer({ minimum: 1 }),
    maxLoopIterations: Type.Integer({ minimum: 1, maximum: 1000 }),
    maxParallelBranches: Type.Integer({ minimum: 1 }),
    maxSubWorkflowDepth: Type.Integer({ minimum: 0, maximum: 8 }),
  },
  { additionalProperties: false },
);
export type WorkflowRunLimits = Static<typeof WorkflowRunLimitsSchema>;

/** The authored workflow YAML artifact (LLD §14.6.3). Canvas layout hints
 * (`spec.layout`) are excluded from `yaml_hash` (moving a box on the canvas is
 * never a new version) — see `domain/workflow-artifact.ts`'s hashing function. */
export const WorkflowGraphSchema = Type.Object(
  {
    apiVersion: Type.Literal("nextbot.io/v1"),
    kind: Type.Literal("Workflow"),
    metadata: Type.Object(
      { name: Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}$" }), version: Type.Integer({ minimum: 1 }) },
      { additionalProperties: false },
    ),
    spec: Type.Object(
      {
        nodes: Type.Array(WorkflowNodeSchema, { minItems: 2 }),
        runLimits: WorkflowRunLimitsSchema,
        scope: Type.Optional(WorkflowScopeSpecSchema),
        /** Canvas positions/zoom/etc — opaque to this schema (the console owns the
         * shape), EXCLUDED from `yaml_hash` per this file's own module doc. */
        layout: Type.Optional(Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type WorkflowGraph = Static<typeof WorkflowGraphSchema>;

// ---------------------------------------------------------------------------
// CRUD / validate / diff / transition request-response shapes (LLD §14.6.4's
// authoring-half endpoints — this phase's API surface)
// ---------------------------------------------------------------------------

export const CreateWorkflowRequestSchema = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}$" }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    /** Creating a workflow always creates version 1 in the same call — there is no
     * "empty" workflow with zero versions (same convention `skills`/`teams` use). */
    artifact: WorkflowGraphSchema,
  },
  { additionalProperties: false },
);
export type CreateWorkflowRequest = Static<typeof CreateWorkflowRequestSchema>;

export const UpdateWorkflowRequestSchema = Type.Object(
  { description: Type.Optional(Type.String({ maxLength: 2000 })), status: Type.Optional(WorkflowStatus) },
  { additionalProperties: false },
);
export type UpdateWorkflowRequest = Static<typeof UpdateWorkflowRequestSchema>;

export const CreateWorkflowVersionRequestSchema = Type.Object({ artifact: WorkflowGraphSchema }, { additionalProperties: false });
export type CreateWorkflowVersionRequest = Static<typeof CreateWorkflowVersionRequestSchema>;

/** `POST .../validate` takes raw YAML text (mirroring `teams`' identical endpoint) —
 * the handler parses it server-side so a YAML syntax error is reported the same way
 * a structural/graph error is, not as a 400 the console has to special-case. */
export const ValidateWorkflowVersionRequestSchema = Type.Object({ yaml: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export type ValidateWorkflowVersionRequest = Static<typeof ValidateWorkflowVersionRequestSchema>;

export const TransitionWorkflowVersionRequestSchema = Type.Object(
  { to: WorkflowVersionStatus, reason: Type.Optional(Type.String({ maxLength: 2000 })) },
  { additionalProperties: false },
);
export type TransitionWorkflowVersionRequest = Static<typeof TransitionWorkflowVersionRequestSchema>;

/** One V1-V12 (or schema-level) failure — `path` names the offending node id (or a
 * dotted field path within it), never a generic "invalid graph" message. */
export const WorkflowGraphIssueSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  path: Type.Union([Type.String(), Type.Null()]),
});
export type WorkflowGraphIssue = Static<typeof WorkflowGraphIssueSchema>;

export const WorkflowValidationResponseSchema = Type.Object({
  valid: Type.Boolean(),
  errors: Type.Array(WorkflowGraphIssueSchema),
});
export type WorkflowValidationResponse = Static<typeof WorkflowValidationResponseSchema>;

/** Every V1-V12 error code `graph-validator.ts` can raise, centralized here for
 * documentation/type-safety at call sites that branch on a specific code.
 *
 * `WORKFLOW_ROUTER_CLASSIFIER_ROUTE_EXPENSIVE` and `WORKFLOW_ARTIFACT_INVALID`/
 * `WORKFLOW_ARTIFACT_INVALID_YAML` are disclosed additions beyond the LLD's
 * literal 12-rule table: the first enforces `RouterNode`'s own field-level
 * requirement ("Classifier mode MUST resolve to a cheap chat.router-class route")
 * which the table's V9 codes (existence/deprecation) don't otherwise cover; the
 * latter two are `domain/workflow-artifact.ts`'s structural/YAML-parse failures,
 * which are reported through the exact same `WorkflowGraphIssue` shape as the 12
 * graph-level rules so the console never has to special-case "structural" vs
 * "semantic" errors. */
export type WorkflowGraphIssueCode =
  | "WORKFLOW_TRIGGER_REQUIRED"
  | "WORKFLOW_EDGE_UNRESOLVED"
  | "WORKFLOW_UNTERMINATED_PATH"
  | "WORKFLOW_LOOP_CAP_REQUIRED"
  | "WORKFLOW_WRITE_NODE_UNSAFE"
  | "WORKFLOW_PARALLEL_UNBALANCED"
  | "WORKFLOW_UNBOUNDED_CYCLE"
  | "WORKFLOW_SUBWORKFLOW_DEPTH"
  | "WORKFLOW_REFERENCE_NOT_FOUND"
  | "WORKFLOW_REFERENCE_DEPRECATED"
  | "WORKFLOW_NODE_SCOPE_EMPTY"
  | "WORKFLOW_ROUTER_DEFAULT_REQUIRED"
  | "WORKFLOW_JOIN_QUORUM_REQUIRED"
  | "WORKFLOW_HUMAN_TASK_MISCONFIGURED"
  | "WORKFLOW_ROUTER_CLASSIFIER_ROUTE_EXPENSIVE"
  | "WORKFLOW_ARTIFACT_INVALID"
  | "WORKFLOW_ARTIFACT_INVALID_YAML";

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class WorkflowNotFoundError extends DomainError {
  readonly code = "WORKFLOW_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Workflow '${id}' was not found.`);
  }
}

export class WorkflowVersionNotFoundError extends DomainError {
  readonly code = "WORKFLOW_VERSION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Workflow version '${id}' was not found.`);
  }
}

export class WorkflowNameDuplicateError extends DomainError {
  readonly code = "WORKFLOW_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A workflow named '${name}' already exists for this tenant.`);
  }
}

/** Any V1-V12 graph-validation failure, or a structural (TypeBox) failure — always
 * carries every failing rule, not just the first (`fields`), so the console can
 * highlight every offending node at once. */
export class WorkflowGraphValidationError extends DomainError {
  readonly code = "WORKFLOW_GRAPH_VALIDATION_FAILED";
  readonly httpStatus = 422;
  constructor(readonly issues: WorkflowGraphIssue[]) {
    super(
      `Workflow graph failed validation: ${issues.map((i) => `${i.path ?? "(root)"}: ${i.message}`).join("; ")}`,
      issues.map((i) => ({ path: i.path ?? "(root)", code: i.code, message: i.message })),
    );
  }
}

/** Maps the `workflow_version_immutable` Postgres trigger's raised exception (LLD
 * §14.6.1 enforcement layer 2) if it is somehow ever reached — every application
 * code path is expected to hit this only via a bug, since the repository layer
 * (enforcement layer 1) never exposes a generic update. */
export class WorkflowVersionImmutableError extends DomainError {
  readonly code = "WORKFLOW_VERSION_IMMUTABLE";
  readonly httpStatus = 409;
  constructor(id: string) {
    super(`Workflow version '${id}' is immutable and cannot be modified.`);
  }
}

export class IllegalWorkflowVersionTransition extends DomainError {
  readonly code = "ILLEGAL_WORKFLOW_VERSION_TRANSITION";
  readonly httpStatus = 409;
  constructor(from: WorkflowVersionStatusValue, to: WorkflowVersionStatusValue) {
    super(`A workflow version cannot move from ${from} to ${to}.`);
  }
}

/** The promotion gate's own refusals (missing eval run, self-approval, missing
 * `sandbox_run_id`) — distinct from an illegal FSM edge, which is
 * `ILLEGAL_WORKFLOW_VERSION_TRANSITION`. */
export class WorkflowPromotionBlockedError extends DomainError {
  readonly code = "WORKFLOW_PROMOTION_BLOCKED";
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`This workflow version cannot be promoted: ${reason}`);
  }
}
