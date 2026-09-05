import type { TenantContext } from "@nextbot/db";
import type { RequestedCapability, ScopeDescriptor, WorkflowGraph, WorkflowGraphIssue, WorkflowNode } from "@nextbot/contracts";
import { findAgentDefinitionVersionById } from "@nextbot/agent-platform";
import { findSkillVersionById } from "@nextbot/skills";
import { findToolById, type ToolRow } from "@nextbot/tool-registry";
import { findServerVersionById } from "@nextbot/mcp-registry";
import { getRouteOrThrow, getRouteVersion, isRouterClassRoute } from "@nextbot/model-gateway";
import { findAgentQueueById } from "@nextbot/escalations";
import { evaluateOrDeny, getTenantScopePolicy } from "@nextbot/authz";
import { composeWorkflowNodeScope } from "../domain/workflow-scope.js";
import { findWorkflowVersionById } from "../infrastructure/workflow-repository.js";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.3) —
 * the 12 cross-field graph-validation rules (V1-V12). Every rule TypeBox alone
 * cannot express — this is the same pattern `agent-platform/application/
 * artifact-validator.ts` established for `AgentDefinitionArtifactSchema`.
 *
 * **Disclosed path correction**: this dispatch's own brief names this file
 * `workflows/domain/graph-validator.ts`; it lives under `application/` instead.
 * `domain/` is structurally enforced pure/I/O-free (`.dependency-cruiser.cjs`'s
 * `no-db-inside-domain` rule) — this function calls six other modules' real
 * repositories/services (`agent-platform`, `skills`, `tool-registry`,
 * `mcp-registry`, `model-gateway`, `escalations`) plus `@nextbot/authz`'s real
 * evaluator (a Postgres read for the tenant floor), so `domain` is not a legal
 * home for it regardless of the brief's literal path — exactly the same
 * correction `artifact-validator.ts`'s own doc comment already made and disclosed
 * for the identical reason.
 *
 * Every rule returns issues into a shared `WorkflowGraphIssue[]` array rather than
 * throwing on the first failure — the console (and `POST .../validate`) shows
 * every offending node at once, never just the first.
 */

// ---------------------------------------------------------------------------
// Edge collection — two distinct views of the same graph:
//  - `allEdgeRefs`: every id-shaped reference a node carries, INCLUDING purely
//    structural back-references (`Parallel.joinNodeId`/`Join.parallelNodeId`) —
//    used by V2 ("every reference resolves to an existing node").
//  - `executionForwardTargets`: only the edges that represent an actual EXECUTION
//    path forward — used by V3 (termination) and V7 (cycle detection). Including
//    `joinNodeId`/`parallelNodeId` here would incorrectly treat a structural link
//    as if control flow itself passed through it.
// ---------------------------------------------------------------------------

interface EdgeRef {
  field: string;
  to: string;
}

function allEdgeRefs(node: WorkflowNode): EdgeRef[] {
  switch (node.kind) {
    case "Trigger":
      return [{ field: "next", to: node.next }];
    case "Agent":
    case "Skill":
    case "ToolCall":
    case "SubWorkflow":
      return [{ field: "next", to: node.next }];
    case "Router": {
      const refs: EdgeRef[] = node.branches.map((b, i) => ({ field: `branches[${i}].to`, to: b.to }));
      if (node.default) refs.push({ field: "default", to: node.default });
      return refs;
    }
    case "HumanTask": {
      const refs: EdgeRef[] = [{ field: "next", to: node.next }];
      if (node.onReject) refs.push({ field: "onReject", to: node.onReject });
      return refs;
    }
    case "Parallel":
      return [...node.branches.map((b, i) => ({ field: `branches[${i}]`, to: b })), { field: "joinNodeId", to: node.joinNodeId }];
    case "Join":
      return [
        { field: "next", to: node.next },
        { field: "parallelNodeId", to: node.parallelNodeId },
      ];
    case "Loop":
      return [
        { field: "bodyEntryNodeId", to: node.bodyEntryNodeId },
        { field: "next", to: node.next },
      ];
    case "Wait":
      return [{ field: "next", to: node.next }];
    case "End":
      return [];
  }
}

