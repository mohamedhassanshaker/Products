import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { BreakglassAccessSettings } from "./BreakglassAccessSettings";

/** Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the tenant's
 * Break-Glass Access consent screen (RBAC: security_settings). */
export default async function BreakglassAccessPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Break-Glass Access" />;
  return <BreakglassAccessSettings permissionLevel={level} />;
}
