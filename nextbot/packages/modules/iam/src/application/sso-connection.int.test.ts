import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantPlanTier } from "@nextbot/tenancy";
import { SsoNotConfiguredError, SsoPlanTierNotEligibleError } from "@nextbot/contracts";
import { decryptOidcClientSecret, getSsoConnectionConfig, setConnectionStatus, upsertConnection } from "./sso-connection.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("sso-connection admin CRUD (Phase 4, BL-36) — real Postgres", () => {
  it("SECURITY: setConnectionStatus('Active') rejects a non-Enterprise tenant even if a connection row exists (NFR-17)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantPlanTier(ctx.tenantId, "Enterprise");
    await upsertConnection(ctx, { protocol: "Oidc", displayName: "IdP", oidcIssuerUrl: "https://idp", oidcClientId: "cid", oidcClientSecret: "secret" } as never);
    // Downgraded off Enterprise after the connection was configured — activation must still be blocked.
    await updateTenantPlanTier(ctx.tenantId, "Growth");
    await expect(setConnectionStatus(ctx, "Active")).rejects.toThrow(SsoPlanTierNotEligibleError);
  });

  it("rejects activating a connection that was never configured", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantPlanTier(ctx.tenantId, "Enterprise");
    await expect(setConnectionStatus(ctx, "Active")).rejects.toThrow(SsoNotConfiguredError);
  });

  it("deactivating (never requires Enterprise tier) succeeds even after a downgrade", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantPlanTier(ctx.tenantId, "Enterprise");
    await upsertConnection(ctx, { protocol: "Oidc", displayName: "IdP", oidcIssuerUrl: "https://idp", oidcClientId: "cid", oidcClientSecret: "secret" } as never);
    await setConnectionStatus(ctx, "Active");
    await updateTenantPlanTier(ctx.tenantId, "Starter");
    await setConnectionStatus(ctx, "Disabled");
    const connection = await getSsoConnectionConfig(ctx);
    expect(connection!.status).toBe("Disabled");
  });

  it("decryptOidcClientSecret fails closed for a SAML-only connection with no OIDC secret set", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantPlanTier(ctx.tenantId, "Enterprise");
    await upsertConnection(ctx, {
      protocol: "Saml",
      displayName: "SAML IdP",
      samlEntryPoint: "https://idp/sso",
      samlIssuer: "https://sp",
      samlIdpCertificate: "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----",
    } as never);
    const connection = await getSsoConnectionConfig(ctx);
    await expect(decryptOidcClientSecret(ctx, connection!)).rejects.toThrow(SsoNotConfiguredError);
  });

  it("round-trips a real OIDC client secret through envelope encryption", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantPlanTier(ctx.tenantId, "Enterprise");
    await upsertConnection(ctx, { protocol: "Oidc", displayName: "IdP", oidcIssuerUrl: "https://idp", oidcClientId: "cid", oidcClientSecret: "my-real-secret-value" } as never);
    const connection = await getSsoConnectionConfig(ctx);
    await expect(decryptOidcClientSecret(ctx, connection!)).resolves.toBe("my-real-secret-value");
  });

  it("an edit to an Active connection re-arms it to Disabled (must be re-activated explicitly)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantPlanTier(ctx.tenantId, "Enterprise");
    await upsertConnection(ctx, { protocol: "Oidc", displayName: "IdP", oidcIssuerUrl: "https://idp", oidcClientId: "cid", oidcClientSecret: "s" } as never);
    await setConnectionStatus(ctx, "Active");
    await upsertConnection(ctx, { protocol: "Oidc", displayName: "IdP renamed", oidcIssuerUrl: "https://idp", oidcClientId: "cid" } as never);
    const connection = await getSsoConnectionConfig(ctx);
    expect(connection!.status).toBe("Disabled");
    expect(connection!.displayName).toBe("IdP renamed");
  });
});
