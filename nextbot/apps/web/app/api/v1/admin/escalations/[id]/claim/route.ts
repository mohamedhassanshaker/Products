import { NextResponse } from "next/server";
import { claimEscalation } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `POST /api/v1/admin/escalations/{id}/claim` (RBAC: escalations=Write) — FR-ESC-02
 * "Take Over" (LLD §5.8: `409 ESCALATION_ALREADY_CLAIMED` on a lost CAS-claim race,
 * so two agents clicking "Take Over" at the same instant resolve to exactly one
 * winner, never a duplicate assignment — see `claimEscalationTransition`'s doc). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    const escalation = await claimEscalation(guard.ctx, id, guard.session.userId);
    // FR-ADM-03 (QA Final Review B4): escalation claim/takeover must be audited
    // with the claiming agent as actor.
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "escalation.claim",
      targetType: "Escalation",
      targetId: escalation.id,
      outcome: "Success",
      details: {},
    });
    return NextResponse.json({ id: escalation.id, status: escalation.status });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "escalation.claim",
      targetType: "Escalation",
      targetId: id,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
