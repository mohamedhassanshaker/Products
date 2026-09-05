import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { DefinitionDetail } from "./DefinitionDetail";

export default async function DefinitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { id } = await params;
  return <DefinitionDetail definitionId={id} canWrite={level === "Write"} />;
}
