import type {
  JsonValue,
  SuspensionKindValue,
  WorkflowCheckpoint,
  WorkflowFrontierEntry,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeKindValue,
  WorkflowRunLimits,
  WorkflowRunTerminalOutcomeValue,
} from "@nextbot/contracts";
import {
  clearJoinBarrier,
  incrementLoop,
  isJoinSatisfied,
  loopCount,
  pushCompensation,
  recordJoinArrival,
  takeResumeMarker,
  withVariable,
  withVariables,
} from "../domain/checkpoint.js";
import { applyMapping, evaluateCondition, resolvePath, toJsonValue } from "../domain/expression.js";
import { computeIdempotencyKey } from "../domain/idempotency.js";
import { BUDGET_BREACH_MESSAGES, checkLoopBudget, checkParallelBudget, checkSubWorkflowDepth } from "../domain/run-budget.js";
import { widenAuthoredOutcome } from "../domain/run-fsm.js";
import type { StepRecord } from "../infrastructure/workflow-run-repository.js";
import type { WorkflowNodeRuntime } from "../ports/node-runtime.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-01/03/04/05/06, LLD §14.6.2/
 * §14.6.3/§14.6.4) — **one function per node kind**, each returning what the run should
 * do next as data.
 *
 * Deliberately split from `run-executor.ts`: that file owns the lease, the resume
 * protocol and the persist transaction; this one owns "what does a `Router` mean". A
 * single file doing both would be the god-service this project's own architecture rules
 * forbid, and would make the twelve node semantics untestable without a database.
 *
 * Two properties every executor below shares, and neither is optional:
 *
 *  1. **No node executor writes to the database.** Each returns a `NodeOutcome`
 *     describing the new checkpoint and the step row; `run-executor.ts` commits both in
 *     ONE transaction. That is what makes "the step row and the run's position can never
 *     disagree" structurally true rather than a convention.
 *  2. **No node executor reaches a tool, model or queue directly.** Everything goes
 *     through `WorkflowNodeRuntime`, whose only production tool path is
 *     `orchestration`'s existing tier engine (LLD §14.6.4). Combined with the
 *     `no-mcp-client-inside-workflows` dependency-cruiser rule, a workflow has no path
 *     to a tool that skips tiering.
 */

// ---------------------------------------------------------------------------
// The outcome vocabulary
// ---------------------------------------------------------------------------

export type NodeOutcome =
  /** The ordinary case: the run moves to zero or more successor positions. */
  | { kind: "Advance"; checkpoint: WorkflowCheckpoint; successors: WorkflowFrontierEntry[]; step: StepRecord; costUsd: number }
  /** The run parks on an external condition. FR-WF-05 requires every suspension to
   *  declare a deadline AND the outcome it takes if that deadline passes — both are
   *  mandatory fields here and are additionally enforced by the
   *  `workflow_run_suspension_consistent` DB CHECK. */
  | {
      kind: "Suspend";
      checkpoint: WorkflowCheckpoint;
      step: StepRecord;
      costUsd: number;
      suspension: { kind: SuspensionKindValue; ref: string; expiresAt: Date; expiryOutcome: WorkflowRunTerminalOutcomeValue };
    }
  /** The run reaches a terminal outcome (an `End` node, a budget breach, an
   *  unrecoverable node failure with `onError: 'fail'`). */
  | { kind: "Terminate"; checkpoint: WorkflowCheckpoint; step: StepRecord; costUsd: number; outcome: WorkflowRunTerminalOutcomeValue; detail: Record<string, unknown> }
  /** FR-WF-04: the node failed and declared `onError: 'compensate'`, so the run must
   *  unwind its compensation stack before terminating. */
  | { kind: "Compensate"; checkpoint: WorkflowCheckpoint; step: StepRecord; costUsd: number; detail: Record<string, unknown> }
  /** A `SubWorkflow` node needs a child run created. `run-executor.ts` creates it (it
   *  owns persistence) and then suspends the parent on it. */
  | {
      kind: "SpawnChild";
      checkpoint: WorkflowCheckpoint;
      step: StepRecord;
      costUsd: number;
      child: { workflowVersionId: string; input: Record<string, JsonValue>; outputVariable: string };
      suspensionExpiresAt: Date;
      suspensionExpiryOutcome: WorkflowRunTerminalOutcomeValue;
    };

