import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateAgentQueueRequestSchema } from "@nextbot/contracts";
import { listAgentQueues, createAgentQueue, ensureDefaultQueue } from "@nextbot/escalations";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET/POST /api/v1/admin/escalation-queues` (RBAC: escalations Read/Write) — B.5.3's
 * backend-queue mapping list (LLD §5.8 `/queues`). `GET` also ensures the tenant's
 * required default queue exists (FR-ESC-03) so the routing config screen always has
 * at least one queue to reference, even before an admin has explicitly created one. */
export async function GET() {
  const guard = await requireApi("escalations", "Read");
  if (guard instanceof Response) return guard;
  await ensureDefaultQueue(guard.ctx);
  const queues = await listAgentQueues(guard.ctx);
  return NextResponse.json({ queues });
}

export async function POST(request: NextRequest) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateAgentQueueRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid queue request.", status: 422 }, { status: 422 });
  }

  try {
    const queue = await createAgentQueue(guard.ctx, body);
    return NextResponse.json(queue, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
