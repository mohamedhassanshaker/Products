import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateBreakglassGrantRequestSchema } from "@nextbot/contracts";
import { createBreakglassGrant, listBreakglassGrants } from "@nextbot/tenancy";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET/POST /api/v1/admin/breakglass-grants` (RBAC: security_settings) — Target
 * Architecture Blueprint Phase 20 (BL-52, FR-ADM-09). `GET` lists every grant this
 * tenant has ever created (active, revoked, or expired), newest first, for the
 * Break-Glass Access settings screen's history view. `POST` is the tenant admin's
 * explicit consent action — there is no other way for a NextBot Platform Operator to
 * gain scoped access to this tenant's data.
 */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ grants: await listBreakglassGrants(guard.ctx) });
}

export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateBreakglassGrantRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid break-glass grant request.", status: 422 }, { status: 422 });
  }

  try {
    const grant = await createBreakglassGrant(guard.ctx, {
      grantedByUserId: guard.session.userId,
      reason: body.reason,
      expiresInHours: body.expiresInHours,
    });
    return NextResponse.json({ grant }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
