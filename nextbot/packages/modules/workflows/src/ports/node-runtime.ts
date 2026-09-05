import type { ApprovalTierValue, JsonValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.4) — the seam between the
 * workflow executor's own logic (frontier, checkpoint, budgets, compensation) and the
 * four things a node actually *invokes*.
 *
 * Same shape and same justification as `@nextbot/teams`' `ports/specialist-runner.ts`:
 * the production implementations (`infrastructure/orchestration-node-runtime.ts`) are
 * real, ship in this module, and are what every non-executor test uses. The port exists
 * so the executor's own crash/lease/budget/compensation logic can be exercised
 * deterministically without standing up a model provider or an MCP server — not to
 * leave a hole where the real integration should be.
 *
 * **LLD §14.6.4 is the constraint this file encodes.** "The `ToolCall` node executor
 * does not call the MCP client. It calls `orchestration`'s existing tool-call pipeline
 * … A workflow therefore *cannot* route around tiering, because it has no other path to
 * a tool." `ToolDispatcher` below is that single path, and its only production
 * implementation goes through `runTierEngine` + the §14.2 authz evaluator + `EgressPort`
 * — the identical sequence `orchestration`'s own turn pipeline uses. The structural
 * proof is the `no-mcp-client-inside-workflows` dependency-cruiser rule: this module
 * cannot import `@nextbot/mcp-client` at all, so no second path can be added later
 * without the lint gate refusing it.
 */

// ---------------------------------------------------------------------------
// Tool dispatch (ToolCall node) — LLD §14.6.4
// ---------------------------------------------------------------------------

export interface ToolDispatchInput {
  /** The pinned `tool.id` from the authored `ToolCallNode`. */
  toolId: string;
  /** Resolved from `argMapping` against the run's variables, then PII-masked for
   *  persistence by the caller. The RAW args are what reach the tool. */
  args: Record<string, JsonValue>;
  /** `null` for a run with no conversation, in which case a Tier-2/3 resolution
   *  cannot suspend (there is no `tool_call` row to create) and is reported as a
   *  policy denial — never as a silent execution above Tier-1. */
  conversationId: string | null;
  /** FR-WF-04's key. Derived from the node's declared `idempotency.strategy`, so a
   *  re-executed write node produces the SAME key and the downstream tool deduplicates
   *  it. This is the property the crash-resume proof asserts against the real side
   *  effect, not merely against the key having been passed. */
  idempotencyKey: string;
  /** Correlation only — `workflow_run_step.id`, so a suspended call in the Approval
   *  Queue is joinable back to the exact step that produced it. */
  workflowRunStepId: string;
}

export type ToolDispatchResult =
  | { kind: "Succeeded"; output: unknown; costUsd: string }
  | { kind: "Failed"; errorMessage: string; retriable: boolean }
  /** `resolve()` or the §14.2 evaluator said no. Terminal for this node — never
   *  retried, since a denial is a decision, not a transient error. */
  | { kind: "Denied"; reason: string }
  /** The tier engine suspended the call into the EXISTING Approval Queue. The node
   *  executor records `approval_request_id`/`tool_call_id` on the step and suspends the
   *  run; it does NOT wait. */
  | { kind: "AwaitingApproval"; toolCallId: string; approvalRequestId: string | null; tier: ApprovalTierValue; expiresAt: Date | null };

export interface ToolDispatcher {
  dispatch(input: ToolDispatchInput): Promise<ToolDispatchResult>;
  /** Reads a suspended call's current status so the reconciling pump can tell whether
   *  an `Approval` suspension has resolved, been rejected, or expired — without this
   *  module ever writing to `tool_call` itself. */
  readToolCallOutcome(toolCallId: string): Promise<{ status: string; output: unknown; errorMessage: string | null } | null>;
  /** Expires a suspended call through `orchestration`'s SHARED expiry primitive
   *  (ADR-0013 §7.4). The workflow suspension sweep calls this rather than writing
   *  `tool_call` directly, so a workflow run and the Approval Queue are governed by one
   *  clock, not two. */
  expireToolCall(toolCallId: string): Promise<{ expired: boolean }>;
  /** The pinned tool's read/write classification — decides whether a compensation
   *  entry is pushed after a successful call (FR-WF-04). Resolved at run time rather
   *  than trusted from the graph, so a tool reclassified since the version was saved is
   *  treated correctly. */
  resolveToolRwClass(toolId: string): Promise<"Read" | "Write" | null>;
}

