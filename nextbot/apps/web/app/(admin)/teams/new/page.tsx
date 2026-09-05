import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { TeamEditor } from "../TeamEditor";

/**
 * Target Architecture Blueprint Phase 14 (BL-46) — "New Team". Creating a team
 * always creates its version 1 in the same call (there is no empty team), so this is
 * the same YAML editor the "new version" screen uses, in `create-team` mode.
 */
export default async function NewTeamPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level !== "Write") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <TeamEditor mode="create-team" />;
}