function executionForwardTargets(node: WorkflowNode): string[] {
  switch (node.kind) {
    case "Trigger":
      return [node.next];
    case "Agent":
    case "Skill":
    case "ToolCall":
    case "SubWorkflow":
      return [node.next];
    case "Router":
      return [...node.branches.map((b) => b.to), ...(node.default ? [node.default] : [])];
    case "HumanTask":
      return [node.next, ...(node.onReject ? [node.onReject] : [])];
    case "Parallel":
      return [...node.branches];
    case "Join":
      return [node.next];
    case "Loop":
      return [node.bodyEntryNodeId, node.next];
    case "Wait":
      return [node.next];
    case "End":
      return [];
  }
}

function notFoundIssue(nodeId: string, field: string, value: string): WorkflowGraphIssue {
  return { code: "WORKFLOW_REFERENCE_NOT_FOUND", message: `'${nodeId}.${field}' references '${value}', which does not exist for this tenant.`, path: `${nodeId}.${field}` };
}

function deprecatedIssue(nodeId: string, field: string, value: string, detail?: string): WorkflowGraphIssue {
  return {
    code: "WORKFLOW_REFERENCE_DEPRECATED",
    message: `'${nodeId}.${field}' references '${value}', which is no longer usable${detail ? ` (${detail})` : ""}.`,
    path: `${nodeId}.${field}`,
  };
}

// --- V1 -----------------------------------------------------------------------

function checkExactlyOneTrigger(nodes: WorkflowNode[], issues: WorkflowGraphIssue[]): void {
  const triggers = nodes.filter((n) => n.kind === "Trigger");
  if (triggers.length !== 1) {
    issues.push({ code: "WORKFLOW_TRIGGER_REQUIRED", message: `A workflow must have exactly one Trigger node (found ${triggers.length}).`, path: null });
  }
}

// --- V2 -----------------------------------------------------------------------

function checkEdgesResolve(nodes: WorkflowNode[], byId: Map<string, WorkflowNode>, issues: WorkflowGraphIssue[]): void {
  for (const node of nodes) {
    for (const ref of allEdgeRefs(node)) {
      if (!byId.has(ref.to)) {
        issues.push({
          code: "WORKFLOW_EDGE_UNRESOLVED",
          message: `'${node.id}.${ref.field}' references node '${ref.to}', which does not exist in this workflow.`,
          path: `${node.id}.${ref.field}`,
        });
      }
    }
  }
}

// --- V3 -------------------------------------------------------------------------

/** Reverse-reachability from every `End` node must cover every node — i.e. from
 * every node, SOME execution path reaches a terminal outcome. Unresolved edges
 * (V2's own concern) are simply skipped here rather than double-reported. */
function checkEveryPathTerminates(nodes: WorkflowNode[], byId: Map<string, WorkflowNode>, issues: WorkflowGraphIssue[]): void {
  const reverse = new Map<string, Set<string>>();
  for (const n of nodes) reverse.set(n.id, new Set());
  for (const n of nodes) {
    for (const to of executionForwardTargets(n)) {
      if (byId.has(to)) reverse.get(to)!.add(n.id);
    }
  }

  const endIds = nodes.filter((n) => n.kind === "End").map((n) => n.id);
  const reached = new Set(endIds);
  const queue = [...endIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const source of reverse.get(current) ?? []) {
      if (!reached.has(source)) {
        reached.add(source);
        queue.push(source);
      }
    }
  }

  for (const n of nodes) {
    if (!reached.has(n.id)) {
      issues.push({ code: "WORKFLOW_UNTERMINATED_PATH", message: "Every path through this workflow must reach a terminal outcome.", path: n.id });
    }
  }
}

// --- V4 -----------------------------------------------------------------------

function checkLoopCaps(nodes: WorkflowNode[], issues: WorkflowGraphIssue[]): void {
  for (const node of nodes) {
    if (node.kind === "Loop" && (node.maxIterations === undefined || node.maxIterations === null)) {
      issues.push({ code: "WORKFLOW_LOOP_CAP_REQUIRED", message: "A maximum iteration count is required for every Loop node.", path: node.id });
    }
  }
}

// --- V6 -----------------------------------------------------------------------

