import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ServiceAccountsSettings } from "./ServiceAccountsSettings";

/** Settings → Service Accounts (Phase 4, BL-36, FR-SEC-10/FR-API-01). RBAC:
 * `users_roles`, the same module the rest of user/role administration uses. */
export default async function ServiceAccountsPage() {
  const level = await getModuleAccessLevel("users_roles");
  if (level === "None") return <AccessDeniedState moduleLabel="Service Accounts" />;
  return <ServiceAccountsSettings permissionLevel={level} />;
}
