import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantPlanTier, resolveTenantById } from "@nextbot/tenancy";
import { SsoAuthenticationFailedError, SsoNotConfiguredError, SsoUserNotProvisionedError } from "@nextbot/contracts";
import { seedSystemRoles } from "./seed-system-roles.js";
import { registerUser } from "./register-user.js";
import { upsertConnection, setConnectionStatus } from "./sso-connection.js";
import { completeOidcLogin, completeSamlLogin } from "./sso-login.js";
import { findUserBySsoSubject, iamTenantContext } from "../infrastructure/user-repository.js";
import { verifySessionToken } from "./session-token.js";

/**
 * Mocks the OIDC LIBRARY's network-touching internals only (discovery/token
 * exchange against a real IdP) — everything downstream of "a validated identity
 * claim came back" (tenant resolution, JIT provisioning, group->role mapping,
 * session issuance, tenant isolation) is the REAL code path, exercised against
 * real Postgres. This is the standard way to test an SSO integration without a
 * live IdP: the crypto/protocol correctness is `openid-client`'s own
 * responsibility (a mature, independently-maintained library), not something
 * this dispatch re-verifies; what IS this dispatch's responsibility — and what
 * these tests actually prove — is that OUR fail-closed wrapping and tenant-
 * resolution logic behave correctly around it.
 */
let nextClaims: Record<string, unknown> | null = null;
let nextGrantError: Error | null = null;
vi.mock("openid-client", () => ({
  discovery: vi.fn(async () => ({ __fakeConfig: true })),
  ClientSecretPost: vi.fn(() => ({ __fakeAuth: true })),
  buildAuthorizationUrl: vi.fn(() => new URL("https://idp.example.com/authorize?state=x")),
  authorizationCodeGrant: vi.fn(async () => {
    if (nextGrantError) throw nextGrantError;
    return { claims: () => nextClaims };
  }),
}));

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  nextClaims = null;
  nextGrantError = null;
});

async function makeEnterpriseTenantWithOidc(overrides: { jitProvisioningEnabled?: boolean; groupClaimName?: string } = {}) {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  await updateTenantPlanTier(ctx.tenantId, "Enterprise");
  const roleIds = await seedSystemRoles(ctx);
  await upsertConnection(ctx, {
    protocol: "Oidc",
    displayName: "Test IdP",
    jitProvisioningEnabled: overrides.jitProvisioningEnabled ?? true,
    defaultRoleId: roleIds[0], // Tenant Admin
    groupClaimName: overrides.groupClaimName,
    oidcIssuerUrl: "https://idp.example.com",
    oidcClientId: "client-id",
    oidcClientSecret: "client-secret",
  } as never);
  await setConnectionStatus(ctx, "Active");
  const tenant = await resolveTenantById(ctx.tenantId);
  return { ctx, tenantSlug: tenant!.slug, tenantAdminRoleId: roleIds[0]!, readOnlyRoleId: roleIds[5]! };
}