export interface NodeExecutionContext {
  runId: string;
  /** The workflow run's `agent_run_id`, threaded into agent invocations so their traces
   *  join to this run. */
  agentRunId: string | null;
  conversationId: string | null;
  graph: WorkflowGraph;
  limits: WorkflowRunLimits;
  checkpoint: WorkflowCheckpoint;
  entry: WorkflowFrontierEntry;
  /** This run's nesting depth; a `SubWorkflow` child is `depth + 1`. */
  depth: number;
  runtime: WorkflowNodeRuntime;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The resolution root every mapping and condition is evaluated against. Only the
 *  run's own variables are reachable — deliberately not `process.env`, not the node
 *  itself, not the graph. An authored expression can therefore only ever read data the
 *  run already legitimately holds. */
function expressionRoot(checkpoint: WorkflowCheckpoint): Record<string, unknown> {
  return { variables: checkpoint.variables };
}

export function findNode(graph: WorkflowGraph, nodeId: string): WorkflowNode | undefined {
  return graph.spec.nodes.find((n) => n.id === nodeId);
}

/** Moves the run to a single successor at the same branch/iteration coordinates. */
function successor(entry: WorkflowFrontierEntry, nodeId: string, overrides: Partial<WorkflowFrontierEntry> = {}): WorkflowFrontierEntry {
  return { nodeId, branchKey: entry.branchKey, iteration: entry.iteration, ...overrides };
}

/** The step row skeleton shared by every executor — kind, position and timing. Each
 *  executor fills in `status`, `refKind`, payloads and any correlation id. */
function baseStep(node: WorkflowNode, entry: WorkflowFrontierEntry, startedAt: Date): Omit<StepRecord, "status" | "refKind"> {
  return {
    nodeId: node.id,
    nodeKind: node.kind as WorkflowNodeKindValue,
    iteration: entry.iteration,
    branchKey: entry.branchKey,
    startedAt,
    endedAt: new Date(),
  };
}

/**
 * FR-WF-01/04's per-node failure policy, applied uniformly so no node kind invents its
 * own error handling.
 *
 * `onError` is authored per node and defaults to `'fail'` — an absent policy means the
 * run stops, never that the failure is swallowed. The four documented behaviours:
 *
 *  - `fail` (default) — terminate the run at outcome `Failed`.
 *  - `continue` — record the failure on the step and proceed to the node's `next`, for
 *    a genuinely optional side effect.
 *  - `compensate` — enter `Compensating` and unwind the write stack (FR-WF-04's
 *    "this workflow is a distributed transaction with no rollback path" made false).
 *  - `escalate` — terminate at outcome `Escalated`, which is a *successful* completion
 *    of the authored graph (see `stateForOutcome`), not a crash.
 */
function applyErrorPolicy(
  node: WorkflowNode,
  ctx: NodeExecutionContext,
  step: StepRecord,
  error: { code: string; message: string; retriable: boolean },
  costUsd: number,
  nextNodeId: string | undefined,
): NodeOutcome {
  const onError = (node as { onError?: "fail" | "continue" | "compensate" | "escalate" }).onError ?? "fail";
  const detail = { nodeId: node.id, ...error };

  if (onError === "continue" && nextNodeId) {
    return {
      kind: "Advance",
      checkpoint: ctx.checkpoint,
      successors: [successor(ctx.entry, nextNodeId)],
      step: { ...step, status: "Failed", error },
      costUsd,
    };
  }
  if (onError === "compensate") {
    return { kind: "Compensate", checkpoint: ctx.checkpoint, step: { ...step, status: "Failed", error }, costUsd, detail };
  }
  if (onError === "escalate") {
    return { kind: "Terminate", checkpoint: ctx.checkpoint, step: { ...step, status: "Failed", error }, costUsd, outcome: "Escalated", detail };
  }
  return { kind: "Terminate", checkpoint: ctx.checkpoint, step: { ...step, status: "Failed", error }, costUsd, outcome: "Failed", detail };
}

/**
 * A budget breach is terminal at `BudgetExceeded` **regardless of the node's own
 * `onError`** — a ceiling is a run-level guarantee, and letting a node's `continue`
 * policy carry a run past its own cost/step limit would make FR-WF-06's ceilings
 * advisory rather than enforced.
 *
 * Shared by this file's per-node ceilings (Parallel fan-out, Loop iterations,
 * SubWorkflow depth) and by `run-executor.ts`'s pre-node run-level check, so all six
 * ceilings produce an identically-shaped `outcome_detail` an operator can read the same
 * way.
 */
export function budgetTerminationOutcome(
  checkpoint: WorkflowCheckpoint,
  step: Omit<StepRecord, "status">,
  breach: { reason: string; limit: number; observed: number; message: string },
  nodeId: string,
): NodeOutcome {
  return {
    kind: "Terminate",
    checkpoint,
    step: { ...step, status: "Failed", error: { code: breach.reason, message: breach.message, retriable: false } },
    costUsd: 0,
    outcome: "BudgetExceeded",
    detail: { ...breach, nodeId },
  };
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

/**
 * Executes exactly ONE node and returns what the run should do next.
 *
 * @param ctx everything the node needs; nothing is read from ambient state.
 * @returns a `NodeOutcome` the caller persists. Never throws for a node-level failure —
 *   those come back as `Terminate`/`Compensate` through `applyErrorPolicy`, so a
 *   misbehaving node can never take down a pump tick for every other run.
 */
export async function executeNode(ctx: NodeExecutionContext): Promise<NodeOutcome> {
  const node = findNode(ctx.graph, ctx.entry.nodeId);
  const startedAt = new Date();

  if (!node) {
    // Cannot happen for a saved graph (V2 resolves every edge at save time), so this is
    // a genuine defect path — reported loudly as a terminal failure rather than skipped.
    const step: StepRecord = {
      nodeId: ctx.entry.nodeId,
      nodeKind: "End",
      iteration: ctx.entry.iteration,
      branchKey: ctx.entry.branchKey,
      refKind: "None",
      status: "Failed",
      error: { code: "WORKFLOW_NODE_NOT_FOUND", message: `Node '${ctx.entry.nodeId}' is not present in this version's graph.`, retriable: false },
      startedAt,
      endedAt: new Date(),
    };
    return { kind: "Terminate", checkpoint: ctx.checkpoint, step, costUsd: 0, outcome: "Failed", detail: { nodeId: ctx.entry.nodeId, code: "WORKFLOW_NODE_NOT_FOUND" } };
  }

  switch (node.kind) {
    case "Trigger":
      return executeTrigger(node, ctx, startedAt);
    case "End":
      return executeEnd(node, ctx, startedAt);
    case "Router":
      return executeRouter(node, ctx, startedAt);
    case "ToolCall":
      return executeToolCall(node, ctx, startedAt);
    case "Agent":
      return executeAgent(node, ctx, startedAt);
    case "Skill":
      return executeSkill(node, ctx, startedAt);
    case "HumanTask":
      return executeHumanTask(node, ctx, startedAt);
    case "Wait":
      return executeWait(node, ctx, startedAt);
    case "Parallel":
      return executeParallel(node, ctx, startedAt);
    case "Join":
      return executeJoin(node, ctx, startedAt);
    case "Loop":
      return executeLoop(node, ctx, startedAt);
    case "SubWorkflow":
      return executeSubWorkflow(node, ctx, startedAt);
    default: {
      const exhaustive: never = node;
      throw new Error(`executeNode: unhandled node kind ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Trigger / End
// ---------------------------------------------------------------------------

/** The graph's single entry point (V1). Its payload was already folded into
 *  `checkpoint.variables` when the run was created, so executing it is purely a
 *  frontier move — but it still writes a step row, because FR-WF-07's trace should show
 *  the run entering the graph, not begin mid-way. */
function executeTrigger(node: Extract<WorkflowNode, { kind: "Trigger" }>, ctx: NodeExecutionContext, startedAt: Date): NodeOutcome {
  return {
    kind: "Advance",
    checkpoint: ctx.checkpoint,
    successors: [successor(ctx.entry, node.next)],
    step: { ...baseStep(node, ctx.entry, startedAt), refKind: "None", status: "Succeeded", output: { trigger: node.source.kind } },
    costUsd: 0,
  };
}

/**
 * A terminal outcome, explicitly authored — FR-WF-01's "End nodes are explicit; there is
 * no implicit fallthrough".
 *
 * Note this returns `Terminate` even when other frontier entries are still open. That is
 * correct: an `End` reached on any branch ends the RUN (the graph's own semantics —
 * there is one outcome per run, not one per branch). An author who wants branches to
 * rejoin must use a `Join`, which V6 already requires for every `Parallel`.
 */
function executeEnd(node: Extract<WorkflowNode, { kind: "End" }>, ctx: NodeExecutionContext, startedAt: Date): NodeOutcome {
  return {
    kind: "Terminate",
    checkpoint: ctx.checkpoint,
    step: { ...baseStep(node, ctx.entry, startedAt), refKind: "None", status: "Succeeded", output: { outcome: node.outcome } },
    costUsd: 0,
    outcome: widenAuthoredOutcome(node.outcome),
    detail: { nodeId: node.id, ...(node.message ? { message: node.message } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Selects one outgoing edge.
 *
 * `Rules` mode evaluates each branch's `when` in authored order and takes the first
 * that is true — order is the tie-break, which is what makes an authored graph's routing
 * deterministic and reviewable. `Classifier` mode asks the pinned (router-class, cheap)
 * model route to pick.
 *
 * **Neither mode can dead-end.** `default` is REQUIRED by V11, and every path that fails
 * to select a branch — no `when` matched, a `when` that would not parse, a classifier
 * that returned nothing usable, a classifier route that errored — falls through to it.
 * The step records WHICH branch was taken and why, so a surprising route is diagnosable
 * from the trace rather than by re-deriving the conditions by hand.
 */
async function executeRouter(node: Extract<WorkflowNode, { kind: "Router" }>, ctx: NodeExecutionContext, startedAt: Date): Promise<NodeOutcome> {
  const root = expressionRoot(ctx.checkpoint);
  let chosen: { to: string; why: string } | null = null;
  let costUsd = 0;

  if (node.mode === "Rules") {
    for (const branch of node.branches) {
      // A branch with no `when` is an unconditional edge and matches immediately —
      // authoring one after a conditional branch is a legitimate "otherwise" idiom.
      if (!branch.when || evaluateCondition(branch.when, root)) {
        chosen = { to: branch.to, why: branch.when ?? "(unconditional)" };
        break;
      }
    }
  } else if (node.classifierRouteVersionId) {
    const choices = node.branches.map((b) => b.when ?? b.to);
    try {
      const result = await ctx.runtime.classifier.classify({
        routeVersionId: node.classifierRouteVersionId,
        text: JSON.stringify(ctx.checkpoint.variables),
        choices,
      });
      costUsd = Number(result.costUsd || 0);
      if (result.choiceIndex !== null && node.branches[result.choiceIndex]) {
        chosen = { to: node.branches[result.choiceIndex]!.to, why: `classifier:${choices[result.choiceIndex]}` };
      }
    } catch (err) {
      // A classifier failure routes to `default` rather than failing the run: the author
      // declared a default precisely so the graph has a defined behaviour when
      // classification is unavailable. Recorded on the step so it is never invisible.
      chosen = null;
      return {
        kind: "Advance",
        checkpoint: ctx.checkpoint,
        successors: [successor(ctx.entry, node.default!)],
        step: {
          ...baseStep(node, ctx.entry, startedAt),
          refKind: "None",
          status: "Succeeded",
          output: { selected: node.default, why: "classifier_error_default" },
          error: { code: "WORKFLOW_ROUTER_CLASSIFIER_FAILED", message: err instanceof Error ? err.message : String(err), retriable: true },
        },
        costUsd,
      };
    }
  }

  // `default` is non-null for any saved graph (V11); the `?? node.branches[0].to` guard
  // is defense in depth against a graph that predates the rule, and still never
  // dead-ends.
  const target = chosen?.to ?? node.default ?? node.branches[0]!.to;
  return {
    kind: "Advance",
    checkpoint: ctx.checkpoint,
    successors: [successor(ctx.entry, target)],
    step: {
      ...baseStep(node, ctx.entry, startedAt),
      refKind: "None",
      status: "Succeeded",
      output: { selected: target, why: chosen?.why ?? "default" },
      costUsd: String(costUsd),
    },
    costUsd,
  };
}

// ---------------------------------------------------------------------------
// ToolCall (LLD §14.6.4 — tier survival)
// ---------------------------------------------------------------------------

/**
 * **The node FR-WF-03 is about.**
 *
 * This executor does not call the MCP client — it cannot: `workflows` may not import
 * `@nextbot/mcp-client` (dependency-cruiser rule `no-mcp-client-inside-workflows`). It
 * dispatches through `ToolDispatcher`, whose production implementation is
 * `orchestration`'s existing tier engine + the §14.2 authz evaluator + `EgressPort` —
 * the identical sequence a single agent's tool call takes. So a Tier-3 tool inside a
 * workflow stops at the Approval Queue for exactly the same reason it does inside a
 * turn, not because this file remembered to check.
 *
 * On `AwaitingApproval` the run SUSPENDS with `suspension_kind = 'Approval'` and
 * `suspension_ref = 'approval_request:<id>'` (LLD §14.6.4), and its
 * `suspension_expires_at` is the approval's OWN deadline — the very deadline
 * `approvals.expiry-sweep` scans. One clock governs both rows, which is the whole point
 * of ADR-0013 §7.4.
 *
 * On success, and only if the tool's live `rw_class` is `Write`, a compensating action
 * is pushed onto the checkpoint stack (FR-WF-04). Pushed AFTER the call succeeds, never
 * before: compensating a write that never happened would itself be an unsafe side
 * effect.
 */
async function executeToolCall(node: Extract<WorkflowNode, { kind: "ToolCall" }>, ctx: NodeExecutionContext, startedAt: Date): Promise<NodeOutcome> {
  // A resume marker means this node ALREADY suspended on an approval that has since
  // been decided; the pump parked the decided call's result here. Consume it and
  // advance — dispatching again would be a second, unapproved tool call.
  const resumed = takeResumeMarker(ctx.checkpoint, node.id, ctx.entry.iteration);
  if (resumed.marker !== null) {
    return resumeFromApproval(node, ctx, resumed.checkpoint, resumed.marker, startedAt);
  }

  const args = applyMapping(node.argMapping, expressionRoot(ctx.checkpoint));
  const maskedInput = await ctx.runtime.masker.mask(args);
  const step = { ...baseStep(node, ctx.entry, startedAt), refKind: "Tool" as const, refVersionId: node.toolId, refLabel: node.toolId, input: maskedInput };

  const idempotencyKey = computeIdempotencyKey(node.idempotency?.strategy ?? "RunScopedUuid", {
    runId: ctx.runId,
    nodeId: node.id,
    iteration: ctx.entry.iteration,
    args,
    argPath: node.idempotency?.argPath,
  });

  const result = await ctx.runtime.tools.dispatch({
    toolId: node.toolId,
    args,
    conversationId: ctx.conversationId,
    idempotencyKey,
    workflowRunStepId: ctx.runId,
  });

  if (result.kind === "AwaitingApproval") {
    return {
      kind: "Suspend",
      checkpoint: ctx.checkpoint,
      costUsd: 0,
      step: { ...step, status: "Suspended", toolCallId: result.toolCallId, approvalRequestId: result.approvalRequestId ?? null },
      suspension: {
        kind: "Approval",
        ref: `approval_request:${result.approvalRequestId ?? result.toolCallId}`,
        // The approval's OWN deadline, so the run and the queue row expire together.
        // A dispatcher that somehow returned none falls back to the run's wall-clock
        // ceiling — bounded, never indefinite (FR-WF-05).
        expiresAt: result.expiresAt ?? new Date(Date.now() + ctx.limits.maxWallClockSeconds * 1000),
        // A ToolCall node has no authored `onTimeout` (only Wait/HumanTask do), so an
        // approval that is never decided times the RUN out. `Timeout` rather than
        // `Failed` because nothing failed — a human simply did not answer, and
        // FR-WF-06 wants those two logged distinctly.
        expiryOutcome: "Timeout",
      },
    };
  }

  if (result.kind === "Denied") {
    return applyErrorPolicy(node, ctx, { ...step, status: "Failed" }, { code: "WORKFLOW_TOOL_DENIED", message: result.reason, retriable: false }, 0, node.next);
  }

  if (result.kind === "Failed") {
    return applyErrorPolicy(node, ctx, { ...step, status: "Failed" }, { code: "WORKFLOW_TOOL_FAILED", message: result.errorMessage, retriable: result.retriable }, 0, node.next);
  }

  const cost = Number(result.costUsd || 0);
  const maskedOutput = await ctx.runtime.masker.mask(result.output);
  let checkpoint = withVariable(ctx.checkpoint, node.outputVariable, toJsonValue(result.output));

  // FR-WF-04's compensation stack. `rw_class` is resolved LIVE rather than trusted from
  // the graph, so a tool reclassified `Write` since the version was saved still gets a
  // compensating entry.
  const rwClass = await ctx.runtime.tools.resolveToolRwClass(node.toolId);
  if (rwClass === "Write" && node.compensation) {
    checkpoint = pushCompensation(checkpoint, {
      // `stepId` is the run id here rather than the (not-yet-assigned) step row id: the
      // step row is inserted by `run-executor.ts`'s persist, inside the SAME transaction
      // that writes this checkpoint, so its id does not exist yet. The compensation
      // stack does not need it to act — it needs the tool, the args and the key — and
      // `workflow_run_step.compensation_of_step_id` is resolved at unwind time from
      // `(run, node, iteration)`, which IS durable here.
      stepId: ctx.runId,
      nodeId: node.id,
      toolId: node.compensation.toolId,
      args: applyMapping(node.compensation.argMapping, { variables: checkpoint.variables }),
      idempotencyKey,
    });
  }

  return {
    kind: "Advance",
    checkpoint,
    successors: [successor(ctx.entry, node.next)],
    step: { ...step, status: "Succeeded", output: maskedOutput, costUsd: String(cost) },
    costUsd: cost,
  };
}

/**
 * Continues a `ToolCall` node whose Tier-2/Tier-3 approval has been decided.
 *
 * The marker the pump parked carries the decided call's terminal status and output —
 * read from `tool_call` through `ToolDispatcher.readToolCallOutcome`, never re-derived
 * here. An approved-and-executed call advances with its real output; a rejected,
 * cancelled or expired one is a node failure routed through the node's own `onError`,
 * so a workflow author's declared policy governs "the human said no" exactly as it
 * governs "the tool errored".
 */
function resumeFromApproval(
  node: Extract<WorkflowNode, { kind: "ToolCall" }>,
  ctx: NodeExecutionContext,
  checkpoint: WorkflowCheckpoint,
  marker: JsonValue,
  startedAt: Date,
): NodeOutcome {
  const decided = (marker ?? {}) as { status?: string; output?: JsonValue; errorMessage?: string | null };
  const step: StepRecord = { ...baseStep(node, ctx.entry, startedAt), refKind: "Tool", refVersionId: node.toolId, refLabel: node.toolId, status: "Succeeded" };
  const resumedCtx = { ...ctx, checkpoint };

  if (decided.status === "Succeeded") {
    return {
      kind: "Advance",
      checkpoint: withVariable(checkpoint, node.outputVariable, decided.output ?? null),
      successors: [successor(ctx.entry, node.next)],
      step: { ...step, output: decided.output ?? null },
      costUsd: 0,
    };
  }

  return applyErrorPolicy(
    node,
    resumedCtx,
    { ...step, status: "Failed" },
    {
      code: "WORKFLOW_TOOL_APPROVAL_NOT_GRANTED",
      message: decided.errorMessage ?? `The approval for this tool call ended as '${decided.status ?? "unknown"}'.`,
      retriable: false,
    },
    0,
    node.next,
  );
}

// ---------------------------------------------------------------------------
// Agent / Skill
// ---------------------------------------------------------------------------

/** Invokes a PINNED `agent_definition_version` through the existing turn path. An
 *  `escalate` outcome is honoured as the node's `onError: 'escalate'` equivalent even
 *  when the node declared no policy, because an agent explicitly asking for a human is
 *  a decision, not a failure to swallow. */
async function executeAgent(node: Extract<WorkflowNode, { kind: "Agent" }>, ctx: NodeExecutionContext, startedAt: Date): Promise<NodeOutcome> {
  const input = applyMapping(node.inputMapping, expressionRoot(ctx.checkpoint));
  const maskedInput = await ctx.runtime.masker.mask(input);
  const step = {
    ...baseStep(node, ctx.entry, startedAt),
    refKind: "AgentVersion" as const,
    refVersionId: node.agentDefinitionVersionId,
    refLabel: node.agentDefinitionVersionId,
    input: maskedInput,
  };

  let result;
  try {
    result = await ctx.runtime.agents.invoke({
      agentDefinitionVersionId: node.agentDefinitionVersionId,
      task: renderTask(input),
      conversationId: ctx.conversationId,
      agentRunId: ctx.agentRunId,
    });
  } catch (err) {
    return applyErrorPolicy(node, ctx, { ...step, status: "Failed" }, { code: "WORKFLOW_AGENT_FAILED", message: err instanceof Error ? err.message : String(err), retriable: true }, 0, node.next);
  }

  const cost = Number(result.costUsd || 0);
  if (result.unavailableReason) {
    return applyErrorPolicy(node, ctx, { ...step, status: "Failed", costUsd: String(cost) }, { code: "WORKFLOW_AGENT_UNAVAILABLE", message: result.unavailableReason, retriable: false }, cost, node.next);
  }
  if (result.outcome === "escalate") {
    return {
      kind: "Terminate",
      checkpoint: ctx.checkpoint,
      step: { ...step, status: "Succeeded", output: await ctx.runtime.masker.mask({ outcome: result.outcome, text: result.text }), costUsd: String(cost) },
      costUsd: cost,
      outcome: "Escalated",
      detail: { nodeId: node.id, reason: "agent_requested_escalation" },
    };
  }

  const maskedOutput = await ctx.runtime.masker.mask(result.text);
  return {
    kind: "Advance",
    checkpoint: withVariable(ctx.checkpoint, node.outputVariable, toJsonValue(result.text)),
    successors: [successor(ctx.entry, node.next)],
    step: { ...step, status: "Succeeded", output: maskedOutput, costUsd: String(cost) },
    costUsd: cost,
  };
}

/** Invokes a PINNED `skill_version` without a full agent turn (LLD §14.6.3's own
 *  distinction between an `Agent` node and a `Skill` node). */
async function executeSkill(node: Extract<WorkflowNode, { kind: "Skill" }>, ctx: NodeExecutionContext, startedAt: Date): Promise<NodeOutcome> {
  const input = applyMapping(node.inputMapping, expressionRoot(ctx.checkpoint));
  const maskedInput = await ctx.runtime.masker.mask(input);
  const step = { ...baseStep(node, ctx.entry, startedAt), refKind: "SkillVersion" as const, refVersionId: node.skillVersionId, refLabel: node.skillVersionId, input: maskedInput };

  let result;
  try {
    result = await ctx.runtime.skills.invoke({ skillVersionId: node.skillVersionId, task: renderTask(input) });
  } catch (err) {
    return applyErrorPolicy(node, ctx, { ...step, status: "Failed" }, { code: "WORKFLOW_SKILL_FAILED", message: err instanceof Error ? err.message : String(err), retriable: true }, 0, node.next);
  }

  const cost = Number(result.costUsd || 0);
  if (result.unavailableReason) {
    return applyErrorPolicy(node, ctx, { ...step, status: "Failed", costUsd: String(cost) }, { code: "WORKFLOW_SKILL_UNAVAILABLE", message: result.unavailableReason, retriable: false }, cost, node.next);
  }

  return {
    kind: "Advance",
    checkpoint: withVariable(ctx.checkpoint, node.outputVariable, toJsonValue(result.text)),
    successors: [successor(ctx.entry, node.next)],
    step: { ...step, status: "Succeeded", output: await ctx.runtime.masker.mask(result.text), costUsd: String(cost) },
    costUsd: cost,
  };
}

/** Renders a mapped input object as the single string an agent/skill invocation takes.
 *  A lone `task`/`text`/`input` key is passed through verbatim (the common authoring
 *  shape); anything else is serialized, so no field is silently dropped. */
function renderTask(input: Record<string, JsonValue>): string {
  for (const key of ["task", "text", "input", "prompt"]) {
    const value = input[key];
    if (typeof value === "string" && Object.keys(input).length === 1) return value;
  }
  return JSON.stringify(input);
}

// ---------------------------------------------------------------------------
// HumanTask
// ---------------------------------------------------------------------------

/**
 * Routes into one of the two EXISTING human queues — ADR-0013 §2.3's "there is no third
 * queue".
 *
 * **`queue: 'EscalationQueue'`** is fully implemented: a real `escalation` row through
 * `@nextbot/escalations`' own `triggerEscalation`, and the run suspends on it with
 * `suspension_ref = 'escalation:<id>'` until a human resolves it or its declared
 * `timeoutSeconds` passes.
 *
 * **`queue: 'ApprovalQueue'` is NOT executable in this phase, and fails loudly.** This
 * is a disclosed, deliberate refusal rather than an oversight, and the reason is a real
 * safety hazard:
 *
 *   `approval_request.tool_call_id` is `NOT NULL`, and `decideTier3()`'s Approve branch
 *   unconditionally dispatches that `tool_call` through `EgressPort`. A `HumanTaskNode`
 *   carries no `toolId` — it is a decision point, not a gated tool call — so putting one
 *   in the Approval Queue would require fabricating a `tool_call` row, and an approver's
 *   Approve click would then dispatch a meaningless egress call with an empty connector.
 *   That is precisely the class of hazard the rest of this phase exists to close.
 *
 * Making it safe needs either an `approval_request` kind discriminant or a decision-only
 * branch in `decideTier3()`. The LLD specifies neither, so this is flagged for the
 * architect rather than decided here. Note the Tier-3 path itself is NOT missing:
 * `executeToolCall` above suspends on a real Approval Queue row for any Tier-3 tool,
 * which is the path ADR-0013 §7.4's hazard actually describes.
 */
async function executeHumanTask(node: Extract<WorkflowNode, { kind: "HumanTask" }>, ctx: NodeExecutionContext, startedAt: Date): Promise<NodeOutcome> {
  const step = { ...baseStep(node, ctx.entry, startedAt), refKind: "None" as const, input: { prompt: node.prompt, queue: node.queue } };
  const expiresAt = new Date(Date.now() + node.timeoutSeconds * 1000);

  // Already escalated and a human has since closed it out — advance rather than raising
  // a second escalation. `onReject` is honoured when the human returned the
  // conversation to the bot without resolving it, which is the closest thing the
  // escalation FSM has to "declined".
  const resumed = takeResumeMarker(ctx.checkpoint, node.id, ctx.entry.iteration);
  if (resumed.marker !== null) {
    const decided = (resumed.marker ?? {}) as { status?: string; escalationId?: string };
    const target = decided.status === "ReturnedToBot" && node.onReject ? node.onReject : node.next;
    return {
      kind: "Advance",
      checkpoint: resumed.checkpoint,
      successors: [successor(ctx.entry, target)],
      step: { ...step, status: "Succeeded", escalationId: decided.escalationId ?? null, output: { escalationStatus: decided.status ?? null, selected: target } },
      costUsd: 0,
    };
  }

  if (node.queue === "ApprovalQueue") {
    return applyErrorPolicy(
      node,
      ctx,
      { ...step, status: "Failed" },
      {
        code: "WORKFLOW_HUMAN_TASK_APPROVAL_QUEUE_UNSUPPORTED",
        message:
          "A HumanTask node targeting the Approval Queue cannot be executed: an approval_request requires a backing tool_call, and approving one would dispatch it. Use queue: 'EscalationQueue', or gate a real Tier-3 tool with a ToolCall node.",
        retriable: false,
      },
      0,
      node.next,
    );
  }

  if (!ctx.conversationId || !node.escalationQueueId) {
    return applyErrorPolicy(
      node,
      ctx,
      { ...step, status: "Failed" },
      {
        code: "WORKFLOW_HUMAN_TASK_NO_CONVERSATION",
        message: "A HumanTask node can only raise an escalation for a run that has a conversation and a configured queue.",
        retriable: false,
      },
      0,
      node.next,
    );
  }

  try {
    const { escalationId } = await ctx.runtime.escalations.raise({
      conversationId: ctx.conversationId,
      queueId: node.escalationQueueId,
      // `HumanTaskNode.escalationReason` is authored free text, while `escalation.reason`
      // is a 4-value enum. An exact match is honoured; anything else becomes
      // `CustomerRequest`, the reason that most closely describes "the workflow asked
      // for a human". Never guessed silently — the authored text is preserved on the
      // step's own `input`.
      reason: coerceEscalationReason(node.escalationReason),
      prompt: node.prompt,
      runId: ctx.runId,
      nodeId: node.id,
    });
    return {
      kind: "Suspend",
      checkpoint: ctx.checkpoint,
      costUsd: 0,
      step: { ...step, status: "Suspended", escalationId },
      suspension: { kind: "HumanTask", ref: `escalation:${escalationId}`, expiresAt, expiryOutcome: widenAuthoredOutcome(node.onTimeout) },
    };
  } catch (err) {
    return applyErrorPolicy(node, ctx, { ...step, status: "Failed" }, { code: "WORKFLOW_HUMAN_TASK_FAILED", message: err instanceof Error ? err.message : String(err), retriable: true }, 0, node.next);
  }
}

const ESCALATION_REASONS = ["LowConfidence", "ToolFailure", "CustomerRequest", "SensitiveTopic"] as const;
function coerceEscalationReason(authored: string | undefined): (typeof ESCALATION_REASONS)[number] {
  return ESCALATION_REASONS.find((r) => r === authored) ?? "CustomerRequest";
}

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

/**
 * Parks the run on a timer or an external event.
 *
 * `Timer` mode suspends until `durationSeconds` elapses, bounded by `timeoutSeconds`;
 * the reconciling pump resumes it once the timer instant passes, and the expiry sweep
 * takes the declared `onTimeout` if the outer bound is reached first.
 *
 * **Disclosed narrowing — `ExternalEvent` mode.** LLD §14.6.5's endpoint list contains
 * no event-delivery surface (`POST /workflows/triggers/{path}` *starts* runs; it does
 * not deliver an event into a suspended one). An `ExternalEvent` wait therefore suspends
 * correctly, is bounded correctly, and resolves via its declared `onTimeout` — but
 * nothing can currently satisfy it early. Disclosed here rather than inventing an
 * endpoint the LLD does not specify; the suspension mechanics are already complete, so
 * adding that endpoint later is purely additive.
 */
function executeWait(node: Extract<WorkflowNode, { kind: "Wait" }>, ctx: NodeExecutionContext, startedAt: Date): NodeOutcome {
  const timeoutAt = new Date(Date.now() + node.timeoutSeconds * 1000);
  const step = { ...baseStep(node, ctx.entry, startedAt), refKind: "None" as const, input: { mode: node.mode, timeoutSeconds: node.timeoutSeconds } };

  // The wait already elapsed — advance instead of starting a fresh one, which would
  // restart the clock on every resume and make a Wait node unable to ever finish.
  const resumed = takeResumeMarker(ctx.checkpoint, node.id, ctx.entry.iteration);
  if (resumed.marker !== null) {
    return {
      kind: "Advance",
      checkpoint: resumed.checkpoint,
      successors: [successor(ctx.entry, node.next)],
      step: { ...step, status: "Succeeded", output: { waited: true } },
      costUsd: 0,
    };
  }

  if (node.mode === "Timer") {
    const fireAt = new Date(Date.now() + (node.durationSeconds ?? node.timeoutSeconds) * 1000);
    return {
      kind: "Suspend",
      checkpoint: ctx.checkpoint,
      costUsd: 0,
      step: { ...step, status: "Suspended" },
      suspension: {
        kind: "Wait",
        ref: `timer:${fireAt.toISOString()}`,
        // The OUTER bound, deliberately: `suspension_expires_at` is what the expiry
        // sweep acts on, and a timer firing normally is a *resume*, not an expiry. If
        // the author set `durationSeconds > timeoutSeconds`, the timeout wins — which is
        // the correct reading of a declared outer bound.
        expiresAt: timeoutAt,
        expiryOutcome: widenAuthoredOutcome(node.onTimeout),
      },
    };
  }

  return {
    kind: "Suspend",
    checkpoint: ctx.checkpoint,
    costUsd: 0,
    step: { ...step, status: "Suspended" },
    suspension: { kind: "Wait", ref: `event:${node.eventKey ?? node.id}`, expiresAt: timeoutAt, expiryOutcome: widenAuthoredOutcome(node.onTimeout) },
  };
}

// ---------------------------------------------------------------------------
// Parallel / Join
// ---------------------------------------------------------------------------

/**
 * Fans the frontier out to one entry per branch, each with its own `branchKey`.
 *
 * The branch entry point's node id IS the branch key: it is stable across a crash (it
 * comes from the immutable graph, not from a counter), unique within the fan-out (V6
 * guarantees distinct branch entries), and human-readable in the trace.
 *
 * Re-checks `maxParallelBranches` at run time even though V6 checked it at save time —
 * the same defense-in-depth this codebase applies at every other ceiling (see
 * `run-budget.ts`).
 */
function executeParallel(node: Extract<WorkflowNode, { kind: "Parallel" }>, ctx: NodeExecutionContext, startedAt: Date): NodeOutcome {
  const step = { ...baseStep(node, ctx.entry, startedAt), refKind: "None" as const };
  const budget = checkParallelBudget(ctx.limits, node.branches.length);
  if (!budget.ok) {
    return budgetTerminationOutcome(ctx.checkpoint, step, { ...budget, message: BUDGET_BREACH_MESSAGES[budget.reason] }, node.id);
  }

  // The barrier is (re)initialized HERE, not on first arrival, for two reasons: its
  // `expected` is then the fan-out this node actually opened rather than whatever the
  // first arriving branch happened to believe, and a Parallel inside a Loop body starts
  // each iteration with a clean barrier instead of inheriting the previous iteration's
  // arrivals (which would release the Join instantly).
  const barrier: WorkflowCheckpoint = {
    ...ctx.checkpoint,
    joinBarriers: { ...ctx.checkpoint.joinBarriers, [node.joinNodeId]: { expected: node.branches.length, arrived: [] } },
  };

  return {
    kind: "Advance",
    checkpoint: barrier,
    successors: node.branches.map((branchEntryNodeId) => ({ nodeId: branchEntryNodeId, branchKey: branchEntryNodeId, iteration: ctx.entry.iteration })),
    step: { ...step, status: "Succeeded", output: { branches: node.branches } },
    costUsd: 0,
  };
}

/**
 * The barrier. Each arriving branch is recorded; the branch that satisfies the join's
 * mode continues to `next`, and every other arrival ends its own frontier entry with a
 * `Skipped` step.
 *
 * Arrivals are recorded in the checkpoint (not in memory), which is what makes a join
 * survive a crash between two branches arriving — the whole reason `joinBarriers` is
 * part of `WorkflowCheckpointSchema` rather than executor state.
 *
 * The barrier is CLEARED when it releases, so a `Join` inside a `Loop` body starts fresh
 * on the next iteration instead of instantly re-firing on the previous iteration's
 * arrivals.
 */
function executeJoin(node: Extract<WorkflowNode, { kind: "Join" }>, ctx: NodeExecutionContext, startedAt: Date): NodeOutcome {
  const parallel = findNode(ctx.graph, node.parallelNodeId);
  const expected = parallel && parallel.kind === "Parallel" ? parallel.branches.length : 1;
  const arrival = recordJoinArrival(ctx.checkpoint, node.id, ctx.entry.branchKey, expected);
  const step = { ...baseStep(node, ctx.entry, startedAt), refKind: "None" as const };

  if (!isJoinSatisfied(node.mode, arrival.arrived, arrival.expected, node.quorum)) {
    // This branch is done but the join is not satisfied yet — the frontier entry is
    // consumed with no successor. The run stays alive because other branches are still
    // on the frontier.
    return {
      kind: "Advance",
      checkpoint: arrival.checkpoint,
      successors: [],
      step: { ...step, status: "Succeeded", output: { arrived: arrival.arrived, expected: arrival.expected, released: false } },
      costUsd: 0,
    };
  }

  return {
    kind: "Advance",
    checkpoint: clearJoinBarrier(arrival.checkpoint, node.id),
    // Continues UNBRANCHED: past the join the run is one path again, so a downstream
    // node is not executed once per branch that arrived.
    successors: [{ nodeId: node.next, branchKey: null, iteration: ctx.entry.iteration }],
    step: { ...step, status: "Succeeded", output: { arrived: arrival.arrived, expected: arrival.expected, released: true, mode: node.mode } },
    costUsd: 0,
  };
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

/**
 * Iterates a body, bounded by BOTH the node's own mandatory `maxIterations` (V4/FR-WF-01)
 * and the run-wide `run_limits.maxLoopIterations` (FR-WF-06) — the stricter wins.
 *
 * Reaching the cap is NOT a run failure: the loop simply stops iterating and continues
 * to `next`, which is what an author means by "at most N times". A run only terminates
 * at `BudgetExceeded` when a RUN-level ceiling (steps, cost, wall clock) is hit, which is
 * a different thing and is checked in `run-executor.ts`. Recording the cap-reached
 * decision on the step keeps that distinction visible in the trace.
 *
 * `over` (collection) and `whileCondition` both narrow further: an exhausted collection
 * or a false condition exits the loop early, at the same `next`.
 */
function executeLoop(node: Extract<WorkflowNode, { kind: "Loop" }>, ctx: NodeExecutionContext, startedAt: Date): NodeOutcome {
  const step = { ...baseStep(node, ctx.entry, startedAt), refKind: "None" as const };
  const iterations = loopCount(ctx.checkpoint, node.id);
  const budget = checkLoopBudget(ctx.limits, node.maxIterations, iterations);

  const exitTo = (reason: string, checkpoint: WorkflowCheckpoint): NodeOutcome => ({
    kind: "Advance",
    checkpoint: { ...checkpoint, loopCounters: { ...checkpoint.loopCounters, [node.id]: 0 } },
    successors: [successor(ctx.entry, node.next)],
    step: { ...step, status: "Succeeded", output: { iterations, exited: true, reason } },
    costUsd: 0,
  });

  if (!budget.ok) return exitTo("max_iterations_reached", ctx.checkpoint);

  if (node.over) {
    const collection = resolvePath(node.over, expressionRoot(ctx.checkpoint));
    if (!Array.isArray(collection)) return exitTo("collection_unresolved", ctx.checkpoint);
    if (iterations >= collection.length) return exitTo("collection_exhausted", ctx.checkpoint);
  }
  if (node.whileCondition && !evaluateCondition(node.whileCondition, expressionRoot(ctx.checkpoint))) {
    return exitTo("condition_false", ctx.checkpoint);
  }

  // Enter the body. The iteration index rides on the frontier entry so every node in the
  // body writes a step row per iteration (`workflow_run_step_attempt_key` is keyed on
  // `(run, node, iteration, attempt)`, so iteration 2 is a new row rather than a retry
  // of iteration 1) and so a write node inside the loop derives a DIFFERENT idempotency
  // key per iteration — see `domain/idempotency.ts`.
  let checkpoint = incrementLoop(ctx.checkpoint, node.id);
  if (node.over) {
    const collection = resolvePath(node.over, expressionRoot(ctx.checkpoint));
    if (Array.isArray(collection)) {
      checkpoint = withVariables(checkpoint, { [`${node.id}_item`]: toJsonValue(collection[iterations]), [`${node.id}_index`]: iterations });
    }
  }

  return {
    kind: "Advance",
    checkpoint,
    successors: [{ nodeId: node.bodyEntryNodeId, branchKey: ctx.entry.branchKey, iteration: iterations + 1 }],
    step: { ...step, status: "Succeeded", output: { iteration: iterations + 1, entered: true } },
    costUsd: 0,
  };
}

// ---------------------------------------------------------------------------
// SubWorkflow
// ---------------------------------------------------------------------------

/**
 * Invokes another PINNED `workflow_version` as a child run.
 *
 * Depth is re-checked here against `run_limits.maxSubWorkflowDepth` even though V8
 * resolves the chain statically at save time — the same defense-in-depth principle every
 * other ceiling in this module follows, and it is what keeps `workflow_run.depth`'s own
 * 0..8 DB CHECK from ever being the thing that surfaces the problem (a constraint
 * violation is a worse diagnostic than a declared `BudgetExceeded` outcome).
 *
 * Returns `SpawnChild` rather than creating the child itself: this file writes nothing,
 * so `run-executor.ts` creates the child run and suspends the parent on it in the same
 * transaction as the step row.
 */
function executeSubWorkflow(node: Extract<WorkflowNode, { kind: "SubWorkflow" }>, ctx: NodeExecutionContext, startedAt: Date): NodeOutcome {
  const step = {
    ...baseStep(node, ctx.entry, startedAt),
    refKind: "WorkflowVersion" as const,
    refVersionId: node.workflowVersionId,
    refLabel: node.workflowVersionId,
  };
  // The child run already reached a terminal state — fold its result into this node's
  // declared `outputVariable` and advance, rather than spawning a second child.
  const resumed = takeResumeMarker(ctx.checkpoint, node.id, ctx.entry.iteration);
  if (resumed.marker !== null) {
    const child = (resumed.marker ?? {}) as { runId?: string; state?: string; outcome?: string; variables?: JsonValue };
    const succeeded = child.state === "Succeeded";
    if (!succeeded) {
      return applyErrorPolicy(
        node,
        { ...ctx, checkpoint: resumed.checkpoint },
        { ...step, status: "Failed", childRunId: child.runId ?? null },
        { code: "WORKFLOW_SUBWORKFLOW_FAILED", message: `The sub-workflow run ended as '${child.state ?? "unknown"}' (${child.outcome ?? "no outcome"}).`, retriable: false },
        0,
        node.next,
      );
    }
    return {
      kind: "Advance",
      checkpoint: withVariable(resumed.checkpoint, node.outputVariable, child.variables ?? null),
      successors: [successor(ctx.entry, node.next)],
      step: { ...step, status: "Succeeded", childRunId: child.runId ?? null, output: { childRunId: child.runId, outcome: child.outcome } },
      costUsd: 0,
    };
  }

  const childDepth = ctx.depth + 1;
  const budget = checkSubWorkflowDepth(ctx.limits, childDepth);
  if (!budget.ok) {
    return budgetTerminationOutcome(ctx.checkpoint, step, { ...budget, message: BUDGET_BREACH_MESSAGES[budget.reason] }, node.id);
  }

  return {
    kind: "SpawnChild",
    checkpoint: ctx.checkpoint,
    step: { ...step, status: "Suspended" },
    costUsd: 0,
    child: { workflowVersionId: node.workflowVersionId, input: applyMapping(node.inputMapping, expressionRoot(ctx.checkpoint)), outputVariable: node.outputVariable },
    // Bounded by the parent's own remaining wall clock — FR-WF-05's "no suspension is
    // indefinite" applies to waiting on a child exactly as it does to waiting on a human.
    suspensionExpiresAt: new Date(Date.now() + ctx.limits.maxWallClockSeconds * 1000),
    suspensionExpiryOutcome: "Timeout",
  };
}
