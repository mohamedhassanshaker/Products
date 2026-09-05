import { NextResponse, type NextRequest } from "next/server";
import { handleStructuralDiffVersions } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/agent-platform/versions/structural-diff?a=:idA&b=:idB` (ADR-0016,
 * FR-AGT-19, BL-31) — the Git-independent structural diff. Deliberately a separate
 * route from `/versions/diff` (the real Git compare-API diff, ADR-0009): the two are
 * never blended into one response, so the console can label unambiguously which one
 * the caller is looking at. Works with zero `git_connection` rows for the tenant and
 * regardless of whether either version has a `git_commit_sha`.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const a = request.nextUrl.searchParams.get("a");
  const b = request.nextUrl.searchParams.get("b");
  if (!a || !b) {
    return NextResponse.json({ type: "about:blank", title: "Both 'a' and 'b' version ids are required.", status: 422 }, { status: 422 });
  }
  try {
    const changes = await handleStructuralDiffVersions(guard.ctx, a, b);
    return NextResponse.json({ changes });
  } catch (err) {
    return problemResponse(err);
  }
}
