import { NextResponse, type NextRequest } from "next/server";
import { getWebhookStatusDto } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/channels/:channelId/whatsapp/webhook` — QA D1 fix: the
 * Webhook tab's read model (screen inventory B.2.3). Read-only, no side effects —
 * `channels=Read` is sufficient (matches the account/WABA GET route's own
 * RBAC level, unlike the mutating "Re-verify Challenge" action below it).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }): Promise<Response> {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  try {
    const status = await getWebhookStatusDto(guard.ctx, channelId);
    return NextResponse.json({ status });
  } catch (err) {
    return problemResponse(err);
  }
}
