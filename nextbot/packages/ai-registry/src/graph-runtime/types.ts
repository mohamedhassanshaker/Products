/**
 * The `GraphRuntime` port (ADR-0003) — NextBot-owned types, never a re-export of an
 * underlying framework's own shapes. This is what keeps the Trace Viewer, the
 * approval engine, and every other Data-Plane consumer framework-independent: they
 * only ever see `RunEvent`/`RunCheckpoint`, never an ADK `Event`/`Session`.
 */

/** A tool made available to the graph for this run. Binding/resolution from the Agent
 * Tool Registry + policy filtering happens in `orchestration` (Phase 12) — by the time
 * a `ToolHandle` reaches `load()`, it is already permission-filtered; the graph
 * framework is never shown a tool it may not call (ADR-0003 rule 2). */
export interface ToolHandle {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentGraphDefinition {
  /** Used as the graph/agent's display name — not a secret, safe to log. */
  name: string;
  instructions: string;
  /** Logical model name (LLD §7.1) — never a vendor model id (ADR-0003 rule 2: "ADK
   * never sees ... a vendor model id"). */
  modelRouteKey: string;
  tools: ToolHandle[];
}

export interface RunInput {
  text: string;
}

export interface RunContext {
  runId: string;
  tenantId: string;
  userId: string;
  conversationId?: string;
}

/** Normalized event shapes (ADR-0003 rule 3) — every `GraphRuntime` implementation
 * emits exactly these, regardless of the underlying framework's own event model. */
export type RunEvent =
  | { type: "TextDelta"; text: string }
  | { type: "ToolCallRequested"; callId: string; toolName: string; args: Record<string, unknown> }
  | { type: "ToolCallResult"; callId: string; result: unknown }
  | { type: "PendingApproval"; callId: string; toolName: string; args: Record<string, unknown> }
  | { type: "Final"; text: string; confidence?: number }
  | { type: "Error"; message: string }
  /** Emitted whenever the adapter has state that must survive a suspend (today: right
   * alongside `PendingApproval` — a normally-completing run needs no checkpoint,
   * matching `agent_run.checkpoint` staying NULL for non-paused runs, LLD §3.10). The
   * driving caller (the Phase 12 turn-runner; the conformance suite in the interim)
   * persists this blob verbatim and passes it back to `resume()` unchanged. */
  | { type: "Checkpoint"; checkpoint: RunCheckpoint };

/** Opaque, framework-specific serialized run state (LLD §7.4 / ADR-0005) — stored
 * verbatim in `agent_run.checkpoint`. Nothing above the adapter interprets its shape. */
export type RunCheckpoint = Record<string, unknown>;

export interface PendingResolution {
  callId: string;
  result: unknown;
}

/** The result of `GraphRuntime.load()` — an opaque handle passed back into
 * `start()`/`resume()`. `graphType` is included only for logging/observability. */
export interface CompiledGraph {
  graphType: string;
  handle: unknown;
}

/**
 * ADR-0003's port — Google ADK is one adapter behind it (`../adk/adk-graph-runtime.js`),
 * a trivial in-tree FSM is the second, kept in-tree specifically so the abstraction
 * cannot silently rot: "if the FSM runtime stops passing the shared runtime
 * conformance suite, the abstraction has been violated and CI fails."
 */
export interface GraphRuntime {
  load(definition: AgentGraphDefinition): CompiledGraph;
  start(compiled: CompiledGraph, input: RunInput, ctx: RunContext): AsyncIterable<RunEvent>;
  resume(compiled: CompiledGraph, checkpoint: RunCheckpoint, resolution: PendingResolution, ctx: RunContext): AsyncIterable<RunEvent>;
}

/**
 * Test-only, port-level "pause" trigger shared by every `GraphRuntime` implementation's
 * conformance suite (see `conformance-suite.ts`). Recognized structurally by each
 * adapter *before* any model call — proving the suspend/resume contract
 * deterministically, independent of any single model's own (nondeterministic) choice
 * to call a tool. Real tool-triggered suspension (an actual model deciding to call a
 * Tier-2/3 tool) is exercised end-to-end starting Phase 12/14, once the orchestration
 * pipeline and approval engine exist to drive it.
 */
export const CONFORMANCE_PENDING_APPROVAL_TRIGGER = "__NEXTBOT_TEST_PENDING_APPROVAL__";
