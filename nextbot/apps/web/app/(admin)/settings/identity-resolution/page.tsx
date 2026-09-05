import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { IdentityResolutionSettings } from "./IdentityResolutionSettings";

/** Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the tenant's
 * cross-channel identity-linking opt-in (RBAC: security_settings). */
export default async function IdentityResolutionPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Cross-Channel Identity Linking" />;
  return <IdentityResolutionSettings permissionLevel={level} />;
}
