import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { SkillDetail } from "./SkillDetail";

export default async function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { id } = await params;
  return <SkillDetail skillId={id} canWrite={level === "Write"} />;
}
