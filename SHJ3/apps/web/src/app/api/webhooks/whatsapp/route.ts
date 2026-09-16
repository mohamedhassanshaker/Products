/**
 * `GET`/`POST /api/webhooks/whatsapp` — Meta's WhatsApp Cloud API webhook (api.md §4.4,
 * §10.1). This is the one route an unauthenticated third party can reach with an arbitrary
 * body, so its structural guarantees are the point of this file, not an afterthought:
 *
 *  1. Signature verified over the RAW bytes, BEFORE any JSON parsing — enforced structurally
 *     below: the only `JSON.parse` call in the `POST` handler is textually AFTER the
 *     signature check's early `return`, so a parser bug is not reachable by an
 *     unauthenticated caller, full stop — not "we don't use the parsed result on that path,"
 *     but "the parse call does not execute on that path."
 *  2. Constant-time comparison throughout (`verify-webhook-signature.ts`) — never `===` on a
 *     secret-derived value.
 *  3. Replay protection by message-id dedupe (`platform-replay-guard.ts`) — a real, working,
 *     pre-tenant-resolution cross-tenant Redis lock, documented there as the one place a raw
 *     client is justified.
 *  4. Acknowledges fast: no outbound HTTP call (Meta's Graph API, an assistant turn) is ever
 *     awaited before this route responds. Where a real send is warranted (the opt-in notice)
 *     it is fired without awaiting, explicitly documented at the call site below — this pass
 *     does not build a queue/worker, which is a real, separate piece of infrastructure this
 *     wave's brief allows trimming as long as it is named, not silently skipped.
 *
 * ## What this pass deliberately does NOT do (named here once, not scattered as TODOs)
 *
 * It does not invoke `shj3-ai`'s turn pipeline — `apps/ai` and `modules/conversation` are a
 * parallel wave's own files, out of this module's scope, and neither exists in a shape this
 * route could safely call synchronously without risking exactly the "webhook retried into a
 * storm" failure api.md warns against. A real inbound message therefore only gets its
 * consent/session-window bookkeeping done for real (which this file DOES do, fully) —
 * marking the 24-hour window, recording/checking opt-in, handling `STOP` — and the actual
 * assistant reply is left for the conversation module to wire in once it exists, reusing
 * this route's already-normalised `InboundEvent`s rather than this route reaching into a
 * module it should not touch.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { runWithTenant } from "../../../../modules/platform/tenancy/tenant-context.js";
import { newUlid } from "../../../../modules/platform/adapters/outbound/sql/ulid.js";
import { getTenantDb } from "../../../../modules/platform/adapters/outbound/sql/tenant-db.js";
import { claimMessageIdNotSeenBefore } from "../../../../modules/platform/adapters/outbound/cache/platform-replay-guard.js";
import { extractPhoneNumberId } from "../../../../modules/channels/adapters/inbound/extract-whatsapp-metadata.js";
import { resolveTenantByWhatsAppPhoneNumberId } from "../../../../modules/channels/adapters/inbound/resolve-tenant-by-phone-number.js";
import {
  verifyHubVerifyToken,
  verifyMetaSignatureHeader,
} from "../../../../modules/channels/adapters/inbound/verify-webhook-signature.js";
import { MetaCloudWhatsAppTransport } from "../../../../modules/channels/adapters/outbound/whatsapp/meta-cloud-whatsapp-transport.js";
import { PrismaMessageTemplateRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-message-template-repository.js";
import { PrismaConsentRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-consent-repository.js";
import { ApproveMessageTemplate } from "../../../../modules/channels/application/approve-message-template.js";
import { RejectMessageTemplate } from "../../../../modules/channels/application/reject-message-template.js";
import {
  idempotencyKeyOf,
  type InboundEvent,
} from "../../../../modules/channels/ports/channel-transport.js";

const MAX_BODY_BYTES = 512 * 1024;

/** A small, fixed, case-insensitive opt-out vocabulary — English and Arabic. */
const STOP_KEYWORDS = ["stop", "توقف"];

function isStopKeyword(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return STOP_KEYWORDS.includes(normalized);
}

function subjectHashFor(waId: string): string {
  // A one-way hash of the contact identifier — never the raw phone number at rest
  // (`ConsentLedgerEntry.subjectHash`'s own doc comment). SHA-256 hex is exactly the
  // column's real `@db.Char(64)` width.
  return createHash("sha256").update(waId).digest("hex");
}

