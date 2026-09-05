// PUBLIC API for "@nextbot/ai-registry" (LLD §7.1). The only package that may import
// @google/adk or a model-provider SDK — enforced by dependency-cruiser
// (`no-provider-sdk-outside-ai-registry`) and `no-provider-sdk-outside-ai-registry`'s
// sibling ADK rule.

export { loadAiRegistryEnv, resolveEnvModelId, LOGICAL_MODEL_NAMES, type LogicalModelName, type AiRegistryEnv } from "./config.js";
export { resolveModel, executeChain, generateTextOverChain, type ResolvedChainEntry } from "./registry.js";
export { generateStructured, generateText } from "./structured.js";
export { embed } from "./embed.js";
export { ProviderCallError, type ChatMessage, type ModelProviderClient } from "./providers/types.js";
export { getProviderClient } from "./providers/index.js";

// GraphRuntime port (ADR-0003) — NextBot-owned types, the ADK adapter, and the
// in-tree FSM implementation kept alongside it as the abstraction's continuous proof.
export {
  type GraphRuntime,
  type AgentGraphDefinition,
  type CompiledGraph,
  type RunInput,
  type RunContext,
  type RunEvent,
  type RunCheckpoint,
  type PendingResolution,
  type ToolHandle,
  CONFORMANCE_PENDING_APPROVAL_TRIGGER,
} from "./graph-runtime/types.js";
export { resolveGraphRuntime } from "./graph-runtime/registry.js";
export { createFsmGraphRuntime } from "./graph-runtime/fsm-graph-runtime.js";
export { createAdkGraphRuntime } from "./adk/adk-graph-runtime.js";
