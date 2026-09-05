import { NextResponse } from "next/server";
import { handleGetVersion } from "@nextbot/skills";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/external/skills/:id/versions/:versionId` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;
  try {
    return NextResponse.json({ version: await handleGetVersion(guard.ctx, versionId) });
  } catch (err) {
    return problemResponse(err);
  }
}
