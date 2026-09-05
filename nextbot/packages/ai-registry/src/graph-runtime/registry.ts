import type { GraphRuntime } from "./types.js";
import { createFsmGraphRuntime } from "./fsm-graph-runtime.js";
import { createAdkGraphRuntime } from "../adk/adk-graph-runtime.js";

/** ADR-0003: "Selection is per Agent Definition, keyed on `graph_type`, resolved from
 * a registry map at run start. Adding a graph type is a new adapter package plus a
 * registry entry — no change to the orchestrator, the gateway, or the schema."
 * `LangGraph`/`PydanticAI` are the NFR-12 pluggability seam's un-implemented values —
 * `agent_definition_version.graph_type` accepts them, but resolving one here throws,
 * which is exactly the `GRAPH_TYPE_NOT_INSTALLED` promotion-gate failure LLD §3.10
 * describes at the schema layer; this is its runtime-layer mirror. */
export function resolveGraphRuntime(graphType: string): GraphRuntime {
  switch (graphType) {
    case "ADK":
      return createAdkGraphRuntime();
    case "CustomFSM":
      return createFsmGraphRuntime();
    default:
      throw new Error(`GRAPH_TYPE_NOT_INSTALLED: graph type '${graphType}' has no runtime adapter in this deployment.`);
  }
}
