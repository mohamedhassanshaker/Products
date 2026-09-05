import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { WebhookSettings } from "./WebhookSettings";

/** Settings → Webhooks (Target Architecture Blueprint Phase 18, BL-49, FR-API-02).
 * RBAC: `security_settings`, the same module branding/PII/data-policy/SSO already
 * use for tenant-wide security/ops config. */
export default async function WebhooksPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Webhooks" />;
  return <WebhookSettings permissionLevel={level} />;
}
