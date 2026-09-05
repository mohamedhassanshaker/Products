import { NextResponse } from "next/server";
import { handlePublishVersion } from "@nextbot/skills";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/external/skills/:id/versions/:versionId/publish` (RBAC:
 * agent_platform=Write). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;
  try {
    const version = await handlePublishVersion(guard.ctx, versionId, guard.session.userId);
    return NextResponse.json({ version });
  } catch (err) {
    return problemResponse(err);
  }
}
