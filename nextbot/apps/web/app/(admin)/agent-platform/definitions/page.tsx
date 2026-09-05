import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { DefinitionsList } from "./DefinitionsList";

/** Agent Definition Registry list (BL-07, UX_GUIDELINES.md §6.1) — gated on
 * `agent_platform` (fail-closed deep-link guard, same convention as every other
 * gated screen). */
export default async function DefinitionsPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <DefinitionsList canWrite={level === "Write"} />;
}
