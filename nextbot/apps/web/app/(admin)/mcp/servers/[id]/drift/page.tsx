import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { McpDriftReview } from "./McpDriftReview";

export default async function McpDriftPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("connectors");
  if (level === "None") return <AccessDeniedState moduleLabel="Connectors" />;
  const { id } = await params;
  return <McpDriftReview serverId={id} canWrite={level === "Write"} />;
}
