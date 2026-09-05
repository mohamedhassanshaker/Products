import { NextResponse } from "next/server";
import { handleGetSkill } from "@nextbot/skills";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/skills/:id` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ skill: await handleGetSkill(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}
