import { listTools, McpTransportError } from "@nextbot/mcp-client";
import { computeSchemaHash } from "../domain/manifest-hash.js";

export interface LiveManifestTool {
  name: string;
  schemaHash: string;
  schemaJson: unknown;
  descriptionSource: string;
}

/**
 * A port (mirrors `orchestration`'s `EgressPort` convention) so the reconciler is
 * testable against a fake without a real network call, while production wiring uses
 * `mcpClientManifestFetchPort` below — a thin adapter over `@nextbot/mcp-client`'s
 * real `listTools`. `@nextbot/mcp-client` is a shared package (`packages/mcp-client`,
 * not `packages/modules/*`), so importing it directly here is not a module-boundary
 * violation — it's the same shared-package access every module already has.
 */
export interface ManifestFetchPort {
  fetchLiveTools(server: { endpointUrl: string; transport: string }): Promise<LiveManifestTool[]>;
}

/** Disclosed scope reduction (see `schema/mcp-registry.ts`'s doc comment): no
 * per-environment credential resolution yet (BL-34) — every server this phase
 * enrols/reconciles is reached with no auth headers. A tenant with a real
 * authenticated MCP server cannot yet be reconciled through this path; that gap
 * closes with BL-34's credential-vault-backed environment binding. */
export const mcpClientManifestFetchPort: ManifestFetchPort = {
  async fetchLiveTools(server) {
    try {
      const tools = await listTools({ endpointUrl: server.endpointUrl });
      return tools.map((t) => ({
        name: t.name,
        schemaHash: computeSchemaHash(t.inputSchema),
        schemaJson: t.inputSchema,
        descriptionSource: t.description ?? "",
      }));
    } catch (err) {
      if (err instanceof McpTransportError) throw err;
      throw new McpTransportError(err instanceof Error ? err.message : String(err));
    }
  },
};
