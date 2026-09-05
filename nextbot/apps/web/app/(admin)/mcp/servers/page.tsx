import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { McpServersList } from "./McpServersList";

/** QA Defect U3 pattern (FR-ADM-02 fail-closed deep-link guard) applied to the new
 * MCP registry list screen — same gate as `/connectors`. */
export default async function McpServersPage() {
  const level = await getModuleAccessLevel("connectors");
  if (level === "None") return <AccessDeniedState moduleLabel="Connectors" />;
  return <McpServersList permissionLevel={level} />;
}
