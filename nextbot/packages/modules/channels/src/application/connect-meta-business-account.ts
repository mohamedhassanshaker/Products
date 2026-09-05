import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { randomBytes } from "node:crypto";
import { createMetaGraphClient, MetaGraphTransportError } from "@nextbot/channel-adapters";
import type { ConnectMetaBusinessAccountRequest, MetaBusinessAccountDto } from "@nextbot/contracts";
import { ChannelNotFoundError, WhatsAppMetaVerificationFailedError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { findChannelById } from "../infrastructure/channel-repository.js";
import { insertCredential, getCredentialMaskedHint } from "../infrastructure/credential-repository.js";
import {
  findMetaBusinessAccountByChannelId,
  insertMetaBusinessAccount,
  deleteMetaBusinessAccount,
  updateMetaBusinessAccountStatus,
  updateWabaConfig,
  type MetaBusinessAccountRow,
} from "../infrastructure/whatsapp-repository.js";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

/**
 * Meta Business Manager "connect" flow (FR-META-01-13, ADR-0009's OAuth pattern
 * applied to Meta). **No real Meta App exists in this sandbox** — the primary,
 * fully-implemented path here is the same real-world alternative Meta itself
 * documents for server-to-server integrations without a public OAuth redirect:
 * an admin issues a **System User access token** directly from Meta Business
 * Manager's own UI and pastes it in, alongside the App ID/Secret Meta's Developer
 * Console already shows them. This is never a simulated/fabricated "connected"
 * state — the token/business id supplied are genuinely vaulted and genuinely used
 * for every subsequent Graph API call (template sync, phone-number sync, sends);
 * the only thing not exercised against a live network is the redirect-based OAuth
 * handshake itself (which `packages/modules/agent-platform`'s Git OAuth flow
 * documents the identical limitation for).
 *
 * Every credential (system user token, app secret) is envelope-encrypted (ADR-0007)
 * exactly like every other credential in this system — a fresh, randomly-generated
 * webhook verify token is minted here too (never admin-typed, so it can't be
 * guessed/reused across tenants), matching the Git webhook secret's own generation
 * pattern (`randomBytes(32).toString("hex")`).
 *
 * QA D2 fix: before vaulting anything or writing the `meta_business_account` row,
 * this performs a real, lightweight verification call against Meta's Graph API
 * (`GET /{business-id}?fields=id,name` — the same read `syncWhatsAppNumbers`/
 * `syncWhatsAppTemplates` already trust as a genuine Meta round trip) using the
 * *supplied* System User token. Only a successful response results in a
 * `Connected` account being created; a transport/auth failure throws
 * {@link WhatsAppMetaVerificationFailedError} and nothing is persisted — this
 * never shows an optimistic "Connected" badge for a fabricated/unverified
 * Business ID + token pair that would otherwise only flip to `Unreachable` on the
 * next real send/sync.
 */
export async function connectMetaBusinessAccount(
  ctx: TenantContext,
  input: ConnectMetaBusinessAccountRequest,
  opts: { graphApiBaseUrl?: string } = {},
): Promise<MetaBusinessAccountDto> {
  const channel = await findChannelById(ctx, input.channelId);
  if (!channel || channel.type !== "WhatsApp") throw new ChannelNotFoundError();

  const client = createMetaGraphClient({
    accessToken: input.systemUserToken,
    baseUrl: opts.graphApiBaseUrl ?? process.env.NEXTBOT_META_GRAPH_API_BASE_URL,
  });
  try {
    await client.getBusinessInfo(input.businessId);
  } catch (err) {
    const detail = err instanceof MetaGraphTransportError ? err.message : err instanceof Error ? err.message : undefined;
    throw new WhatsAppMetaVerificationFailedError(detail);
  }

  const existing = await findMetaBusinessAccountByChannelId(ctx, input.channelId);
  if (existing) await deleteMetaBusinessAccount(ctx, existing.id);

  const provider = getSecretsProvider();

  const systemUserTokenId = crypto.randomUUID();
  const encryptedToken = await provider.put(input.systemUserToken, { tenantId: ctx.tenantId, kind: "meta-system-user-token", id: systemUserTokenId });
  const systemUserTokenCredentialId = await insertCredential(ctx, {
    id: systemUserTokenId,
    label: `Meta System User token (${input.businessName})`,
    type: "SystemUserToken",
    vaultRef: encryptedToken.vaultRef,
    ciphertext: encryptedToken.ciphertext,
    dekRef: encryptedToken.dekRef,
    maskedHint: encryptedToken.maskedHint,
  });

  const appSecretId = crypto.randomUUID();
  const encryptedAppSecret = await provider.put(input.appSecret, { tenantId: ctx.tenantId, kind: "meta-app-secret", id: appSecretId });
  const appSecretCredentialId = await insertCredential(ctx, {
    id: appSecretId,
    label: `Meta App Secret (${input.appId})`,
    type: "MetaAppSecret",
    vaultRef: encryptedAppSecret.vaultRef,
    ciphertext: encryptedAppSecret.ciphertext,
    dekRef: encryptedAppSecret.dekRef,
    maskedHint: encryptedAppSecret.maskedHint,
  });

  const verifyTokenPlaintext = randomBytes(32).toString("hex");
  const verifyTokenId = crypto.randomUUID();
  const encryptedVerifyToken = await provider.put(verifyTokenPlaintext, { tenantId: ctx.tenantId, kind: "meta-webhook-verify-token", id: verifyTokenId });
  const webhookVerifyTokenCredentialId = await insertCredential(ctx, {
    id: verifyTokenId,
    label: `WhatsApp webhook verify token (${input.businessName})`,
    type: "MetaWebhookVerifyToken",
    vaultRef: encryptedVerifyToken.vaultRef,
    ciphertext: encryptedVerifyToken.ciphertext,
    dekRef: encryptedVerifyToken.dekRef,
    maskedHint: encryptedVerifyToken.maskedHint,
  });

  const id = await insertMetaBusinessAccount(ctx, {
    channelId: input.channelId,
    businessId: input.businessId,
    businessName: input.businessName,
    systemUserTokenCredentialId,
    appId: input.appId,
    appSecretCredentialId,
    webhookVerifyTokenCredentialId,
  });

  return toDto(ctx, (await findMetaBusinessAccountByChannelId(ctx, input.channelId)) as MetaBusinessAccountRow, id);
}

export async function disconnectMetaBusinessAccount(ctx: TenantContext, channelId: string): Promise<void> {
  const existing = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!existing) return;
  await deleteMetaBusinessAccount(ctx, existing.id);
}

