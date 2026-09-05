import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { ProvisionTenantRequestSchema } from "@nextbot/contracts";
import { listAllTenants, provisionTenant } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { PLATFORM_OPERATOR_ACTOR_LABEL } from "@/src/lib/platform-ops-auth";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/internal/ops/tenants` — the Tenant List screen's data source (NFR-11).
 * `POST /api/internal/ops/tenants` — the Provisioning form's target, wired to the
 * existing `provisionTenant()` application service (previously only ever called from
 * `scripts/seed.ts`/tests — this is its first real HTTP surface).
 *
 * This route (and its `[id]` sibling) is one of the two call sites LLD §3.2 rule 4
 * permits for `withPlatform()` (via the `@nextbot/tenancy` functions it calls) — see
 * `packages/db/src/platform-context.ts`'s doc comment.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  try {
    const tenants = await listAllTenants();
    return NextResponse.json({ tenants });
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!Value.Check(ProvisionTenantRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "Invalid provisioning request.", status: 422 },
      { status: 422 },
    );
  }

  try {
    // Platform Manager console Phase 1 (NFR-11): attributed to the shared operator
    // actor label (see `platform-ops-auth.ts`'s doc comment for why this auth model
    // has no more specific per-operator identity to attribute to).
    const tenant = await provisionTenant(body, PLATFORM_OPERATOR_ACTOR_LABEL);
    return NextResponse.json(tenant, { status: 201 });
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
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
