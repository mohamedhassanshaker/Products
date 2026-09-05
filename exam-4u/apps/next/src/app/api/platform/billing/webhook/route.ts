import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { toErrorResponse } from '@/server/common/http/error-envelope';
import { getBillingWebhookService, WebhookSignatureInvalidError } from '@/server/platform/billing';

/**
 * `POST /api/platform/billing/webhook` — **unauthenticated** (migration plan Phase 2 sub-slice "2c",
 * FR-PKG-6), ported behavior from `legacy/api/src/platform/billing/api/billing-webhook.controller.ts`.
 * Guarded entirely by Stripe's own cryptographic signature verification (`stripe-signature` header),
 * never `withPlatformAuth` — the opposite guarding requirement from every other route under
 * `app/api/platform/**`. Already excluded from tenant-resolution middleware by the same `/api/platform`
 * path-prefix rule every other platform route relies on (`src/middleware.ts`).
 *
 * **Raw-body requirement (security-critical)**: Stripe's signature is computed over the exact bytes of
 * the request body. This Route Handler reads `request.text()` — Next.js Route Handlers, unlike
 * legacy's Nest+Express stack, never auto-parse the body at all, so the raw text read here is exactly
 * what Stripe signed, with no intermediate JSON-parse-then-reserialize step that could subtly alter
 * whitespace/key-order and break the HMAC comparison. This is the single most common pitfall porting a
 * Stripe webhook to Next.js Route Handlers — verified against a real, SDK-generated test signature (see
 * `docs/plans/nextjs-rewrite-phase2-plan.md`'s Sub-slice 2c "Verification evidence").
 *
 * A missing/malformed signature header (or an empty body) is rejected the same generic way as a
 * cryptographically invalid one — no distinct code path, no distinct message, so an attacker probing
 * this endpoint learns nothing about which failure mode they hit (mirrors legacy's identical
 * `WEBHOOK_SIGNATURE_INVALID` design).
 *
 * Always responds `200 {received: true}` for a successfully-verified event, even one whose *business*
 * outcome was "ignored" (an unknown event type, or one that couldn't be matched to any tenant
 * subscription) — per FR-PKG-6, so Stripe never retries a condition that will never resolve. Only a
 * signature-verification failure gets a non-200 (`401`).
 */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const routeLabel = 'POST /api/platform/billing/webhook';

  try {
    const signature = request.headers.get('stripe-signature');
    const rawBody = await request.text();
    if (!rawBody || typeof signature !== 'string') {
      throw new WebhookSignatureInvalidError();
    }

    const webhookService = await getBillingWebhookService();
    await webhookService.handle(rawBody, signature);
    return NextResponse.json({ received: true });
  } catch (err) {
    return toErrorResponse(err, requestId, routeLabel);
  }
}
