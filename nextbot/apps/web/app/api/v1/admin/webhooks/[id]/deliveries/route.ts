import { NextResponse } from "next/server";
import { handleListWebhookDeliveries } from "@nextbot/webhooks";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/webhooks/:id/deliveries` (RBAC: security_settings=Read) —
 * FR-API-02's own required "per-tenant delivery-log for debugging failed
 * deliveries," newest first. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ deliveries: await handleListWebhookDeliveries(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}
