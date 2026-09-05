import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SetAgentMaxConcurrentRequestSchema } from "@nextbot/contracts";
import { setAgentMaxConcurrent } from "@nextbot/escalations";
import { findUserById } from "@nextbot/iam";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `PATCH /api/v1/admin/agent-presence/{userId}` (RBAC: escalations=Write) — Target
 * Architecture Blueprint Phase 13 (BL-45, FR-ESC-05). An admin-level action (any
 * `escalations:Write` holder — the same broad "can act on any agent's escalation"
 * privilege `claim`/`reassign` already carry in this module) configuring another
 * agent's concurrency ceiling. **Ownership check**: `userId` comes from the URL path
 * (client-supplied) — `findUserById` is tenant-scoped (RLS), so a cross-tenant id
 * resolves to `null` and is rejected here rather than silently creating a
 * cross-tenant `agent_presence` row (which no FK on that table would otherwise catch,
 * since `app_user.id` is globally unique regardless of tenant).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;
  const { userId } = await params;

  const target = await findUserById(guard.ctx, userId);
  if (!target) {
    return NextResponse.json({ type: "about:blank", title: "Agent not found.", status: 404 }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetAgentMaxConcurrentRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid concurrency-ceiling request.", status: 422 }, { status: 422 });
  }

  try {
    const presence = await setAgentMaxConcurrent(guard.ctx, userId, body.maxConcurrent);
    return NextResponse.json(presence);
  } catch (err) {
    return problemResponse(err);
  }
}
