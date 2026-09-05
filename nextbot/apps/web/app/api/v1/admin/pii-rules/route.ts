import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreatePiiRuleRequestSchema } from "@nextbot/contracts";
import { createPiiRule, listPiiRules } from "@nextbot/pii";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET/POST /api/v1/admin/pii-rules` (RBAC: security_settings, FR-SEC-04's
 * detection-rule authoring). */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ rules: await listPiiRules(guard.ctx) });
}

export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreatePiiRuleRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid PII rule request.", status: 422 }, { status: 422 });
  }
  try {
    const rule = await createPiiRule(guard.ctx, body);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
