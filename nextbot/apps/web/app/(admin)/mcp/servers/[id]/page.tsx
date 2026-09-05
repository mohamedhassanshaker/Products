import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { McpServerDetail } from "./McpServerDetail";

export default async function McpServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("connectors");
  if (level === "None") return <AccessDeniedState moduleLabel="Connectors" />;
  const { id } = await params;
  return <McpServerDetail serverId={id} permissionLevel={level} />;
}
