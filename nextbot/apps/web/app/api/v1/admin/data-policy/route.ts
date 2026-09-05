import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateTenantDataPolicyRequestSchema } from "@nextbot/contracts";
import { getTenantDataPolicy, updateTenantDataPolicy } from "@nextbot/tenancy";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET/PATCH /api/v1/admin/data-policy` (RBAC: security_settings, B.8.4's
 * Retention & Residency settings — extends the Phase 1 `tenant_data_policy` row). */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  const policy = await getTenantDataPolicy(guard.ctx);
  return NextResponse.json({ policy });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateTenantDataPolicyRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid retention/residency request.", status: 422 }, { status: 422 });
  }
  try {
    const policy = await updateTenantDataPolicy(guard.ctx, body);
    return NextResponse.json({ policy });
  } catch (err) {
    return problemResponse(err);
  }
}
