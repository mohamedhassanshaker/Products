import { NextResponse, type NextRequest } from "next/server";
import { getActiveBreakglassGrant, resolveTenantById } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/internal/ops/tenants/:id/breakglass/status` — Target Architecture
 * Blueprint Phase 20 (BL-52, FR-ADM-09). A read-only status check (no audit entry is
 * written — this is not itself an access attempt, just "is there consent right now"
 * for the ops console to render before an operator decides whether to activate
 * access). `null` `activeGrant` means `POST .../activate` would currently be denied.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const { id } = await params;
  try {
    const tenant = await resolveTenantById(id);
    if (!tenant) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
    }
    const grant = await getActiveBreakglassGrant({ tenantId: tenant.id, region: tenant.region, environment: "Sandbox" });
    return NextResponse.json({
      activeGrant: grant ? { grantId: grant.id, reason: grant.reason, expiresAt: grant.expiresAt } : null,
    });
  } catch (err) {
    return problemResponse(err);
  }
}

/** Every verb this route does not implement, claimed explicitly (NFR-11 established
 * precedent) so Next cannot answer with a route-existence-confirming response before
 * the guard runs. */
export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
