import { NextResponse, type NextRequest } from "next/server";
import { handleStructuralDiffVersions } from "@nextbot/skills";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/skills/:id/versions/diff?from&to` (RBAC: agent_platform=Read)
 * — ADR-0016's Git-independent structural diff (FR-AGT-19), reused verbatim from
 * `@nextbot/yaml-diff` (never a second diff mechanism). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  await params; // skill id itself isn't needed once we have both version ids
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ type: "about:blank", title: "Both 'from' and 'to' version ids are required.", status: 422 }, { status: 422 });
  }
  try {
    const changes = await handleStructuralDiffVersions(guard.ctx, from, to);
    return NextResponse.json({ changes });
  } catch (err) {
    return problemResponse(err);
  }
}