describe("SSO login — OIDC (Phase 4, BL-36, FR-SEC-10) — real Postgres, mocked IdP network layer", () => {
  it("JIT-provisions a brand-new user on first login and resolves it to the CORRECT tenant", async () => {
    const { ctx, tenantSlug } = await makeEnterpriseTenantWithOidc();
    nextClaims = { sub: "idp-subject-1", email: "newuser@example.com" };

    const result = await completeOidcLogin(tenantSlug, {
      currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
      expectedState: "x",
      expectedNonce: "n",
    });

    const claims = await verifySessionToken(result.sessionToken);
    expect(claims.tenantId).toBe(ctx.tenantId); // resolves to the correct tenant, never a different one.

    const created = await findUserBySsoSubject(ctx, "idp-subject-1");
    expect(created).not.toBeNull();
    expect(created!.email).toBe("newuser@example.com");
  });

  it("fails closed when JIT provisioning is disabled and no pre-invited user matches the asserted email", async () => {
    const { tenantSlug } = await makeEnterpriseTenantWithOidc({ jitProvisioningEnabled: false });
    nextClaims = { sub: "idp-subject-2", email: "not-invited@example.com" };

    await expect(
      completeOidcLogin(tenantSlug, {
        currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
        expectedState: "x",
        expectedNonce: "n",
      }),
    ).rejects.toThrow(SsoUserNotProvisionedError);
  });

  it("links (never re-creates) an existing invited user by matching email even with JIT disabled", async () => {
    const { ctx, tenantSlug } = await makeEnterpriseTenantWithOidc({ jitProvisioningEnabled: false });
    const invitedUserId = await registerUser(ctx, {
      email: "invited@example.com",
      password: "some-strong-password-1",
      displayName: "Invited",
      roleName: "Tenant Admin",
    });
    nextClaims = { sub: "idp-subject-3", email: "invited@example.com" };

    const result = await completeOidcLogin(tenantSlug, {
      currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
      expectedState: "x",
      expectedNonce: "n",
    });
    expect(result.userId).toBe(invitedUserId);

    const linked = await findUserBySsoSubject(ctx, "idp-subject-3");
    expect(linked!.id).toBe(invitedUserId);
  });

  it("SECURITY-CRITICAL: an invalid/forged token exchange is rejected fail-closed, never a partial session", async () => {
    const { tenantSlug } = await makeEnterpriseTenantWithOidc();
    nextGrantError = new Error("simulated: invalid_grant / signature verification failed");

    await expect(
      completeOidcLogin(tenantSlug, {
        currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=bad&state=x"),
        expectedState: "x",
        expectedNonce: "n",
      }),
    ).rejects.toThrow(SsoAuthenticationFailedError);
  });

  it("fails closed when the connection exists but is not Active (misconfigured/disabled)", async () => {
    const { ctx, tenantSlug } = await makeEnterpriseTenantWithOidc();
    await setConnectionStatus(ctx, "Disabled");
    nextClaims = { sub: "idp-subject-4", email: "x@example.com" };

    await expect(
      completeOidcLogin(tenantSlug, {
        currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
        expectedState: "x",
        expectedNonce: "n",
      }),
    ).rejects.toThrow(SsoNotConfiguredError);
  });

  it("maps an IdP group claim to the correct role via sso_group_mapping, overriding the default role", async () => {
    const { ctx, tenantSlug, readOnlyRoleId } = await makeEnterpriseTenantWithOidc({ groupClaimName: "groups" });
    const { upsertSsoGroupMapping } = await import("../infrastructure/sso-group-mapping-repository.js");
    await upsertSsoGroupMapping(ctx, "readonly-group", readOnlyRoleId);
    nextClaims = { sub: "idp-subject-5", email: "grouped@example.com", groups: ["readonly-group"] };

    const result = await completeOidcLogin(tenantSlug, {
      currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
      expectedState: "x",
      expectedNonce: "n",
    });
    expect(result.roleIds).toEqual([readOnlyRoleId]);
    expect(result.permissions.connectors).toBe("Read"); // Read-Only role's real matrix, not Tenant Admin's Write.
  });

  it("SECURITY-CRITICAL (QA 20260829-054900 Finding 1): role re-derivation across two logins with a changed IdP group assertion is EXACT, not additive", async () => {
    const { ctx, tenantSlug, tenantAdminRoleId, readOnlyRoleId } = await makeEnterpriseTenantWithOidc({ groupClaimName: "groups" });
    const { upsertSsoGroupMapping } = await import("../infrastructure/sso-group-mapping-repository.js");
    await upsertSsoGroupMapping(ctx, "admins", tenantAdminRoleId);
    await upsertSsoGroupMapping(ctx, "readonly", readOnlyRoleId);

    // Login 1: IdP asserts "admins" -> Tenant Admin.
    nextClaims = { sub: "demoted-admin", email: "demoted@example.com", groups: ["admins"] };
    const first = await completeOidcLogin(tenantSlug, {
      currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
      expectedState: "x",
      expectedNonce: "n",
    });
    expect(first.roleIds).toEqual([tenantAdminRoleId]);
    expect(first.permissions.security_settings).toBe("Write");

    // Login 2, SAME identity: IdP now asserts a DIFFERENT, non-overlapping group —
    // the "admins" membership was revoked IdP-side.
    nextClaims = { sub: "demoted-admin", email: "demoted@example.com", groups: ["readonly"] };
    const second = await completeOidcLogin(tenantSlug, {
      currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
      expectedState: "x",
      expectedNonce: "n",
    });

    // Fresh re-derivation: EXACTLY Read-Only, never a union with login 1's Tenant Admin.
    expect(second.roleIds).toEqual([readOnlyRoleId]);
    expect(second.permissions.security_settings).toBe("Read"); // Read-Only's own level — not "Write", which would mean the stale Admin grant is still active
  });

  it("does not strip a role an admin manually granted through the console when an SSO login re-derives roles", async () => {
    const { ctx, tenantSlug, readOnlyRoleId } = await makeEnterpriseTenantWithOidc({ groupClaimName: "groups" });
    const { upsertSsoGroupMapping } = await import("../infrastructure/sso-group-mapping-repository.js");
    await upsertSsoGroupMapping(ctx, "readonly", readOnlyRoleId);

    // A pre-existing, console-invited user with a manually-granted role distinct
    // from anything SSO ever asserts.
    const consoleUserId = await registerUser(ctx, {
      email: "console-admin@example.com",
      password: "some-strong-password-1",
      displayName: "Console Admin",
      roleName: "Designer",
    });
    const { findRoleByName } = await import("../infrastructure/role-repository.js");
    const designerRole = await findRoleByName(ctx, "Designer");

    // First SSO login for this same email links the existing user and asserts
    // "readonly" only — Designer was never in any group mapping.
    nextClaims = { sub: "console-admin-subject", email: "console-admin@example.com", groups: ["readonly"] };
    const result = await completeOidcLogin(tenantSlug, {
      currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
      expectedState: "x",
      expectedNonce: "n",
    });
    expect(result.userId).toBe(consoleUserId);

    // Both the manually-granted Designer role AND the freshly-asserted Read-Only
    // role are present — the console grant was never touched by re-derivation.
    expect(result.roleIds.sort()).toEqual([designerRole!.id, readOnlyRoleId].sort());
  });

  it("cross-tenant: a JIT-provisioned user from tenant A's SSO login never exists in tenant B", async () => {
    const { ctx: ctxA, tenantSlug: slugA } = await makeEnterpriseTenantWithOidc();
    const { ctx: ctxB } = await makeEnterpriseTenantWithOidc();
    nextClaims = { sub: "cross-tenant-subject", email: "cross@example.com" };

    await completeOidcLogin(slugA, {
      currentUrl: new URL("https://app.example.com/api/sso/x/oidc/callback?code=abc&state=x"),
      expectedState: "x",
      expectedNonce: "n",
    });

    await expect(findUserBySsoSubject(ctxA, "cross-tenant-subject")).resolves.not.toBeNull();
    await expect(findUserBySsoSubject(ctxB, "cross-tenant-subject")).resolves.toBeNull();
    void iamTenantContext;
  });
});

