import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { ActivateBreakglassAccessRequestSchema } from "@nextbot/contracts";
import { activateBreakglassAccess } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { PLATFORM_OPERATOR_ACTOR_LABEL } from "@/src/lib/platform-ops-auth";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/internal/ops/tenants/:id/breakglass/activate` — Target Architecture
 * Blueprint Phase 20 (BL-52, FR-ADM-09). The one auditable lifecycle event a
 * break-glass diagnosis session produces: writes a `platform_audit_log_entry` row
 * (operator's trail) AND, only when a currently active consent grant exists, a real
 * `domain_event` on the tenant's own trail (mirrored into their Audit Log by
 * `@nextbot/audit`'s existing sync job) — see `activateBreakglassAccess`'s own doc
 * comment for the full doubly-audited/fail-closed contract.
 *
 * **Fail-closed, the spec's own named hard requirement**: this denies the request
 * with 403 whenever no active grant exists for this tenant, regardless of the
 * operator's own role/token validity — `requirePlatformApi()` above only confirms
 * "this is a genuine platform operator call"; it is a SEPARATE, additional gate from
 * "does this tenant currently consent", and passing the first never substitutes for
 * the second.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(ActivateBreakglassAccessRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid break-glass activation request.", status: 422 }, { status: 422 });
  }

  const { id } = await params;
  try {
    const result = await activateBreakglassAccess(id, PLATFORM_OPERATOR_ACTOR_LABEL, body.reason);
    if (!result) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}

/** Every verb this route does not implement, claimed explicitly (NFR-11 established
 * precedent). */
export const GET = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