function checkParallelJoinBalance(nodes: WorkflowNode[], byId: Map<string, WorkflowNode>, maxParallelBranches: number, issues: WorkflowGraphIssue[]): void {
  for (const node of nodes) {
    if (node.kind === "Parallel") {
      if (node.branches.length > maxParallelBranches) {
        issues.push({
          code: "WORKFLOW_PARALLEL_UNBALANCED",
          message: `Parallel node '${node.id}' has ${node.branches.length} branches, exceeding the configured maxParallelBranches (${maxParallelBranches}).`,
          path: node.id,
        });
      }
      const join = byId.get(node.joinNodeId);
      if (join !== undefined) {
        if (join.kind !== "Join") {
          issues.push({ code: "WORKFLOW_PARALLEL_UNBALANCED", message: `Parallel node '${node.id}'s joinNodeId '${node.joinNodeId}' does not resolve to a Join node.`, path: node.id });
        } else if (join.parallelNodeId !== node.id) {
          issues.push({
            code: "WORKFLOW_PARALLEL_UNBALANCED",
            message: `Parallel node '${node.id}' points at Join '${node.joinNodeId}', but that Join's own parallelNodeId does not point back to '${node.id}'.`,
            path: node.id,
          });
        }
      }
    }
    if (node.kind === "Join") {
      const parallel = byId.get(node.parallelNodeId);
      if (parallel !== undefined) {
        if (parallel.kind !== "Parallel") {
          issues.push({ code: "WORKFLOW_PARALLEL_UNBALANCED", message: `Join node '${node.id}'s parallelNodeId '${node.parallelNodeId}' does not resolve to a Parallel node.`, path: node.id });
        } else if (parallel.joinNodeId !== node.id) {
          issues.push({
            code: "WORKFLOW_PARALLEL_UNBALANCED",
            message: `Join node '${node.id}' points at Parallel '${node.parallelNodeId}', but that Parallel's own joinNodeId does not point back to '${node.id}'.`,
            path: node.id,
          });
        }
      }
    }
  }
}

// --- V7 -----------------------------------------------------------------------

/** DFS-based cycle detection over `executionForwardTargets`. A "DFS forest" over
 * every node as a potential root, with a single shared `visited` set, correctly
 * finds every cycle reachable from any starting point exactly once (the standard
 * multi-root cycle-detection technique) — cheap enough for the size of graph a
 * human actually authors by hand. */
function checkNoUnboundedCycle(nodes: WorkflowNode[], byId: Map<string, WorkflowNode>, issues: WorkflowGraphIssue[]): void {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  function visit(id: string): void {
    if (inStack.has(id)) {
      const startIndex = stack.indexOf(id);
      const cycle = stack.slice(startIndex).concat(id);
      const hasLoopNode = cycle.some((cycleId) => byId.get(cycleId)?.kind === "Loop");
      if (!hasLoopNode) {
        issues.push({
          code: "WORKFLOW_UNBOUNDED_CYCLE",
          message: `A cycle was detected that does not pass through a Loop node: ${cycle.join(" -> ")}.`,
          path: cycle[0] ?? null,
        });
      }
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const to of executionForwardTargets(node)) {
        if (byId.has(to)) visit(to);
      }
    }
    stack.pop();
    inStack.delete(id);
  }

  for (const n of nodes) visit(n.id);
}

// --- V8 -----------------------------------------------------------------------

/** Statically resolves `SubWorkflow` nesting depth by walking each pinned,
 * already-persisted `workflow_version.graph_json` recursively. Because
 * `SubWorkflow.workflowVersionId` pins an IMMUTABLE, already-existing row (never
 * the version currently being authored, which has no id yet), a true infinite
 * cycle is structurally close to impossible by construction — `visited` is kept
 * as a genuine, tested safety net rather than a decorative check, per LLD
 * §14.6.3's explicit "no self- or mutual recursion" requirement. */
async function maxDepthThroughSubWorkflows(ctx: TenantContext, nodes: WorkflowNode[], visited: ReadonlySet<string>, issues: WorkflowGraphIssue[]): Promise<number> {
  let maxDepth = 0;
  for (const node of nodes) {
    if (node.kind !== "SubWorkflow") continue;
    if (visited.has(node.workflowVersionId)) {
      issues.push({
        code: "WORKFLOW_SUBWORKFLOW_DEPTH",
        message: `Sub-workflow node '${node.id}' creates a recursive reference back to a workflow version already in its own call chain ('${node.workflowVersionId}') — no self- or mutual recursion is allowed.`,
        path: node.id,
      });
      continue;
    }
    const referenced = await findWorkflowVersionById(ctx, node.workflowVersionId);
    if (!referenced) continue; // already reported as WORKFLOW_REFERENCE_NOT_FOUND
    const childGraph = referenced.graphJson;
    const childDepth = await maxDepthThroughSubWorkflows(ctx, childGraph.spec.nodes, new Set([...visited, node.workflowVersionId]), issues);
    maxDepth = Math.max(maxDepth, 1 + childDepth);
  }
  return maxDepth;
}

