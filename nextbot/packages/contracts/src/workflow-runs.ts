import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { DomainError } from "./errors.js";
import { WorkflowNodeKind } from "./workflows.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05/06/07, LLD §14.6.2/
 * §14.6.5) — Workflow Designer, **durable execution half**. Phase 15's `workflows.ts`
 * is the contract surface for the STATIC, AUTHORABLE graph and says of this file's
 * content: "That is Phase 16's contract surface, added to this same file (or a
 * sibling) when that phase ships." This is that sibling.
 *
 * Placement authority for the executor these shapes describe: **ADR-0013 §7**
 * (amendment, 2026-08-30) and LLD §14.6.2's dated CORRECTION block — the executor is a
 * module in `packages/modules/workflows` hosted in-process by `apps/worker`, not a
 * `run-orchestrator` in `apps/runtime` (which has never existed). The SHAPES below are
 * unchanged from the original LLD §14.6.2 text; only the host and the timer mechanism
 * were corrected.
 */

// ---------------------------------------------------------------------------
// Runtime vocabulary (mirrors packages/db/src/schema/workflows.ts's runtime enums)
// ---------------------------------------------------------------------------

export const WorkflowRunState = Type.Union([
  Type.Literal("Pending"),
  Type.Literal("Running"),
  Type.Literal("Suspended"),
  /** FR-WF-04's unwind pass — a failed run with a non-empty compensation stack. */
  Type.Literal("Compensating"),
  Type.Literal("Succeeded"),
  Type.Literal("Failed"),
  Type.Literal("TimedOut"),
  Type.Literal("Cancelled"),
]);
export type WorkflowRunStateValue = Static<typeof WorkflowRunState>;

/**
 * The RUN-level outcome vocabulary — deliberately WIDER than `workflows.ts`'s
 * `WorkflowRunOutcome`, which is the 4-value **authorable** union an `End` node's
 * `outcome` or a `Wait`/`HumanTask` node's `onTimeout` may declare.
 *
 * `BudgetExceeded`/`Timeout`/`Cancelled` are outcomes only the RUNTIME can produce, so
 * no author can express one and no authored node can be mislabelled as one. FR-WF-06's
 * "exceeding any ceiling terminates the run at outcome `BudgetExceeded`, logged
 * distinctly from a node-level `Failed`" is therefore a type-level distinction rather
 * than a naming convention.
 */
export const WorkflowRunTerminalOutcome = Type.Union([
  Type.Literal("Resolved"),
  Type.Literal("Escalated"),
  Type.Literal("Transferred"),
  Type.Literal("Failed"),
  Type.Literal("BudgetExceeded"),
  Type.Literal("Timeout"),
  Type.Literal("Cancelled"),
]);
export type WorkflowRunTerminalOutcomeValue = Static<typeof WorkflowRunTerminalOutcome>;

export const WorkflowTriggerKind = Type.Union([
  Type.Literal("ChannelEvent"),
  Type.Literal("Webhook"),
  Type.Literal("Schedule"),
  Type.Literal("Manual"),
  Type.Literal("Sandbox"),
  Type.Literal("SubWorkflow"),
]);
export type WorkflowTriggerKindValue = Static<typeof WorkflowTriggerKind>;

export const WorkflowStepStatus = Type.Union([
  Type.Literal("Pending"),
  Type.Literal("Running"),
  Type.Literal("Suspended"),
  Type.Literal("Succeeded"),
  Type.Literal("Failed"),
  /** A branch the run legitimately did not take (an unselected Router edge, a Loop
   *  body past its final iteration) — recorded rather than omitted, so the FR-WF-07
   *  trace shows what was considered, not only what ran. */
  Type.Literal("Skipped"),
  Type.Literal("Compensated"),
  Type.Literal("Cancelled"),
]);
export type WorkflowStepStatusValue = Static<typeof WorkflowStepStatus>;

export const SuspensionKind = Type.Union([
  Type.Literal("HumanTask"),
  Type.Literal("Wait"),
  Type.Literal("SubWorkflow"),
  /** A Tier-2/Tier-3 tool call that stopped at the EXISTING Approval Queue
   *  (ADR-0013 §2.3: "there is no third queue"). */
  Type.Literal("Approval"),
]);
export type SuspensionKindValue = Static<typeof SuspensionKind>;

export const WorkflowStepRefKind = Type.Union([
  Type.Literal("AgentVersion"),
  Type.Literal("SkillVersion"),
  Type.Literal("Tool"),
  Type.Literal("WorkflowVersion"),
  Type.Literal("None"),
]);
export type WorkflowStepRefKindValue = Static<typeof WorkflowStepRefKind>;

