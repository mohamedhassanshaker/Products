import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { TeamDetail } from "./TeamDetail";

/** Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5) — team detail:
 * versions, the promotion ladder, and the FR-ORC-11 whole-topology sandbox run. */
export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { id } = await params;
  return <TeamDetail teamId={id} canWrite={level === "Write"} />;
}
