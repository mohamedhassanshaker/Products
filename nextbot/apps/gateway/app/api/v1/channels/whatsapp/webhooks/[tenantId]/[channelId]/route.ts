import { NextResponse, type NextRequest } from "next/server";
import { resolveTenantById } from "@nextbot/tenancy";
import { checkRateLimit } from "../../../../../../../../src/lib/rate-limit.js";
import { rateLimitedResponse } from "../../../../../../../../src/lib/rate-limit-response.js";
import { problemResponse } from "../../../../../../../../src/lib/problem-response.js";
import { verifyWhatsAppWebhookSignature, verifyWhatsAppSubscriptionHandshake, processWhatsAppWebhookDelivery } from "../../../../../../../../src/lib/whatsapp-inbound.js";

/**
 * `GET/POST /api/v1/channels/whatsapp/webhooks/:tenantId/:channelId` (ADR-0004,
 * mirroring the Git webhook receiver's exact pattern) — the Gateway Plane's
 * WhatsApp inbound ingress (FR-META). `tenantId`/`channelId` in the path are
 * **routing only, never the security boundary** — the real authentication is:
 *  - `GET` (Meta's one-time webhook-subscription handshake): the request's
 *    `hub.verify_token` must match this tenant's own vaulted verify token before
 *    the `hub.challenge` value is echoed back.
 *  - `POST` (actual message/status deliveries): `X-Hub-Signature-256` HMAC,
 *    verified against this tenant's own vaulted Meta App Secret, computed over the
 *    exact raw request bytes — never trusts the payload before verifying it, same
 *    discipline as the Git webhook receiver this route's shape is copied from.
 */
const WEBHOOK_LIMIT = 120;
const WEBHOOK_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; channelId: string }> }) {
  const { tenantId, channelId } = await params;
  const tenant = await resolveTenantById(tenantId);
  if (!tenant) return NextResponse.json({ type: "about:blank", title: "Unknown tenant.", status: 404 }, { status: 404 });
  const ctx = { tenantId: tenant.id, region: tenant.region, environment: "Sandbox" as const };

  const url = new URL(request.url);
  const query = {
    "hub.mode": url.searchParams.get("hub.mode"),
    "hub.verify_token": url.searchParams.get("hub.verify_token"),
    "hub.challenge": url.searchParams.get("hub.challenge"),
  };

  try {
    const challenge = await verifyWhatsAppSubscriptionHandshake(ctx, channelId, { rawBody: "", headers: {}, query });
    if (challenge === null) {
      return NextResponse.json({ type: "about:blank", title: "Webhook verification failed.", status: 403 }, { status: 403 });
    }
    // Meta requires the raw `hub.challenge` string echoed back as the literal
    // response body (not JSON-wrapped) with a 200 status.
    return new NextResponse(challenge, { status: 200 });
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; channelId: string }> }) {
  const { tenantId, channelId } = await params;

  const rateLimit = await checkRateLimit(`whatsapp-webhook:${tenantId}:${channelId}`, WEBHOOK_LIMIT, WEBHOOK_WINDOW_SECONDS);
  if (!rateLimit.allowed) return rateLimitedResponse(WEBHOOK_WINDOW_SECONDS);

  const tenant = await resolveTenantById(tenantId);
  if (!tenant) return NextResponse.json({ type: "about:blank", title: "Unknown tenant.", status: 404 }, { status: 404 });
  const ctx = { tenantId: tenant.id, region: tenant.region, environment: "Sandbox" as const };

  const rawBody = await request.text();

  try {
    const verified = await verifyWhatsAppWebhookSignature(ctx, channelId, {
      rawBody,
      headers: { "x-hub-signature-256": request.headers.get("x-hub-signature-256") },
      query: {},
    });
    if (!verified) {
      return NextResponse.json({ type: "about:blank", title: "Invalid webhook signature.", status: 401 }, { status: 401 });
    }
    const result = await processWhatsAppWebhookDelivery(ctx, channelId, rawBody);
    return NextResponse.json({ ok: true, processed: result.processed });
  } catch (err) {
    return problemResponse(err);
  }
}
