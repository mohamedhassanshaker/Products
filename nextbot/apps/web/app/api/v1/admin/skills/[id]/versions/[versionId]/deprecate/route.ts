import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { DeprecateSkillVersionRequestSchema } from "@nextbot/contracts";
import { handleDeprecateVersion } from "@nextbot/skills";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/skills/:id/versions/:versionId/deprecate` (RBAC:
 * agent_platform=Write). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (!Value.Check(DeprecateSkillVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid deprecate payload.", status: 422 }, { status: 422 });
  }
  try {
    const version = await handleDeprecateVersion(guard.ctx, versionId, body);
    return NextResponse.json({ version });
  } catch (err) {
    return problemResponse(err);
  }
}
