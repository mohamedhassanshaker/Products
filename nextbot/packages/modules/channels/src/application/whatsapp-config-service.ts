import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { createMetaGraphClient, MetaGraphTransportError, type MetaPhoneNumber } from "@nextbot/channel-adapters";
import type { WhatsAppNumberDto } from "@nextbot/contracts";
import { MetaBusinessAccountNotFoundError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { getCredentialForDecrypt, updateCredentialCiphertext } from "../infrastructure/credential-repository.js";
import {
  findMetaBusinessAccountByChannelId,
  listWhatsAppNumbers,
  upsertWhatsAppNumber,
  updateMetaBusinessAccountStatus,
  type MetaBusinessAccountRow,
} from "../infrastructure/whatsapp-repository.js";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

async function decryptCredential(ctx: TenantContext, credentialId: string, kind: string): Promise<string> {
  const encrypted = await getCredentialForDecrypt(ctx, credentialId);
  if (!encrypted) throw new Error(`Credential '${credentialId}' not found for decryption.`);
  return getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, { tenantId: ctx.tenantId, kind, id: credentialId });
}

async function requireAccount(ctx: TenantContext, channelId: string): Promise<MetaBusinessAccountRow> {
  const row = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!row) throw new MetaBusinessAccountNotFoundError();
  return row;
}

/** Resolves the tenant's real System User access token (decrypted, in-memory only)
 * — used by every Graph API call site (template sync, phone-number sync, send). */
export async function resolveSystemUserToken(ctx: TenantContext, channelId: string): Promise<{ accessToken: string; wabaId: string | null }> {
  const account = await requireAccount(ctx, channelId);
  if (!account.systemUserTokenCredentialId) throw new MetaBusinessAccountNotFoundError();
  const accessToken = await decryptCredential(ctx, account.systemUserTokenCredentialId, "meta-system-user-token");
  return { accessToken, wabaId: account.wabaId };
}

export async function resolveAppSecret(ctx: TenantContext, channelId: string): Promise<string> {
  const account = await requireAccount(ctx, channelId);
  if (!account.appSecretCredentialId) throw new MetaBusinessAccountNotFoundError();
  return decryptCredential(ctx, account.appSecretCredentialId, "meta-app-secret");
}

export async function resolveWebhookVerifyToken(ctx: TenantContext, channelId: string): Promise<string> {
  const account = await requireAccount(ctx, channelId);
  if (!account.webhookVerifyTokenCredentialId) throw new MetaBusinessAccountNotFoundError();
  return decryptCredential(ctx, account.webhookVerifyTokenCredentialId, "meta-webhook-verify-token");
}

/** Rotation (FR-SEC-02: every credential in this system is rotatable, never
 * re-displayed in plaintext post-entry). Envelope-re-encrypts the new plaintext in
 * place under the same `credential.id` — the referencing `meta_business_account`
 * row needs no update since it points at the credential id, not its ciphertext. */
export async function rotateSystemUserToken(ctx: TenantContext, channelId: string, newTokenPlaintext: string): Promise<void> {
  const account = await requireAccount(ctx, channelId);
  if (!account.systemUserTokenCredentialId) throw new MetaBusinessAccountNotFoundError();
  const encrypted = await getSecretsProvider().put(newTokenPlaintext, { tenantId: ctx.tenantId, kind: "meta-system-user-token", id: account.systemUserTokenCredentialId });
  await updateCredentialCiphertext(ctx, account.systemUserTokenCredentialId, encrypted);
}

export async function rotateAppSecret(ctx: TenantContext, channelId: string, newSecretPlaintext: string): Promise<void> {
  const account = await requireAccount(ctx, channelId);
  if (!account.appSecretCredentialId) throw new MetaBusinessAccountNotFoundError();
  const encrypted = await getSecretsProvider().put(newSecretPlaintext, { tenantId: ctx.tenantId, kind: "meta-app-secret", id: account.appSecretCredentialId });
  await updateCredentialCiphertext(ctx, account.appSecretCredentialId, encrypted);
}

