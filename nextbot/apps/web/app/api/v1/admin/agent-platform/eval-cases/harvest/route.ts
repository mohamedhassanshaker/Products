import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { HarvestEvalCaseRequestSchema } from "@nextbot/contracts";
import { handleHarvestEvalCase } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/eval-cases/harvest` (RBAC:
 * agent_platform=Write) — FR-AGT-16: promotes a conversation/escalation/
 * denied-Tier-3-approval into an eval case in one action, from its detail
 * view's own already-loaded transcript/expected-behavior pre-fill. This
 * request body itself IS the admin's confirmation — a case is never added
 * without it.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(HarvestEvalCaseRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid harvest-eval-case payload.", status: 422 }, { status: 422 });
  }
  try {
    const evalCase = await handleHarvestEvalCase(guard.ctx, body);
    return NextResponse.json({ case: evalCase }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
