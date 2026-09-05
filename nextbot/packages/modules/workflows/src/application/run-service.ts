import { createHash } from "node:crypto";
import { generateId, type TenantContext } from "@nextbot/db";
// Retry-1 QA fix (Target Architecture Blueprint Phase 16, BL-47b, blocking defect):
// the webhook trigger's signature was a naive `createHash(secret + "." + body)` — NOT
// an HMAC, and forgeable via a length-extension attack. Reuses the SAME real
// HMAC-SHA256 + constant-time-comparison primitives `@nextbot/agent-platform`'s own
// (already-correct) `git-connection-service.ts` webhook verification uses, rather than
// a second, independently-written implementation. `agent-platform` is already an
// allowed `workflows -> module` edge (`eslint.config.mjs`'s `MODULE_ALLOW_LIST.workflows`),
// so this is not a new cross-module dependency.
import { computeHmacSha256Hex, constantTimeEquals } from "@nextbot/agent-platform";
import {
  WorkflowRunIdempotencyKeyRequiredError,
  WorkflowRunNotActionableError,
  WorkflowRunNotFoundError,
  WorkflowTriggerNotFoundError,
  WorkflowTriggerSignatureInvalidError,
  WorkflowVersionNotFoundError,
  type JsonValue,
  type WorkflowGraph,
  type WorkflowRunDto,
  type WorkflowRunStepDto,
  type WorkflowTriggerKindValue,
} from "@nextbot/contracts";
import { emptyCheckpoint, withVariables } from "../domain/checkpoint.js";
import { isTerminalRunState } from "../domain/run-fsm.js";
import { composeWorkflowVersionScope } from "../domain/workflow-scope.js";
import { findWorkflowById, findWorkflowVersionById, getWorkflowVersion, listProductionWorkflowVersions } from "../infrastructure/workflow-repository.js";
import {
  createWorkflowRun,
  findWorkflowRunById,
  listWorkflowRuns,
  listWorkflowRunSteps,
  terminateRun,
  type ListWorkflowRunsFilter,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from "../infrastructure/workflow-run-repository.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.5) — the application
 * services behind the durable-execution half's API surface: sandbox runs, the runs
 * list, the FR-WF-07 graph trace, cancel/resume, and the signature-verified webhook
 * trigger.
 *
 * **Nothing here executes a node.** Every endpoint below either creates a `Pending` run
 * or reads/terminates an existing one; advancing runs is exclusively
 * `workflow.run-pump`'s job, under a `workflow_run_lease`. That separation is what keeps
 * "exactly one executor advances a run at a time" true even though an HTTP request and a
 * worker tick can arrive at the same instant — an HTTP handler simply has no code path
 * that can advance a run.
 */

// ---------------------------------------------------------------------------
// Starting runs
// ---------------------------------------------------------------------------

export interface StartRunInput {
  workflowVersionId: string;
  triggerKind: WorkflowTriggerKindValue;
  /** REQUIRED for `/sandbox-run` (LLD §14.6.5 marks the `Idempotency-Key` header so).
   *  Becomes `workflow_run.idempotency_key`, whose `(tenant_id, idempotency_key)` UNIQUE
   *  is the whole mechanism by which a retried start resumes rather than duplicates. */
  idempotencyKey: string;
  input?: Record<string, JsonValue>;
  conversationId?: string | null;
  agentRunId?: string | null;
}

/**
 * Creates a `Pending` run, or returns the one that already exists for this idempotency
 * key.
 *
 * The run is created with an EMPTY frontier: `workflow.run-pump` seeds it with the
 * graph's `Trigger` node on first claim. That keeps this path a pure insert (no graph
 * parse in the request), and it means a run created by an HTTP handler and a run created
 * by a `SubWorkflow` node take the identical code path from here on.
 *
 * @returns the run and whether THIS call created it — `created: false` is an idempotent
 *   replay, which callers surface as `200` rather than `201`.
 */
export async function startWorkflowRun(ctx: TenantContext, input: StartRunInput): Promise<{ run: WorkflowRunRow; created: boolean }> {
  if (!input.idempotencyKey?.trim()) throw new WorkflowRunIdempotencyKeyRequiredError();

  const version = await getWorkflowVersion(ctx, input.workflowVersionId);
  const workflow = await findWorkflowById(ctx, version.workflowId);
  if (!workflow) throw new WorkflowVersionNotFoundError(input.workflowVersionId);

  // The SAME scope composition the graph validator used at save time, recomputed here
  // rather than read from `scope_json` so `scope_hash` on the run reflects the artifact
  // as it actually is, not as a possibly-stale denormalization says it is.
  const scope = composeWorkflowVersionScope({
    workflowVersionId: `${workflow.name}@${version.version}`,
    workflowLabel: `${workflow.name}@${version.version}`,
    runLimits: version.runLimits,
    spec: (version.graphJson as WorkflowGraph).spec.scope,
  });
  const scopeHash = createHash("sha256").update(JSON.stringify(scope)).digest("hex").slice(0, 32);

  return createWorkflowRun(ctx, {
    workflowVersionId: version.id,
    conversationId: input.conversationId ?? null,
    agentRunId: input.agentRunId ?? null,
    triggerKind: input.triggerKind,
    depth: 0,
    checkpoint: withVariables(emptyCheckpoint(), input.input ?? {}),
    scopeHash,
    // A real trace id so the run's steps and any agent turn it invokes land in the same
    // OTel trace, per FR-WF-07's "the existing Runtime Traces component renders the path
    // over the authored graph".
    otelTraceId: generateId().replace(/-/g, ""),
    idempotencyKey: input.idempotencyKey,
  });
}

/** `POST /api/v1/admin/workflows/{id}/versions/{versionId}/sandbox-run`. A real
 *  `workflow_run` with `trigger_kind = 'Sandbox'` — not a mock console (ADR-0013 §2.2:
 *  "the sandbox run … uses the existing single widget artifact, not a mock console"). */
export async function startSandboxRun(
  ctx: TenantContext,
  versionId: string,
  idempotencyKey: string,
  body: { input?: Record<string, JsonValue>; conversationId?: string },
): Promise<{ run: WorkflowRunRow; created: boolean }> {
  return startWorkflowRun(ctx, {
    workflowVersionId: versionId,
    triggerKind: "Sandbox",
    idempotencyKey,
    input: body.input,
    conversationId: body.conversationId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRuns(ctx: TenantContext, filter: ListWorkflowRunsFilter): Promise<WorkflowRunDto[]> {
  return (await listWorkflowRuns(ctx, filter)).map(toRunDto);
}

/**
 * `GET /api/v1/admin/workflow-runs/{id}` — returns `{ run, graph, steps }` so the
 * EXISTING Runtime Traces component renders **the path over the authored graph**
 * (FR-WF-07), rather than a flat list. There is deliberately no second trace viewer.
 *
 * The graph comes from the run's OWN pinned `workflow_version`, not from the workflow's
 * current version: a trace must be read against the artifact that actually executed, or
 * a run of version 3 would be rendered over version 7's boxes.
 */
export async function getRunWithTrace(ctx: TenantContext, runId: string): Promise<{ run: WorkflowRunDto; graph: WorkflowGraph; steps: WorkflowRunStepDto[] }> {
  const run = await findWorkflowRunById(ctx, runId);
  if (!run) throw new WorkflowRunNotFoundError(runId);
  const version = await getWorkflowVersion(ctx, run.workflowVersionId);
  const steps = await listWorkflowRunSteps(ctx, runId);
  return { run: toRunDto(run), graph: version.graphJson, steps: steps.map(toStepDto) };
}

// ---------------------------------------------------------------------------
// Cancel / resume
// ---------------------------------------------------------------------------

/**
 * `POST /api/v1/admin/workflow-runs/{id}/cancel`.
 *
 * CAS-scoped to the four non-terminal states, so cancelling a run that finished a
 * millisecond earlier is a clean `409` rather than a second terminal write that would
 * overwrite the real outcome.
 *
 * A cancelled run does NOT run its compensation stack. That is deliberate and worth
 * stating: an operator cancelling a run is asking it to stop, and silently issuing a
 * series of compensating write calls they did not ask for would be a surprising side
 * effect of a "stop" button. Any writes already applied stay applied, and the run's
 * steps record exactly what happened.
 */
export async function cancelRun(ctx: TenantContext, runId: string, reason: string | undefined, actingUserId: string): Promise<WorkflowRunRow> {
  const run = await findWorkflowRunById(ctx, runId);
  if (!run) throw new WorkflowRunNotFoundError(runId);
  if (isTerminalRunState(run.state)) throw new WorkflowRunNotActionableError(runId, run.state, "cancelled");

  const { terminated, run: updated } = await terminateRun(ctx, runId, ["Pending", "Running", "Suspended", "Compensating"], "Cancelled", "Cancelled", {
    reason: "OPERATOR_CANCELLED",
    ...(reason ? { operatorReason: reason } : {}),
    cancelledByUserId: actingUserId,
  });
  if (!terminated || !updated) throw new WorkflowRunNotActionableError(runId, run.state, "cancelled");
  return updated;
}

/**
 * `POST /api/v1/admin/workflow-runs/{id}/resume` — the operator nudge.
 *
 * **It does not execute anything, and it never re-executes a `Succeeded` step.** All it
 * does is confirm the run is in a state the pump will pick up. That is the honest
 * implementation of "re-leases, never re-executes a Succeeded step" (LLD §14.6.5): with
 * no queue library there is nothing to enqueue, and the pump's 5s tick will claim any
 * `Pending`/`Running` run on its own. Forcing execution from an HTTP handler would put a
 * second advancer beside the lease holder, which is the one thing
 * `workflow_run_lease` exists to prevent.
 *
 * A `Suspended` run is deliberately NOT woken by this: its suspension is a real external
 * condition (an undecided approval, an open escalation, an unelapsed timer), and an
 * operator "resuming" past it would fabricate a decision nobody made. Such a run is
 * reported as not actionable, with its state in the message so the operator can see what
 * it is actually waiting on.
 */
export async function resumeRun(ctx: TenantContext, runId: string): Promise<WorkflowRunRow> {
  const run = await findWorkflowRunById(ctx, runId);
  if (!run) throw new WorkflowRunNotFoundError(runId);
  if (isTerminalRunState(run.state)) throw new WorkflowRunNotActionableError(runId, run.state, "resumed");
  if (run.state === "Suspended") throw new WorkflowRunNotActionableError(runId, run.state, "resumed while it is waiting on an external condition");
  return run;
}

// ---------------------------------------------------------------------------
// Webhook trigger (LLD §14.6.5 — "signature-verified")
// ---------------------------------------------------------------------------

export interface WebhookTriggerInput {
  path: string;
  /** The RAW request body, exactly as received. Signature verification must run against
   *  the bytes that were signed, not against a re-serialized parse of them. */
  rawBody: string;
  /** The caller's `X-NextBot-Signature` header (hex-encoded HMAC-SHA256). */
  signature: string | null;
  /** The `Idempotency-Key` header, if the caller supplied one. Falls back to a digest of
   *  the raw body so a redelivery of the SAME payload resumes the existing run — which
   *  is precisely LLD §14.6.2's stated semantics for `workflow_run.idempotency_key`. */
  idempotencyKey: string | null;
}

/** Resolves the shared secret for a trigger's declared `signatureCredentialId`. A port
 *  rather than a direct vault call so the route handler's composition root supplies it,
 *  keeping this module free of a `@nextbot/secrets`/`@nextbot/connectors` dependency it
 *  needs for nothing else. */
export interface TriggerSecretResolver {
  resolve(credentialId: string): Promise<string | null>;
}

/**
 * `POST /api/v1/workflows/triggers/{path}` — the webhook trigger surface.
 *
 * **A webhook trigger is never unauthenticated.** `@nextbot/contracts`' `WebhookSource`
 * makes `signatureCredentialId` a required field with that exact comment, and this is
 * where it holds at run time: the body's HMAC-SHA256 is compared against the header with
 * `timingSafeEqual`, and a mismatch, a missing header, or an unresolvable credential all
 * fail closed with the same generic `401`.
 *
 * Two deliberate information-disclosure choices:
 *  - An unknown path returns `WorkflowTriggerNotFoundError` with no detail, so this
 *    endpoint cannot be used to enumerate a tenant's configured trigger paths.
 *  - A signature failure returns a fixed message; which of the three reasons applied is
 *    knowable only server-side.
 *
 * Only `Production` versions are reachable. A Draft/Approved version with a webhook
 * trigger is not addressable, so promoting a version is what makes its endpoint live —
 * the same "Production is the only thing serving traffic" rule every other artifact in
 * this codebase follows.
 */
export async function handleWebhookTrigger(
  ctx: TenantContext,
  secrets: TriggerSecretResolver,
  input: WebhookTriggerInput,
): Promise<{ run: WorkflowRunRow; created: boolean }> {
  const versions = await listProductionWorkflowVersions(ctx);
  let matched: { versionId: string; credentialId: string } | null = null;

  for (const version of versions) {
    const graph = version.graphJson as WorkflowGraph;
    const trigger = graph.spec.nodes.find((n) => n.kind === "Trigger");
    if (!trigger || trigger.kind !== "Trigger" || trigger.source.kind !== "Webhook") continue;
    if (trigger.source.path !== input.path) continue;
    matched = { versionId: version.id, credentialId: trigger.source.signatureCredentialId };
    break;
  }

  if (!matched) throw new WorkflowTriggerNotFoundError();

  const secret = await secrets.resolve(matched.credentialId);
  if (!secret || !input.signature || !verifySignature(secret, input.rawBody, input.signature)) {
    throw new WorkflowTriggerSignatureInvalidError();
  }

  let payload: Record<string, JsonValue> = {};
  try {
    const parsed: unknown = JSON.parse(input.rawBody || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, JsonValue>;
  } catch {
    // A non-JSON body is not a failure — the trigger still fires, with the raw text as
    // the run's single input variable. Rejecting it would make this endpoint unusable
    // for providers that post form-encoded or plain-text payloads.
    payload = { body: input.rawBody };
  }

  return startWorkflowRun(ctx, {
    workflowVersionId: matched.versionId,
    triggerKind: "Webhook",
    idempotencyKey: input.idempotencyKey?.trim() || `webhook:${input.path}:${createHash("sha256").update(input.rawBody).digest("hex")}`,
    input: payload,
  });
}

/** Constant-time HMAC-SHA256 comparison, via `@nextbot/agent-platform`'s shared
 *  `computeHmacSha256Hex`/`constantTimeEquals` primitives (retry-1 QA fix — this used to
 *  be a plain `createHash(secret + "." + rawBody)`, which is NOT an HMAC and is
 *  forgeable via length extension; a real HMAC's key-then-hash construction is not
 *  vulnerable to that attack). `constantTimeEquals` already compares lengths before
 *  calling `timingSafeEqual` (which throws on a length mismatch rather than returning
 *  `false`), so no separate length check is needed here. */
function verifySignature(secret: string, rawBody: string, provided: string): boolean {
  return constantTimeEquals(computeHmacSha256Hex(secret, rawBody), provided.trim());
}

/** The digest a caller must send as `X-NextBot-Signature`. Exported so integration
 *  tests (and the console's "test this trigger" affordance, when one exists) compute it
 *  the same way the verifier does — a second, drifting implementation of a signature
 *  scheme is a classic source of "works in test, 401 in production". Unprefixed hex,
 *  matching this endpoint's own documented contract ("hex-encoded HMAC-SHA256") — unlike
 *  GitHub's `sha256=`-prefixed scheme, which `verifyHmacSignature` (in
 *  `@nextbot/agent-platform`) still owns separately. */
export function computeTriggerSignature(secret: string, rawBody: string): string {
  return computeHmacSha256Hex(secret, rawBody);
}

// ---------------------------------------------------------------------------
// DTO mapping — API responses carry only what the caller should see
// ---------------------------------------------------------------------------

/** `checkpoint_json` is deliberately ABSENT from the DTO. It is the run's whole internal
 *  data plane (masked, but still internal), it is large, and no console surface renders
 *  it — exposing it over the admin API would be gratuitous. The trace's per-step
 *  `input`/`output` are what an operator actually reads, and those are PII-masked. */
export function toRunDto(run: WorkflowRunRow): WorkflowRunDto {
  return {
    id: run.id,
    workflowVersionId: run.workflowVersionId,
    conversationId: run.conversationId,
    triggerKind: run.triggerKind,
    parentRunId: run.parentRunId,
    depth: run.depth,
    state: run.state,
    outcome: run.outcome,
    outcomeDetail: run.outcomeDetail,
    currentNodeIds: run.currentNodeIds,
    stepsExecuted: run.stepsExecuted,
    costUsd: run.costUsd,
    suspensionKind: run.suspensionKind,
    suspensionRef: run.suspensionRef,
    suspensionExpiresAt: run.suspensionExpiresAt?.toISOString() ?? null,
    otelTraceId: run.otelTraceId,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
  };
}

export function toStepDto(step: WorkflowRunStepRow): WorkflowRunStepDto {
  return {
    id: step.id,
    nodeId: step.nodeId,
    nodeKind: step.nodeKind,
    attempt: step.attempt,
    iteration: step.iteration,
    branchKey: step.branchKey,
    refKind: step.refKind,
    refVersionId: step.refVersionId,
    refLabel: step.refLabel,
    status: step.status,
    // Already PII-masked at write time (LLD §14.6.2) — never re-masked here, because a
    // second masking path is exactly what that instruction forbids.
    input: step.input,
    output: step.output,
    error: step.error,
    toolCallId: step.toolCallId,
    approvalRequestId: step.approvalRequestId,
    escalationId: step.escalationId,
    childRunId: step.childRunId,
    compensationOfStepId: step.compensationOfStepId,
    costUsd: step.costUsd,
    startedAt: step.startedAt.toISOString(),
    endedAt: step.endedAt?.toISOString() ?? null,
  };
}

/** Re-exported so a route handler can narrow a version id before starting a run without
 *  reaching into the repository layer directly. */
export { findWorkflowVersionById };
