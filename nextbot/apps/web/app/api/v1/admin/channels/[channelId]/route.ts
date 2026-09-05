import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SetChannelAgentBindingRequestSchema } from "@nextbot/contracts";
import { findChannelById, handleSetChannelAgentBinding } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** Mirrors `GET /api/v1/admin/channels`'s `DEFAULT_WIDGET_BASE_URL` fallback (kept in
 * sync manually — no shared "apps-internal-lib" package exists for these two sibling
 * routes to share a constant from, same rationale as `apps/gateway`'s duplicated
 * `problemResponse`). */
const DEFAULT_WIDGET_BASE_URL = "http://localhost:8080";

/**
 * `GET /api/v1/admin/channels/:channelId` (RBAC: channels=Read) — Phase 6
 * (client-feedback-batch item 9). Single-channel lookup backing the new
 * `/channels/[channelId]/test` "test this channel" screen: it needs exactly one
 * channel's `publicKey`/`environment`/`type` plus the tenant's slug and this
 * deployment's widget base URL, the same three pieces of information
 * `GET /api/v1/admin/channels`'s list endpoint already assembles per row — this adds
 * the single-row equivalent rather than making the test page fetch the whole list
 * and filter client-side.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Read");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  try {
    const [channel, tenant] = await Promise.all([findChannelById(guard.ctx, channelId), resolveTenantById(guard.ctx.tenantId)]);
    if (!channel) {
      return NextResponse.json({ type: "about:blank", title: "Channel not found.", status: 404 }, { status: 404 });
    }
    const widgetBaseUrl = process.env.NEXTBOT_WIDGET_BASE_URL ?? DEFAULT_WIDGET_BASE_URL;
    return NextResponse.json({ channel, tenantSlug: tenant?.slug ?? "", widgetBaseUrl });
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * `PATCH /api/v1/admin/channels/:channelId` (RBAC: `channels=Write`) — Target Architecture
 * Blueprint Phase 17 (BL-48, ADR-0019 §2.2, LLD §15.7): the Channels screen's
 * **"Answered by"** agent-definition binding, the missing first hop of
 * `channel → agent definition → deployment traffic split → version`.
 *
 * `agentDefinitionId: null` is an explicitly settable value, not an omission: unbinding
 * returns the channel to the pre-Phase-17 tenant-wide fallback, which is a legitimate
 * configuration for a single-bot tenant and is exactly how every channel behaved before
 * this phase.
 *
 * The 404 pre-check is a UX nicety, not the security control: the underlying `UPDATE` is
 * `tenant_id`-predicated and RLS-scoped, so a cross-tenant `channelId` matches zero rows
 * and a cross-tenant `agentDefinitionId` fails the foreign key against rows this tenant's
 * session can see — neither can silently point one tenant's channel at another's bot.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetChannelAgentBindingRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid channel binding request.", status: 422 }, { status: 422 });
  }

  try {
    const channel = await findChannelById(guard.ctx, channelId);
    if (!channel) {
      return NextResponse.json({ type: "about:blank", title: "Channel not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json(await handleSetChannelAgentBinding(guard.ctx, channelId, body.agentDefinitionId));
  } catch (err) {
    return problemResponse(err);
  }
}
