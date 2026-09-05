import { randomUUID } from 'node:crypto';
import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { runOutboxFullSweep } from './outbox-publisher';
import { getTenantMaintenanceWorker } from './tenant-maintenance';
import { runPdfStaleSessionRecoverySweep } from './pdf-stale-session-recovery';
import { runAttemptTimeoutSweep } from './attempt-timeout-sweeper';

/**
 * `ROLE=worker` entrypoint — ported structure (not code, no NestJS application context to boot)
 * from `legacy/api/src/worker.ts`. Boots no HTTP listener; runs the background workers this
 * dispatch builds on their own `setInterval` ticks, constructed via plain function calls (no DI
 * container, matching the migration plan's "Background workers" bullet: "constructed without a DI
 * container").
 *
 * **Phase 2 sub-slice "2d" adds `TenantMaintenanceWorker`'s two sweeps** (`sweepStuckProvisioning` +
 * `sweepTenantHygiene`, sharing one `WORKER_TENANT_MAINTENANCE_TICK_MS`-cadence tick, matching HLD
 * §10.1's own "a single 300s-class tick shared by all of its duties" framing) alongside Phase 1c's
 * `OutboxPublisher` full sweep.
 *
 * **Phase 6 sub-slice "6a" adds `StaleSessionRecoveryWorker`'s own full sweep** (`WORKER_PDF_SESSION_
 * SWEEP_TICK_MS`, its own independently-tunable cadence, via `pdf-stale-session-recovery.ts`'s
 * composition root).
 *
 * **Phase 7 adds `AttemptTimeoutSweeper`'s own full sweep** (`WORKER_ATTEMPT_TIMEOUT_SWEEP_TICK_MS`,
 * via `attempt-timeout-sweeper.ts`'s composition root) — the belt-and-braces backstop for FR-TAKE-6;
 * `AttemptsService`'s lazy on-access path (HLD §10.4) remains the primary timeout-enforcement
 * mechanism, this tick only catches an attempt nobody ever reads again. This closes out every worker
 * class the migration plan names for this app's `ROLE=worker` process.
 *
 * **`ROLE=worker` vs. `ROLE=web` process selection is Phase 10's docker-compose/Dockerfile job**
 * (the migration plan's own "same image, `ROLE` env var selects `node server.js` (web) vs
 * `node worker.js`"). This dispatch only builds the worker script itself, runnable directly today via
 * `npm run worker` (added to `package.json`, mirroring `provision-demo-tenant`'s own dev-script
 * convention) — real container-level `ROLE`-based `CMD` switching lands with Phase 10's compose/
 * Dockerfile rework.
 */
const WORKER_ID = `worker-${randomUUID()}`;

/** Wraps one worker's periodic tick so an uncaught rejection inside it can never crash the whole
 * process or silently stop future ticks — ported verbatim behavior from legacy's own
 * `scheduleTick` helper. */
function scheduleTick(name: string, intervalMs: number, run: () => Promise<unknown>): NodeJS.Timeout {
  return setInterval(() => {
    run().catch((err: unknown) => logger.error({ err }, `${name}_tick_failed`));
  }, intervalMs);
}

async function bootstrap(): Promise<void> {
  logger.info({ role: 'worker', workerId: WORKER_ID }, 'worker.started');
  const env = getEnv();

  const tenantMaintenance = await getTenantMaintenanceWorker();

  const timers: NodeJS.Timeout[] = [
    scheduleTick('outbox_publisher_full_sweep', env.WORKER_OUTBOX_TICK_MS, () => runOutboxFullSweep(WORKER_ID)),
    scheduleTick('tenant_maintenance_provisioning', env.WORKER_TENANT_MAINTENANCE_TICK_MS, () =>
      tenantMaintenance.sweepStuckProvisioning(),
    ),
    scheduleTick('tenant_maintenance_hygiene', env.WORKER_TENANT_MAINTENANCE_TICK_MS, () => tenantMaintenance.sweepTenantHygiene()),
    scheduleTick('pdf_stale_session_recovery_full_sweep', env.WORKER_PDF_SESSION_SWEEP_TICK_MS, () => runPdfStaleSessionRecoverySweep(WORKER_ID)),
    scheduleTick('attempt_timeout_sweeper_full_sweep', env.WORKER_ATTEMPT_TIMEOUT_SWEEP_TICK_MS, () => runAttemptTimeoutSweep()),
  ];

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'worker.shutting_down');
    for (const timer of timers) clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- process is exiting; the pino logger's own async
  // transports may not flush in time for a fatal-bootstrap-failure message, matching legacy's
  // identical `console.error`-on-fatal-bootstrap-failure precedent.
  console.error('Fatal error during worker bootstrap:', err);
  process.exit(1);
});
