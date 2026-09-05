import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { BulkConversationActionRequestSchema } from "@nextbot/contracts";
import { bulkApplyConversationAction } from "@nextbot/conversations";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `PATCH /api/v1/admin/conversations/bulk` (RBAC: conversations=Write) — U6 fix (QA
 * fix pass): the Conversation List's bulk "tag"/"archive" actions (screen inventory
 * B.4.1). Body validated against `BulkConversationActionRequestSchema` (never
 * hand-parsed) — `conversationIds` is capped at 200 server-side by the schema itself,
 * and every id is re-derived against `guard.ctx.tenantId` inside
 * `bulkApplyConversationAction`'s tenant-scoped query, so a client-supplied id for a
 * conversation belonging to a different tenant is silently excluded, never acted on.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireApi("conversations", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(BulkConversationActionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid bulk-action request.", status: 422 }, { status: 422 });
  }
  if (body.action === "tag" && !body.tag) {
    return NextResponse.json({ type: "about:blank", title: "A `tag` value is required for the tag action.", status: 422 }, { status: 422 });
  }

  const action = body.action === "tag" ? ({ kind: "tag", tag: body.tag! } as const) : ({ kind: "archive" } as const);
  const result = await bulkApplyConversationAction(guard.ctx, body.conversationIds, action);
  return NextResponse.json(result);
}
