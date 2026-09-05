import { discoverTools, findConnectorById } from "@nextbot/connectors";
import { ConnectorNotFoundError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { classifyReadWrite, defaultApprovalTier } from "../domain/backend-type-defaults.js";
import { upsertToolFromDiscovery, listTools as listToolsRepo, type ToolRow } from "../infrastructure/tool-repository.js";
import { ensureBackendTypeDefaultRule } from "./seed-backend-type-defaults.js";

export interface DiscoverySyncResult {
  toolsAdded: number;
  toolsUpdated: number;
  breakingChanges: string[];
}

/**
 * BL-03: discovers a connector's tools (via `@nextbot/connectors`' Phase 4 flow) and
 * syncs the results into the tool catalog — inserting new tools with a
 * heuristic-classified `rw_class`/`approval_tier` (FR-MCP-13), or appending a new
 * `tool_schema_version` for tools that already exist, flagging breaking changes
 * (FR-MCP-15). Also ensures the seeded BackendType-scope permission rule exists for
 * this connector's backend type, so newly-discovered tools resolve to `Allow` rather
 * than failing closed on their very first call before an admin authors a rule.
 */
export async function discoverAndSyncTools(ctx: TenantContext, connectorId: string): Promise<DiscoverySyncResult> {
  const connector = await findConnectorById(ctx, connectorId);
  if (!connector) throw new ConnectorNotFoundError(connectorId);

  await ensureBackendTypeDefaultRule(ctx, connector.backendType);

  const discovered = await discoverTools(ctx, connectorId);
  let toolsAdded = 0;
  let toolsUpdated = 0;
  const breakingChanges: string[] = [];

  for (const descriptor of discovered) {
    const rwClass = classifyReadWrite(descriptor.name);
    const approvalTier = defaultApprovalTier(connector.backendType, rwClass, descriptor.name);
    const result = await upsertToolFromDiscovery(ctx, {
      connectorId,
      name: descriptor.name,
      descriptionSource: descriptor.description ?? "",
      rwClass,
      approvalTier,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema ?? {},
    });
    if (result.created) toolsAdded++;
    else toolsUpdated++;
    if (result.breakingChange) breakingChanges.push(descriptor.name);
  }

  return { toolsAdded, toolsUpdated, breakingChanges };
}

export async function listCatalog(ctx: TenantContext, filters?: { connectorId?: string }): Promise<ToolRow[]> {
  return listToolsRepo(ctx, filters);
}