async function checkSubWorkflowDepth(ctx: TenantContext, nodes: WorkflowNode[], maxSubWorkflowDepth: number, issues: WorkflowGraphIssue[]): Promise<void> {
  const depth = await maxDepthThroughSubWorkflows(ctx, nodes, new Set(), issues);
  if (depth > maxSubWorkflowDepth) {
    issues.push({
      code: "WORKFLOW_SUBWORKFLOW_DEPTH",
      message: `Sub-workflow nesting depth (${depth}) exceeds the configured limit (${maxSubWorkflowDepth}).`,
      path: null,
    });
  }
}

// --- V9 (+ V5, which needs V9's resolved tool row) ------------------------------

/**
 * Resolves every pinned reference against the real database (tenant-scoped by
 * construction — every lookup below goes through `withTenant`), and performs V5's
 * write-node-safety check inline for `ToolCall` nodes (it needs the SAME resolved
 * tool row V9 already fetched, so doing it as a second pass would be a wasted
 * duplicate query).
 *
 * @returns the resolved `ToolRow` for every `ToolCall` node, keyed by node id — V10
 *   (`checkNodeScopes`) reuses this to build the `requested` capability without a
 *   third redundant fetch.
 */
async function resolveReferencesAndWriteSafety(ctx: TenantContext, nodes: WorkflowNode[], issues: WorkflowGraphIssue[]): Promise<Map<string, ToolRow>> {
  const toolsByNodeId = new Map<string, ToolRow>();

  for (const node of nodes) {
    switch (node.kind) {
      case "Agent": {
        const version = await findAgentDefinitionVersionById(ctx, node.agentDefinitionVersionId);
        if (!version) issues.push(notFoundIssue(node.id, "agentDefinitionVersionId", node.agentDefinitionVersionId));
        else if (version.status === "Deprecated") issues.push(deprecatedIssue(node.id, "agentDefinitionVersionId", node.agentDefinitionVersionId));
        break;
      }
      case "Skill": {
        const version = await findSkillVersionById(ctx, node.skillVersionId);
        if (!version) issues.push(notFoundIssue(node.id, "skillVersionId", node.skillVersionId));
        else if (version.status === "Deprecated") issues.push(deprecatedIssue(node.id, "skillVersionId", node.skillVersionId));
        break;
      }
      case "ToolCall": {
        const tool = await findToolById(ctx, node.toolId);
        if (!tool) {
          issues.push(notFoundIssue(node.id, "toolId", node.toolId));
        } else {
          if (tool.status !== "Active") issues.push(deprecatedIssue(node.id, "toolId", node.toolId, `tool status is '${tool.status}'`));
          toolsByNodeId.set(node.id, tool);
          // V5 — a Write-class tool call is a distributed transaction with no
          // rollback path unless BOTH idempotency and compensation are declared.
          if (tool.rwClass === "Write" && (!node.idempotency || !node.compensation)) {
            const missing = [!node.idempotency ? "idempotency" : null, !node.compensation ? "compensation" : null].filter(Boolean).join(" and ");
            issues.push({
              code: "WORKFLOW_WRITE_NODE_UNSAFE",
              message: `ToolCall node '${node.id}' calls a Write-class tool but is missing ${missing} — this workflow is a distributed transaction with no rollback path.`,
              path: node.id,
            });
          }
        }
        const mcpVersion = await findServerVersionById(ctx, node.mcpServerVersionId);
        if (!mcpVersion) issues.push(notFoundIssue(node.id, "mcpServerVersionId", node.mcpServerVersionId));
        else if (mcpVersion.status !== "Approved") issues.push(deprecatedIssue(node.id, "mcpServerVersionId", node.mcpServerVersionId, `mcp server version status is '${mcpVersion.status}'`));
        break;
      }
      case "SubWorkflow": {
        const version = await findWorkflowVersionById(ctx, node.workflowVersionId);
        if (!version) issues.push(notFoundIssue(node.id, "workflowVersionId", node.workflowVersionId));
        else if (version.status === "Deprecated") issues.push(deprecatedIssue(node.id, "workflowVersionId", node.workflowVersionId));
        break;
      }
      case "Router": {
        if (node.mode === "Classifier" && node.classifierRouteVersionId) {
          const routeVersion = await getRouteVersion(ctx, node.classifierRouteVersionId);
          if (!routeVersion) {
            issues.push(notFoundIssue(node.id, "classifierRouteVersionId", node.classifierRouteVersionId));
            break;
          }
          if (routeVersion.status === "Deprecated") {
            issues.push(deprecatedIssue(node.id, "classifierRouteVersionId", node.classifierRouteVersionId));
            break;
          }
          // Not one of V9's two named codes — a disclosed, dedicated addition
          // enforcing RouterNode's own field-level requirement (see
          // `@nextbot/contracts`'s `workflows.ts` doc comment on this code).
          const route = await getRouteOrThrow(ctx, routeVersion.routeId);
          if (!isRouterClassRoute(route)) {
            issues.push({
              code: "WORKFLOW_ROUTER_CLASSIFIER_ROUTE_EXPENSIVE",
              message: `Router node '${node.id}'s classifier route '${route.name}' is not router-class (role '${route.role}') — Classifier mode requires a cheap chat.router-class route, never a frontier model.`,
              path: node.id,
            });
          }
        }
        break;
      }
      case "HumanTask": {
        if (node.queue === "EscalationQueue" && node.escalationQueueId) {
          const queue = await findAgentQueueById(ctx, node.escalationQueueId);
          if (!queue) issues.push(notFoundIssue(node.id, "escalationQueueId", node.escalationQueueId));
          else if (queue.deletedAt) issues.push(deprecatedIssue(node.id, "escalationQueueId", node.escalationQueueId, "queue has been deleted"));
        }
        break;
      }
      default:
        break;
    }
  }

  return toolsByNodeId;
}

