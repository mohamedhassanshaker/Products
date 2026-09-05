import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { BrandingSettings } from "./BrandingSettings";

/** FR-ADM-07 Settings → Branding screen, gated on `security_settings` (the same
 * RBAC module every other tenant-wide settings screen would use). */
export default async function BrandingPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Branding" />;
  return <BrandingSettings />;
}