describe("SSO login — SAML (Phase 4, BL-36, FR-SEC-10) — real Postgres, REAL @node-saml validation (no mocking)", () => {
  it("SECURITY-CRITICAL: a garbage/unsigned SAMLResponse body is rejected by real signature/XML validation, fail-closed", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantPlanTier(ctx.tenantId, "Enterprise");
    const roleIds = await seedSystemRoles(ctx);
    await upsertConnection(ctx, {
      protocol: "Saml",
      displayName: "Test SAML IdP",
      defaultRoleId: roleIds[0],
      samlEntryPoint: "https://idp.example.com/sso",
      samlIssuer: "https://app.example.com/sp",
      // Not a real certificate — irrelevant here, since garbage XML input never
      // reaches signature verification; the real @node-saml XML parser rejects
      // it first. The point is: nothing about this forged input results in a
      // session.
      samlIdpCertificate: "-----BEGIN CERTIFICATE-----\nZmFrZS1jZXJ0LWZvci10ZXN0aW5nLW9ubHk=\n-----END CERTIFICATE-----",
    } as never);
    await setConnectionStatus(ctx, "Active");
    const tenant = await resolveTenantById(ctx.tenantId);

    await expect(
      completeSamlLogin(tenant!.slug, {
        callbackUrl: "https://app.example.com/api/sso/x/saml/acs",
        body: { SAMLResponse: Buffer.from("<this-is-not-a-valid-saml-assertion/>").toString("base64"), RelayState: "x" },
      }),
    ).rejects.toThrow(SsoAuthenticationFailedError);
  });

  it("fails closed when the connection is not configured for SAML at all", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tenant = await resolveTenantById(ctx.tenantId);
    // No `sso_connection` row exists for this tenant at all — a distinct,
    // typed failure from an *invalid assertion against a real connection*, but
    // still a hard rejection either way; never a session.
    await expect(
      completeSamlLogin(tenant!.slug, {
        callbackUrl: "https://app.example.com/api/sso/x/saml/acs",
        body: { SAMLResponse: "anything", RelayState: "x" },
      }),
    ).rejects.toThrow(SsoNotConfiguredError);
  });
});
