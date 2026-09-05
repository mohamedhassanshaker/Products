import { NextResponse, type NextRequest } from "next/server";
import { requireActiveBreakglassTenantContext } from "@nextbot/tenancy";
import { listEscalationsForAdmin } from "@nextbot/escalations";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/internal/ops/tenants/:id/breakglass/escalations` — Target Architecture
 * Blueprint Phase 20 (BL-52, FR-ADM-09). Reuses `listEscalationsForAdmin` verbatim —
 * see the conversations list route's doc comment for the shared rationale (masking
 * parity as a structural, not re-implemented, guarantee).
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
    const escalations = await listEscalationsForAdmin(access.ctx);
    return NextResponse.json({ escalations });
  } catch (err) {
    return problemResponse(err);
  }
}

export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
