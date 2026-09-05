import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { WorkflowDetail } from "./WorkflowDetail";

/** Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4) — workflow
 * detail: versions and the promotion ladder. */
export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { id } = await params;
  return <WorkflowDetail workflowId={id} canWrite={level === "Write"} />;
}
