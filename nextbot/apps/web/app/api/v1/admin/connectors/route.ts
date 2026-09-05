import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateConnectorRequestSchema } from "@nextbot/contracts";
import { handleCreateConnector, handleListConnectors } from "@nextbot/connectors";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET /api/v1/admin/connectors` — list (RBAC: connectors=Read). */
export async function GET() {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;
  const connectors = await handleListConnectors(guard.ctx);
  return NextResponse.json({ connectors });
}

/** `POST /api/v1/admin/connectors` — create (RBAC: connectors=Write). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateConnectorRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid connector payload.", status: 422 }, { status: 422 });
  }

  try {
    const connector = await handleCreateConnector(guard.ctx, body);
    // FR-ADM-03 (QA Final Review B4): connector CRUD must be audited with the
    // real acting admin as actor, not `system`.
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "connector.create",
      targetType: "Connector",
      targetId: connector.id,
      outcome: "Success",
      details: { name: connector.name, backendType: connector.backendType, environment: connector.environment },
    });
    return NextResponse.json({ connector }, { status: 201 });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "connector.create",
      targetType: "Connector",
      targetId: null,
      outcome: "Failure",
      details: { name: (body as { name?: string }).name ?? null, error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
