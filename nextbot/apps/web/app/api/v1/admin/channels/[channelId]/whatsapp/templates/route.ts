import { NextResponse, type NextRequest } from "next/server";
import { handleListWhatsAppTemplates, handleSyncWhatsAppTemplates } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET` — the synced template table (§7.2.4). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  const templates = await handleListWhatsAppTemplates(guard.ctx, channelId);
  return NextResponse.json({ templates });
}

/** `POST` — "Sync from Meta" (real Graph API `GET /{waba-id}/message_templates`). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  try {
    const result = await handleSyncWhatsAppTemplates(guard.ctx, channelId);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.templates.sync",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Success",
      details: { synced: result.synced },
    });
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
