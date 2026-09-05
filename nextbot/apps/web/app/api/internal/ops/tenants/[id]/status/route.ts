import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateTenantStatusRequestSchema } from "@nextbot/contracts";
import { updateTenantStatus } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { PLATFORM_OPERATOR_ACTOR_LABEL } from "@/src/lib/platform-ops-auth";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `PATCH /api/internal/ops/tenants/:id/status` — the Tenant Detail screen's
 * status-change action (Platform Manager console Phase 2, NFR-11). Consequential
 * (e.g. suspending a tenant stops it being picked up by scheduled jobs), so the UI
 * gates it behind a confirm dialog before ever calling this endpoint — the server
 * side has no notion of "confirmed", it simply applies whatever valid status this
 * request carries.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!Value.Check(UpdateTenantStatusRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "Invalid status change request.", status: 422 },
      { status: 422 },
    );
  }

  const { id } = await params;
  try {
    // Platform Manager console Phase 1 precedent: attributed to the shared operator
    // actor label (see `platform-ops-auth.ts`'s doc comment for why this auth model
    // has no more specific per-operator identity to attribute to).
    const result = await updateTenantStatus(id, body.status, PLATFORM_OPERATOR_ACTOR_LABEL);
    if (!result) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * Every verb this route does not implement, claimed explicitly so Next cannot answer
 * it with a route-existence-confirming `405`/`OPTIONS: Allow` *before* the guard runs
 * (NFR-11, established Phase 1 precedent). `HEAD`/`GET` are intentionally omitted
 * since this route has no read side of its own.
 */
export const GET = apiMethodNotFoundHandler;
export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
