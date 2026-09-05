import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { RolesList } from "./RolesList";

/** QA Defect U3: same fail-closed deep-link guard, applied to Users & Roles too
 * (the same silent-403-as-empty-list bug was present in `RolesList.tsx`).
 *
 * `canWrite` (level === "Write") gates every mutating action on this screen (invite
 * user, create/edit role, change roles, reset MFA) — a `Read`-only caller sees the
 * full user/role tables but every action control is disabled, the same convention
 * `ToolPermissionsPage`/`ToolPermissionRules` already establish. */
export default async function RolesPage() {
  const level = await getModuleAccessLevel("users_roles");
  if (level === "None") return <AccessDeniedState moduleLabel="Users & Roles" />;
  return <RolesList canWrite={level === "Write"} />;
}
