import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { ReplaceRoutingRulesRequestSchema } from "@nextbot/contracts";
import { listRoutingRules, replaceRoutingRules } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET/PUT /api/v1/admin/escalation-routing-rules` (RBAC: escalations Read/Write) —
 * B.5.3's rules table (ordered full replace, LLD §5.8). */
export async function GET() {
  const guard = await requireApi("escalations", "Read");
  if (guard instanceof Response) return guard;
  const rules = await listRoutingRules(guard.ctx);
  return NextResponse.json({ rules });
}

export async function PUT(request: NextRequest) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(ReplaceRoutingRulesRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid routing rules request.", status: 422 }, { status: 422 });
  }

  try {
    const rules = await replaceRoutingRules(guard.ctx, body.rules);
    return NextResponse.json({ rules });
  } catch (err) {
    return problemResponse(err);
  }
}