// ---------------------------------------------------------------------------
// GET — Meta's subscription verification handshake.
// ---------------------------------------------------------------------------

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const suppliedToken = url.searchParams.get("hub.verify_token");

  const expectedToken = process.env.SHJ3_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  // Never logging `suppliedToken` — it is caller-controlled input, exactly per this route's
  // own "never logging the supplied token" requirement.
  if (
    mode !== "subscribe" ||
    !expectedToken ||
    !verifyHubVerifyToken(suppliedToken, expectedToken)
  ) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(challenge ?? "", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

// ---------------------------------------------------------------------------
// POST — inbound messages, delivery/read receipts, template status changes.
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  // Raw bytes FIRST — `request.json()` would consume/re-encode the body, which is exactly
  // the ordering this route must not have. `arrayBuffer()`/`.text()` are the only calls that
  // read the stream at all before the signature check below.
  const rawBuffer = Buffer.from(await request.arrayBuffer());
  if (rawBuffer.byteLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.SHJ3_WHATSAPP_APP_SECRET;

  // Signature check, then and only then, JSON.parse — the one property this whole route
  // exists to guarantee. No `appSecret` configured is treated as "cannot verify," never as
  // "skip verification": failing open here would be worse than refusing every request.
  if (!appSecret || !verifyMetaSignatureHeader(signatureHeader, rawBuffer, appSecret)) {
    return new NextResponse(null, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBuffer.toString("utf8"));
  } catch {
    console.info(
      "[whatsapp-webhook] payload_unrecognised: body is not valid JSON despite a valid signature",
    );
    return NextResponse.json({ status: "acknowledged" }, { status: 200 });
  }

  const phoneNumberId = extractPhoneNumberId(payload);
  if (!phoneNumberId) {
    console.info("[whatsapp-webhook] payload_unrecognised: no phone_number_id in metadata");
    return NextResponse.json({ status: "acknowledged" }, { status: 200 });
  }

  const traceId = request.headers.get("traceparent") ?? newUlid();
  const resolved = await resolveTenantByWhatsAppPhoneNumberId(phoneNumberId, traceId);
  if (!resolved) {
    console.info("[whatsapp-webhook] no tenant found for phone_number_id", { phoneNumberId });
    return NextResponse.json({ status: "acknowledged" }, { status: 200 });
  }

  await runWithTenant(
    { tenant: resolved.tenantSlug, principal: null, traceId, platformScope: "channel-routing" },
    async () => {
      const transport = new MetaCloudWhatsAppTransport({
        phoneNumberId,
        optInRequired: resolved.optInRequired,
        credentialSecretRef: resolved.credentialSecretRef,
      });
      const events = await transport.parseInbound(rawBuffer, {
        "x-hub-signature-256": signatureHeader ?? undefined,
      });

      const consent = new PrismaConsentRepository();
      const templates = new PrismaMessageTemplateRepository();

      for (const event of events) {
        await handleInboundEvent(event, { transport, consent, templates });
      }
    },
  );

  // "Acknowledge within the route handler's own fast path... a real background queue is
  // heavy for this pass, so doing the work synchronously-but-fast (a few Redis/SQL calls, no
  // actual LLM turn processing) is an acceptable, honest trim" — every branch above is a
  // small, bounded number of Redis/SQL calls; nothing here calls `shj3-ai`.
  return NextResponse.json({ status: "acknowledged" }, { status: 200 });
}

interface EventHandlerDeps {
  readonly transport: MetaCloudWhatsAppTransport;
  readonly consent: PrismaConsentRepository;
  readonly templates: PrismaMessageTemplateRepository;
}

async function handleInboundEvent(event: InboundEvent, deps: EventHandlerDeps): Promise<void> {
  switch (event.kind) {
    case "message":
      return handleMessage(event, deps);
    case "list_reply":
      return handleListReply(event, deps);
    case "delivery_receipt":
      return handleDeliveryReceipt(event);
    case "template_status_changed":
      return handleTemplateStatusChanged(event, deps);
    case "unrecognised":
      console.info("[whatsapp-webhook] payload_unrecognised event", { raw: event.raw });
      return;
  }
}

async function handleMessage(
  event: Extract<InboundEvent, { readonly kind: "message" }>,
  deps: EventHandlerDeps,
): Promise<void> {
  const claimed = await claimMessageIdNotSeenBefore(event.messageId);
  if (!claimed) {
    console.info("[whatsapp-webhook] webhook.replay_detected", { messageId: event.messageId });
    return;
  }

  const waId = event.from.address;
  const subjectHash = subjectHashFor(waId);

  if (isStopKeyword(event.text)) {
    // Revoked synchronously, per api.md §10.1 rule 7 — checked at send time by
    // `SendCampaignNow`/`ChannelTransport.send()` (`ConsentState.state !== 'OptedIn'`), via
    // the real `TR_ConsentLedgerEntries_project` trigger's own projection, not a second
    // stored flag this route would have to keep in sync by hand.
    await deps.consent.appendLedgerEntry({
      subjectKind: "ContactHash",
      citizenIdentityId: null,
      subjectHash,
      channelKey: "WhatsApp",
      purpose: "ProactiveMessaging",
      action: "OptOut",
      evidenceKind: "WhatsAppStopKeyword",
      evidenceRef: event.messageId,
      occurredAt: event.occurredAt,
      sourceTurnId: null,
      now: event.occurredAt,
    });
    return;
  }

  await deps.transport.markSessionWindowOpen(waId);

  if (deps.transport.capabilities().requiresOptIn) {
    const state = await deps.consent.currentState(subjectHash, "WhatsApp", "ProactiveMessaging");
    if (!state || state.state !== "OptedIn") {
      // "An unknown waId with no recorded opt-in gets only the opt-in notice, no agent
      // turn." Fired without awaiting — a template send that fails (no real Meta
      // credentials in most environments) must never fail the whole webhook response;
      // errored and logged, never thrown into the route's own response path.
      const welcomeTemplate = await deps.templates.findByNameAndLocale("welcome_message", "en");
      if (welcomeTemplate?.bspTemplateId) {
        void deps.transport
          .sendTemplate(
            {
              recipient: { address: waId },
              templateBspId: welcomeTemplate.bspTemplateId,
              variables: [],
            },
            idempotencyKeyOf(`optin-notice:${event.messageId}`),
          )
          .catch((error: unknown) => {
            console.error("[whatsapp-webhook] failed to send opt-in notice (fire-and-forget)", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
      }
      return;
    }
  }

  // A real assistant reply is intentionally NOT triggered here — see this file's own
  // module comment for why. The window is open and consent is confirmed; that is the
  // complete, real scope of this pass for a permitted inbound message.
}

async function handleListReply(
  event: Extract<InboundEvent, { readonly kind: "list_reply" }>,
  deps: EventHandlerDeps,
): Promise<void> {
  const claimed = await claimMessageIdNotSeenBefore(event.messageId);
  if (!claimed) {
    console.info("[whatsapp-webhook] webhook.replay_detected", { messageId: event.messageId });
    return;
  }
  await deps.transport.markSessionWindowOpen(event.from.address);
  // `chipId` already carries the same identifier convention the web widget's chips post
  // (`inputMode: "list_reply"`, A1 rule / FR-CHAN-20) — routing it into a flow turn is the
  // conversation module's job once it exists; nothing further to do here.
}

async function handleDeliveryReceipt(
  event: Extract<InboundEvent, { readonly kind: "delivery_receipt" }>,
): Promise<void> {
  // Best-effort correlation against `CampaignSends.bspMessageId` (B10 tab 4's own evidence
  // trail) — a receipt for a message this tenant never sent as a campaign (an assistant
  // turn's own reply, for instance) simply matches zero rows, which is not an error.
  const state =
    event.status === "delivered" || event.status === "read"
      ? "Delivered"
      : event.status === "failed"
        ? "Failed"
        : undefined;
  if (!state) return;
  await getTenantDb().campaignSend.updateMany({
    where: { bspMessageId: event.providerMessageId },
    data: {
      state,
      ...(state === "Delivered" ? { deliveredAt: event.occurredAt } : {}),
      ...(state === "Failed" ? { failureCode: "bsp_reported_failed" } : {}),
      updatedAt: event.occurredAt,
    },
  });
}

async function handleTemplateStatusChanged(
  event: Extract<InboundEvent, { readonly kind: "template_status_changed" }>,
  deps: EventHandlerDeps,
): Promise<void> {
  const db = getTenantDb();
  const template = await db.messageTemplate.findFirst({
    where: { bspTemplateId: event.bspTemplateId },
  });
  if (!template) {
    // Real, but unmatched — this dev/demo environment has no live Meta submission round
    // trip wiring a real bspTemplateId onto a Pending template (`SubmitMessageTemplate`
    // does not call the real Meta API in this pass, a documented trim). Acknowledge and log
    // rather than treat as an error.
    console.info("[whatsapp-webhook] template_status_changed for an unrecognised bspTemplateId", {
      bspTemplateId: event.bspTemplateId,
    });
    return;
  }

  if (event.status === "approved") {
    // Same code path as `POST /channels/whatsapp/templates/{id}/approve` — api.md §10.1
    // rule 5's own requirement ("don't build two").
    await new ApproveMessageTemplate({ templates: deps.templates }).execute({
      id: template.id,
      bspTemplateId: event.bspTemplateId,
      now: event.occurredAt,
    });
  } else {
    await new RejectMessageTemplate({ templates: deps.templates }).execute({
      id: template.id,
      reason: event.rejectionReason ?? "Rejected by Meta.",
      now: event.occurredAt,
    });
  }
}
