import { NextResponse, type NextRequest } from "next/server";
import { requireActiveBreakglassTenantContext } from "@nextbot/tenancy";
import { getEscalationDetail } from "@nextbot/escalations";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/internal/ops/tenants/:id/breakglass/escalations/:escalationId` — Target
 * Architecture Blueprint Phase 20 (BL-52, FR-ADM-09). Reuses `getEscalationDetail`
 * verbatim. Deliberately narrower than the tenant admin's own `escalations/[id]`
 * composition-root route: this endpoint does NOT additionally join
 * `@nextbot/orchestration`'s `tool_call` rows for the `aiAttempts` list — a disclosed
 * narrowing (see this phase's plan doc, disclosed design decision #5), kept to what
 * `getEscalationDetail` itself already returns (transcript excerpt, CSAT, routing).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; escalationId: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const { id, escalationId } = await params;
  try {
    const access = await requireActiveBreakglassTenantContext(id);
    if (!access) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
    }
    const detail = await getEscalationDetail(access.ctx, escalationId);
    if (!detail) {
      return NextResponse.json({ type: "about:blank", title: "Escalation not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json({ ...detail, row: undefined });
  } catch (err) {
    return problemResponse(err);
  }
}

export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
