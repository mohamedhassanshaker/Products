import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateWebhookSubscriptionRequestSchema } from "@nextbot/contracts";
import { handleUpdateWebhookSubscription, handleDeleteWebhookSubscription } from "@nextbot/webhooks";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `PATCH /api/v1/admin/webhooks/:id` (RBAC: security_settings=Write) — target URL,
 * event categories, and enabled/disabled state. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateWebhookSubscriptionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid webhook subscription payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ subscription: await handleUpdateWebhookSubscription(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/webhooks/:id` (RBAC: security_settings=Write). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    await handleDeleteWebhookSubscription(guard.ctx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
