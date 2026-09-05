import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { TeamSandboxRunRequestSchema } from "@nextbot/contracts";
import { handleTeamSandboxRun } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { createDelegationDeps } from "@/src/lib/delegation-deps";

/**
 * `POST /api/v1/admin/teams/{id}/versions/{versionId}/sandbox-run` (RBAC:
 * `agent_platform=Write`) — LLD §14.7.5, FR-ORC-11.
 *
 * Exercises the WHOLE topology, not just the supervisor: the run delegates to every
 * member through the real executor (same evaluator call, same FR-ORC-09 guardrail,
 * same FR-ORC-05 re-mask, same trace rows as production), records
 * `team_version.sandbox_run_id`, and returns the resulting delegation tree so the
 * caller can SEE the topology was exercised. `Approved` is then gated on that run
 * having a `delegation_event` for every member — a supervisor-only run fails it.
 *
 * `conversationId` is optional and is NOT created here: `teams` never writes
 * `message` rows (LLD §14.7.4), so a sandbox run without a conversation is a dry
 * run that raises no escalation and suspends no approval — deliberately, since both
 * of those need a real conversation to attach to.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(TeamSandboxRunRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid sandbox-run payload.", status: 422 }, { status: 422 });
  }
  try {
    const deps = createDelegationDeps(guard.ctx, body.conversationId ?? null);
    return NextResponse.json(await handleTeamSandboxRun(guard.ctx, deps, versionId, body));
  } catch (err) {
    return problemResponse(err);
  }
}
