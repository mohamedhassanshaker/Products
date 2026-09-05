import { NextResponse, type NextRequest } from "next/server";
import { handleListWhatsAppNumbers, handleSyncWhatsAppNumbers } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET` — the phone-number list + per-number messaging-tier gauge (§7.2.2). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  const numbers = await handleListWhatsAppNumbers(guard.ctx, channelId);
  return NextResponse.json({ numbers });
}

/** `POST` — "Sync phone numbers from Meta" (real Graph API `GET /{waba-id}/phone_numbers`). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  try {
    const numbers = await handleSyncWhatsAppNumbers(guard.ctx, channelId);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.numbers.sync",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Success",
      details: { count: numbers.length },
    });
    return NextResponse.json({ numbers });
  } catch (err) {
    return problemResponse(err);
  }
}
