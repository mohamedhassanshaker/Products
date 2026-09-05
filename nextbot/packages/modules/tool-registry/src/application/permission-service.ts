import { findConnectorById } from "@nextbot/connectors";
import { PermissionRuleInvalidError, ToolNotFoundError, type CreatePermissionRuleRequest } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { resolvePermission, type ResolverConnector, type ResolverContext, type ResolverTool } from "../domain/permission-resolver.js";
import { findToolById } from "../infrastructure/tool-repository.js";
import { listAllRules, listToolScopedRules, replaceRulesForTool, type NewRuleInput } from "../infrastructure/permission-rule-repository.js";

export async function getToolRules(ctx: TenantContext, toolId: string) {
  return listToolScopedRules(ctx, toolId);
}

/** Postgres `CHECK` constraint violation code (`23514`) — used here to catch
 * `tool_permission_rule_required_tier_only_when_require_approval` (LLD §3.6:
 * `required_tier` must be set iff `effect = 'RequireApproval'`) and map it to the
 * proper 422 `PermissionRuleInvalidError` instead of letting the raw DB error
 * surface as an opaque 500 (QA Final Review minor item). */
function isCheckViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23514";
}

export async function updateToolRules(ctx: TenantContext, toolId: string, rules: CreatePermissionRuleRequest[]): Promise<void> {
  const tool = await findToolById(ctx, toolId);
  if (!tool) throw new ToolNotFoundError(toolId);
  const inputs: NewRuleInput[] = rules.map((r) => ({
    ordinal: r.ordinal,
    conditions: r.conditions,
    effect: r.effect,
    requiredTier: r.requiredTier,
    enabled: r.enabled,
  }));
  try {
    await replaceRulesForTool(ctx, toolId, inputs);
  } catch (err) {
    if (isCheckViolation(err)) {
      throw new PermissionRuleInvalidError(
        "`requiredTier` must be set when effect is `RequireApproval`, and must be omitted otherwise.",
      );
    }
    throw err;
  }
}

/** POST /admin/tools/{id}/permissions/simulate — runs the real resolver against a
 * hypothetical context, so an admin can preview which rule would fire before saving. */
export async function simulatePermission(ctx: TenantContext, toolId: string, resolverCtx: ResolverContext) {
  const tool = await findToolById(ctx, toolId);
  if (!tool) throw new ToolNotFoundError(toolId);
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1) — an
  // `AgentAsTool` entry has no connector by construction, so there is nothing to
  // load and `resolvePermission` skips exactly the connector/circuit-breaker rules
  // (see its doc). This is the ONLY change delegation makes to the resolver path;
  // the simulate preview, the runtime resolve, and the Approval Queue all keep
  // using this one function, never a parallel one.
  const connectorRow = tool.connectorId === null ? null : await findConnectorById(ctx, tool.connectorId);
  if (tool.connectorId !== null && !connectorRow) throw new ToolNotFoundError(toolId);

  const resolverTool: ResolverTool = {
    id: tool.id,
    connectorId: tool.connectorId,
    status: tool.status,
    visibleToAgent: tool.visibleToAgent,
    circuitState: tool.circuitState,
    approvalTier: tool.approvalTier,
    // Phase 17: the tool's own group FK, so `resolvePermission`'s independent
    // `capability_group_not_permitted` re-check has real data to check against —
    // whether that check actually fires depends entirely on whether `resolverCtx`
    // (passed straight through from this function's caller) carries a real
    // `allowedCapabilityGroupIds`.
    capabilityGroupId: tool.capabilityGroupId,
  };
  const resolverConnector: ResolverConnector | null = connectorRow
    ? {
        id: connectorRow.id,
        status: connectorRow.status,
        circuitState: connectorRow.circuitState,
        backendType: connectorRow.backendType,
      }
    : null;
  const rules = await listAllRules(ctx);
  return resolvePermission(resolverTool, resolverConnector, rules, resolverCtx);
}

/** The runtime entry point (consumed by later phases' orchestration pipeline, and by
 * this phase's own integration test proving the fail-closed default). */
export async function resolveToolPermission(ctx: TenantContext, toolId: string, resolverCtx: ResolverContext) {
  return simulatePermission(ctx, toolId, resolverCtx);
}
