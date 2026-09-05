import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { Type } from "@sinclair/typebox";
import { CreatePermissionRuleRequestSchema } from "@nextbot/contracts";
import { handleGetToolRules, handleUpdateToolRules } from "@nextbot/tool-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

const RulesArraySchema = Type.Array(CreatePermissionRuleRequestSchema);

/** `GET /api/v1/admin/tools/{id}/permissions` (RBAC: tool_permissions=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("tool_permissions", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const rules = await handleGetToolRules(guard.ctx, id);
  return NextResponse.json({ rules });
}

/** `PUT /api/v1/admin/tools/{id}/permissions` — replaces the ordered rule list
 * (RBAC: tool_permissions=Write). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("tool_permissions", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(RulesArraySchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid permission rule list.", status: 422 }, { status: 422 });
  }
  try {
    await handleUpdateToolRules(guard.ctx, id, body);
    // FR-ADM-03 (QA Final Review B4): permission-rule changes must be audited
    // with the real acting admin as actor.
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "tool_permission_rule.update",
      targetType: "Tool",
      targetId: id,
      outcome: "Success",
      details: { ruleCount: body.length },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "tool_permission_rule.update",
      targetType: "Tool",
      targetId: id,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
