import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { SessionsSettings } from "./SessionsSettings";

/** Settings → Sessions (Phase 4, BL-36, FR-SEC-10). No RBAC gate on the page
 * itself — every authenticated user may view/revoke their own sessions; the
 * tenant-wide admin table inside `SessionsSettings` is conditionally shown based
 * on the caller's own `users_roles` level (fetched client-side, same fail-closed
 * default as every other RBAC-gated fetch on this screen). */
export default async function SessionsSettingsPage() {
  const usersRolesLevel = await getModuleAccessLevel("users_roles");
  return <SessionsSettings canViewTenantSessions={usersRolesLevel !== "None"} canRevokeTenantSessions={usersRolesLevel === "Write"} />;
}