// ---------------------------------------------------------------------------
// Agent / Skill invocation (Agent, Skill nodes)
// ---------------------------------------------------------------------------

export interface AgentInvokeInput {
  /** PINNED `agent_definition_version.id` from the authored `AgentNode`. */
  agentDefinitionVersionId: string;
  /** The mapped input, rendered to the text the agent turn receives. */
  task: string;
  conversationId: string | null;
  /** The workflow run's `agent_run_id`, so the agent's own trace joins to this run. */
  agentRunId: string | null;
}

export interface AgentInvokeResult {
  outcome: "answered" | "escalate" | "not_understood";
  text: string | null;
  costUsd: string;
  /** Set when the pinned version no longer exists / is Deprecated. Routed through the
   *  node's `onError`, never silently answered around — the same FR-ORC-10 discipline
   *  `teams`' delegation executor holds ("the supervisor never answers in the
   *  specialist's place"). */
  unavailableReason?: string;
}

export interface AgentInvoker {
  invoke(input: AgentInvokeInput): Promise<AgentInvokeResult>;
}

export interface SkillInvokeInput {
  /** PINNED `skill_version.id` from the authored `SkillNode`. */
  skillVersionId: string;
  task: string;
}

export interface SkillInvokeResult {
  text: string | null;
  costUsd: string;
  unavailableReason?: string;
}

export interface SkillInvoker {
  invoke(input: SkillInvokeInput): Promise<SkillInvokeResult>;
}

// ---------------------------------------------------------------------------
// Router classification (Router node, `mode: 'Classifier'`)
// ---------------------------------------------------------------------------

export interface ClassifyInput {
  /** PINNED `model_route_version.id`. Validated router-class at save time by the graph
   *  validator (`isRouterClassRoute`), so this is always a cheap route. */
  routeVersionId: string;
  /** The text to classify — the run's variables rendered for the model. */
  text: string;
  /** The branch labels the model must choose between: each branch's `when` source, or
   *  its target node id when it has no condition. */
  choices: string[];
}

export interface ClassifyResult {
  /** Index into `choices`, or `null` when the model produced nothing usable — which
   *  routes to the Router's REQUIRED `default` (V11), never to a dead end. */
  choiceIndex: number | null;
  costUsd: string;
}

export interface RouterClassifier {
  classify(input: ClassifyInput): Promise<ClassifyResult>;
}

// ---------------------------------------------------------------------------
// Escalation (HumanTask node, queue = 'EscalationQueue')
// ---------------------------------------------------------------------------

export interface RaiseEscalationInput {
  conversationId: string;
  queueId: string;
  reason: "LowConfidence" | "ToolFailure" | "CustomerRequest" | "SensitiveTopic";
  prompt: string;
  runId: string;
  nodeId: string;
}

export interface EscalationRaiser {
  raise(input: RaiseEscalationInput): Promise<{ escalationId: string }>;
  /** Whether the escalation has reached a terminal human outcome, so the reconciling
   *  pump can resume the suspended run. */
  readEscalationStatus(escalationId: string): Promise<"Waiting" | "InProgress" | "Resolved" | "ReturnedToBot" | null>;
}

// ---------------------------------------------------------------------------
// PII masking (every persisted step input/output) — LLD §14.6.2
// ---------------------------------------------------------------------------

/** Wraps `@nextbot/pii`'s EXISTING masker. A port rather than a direct call purely so
 *  the executor's tests do not each need a real `pii_policy` fixture; the production
 *  implementation is the same `detectAndMask` + `buildPolicyLookup` pair `teams`'
 *  delegation executor uses, never a second masking path. */
export interface StepMasker {
  mask(value: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// The bundle the executor takes
// ---------------------------------------------------------------------------

export interface WorkflowNodeRuntime {
  tools: ToolDispatcher;
  agents: AgentInvoker;
  skills: SkillInvoker;
  classifier: RouterClassifier;
  escalations: EscalationRaiser;
  masker: StepMasker;
}
