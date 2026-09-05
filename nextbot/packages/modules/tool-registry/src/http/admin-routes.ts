import type { TenantContext } from "@nextbot/db";
import type { CreatePermissionRuleRequest } from "@nextbot/contracts";
import { discoverAndSyncTools, listCatalog } from "../application/catalog-service.js";
import { getToolRules, simulatePermission, updateToolRules } from "../application/permission-service.js";
import { setToolCapabilityGroup, setToolPriorityWeight, setToolVisibility, findToolById } from "../infrastructure/tool-repository.js";
import {
  createCapabilityGroup,
  listCapabilityGroups,
  listCapabilityGroupsWithToolCounts,
  updateCapabilityGroup,
  deleteCapabilityGroup,
  countToolsInCapabilityGroup,
} from "../infrastructure/capability-group-repository.js";
import type { ResolverContext } from "../domain/permission-resolver.js";

/** `http/` layer (LLD §2.2) — plain functions; RBAC checks (`tool_permissions` /
 * `agent_tool_config` modules) are applied by the composition root (`apps/web`),
 * same pattern as `@nextbot/connectors`' http layer. */

export async function handleListTools(ctx: TenantContext, connectorId?: string) {
  return listCatalog(ctx, connectorId ? { connectorId } : undefined);
}

export async function handleGetTool(ctx: TenantContext, toolId: string) {
  return findToolById(ctx, toolId);
}

export async function handleDiscoverAndSync(ctx: TenantContext, connectorId: string) {
  return discoverAndSyncTools(ctx, connectorId);
}

export async function handleSetVisibility(ctx: TenantContext, toolId: string, visible: boolean) {
  return setToolVisibility(ctx, toolId, visible);
}

export async function handleSetPriorityWeight(ctx: TenantContext, toolId: string, weight: number) {
  return setToolPriorityWeight(ctx, toolId, weight);
}

export async function handleSetCapabilityGroup(ctx: TenantContext, toolId: string, capabilityGroupId: string | null) {
  return setToolCapabilityGroup(ctx, toolId, capabilityGroupId);
}

export async function handleListCapabilityGroups(ctx: TenantContext) {
  return listCapabilityGroups(ctx);
}

/** `GET /api/v1/admin/tools/capability-groups` (Phase 10, client-feedback-batch item
 * 8) — the tenant's real capability groups plus a live tool-member count each,
 * for admin-console pickers (Design Studio's Tool Policy section) that need to offer
 * real group names instead of free text. Distinct from `handleListCapabilityGroups`
 * above (no tool count, pre-existing) to avoid changing that already-tested handler's
 * contract for callers that don't need the count. */
export async function handleListCapabilityGroupsWithToolCounts(ctx: TenantContext) {
  return listCapabilityGroupsWithToolCounts(ctx);
}

export async function handleCreateCapabilityGroup(ctx: TenantContext, input: { name: string; guidanceText?: string; priorityWeight?: number }) {
  return createCapabilityGroup(ctx, input);
}

/** Phase 6 (BL-28, FR-MCP-17) — the capability-group management screen's edit action. */
export async function handleUpdateCapabilityGroup(ctx: TenantContext, id: string, input: { name?: string; guidanceText?: string | null; priorityWeight?: number }) {
  return updateCapabilityGroup(ctx, id, input);
}

/** Phase 6 (BL-28, FR-MCP-17) — the confirm-dialog's "this affects N tools" count,
 * read separately from the delete action so the console can show it *before* the user
 * confirms (LLD §14.3.3). */
export async function handleCountToolsInCapabilityGroup(ctx: TenantContext, id: string) {
  return countToolsInCapabilityGroup(ctx, id);
}

/** Phase 6 (BL-28, FR-MCP-17) — deletes a capability group, reassigning its tools to
 * Ungrouped in the same transaction (never a cascade delete of the tools). */
export async function handleDeleteCapabilityGroup(ctx: TenantContext, id: string) {
  return deleteCapabilityGroup(ctx, id);
}

export async function handleGetToolRules(ctx: TenantContext, toolId: string) {
  return getToolRules(ctx, toolId);
}

export async function handleUpdateToolRules(ctx: TenantContext, toolId: string, rules: CreatePermissionRuleRequest[]) {
  return updateToolRules(ctx, toolId, rules);
}

export async function handleSimulatePermission(ctx: TenantContext, toolId: string, resolverCtx: ResolverContext) {
  return simulatePermission(ctx, toolId, resolverCtx);
}
