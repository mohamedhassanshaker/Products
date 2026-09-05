import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { EscalationQueue } from "./EscalationQueue";

/** B.5.1 Escalation Queue (RBAC module: `escalations`). FR-ADM-02 fail-closed
 * deep-link guard, same pattern as every other Admin Console page. */
export default async function EscalationsPage() {
  const level = await getModuleAccessLevel("escalations");
  if (level === "None") return <AccessDeniedState moduleLabel="Escalation Queue" />;
  return <EscalationQueue permissionLevel={level} />;
}
