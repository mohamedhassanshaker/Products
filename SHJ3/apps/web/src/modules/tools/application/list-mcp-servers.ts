/**
 * B3 step 4 sub-tab B / B5 tab 2's MCP server table — pure passthrough to
 * `McpServerRepository.list()`.
 *
 * Wrapped in `{ rows }` for the same reason `list-skills.ts`/`list-api-
 * connectors.ts`/`list-circuit-breakers.ts` are: every `List*` use case in this
 * module returns the same envelope shape, so the future Server Action layer has
 * one calling convention regardless of which of the four it calls. This one
 * happens to need no merge — `McpServerRow` already carries everything B5 tab 2's
 * table shows (endpoint, auth, connection state) — but the shape stays uniform.
 */

import type { McpServerRepository, McpServerRow } from "../ports/mcp-server-repository.js";

export interface ListMcpServersResult {
  readonly rows: readonly McpServerRow[];
}

export interface ListMcpServersDeps {
  readonly servers: McpServerRepository;
}

export class ListMcpServers {
  constructor(private readonly deps: ListMcpServersDeps) {}

  async execute(): Promise<ListMcpServersResult> {
    const rows = await this.deps.servers.list();
    return { rows };
  }
}
