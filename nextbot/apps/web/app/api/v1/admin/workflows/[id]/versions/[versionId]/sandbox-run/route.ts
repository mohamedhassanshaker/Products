import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StartSandboxRunRequestSchema } from "@nextbot/contracts";
import { handleStartSandboxRun } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/workflows/{id}/versions/{versionId}/sandbox-run` (RBAC:
 * `agent_platform=Write`) — Target Architecture Blueprint Phase 16 (BL-47b), LLD
 * §14.6.5.
 *
 * Creates a REAL `workflow_run` with `trigger_kind = 'Sandbox'` — not a mock console
 * (ADR-0013 §2.2: "the sandbox run is a completed run of the *whole graph* … and it uses
 * the existing single widget artifact, not a mock console"). The run starts `Pending`;
 * `apps/worker`'s `workflow.run-pump` claims and advances it. Nothing is executed inside
 * this request, deliberately: an HTTP handler that advanced a run would be a second
 * advancer beside the lease holder, which is the one thing `workflow_run_lease` exists
 * to prevent.
 *
 * **`Idempotency-Key` is REQUIRED** (LLD §14.6.5 marks it so). It is rejected when
 * absent rather than defaulted: silently generating one would defeat the exact property
 * the header exists to provide — a retried start must resume the existing run, never
 * create a second. A replay returns `200` with `created: false`; a genuinely new run
 * returns `201`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      { type: "about:blank", title: "An Idempotency-Key header is required to start a workflow run.", status: 400, code: "WORKFLOW_RUN_IDEMPOTENCY_KEY_REQUIRED" },
      { status: 400 },
    );
  }

  // An absent body is a valid sandbox run with no seed input — the common case when an
  // author just wants to see the graph execute.
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (!Value.Check(StartSandboxRunRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid sandbox-run payload.", status: 422 }, { status: 422 });
  }

  try {
    const result = await handleStartSandboxRun(guard.ctx, versionId, idempotencyKey, body);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    return problemResponse(err);
  }
}
