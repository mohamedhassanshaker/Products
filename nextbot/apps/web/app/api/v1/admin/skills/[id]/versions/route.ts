import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateSkillVersionRequestSchema } from "@nextbot/contracts";
import { handleCreateVersion, handleListVersions } from "@nextbot/skills";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/skills/:id/versions` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ versions: await handleListVersions(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `POST /api/v1/admin/skills/:id/versions` (RBAC: agent_platform=Write) — always
 * creates version N+1 in Draft (LLD §14.5.1); never mutates an existing version. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateSkillVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid skill version payload.", status: 422 }, { status: 422 });
  }
  try {
    const version = await handleCreateVersion(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
