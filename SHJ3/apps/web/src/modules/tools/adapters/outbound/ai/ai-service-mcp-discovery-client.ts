/**
 * The real `McpDiscoveryClient` adapter — calls `apps/ai`'s real, mounted internal
 * endpoint (`docs/api.md` §5.6: `POST /v1/tools/mcp/servers/{id}/connect`,
 * `adapters/inbound/tools_router.py`) via the tenant-scoped internal client
 * (`platform/adapters/outbound/ai-client.ts`'s `createTenantScopedAiClient`), following
 * the exact "web holds no vendor driver, calls the AI service's HTTP API" rule
 * `AiGraphProvisioner` establishes for Neo4j/Qdrant.
 *
 * `apps/ai`'s `McpSdkClient` (the official `mcp` Python SDK) performs the real MCP
 * handshake and `tools/list` against whatever endpoint the admin registered — this
 * adapter's only job is the wire translation either way: request out, discovered
 * descriptors or a documented failure shape back.
 *
 * `error.mcpConnectFailureReason` (`ai-client.ts`) is read for exactly `tools.
 * mcp_connect_failed` — `AiServiceError` validates it against api.md §5.6's closed set
 * before ever setting it, so this is not a general trust-the-far-side widening, only the
 * one field the contract documents as stable for this one code. `"protocol"` remains the
 * honest fallback for the rare case the far side answered `tools.mcp_connect_failed`
 * without a `meta.reason` this client could validate (a malformed upstream response, not
 * the documented shape). `tools.mcp_discovery_empty` is the endpoint's own documented
 * "connected but zero tools" code — mapped to `reason: "empty"` directly, not folded into
 * the handshake-failure branch. Anything else — a genuinely unreachable/misconfigured
 * `apps/ai` (503/504/404/an unparseable body) — is `"ai_runtime_unavailable"`, which is
 * deliberately never one of the MCP handshake reasons: those describe a real MCP server
 * that is reachable-but-uncooperative, not an absent or broken callee.
 */

import {
  AiServiceError,
  createTenantScopedAiClient,
} from "../../../../platform/adapters/outbound/ai-client.js";
import type {
  McpConnectResult,
  McpDiscoveryClient,
  McpServerConnectionConfig,
  McpToolDescriptor,
} from "../../../ports/mcp-discovery-client.js";

interface RawToolDescriptor {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly inputSchemaJson?: unknown;
}

interface ConnectResponseBody {
  readonly tools?: readonly RawToolDescriptor[];
}

function parseDescriptors(body: unknown): readonly McpToolDescriptor[] | null {
  if (typeof body !== "object" || body === null) return null;
  const { tools } = body as ConnectResponseBody;
  if (!Array.isArray(tools)) return null;

  const parsed: McpToolDescriptor[] = [];
  for (const tool of tools as readonly RawToolDescriptor[]) {
    if (typeof tool !== "object" || tool === null) return null;
    const { name, description, inputSchemaJson } = tool;
    if (typeof name !== "string" || typeof inputSchemaJson !== "string") return null;
    if (description !== null && description !== undefined && typeof description !== "string")
      return null;
    parsed.push({ name, description: description ?? null, inputSchemaJson });
  }
  return parsed;
}

export class AiServiceMcpDiscoveryClient implements McpDiscoveryClient {
  async connectAndDiscover(
    mcpServerId: string,
    config: McpServerConnectionConfig,
  ): Promise<McpConnectResult> {
    const client = createTenantScopedAiClient();

    let response: unknown;
    try {
      response = await client.post(`/tools/mcp/servers/${mcpServerId}/connect`, {
        endpoint: config.endpoint,
        transport: config.transport,
        authMode: config.authMode,
        credentialSecretRef: config.credentialSecretRef,
      });
    } catch (error) {
      if (error instanceof AiServiceError && error.code === "tools.mcp_connect_failed") {
        return { ok: false, reason: error.mcpConnectFailureReason ?? "protocol" };
      }
      if (error instanceof AiServiceError && error.code === "tools.mcp_discovery_empty") {
        return { ok: false, reason: "empty" };
      }
      const detail =
        error instanceof AiServiceError
          ? error.message
          : `Unexpected failure calling the AI service: ${error instanceof Error ? error.message : String(error)}`;
      return { ok: false, reason: "ai_runtime_unavailable", detail };
    }

    const tools = parseDescriptors(response);
    if (tools === null) {
      return {
        ok: false,
        reason: "ai_runtime_unavailable",
        detail: "The AI service responded, but not with the documented {tools: [...]} shape.",
      };
    }
    if (tools.length === 0) return { ok: false, reason: "empty" };
    return { ok: true, tools };
  }
}
