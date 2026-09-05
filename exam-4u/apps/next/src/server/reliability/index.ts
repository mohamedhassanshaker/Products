import { OutboxRepository } from './infrastructure/outbox.repository';
import { FileCleanupRepository } from './infrastructure/file-cleanup.repository';
import { OutboxPublisherService } from './application/outbox-publisher.service';
import { LoggingAuditTrailConsumer } from './application/consumers/logging-audit-trail.consumer';
import { TenantHygieneService } from './application/tenant-hygiene.service';

export { OutboxRepository, FileCleanupRepository, OutboxPublisherService, LoggingAuditTrailConsumer, TenantHygieneService };
export type { OutboxConsumer, ClaimedOutboxMessage } from './domain/outbox-consumer.types';

/**
 * `server/reliability`'s public barrel (Phase 1 sub-slice 1c, Dev-22/BL-20, FR-REL-1) — the
 * transactional-outbox pattern (at-least-once delivery, idempotent consumer dispatch) plus the
 * file-cleanup deferred-delete queue. Nothing outside this module may import `./domain/**`/
 * `./infrastructure/**`/`./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s
 * `reliability` module-boundary rule).
 *
 * **Scope reduction vs. legacy's `modules/reliability`, documented**:
 * - No hinted sweep / `platform.tenant_work_hint` table (HLD §10.2's "visit only tenants with a
 *   pending hint instead of polling every schema" optimization) — this dispatch builds only the
 *   full-sweep safety net (`server/workers/outbox-publisher.ts`'s `runOutboxFullSweep`, iterating
 *   every `Active` tenant every tick). Correct (every pending message is still found and delivered,
 *   at-least-once, exactly once per consumer) but not the throughput-optimized hinted path — a
 *   reasonable trade for this migration-plan phase's scale (a handful of demo/test tenants), and
 *   re-adding the hint table later needs no reshaping migration here (it lives entirely in the
 *   platform schema, untouched by this dispatch). **Phase 2 sub-slice "2d" update**: the
 *   `tenant_work_hint` table itself (and its platform-schema read side, `server/platform/reliability`'s
 *   `WorkHintsService`) now exist — still with no producer wired (no `pdf-processing`/`attempts`
 *   module exists yet to write hints), so this app's own sweep is still full-scan-only; the table
 *   exists so those later phases have a ready consumer/producer contract.
 * - No `AuditTrailOutboxConsumer` (legacy's real audit-log-backed consumer) — `platform/audit` now
 *   exists (Phase 2 sub-slice "2d"), but retrofitting the outbox's own `user.created` delivery onto
 *   it is out of this dispatch's scope (this dispatch's own audit retrofit targets the mutating
 *   platform-admin *Route Handlers* sub-slices 2a/2b/2c already shipped, not the outbox consumer
 *   itself). {@link LoggingAuditTrailConsumer} remains the genuine, idempotency-guarded stand-in
 *   proving the delivery mechanism end to end.
 * - **Phase 2 sub-slice "2d" closes this gap**: {@link TenantHygieneService} now exists (this
 *   dispatch), and `TenantMaintenanceWorker` (`server/workers/tenant-maintenance.ts`) drains
 *   {@link FileCleanupRepository} via it, per-`Active`-tenant, on its own worker tick.
 */
