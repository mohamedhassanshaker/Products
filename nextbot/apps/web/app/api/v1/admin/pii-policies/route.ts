import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SetPiiPolicyRequestSchema } from "@nextbot/contracts";
import { listPiiPolicies, setPiiPolicy } from "@nextbot/pii";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET/POST /api/v1/admin/pii-policies` (RBAC: security_settings, FR-SEC-04's
 * masking-context matrix authoring — B.8.4's PII policy screen). `POST` upserts one
 * matrix cell `(entityType, context, trustLevel) -> action`. */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ policies: await listPiiPolicies(guard.ctx) });
}

export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetPiiPolicyRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid PII policy request.", status: 422 }, { status: 422 });
  }
  try {
    await setPiiPolicy(guard.ctx, body.entityType, body.context, body.trustLevel, body.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
