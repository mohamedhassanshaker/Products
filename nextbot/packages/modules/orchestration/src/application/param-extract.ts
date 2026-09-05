import { findToolById, type ToolRow } from "@nextbot/tool-registry";
import type { TenantContext } from "@nextbot/db";

export interface ExtractedToolCall {
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export type ParamExtractResult =
  | { kind: "Resolved"; tool: ToolRow; args: Record<string, unknown> }
  | { kind: "UnknownTool"; toolId: string };

/**
 * `BUILD` (LLD §6.2 step 1) — resolves the model's proposed `{ toolId, args }`
 * against the tenant's Agent Tool Registry. An unknown/no-longer-visible tool id is
 * *not* a pipeline error: LLD says this "rejects to the LLM" so the model can
 * recover conversationally, which is why this returns a discriminated result rather
 * than throwing.
 *
 * Full Ajv argument-schema validation (`VALIDATE`, LLD §6.2 step 2) intentionally
 * does **not** happen here: Ajv stays scoped to `@nextbot/mcp-client` (which itself
 * is only ever invoked from `apps/gateway`, ADR-0004) — the dispatch stage's egress
 * call is where args are actually validated against `tool.current_schema_version
 * .input_schema`, and the response is re-validated on return. This stage only
 * resolves *which* tool row the model meant.
 */
export async function extractToolCall(ctx: TenantContext, call: ExtractedToolCall): Promise<ParamExtractResult> {
  const tool = await findToolById(ctx, call.toolId);
  if (!tool) return { kind: "UnknownTool", toolId: call.toolId };
  return { kind: "Resolved", tool, args: call.args };
}
