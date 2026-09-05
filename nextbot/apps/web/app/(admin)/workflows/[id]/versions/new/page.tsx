import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { WorkflowEditor } from "../../../WorkflowEditor";

/** Target Architecture Blueprint Phase 15 (BL-47a) — new workflow version.
 * Versions are immutable, so this screen only ever creates; it never edits one
 * in place. */
export default async function NewWorkflowVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level !== "Write") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { id } = await params;
  return <WorkflowEditor mode="new-version" workflowId={id} />;
}
