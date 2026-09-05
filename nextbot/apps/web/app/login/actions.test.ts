import { describe, expect, it, vi, beforeEach } from "vitest";
import { AccountLockedError, InvalidCredentialsError, AuthNoRoleAssignedError } from "@nextbot/contracts";

// "server-only" unconditionally throws unless imported through Next's own webpack
// build (which aliases it away in a server context) — mocked the same way
// `api-guard.test.ts` already does, since `record-admin-audit.ts` (transitively
// imported for the QA Final Review B4 login-audit wiring) imports it.
vi.mock("server-only", () => ({}));

const loginMock = vi.fn();
const verifyMfaAndCompleteLoginMock = vi.fn();
const completeMfaEnrollmentAndLoginMock = vi.fn();
const verifySessionTokenMock = vi.fn();
const iamTenantContextMock = vi.fn((tenantId: string, region: string) => ({ tenantId, region, environment: "Production" }));

vi.mock("@nextbot/iam", () => ({
  login: (...a: unknown[]) => loginMock(...a),
  verifyMfaAndCompleteLogin: (...a: unknown[]) => verifyMfaAndCompleteLoginMock(...a),
  completeMfaEnrollmentAndLogin: (...a: unknown[]) => completeMfaEnrollmentAndLoginMock(...a),
  verifySessionToken: (...a: unknown[]) => verifySessionTokenMock(...a),
  iamTenantContext: (...a: [string, string]) => iamTenantContextMock(...a),
}));

const resolveTenantBySlugMock = vi.fn();
const resolveTenantByIdMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantBySlug: (...a: unknown[]) => resolveTenantBySlugMock(...a),
  resolveTenantById: (...a: unknown[]) => resolveTenantByIdMock(...a),
}));

const recordAdminAuditMock = vi.fn();
vi.mock("@/src/lib/record-admin-audit", () => ({
  recordAdminAudit: (...a: unknown[]) => recordAdminAuditMock(...a),
}));

const cookieStoreSet = vi.fn();
const cookieStoreDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieStoreSet, delete: cookieStoreDelete }),
}));

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
}));

