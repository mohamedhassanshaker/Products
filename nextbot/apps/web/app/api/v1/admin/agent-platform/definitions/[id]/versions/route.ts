import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateAgentDefinitionVersionRequestSchema } from "@nextbot/contracts";
import { handleCreateVersion, handleListVersions } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/definitions/:id/versions` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ versions: await handleListVersions(guard.ctx, id, guard.session.userId) });
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * `POST /api/v1/admin/agent-platform/definitions/:id/versions` (RBAC:
 * agent_platform=Write). Postgres is the version's source of truth (ADR-0009's
 * 2026-08-23 amendment) — when the tenant has a Git connection configured, this also
 * commits the artifact to that remote before returning (best-effort sync, still a real
 * commit when it happens); when no connection is configured at all, the version is
 * still created successfully with `gitCommitSha: null` in the response body, and the
 * console surfaces that as a non-blocking notice rather than an error.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateAgentDefinitionVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid agent definition version payload.", status: 422 }, { status: 422 });
  }
  try {
    const version = await handleCreateVersion(guard.ctx, id, body, guard.session.userId);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
