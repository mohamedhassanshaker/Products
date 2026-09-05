import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ToolPermissionRules } from "./ToolPermissionRules";

/**
 * QA Final Review S2 — before this fix, no Admin Console UI anywhere called the
 * tool-permission-rule API (`GET`/`PUT /api/v1/admin/tools/{id}/permissions`,
 * BL-03), so `defaultApprovalTier()`'s Tier-3 outcome was unreachable in practice
 * without hand-crafted API calls. Gated the same way `/tools` itself is
 * (`tool_permissions` module) — mutation (`PUT`) is separately gated `Write` and
 * disabled per-control for a `Read`-only caller, matching `ToolCatalog`'s own
 * convention for `agent_tool_config`.
 */
export default async function ToolPermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const level = await getModuleAccessLevel("tool_permissions");
  if (level === "None") return <AccessDeniedState moduleLabel="Tool Permissions" />;
  return <ToolPermissionRules toolId={id} canMutate={level === "Write"} />;
}
