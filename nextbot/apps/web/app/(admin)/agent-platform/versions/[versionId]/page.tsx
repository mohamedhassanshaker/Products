import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { VersionDetail } from "./VersionDetail";

export default async function VersionDetailPage({ params }: { params: Promise<{ versionId: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { versionId } = await params;
  return <VersionDetail versionId={versionId} canWrite={level === "Write"} />;
}
