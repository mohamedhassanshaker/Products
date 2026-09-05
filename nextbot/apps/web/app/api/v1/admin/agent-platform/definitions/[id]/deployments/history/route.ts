import { NextResponse } from "next/server";
import { handleGetDeploymentHistory } from "@nextbot/agent-platform";
import type { DeployEnvironmentValue } from "@nextbot/contracts";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/agent-platform/definitions/:id/deployments/history`
 * (Phase 17, BL-48/BL-13, ADR-0019, LLD §15.7) — the rollout timeline behind the
 * Deployments & Canary panel. RBAC: `agent_platform=Read`.
 *
 * Includes the `EmergencyRollback` rows Phase 0 already writes, deliberately: an emergency
 * rollback must appear in the same timeline as ordinary deployment actions and be
 * *labelled distinctly* rather than hidden — ADR-0017 §2.5's "visibility as the
 * compensating control" for an audited gate bypass.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  // `new URL(request.url)` rather than `NextRequest.nextUrl` so this handler is
  // exercisable with a plain `Request` in a unit test, and allow-listed rather than
  // passed through because the value reaches a Postgres enum cast.
  const raw = new URL(request.url).searchParams.get("environment");
  const environment: DeployEnvironmentValue = raw === "Sandbox" || raw === "Staging" ? raw : "Production";
  try {
    return NextResponse.json(await handleGetDeploymentHistory(guard.ctx, id, environment));
  } catch (err) {
    return problemResponse(err);
  }
}
