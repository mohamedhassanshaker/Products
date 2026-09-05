import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { SkillsList } from "./SkillsList";

/**
 * Skills Library list (Target Architecture Blueprint Phase 5, BL-35, ADR-0015).
 * Gated on `agent_platform` (spec §5.2's "Changed — now also gates skills") — the
 * same fail-closed deep-link guard every other Agent Platform screen already uses,
 * not a new RBAC module.
 */
export default async function SkillsPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <SkillsList canWrite={level === "Write"} />;
}
