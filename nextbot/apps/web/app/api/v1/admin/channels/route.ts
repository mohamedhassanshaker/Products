import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateChannelRequestSchema } from "@nextbot/contracts";
import { handleCreateWebWidgetChannel, handleCreateWhatsAppChannel, handleListChannels } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** Where this deployment's widget-embed static assets (the `nextbot.js` loader) are
 * genuinely served from — QA Final Review B3: the previous embed snippet hardcoded
 * `https://cdn.nextbot.io/widget.js`, a host that doesn't exist. `docker-compose.yml`
 * publishes the `widget-embed` service on `localhost:8080` for local/single-host
 * deployment; a real multi-host deployment sets `NEXTBOT_WIDGET_BASE_URL` to
 * wherever that container/CDN is actually reachable from a customer's browser. */
const DEFAULT_WIDGET_BASE_URL = "http://localhost:8080";

/** `GET /api/v1/admin/channels` — list (RBAC: channels=Read). Includes the tenant's
 * `slug` alongside each channel's `publicKey` so the UI can render a real, working
 * `NextBot.init({ tenantId, channelId })` embed snippet without a second round trip. */
export async function GET() {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const [channels, tenant] = await Promise.all([handleListChannels(guard.ctx), resolveTenantById(guard.ctx.tenantId)]);
  const widgetBaseUrl = process.env.NEXTBOT_WIDGET_BASE_URL ?? DEFAULT_WIDGET_BASE_URL;
  return NextResponse.json({ channels, tenantSlug: tenant?.slug ?? "", widgetBaseUrl });
}

/** `POST /api/v1/admin/channels` — create a channel (RBAC: channels=Write).
 * BL-15: `type` now selects between `WebWidget` (unchanged) and `WhatsApp` (new —
 * creates the channel shell only; Meta linking/WABA config happens via the
 * `/api/v1/admin/channels/whatsapp/**` sub-routes below, per FR-OC-03's
 * type-specific wizard). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateChannelRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid channel payload.", status: 422 }, { status: 422 });
  }

  try {
    const channel = body.type === "WhatsApp" ? await handleCreateWhatsAppChannel(guard.ctx, body) : await handleCreateWebWidgetChannel(guard.ctx, body);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "channel.create",
      targetType: "Channel",
      targetId: channel.id,
      outcome: "Success",
      details: { name: channel.name, type: channel.type, environment: channel.environment },
    });
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "channel.create",
      targetType: "Channel",
      targetId: null,
      outcome: "Failure",
      details: { name: (body as { name?: string }).name ?? null, error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
