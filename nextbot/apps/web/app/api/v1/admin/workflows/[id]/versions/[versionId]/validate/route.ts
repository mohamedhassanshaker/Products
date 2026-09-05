import { NextResponse, type NextRequest } from "next/server";
import { handleValidateWorkflowVersion } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/workflows/{id}/versions/{versionId}/validate` (RBAC:
 * `agent_platform=Read` — a dry run that writes nothing).
 *
 * Runs every V1-V12 rule WITHOUT saving — unlike `teams`' identical-shaped
 * endpoint, there is no strict/non-strict split here: every rule in this build is
 * fail-closed both here and on the real save (LLD §14.6.3 assigns no rule a
 * "warning-only" severity the way FR-ORC-03's router-class check gets for teams).
 *
 * Takes raw YAML (not a parsed artifact) so a YAML syntax error is reported by the
 * same validator the save path uses, rather than being swallowed by the route's
 * own `request.json()`. `{id}` may be the literal `"new"` placeholder the editor
 * uses before a workflow exists yet — the handler falls back to a generic label
 * in that case (never persisted, used only for the human-readable scope label).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.yaml !== "string") {
    return NextResponse.json({ type: "about:blank", title: "Invalid validate payload — expected { yaml: string }.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleValidateWorkflowVersion(guard.ctx, id, body.yaml));
  } catch (err) {
    return problemResponse(err);
  }
}
