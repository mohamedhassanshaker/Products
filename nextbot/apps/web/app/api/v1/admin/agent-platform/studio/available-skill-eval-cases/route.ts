import { NextResponse, type NextRequest } from "next/server";
import { handleListAvailableSkillEvalCases } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/studio/available-skill-eval-cases` (RBAC:
 * agent_platform=Read) — Studio step 9's own read: every composed skill's own
 * `skill_version.eval_case_ids`, resolved to real case content, for the
 * checklist the admin edits before submitting the Evals step
 * (`includedSkillEvalCaseIds`). Body: `{ skillPins: string[] }` ("refund_
 * request@3" pins, mirroring `spec.skills`'s own shape).
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.skillPins) || !body.skillPins.every((p: unknown) => typeof p === "string")) {
    return NextResponse.json({ type: "about:blank", title: "Invalid request — expected { skillPins: string[] }.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ cases: await handleListAvailableSkillEvalCases(guard.ctx, body.skillPins) });
  } catch (err) {
    return problemResponse(err);
  }
}
