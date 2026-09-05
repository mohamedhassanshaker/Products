import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { PromoteVersionRequestSchema } from "@nextbot/contracts";
import { handlePromoteVersion } from "@nextbot/agent-platform";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/external/agent-platform/versions/:id/promote` (RBAC:
 * agent_platform=Write). LLD §3.10's promotion gate is enforced inside
 * `handlePromoteVersion` itself, identically to the console's own route — a
 * scoped-key caller cannot skip the reviewer!=author rule or any other gate;
 * `guard.session.userId` here is the API key's own bound service-account user, so
 * the rule is checked against a real identity either way.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(PromoteVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid promotion request.", status: 422 }, { status: 422 });
  }
  try {
    const version = await handlePromoteVersion(guard.ctx, id, body.targetStatus, guard.session.userId);
    return NextResponse.json({ version });
  } catch (err) {
    return problemResponse(err);
  }
}
