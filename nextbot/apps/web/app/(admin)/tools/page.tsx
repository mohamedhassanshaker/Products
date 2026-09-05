import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ToolCatalog } from "./ToolCatalog";

/**
 * QA Defect U3: same fail-closed deep-link guard as `/connectors` — gated on the
 * module the catalog's own list endpoint requires (`tool_permissions`, Read).
 * Mutating controls (visibility toggle / priority weight, gated on a *different*
 * module — `agent_tool_config`, Write) are disabled per-control by `ToolCatalog`
 * itself (QA Defect U4), since a viewer can legitimately have Read on one and None
 * on the other.
 */
export default async function ToolsPage() {
  const level = await getModuleAccessLevel("tool_permissions");
  if (level === "None") return <AccessDeniedState moduleLabel="Tool Catalog" />;
  const canMutate = (await getModuleAccessLevel("agent_tool_config")) === "Write";
  return <ToolCatalog canMutate={canMutate} />;
}
