import { NextResponse, type NextRequest } from "next/server";
import { requireActiveBreakglassTenantContext } from "@nextbot/tenancy";
import { getConversationDetailForAdmin } from "@nextbot/conversations";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/internal/ops/tenants/:id/breakglass/conversations/:conversationId` —
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09). Reuses
 * `getConversationDetailForAdmin` verbatim (see the sibling list route's doc comment
 * for why) — a conversation id belonging to another tenant resolves to 404 here
 * exactly as it does for the tenant's own admin route, since `access.ctx` scopes the
 * read via `withTenant`/RLS regardless of which tenant the grant belongs to.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; conversationId: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const { id, conversationId } = await params;
  try {
    const access = await requireActiveBreakglassTenantContext(id);
    if (!access) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
    }
    const conversation = await getConversationDetailForAdmin(access.ctx, conversationId);
    if (!conversation) {
      return NextResponse.json({ type: "about:blank", title: "Conversation not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json({ conversation });
  } catch (err) {
    return problemResponse(err);
  }
}

export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
