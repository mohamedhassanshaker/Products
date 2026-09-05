import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SetIdentityResolutionPolicyRequestSchema } from "@nextbot/contracts";
import { getIdentityResolutionPolicy, setIdentityResolutionPolicyEnabled } from "@nextbot/tenancy";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET/PATCH /api/v1/admin/settings/identity-resolution-policy` (RBAC:
 * security_settings — same capability `data-policy`/`branding`/`dsr` already use for
 * tenant-wide administrative settings). Target Architecture Blueprint Phase 19
 * (BL-50, FR-OC-08) — the tenant's cross-channel identity-linking opt-in, OFF by
 * default; only an explicit admin PATCH here (or the seeded default) ever changes it.
 */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  const policy = await getIdentityResolutionPolicy(guard.ctx);
  return NextResponse.json({ policy });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetIdentityResolutionPolicyRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid identity-resolution-policy request.", status: 422 }, { status: 422 });
  }
  try {
    await setIdentityResolutionPolicyEnabled(guard.ctx, body.enabled);
    const policy = await getIdentityResolutionPolicy(guard.ctx);
    return NextResponse.json({ policy });
  } catch (err) {
    return problemResponse(err);
  }
}
