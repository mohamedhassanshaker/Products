/**
 * Edit an MCP server's registration — B5 tab 2's Edit dialog: name, endpoint,
 * transport, auth mode and credential reference, each independently optional in
 * the same call, mirroring `iam`'s `edit-user.ts` shape.
 *
 * `McpServerRepository.update`'s own doc comment carries the one rule this use
 * case must not reimplement: changing `endpoint` or `authMode` marks the server
 * `NotConnected` and invalidates its discovered descriptors — "a descriptor set
 * from a different endpoint is a lie" (`docs/api.md` §6.5). This use case only
 * forwards whichever fields the caller actually supplied; the adapter decides
 * whether that combination counts as an endpoint/auth change.
 */

import type { McpServerRepository } from "../ports/mcp-server-repository.js";
import type { McpAuthMode, McpTransport } from "../domain/tool-catalog.js";

export interface UpdateMcpServerInput {
  readonly id: string;
  readonly name?: string;
  readonly endpoint?: string;
  readonly transport?: McpTransport;
  readonly authMode?: McpAuthMode;
  readonly credentialSecretRef?: string | null;
  readonly now: Date;
}

export interface UpdateMcpServerDeps {
  readonly servers: McpServerRepository;
}

export class UpdateMcpServer {
  constructor(private readonly deps: UpdateMcpServerDeps) {}

  async execute(input: UpdateMcpServerInput): Promise<void> {
    await this.deps.servers.update(
      input.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
        ...(input.transport !== undefined ? { transport: input.transport } : {}),
        ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
        ...(input.credentialSecretRef !== undefined
          ? { credentialSecretRef: input.credentialSecretRef }
          : {}),
      },
      input.now,
    );
  }
}
