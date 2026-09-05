import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { RecordConsentRequestSchema } from "@nextbot/contracts";
import { handleListConsentRecords, handleRecordConsent } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET` — the masked consent log (§7.2.5). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  const records = await handleListConsentRecords(guard.ctx, channelId);
  return NextResponse.json({ records });
}

/** `POST` — record a single consent entry (manual admin entry, distinct from bulk import). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(RecordConsentRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid consent payload.", status: 422 }, { status: 422 });
  }

  try {
    const record = await handleRecordConsent(guard.ctx, channelId, body);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.consent.record",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Success",
      details: { state: body.state, source: body.source },
    });
    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
