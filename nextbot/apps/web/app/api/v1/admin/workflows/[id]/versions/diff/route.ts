import { NextResponse, type NextRequest } from "next/server";
import { handleDiffWorkflowVersions } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/workflows/{id}/versions/diff?from=&to=` (RBAC:
 * `agent_platform=Read`) — LLD §14.6.4.
 *
 * The structural (Git-independent) diff, reused verbatim from `@nextbot/yaml-diff`
 * (ADR-0016/Phase 0's own baseline) — never a second diff mechanism, the same
 * precedent `skills`' identical endpoint already set.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ type: "about:blank", title: "Both 'from' and 'to' version ids are required.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleDiffWorkflowVersions(guard.ctx, from, to));
  } catch (err) {
    return problemResponse(err);
  }
}
