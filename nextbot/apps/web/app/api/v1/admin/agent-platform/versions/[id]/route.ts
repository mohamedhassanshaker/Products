import { NextResponse } from "next/server";
import { handleGetVersion } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/versions/:id` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ version: await handleGetVersion(guard.ctx, id, guard.session.userId) });
  } catch (err) {
    return problemResponse(err);
  }
}
