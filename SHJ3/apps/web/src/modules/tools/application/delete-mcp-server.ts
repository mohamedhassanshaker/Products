/**
 * Delete (soft) an MCP server — B5 tab 2's Delete action.
 *
 * Pure passthrough to `McpServerRepository.softDelete`, whose own doc comment
 * documents the one refusal this use case never has to reimplement: while any
 * enabled `ToolBinding` references one of the server's tools, the delete is
 * refused with `tools.server_in_use` and the list of agent versions still
 * depending on it — returned here exactly as the port shaped it.
 */

import type { DeleteMcpServerResult, McpServerRepository } from "../ports/mcp-server-repository.js";

export interface DeleteMcpServerInput {
  readonly id: string;
  readonly now: Date;
}

export interface DeleteMcpServerDeps {
  readonly servers: McpServerRepository;
}

export class DeleteMcpServer {
  constructor(private readonly deps: DeleteMcpServerDeps) {}

  async execute(input: DeleteMcpServerInput): Promise<DeleteMcpServerResult> {
    return this.deps.servers.softDelete(input.id, input.now);
  }
}
