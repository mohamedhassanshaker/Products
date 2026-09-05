import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { WorkflowEditor } from "../WorkflowEditor";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a) — "New Workflow". Creating a
 * workflow always creates its version 1 in the same call (there is no empty
 * workflow), so this is the same YAML editor the "new version" screen uses, in
 * `create-workflow` mode.
 */
export default async function NewWorkflowPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level !== "Write") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <WorkflowEditor mode="create-workflow" />;
}
