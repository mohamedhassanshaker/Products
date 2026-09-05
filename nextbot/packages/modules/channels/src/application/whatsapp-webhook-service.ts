import { randomBytes } from "node:crypto";
import type { WhatsAppWebhookStatusDto } from "@nextbot/contracts";
import { MetaBusinessAccountNotFoundError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import {
  findMetaBusinessAccountByChannelId,
  updateWebhookVerificationStatus,
  updateLastEventReceivedAt,
  type MetaBusinessAccountRow,
} from "../infrastructure/whatsapp-repository.js";
import { resolveWebhookVerifyToken } from "./whatsapp-config-service.js";

/**
 * QA D1 fix (screen inventory B.2.3's missing "Webhook" tab): the admin-facing
 * webhook URL/verification-status/re-verify surface, backed by real state — never
 * a fabricated always-"Verified" badge or a hardcoded placeholder URL.
 *
 * The webhook path itself is the real Gateway Plane route
 * (`apps/gateway/app/api/v1/channels/whatsapp/webhooks/[tenantId]/[channelId]/route.ts`)
 * — `webhookUrl` is that exact path resolved against this deployment's real
 * Gateway Plane base URL, matching the same "derive from an env-configured
 * deployment base URL, never a hardcoded host" pattern `NEXTBOT_WIDGET_BASE_URL`
 * already establishes for the widget embed snippet (QA Final Review B3).
 */
const DEFAULT_GATEWAY_BASE_URL = "http://localhost:4001";

/** The two event kinds `whatsAppAdapter.parseInbound` actually processes (Meta's
 * own `messages`/`statuses` webhook value fields) — see this module's own doc
 * comment on `WhatsAppWebhookEventSubscriptionDtoSchema` for why `subscribed` is
 * derived rather than a live per-field Meta API read in this sandbox. */
const SUPPORTED_EVENT_TYPES: Array<{ eventType: string; label: string }> = [
  { eventType: "messages", label: "Inbound messages" },
  { eventType: "message_status", label: "Message status updates (sent/delivered/read)" },
];

function webhookPathFor(ctx: TenantContext, channelId: string): string {
  return `/api/v1/channels/whatsapp/webhooks/${ctx.tenantId}/${channelId}`;
}

function toStatusDto(ctx: TenantContext, channelId: string, account: MetaBusinessAccountRow, gatewayBaseUrl: string): WhatsAppWebhookStatusDto {
  // Only ever advertise a subscription as "active" once the connector itself is
  // healthy AND the webhook has verified at least once — never optimistically
  // "subscribed: true" for a channel that has never proven it can receive a
  // delivery (mirrors QA D2's "no optimistic Connected badge" discipline).
  const subscriptionsActive = account.status === "Connected" && account.webhookVerificationStatus === "Verified";
  return {
    webhookUrl: `${gatewayBaseUrl.replace(/\/$/, "")}${webhookPathFor(ctx, channelId)}`,
    verificationStatus: account.webhookVerificationStatus,
    verifiedAt: account.webhookVerifiedAt ? account.webhookVerifiedAt.toISOString() : null,
    lastEventReceivedAt: account.lastEventReceivedAt ? account.lastEventReceivedAt.toISOString() : null,
    eventSubscriptions: SUPPORTED_EVENT_TYPES.map((e) => ({ ...e, subscribed: subscriptionsActive })),
  };
}

/** `GET` read model for the Webhook tab — no side effects. */
export async function getWebhookStatusDto(ctx: TenantContext, channelId: string, opts: { gatewayBaseUrl?: string } = {}): Promise<WhatsAppWebhookStatusDto> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!account) throw new MetaBusinessAccountNotFoundError();
  return toStatusDto(ctx, channelId, account, opts.gatewayBaseUrl ?? process.env.NEXTBOT_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL);
}

/**
 * "Re-verify Challenge" action: performs a **real HTTP round trip** against this
 * deployment's actual Gateway Plane webhook GET route — the exact same code path
 * Meta itself calls during the one-time subscription handshake — using this
 * tenant's own vaulted verify token and a freshly-generated random challenge.
 * Success requires the route to echo the literal challenge string back with a
 * 200; anything else (network failure, mismatched token, non-200) is recorded as
 * `Failed`, never silently left showing a stale `Verified` badge.
 */
export async function reverifyWebhookChallenge(ctx: TenantContext, channelId: string, opts: { gatewayBaseUrl?: string } = {}): Promise<WhatsAppWebhookStatusDto> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!account) throw new MetaBusinessAccountNotFoundError();

  const gatewayBaseUrl = opts.gatewayBaseUrl ?? process.env.NEXTBOT_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL;
  const verifyToken = await resolveWebhookVerifyToken(ctx, channelId);
  const challenge = randomBytes(16).toString("hex");
  const url = new URL(`${gatewayBaseUrl.replace(/\/$/, "")}${webhookPathFor(ctx, channelId)}`);
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.verify_token", verifyToken);
  url.searchParams.set("hub.challenge", challenge);

  let verified = false;
  try {
    const response = await fetch(url, { method: "GET" });
    const body = await response.text();
    verified = response.ok && body === challenge;
  } catch {
    verified = false; // Network/transport failure — never thrown further, always recorded as Failed.
  }

  await updateWebhookVerificationStatus(ctx, account.id, verified ? "Verified" : "Failed");
  const refreshed = (await findMetaBusinessAccountByChannelId(ctx, channelId)) as MetaBusinessAccountRow;
  return toStatusDto(ctx, channelId, refreshed, gatewayBaseUrl);
}

/**
 * Called by the Gateway Plane's real `GET` webhook route (Meta's own
 * subscription handshake, not the admin "Re-verify Challenge" action above) the
 * moment `hub.challenge` is genuinely echoed back — records that this tenant's
 * webhook has proven it can complete the real handshake at least once.
 */
export async function markWhatsAppWebhookVerified(ctx: TenantContext, channelId: string): Promise<void> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!account) return; // Not (yet) linked — nothing to mark.
  await updateWebhookVerificationStatus(ctx, account.id, "Verified");
}

/** Called by the Gateway Plane's real `GET` webhook route when Meta's handshake
 * fails this tenant's own verify-token check. */
export async function markWhatsAppWebhookVerificationFailed(ctx: TenantContext, channelId: string): Promise<void> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!account) return;
  await updateWebhookVerificationStatus(ctx, account.id, "Failed");
}

/** Called by the Gateway Plane's real `POST` webhook route on every signature-
 * verified delivery (any event kind) — backs the Webhook tab's "last event
 * received" timestamp. */
export async function markWhatsAppWebhookEventReceived(ctx: TenantContext, channelId: string): Promise<void> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!account) return;
  await updateLastEventReceivedAt(ctx, account.id);
}
