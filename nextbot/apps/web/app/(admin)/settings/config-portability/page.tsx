import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ConfigPortabilitySettings } from "./ConfigPortabilitySettings";

/** Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — Configuration Export
 * and Restore (RBAC: security_settings). */
export default async function ConfigPortabilityPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Configuration Export & Restore" />;
  return <ConfigPortabilitySettings permissionLevel={level} />;
}
