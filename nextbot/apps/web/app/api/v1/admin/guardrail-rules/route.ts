import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateGuardrailRuleRequestSchema } from "@nextbot/contracts";
import { createGuardrailRule, listGuardrailRules } from "@nextbot/pii";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET/POST /api/v1/admin/guardrail-rules` (RBAC: security_settings) — the full
 * guardrail authoring UI (Phase 17) superseding Phase 12's in-memory stub array. */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ rules: await listGuardrailRules(guard.ctx) });
}

export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateGuardrailRuleRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid guardrail rule request.", status: 422 }, { status: 422 });
  }
  try {
    const rule = await createGuardrailRule(guard.ctx, body);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
