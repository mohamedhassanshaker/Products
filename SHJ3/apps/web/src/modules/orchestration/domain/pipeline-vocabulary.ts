/**
 * The closed vocabularies the Pipeline Designer's own domain model uses — mirrors
 * `router-config-vocabulary.ts`'s own "transcribe the real CHECK constraint's closed
 * vocabulary verbatim, never guess it" convention. These four sets are defined here,
 * ahead of the Prisma migration itself (this feature's own wave 1: pure domain layers
 * land before schema), and MUST stay byte-identical to `CK_PipelineNodes_kind`/
 * `CK_PipelineEdges_kind`/`CK_PipelineNodes_inputContextMode`/
 * `CK_PipelineNodes_onErrorPolicy` once that migration lands — the same four closed sets
 * the Python-side `apps/ai/src/shj3_ai/domain/pipeline.py` `StrEnum`s already define for
 * the AI runtime side of this same feature.
 */

/** `PipelineNodes.kind`. `Start` exists because a parallel fan-out needs a source that
 *  isn't itself an agent invocation, and gives a version's `entryNodeId` an unambiguous,
 *  model-call-free home. */
export const PIPELINE_NODE_KINDS = ["Start", "Agent", "Supervisor", "Response"] as const;
export type PipelineNodeKind = (typeof PIPELINE_NODE_KINDS)[number];

/** `PipelineEdges.kind`. `Parallel` is structural — two or more `Parallel` edges sharing
 *  one source node, executed concurrently — never a flag on a single edge alone. */
export const PIPELINE_EDGE_KINDS = ["Sequential", "Parallel", "LoopBack"] as const;
export type PipelineEdgeKind = (typeof PIPELINE_EDGE_KINDS)[number];

/** `PipelineNodes.inputContextMode` — how upstream node output becomes this node's own
 *  prompt context. `UpstreamRepliesSummary` is today's real supervisor `plan_summary` line
 *  (`process_turn.py`) made a configurable, per-node choice instead of a fixed behaviour. */
export const INPUT_CONTEXT_MODES = [
  "UserTurnOnly",
  "UpstreamRepliesFull",
  "UpstreamRepliesSummary",
] as const;
export type InputContextMode = (typeof INPUT_CONTEXT_MODES)[number];

/** `PipelineNodes.onErrorPolicy` — the first real enforcement point
 *  `RouterConfigs.fallbackAgentId` has ever had (`RouteToFallbackAgent`). */
export const NODE_ERROR_POLICIES = ["FailTurn", "SkipNode", "RouteToFallbackAgent"] as const;
export type NodeErrorPolicy = (typeof NODE_ERROR_POLICIES)[number];

/** `PipelineVersions.status` / `PipelineDesigns.status` — the same `Draft`/`Published`/
 *  `Archived` lifecycle `Agent`/`AgentVersion` and `Flow`/`FlowVersion` already use. */
export const PIPELINE_VERSION_STATUSES = ["Draft", "Published", "Archived"] as const;
export type PipelineVersionStatus = (typeof PIPELINE_VERSION_STATUSES)[number];
