import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateSkillRequestSchema } from "@nextbot/contracts";
import { handleCreateSkill, handleListSkills } from "@nextbot/skills";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/skills` (RBAC: agent_platform=Read — spec §5.2's "Changed —
 * now also gates skills"). */
export async function GET(): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ skills: await handleListSkills(guard.ctx) });
}

/** `POST /api/v1/admin/skills` (RBAC: agent_platform=Write) — creates a skill with
 * a real version 1 (LLD §14.5.4). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateSkillRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid skill payload.", status: 422 }, { status: 422 });
  }
  try {
    const result = await handleCreateSkill(guard.ctx, body, guard.session.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