// --- V10 ------------------------------------------------------------------------

/** The specific capability a node's own kind requests, if any — only `ToolCall`/
 * `Agent`/`Skill`/`SubWorkflow` nodes actually name a capability; every other kind
 * returns `undefined` (the fold still runs for those if the node declares its own
 * `scope`, just without a dimension-specific permission check — see
 * `RequestedCapabilitySchema`'s own doc comment: "omitting a field means that
 * dimension is evaluated for scope but not for permission"). */
function buildRequestedCapability(node: WorkflowNode, tool: ToolRow | undefined): RequestedCapability | undefined {
  switch (node.kind) {
    case "ToolCall":
      return tool ? { kind: "ToolCall", toolId: tool.id, toolRwClass: tool.rwClass, toolApprovalTier: tool.approvalTier } : undefined;
    case "Agent":
      return { kind: "AgentDelegation" };
    case "Skill":
      return { kind: "SkillActivation" };
    case "SubWorkflow":
      return { kind: "WorkflowNode" };
    default:
      return undefined;
  }
}

/**
 * For every node that declares its own `scope` narrowing OR names a capability
 * (ToolCall/Agent/Skill/SubWorkflow), folds `[workflowScope, nodeScope]` through
 * the REAL Phase 6 evaluator (`evaluateOrDeny` — never `evaluate()` directly,
 * per ADR-0012 §3/E11's fail-closed-on-error requirement, and never
 * reimplemented). A node with neither has nothing to narrow or request, so
 * calling the evaluator would be a pure no-op — skipped to avoid a pointless
 * database round-trip per node.
 */
async function checkNodeScopes(ctx: TenantContext, nodes: WorkflowNode[], workflowScope: ScopeDescriptor, toolsByNodeId: Map<string, ToolRow>, issues: WorkflowGraphIssue[]): Promise<void> {
  const tenantPolicy = await getTenantScopePolicy(ctx);

  for (const node of nodes) {
    const requested = buildRequestedCapability(node, toolsByNodeId.get(node.id));
    if (node.scope === undefined && requested === undefined) continue;

    const nodeScope = composeWorkflowNodeScope({ nodeOriginId: node.id, nodeLabel: node.label ?? node.id, spec: node.scope });

    const result = await evaluateOrDeny(ctx, {
      tenantId: ctx.tenantId,
      tenantPolicy,
      chain: [workflowScope, nodeScope],
      requested,
      depth: 0,
    });

    if (result.decision !== "Allow") {
      issues.push({
        code: "WORKFLOW_NODE_SCOPE_EMPTY",
        message: result.denyDetail ?? `Node '${node.id}' resolves to an empty capability intersection.`,
        path: node.id,
      });
    }
  }
}

// --- V11 -----------------------------------------------------------------------

