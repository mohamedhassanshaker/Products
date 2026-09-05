import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { CapabilityGroupManager } from "./CapabilityGroupManager";

/**
 * Phase 6 (BL-28, FR-MCP-17) — same fail-closed deep-link guard convention as
 * `/tools` (`ToolsPage`): gated on the module the list endpoint itself requires
 * (`tool_permissions`, Read); mutating controls (create/edit/delete) additionally
 * require `agent_tool_config=Write`, disabled per-control (not hidden) for a
 * read-only caller — same split `ToolCatalog` already uses.
 */
export default async function CapabilityGroupsPage() {
  const level = await getModuleAccessLevel("tool_permissions");
  if (level === "None") return <AccessDeniedState moduleLabel="Capability Groups" />;
  const canMutate = (await getModuleAccessLevel("agent_tool_config")) === "Write";
  return <CapabilityGroupManager canMutate={canMutate} />;
}
