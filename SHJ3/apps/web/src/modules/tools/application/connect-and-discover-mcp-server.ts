/**
 * "Connect & discover tools" — B3 step 4 sub-tab B / B5 tab 2's real orchestration
 * for turning a registered MCP server into one with bindable, discovered tools.
 *
 * ## This is the one place this module's work will visibly "fail honestly"
 *
 * `McpDiscoveryClient`'s real adapter (`AiServiceMcpDiscoveryClient`) calls a
 * documented `apps/ai` endpoint that does not exist yet (confirmed by dedicated
 * research — see that adapter's own module comment and `tasks/todo.md`'s B-3
 * review). A real click against the real running stack will therefore genuinely
 * fail with `{ok:false, reason:"ai_runtime_unavailable", detail:...}` — that is
 * the honest current state of the system, not a bug in this use case. This
 * class's job is narrow and important: make sure whichever `McpConnectResult`
 * comes back is captured and reported cleanly — recorded on the server row via
 * `recordConnectionFailure`, and propagated with its exact reason (plus `detail`
 * when present) to the caller — never swallowed, softened or misreported as a
 * different kind of failure.
 *
 * ## Order of operations
 *
 *  1. Look up the server; `tools.server_not_found` if it does not exist (a
 *     use-case-level result, not one of `McpDiscoveryClient`'s own reasons).
 *  2. Call `discovery.connectAndDiscover` with the server's own persisted
 *     config — never caller-supplied, so this can't be tricked into connecting
 *     to somewhere other than what B5 tab 2 actually has registered.
 *  3. On success: persist via `recordSuccessfulDiscovery` (upserts descriptors,
 *     marks `Connected`) and return the *persisted* rows — never the discovery
 *     client's own transient descriptors — so a caller reading the result sees
 *     exactly what a subsequent `listTools` would also see.
 *  4. On failure: persist a message via `recordConnectionFailure` (marks
 *     `Failed`) and propagate the same reason. The documented MCP handshake
 *     reasons (`dns`/`tls`/`auth`/`timeout`/`protocol`/`empty`) get a short fixed
 *     English sentence; `ai_runtime_unavailable` uses its own `detail` verbatim,
 *     since that string already names the real cause.
 */

import type { McpServerRepository, McpToolRow } from "../ports/mcp-server-repository.js";
import type { McpConnectResult, McpDiscoveryClient } from "../ports/mcp-discovery-client.js";

export interface ConnectAndDiscoverMcpServerInput {
  readonly mcpServerId: string;
  readonly now: Date;
}

export type ConnectAndDiscoverMcpServerResult =
  | { readonly ok: true; readonly tools: readonly McpToolRow[] }
  | { readonly ok: false; readonly reason: "tools.server_not_found" }
  | { readonly ok: false; readonly reason: "dns" | "tls" | "auth" | "timeout" | "protocol" }
  | { readonly ok: false; readonly reason: "empty" }
  | { readonly ok: false; readonly reason: "ai_runtime_unavailable"; readonly detail: string };

export interface ConnectAndDiscoverMcpServerDeps {
  readonly servers: McpServerRepository;
  readonly discovery: McpDiscoveryClient;
}

/** Fixed English sentences for the documented, reachable-but-uncooperative MCP handshake failures — `ai_runtime_unavailable` is handled separately, using its own `detail` verbatim. */
const MCP_HANDSHAKE_FAILURE_MESSAGES: Readonly<
  Record<"dns" | "tls" | "auth" | "timeout" | "protocol" | "empty", string>
> = {
  dns: "DNS resolution failed while connecting to the MCP server.",
  tls: "TLS handshake failed while connecting to the MCP server.",
  auth: "Authentication was rejected while connecting to the MCP server.",
  timeout: "Connecting to the MCP server timed out.",
  protocol: "The MCP server responded, but not with a valid MCP handshake.",
  empty: "The MCP server connected successfully but discovered zero tools.",
};

export class ConnectAndDiscoverMcpServer {
  constructor(private readonly deps: ConnectAndDiscoverMcpServerDeps) {}

  async execute(
    input: ConnectAndDiscoverMcpServerInput,
  ): Promise<ConnectAndDiscoverMcpServerResult> {
    const { servers, discovery } = this.deps;

    const server = await servers.get(input.mcpServerId);
    if (!server) return { ok: false, reason: "tools.server_not_found" };

    const result: McpConnectResult = await discovery.connectAndDiscover(input.mcpServerId, {
      endpoint: server.endpoint,
      transport: server.transport,
      authMode: server.authMode,
      credentialSecretRef: server.credentialSecretRef,
    });

    if (result.ok) {
      const tools = await servers.recordSuccessfulDiscovery(
        input.mcpServerId,
        result.tools,
        input.now,
      );
      return { ok: true, tools };
    }

    const message =
      result.reason === "ai_runtime_unavailable"
        ? result.detail
        : MCP_HANDSHAKE_FAILURE_MESSAGES[result.reason];
    await servers.recordConnectionFailure(input.mcpServerId, message, input.now);

    return result.reason === "ai_runtime_unavailable"
      ? { ok: false, reason: result.reason, detail: result.detail }
      : { ok: false, reason: result.reason };
  }
}
