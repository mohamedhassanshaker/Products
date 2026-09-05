import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { RoutingConfig } from "./RoutingConfig";

/** B.5.3 Escalation Routing Config (RBAC module: `escalations`). */
export default async function EscalationRoutingPage() {
  const level = await getModuleAccessLevel("escalations");
  if (level === "None") return <AccessDeniedState moduleLabel="Escalation Routing" />;
  return <RoutingConfig permissionLevel={level} />;
}
