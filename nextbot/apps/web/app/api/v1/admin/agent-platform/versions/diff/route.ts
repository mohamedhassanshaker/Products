import { NextResponse, type NextRequest } from "next/server";
import { handleDiffVersions } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/versions/diff?a=:idA&b=:idB` (RBAC:
 * agent_platform=Read) — FR-AGT-02's real provider compare-API diff. */
export async function GET(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const a = request.nextUrl.searchParams.get("a");
  const b = request.nextUrl.searchParams.get("b");
  if (!a || !b) {
    return NextResponse.json({ type: "about:blank", title: "Both 'a' and 'b' version ids are required.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleDiffVersions(guard.ctx, a, b));
  } catch (err) {
    return problemResponse(err);
  }
}