function checkRouterDefaultRequired(nodes: WorkflowNode[], issues: WorkflowGraphIssue[]): void {
  for (const node of nodes) {
    if (node.kind === "Router" && !node.default) {
      issues.push({ code: "WORKFLOW_ROUTER_DEFAULT_REQUIRED", message: "A Router node must declare a 'default' branch — there is no implicit fallthrough.", path: node.id });
    }
  }
}

function checkJoinQuorumRequired(nodes: WorkflowNode[], issues: WorkflowGraphIssue[]): void {
  for (const node of nodes) {
    if (node.kind !== "Join") continue;
    if (node.mode === "Quorum" && (node.quorum === undefined || node.quorum === null)) {
      issues.push({ code: "WORKFLOW_JOIN_QUORUM_REQUIRED", message: "A Join node in 'Quorum' mode must declare a 'quorum' count.", path: node.id });
    } else if (node.mode !== "Quorum" && node.quorum !== undefined) {
      issues.push({
        code: "WORKFLOW_JOIN_QUORUM_REQUIRED",
        message: `A Join node's 'quorum' is only meaningful when mode is 'Quorum' (this node's mode is '${node.mode}').`,
        path: node.id,
      });
    }
  }
}

// --- V12 -----------------------------------------------------------------------

function checkHumanTaskConfiguration(nodes: WorkflowNode[], issues: WorkflowGraphIssue[]): void {
  for (const node of nodes) {
    if (node.kind !== "HumanTask") continue;
    if (node.queue === "ApprovalQueue") {
      if (!node.approvalTier) {
        issues.push({ code: "WORKFLOW_HUMAN_TASK_MISCONFIGURED", message: "A HumanTask node routed to the ApprovalQueue must declare approvalTier ('Tier3').", path: node.id });
      }
      if (node.escalationQueueId || node.escalationReason) {
        issues.push({
          code: "WORKFLOW_HUMAN_TASK_MISCONFIGURED",
          message: "A HumanTask node routed to the ApprovalQueue must not declare escalationQueueId/escalationReason.",
          path: node.id,
        });
      }
    } else {
      if (!node.escalationQueueId) {
        issues.push({ code: "WORKFLOW_HUMAN_TASK_MISCONFIGURED", message: "A HumanTask node routed to the EscalationQueue must declare escalationQueueId.", path: node.id });
      }
      if (node.approvalTier) {
        issues.push({ code: "WORKFLOW_HUMAN_TASK_MISCONFIGURED", message: "A HumanTask node routed to the EscalationQueue must not declare approvalTier.", path: node.id });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Runs every V1-V12 rule against a (structurally already-valid) workflow graph and
 * returns every failing rule — an empty array means the graph is valid.
 *
 * @param workflowScope the `ScopeDescriptor` this version's `spec.scope` composes
 *   to (`domain/workflow-scope.ts`'s `composeWorkflowVersionScope`) — computed by
 *   the caller (`application/workflow-service.ts`) since it needs the version's
 *   own id/label, which may not exist yet (a `/validate` call against an
 *   unsaved artifact uses the artifact's own `"<name>@<version>"` label instead,
 *   mirroring `teams`' identical convention).
 */
export async function validateWorkflowGraph(ctx: TenantContext, artifact: WorkflowGraph, workflowScope: ScopeDescriptor): Promise<WorkflowGraphIssue[]> {
  const issues: WorkflowGraphIssue[] = [];
  const nodes = artifact.spec.nodes;
  const byId = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const runLimits = artifact.spec.runLimits;

  checkExactlyOneTrigger(nodes, issues);
  checkEdgesResolve(nodes, byId, issues);
  checkEveryPathTerminates(nodes, byId, issues);
  checkLoopCaps(nodes, issues);
  checkParallelJoinBalance(nodes, byId, runLimits.maxParallelBranches, issues);
  checkNoUnboundedCycle(nodes, byId, issues);
  checkRouterDefaultRequired(nodes, issues);
  checkJoinQuorumRequired(nodes, issues);
  checkHumanTaskConfiguration(nodes, issues);

  const toolsByNodeId = await resolveReferencesAndWriteSafety(ctx, nodes, issues);
  await checkSubWorkflowDepth(ctx, nodes, runLimits.maxSubWorkflowDepth, issues);
  await checkNodeScopes(ctx, nodes, workflowScope, toolsByNodeId, issues);

  return issues;
}
