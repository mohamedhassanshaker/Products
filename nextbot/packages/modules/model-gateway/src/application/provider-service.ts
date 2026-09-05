import { generateId, type TenantContext } from "@nextbot/db";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import type { CreateModelProviderRequest, UpdateModelProviderRequest } from "@nextbot/contracts";
import { ModelProviderBaseUrlRequiredError, ModelProviderNotFoundError } from "@nextbot/contracts";
import { adapterFor } from "../domain/adapter-registry.js";
import { insertCredential } from "../infrastructure/credential-repository.js";
import {
  createProvider,
  getProvider,
  listProviders,
  updateOwnProvider,
  type ModelProviderRow,
} from "../infrastructure/model-gateway-repository.js";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

/** Vaults a plaintext API key exactly like every other credential in this codebase
 * (ADR-0007) — the plaintext never reaches a `model_provider` column, only the
 * resulting `credentialId` does. */
async function vaultApiKey(ctx: TenantContext, type: string, apiKeyPlaintext: string): Promise<string> {
  const credentialId = generateId();
  const encrypted = await getSecretsProvider().put(apiKeyPlaintext, { tenantId: ctx.tenantId, kind: "model-provider-key", id: credentialId });
  await insertCredential(ctx, {
    id: credentialId,
    label: `${type} API key`,
    vaultRef: encrypted.vaultRef,
    ciphertext: encrypted.ciphertext,
    dekRef: encrypted.dekRef,
    maskedHint: encrypted.maskedHint,
  });
  return credentialId;
}

/** Create a tenant-owned (BYO) provider registration (FR-AGT-20). */
export async function createProviderRegistration(ctx: TenantContext, input: CreateModelProviderRequest): Promise<ModelProviderRow> {
  const adapter = adapterFor(input.type);
  // Enforced at the application layer, not a DB CHECK (see the migration's own note
  // on why) — self-hosted types (openai-compatible, ollama, custom) have no default
  // hosted endpoint, so a base URL is mandatory for a NEW registration through this
  // CRUD path specifically.
  if (adapter.requiresBaseUrl && !input.baseUrl) {
    throw new ModelProviderBaseUrlRequiredError(input.type);
  }
  const credentialId = input.apiKeyPlaintext ? await vaultApiKey(ctx, input.type, input.apiKeyPlaintext) : undefined;
  return createProvider(ctx, {
    type: input.type,
    name: input.name,
    baseUrl: input.baseUrl,
    // A provider's own `region` defaults to the tenant's own region rather than an
    // arbitrary global default — the common case (a tenant registering their own
    // BYO/self-hosted endpoint) is that the endpoint lives wherever the tenant does.
    region: input.region ?? ctx.region,
    regionsServed: input.regionsServed,
    authMethod: input.authMethod ?? (credentialId ? "ApiKey" : adapter.requiresCredential ? "ApiKey" : "None"),
    credentialId,
    orgOrProjectId: input.orgOrProjectId,
    retainsPrompts: input.retainsPrompts,
    trainsOnData: input.trainsOnData,
    rateLimitJson: input.rateLimitJson,
    healthIntervalSeconds: input.healthIntervalSeconds,
    enabled: input.enabled,
  });
}

export async function listProviderRegistrations(ctx: TenantContext): Promise<ModelProviderRow[]> {
  return listProviders(ctx);
}

async function requireOwnProvider(ctx: TenantContext, id: string): Promise<ModelProviderRow> {
  const row = await getProvider(ctx, id);
  // A platform-shared row (tenant_id === null) or another tenant's row (impossible to
  // even see under RLS) is treated identically to "not found" — this tenant has no
  // business knowing whether a platform row exists that it merely can't touch.
  if (!row || row.tenantId !== ctx.tenantId) throw new ModelProviderNotFoundError(id);
  return row;
}

export async function updateProviderRegistration(ctx: TenantContext, id: string, input: UpdateModelProviderRequest): Promise<ModelProviderRow> {
  const existing = await requireOwnProvider(ctx, id);
  const credentialId = input.apiKeyPlaintext ? await vaultApiKey(ctx, existing.type, input.apiKeyPlaintext) : undefined;
  await updateOwnProvider(ctx, id, {
    name: input.name,
    baseUrl: input.baseUrl,
    region: input.region,
    regionsServed: input.regionsServed,
    credentialId,
    orgOrProjectId: input.orgOrProjectId,
    retainsPrompts: input.retainsPrompts,
    trainsOnData: input.trainsOnData,
    rateLimitJson: input.rateLimitJson,
    healthIntervalSeconds: input.healthIntervalSeconds,
    enabled: input.enabled,
  });
  const row = await getProvider(ctx, id);
  if (!row) throw new ModelProviderNotFoundError(id);
  return row;
}

/** "Deactivate" (FR-AGT-20's console requirement) is a soft-disable, never a delete —
 * a provider a route (Phase 2) or catalog entry (this phase) already references must
 * keep resolving as a row, just no longer usable for new work. */
export async function deactivateProviderRegistration(ctx: TenantContext, id: string): Promise<ModelProviderRow> {
  await requireOwnProvider(ctx, id);
  await updateOwnProvider(ctx, id, { enabled: false });
  const row = await getProvider(ctx, id);
  if (!row) throw new ModelProviderNotFoundError(id);
  return row;
}

export { requireOwnProvider };
