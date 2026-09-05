import { NextResponse, type NextRequest } from "next/server";
import { handleActivateWhatsAppChannel } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `POST` — FR-OC-03's "Activate" action, blocked server-side (not just a UI hint)
 * until `whatsAppChannelReadiness` passes. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  try {
    const channel = await handleActivateWhatsAppChannel(guard.ctx, channelId);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.activate",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Success",
      details: {},
    });
    return NextResponse.json({ channel });
  } catch (err) {
    if (err instanceof Error && err.name === "WhatsAppChannelNotReadyError") {
      return NextResponse.json({ type: "about:blank", title: err.message, status: 409, code: "WHATSAPP_CHANNEL_NOT_READY" }, { status: 409 });
    }
    return problemResponse(err);
  }
}
