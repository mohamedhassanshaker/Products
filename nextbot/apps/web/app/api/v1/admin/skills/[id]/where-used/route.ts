import { NextResponse } from "next/server";
import { handleGetSkillWhereUsed } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/skills/:id/where-used` (RBAC: agent_platform=Read). LLD
 * §14.5.4 — implemented in `agent-platform` (it owns `agent_version_skill`), even
 * though the URL lives under `/skills` — the composition root wires both modules
 * together, same pattern the rest of this codebase already uses. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetSkillWhereUsed(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
