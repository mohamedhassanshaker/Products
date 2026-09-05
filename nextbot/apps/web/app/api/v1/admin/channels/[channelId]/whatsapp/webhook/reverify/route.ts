import { NextResponse, type NextRequest } from "next/server";
import { reverifyWebhookChallenge } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `POST /api/v1/admin/channels/:channelId/whatsapp/webhook/reverify` — QA D1 fix:
 * the Webhook tab's "Re-verify Challenge" action. Mutating (re-triggers a real
 * handshake round trip against this deployment's own Gateway Plane and persists
 * the outcome) — gated on `channels=Write`, same as every other WhatsApp connector
 * mutation, and audited like the rest of this connector family (Final Review B4
 * discipline).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  try {
    const status = await reverifyWebhookChallenge(guard.ctx, channelId);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.webhook.reverify",
      targetType: "Channel",
      targetId: channelId,
      outcome: status.verificationStatus === "Verified" ? "Success" : "Failure",
      details: { verificationStatus: status.verificationStatus },
    });
    return NextResponse.json({ status });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.webhook.reverify",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
