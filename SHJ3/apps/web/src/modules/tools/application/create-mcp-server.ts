/**
 * Register an MCP server — B3 step 4 sub-tab B / B5 tab 2's **+ Add MCP
 * server**.
 *
 * Thin passthrough to `McpServerRepository.create`, which always starts a new
 * server `NotConnected` with no discovered tools (that port method's own doc
 * comment) — reaching `Connected` requires a real `ConnectAndDiscoverMcpServer`
 * call afterward, which this use case deliberately does not chain, so a
 * registration and a connection attempt remain two separate, separately
 * observable actions.
 */

import type {
  McpServerRepository,
  McpServerRow,
  NewMcpServerInput,
} from "../ports/mcp-server-repository.js";

export type CreateMcpServerInput = NewMcpServerInput;

export interface CreateMcpServerResult {
  readonly server: McpServerRow;
}

export interface CreateMcpServerDeps {
  readonly servers: McpServerRepository;
}

export class CreateMcpServer {
  constructor(private readonly deps: CreateMcpServerDeps) {}

  async execute(input: CreateMcpServerInput): Promise<CreateMcpServerResult> {
    const server = await this.deps.servers.create(input);
    return { server };
  }
}
