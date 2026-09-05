import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpgradeConsumersRequestSchema } from "@nextbot/contracts";
import { handleUpgradeConsumers } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/skills/:id/upgrade-consumers` (RBAC: agent_platform=Write) —
 * ADR-0015 §2.4. Generates a new Draft agent version per stale consumer, re-pinned
 * to the target skill version; never promotes anything. Idempotent — a second call
 * with the same target creates nothing new for a consumer that already has a
 * pending upgrade draft.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpgradeConsumersRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid upgrade-consumers payload.", status: 422 }, { status: 422 });
  }
  try {
    const result = await handleUpgradeConsumers(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
