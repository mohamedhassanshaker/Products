import "server-only";
import type { PermissionLevelValue, RbacModuleValue } from "@nextbot/contracts";
import { PERMISSION_RANK } from "@nextbot/contracts";
import { getSession } from "./session";

/**
 * QA Defect U3 (FR-ADM-02 fail-closed deep-link guard, `docs/design/UX_GUIDELINES.md`
 * §2.3): server-side computation of the current session's permission level for
 * `module`, used by page-level Server Components to decide whether to render the
 * full-page "You don't have access to this section" state *before* any client-side
 * fetch/render happens (the SSR equivalent of, and a stronger guarantee than, the
 * client-fetch-level `fetchJson()` 403 handling — this avoids a flash of the real
 * screen entirely). Fail-closed: no session at all resolves to `"None"`.
 */
export async function getModuleAccessLevel(module: RbacModuleValue): Promise<PermissionLevelValue> {
  const session = await getSession();
  if (!session) return "None";
  return session.permissions[module] ?? "None";
}

/** True if the current session's level for `module` is at least `required`. */
export async function hasModuleAccess(module: RbacModuleValue, required: PermissionLevelValue): Promise<boolean> {
  const level = await getModuleAccessLevel(module);
  return PERMISSION_RANK[level] >= PERMISSION_RANK[required];
}
