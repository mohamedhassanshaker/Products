import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateBrandingRequestSchema } from "@nextbot/contracts";
import { handleGetBranding, handleUpdateBranding } from "@nextbot/tenancy";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/branding` — current brand profile (RBAC: security_settings=Read). */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  const branding = await handleGetBranding(guard.ctx.tenantId);
  return NextResponse.json({ branding });
}

/** `PUT /api/v1/admin/branding` — update (RBAC: security_settings=Write). FR-ADM-07's
 * contrast gate runs inside `@nextbot/tenancy`'s `updateBranding()`; a failure there
 * surfaces as a 422 via `problemResponse` with the field-level detail intact. */
export async function PUT(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateBrandingRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid branding payload.", status: 422 }, { status: 422 });
  }

  try {
    const branding = await handleUpdateBranding(guard.ctx.tenantId, body);
    return NextResponse.json({ branding });
  } catch (err) {
    return problemResponse(err);
  }
}