export async function getMetaBusinessAccountDto(ctx: TenantContext, channelId: string): Promise<MetaBusinessAccountDto | null> {
  const row = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!row) return null;
  return toDto(ctx, row, row.id);
}

export async function setWabaConfig(ctx: TenantContext, channelId: string, input: { wabaId?: string; sessionWindowWarningEnabled?: boolean }): Promise<MetaBusinessAccountDto> {
  const row = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!row) throw new ChannelNotFoundError();
  await updateWabaConfig(ctx, row.id, input);
  return (await getMetaBusinessAccountDto(ctx, channelId)) as MetaBusinessAccountDto;
}

/** Marks the account `Unreachable` (never leaves it stuck showing a fake
 * "Connected" badge, per the Final Review B1 discipline applied to this new
 * connector family) after a real Graph API health-check call fails. */
export async function markMetaBusinessAccountUnreachable(ctx: TenantContext, channelId: string): Promise<void> {
  const row = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!row) return;
  await updateMetaBusinessAccountStatus(ctx, row.id, "Unreachable");
}

export async function markMetaBusinessAccountConnected(ctx: TenantContext, channelId: string): Promise<void> {
  const row = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!row) return;
  await updateMetaBusinessAccountStatus(ctx, row.id, "Connected");
}

async function toDto(ctx: TenantContext, row: MetaBusinessAccountRow, id: string): Promise<MetaBusinessAccountDto> {
  const [systemUserTokenMaskedHint, appSecretMaskedHint] = await Promise.all([
    getCredentialMaskedHint(ctx, row.systemUserTokenCredentialId),
    getCredentialMaskedHint(ctx, row.appSecretCredentialId),
  ]);
  return {
    id,
    channelId: row.channelId,
    businessId: row.businessId,
    businessName: row.businessName,
    wabaId: row.wabaId,
    status: row.status,
    appId: row.appId,
    systemUserTokenMaskedHint,
    appSecretMaskedHint,
    sessionWindowWarningEnabled: row.sessionWindowWarningEnabled,
    linkedAt: row.linkedAt ? row.linkedAt.toISOString() : null,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
  };
}
