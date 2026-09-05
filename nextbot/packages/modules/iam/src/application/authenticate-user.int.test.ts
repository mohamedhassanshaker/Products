import { afterEach, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { schema, withTenant } from "@nextbot/db";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { AccountLockedError, AuthNoRoleAssignedError, InvalidCredentialsError, MfaChallengeInvalidError } from "@nextbot/contracts";
import { seedSystemRoles } from "./seed-system-roles.js";
import { registerUser } from "./register-user.js";
import { login, verifyMfaAndCompleteLogin, completeMfaEnrollmentAndLogin } from "./authenticate-user.js";
import { enrollTotpMfa } from "./mfa-secret-vault.js";
import { verifySessionToken } from "./session-token.js";
import { issueMfaChallengeToken, issueMfaEnrollmentToken } from "./mfa-challenge-token.js";
import { insertUser } from "../infrastructure/user-repository.js";
import { hashPassword } from "../domain/password.js";
import { TOTP, Secret } from "otpauth";
import { resolveTenantById } from "@nextbot/tenancy";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function makeTenantWithUser(password = "correct-horse-battery-staple") {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  const [roleId] = await seedSystemRoles(ctx);
  const userId = await registerUser(ctx, {
    email: "admin@example.com",
    password,
    displayName: "Admin User",
    roleName: "Tenant Admin",
  });
  return { ctx, userId, roleId };
}

// Uses `@nextbot/tenancy`'s own public resolver rather than `withPlatform` directly
// — `withPlatform` is restricted (dependency-cruiser `no-platform-outside-allowed-
// callers`) to `tenancy` itself, internal ops, and `packages/db/src`; test code
// outside those must go through the same public API a real caller would.
async function getTenantSlug(tenantId: string): Promise<string> {
  const tenant = await resolveTenantById(tenantId);
  return tenant!.slug;
}

describe("login (BL-01 slice B integration — real Postgres)", () => {
  it("succeeds for a correctly-credentialed, role-assigned user with no MFA enrolled", async () => {
    const { ctx } = await makeTenantWithUser();
    const slug = await getTenantSlug(ctx.tenantId);

    const result = await login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    expect(result.outcome).toBe("authenticated");
    if (result.outcome === "authenticated") {
      const claims = await verifySessionToken(result.sessionToken);
      expect(claims.tenantId).toBe(ctx.tenantId);
      expect(claims.permissions.connectors).toBe("Write");
    }
  });

  it("rejects a wrong password with InvalidCredentialsError (not a distinct message from unknown-user)", async () => {
    const { ctx } = await makeTenantWithUser();
    const slug = await getTenantSlug(ctx.tenantId);
    await expect(login({ tenantSlug: slug, email: "admin@example.com", password: "wrong" })).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects an unknown tenant slug with the same InvalidCredentialsError (no tenant enumeration)", async () => {
    await expect(login({ tenantSlug: "no-such-tenant-slug", email: "a@b.com", password: "x" })).rejects.toThrow(InvalidCredentialsError);
  });

  it("locks the account after the configured number of failed attempts (FR-SEC-03)", async () => {
    const { ctx } = await makeTenantWithUser();
    const slug = await getTenantSlug(ctx.tenantId);

    for (let i = 0; i < 5; i++) {
      await expect(login({ tenantSlug: slug, email: "admin@example.com", password: "wrong" })).rejects.toThrow();
    }
    await expect(login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" })).rejects.toThrow(
      AccountLockedError,
    );
  });

  it("fails closed with AuthNoRoleAssignedError when the user has zero roles (FR-ADM-02)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await seedSystemRoles(ctx); // roles exist, but nobody is assigned one yet
    await insertUser(ctx, { email: "norole@example.com", passwordHash: await hashPassword("whatever123"), displayName: "No Role" });

    const slug = await getTenantSlug(ctx.tenantId);
    await expect(login({ tenantSlug: slug, email: "norole@example.com", password: "whatever123" })).rejects.toThrow(
      AuthNoRoleAssignedError,
    );
  });

  it("issues an MFA challenge instead of a session when the user is TOTP-enrolled, then completes login with a valid code", async () => {
    const { ctx, userId } = await makeTenantWithUser();
    const slug = await getTenantSlug(ctx.tenantId);

    // Enroll, then discover the plaintext secret the same way the real flow would
    // (decrypt via the vault) so the test can generate a genuinely valid code rather
    // than reaching into internals.
    const enrollResult = await enrollTotpMfa(ctx, userId, "admin@example.com");
    const secretMatch = /secret=([^&]+)/.exec(enrollResult.otpauthUri);
    const secretBase32 = decodeURIComponent(secretMatch![1]!);

    const step1 = await login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    expect(step1.outcome).toBe("mfa_required");
    if (step1.outcome !== "mfa_required") throw new Error("expected mfa_required");

    const totp = new TOTP({ secret: Secret.fromBase32(secretBase32), digits: 6, period: 30, algorithm: "SHA1" });
    const code = totp.generate();

    const step2 = await verifyMfaAndCompleteLogin(step1.challengeToken, code);
    expect(step2.outcome).toBe("authenticated");
  });

  it("rejects a wrong MFA code without completing login", async () => {
    const { ctx, userId } = await makeTenantWithUser();
    const slug = await getTenantSlug(ctx.tenantId);
    await enrollTotpMfa(ctx, userId, "admin@example.com");

    const step1 = await login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    if (step1.outcome !== "mfa_required") throw new Error("expected mfa_required");

    await expect(verifyMfaAndCompleteLogin(step1.challengeToken, "000000")).rejects.toThrow();
  });

  // QA Defect B2: backup codes are generated at enrollment time and must be usable
  // as a genuine alternative to a TOTP code at the MFA challenge step, exactly once.
  it("completes MFA login with a valid unused backup code, then rejects reusing it", async () => {
    const { ctx, userId } = await makeTenantWithUser();
    const slug = await getTenantSlug(ctx.tenantId);
    const enrollResult = await enrollTotpMfa(ctx, userId, "admin@example.com");
    expect(enrollResult.backupCodes).toHaveLength(10);
    const backupCode = enrollResult.backupCodes[0]!;

    const step1 = await login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    if (step1.outcome !== "mfa_required") throw new Error("expected mfa_required");

    const step2 = await verifyMfaAndCompleteLogin(step1.challengeToken, backupCode);
    expect(step2.outcome).toBe("authenticated");

    // Re-challenge and try the same backup code again — must now be rejected (consumed).
    const step1b = await login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    if (step1b.outcome !== "mfa_required") throw new Error("expected mfa_required");
    await expect(verifyMfaAndCompleteLogin(step1b.challengeToken, backupCode)).rejects.toThrow(InvalidCredentialsError);
  });

  // QA Defect B3 (FR-SEC-03/ADR-0002 §4.2): a role flagged mfa_required forces
  // enrollment before an unenrolled user can complete login.
  it("forces MFA enrollment on first login when the user's role requires it, then completes login after confirmation", async () => {
    const { ctx, userId, roleId } = await makeTenantWithUser();
    if (!roleId) throw new Error("expected a seeded role id");
    const slug = await getTenantSlug(ctx.tenantId);

    // Flip the seeded "Tenant Admin" role to mfa_required — direct DB update (no
    // admin API surface for toggling an existing role's flag yet) mirrors the same
    // test-setup pattern other integration tests use for out-of-band state changes.
    await withTenant(ctx, (db) => db.update(schema.role).set({ mfaRequired: true }).where(and(eq(schema.role.tenantId, ctx.tenantId), eq(schema.role.id, roleId))));

    const step1 = await login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    expect(step1.outcome).toBe("mfa_enrollment_required");
    if (step1.outcome !== "mfa_enrollment_required") throw new Error("expected mfa_enrollment_required");
    expect(step1.backupCodes).toHaveLength(10);

    const secretMatch = /secret=([^&]+)/.exec(step1.otpauthUri);
    const secretBase32 = decodeURIComponent(secretMatch![1]!);
    const totp = new TOTP({ secret: Secret.fromBase32(secretBase32), digits: 6, period: 30, algorithm: "SHA1" });
    const code = totp.generate();

    const step2 = await completeMfaEnrollmentAndLogin(step1.enrollmentToken, code);
    expect(step2.outcome).toBe("authenticated");
    expect(step2.userId).toBe(userId);

    // A subsequent login now goes through the ordinary mfa_required challenge path
    // (the user is enrolled), not enrollment again.
    const step3 = await login({ tenantSlug: slug, email: "admin@example.com", password: "correct-horse-battery-staple" });
    expect(step3.outcome).toBe("mfa_required");
  });

  // Coverage for `login()`'s "user exists but has no password hash" branch — an
  // SSO-only account (schema-ready, not implemented this phase) never has a local
  // password to check, so it must fail exactly like a wrong password, not throw an
  // unrelated internal error.
  it("rejects a user with no password hash (SSO-only account) the same as InvalidCredentialsError", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await seedSystemRoles(ctx);
    await insertUser(ctx, { email: "sso-only@example.com", passwordHash: null, displayName: "SSO Only" });
    const slug = await getTenantSlug(ctx.tenantId);

    await expect(
      login({ tenantSlug: slug, email: "sso-only@example.com", password: "anything" }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  describe("verifyMfaAndCompleteLogin — defensive token/identity guards", () => {
    it("throws MfaChallengeInvalidError when the challenge token's tenant no longer resolves", async () => {
      const bogusToken = await issueMfaChallengeToken(crypto.randomUUID(), crypto.randomUUID());
      await expect(verifyMfaAndCompleteLogin(bogusToken, "000000")).rejects.toThrow(MfaChallengeInvalidError);
    });

    it("throws MfaChallengeInvalidError when the challenge token's user id doesn't exist in that tenant", async () => {
      const { ctx } = await makeTenantWithUser();
      const bogusToken = await issueMfaChallengeToken(ctx.tenantId, crypto.randomUUID());
      await expect(verifyMfaAndCompleteLogin(bogusToken, "000000")).rejects.toThrow(MfaChallengeInvalidError);
    });
  });

  describe("completeMfaEnrollmentAndLogin — defensive token/identity guards", () => {
    it("throws MfaChallengeInvalidError when the enrollment token's tenant no longer resolves", async () => {
      const bogusToken = await issueMfaEnrollmentToken(crypto.randomUUID(), crypto.randomUUID());
      await expect(completeMfaEnrollmentAndLogin(bogusToken, "000000")).rejects.toThrow(MfaChallengeInvalidError);
    });

    it("throws MfaChallengeInvalidError when the enrollment token's user id doesn't exist in that tenant", async () => {
      const { ctx } = await makeTenantWithUser();
      const bogusToken = await issueMfaEnrollmentToken(ctx.tenantId, crypto.randomUUID());
      await expect(completeMfaEnrollmentAndLogin(bogusToken, "000000")).rejects.toThrow(MfaChallengeInvalidError);
    });
  });
});
