import { getPlatformDataSource, createTenantDataSource } from '@/server/infrastructure/database';
import { getTenantsService } from '@/server/platform/tenants';
import { OutboxRepository, FileCleanupRepository } from '@/server/reliability';
import { logger } from '@/server/logging';
import { WorkHintRepository } from './infrastructure/work-hint.repository';
import { WorkHintsService } from './application/work-hints.service';
import type { TenantWorkHintKind } from '@/server/infrastructure/database';

export { WorkHintRepository, WorkHintsService };

/** One work-hint kind's dashboard row (§18.9 of `docs/design/UX_GUIDELINES.md`) — `pendingCount` is
 * honestly `0` for every kind today since no producer writes any hint yet (see
 * `TenantWorkHintEntity`'s own doc comment); this is a correct, honest empty state, not a stub. */
export interface WorkHintDashboardRow {
  kind: TenantWorkHintKind;
  pendingCount: number;
}

/** The Reliability dashboard's full snapshot shape (Phase 2 sub-slice "2d" — no legacy precedent;
 * legacy never built an admin-facing reliability viewer). */
export interface ReliabilityDashboardSnapshot {
  outbox: { pending: number; delivered: number; deadLetter: number };
  fileCleanup: { due: number };
  workHints: WorkHintDashboardRow[];
  tenantsScanned: number;
}

const FULL_SCAN_PAGE_SIZE = 100;
const WORK_HINT_KINDS: TenantWorkHintKind[] = ['pdf_session', 'outbox', 'attempt_timeout'];

/**
 * `server/platform/reliability`'s public barrel (migration plan Phase 2 sub-slice "2d") — the
 * platform-schema read side of `tenant_work_hint` (HLD §10.2) plus the Reliability console dashboard's
 * own cross-tenant aggregation. Nothing outside this module may import `./domain/**`/
 * `./infrastructure/**`/`./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s
 * `platform/reliability` module-boundary rule).
 *
 * {@link getReliabilityDashboardSnapshot} is deliberately housed here (not inside the
 * `app/api/platform/reliability` Route Handler itself) so that handler stays a thin orchestration
 * shim, matching every other Route Handler in this app — the cross-module aggregation (iterating
 * every `Active` tenant's own schema for outbox/file-cleanup counts, tolerant of one tenant's failure,
 * mirroring `server/workers/outbox-publisher.ts`'s identical full-sweep pattern) is real business logic
 * that belongs in a module, not a route file.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandWorkHintsService: Promise<WorkHintsService> | undefined;
}

/** Composition root for {@link WorkHintsService}. */
export async function getWorkHintsService(): Promise<WorkHintsService> {
  if (!globalThis.__examlandWorkHintsService) {
    globalThis.__examlandWorkHintsService = getPlatformDataSource().then((ds) => new WorkHintsService(new WorkHintRepository(ds)));
  }
  return globalThis.__examlandWorkHintsService;
}

/**
 * Aggregates outbox/file-cleanup health across every `Active` tenant's own schema, plus the
 * platform-schema work-hint counts (honestly `0` for every kind today — see `WorkHintDashboardRow`'s
 * own doc comment). Tolerant of a single tenant's failure (logged, excluded from the running totals,
 * never aborts the rest of the scan) — the identical resilience convention every other full-sweep in
 * this app already follows (`OutboxPublisher`'s own tenant loop, `TenantMaintenanceWorker`'s two
 * sweeps).
 *
 * **Deliberately uses a short-lived `DataSource` per tenant (`createTenantDataSource`), not the
 * pooled `TenantDataSourceRegistry`** — a real, previously-latent connection-exhaustion bug was found
 * (and fixed) here: this dashboard is the first caller in this app to acquire *every* `Active`
 * tenant's `DataSource` in a single logical operation rather than one tenant at a time on an
 * HTTP-request/worker-tick's own natural cadence. Using the registry would leave up to
 * `TENANT_REGISTRY_MAX` tenants' pooled connections resident simultaneously by the time the scan
 * finishes (each holding up to `TENANT_POOL_MAX` connections open) — harmless at a handful of tenants,
 * but a real `ER_CON_COUNT_ERROR` ("Too many connections") against this project's own shared,
 * multi-dispatch dev schema (which has accumulated dozens of never-force-cleaned smoke/verification
 * tenants across every prior sub-dispatch), found by actually running this dispatch's own real-route
 * integration test, not assumed. A short-lived `DataSource`, opened, queried, and `.destroy()`-ed
 * immediately per tenant inside this same sequential loop, never accumulates more than one tenant's
 * connections at a time — mirroring `RunMigrationsStep`/`SeedRbacStep`/`SeedAdminUserStep`'s own
 * established "short-lived `DataSource`, not the request registry, so this never consumes a resident
 * slot" precedent (see `infrastructure/database`'s own `createTenantDataSource` doc comment).
 */
export async function getReliabilityDashboardSnapshot(): Promise<ReliabilityDashboardSnapshot> {
  const [tenantsService, workHints] = await Promise.all([getTenantsService(), getWorkHintsService()]);

  let outboxPending = 0;
  let outboxDelivered = 0;
  let outboxDeadLetter = 0;
  let fileCleanupDue = 0;
  let tenantsScanned = 0;
  let page = 1;

  for (;;) {
    const { items } = await tenantsService.list({ status: 'Active', page, pageSize: FULL_SCAN_PAGE_SIZE });
    if (items.length === 0) break;

    for (const tenant of items) {
      let dataSource: Awaited<ReturnType<typeof createTenantDataSource>> | undefined;
      try {
        dataSource = await createTenantDataSource(tenant.schemaName);
        const outbox = new OutboxRepository(dataSource);
        const fileCleanup = new FileCleanupRepository(dataSource);
        const [outboxCounts, dueCount] = await Promise.all([outbox.countsByStatus(), fileCleanup.countDue()]);
        outboxPending += outboxCounts.pending;
        outboxDelivered += outboxCounts.delivered;
        outboxDeadLetter += outboxCounts.deadLetter;
        fileCleanupDue += dueCount;
        tenantsScanned += 1;
      } catch (err) {
        logger.error({ err, tenantId: tenant.id }, 'reliability_dashboard_tenant_scan_failed');
      } finally {
        if (dataSource) await dataSource.destroy().catch(() => undefined);
      }
    }

    if (items.length < FULL_SCAN_PAGE_SIZE) break;
    page += 1;
  }

  const workHintRows = await Promise.all(
    WORK_HINT_KINDS.map(async (kind) => ({ kind, pendingCount: await workHints.countByKind(kind) })),
  );

  return {
    outbox: { pending: outboxPending, delivered: outboxDelivered, deadLetter: outboxDeadLetter },
    fileCleanup: { due: fileCleanupDue },
    workHints: workHintRows,
    tenantsScanned,
  };
}
