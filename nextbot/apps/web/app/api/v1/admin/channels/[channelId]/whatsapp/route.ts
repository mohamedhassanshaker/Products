import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { ConnectMetaBusinessAccountRequestSchema, SetWabaConfigRequestSchema } from "@nextbot/contracts";
import {
  handleGetMetaBusinessAccount,
  handleConnectMetaBusinessAccount,
  handleDisconnectMetaBusinessAccount,
  handleSetWabaConfig,
  handleWhatsAppChannelReadiness,
} from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET /api/v1/admin/channels/:channelId/whatsapp` — the connect-state + WABA
 * config (§7.2.1/§7.2.2 UX guidance) and readiness (FR-OC-03's "Activate" gate). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }): Promise<Response> {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  const [account, readiness] = await Promise.all([
    handleGetMetaBusinessAccount(guard.ctx, channelId),
    handleWhatsAppChannelReadiness(guard.ctx, channelId),
  ]);
  return NextResponse.json({ account, readiness });
}

/** `POST` — connect (§7.2.1). See `connectMetaBusinessAccount`'s doc for this
 * sandbox's disclosed System-User-token entry path (no real Meta App exists here). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(ConnectMetaBusinessAccountRequestSchema, { ...body, channelId })) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Meta Business Manager connect payload.", status: 422 }, { status: 422 });
  }

  try {
    const account = await handleConnectMetaBusinessAccount(guard.ctx, { ...body, channelId });
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.connect",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Success",
      details: { businessId: account.businessId },
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.connect",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}

/** `PATCH` — WABA config (WABA ID, 24h session-window warning toggle). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetWabaConfigRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid WABA config payload.", status: 422 }, { status: 422 });
  }

  try {
    const account = await handleSetWabaConfig(guard.ctx, channelId, body);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.waba_config.update",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Success",
      details: { wabaId: body.wabaId },
    });
    return NextResponse.json({ account });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE` — disconnect (§7.2.1's confirmable disconnect action). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;
  await handleDisconnectMetaBusinessAccount(guard.ctx, channelId);
  await recordAdminAudit(guard.ctx, {
    actorId: guard.session.userId,
    actorLabel: guard.session.userId,
    actionType: "whatsapp.disconnect",
    targetType: "Channel",
    targetId: channelId,
    outcome: "Success",
    details: {},
  });
  return NextResponse.json({ ok: true });
}
