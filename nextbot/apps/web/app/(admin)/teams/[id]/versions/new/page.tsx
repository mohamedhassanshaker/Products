import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { TeamEditor } from "../../../TeamEditor";

/** Target Architecture Blueprint Phase 14 (BL-46) — new team version. Versions are
 * immutable, so this screen only ever creates; it never edits one in place. */
export default async function NewTeamVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level !== "Write") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { id } = await params;
  return <TeamEditor mode="new-version" teamId={id} />;
}
