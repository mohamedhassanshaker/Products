import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { GitConnectionCard } from "./GitConnectionCard";

/** Settings → Integrations (UX_GUIDELINES.md §6.3) — canonical home for the tenant's
 * one Git connection (LLD §3.10a: one `git_connection` row per tenant, not per agent). */
export default async function IntegrationsPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Integrations" />;
  return <GitConnectionCard canWrite={level === "Write"} />;
}
