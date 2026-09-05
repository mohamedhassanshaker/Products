import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { runWithRequestContext } from '@/server/context';
import { getAuthService } from '@/server/auth';
import { getRolesService } from '@/server/rbac';
import { getUsersService } from '@/server/users';
import { getProfileService, ProfileService, ProfileRepository } from '@/server/profile';
import { FileSigningService } from '@/server/files';
import { LocalDiskStorageAdapter } from '@/server/infrastructure/storage';
import { OutboxRepository, OutboxPublisherService, type OutboxConsumer } from '@/server/reliability';
import { runOutboxFullSweep } from '@/server/workers/outbox-publisher';
import { logger } from '@/server/logging';

/**
 * Real-MySQL integration proof for Phase 1 sub-slice 1c's full scope: `users` (admin CRUD + the
 * `user.created` outbox producer), `profile` (self-service read/update/avatar-upload +
 * `file_cleanup_queue` scheduling on replace), `files` (HMAC sign/verify), and `reliability`
 * (transactional outbox: claim/deliver/idempotent-redelivery-is-a-no-op, plus the real
 * `runOutboxFullSweep` worker composition root iterating every `Active` tenant).
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/reliability-users-profile-files.integration.test.ts
 */
describe('Phase 1 sub-slice 1c — users/profile/files/reliability (real MySQL)', () => {
  const slug = `it-c-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let storageRoot: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({
      name: 'Sub-slice 1c Integration Tenant',
      subdomainSlug: slug,
      adminEmail: `admin@${slug}.local`,
    });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;
    storageRoot = await mkdtemp(join(tmpdir(), 'examland-1c-storage-'));
  });

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    if (tenantSchema) {
      const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${tenantSchema}\``);
      } finally {
        await conn.end();
      }
    }
    if (tenantId) {
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenantId]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenantId]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenantId]);
    }
    if (storageRoot) {
      await rm(storageRoot, { recursive: true, force: true });
    }
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
  });

  /** Builds a real ALS context matching what `withTenantContext` would establish — reused pattern
   * from `auth-rbac-platform.integration.test.ts`'s identical helper. */
  async function withRealTenantScope<T>(fn: () => Promise<T>): Promise<T> {
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      return await runWithRequestContext(
        { requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource },
        fn,
      );
    } finally {
      registry.release(tenantSchema);
    }
  }

  it('reliability migration: outbox_message/processed_event/file_cleanup_queue tables exist in the real tenant schema', async () => {
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      const tables: { name: string }[] = await dataSource.query(
        `SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('outbox_message','processed_event','file_cleanup_queue')`,
        [tenantSchema],
      );
      expect(tables.map((t) => t.name).sort()).toEqual(['file_cleanup_queue', 'outbox_message', 'processed_event']);
    } finally {
      registry.release(tenantSchema);
    }
  });

  it('UsersService.create() admin-creates a user, assigns a role, and atomically enqueues a real user.created outbox message', async () => {
    await withRealTenantScope(async () => {
      const roles = getRolesService();
      const memberRole = (await roles.list()).find((r) => r.name === 'Member')!;

      const users = getUsersService();
      const { user, temporaryPassword } = await users.create({
        email: `newuser-${randomUUID().slice(0, 8)}@${slug}.local`,
        firstName: 'New',
        lastName: 'User',
        roleIds: [memberRole.id],
      });

      expect(temporaryPassword).toBeDefined();
      expect(user.roles.map((r) => r.name)).toEqual(['Member']);

      const registry = getTenantDataSourceRegistry();
      const dataSource = await registry.acquire(tenantSchema);
      try {
        const rows: { event_type: string; payload: unknown }[] = await dataSource.query(
          'SELECT event_type, payload FROM outbox_message WHERE JSON_EXTRACT(payload, "$.userId") = ?',
          [user.id],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].event_type).toBe('user.created');
      } finally {
        registry.release(tenantSchema);
      }
    });
  });

  it('a real outbox message is claimed and delivered by OutboxPublisherService, and a simulated redelivery is a genuine no-op for an already-processed consumer', async () => {
    await withRealTenantScope(async () => {
      const users = getUsersService();
      const { user } = await users.create({
        email: `outbox-${randomUUID().slice(0, 8)}@${slug}.local`,
        firstName: 'Outbox',
        lastName: 'Target',
      });

      const registry = getTenantDataSourceRegistry();
      const dataSource = await registry.acquire(tenantSchema);
      try {
        const outbox = new OutboxRepository(dataSource);
        const spyConsumer: OutboxConsumer = { name: 'test-spy', eventTypes: ['user.created'], handle: vi.fn(async () => undefined) };
        const publisher = new OutboxPublisherService(outbox, [spyConsumer], logger);

        const [row]: { id: string }[] = await dataSource.query(
          'SELECT id FROM outbox_message WHERE JSON_EXTRACT(payload, "$.userId") = ?',
          [user.id],
        );
        expect(row).toBeDefined();
        // Other tests in this same shared tenant schema also enqueue (and don't necessarily drain)
        // `user.created` events — filter the spy's calls down to exactly *this* message's eventId so
        // this assertion is independent of test execution order/leftover pending rows from siblings.
        const handleMock = spyConsumer.handle as unknown as ReturnType<typeof vi.fn>;
        const callsForThisEvent = () => handleMock.mock.calls.filter((call: unknown[]) => call[1] === row.id);

        const firstPass = await publisher.processTenantBatch(`test-worker-${randomUUID().slice(0, 8)}`);
        expect(firstPass.delivered).toBe(firstPass.claimed);
        expect(callsForThisEvent()).toHaveLength(1);

        // Simulate a genuine redelivery scenario (e.g. a crash between "handled" and "marked
        // processed", or a manual retry) by resetting the row back to claimable — a message that
        // reappears as claimable but whose consumer already durably processed it (`processed_event`
        // still has the row) must NOT re-invoke the consumer's side effect, proving FR-REL-1's
        // idempotency guarantee for real, not just via a fake in a unit test.
        await dataSource.query(
          'UPDATE outbox_message SET processed_at = NULL, locked_by = NULL, locked_until = NULL WHERE id = ?',
          [row.id],
        );

        await publisher.processTenantBatch(`test-worker-${randomUUID().slice(0, 8)}`);
        // The consumer's own side effect must NOT run a second time (idempotency guard), even though
        // the message was genuinely reclaimed and redelivered.
        expect(callsForThisEvent()).toHaveLength(1);
        // But the message still ends up marked processed again (a harmless no-op completion).
        const [{ processed_at: processedAt }]: { processed_at: Date | null }[] = await dataSource.query(
          'SELECT processed_at FROM outbox_message WHERE id = ?',
          [row.id],
        );
        expect(processedAt).not.toBeNull();
      } finally {
        registry.release(tenantSchema);
      }
    });
  });

  it('runOutboxFullSweep (the real ROLE=worker composition root) discovers and delivers a pending message for the real Active tenant', async () => {
    let userId!: string;
    await withRealTenantScope(async () => {
      const users = getUsersService();
      const { user } = await users.create({
        email: `sweep-${randomUUID().slice(0, 8)}@${slug}.local`,
        firstName: 'Sweep',
        lastName: 'Target',
      });
      userId = user.id;
    });

    await runOutboxFullSweep(`sweep-worker-${randomUUID().slice(0, 8)}`);

    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      const [row]: { processed_at: Date | null }[] = await dataSource.query(
        'SELECT processed_at FROM outbox_message WHERE JSON_EXTRACT(payload, "$.userId") = ?',
        [userId!],
      );
      expect(row.processed_at).not.toBeNull();
    } finally {
      registry.release(tenantSchema);
    }
  });

  it('ProfileService: self-service read/update round trip against the real user row, and avatar replacement schedules the previous key for cleanup', async () => {
    const email = `profile-${randomUUID().slice(0, 8)}@${slug}.local`;

    const userId = await withRealTenantScope(async () => {
      const auth = await getAuthService();
      const { user } = await auth.register({ email, password: 'Abcdefg1', firstName: 'Prof', lastName: 'Ile' });
      return user.id;
    });

    await withRealTenantScope(async () => {
      const profile = getProfileService();
      const before = await profile.getProfile(userId);
      expect(before.pictureKey).toBeNull();

      const updated = await profile.updateProfile(userId, { occupation: 'Engineer' });
      expect(updated.occupation).toBe('Engineer');
    });

    // Exercise uploadPicture/setPicture's real file_cleanup_queue scheduling directly against a
    // ProfileService wired to a real temp-directory storage adapter (bypassing the env-driven
    // singleton `getProfileService()` uses, so this test is self-contained regardless of
    // STORAGE_ROOT/STORAGE_DRIVER/FILE_SIGNING_SECRET being set in the process running it).
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      const storage = new LocalDiskStorageAdapter(storageRoot);
      const profileService = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, new ProfileRepository(dataSource), storage);

      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      const afterFirstUpload = await runWithRequestContext(
        { requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource },
        () => profileService.uploadPicture(userId, { buffer: png, size: png.length }),
      );
      expect(afterFirstUpload.pictureKey).toMatch(new RegExp(`^tenants/${tenantId}/avatars/${userId}/`));

      const secondUpload = await runWithRequestContext(
        { requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource },
        () => profileService.uploadPicture(userId, { buffer: png, size: png.length }),
      );
      expect(secondUpload.pictureKey).not.toBe(afterFirstUpload.pictureKey);

      const [cleanupRow]: { storage_key: string }[] = await dataSource.query(
        'SELECT storage_key FROM file_cleanup_queue WHERE storage_key = ?',
        [afterFirstUpload.pictureKey],
      );
      expect(cleanupRow).toBeDefined();
    } finally {
      registry.release(tenantSchema);
    }
  });

  it('FileSigningService: a real sign()/verify() round trip against a temp-directory-backed StoragePort, plus rejection paths', async () => {
    const storage = new LocalDiskStorageAdapter(storageRoot);
    await storage.put(`tenants/${tenantId}/avatars/x/real.png`, Buffer.from('fake png bytes'), 'image/png');

    const signing = new FileSigningService({ signingSecret: 'integration-test-signing-secret-32chars', signedUrlTtlSec: 900 }, storage);
    const { url } = signing.sign(`tenants/${tenantId}/avatars/x/real.png`, tenantId);

    const parsed = new URL(url, 'http://localhost');
    const rawPath = decodeURIComponent(parsed.pathname.replace('/api/files/d/', ''));
    const exp = parsed.searchParams.get('exp')!;
    const sig = parsed.searchParams.get('sig')!;

    const verified = signing.verify(rawPath, exp, sig);
    expect(verified.storageKey).toBe(`tenants/${tenantId}/avatars/x/real.png`);

    const stat = await signing.stat(verified.storageKey);
    expect(stat.size).toBeGreaterThan(0);

    // Cross-tenant signing is rejected outright.
    expect(() => signing.sign(`tenants/${tenantId}/avatars/x/real.png`, 'some-other-tenant')).toThrow();

    // A tampered signature is rejected.
    const tamperedSig = sig.slice(0, -1) + (sig.at(-1) === 'a' ? 'b' : 'a');
    expect(() => signing.verify(rawPath, exp, tamperedSig)).toThrow();

    // An expired link is rejected.
    const pastExp = String(Math.floor(Date.now() / 1000) - 10);
    expect(() => signing.verify(rawPath, pastExp, sig)).toThrow();
  });
});
