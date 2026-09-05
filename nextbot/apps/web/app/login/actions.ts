"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Value } from "@sinclair/typebox/value";
import { LoginRequestSchema, MfaChallengeRequestSchema, MfaEnrollmentConfirmRequestSchema } from "@nextbot/contracts";
import { AccountLockedError } from "@nextbot/contracts";
import { login, verifyMfaAndCompleteLogin, completeMfaEnrollmentAndLogin, iamTenantContext, verifySessionToken } from "@nextbot/iam";
import { resolveTenantBySlug, resolveTenantById } from "@nextbot/tenancy";
import { SESSION_COOKIE } from "@/src/lib/session";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * FR-ADM-03 (QA Final Review B4): logins (success AND failure) must be audited.
 * `apps/web` is the composition root that owns `@nextbot/audit` calls (see
 * `record-admin-audit.ts`'s doc comment) — `@nextbot/iam` itself can't import
 * `@nextbot/audit` (not in its LLD §2.3 allow-list). A successful login already
 * has a signed session token to decode (`verifySessionToken`) for its real
 * `tenantId`/`userId`, so this is used for all three completion paths
 * (password-only, MFA challenge, forced MFA enrollment).
 */
async function auditLoginSuccess(sessionToken: string, email?: string): Promise<void> {
  const claims = await verifySessionToken(sessionToken);
  const tenant = await resolveTenantById(claims.tenantId);
  if (!tenant) return;
  const ctx = iamTenantContext(tenant.id, tenant.region);
  await recordAdminAudit(ctx, {
    actorId: claims.userId,
    // The MFA-challenge/enrollment steps don't carry the submitted email in their
    // own form data (only the challenge/enrollment token + code) — fall back to
    // the (real, non-`system`) user id as the attribution label in that case.
    actorLabel: email ?? claims.userId,
    actionType: "user.login",
    targetType: "User",
    targetId: claims.userId,
    outcome: "Success",
    details: {},
  });
}

/** A pre-authentication login failure has no session token to decode, so this
 * resolves tenant context directly from the submitted `tenantSlug`. If the
 * tenant itself doesn't resolve, there's no tenant to scope an audit row to
 * (matches `login_attempt`'s own existing behavior for an unknown tenant). */
async function auditLoginFailure(tenantSlug: string, email: string): Promise<void> {
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) return;
  const ctx = iamTenantContext(tenant.id, tenant.region);
  await recordAdminAudit(ctx, {
    actorId: null,
    actorLabel: email,
    actionType: "user.login",
    targetType: "User",
    targetId: null,
    outcome: "Failure",
    details: {},
  });
}

export interface LoginFormState {
  error?: string;
  /** QA Defect U9: distinguishes a lockout from every other error so the UI can
   * render a `warning`-tier alert (not `error`-tier, indistinguishable from a wrong
   * password) and disable the form for the cooldown window. */
  errorKind?: "locked" | "generic";
  mfaChallengeToken?: string;
  // QA Defect B3: present when the user's role requires MFA and they aren't
  // enrolled yet — shown exactly once, alongside the confirmation code entry.
  enrollmentToken?: string;
  otpauthUri?: string;
  backupCodes?: string[];
}

/**
 * Server Action wrapping `@nextbot/iam`'s `login()` (LLD §2.2: "Server Actions are
 * thin wrappers only" — this parses/validates with a `contracts` schema and calls one
 * module application service, no business logic of its own).
 */
export async function loginAction(_prev: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const input = {
    tenantSlug: String(formData.get("tenantSlug") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  if (!Value.Check(LoginRequestSchema, input)) {
    return { error: "Please enter a valid tenant, email, and password." };
  }

  try {
    const result = await login(input);
    if (result.outcome === "mfa_required") {
      return { mfaChallengeToken: result.challengeToken };
    }
    if (result.outcome === "mfa_enrollment_required") {
      return {
        enrollmentToken: result.enrollmentToken,
        otpauthUri: result.otpauthUri,
        backupCodes: result.backupCodes,
      };
    }
    const store = await cookies();
    store.set(SESSION_COOKIE, result.sessionToken, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    await auditLoginSuccess(result.sessionToken, input.email);
  } catch (err) {
    // Every branch (InvalidCredentialsError, AccountLockedError,
    // AuthNoRoleAssignedError) carries its own distinct, spec-worded message
    // (FR-SEC-03 / FR-ADM-02) — surfaced verbatim, never a generic wrapper.
    await auditLoginFailure(input.tenantSlug, input.email);
    return {
      error: err instanceof Error ? err.message : "Sign-in failed.",
      errorKind: err instanceof AccountLockedError ? "locked" : "generic",
    };
  }
  redirect("/dashboard");
}

export async function mfaChallengeAction(_prev: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const challengeToken = String(formData.get("challengeToken") ?? "");
  const code = String(formData.get("code") ?? "");
  const input = { challengeToken, code };
  if (!Value.Check(MfaChallengeRequestSchema, input)) {
    return { error: "Enter the 6-digit code from your authenticator app.", mfaChallengeToken: challengeToken };
  }

  try {
    const result = await verifyMfaAndCompleteLogin(challengeToken, code);
    const store = await cookies();
    store.set(SESSION_COOKIE, result.sessionToken, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    await auditLoginSuccess(result.sessionToken);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Verification failed.", mfaChallengeToken: challengeToken };
  }
  redirect("/dashboard");
}

/** QA Defect B3 — confirms a forced-enrollment token with the first code from the
 * newly-enrolled authenticator app, then completes login exactly like
 * `mfaChallengeAction`. */
export async function mfaEnrollmentConfirmAction(_prev: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const enrollmentToken = String(formData.get("enrollmentToken") ?? "");
  const code = String(formData.get("code") ?? "");
  const input = { enrollmentToken, code };
  if (!Value.Check(MfaEnrollmentConfirmRequestSchema, input)) {
    return { error: "Enter the 6-digit code from your authenticator app.", enrollmentToken };
  }

  try {
    const result = await completeMfaEnrollmentAndLogin(enrollmentToken, code);
    const store = await cookies();
    store.set(SESSION_COOKIE, result.sessionToken, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    await auditLoginSuccess(result.sessionToken);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Verification failed.", enrollmentToken };
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
