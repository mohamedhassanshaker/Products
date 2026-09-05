import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { PromoteCanaryRequestSchema } from "@nextbot/contracts";
import { handlePromoteCanary } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/definitions/:id/deployments/promote-canary`
 * — FR-AGT-04's "Promote canary to 100%" (Phase 17, BL-48/BL-13, ADR-0019, LLD §15.7).
 *
 * RBAC: `agent_platform=Write`, the same level as promotion and emergency rollback.
 *
 * Collapses the current split onto one version. It runs the **same** Production-status
 * precondition a split change does — promoting a canary to 100% is a way to end a split
 * that only ever contained gated versions, never a way to hand full traffic to something
 * that skipped the gate. That is enforced in `traffic-split-service.ts`, not here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(PromoteCanaryRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid promote-canary request.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handlePromoteCanary(guard.ctx, id, body, guard.session.userId));
  } catch (err) {
    return problemResponse(err);
  }
}
