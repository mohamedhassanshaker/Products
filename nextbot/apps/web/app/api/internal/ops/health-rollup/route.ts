import { NextResponse, type NextRequest } from "next/server";
import { listAllTenants } from "@nextbot/tenancy";
import { listConnectors, getConnectorHealthSummary } from "@nextbot/connectors";
import type { TenantContext } from "@nextbot/db";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * One connector's rollup row (Platform Manager console Phase 3, NFR-11's
 * cross-tenant MCP health rollup) — **metadata only**, per NFR-11's "never returns
 * conversation/message content" constraint. Every field here is sourced from
 * `connector` (name/status, a config row) and `connector_health_check` (a probe
 * result: ok/latency/timestamp) — neither table has any column that can hold
 * conversation or tool-call-payload content; see this file's top doc comment for
 * the full accounting of what was deliberately left out.
 */
interface ConnectorHealthRollupRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  connectorId: string;
  connectorName: string;
  /** Computed exclusively by the health-check subsystem (FR-MCP-01) — never set by
   * this route. `Degraded`/`Offline` is what "needs attention" means for this view. */
  status: "Connected" | "Degraded" | "Offline";
  /** Timestamp of the most recent recorded probe in the summary window, or `null`
   * if this connector has never been probed. */
  lastCheckedAt: string | null;
  /** Whether that most recent probe succeeded, or `null` if never probed. */
  lastCheckOk: boolean | null;
  /** Error-rate percentage over the summary window (0-100). */
  errorRatePct: number;
  /** Count of failed probes within the (at most 50-entry) sample the summary
   * exposes — a bounded, already-aggregated figure, not raw probe records. */
  recentErrorCount: number;
  /** Total probes in the summary window (bounded to 200 by `getConnectorHealthSummary`). */
  callVolume: number;
}

/**
 * `GET /api/internal/ops/health-rollup` — the Health screen's data source (NFR-11
 * Phase 3): a cross-tenant view of every connector's computed health status, so an
 * operator can see "which tenants need attention right now" without opening each
 * tenant's own admin console one at a time.
 *
 * ## Composition-root pattern (LLD §2.3)
 *
 * `tenancy` has no permitted module edge to `connectors`/`mcp-client` — cross-module
 * joins for a platform-wide read happen here, at the `apps/web` route-handler layer,
 * exactly as `apps/web/app/api/v1/admin/mcp-health/route.ts` already established for
 * one tenant. This route does the same join across every tenant: `listAllTenants()`
 * (`@nextbot/tenancy`, `withPlatform`-backed) enumerates tenants, and
 * `listConnectors()`/`getConnectorHealthSummary()` (`@nextbot/connectors`, both
 * reused completely unmodified) are called once per tenant with a `TenantContext`
 * this route constructs itself. No new dependency-cruiser rule was needed: this
 * route already sits inside `no-platform-outside-allowed-callers`'s second permitted
 * caller (`apps/web/app/api/internal/ops`), and it imports `@nextbot/connectors`
 * exactly as `mcp-health/route.ts` already does from the same `apps/web` app —
 * neither is a new edge for the dependency graph to learn.
 *
 * The synthesized `TenantContext` uses `environment: "Sandbox"` for every tenant,
 * mirroring `@nextbot/tenancy`'s own `listActiveTenantContexts()` (the existing
 * cross-tenant-sweep seam `apps/worker`'s health-check job already uses) — this
 * project has no per-tenant "current environment" concept to read instead, and nothing
 * downstream in `listConnectors`/`getConnectorHealthSummary` uses `environment` for
 * anything (both scope purely by `tenantId` via `withTenant`'s RLS `SET LOCAL`).
 *
 * ## NFR-11 metadata-only guarantee
 *
 * This route deliberately reuses only `listConnectors` (reads the `connector` table:
 * id/name/status/config) and `getConnectorHealthSummary` (reads
 * `connector_health_check`: id/ok/latencyMs/checkedAt). Neither table, nor anything
 * this route selects from them, has a column that can hold conversation or message
 * content, or a raw tool-call payload — `conversation`/`message`/`tool_call` are
 * never imported or queried here. This mirrors (and is narrower than) what the
 * per-tenant `mcp-health` route already exposes to a tenant-scoped admin; the
 * per-tool table (`getToolHealthSummaries` from `@nextbot/approvals`) is
 * deliberately NOT joined here — the plan's scope for this screen is connector-level
 * incident response, not the full per-tool management view that already exists
 * per-tenant.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  try {
    const tenants = await listAllTenants();

    const rows: ConnectorHealthRollupRow[] = [];
    for (const tenant of tenants) {
      const ctx: TenantContext = { tenantId: tenant.id, region: tenant.region, environment: "Sandbox" };
      const connectors = await listConnectors(ctx);

      for (const connector of connectors) {
        const summary = await getConnectorHealthSummary(ctx, connector.id);
        const lastCheck = summary.sparkline.at(-1) ?? null;

        rows.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          connectorId: connector.id,
          connectorName: connector.name,
          status: connector.status,
          lastCheckedAt: lastCheck ? lastCheck.checkedAt.toISOString() : null,
          lastCheckOk: lastCheck ? lastCheck.ok : null,
          errorRatePct: summary.errorRatePct,
          recentErrorCount: summary.sparkline.filter((s) => !s.ok).length,
          callVolume: summary.callVolume,
        });
      }
    }

    return NextResponse.json({ connectors: rows });
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
