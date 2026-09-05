import { NextResponse, type NextRequest } from "next/server";
import { getTenantOperatorSummary } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/** `GET /api/internal/ops/tenants/:id` — the Tenant Detail screen's data source
 * (NFR-11), read-only this phase (status/plan-tier change actions are Phase 2). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const { id } = await params;
  try {
    const summary = await getTenantOperatorSummary(id);
    if (!summary) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * Every verb this route does not implement, claimed explicitly so Next cannot answer
 * it with a route-existence-confirming `405`/`OPTIONS: Allow` *before* the guard runs
 * (NFR-11, QA retry 3 — see `apiMethodNotFoundHandler`'s doc comment). `HEAD` is
 * intentionally omitted: Next derives it from `GET`, which already runs the guard.
 */
export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
