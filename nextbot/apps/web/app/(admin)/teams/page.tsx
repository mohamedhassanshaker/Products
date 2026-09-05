import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { TeamsList } from "./TeamsList";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5) — Teams list.
 * Gated on `agent_platform`, the same RBAC module the Skills Library and the
 * delegation-tree endpoint already use (teams are part of the Agent Platform
 * surface, not a new RBAC module — spec §5.2's own precedent).
 */
export default async function TeamsPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <TeamsList canWrite={level === "Write"} />;
}
