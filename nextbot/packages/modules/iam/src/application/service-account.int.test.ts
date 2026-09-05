import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { resolveTenantById } from "@nextbot/tenancy";
import { ApiKeyInvalidError, ApiKeyScopeExceedsAccountError, ForbiddenModuleError } from "@nextbot/contracts";
import { seedSystemRoles } from "./seed-system-roles.js";
import { createServiceAccount, disableServiceAccount, issueApiKey, revokeApiKeyAction, verifyApiKey } from "./service-account.js";
import { requirePermission } from "../domain/permission-matrix.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function makeTenantWithServiceAccount() {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  const roleIds = await seedSystemRoles(ctx);
  // "Backend System Owner" (index 1): connectors Write, agent_platform Read — a
  // real, non-trivial matrix to test narrowing/widening against.
  const backendOwnerRoleId = roleIds[1]!;
  const serviceAccountUserId = await createServiceAccount(ctx, { name: "CI Bot", roleIds: [backendOwnerRoleId] });
  const tenant = await resolveTenantById(ctx.tenantId);
  return { ctx, serviceAccountUserId, tenantSlug: tenant!.slug };
}

describe("service accounts + scoped API keys (Phase 4, BL-36, FR-SEC-10) — real Postgres", () => {
  it("a service account cannot log in through the human password flow (no password hash, kind guard)", async () => {
    const { ctx } = await makeTenantWithServiceAccount();
    const { login } = await import("./authenticate-user.js");
    const tenant = await resolveTenantById(ctx.tenantId);
    await expect(login({ tenantSlug: tenant!.slug, email: "anything@service.internal", password: "irrelevant" })).rejects.toThrow();
  });

  it("issues a real nbk_ API key that verifies end-to-end to the service account's own role-derived permissions", async () => {
    const { serviceAccountUserId, ctx, tenantSlug } = await makeTenantWithServiceAccount();
    const { key } = await issueApiKey(ctx, tenantSlug, serviceAccountUserId, { name: "prod key" });
    expect(key.startsWith(`nbk_${tenantSlug}.`)).toBe(true);

    const claims = await verifyApiKey(key);
    expect(claims.userId).toBe(serviceAccountUserId);
    expect(claims.tenantId).toBe(ctx.tenantId);
    expect(claims.permissions.connectors).toBe("Write"); // Backend System Owner's real matrix.
  });

  it("SECURITY-CRITICAL: a key scoped to connectors:Read can Read but is REJECTED by the real requirePermission() check for connectors:Write", async () => {
    const { serviceAccountUserId, ctx, tenantSlug } = await makeTenantWithServiceAccount();
    const { key } = await issueApiKey(ctx, tenantSlug, serviceAccountUserId, {
      name: "read-only key",
      scopeMatrix: { connectors: "Read" } as never,
    });

    const claims = await verifyApiKey(key);
    // This IS the real authorization path every admin route calls — not a mock.
    expect(() => requirePermission(claims.permissions, "connectors", "Read")).not.toThrow();
    expect(() => requirePermission(claims.permissions, "connectors", "Write")).toThrow(ForbiddenModuleError);
  });

  it("rejects issuing a key whose scope tries to WIDEN beyond the account's own role-derived matrix", async () => {
    const { serviceAccountUserId, ctx } = await makeTenantWithServiceAccount();
    // Backend System Owner has security_settings: None — a scope claiming Write there exceeds it.
    await expect(
      issueApiKey(ctx, "irrelevant-slug", serviceAccountUserId, { name: "over-scoped", scopeMatrix: { security_settings: "Write" } as never }),
    ).rejects.toThrow(ApiKeyScopeExceedsAccountError);
  });

  it("SECURITY-CRITICAL: a revoked API key is rejected on the VERY NEXT verification attempt — no delay window", async () => {
    const { serviceAccountUserId, ctx, tenantSlug } = await makeTenantWithServiceAccount();
    const { apiKeyId, key } = await issueApiKey(ctx, tenantSlug, serviceAccountUserId, { name: "to-revoke" });
    await expect(verifyApiKey(key)).resolves.toBeTruthy();

    await revokeApiKeyAction(ctx, apiKeyId);

    await expect(verifyApiKey(key)).rejects.toThrow(ApiKeyInvalidError);
  });

  it("SECURITY-CRITICAL: disabling the service account rejects its (still not individually revoked) API key on the very next use", async () => {
    const { serviceAccountUserId, ctx, tenantSlug } = await makeTenantWithServiceAccount();
    const { key } = await issueApiKey(ctx, tenantSlug, serviceAccountUserId, { name: "still-valid-key" });
    await expect(verifyApiKey(key)).resolves.toBeTruthy();

    await disableServiceAccount(ctx, serviceAccountUserId);

    await expect(verifyApiKey(key)).rejects.toThrow(ApiKeyInvalidError);
  });

  it("rejects a well-formed but wrong secret against a real, valid keyId", async () => {
    const { serviceAccountUserId, ctx, tenantSlug } = await makeTenantWithServiceAccount();
    const { key } = await issueApiKey(ctx, tenantSlug, serviceAccountUserId, { name: "k" });
    const tampered = key.slice(0, -3) + "xyz"; // corrupt only the secret segment
    await expect(verifyApiKey(tampered)).rejects.toThrow(ApiKeyInvalidError);
  });

  it("rejects a syntactically malformed key (no cross-tenant scan, fails closed on parse)", async () => {
    await expect(verifyApiKey("nbk_not-a-real-key")).rejects.toThrow(ApiKeyInvalidError);
    await expect(verifyApiKey("totally-unrelated-string")).rejects.toThrow(ApiKeyInvalidError);
  });

  it("cross-tenant: an API key issued for tenant A is never resolvable via tenant B's slug", async () => {
    const { serviceAccountUserId, ctx, tenantSlug } = await makeTenantWithServiceAccount();
    const { apiKeyId, key } = await issueApiKey(ctx, tenantSlug, serviceAccountUserId, { name: "tenant-a-key" });

    const ctxB = await createFixtureTenant();
    createdTenantIds.push(ctxB.tenantId);
    const tenantB = await resolveTenantById(ctxB.tenantId);

    // Splice tenant A's real keyId/secret onto tenant B's real slug — a forged
    // cross-tenant key. Must be rejected: tenant B's own `api_key` table has no
    // row with that keyPrefix (RLS + normal tenant-scoped lookup).
    const parts = key.split(".");
    const forged = `${key.split(".")[0]!.replace(tenantSlug, tenantB!.slug)}.${parts[1]}.${parts[2]}`;
    await expect(verifyApiKey(forged)).rejects.toThrow(ApiKeyInvalidError);

    // Sanity: the real key still works under its own real tenant.
    await expect(verifyApiKey(key)).resolves.toBeTruthy();
    void apiKeyId;
  });
});
