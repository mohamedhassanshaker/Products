import type { TenantContext } from "@nextbot/db";
import type { CancelWorkflowRunRequest, JsonValue, StartSandboxRunRequest, WorkflowRunStateValue, WorkflowRunTerminalOutcomeValue } from "@nextbot/contracts";
import { cancelRun, getRunWithTrace, listRuns, resumeRun, startSandboxRun, toRunDto, type WebhookTriggerInput, type TriggerSecretResolver } from "../application/run-service.js";
import { handleWebhookTrigger } from "../application/run-service.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.5) — the durable-execution
 * half's HTTP handlers. Plain functions, no framework types (LLD §2.2), matching
 * `http/admin-routes.ts`'s established shape for this module.
 *
 * **RBAC is applied by the composition root** (`apps/web`), which gates every admin
 * route below on `agent_platform:Read`/`agent_platform:Write` — workflows are part of
 * that same RBAC surface, not a new module (spec §5.2, the precedent the Skills Library
 * and Teams already set). The webhook trigger is the one non-admin surface and carries
 * its own authentication: an HMAC signature over the raw body, verified in
 * `run-service.ts` against the trigger's declared `signatureCredentialId`.
 */

/** `POST /api/v1/admin/workflows/{id}/versions/{versionId}/sandbox-run`.
 *
 *  `idempotencyKey` comes from the REQUIRED `Idempotency-Key` header (LLD §14.6.5) and
 *  is validated by the service, not defaulted here — silently generating one would
 *  defeat the exact property the header exists to provide. */
export async function handleStartSandboxRun(ctx: TenantContext, versionId: string, idempotencyKey: string, body: StartSandboxRunRequest) {
  const { run, created } = await startSandboxRun(ctx, versionId, idempotencyKey, {
    // `StartSandboxRunRequest.input` is `Record<string, JsonValue>` in the TypeBox
    // schema but TypeBox's `Static` widens the recursive `JsonValueSchema` to `unknown`,
    // so the two are structurally the same shape with a different nominal element type.
    // Narrowed here at the one boundary where a REQUEST becomes DOMAIN data, rather than
    // loosening the service's own signature — the body has already been `Value.Check`ed
    // against `StartSandboxRunRequestSchema` by the route handler, so this asserts a
    // fact the validator has already established.
    ...(body.input ? { input: body.input as Record<string, JsonValue> } : {}),
    ...(body.conversationId ? { conversationId: body.conversationId } : {}),
  });
  return { run: toRunDto(run), created };
}

export interface ListWorkflowRunsQuery {
  workflowId?: string;
  workflowVersionId?: string;
  state?: WorkflowRunStateValue;
  outcome?: WorkflowRunTerminalOutcomeValue;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/** `GET /api/v1/admin/workflow-runs?workflowId&state&outcome&from&to&cursor` */
export async function handleListWorkflowRuns(ctx: TenantContext, query: ListWorkflowRunsQuery) {
  const runs = await listRuns(ctx, {
    ...(query.workflowId ? { workflowId: query.workflowId } : {}),
    ...(query.workflowVersionId ? { workflowVersionId: query.workflowVersionId } : {}),
    ...(query.state ? { state: query.state } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.limit ? { limit: query.limit } : {}),
  });
  // Keyset cursor: the last row's `startedAt`. Absent on the final page, so the client
  // stops rather than re-requesting the same tail forever.
  const nextCursor = runs.length > 0 ? runs[runs.length - 1]!.startedAt : null;
  return { runs, nextCursor };
}

/** `GET /api/v1/admin/workflow-runs/{id}` — `{ run, graph, steps }` so the EXISTING
 *  Runtime Traces component renders the path over the authored graph (FR-WF-07). There
 *  is deliberately no second trace viewer. */
export async function handleGetWorkflowRun(ctx: TenantContext, runId: string) {
  return getRunWithTrace(ctx, runId);
}

/** `POST /api/v1/admin/workflow-runs/{id}/cancel` */
export async function handleCancelWorkflowRun(ctx: TenantContext, runId: string, body: CancelWorkflowRunRequest, actingUserId: string) {
  return { run: toRunDto(await cancelRun(ctx, runId, body.reason, actingUserId)) };
}

/** `POST /api/v1/admin/workflow-runs/{id}/resume` — the operator nudge. Confirms the run
 *  is in a state `workflow.run-pump` will claim; it never executes a node itself and
 *  never re-executes a `Succeeded` step (see `resumeRun`'s own doc for why executing
 *  from a request handler would defeat the lease). */
export async function handleResumeWorkflowRun(ctx: TenantContext, runId: string) {
  return { run: toRunDto(await resumeRun(ctx, runId)) };
}

/** `POST /api/v1/workflows/triggers/{path}` — signature-verified. A `TriggerNode`'s
 *  webhook source is never unauthenticated by schema, and this is where that holds at
 *  run time. */
export async function handleWorkflowWebhookTrigger(ctx: TenantContext, secrets: TriggerSecretResolver, input: WebhookTriggerInput) {
  const { run, created } = await handleWebhookTrigger(ctx, secrets, input);
  // Only the run id is returned. A webhook caller is an external system that must be
  // able to correlate its delivery, but it has no business reading the run's state,
  // trigger kind or cost — those are admin-surface concerns behind RBAC.
  return { runId: run.id, accepted: true, created };
}
