/** B3 step 4 sub-tab B / B5 tab 2 — MCP server registration and its discovered tools. */

import type { McpAuthMode, McpConnectionState, McpTransport } from "../domain/tool-catalog.js";

export interface McpServerRow {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly transport: McpTransport;
  readonly authMode: McpAuthMode;
  readonly credentialSecretRef: string | null;
  readonly connectionState: McpConnectionState;
  readonly lastDiscoveryAt: Date | null;
  readonly lastConnectedAt: Date | null;
  readonly lastError: string | null;
}

export interface McpToolRow {
  readonly id: string;
  readonly mcpServerId: string;
  readonly name: string;
  readonly description: string | null;
  readonly inputSchemaJson: string;
  readonly discoveredAt: Date;
  readonly lastSeenAt: Date;
  readonly removedAt: Date | null;
}

export interface NewMcpServerInput {
  readonly name: string;
  readonly endpoint: string;
  readonly transport: McpTransport;
  readonly authMode: McpAuthMode;
  readonly credentialSecretRef: string | null;
  readonly now: Date;
}

export type DeleteMcpServerResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "tools.server_in_use";
      readonly boundAgentVersionIds: readonly string[];
    };

export interface McpServerRepository {
  list(): Promise<readonly McpServerRow[]>;
  get(id: string): Promise<McpServerRow | null>;
  create(input: NewMcpServerInput): Promise<McpServerRow>;

  /** Editing endpoint or auth marks the server `NotConnected` and invalidates its discovered descriptors (`removedAt` on every `McpTool`) — `docs/api.md` §6.5: "a descriptor set from a different endpoint is a lie." */
  update(
    id: string,
    input: {
      readonly name?: string;
      readonly endpoint?: string;
      readonly transport?: McpTransport;
      readonly authMode?: McpAuthMode;
      readonly credentialSecretRef?: string | null;
    },
    now: Date,
  ): Promise<void>;

  softDelete(id: string, now: Date): Promise<DeleteMcpServerResult>;

  listTools(mcpServerId: string): Promise<readonly McpToolRow[]>;

  /** Persists a successful discovery: upserts descriptors by `(mcpServerId, name)`, sets `removedAt` on any previously-discovered tool absent from this pass, sets `connectionState = 'Connected'`, `lastDiscoveryAt`/`lastConnectedAt` = now, clears `lastError`. */
  recordSuccessfulDiscovery(
    mcpServerId: string,
    discovered: readonly {
      readonly name: string;
      readonly description: string | null;
      readonly inputSchemaJson: string;
    }[],
    now: Date,
  ): Promise<readonly McpToolRow[]>;

  /** `connectionState = 'Failed'`, `lastError` set — descriptors from a prior successful discovery are left resolvable (trace readability). */
  recordConnectionFailure(mcpServerId: string, errorMessage: string, now: Date): Promise<void>;
}
