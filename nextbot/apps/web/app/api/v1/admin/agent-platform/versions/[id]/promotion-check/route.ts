import { NextResponse, type NextRequest } from "next/server";
import type { AgentVersionStatusValue } from "@nextbot/contracts";
import { handleCheckPromotionTarget } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

const VALID_TARGETS: AgentVersionStatusValue[] = ["Draft", "EvalGated", "HumanReview", "Approved", "Production", "Deprecated"];

/** `GET /api/v1/admin/agent-platform/versions/:id/promotion-check?target=X` (RBAC:
 * agent_platform=Read) — UX_GUIDELINES.md §6.4's "(?) why can't I promote this
 * further?" affordance: a read-only probe of the same `canPromote()` the promote
 * action itself enforces, for a target that `_allowedTransitions` doesn't currently
 * include, so the console can show the exact blocking reason. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const target = request.nextUrl.searchParams.get("target");
  if (!target || !VALID_TARGETS.includes(target as AgentVersionStatusValue)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid 'target' status.", status: 422 }, { status: 422 });
  }
  try {
    const result = await handleCheckPromotionTarget(guard.ctx, id, target as AgentVersionStatusValue, guard.session.userId);
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
