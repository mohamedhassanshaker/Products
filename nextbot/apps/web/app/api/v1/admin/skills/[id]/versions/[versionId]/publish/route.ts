import { NextResponse } from "next/server";
import { handlePublishVersion } from "@nextbot/skills";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/skills/:id/versions/:versionId/publish` (RBAC:
 * agent_platform=Write). A skill version is never *deployed* — publishing only
 * makes it the default a composer offers (LLD §14.5.1); it never runs a
 * promotion gate of its own. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;
  try {
    const version = await handlePublishVersion(guard.ctx, versionId, guard.session.userId);
    return NextResponse.json({ version });
  } catch (err) {
    return problemResponse(err);
  }
}