vi.mock("@/src/lib/session", () => ({ SESSION_COOKIE: "nb_session" }));

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("login/actions (Server Action thin wrappers)", () => {
  beforeEach(() => {
    loginMock.mockReset();
    verifyMfaAndCompleteLoginMock.mockReset();
    completeMfaEnrollmentAndLoginMock.mockReset();
    cookieStoreSet.mockReset();
    cookieStoreDelete.mockReset();
    redirectMock.mockReset();
    verifySessionTokenMock.mockReset().mockResolvedValue({ tenantId: "t1", userId: "u1" });
    resolveTenantBySlugMock.mockReset().mockResolvedValue({ id: "t1", region: "US", slug: "acme" });
    resolveTenantByIdMock.mockReset().mockResolvedValue({ id: "t1", region: "US", slug: "acme" });
    recordAdminAuditMock.mockReset();
  });

  describe("loginAction", () => {
    it("returns a validation error for a malformed payload without calling login()", async () => {
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, formData({ tenantSlug: "", email: "not-an-email", password: "" }));
      expect(result.error).toMatch(/valid tenant, email, and password/i);
      expect(loginMock).not.toHaveBeenCalled();
    });

    it("sets the session cookie and redirects on a fully authenticated result", async () => {
      loginMock.mockResolvedValue({ outcome: "authenticated", sessionToken: "tok-abc", userId: "u1" });
      const { loginAction } = await import("./actions.js");
      await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "correct-horse" }));
      expect(cookieStoreSet).toHaveBeenCalledWith("nb_session", "tok-abc", expect.objectContaining({ httpOnly: true }));
      expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    });

    // QA Final Review B4: a successful login must produce an audit entry
    // attributed to the real authenticated user, not `system`.
    it("records a Success audit entry attributed to the real user on successful login", async () => {
      loginMock.mockResolvedValue({ outcome: "authenticated", sessionToken: "tok-abc", userId: "u1" });
      const { loginAction } = await import("./actions.js");
      await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "correct-horse" }));
      expect(recordAdminAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1" }),
        expect.objectContaining({ actorId: "u1", actorLabel: "a@b.com", actionType: "user.login", outcome: "Success" }),
      );
    });

    // QA Final Review B4: a failed login must also produce an audit entry (not
    // just successful ones) — attribution is by email since identity isn't
    // confirmed at this point.
    it("records a Failure audit entry on a failed login", async () => {
      loginMock.mockRejectedValue(new InvalidCredentialsError());
      const { loginAction } = await import("./actions.js");
      await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "wrong" }));
      expect(recordAdminAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1" }),
        expect.objectContaining({ actorId: null, actorLabel: "a@b.com", actionType: "user.login", outcome: "Failure" }),
      );
    });

    it("returns the mfaChallengeToken when MFA is required", async () => {
      loginMock.mockResolvedValue({ outcome: "mfa_required", challengeToken: "chal-1" });
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "correct-horse" }));
      expect(result).toEqual({ mfaChallengeToken: "chal-1" });
      expect(cookieStoreSet).not.toHaveBeenCalled();
    });

    it("returns enrollment fields when forced MFA enrollment is required (QA Defect B3)", async () => {
      loginMock.mockResolvedValue({
        outcome: "mfa_enrollment_required",
        enrollmentToken: "enr-1",
        otpauthUri: "otpauth://totp/x",
        backupCodes: ["1111111111"],
      });
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "correct-horse" }));
      expect(result).toEqual({
        enrollmentToken: "enr-1",
        otpauthUri: "otpauth://totp/x",
        backupCodes: ["1111111111"],
      });
    });

    it("marks a lockout distinctly (errorKind: 'locked') (QA Defect U9)", async () => {
      loginMock.mockRejectedValue(new AccountLockedError(300));
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "wrong" }));
      expect(result.errorKind).toBe("locked");
      expect(result.error).toMatch(/temporarily locked/i);
    });

    it("marks every other domain error as errorKind: 'generic'", async () => {
      loginMock.mockRejectedValue(new InvalidCredentialsError());
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "wrong" }));
      expect(result.errorKind).toBe("generic");
      expect(result.error).toMatch(/incorrect email or password/i);
    });

    it("falls back to a generic 'Sign-in failed.' message for a non-Error rejection", async () => {
      loginMock.mockRejectedValue("not an Error instance");
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "wrong" }));
      expect(result).toEqual({ error: "Sign-in failed.", errorKind: "generic" });
    });

    it("treats an entirely empty FormData as a validation error (defaults every field to '')", async () => {
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, new FormData());
      expect(result.error).toMatch(/valid tenant, email, and password/i);
      expect(loginMock).not.toHaveBeenCalled();
    });

    it("surfaces AuthNoRoleAssignedError's distinct message verbatim", async () => {
      loginMock.mockRejectedValue(new AuthNoRoleAssignedError());
      const { loginAction } = await import("./actions.js");
      const result = await loginAction({}, formData({ tenantSlug: "acme", email: "a@b.com", password: "correct-horse" }));
      expect(result.error).toMatch(/no assigned role/i);
    });
  });

  describe("mfaChallengeAction", () => {
    it("returns a validation error for a malformed code", async () => {
      const { mfaChallengeAction } = await import("./actions.js");
      const result = await mfaChallengeAction({}, formData({ challengeToken: "tok", code: "1" }));
      expect(result.error).toMatch(/6-digit code/i);
      expect(verifyMfaAndCompleteLoginMock).not.toHaveBeenCalled();
    });

    it("sets the session cookie and redirects on success", async () => {
      verifyMfaAndCompleteLoginMock.mockResolvedValue({ outcome: "authenticated", sessionToken: "tok-xyz" });
      const { mfaChallengeAction } = await import("./actions.js");
      await mfaChallengeAction({}, formData({ challengeToken: "tok", code: "123456" }));
      expect(cookieStoreSet).toHaveBeenCalledWith("nb_session", "tok-xyz", expect.any(Object));
      expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    });

    it("returns the error and preserves the challengeToken on a failed verification", async () => {
      verifyMfaAndCompleteLoginMock.mockRejectedValue(new Error("bad code"));
      const { mfaChallengeAction } = await import("./actions.js");
      const result = await mfaChallengeAction({}, formData({ challengeToken: "tok", code: "123456" }));
      expect(result).toEqual({ error: "bad code", mfaChallengeToken: "tok" });
    });

    it("falls back to a generic 'Verification failed.' message for a non-Error rejection", async () => {
      verifyMfaAndCompleteLoginMock.mockRejectedValue("not an Error instance");
      const { mfaChallengeAction } = await import("./actions.js");
      const result = await mfaChallengeAction({}, formData({ challengeToken: "tok", code: "123456" }));
      expect(result).toEqual({ error: "Verification failed.", mfaChallengeToken: "tok" });
    });

    it("treats an entirely empty FormData as a validation error", async () => {
      const { mfaChallengeAction } = await import("./actions.js");
      const result = await mfaChallengeAction({}, new FormData());
      expect(result.error).toMatch(/6-digit code/i);
      expect(verifyMfaAndCompleteLoginMock).not.toHaveBeenCalled();
    });
  });

  describe("mfaEnrollmentConfirmAction (QA Defect B3)", () => {
    it("returns a validation error for a malformed code", async () => {
      const { mfaEnrollmentConfirmAction } = await import("./actions.js");
      const result = await mfaEnrollmentConfirmAction({}, formData({ enrollmentToken: "enr", code: "1" }));
      expect(result.error).toMatch(/6-digit code/i);
      expect(completeMfaEnrollmentAndLoginMock).not.toHaveBeenCalled();
    });

    it("sets the session cookie and redirects on success", async () => {
      completeMfaEnrollmentAndLoginMock.mockResolvedValue({ outcome: "authenticated", sessionToken: "tok-enr" });
      const { mfaEnrollmentConfirmAction } = await import("./actions.js");
      await mfaEnrollmentConfirmAction({}, formData({ enrollmentToken: "enr", code: "123456" }));
      expect(cookieStoreSet).toHaveBeenCalledWith("nb_session", "tok-enr", expect.any(Object));
      expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    });

    it("returns the error and preserves the enrollmentToken on a failed confirmation", async () => {
      completeMfaEnrollmentAndLoginMock.mockRejectedValue(new Error("bad enrollment code"));
      const { mfaEnrollmentConfirmAction } = await import("./actions.js");
      const result = await mfaEnrollmentConfirmAction({}, formData({ enrollmentToken: "enr", code: "123456" }));
      expect(result).toEqual({ error: "bad enrollment code", enrollmentToken: "enr" });
    });

    it("falls back to a generic 'Verification failed.' message for a non-Error rejection", async () => {
      completeMfaEnrollmentAndLoginMock.mockRejectedValue("not an Error instance");
      const { mfaEnrollmentConfirmAction } = await import("./actions.js");
      const result = await mfaEnrollmentConfirmAction({}, formData({ enrollmentToken: "enr", code: "123456" }));
      expect(result).toEqual({ error: "Verification failed.", enrollmentToken: "enr" });
    });

    it("treats an entirely empty FormData as a validation error", async () => {
      const { mfaEnrollmentConfirmAction } = await import("./actions.js");
      const result = await mfaEnrollmentConfirmAction({}, new FormData());
      expect(result.error).toMatch(/6-digit code/i);
      expect(completeMfaEnrollmentAndLoginMock).not.toHaveBeenCalled();
    });
  });

  describe("logoutAction", () => {
    it("deletes the session cookie and redirects to /login", async () => {
      const { logoutAction } = await import("./actions.js");
      await logoutAction();
      expect(cookieStoreDelete).toHaveBeenCalledWith("nb_session");
      expect(redirectMock).toHaveBeenCalledWith("/login");
    });
  });
});
