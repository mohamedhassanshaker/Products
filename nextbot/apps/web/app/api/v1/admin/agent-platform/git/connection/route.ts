import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { ConnectGitRequestSchema } from "@nextbot/contracts";
import { handleConnectGit, handleDisconnectGit, handleGetGitConnection } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/git/connection` (RBAC: agent_platform=Read). */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ connection: await handleGetGitConnection(guard.ctx) });
}

/** `POST /api/v1/admin/agent-platform/git/connection` (RBAC: agent_platform=Write) —
 * ADR-0009's connect flow, step 2 (LLD §3.10a's `POST /connection`): the tenant admin
 * has already completed the OAuth exchange and picked a repo; this persists the
 * connection, vaulting the access token. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(ConnectGitRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Git connect request.", status: 422 }, { status: 422 });
  }
  try {
    const connection = await handleConnectGit(guard.ctx, body, guard.session.userId);
    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/agent-platform/git/connection` (RBAC: agent_platform=Write). */
export async function DELETE() {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  await handleDisconnectGit(guard.ctx);
  return NextResponse.json({ ok: true });
}
