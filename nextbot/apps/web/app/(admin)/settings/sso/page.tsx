import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { SsoSettings } from "./SsoSettings";

/** Settings → Single Sign-On & SCIM (Phase 4, BL-36, FR-SEC-10). RBAC:
 * `security_settings`, same module Branding/PII/Data-policy already use. */
export default async function SsoSettingsPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Single Sign-On" />;
  return <SsoSettings permissionLevel={level} />;
}
