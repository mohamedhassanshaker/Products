import type { TenantContext } from "@nextbot/db";
import { ModelProviderNotFoundError } from "@nextbot/contracts";
import { adapterFor, type AdapterContext } from "../domain/adapter-registry.js";
import { getCredentialForDecrypt } from "../infrastructure/credential-repository.js";
import { getProvider, listOwnProvidersForTenant, setProviderStatus, type ModelProviderRow } from "../infrastructure/model-gateway-repository.js";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

async function buildAdapterContext(ctx: TenantContext, provider: ModelProviderRow, fetchImpl: typeof fetch): Promise<AdapterContext> {
  let apiKey: string | null = null;
  if (provider.credentialId) {
    const encrypted = await getCredentialForDecrypt(ctx, provider.credentialId);
    if (encrypted) {
      apiKey = await getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, {
        tenantId: ctx.tenantId,
        kind: "model-provider-key",
        id: provider.credentialId,
      });
    }
  }
  return { provider: { id: provider.id, type: provider.type, baseUrl: provider.baseUrl, apiKey }, fetchImpl };
}

/**
 * FR-AGT-20's health probe for one provider — a distinct, alertable `Unreachable`
 * status is recorded, never a silent outage. Called on-demand
 * (`POST …/providers/{id}/probe`) and by the `model-gateway.provider-probe` scheduled
 * job (once per tenant-owned provider, per its own `health_interval_seconds`
 * cadence — that cadence check lives in the job itself, mirroring `mcp.health-check`'s
 * "sweep tick vs. per-connector cadence" split).
 */
export async function probeProvider(ctx: TenantContext, providerId: string, fetchImpl: typeof fetch = fetch): Promise<ModelProviderRow> {
  const provider = await getProvider(ctx, providerId);
  if (!provider) throw new ModelProviderNotFoundError(providerId);

  const adapterCtx = await buildAdapterContext(ctx, provider, fetchImpl);
  const result = await adapterFor(provider.type).probe(adapterCtx);

  await setProviderStatus(ctx, providerId, {
    status: result.ok ? "Active" : "Unreachable",
    lastProbeAt: new Date(),
    lastProbeError: result.ok ? null : { code: "PROBE_FAILED", message: result.detail ?? "Unreachable" },
  });

  const updated = await getProvider(ctx, providerId);
  if (!updated) throw new ModelProviderNotFoundError(providerId);
  return updated;
}

/** Every tenant-owned provider whose `health_interval_seconds` has elapsed since its
 * last probe (or that has never been probed). Platform-shared providers are excluded
 * — see `listOwnProvidersForTenant`'s doc comment for why. */
export async function listProvidersDueForProbe(ctx: TenantContext, now: Date = new Date()): Promise<ModelProviderRow[]> {
  const providers = await listOwnProvidersForTenant(ctx);
  return providers.filter((p) => {
    if (!p.enabled) return false;
    if (!p.lastProbeAt) return true;
    return now.getTime() - p.lastProbeAt.getTime() >= p.healthIntervalSeconds * 1000;
  });
}
