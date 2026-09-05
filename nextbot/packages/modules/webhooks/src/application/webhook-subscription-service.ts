import { randomBytes } from "node:crypto";
import type { TenantContext } from "@nextbot/db";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { WebhookTargetUrlInvalidError, WebhookSubscriptionNotFoundError, type WebhookEventCategoryValue } from "@nextbot/contracts";
import { isWellFormedHttpsUrl } from "../domain/url-validation.js";
import { insertCredential, getCredentialForDecrypt } from "../infrastructure/credential-repository.js";
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  getWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  type WebhookSubscriptionRow,
} from "../infrastructure/webhook-subscription-repository.js";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

export interface WebhookSubscriptionView {
  id: string;
  targetUrl: string;
  eventCategories: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: WebhookSubscriptionRow): WebhookSubscriptionView {
  return { id: row.id, targetUrl: row.targetUrl, eventCategories: row.eventCategories, enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/**
 * Creates a subscription and mints a fresh signing secret, vaulted the exact same way
 * `git_connection.webhook_secret_credential_id` already is (Phase 10, ADR-0007
 * envelope encryption) — never a bespoke storage path. The plaintext secret is
 * returned exactly once (mirrors `issueApiKey`'s own "shown once" convention); only
 * its envelope-encrypted form is ever persisted.
 *
 * @throws {WebhookTargetUrlInvalidError} `targetUrl` is not a well-formed `https://` URL.
 */
export async function subscribeToWebhooks(
  ctx: TenantContext,
  input: { targetUrl: string; eventCategories: WebhookEventCategoryValue[]; createdByUserId: string | null },
): Promise<{ subscription: WebhookSubscriptionView; signingSecret: string }> {
  if (!isWellFormedHttpsUrl(input.targetUrl)) throw new WebhookTargetUrlInvalidError("targetUrl");

  const signingSecretPlaintext = randomBytes(32).toString("hex");
  const credentialId = crypto.randomUUID();
  const encrypted = await getSecretsProvider().put(signingSecretPlaintext, { tenantId: ctx.tenantId, kind: "webhook-signing-secret", id: credentialId });
  await insertCredential(ctx, {
    id: credentialId,
    label: `Webhook signing secret (${input.targetUrl})`,
    type: "WebhookSecret",
    vaultRef: encrypted.vaultRef,
    ciphertext: encrypted.ciphertext,
    dekRef: encrypted.dekRef,
    maskedHint: encrypted.maskedHint,
  });

  const row = await createWebhookSubscription(ctx, {
    targetUrl: input.targetUrl,
    eventCategories: input.eventCategories,
    signingSecretCredentialId: credentialId,
    createdByUserId: input.createdByUserId,
  });
  return { subscription: toView(row), signingSecret: signingSecretPlaintext };
}

export async function listSubscriptions(ctx: TenantContext): Promise<WebhookSubscriptionView[]> {
  return (await listWebhookSubscriptions(ctx)).map(toView);
}

/**
 * @throws {WebhookTargetUrlInvalidError} a supplied `targetUrl` patch is not a
 *   well-formed `https://` URL.
 * @throws {WebhookSubscriptionNotFoundError} `id` doesn't resolve within the
 *   caller's own tenant.
 */
export async function updateSubscription(
  ctx: TenantContext,
  id: string,
  patch: { targetUrl?: string; eventCategories?: WebhookEventCategoryValue[]; enabled?: boolean },
): Promise<WebhookSubscriptionView> {
  if (patch.targetUrl !== undefined && !isWellFormedHttpsUrl(patch.targetUrl)) throw new WebhookTargetUrlInvalidError("targetUrl");
  const row = await updateWebhookSubscription(ctx, id, patch);
  if (!row) throw new WebhookSubscriptionNotFoundError();
  return toView(row);
}

export async function unsubscribe(ctx: TenantContext, id: string): Promise<void> {
  const existing = await getWebhookSubscription(ctx, id);
  if (!existing) throw new WebhookSubscriptionNotFoundError();
  await deleteWebhookSubscription(ctx, id);
}

/** Decrypts a subscription's signing secret for the dispatcher's own use (signing an
 * outbound payload) — never exposed through any read route; a subscription's own
 * `GET`/list response never includes this. */
export async function getSigningSecretPlaintext(ctx: TenantContext, subscription: WebhookSubscriptionRow): Promise<string> {
  const encrypted = await getCredentialForDecrypt(ctx, subscription.signingSecretCredentialId);
  if (!encrypted) throw new WebhookSubscriptionNotFoundError();
  return getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, {
    tenantId: ctx.tenantId,
    kind: "webhook-signing-secret",
    id: subscription.signingSecretCredentialId,
  });
}

export type { WebhookSubscriptionRow };