/**
 * FR-META-01's phone-number list + messaging-tier gauge: fetches the tenant's real
 * WABA phone numbers from Meta's Graph API (`GET /{waba-id}/phone_numbers`) and
 * upserts them — mirrors the template-sync action (§7.2.4/§7.2.2 UX guidance), a
 * deliberate, flagged simplification of the UX guidance's "Add phone number" live
 * OTP mini-flow: real WhatsApp phone-number verification happens directly in Meta
 * Business Manager (Meta's own embedded-signup/OTP UI, which this sandbox has no
 * real Meta App to drive), so this system *syncs* already-verified numbers rather
 * than performing verification itself — a materially more honest scope for a
 * sandbox with no live Meta App than fabricating an OTP screen NextBot doesn't
 * actually control.
 *
 * On a transport failure, marks the account `Unreachable` (never leaves a stale
 * "Connected" badge showing) and rethrows.
 */
export async function syncWhatsAppNumbers(
  ctx: TenantContext,
  channelId: string,
  opts: { graphApiBaseUrl?: string } = {},
): Promise<WhatsAppNumberDto[]> {
  const account = await requireAccount(ctx, channelId);
  if (!account.wabaId) throw new Error("Set a WABA ID before syncing phone numbers.");
  const { accessToken } = await resolveSystemUserToken(ctx, channelId);
  const client = createMetaGraphClient({ accessToken, baseUrl: opts.graphApiBaseUrl ?? process.env.NEXTBOT_META_GRAPH_API_BASE_URL });

  let numbers: MetaPhoneNumber[];
  try {
    numbers = await client.listPhoneNumbers(account.wabaId);
  } catch (err) {
    if (err instanceof MetaGraphTransportError) {
      await updateMetaBusinessAccountStatus(ctx, account.id, "Unreachable");
    }
    throw err;
  }
  await updateMetaBusinessAccountStatus(ctx, account.id, "Connected");

  for (const n of numbers) {
    await upsertWhatsAppNumber(ctx, {
      metaBusinessAccountId: account.id,
      phoneNumberId: n.id,
      e164: n.display_phone_number,
      displayName: n.verified_name ?? null,
      verificationStatus: mapVerificationStatus(n.code_verification_status),
      messagingTier: mapMessagingTier(n.messaging_limit_tier),
      qualityRating: n.quality_rating ?? null,
    });
  }

  const rows = await listWhatsAppNumbers(ctx, account.id);
  return rows.map((r) => ({
    id: r.id,
    phoneNumberId: r.phoneNumberId,
    e164: r.e164,
    displayName: r.displayName,
    verificationStatus: r.verificationStatus,
    messagingTier: r.messagingTier,
    qualityRating: r.qualityRating,
  }));
}

export async function listWhatsAppNumberDtos(ctx: TenantContext, channelId: string): Promise<WhatsAppNumberDto[]> {
  const account = await requireAccount(ctx, channelId);
  const rows = await listWhatsAppNumbers(ctx, account.id);
  return rows.map((r) => ({
    id: r.id,
    phoneNumberId: r.phoneNumberId,
    e164: r.e164,
    displayName: r.displayName,
    verificationStatus: r.verificationStatus,
    messagingTier: r.messagingTier,
    qualityRating: r.qualityRating,
  }));
}

function mapVerificationStatus(status: MetaPhoneNumber["code_verification_status"]): WhatsAppNumberDto["verificationStatus"] {
  switch (status) {
    case "VERIFIED":
      return "Verified";
    case "PENDING":
      return "Pending";
    default:
      return "Unverified";
  }
}

function mapMessagingTier(tier: MetaPhoneNumber["messaging_limit_tier"]): WhatsAppNumberDto["messagingTier"] {
  switch (tier) {
    case "TIER_1K":
      return "Tier2";
    case "TIER_10K":
      return "Tier3";
    case "TIER_100K":
      return "Tier4";
    default:
      return "Tier1";
  }
}
