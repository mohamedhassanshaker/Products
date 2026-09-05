import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateWebhookSubscriptionRequestSchema } from "@nextbot/contracts";
import { handleListWebhookSubscriptions, handleCreateWebhookSubscription } from "@nextbot/webhooks";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — outbound webhook
 * subscription management, gated under `security_settings` (the same module
 * branding/PII/data-policy/SSO already use for tenant-wide security/ops config — no
 * dedicated RBAC module exists for this, disclosed in the plan doc).
 *
 * `GET /api/v1/admin/webhooks` (RBAC: security_settings=Read).
 */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ subscriptions: await handleListWebhookSubscriptions(guard.ctx) });
}

/** `POST /api/v1/admin/webhooks` (RBAC: security_settings=Write) — the signing
 * secret is returned exactly once in this response and never again. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateWebhookSubscriptionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid webhook subscription payload.", status: 422 }, { status: 422 });
  }
  try {
    const result = await handleCreateWebhookSubscription(guard.ctx, body, guard.session.userId);
    return NextResponse.json(
      { id: result.subscription.id, targetUrl: result.subscription.targetUrl, eventCategories: result.subscription.eventCategories, signingSecret: result.signingSecret, enabled: result.subscription.enabled },
      { status: 201 },
    );
  } catch (err) {
    return problemResponse(err);
  }
}
