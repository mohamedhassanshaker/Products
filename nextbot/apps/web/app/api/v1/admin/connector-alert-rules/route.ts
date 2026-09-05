import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateConnectorAlertRuleRequestSchema } from "@nextbot/contracts";
import { createAlertRule, listAlertRulesForConnector } from "@nextbot/connectors";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET/POST /api/v1/admin/connector-alert-rules?connectorId=...` (RBAC:
 * connectors=Write for POST, Read for GET — B.3A.4's alert configuration). */
export async function GET(request: NextRequest) {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;
  const connectorId = request.nextUrl.searchParams.get("connectorId");
  if (!connectorId) {
    return NextResponse.json({ type: "about:blank", title: "connectorId query param is required.", status: 422 }, { status: 422 });
  }
  return NextResponse.json({ rules: await listAlertRulesForConnector(guard.ctx, connectorId) });
}

export async function POST(request: NextRequest) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateConnectorAlertRuleRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid alert rule request.", status: 422 }, { status: 422 });
  }
  try {
    const rule = await createAlertRule(guard.ctx, body);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
