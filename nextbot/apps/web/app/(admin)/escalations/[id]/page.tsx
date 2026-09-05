import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { TakeoverPanel } from "./TakeoverPanel";

/** B.5.2 Live Agent Takeover Panel (RBAC module: `escalations`). */
export default async function EscalationTakeoverPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("escalations");
  if (level === "None") return <AccessDeniedState moduleLabel="Escalation Takeover" />;
  const { id } = await params;
  return <TakeoverPanel escalationId={id} permissionLevel={level} />;
}
