import { NextResponse, type NextRequest } from "next/server";
import { requireActiveBreakglassTenantContext } from "@nextbot/tenancy";
import { listConversationsForAdmin } from "@nextbot/conversations";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/internal/ops/tenants/:id/breakglass/conversations` — Target Architecture
 * Blueprint Phase 20 (BL-52, FR-ADM-09). Read-only diagnosis surface: reuses
 * `listConversationsForAdmin` **verbatim** — the exact function the tenant's own
 * Conversation List admin screen calls — with a `TenantContext` built from the active
 * grant (never the operator's own identity, which has none). Calling the
 * byte-identical function the tenant admin's own screen calls is what makes "an
 * operator sees no more than an equivalent-privilege tenant viewer would" a
 * structural guarantee rather than a second, independently-maintained masking
 * implementation.
 *
 * Fail-closed on every call, not just at `.../activate`: `requireActiveBreakglassTenantContext`
 * re-validates the grant is still active at the moment of THIS read — a mid-session
 * revocation takes effect on the very next call (see this phase's plan doc, disclosed
 * design decision #3). This read itself writes no audit entry (lifecycle events only).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const { id } = await params;
  try {
    const access = await requireActiveBreakglassTenantContext(id);
    if (!access) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
    }
    const { items, total } = await listConversationsForAdmin(access.ctx);
    return NextResponse.json({ conversations: items, total });
  } catch (err) {
    return problemResponse(err);
  }
}

/** Every verb this route does not implement, claimed explicitly (NFR-11 established
 * precedent) — this is a read-only diagnosis surface, so only GET is ever
 * meaningful. */
export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
