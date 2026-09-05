import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { OutboxRepository, OutboxPublisherService, type OutboxConsumer } from '@/server/reliability';
import { logger } from '@/server/logging';

/**
 * Phase 1 "exception" closure for `legacy/api/test/reliability-workers.e2e-spec.ts` (see
 * `phase1-exception-users-admin.integration.test.ts`'s doc comment for the shared background). Only
 * the legacy suite's FR-REL-1 (outbox) section applies to this app today — its
 * `PdfProcessingSessionRepository.claimStale`/`AttemptsRepository.findTimedOutCandidateIds` sections
 * belong to `pdf-processing`/`attempts`, modules that don't exist yet in this app (Phase 3/4/6/7/8
 * scope per `docs/plans/nextjs-rewrite-phase1-plan.md` sub-slice 1c's own explicit deferral) — those
 * are deliberately not adapted here (see this dispatch's own plan-doc entry for the full
 * covered-vs-deferred breakdown).
 *
 * Within FR-REL-1, `reliability-users-profile-files.integration.test.ts` (1c's own dispatch-scoped
 * proof) already covers the happy-path claim/deliver + idempotent-redelivery-is-a-no-op scenario
 * against real MySQL. This file adds the two remaining real-MySQL-only-provable assertions neither
 * that test nor any fakes-based unit test (`outbox.repository.test.ts`/
 * `outbox-publisher.service.test.ts`) can genuinely prove:
 * 1. A failed delivery's backoff (`available_at`) is computed *server-side* and is still provably in
 *    the future — exactly the class of host-timezone-drift bug this codebase has already hit once
 *    (see `outbox.repository.ts`'s own `enqueue` doc comment) — a fakes-based unit test can only
 *    assert that a query string was called with certain parameters, never that MySQL's own `NOW(3)`
 *    arithmetic actually produced a future timestamp.
 * 2. REAL multi-replica-safety: two genuinely concurrent `OutboxPublisherService` instances racing the
 *    same `claimBatch` UPDATE each win a disjoint, non-overlapping set of rows — only provable against
 *    a real database's own row-level locking, never a fake.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase1-exception-reliability-workers.integration.test.ts
 */
describe('Phase 1 exception closure — reliability-workers.e2e-spec.ts adapted assertions (real MySQL 8.4)', () => {
  const slug = `pe1-rel-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase1 Exception Reliability Tenant', subdomainSlug: slug, adminEmail: `founder@${slug}.local` });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;
  }, 60_000);

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${tenantSchema}\``);
    } finally {
      await conn.end();
    }
    await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenantId]);
    await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenantId]);
    await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenantId]);
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
  });

  it(
    "a consumer's failure is retried with backoff and never marks the message processed — available_at is pushed into " +
      'the future via genuine server-side NOW(3) arithmetic, not a JS Date (adapts reliability-workers.e2e-spec.ts\'s ' +
      'identical assertion, including its own documented host-timezone-drift-avoidance technique: never reading the ' +
      'column back as a client-side JS Date, only comparing it server-side)',
    async () => {
      const registry = getTenantDataSourceRegistry();
      const dataSource = await registry.acquire(tenantSchema);
      try {
        const outbox = new OutboxRepository(dataSource);
        let eventId = '';
        await dataSource.manager.transaction(async (em) => {
          eventId = await outbox.enqueue(em, 'phase1-exception.failing-event', { n: 1 });
        });

        let attempts = 0;
        const flakyConsumer: OutboxConsumer = {
          name: 'phase1-exception-flaky-consumer',
          eventTypes: ['phase1-exception.failing-event'],
          handle: async () => {
            attempts += 1;
            throw new Error('downstream boom');
          },
        };
        const publisher = new OutboxPublisherService(outbox, [flakyConsumer], logger);

        const result = await publisher.processTenantBatch(`worker-${randomUUID().slice(0, 8)}`);
        expect(result.delivered).toBe(0);
        expect(attempts).toBe(1);

        // Computed entirely server-side, deliberately never read back as a client-side JS `Date` — see
        // this test's own doc comment for why (mysql2's default 'local'-timezone read conversion would
        // reintroduce the exact host-timezone-drift artifact this suite's assertion technique avoids).
        const rows: { processed_at: Date | null; attempts: number; last_error: string | null; is_future: number | string }[] = await dataSource.manager.query(
          'SELECT processed_at, attempts, last_error, (available_at > NOW(3)) AS is_future FROM outbox_message WHERE id = ?',
          [eventId],
        );
        expect(rows[0].processed_at).toBeNull();
        expect(rows[0].attempts).toBe(1);
        expect(rows[0].last_error).toContain('downstream boom');
        // mysql2 returns a boolean-expression result as `1`/`0`, sometimes string-typed depending on
        // the driver's result-type inference — `Number(...)` normalizes both.
        expect(Number(rows[0].is_future)).toBe(1);
      } finally {
        registry.release(tenantSchema);
      }
    },
  );

  it(
    'REAL multi-replica-safety: two concurrent OutboxPublisherService instances racing the same claim batch each win a ' +
      'disjoint, non-overlapping set of rows, and every row is claimed by exactly one (adapts ' +
      "reliability-workers.e2e-spec.ts's identical concurrency proof)",
    async () => {
      const registry = getTenantDataSourceRegistry();
      const dataSource = await registry.acquire(tenantSchema);
      try {
        const outboxForSetup = new OutboxRepository(dataSource);
        const eventIds: string[] = [];
        await dataSource.manager.transaction(async (em) => {
          for (let i = 0; i < 10; i++) {
            eventIds.push(await outboxForSetup.enqueue(em, 'phase1-exception.race-event', { i }));
          }
        });

        const claimedByA: string[] = [];
        const claimedByB: string[] = [];
        const consumerA: OutboxConsumer = {
          name: 'phase1-exception-race-consumer',
          eventTypes: ['phase1-exception.race-event'],
          handle: vi.fn(async (_p, id) => {
            claimedByA.push(id);
          }),
        };
        const consumerB: OutboxConsumer = {
          name: 'phase1-exception-race-consumer',
          eventTypes: ['phase1-exception.race-event'],
          handle: vi.fn(async (_p, id) => {
            claimedByB.push(id);
          }),
        };

        const publisherA = new OutboxPublisherService(new OutboxRepository(dataSource), [consumerA], logger);
        const publisherB = new OutboxPublisherService(new OutboxRepository(dataSource), [consumerB], logger);

        // Genuinely concurrent — both `claimBatch` UPDATE statements are in flight against the real
        // connection pool at the same time, racing for the same 10 rows.
        const [resultA, resultB] = await Promise.all([
          publisherA.processTenantBatch(`worker-race-a-${randomUUID().slice(0, 8)}`),
          publisherB.processTenantBatch(`worker-race-b-${randomUUID().slice(0, 8)}`),
        ]);

        expect(resultA.claimed + resultB.claimed).toBe(10);
        const overlap = claimedByA.filter((id) => claimedByB.includes(id));
        expect(overlap).toEqual([]); // no row was ever claimed by both.
        const allDelivered = [...claimedByA, ...claimedByB].sort();
        expect(allDelivered).toEqual([...eventIds].sort()); // every event delivered to exactly one.
      } finally {
        registry.release(tenantSchema);
      }
    },
    30_000,
  );
});
