/**
 * "Speak MCP: connect, discover, invoke" (`docs/api.md` §9.12). This wave only needs
 * connect+discover (B3 step 4B / B5 tab 2's "Connect & discover tools"); invocation is the
 * agent runtime's concern (B-5), not the backoffice registry this module is.
 *
 * **Ownership, confirmed not inferred**: `docs/api.md` §9.12/§6.5 and `architecture.md`'s
 * module map both assign the real `McpClient` (`AdkMcpClient`, wrapping Google ADK) to
 * `apps/ai`, with `apps/web`'s route documented as a *proxy*. Neither exists yet anywhere
 * in this repo (confirmed by dedicated research, not assumed — see `tasks/todo.md`). This
 * port is the web-side seam that calls the documented internal endpoint shape, mirroring
 * `ai-client.ts`'s trace-propagation/error-translation pattern; building the actual
 * `apps/ai`-side Python MCP implementation is out of this wave's scope (a substantial,
 * separate undertaking belonging to whichever wave builds the agent runtime).
 *
 * `reason: "ai_runtime_unavailable"` is deliberately **not** one of the documented
 * handshake-failure reasons (`dns`/`tls`/`auth`/`timeout`/`protocol`) — those describe a
 * real MCP server that is reachable-but-uncooperative; this one means "the AI runtime does
 * not implement this endpoint yet," which is the honest, current truth and must not be
 * misreported as a broken MCP server.
 */

import type { McpAuthMode, McpTransport } from "../domain/tool-catalog.js";

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string | null;
  readonly inputSchemaJson: string;
}

export interface McpServerConnectionConfig {
  readonly endpoint: string;
  readonly transport: McpTransport;
  readonly authMode: McpAuthMode;
  readonly credentialSecretRef: string | null;
}

export type McpConnectResult =
  | { readonly ok: true; readonly tools: readonly McpToolDescriptor[] }
  | { readonly ok: false; readonly reason: "dns" | "tls" | "auth" | "timeout" | "protocol" }
  | { readonly ok: false; readonly reason: "empty" }
  | { readonly ok: false; readonly reason: "ai_runtime_unavailable"; readonly detail: string };

export interface McpDiscoveryClient {
  /**
   * `mcpServerId` is the persisted `McpServer.id` — the real internal endpoint's path is
   * `/tools/mcp/servers/{id}/connect` (`docs/api.md` §5.6), and passing it lets whichever
   * `apps/ai` implementation eventually lands look the row up itself rather than trusting
   * only what this call's body carries. `config` is supplied too, so the request is
   * self-sufficient either way — forward-compatible with either implementation choice a
   * future wave makes, not a guess this adapter would need revisiting for.
   */
  connectAndDiscover(
    mcpServerId: string,
    config: McpServerConnectionConfig,
  ): Promise<McpConnectResult>;
}
