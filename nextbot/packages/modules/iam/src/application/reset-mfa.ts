import type { TenantContext } from "@nextbot/db";
import { resetMfaEnrollment } from "../infrastructure/user-repository.js";

/**
 * QA Defect B2 — minimal admin-side "reset this user's MFA" action: clears a user's
 * TOTP enrollment and backup codes entirely, so an admin can recover a user who is
 * locked out of MFA (lost authenticator device, no backup codes remaining) without
 * database-level intervention. The user re-enrolls (or is forced to again, per QA
 * Defect B3, if their role still requires MFA) on their next login.
 *
 * Callers are responsible for their own RBAC check (`users_roles` module, Write —
 * see `http/admin-routes.ts`'s `handleResetUserMfa`) before invoking this.
 */
export async function resetUserMfa(ctx: TenantContext, userId: string): Promise<void> {
  await resetMfaEnrollment(ctx, userId);
}
