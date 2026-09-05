import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SetTrafficSplitRequestSchema, type DeployEnvironmentValue } from "@nextbot/contracts";
import { handleGetDeployments, handleSetTrafficSplit } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET|PUT /api/v1/admin/agent-platform/definitions/:id/deployments`
 * (Target Architecture Blueprint Phase 17, BL-48/BL-13, FR-AGT-04/05, ADR-0019, LLD §15.7).
 *
 * RBAC: `agent_platform=Read` for the current allocations + per-version metrics,
 * `agent_platform=Write` for a split change — the **same** module and level ordinary
 * promotion and emergency rollback already require. ADR-0019 §2.6 adopts ADR-0017 §2.2's
 * reasoning unchanged: an actor who can promote can change the split; no new role, no new
 * privilege ladder.
 *
 * Every rule that makes a split safe is enforced inside the service, never trusted from
 * this route: allocations must sum to exactly 100, every allocated version must already
 * hold `Production` status (ADR-0019 §2.4 — canary is not a second route past the
 * promotion gate) and belong to *this* definition (compared against the path-scoped id,
 * never the body), and a non-blank reason is required for the audit trail.
 */

/**
 * `Production` is the only environment with a live resolver consumer today (ADR-0019
 * §2.7); the parameter exists so Staging/Sandbox rollout needs no signature change later.
 *
 * Allow-listed rather than passed through: `environment` reaches a Postgres enum cast, so
 * an unrecognised value must become a safe default here rather than a 500 further down.
 * Read from `new URL(request.url)` rather than `NextRequest.nextUrl` so the handler is
 * exercisable with a plain `Request` in a unit test, matching this codebase's other route
 * tests.
 */
function parseEnvironment(request: Request): DeployEnvironmentValue {
  const raw = new URL(request.url).searchParams.get("environment");
  return raw === "Sandbox" || raw === "Staging" ? raw : "Production";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetDeployments(guard.ctx, id, parseEnvironment(request)));
  } catch (err) {
    return problemResponse(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetTrafficSplitRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid traffic-split request.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleSetTrafficSplit(guard.ctx, id, body, guard.session.userId));
  } catch (err) {
    return problemResponse(err);
  }
}