// ---------------------------------------------------------------------------
// The checkpoint (LLD §14.6.2's `WorkflowCheckpointSchema`, verbatim)
// ---------------------------------------------------------------------------

/** An arbitrary JSON value. Declared recursively via `Type.Recursive` so the run's
 *  variable map can hold real nested structures (a tool's output object, a mapped
 *  array) rather than only scalars, while still being a closed, checkable schema. */
export const JsonValueSchema: TSchema = Type.Recursive((self) =>
  Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null(), Type.Array(self), Type.Record(Type.String(), self)]),
);
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/**
 * **The whole resumable state of a run** (LLD §14.6.2). Everything the executor needs
 * to continue after any restart, on any replica, lives here — which is what makes the
 * executor's host a deployment fact rather than a schema fact.
 *
 * `additionalProperties: false` on purpose: a checkpoint that silently accumulated
 * undeclared keys would be a place executor state could hide, defeating the whole
 * point of a single declared resumable shape.
 */
export const WorkflowCheckpointSchema = Type.Object(
  {
    /** The run's data plane. PII-masked before persistence, through `@nextbot/pii`'s
     *  EXISTING masker — never a second masking path. */
    variables: Type.Record(Type.String(), JsonValueSchema),
    /** The set of node positions the run is currently at. More than one entry while a
     *  `Parallel` region is open; `branchKey` discriminates the branches. */
    frontier: Type.Array(
      Type.Object(
        {
          nodeId: Type.String(),
          branchKey: Type.Union([Type.String(), Type.Null()]),
          iteration: Type.Integer(),
        },
        { additionalProperties: false },
      ),
    ),
    /** `Join` node id -> barrier state. `arrived` holds the `branchKey`s that have
     *  reached the join, so `All`/`Any`/`Quorum` are decided from persisted facts
     *  rather than from in-process bookkeeping that a crash would lose. */
    joinBarriers: Type.Record(
      Type.String(),
      Type.Object({ expected: Type.Integer(), arrived: Type.Array(Type.String()) }, { additionalProperties: false }),
    ),
    loopCounters: Type.Record(Type.String(), Type.Integer()),
    /** FR-WF-04: the compensation stack, deepest-last. Unwound on `Compensating`.
     *  Each entry carries the idempotency key the original write used, so a
     *  compensating action is itself replay-safe. */
    compensations: Type.Array(
      Type.Object(
        {
          stepId: Type.String({ format: "uuid" }),
          nodeId: Type.String(),
          toolId: Type.String({ format: "uuid" }),
          args: JsonValueSchema,
          idempotencyKey: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    /** FR-WF-06's live accumulator, checked against `workflow_version.run_limits`
     *  before every node. */
    consumed: Type.Object({ usd: Type.Number(), seconds: Type.Number(), steps: Type.Integer() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);
export type WorkflowCheckpoint = Static<typeof WorkflowCheckpointSchema>;
export type WorkflowFrontierEntry = WorkflowCheckpoint["frontier"][number];
export type WorkflowCompensationEntry = WorkflowCheckpoint["compensations"][number];

// ---------------------------------------------------------------------------
// Read DTOs (LLD §14.6.5)
// ---------------------------------------------------------------------------

export const WorkflowRunDtoSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  workflowVersionId: Type.String({ format: "uuid" }),
  conversationId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  triggerKind: WorkflowTriggerKind,
  parentRunId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  depth: Type.Integer(),
  state: WorkflowRunState,
  outcome: Type.Union([WorkflowRunTerminalOutcome, Type.Null()]),
  outcomeDetail: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  currentNodeIds: Type.Array(Type.String()),
  stepsExecuted: Type.Integer(),
  costUsd: Type.String(),
  suspensionKind: Type.Union([SuspensionKind, Type.Null()]),
  suspensionRef: Type.Union([Type.String(), Type.Null()]),
  suspensionExpiresAt: Type.Union([Type.String(), Type.Null()]),
  otelTraceId: Type.String(),
  startedAt: Type.String(),
  endedAt: Type.Union([Type.String(), Type.Null()]),
});
export type WorkflowRunDto = Static<typeof WorkflowRunDtoSchema>;

export const WorkflowRunStepDtoSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  nodeId: Type.String(),
  nodeKind: WorkflowNodeKind,
  attempt: Type.Integer(),
  iteration: Type.Integer(),
  branchKey: Type.Union([Type.String(), Type.Null()]),
  refKind: WorkflowStepRefKind,
  refVersionId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  refLabel: Type.Union([Type.String(), Type.Null()]),
  status: WorkflowStepStatus,
  input: Type.Unknown(),
  output: Type.Unknown(),
  error: Type.Union([Type.Object({ code: Type.String(), message: Type.String(), retriable: Type.Boolean() }), Type.Null()]),
  toolCallId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  approvalRequestId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  escalationId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  childRunId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  compensationOfStepId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  costUsd: Type.String(),
  startedAt: Type.String(),
  endedAt: Type.Union([Type.String(), Type.Null()]),
});
export type WorkflowRunStepDto = Static<typeof WorkflowRunStepDtoSchema>;

// ---------------------------------------------------------------------------
// Request shapes (LLD §14.6.5's remaining endpoints)
// ---------------------------------------------------------------------------

/** `POST .../versions/{versionId}/sandbox-run`. The HTTP `Idempotency-Key` header is
 *  REQUIRED (LLD §14.6.5) and becomes `workflow_run.idempotency_key`, so a retried
 *  request resumes the existing run rather than starting a second one. */
export const StartSandboxRunRequestSchema = Type.Object(
  {
    /** Seeds `checkpoint.variables` — the same shape a real trigger's payload takes. */
    input: Type.Optional(Type.Record(Type.String(), JsonValueSchema)),
    /** Optional. Without one, the run cannot suspend into the Approval Queue (see
     *  `workflow_run.conversation_id`'s own doc) — a sandbox run of a graph containing
     *  a Tier-2/3 tool node therefore needs one to exercise that path for real. */
    conversationId: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);
export type StartSandboxRunRequest = Static<typeof StartSandboxRunRequestSchema>;

export const CancelWorkflowRunRequestSchema = Type.Object({ reason: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false });
export type CancelWorkflowRunRequest = Static<typeof CancelWorkflowRunRequestSchema>;

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class WorkflowRunNotFoundError extends DomainError {
  readonly code = "WORKFLOW_RUN_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Workflow run '${id}' was not found.`);
  }
}

/** A terminal run cannot be cancelled or resumed. Distinct from "not found" so the
 *  console can say why the action is unavailable rather than implying the run is gone. */
export class WorkflowRunNotActionableError extends DomainError {
  readonly code = "WORKFLOW_RUN_NOT_ACTIONABLE";
  readonly httpStatus = 409;
  constructor(id: string, state: WorkflowRunStateValue, action: string) {
    super(`Workflow run '${id}' is '${state}' and cannot be ${action}.`);
  }
}

/** The `Idempotency-Key` header LLD §14.6.5 marks REQUIRED on `/sandbox-run` was
 *  absent. Rejected rather than defaulted: silently generating a key would defeat the
 *  exact property the header exists to provide (a retried start resumes, never
 *  duplicates). */
export class WorkflowRunIdempotencyKeyRequiredError extends DomainError {
  readonly code = "WORKFLOW_RUN_IDEMPOTENCY_KEY_REQUIRED";
  readonly httpStatus = 400;
  constructor() {
    super("An Idempotency-Key header is required to start a workflow run.");
  }
}

/** A `workflow_run` persist lost the optimistic-concurrency check — the run advanced
 *  under a different lease holder while this one held a stale view. Always a signal to
 *  drop the pass and let the next pump tick re-claim, never to retry the write. */
export class WorkflowRunCheckpointConflictError extends DomainError {
  readonly code = "WORKFLOW_RUN_CHECKPOINT_CONFLICT";
  readonly httpStatus = 409;
  constructor(id: string, expectedSeq: number) {
    super(`Workflow run '${id}' advanced past checkpoint sequence ${expectedSeq} under another executor.`);
  }
}

/** No `Production` workflow version declares a `Webhook` trigger at this path. Returned
 *  as a 404 with no detail, so the endpoint cannot be used to enumerate a tenant's
 *  configured trigger paths. */
export class WorkflowTriggerNotFoundError extends DomainError {
  readonly code = "WORKFLOW_TRIGGER_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("No workflow trigger is configured at this path.");
  }
}

/** The webhook body did not carry a valid HMAC signature for the trigger's declared
 *  `signatureCredentialId`. A `TriggerNode` is "never unauthenticated" by schema
 *  (`@nextbot/contracts`' `WebhookSourceSchema`), and this is where that holds at
 *  runtime. The message is deliberately generic — signature-verification detail is
 *  logged server-side only. */
export class WorkflowTriggerSignatureInvalidError extends DomainError {
  readonly code = "WORKFLOW_TRIGGER_SIGNATURE_INVALID";
  readonly httpStatus = 401;
  constructor() {
    super("The request signature could not be verified.");
  }
}
