import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { WorkflowsList } from "./WorkflowsList";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4) — Workflows list.
 * Gated on `agent_platform`, the same RBAC module the Skills Library and Teams
 * surface already use (workflows are part of the Agent Platform surface, not a
 * new RBAC module — spec §5.2's own precedent).
 */
export default async function WorkflowsPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <WorkflowsList canWrite={level === "Write"} />;
}
