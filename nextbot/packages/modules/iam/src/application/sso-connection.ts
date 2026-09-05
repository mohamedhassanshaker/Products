import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { SsoNotConfiguredError, SsoPlanTierNotEligibleError, type UpsertSsoConnectionRequest } from "@nextbot/contracts";
import { getTenantPlanTier } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { getSsoConnection, setSsoConnectionStatus, upsertSsoConnection, type SsoConnectionRow } from "../infrastructure/sso-connection-repository.js";

const OIDC_SECRET_KIND = "sso-oidc-client-secret";

let provider: KmsEnvelopeSecretsProvider | undefined;
function getProvider(): KmsEnvelopeSecretsProvider {
  if (!provider) provider = new KmsEnvelopeSecretsProvider();
  return provider;
}

/** NFR-17: SSO/SCIM is gated to the Enterprise plan tier. Checked at every
 * mutation of the connection (create/update/enable), not merely at UI-render
 * time, so a tenant downgraded off Enterprise can't keep an SSO connection Active
 * through a stale console tab. */
async function assertEnterpriseTier(ctx: TenantContext): Promise<void> {
  const tier = await getTenantPlanTier(ctx);
  if (tier !== "Enterprise") throw new SsoPlanTierNotEligibleError();
}

/** Returns the tenant's SSO connection (config only — never the decrypted OIDC
 * client secret, which this function's caller never needs; the callback flow
 * decrypts it directly). */
export async function getSsoConnectionConfig(ctx: TenantContext): Promise<SsoConnectionRow | null> {
  return getSsoConnection(ctx);
}

/**
 * Creates/replaces the tenant's SSO connection. Newly saved as `Disabled` —
 * an admin must explicitly activate it (fail-closed: a connection is never
 * live the moment it's saved, since it hasn't been exercised/verified yet).
 */
export async function upsertConnection(ctx: TenantContext, input: UpsertSsoConnectionRequest): Promise<string> {
  await assertEnterpriseTier(ctx);

  // The envelope encryption AAD context must use the SAME id at encrypt and
  // decrypt time (see `mfa-secret-vault.ts`'s identical note) — since this is an
  // upsert (the row may already exist), the target id is resolved *before*
  // encrypting, never left to whatever id the repository would otherwise
  // generate internally.
  const existingRow = await getSsoConnection(ctx);
  const id = existingRow?.id ?? crypto.randomUUID();

  let oidcClientSecretCiphertext: string | null = existingRow?.oidcClientSecretCiphertext ?? null;
  let oidcClientSecretDekRef: string | null = existingRow?.oidcClientSecretDekRef ?? null;
  if (input.protocol === "Oidc" && input.oidcClientSecret) {
    const encrypted = await getProvider().put(input.oidcClientSecret, { tenantId: ctx.tenantId, kind: OIDC_SECRET_KIND, id });
    oidcClientSecretCiphertext = encrypted.ciphertext;
    oidcClientSecretDekRef = encrypted.dekRef;
  }

  await upsertSsoConnection(ctx, {
    id,
    protocol: input.protocol,
    displayName: input.displayName,
    jitProvisioningEnabled: input.jitProvisioningEnabled ?? true,
    defaultRoleId: input.defaultRoleId ?? null,
    groupClaimName: input.groupClaimName ?? null,
    oidcIssuerUrl: input.oidcIssuerUrl ?? null,
    oidcClientId: input.oidcClientId ?? null,
    oidcClientSecretCiphertext,
    oidcClientSecretDekRef,
    samlEntryPoint: input.samlEntryPoint ?? null,
    samlIssuer: input.samlIssuer ?? null,
    samlIdpCertificate: input.samlIdpCertificate ?? null,
  });
  // Every edit re-arms to Disabled — a config change to a live connection must be
  // re-activated explicitly, not silently applied to production traffic.
  await setSsoConnectionStatus(ctx, "Disabled");
  return id;
}

/** Explicit activate/deactivate action, separate from `upsertConnection` so the
 * console can show "Test connection, then Activate" as two distinct steps. */
export async function setConnectionStatus(ctx: TenantContext, status: "Active" | "Disabled"): Promise<void> {
  if (status === "Active") await assertEnterpriseTier(ctx);
  const existing = await getSsoConnection(ctx);
  if (!existing) throw new SsoNotConfiguredError();
  await setSsoConnectionStatus(ctx, status);
}

/** Decrypts the OIDC client secret for the token-exchange step of the callback
 * flow. Never returned to any HTTP response. */
export async function decryptOidcClientSecret(ctx: TenantContext, connection: SsoConnectionRow): Promise<string> {
  if (!connection.oidcClientSecretCiphertext || !connection.oidcClientSecretDekRef) {
    throw new SsoNotConfiguredError();
  }
  return getProvider().get(connection.oidcClientSecretCiphertext, connection.oidcClientSecretDekRef, {
    tenantId: ctx.tenantId,
    kind: OIDC_SECRET_KIND,
    id: connection.id,
  });
}
