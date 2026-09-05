import { randomUUID } from 'node:crypto';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { GET as profileGET } from '@/app/api/profile/route';
import { POST as picturePOST } from '@/app/api/profile/picture/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';

/**
 * Phase 1 "exception" closure for `legacy/api/test/profile.e2e-spec.ts` (see
 * `phase1-exception-users-admin.integration.test.ts`'s doc comment for the shared background).
 * Deliberately drives the REAL `POST /api/profile/picture` Route Handler with a genuine `NextRequest`
 * carrying a real `multipart/form-data` `FormData` body — this is the only way to exercise the actual
 * production code path for sub-slice 1c's own documented real bug fix ("Decisions made" #4 in
 * `docs/plans/nextjs-rewrite-phase1-plan.md`: a `Content-Length` pre-check added *before* calling
 * `request.formData()`, to avoid an intermittent `undici` crash on oversized bodies). That fix was
 * previously proven only via a manual, non-repeatable `next start` + real-upload smoke pass — this
 * file makes it a permanent, automated regression test. Magic-byte sniffing itself
 * (`sniffImageMimeType`) is already exhaustively unit-tested (`image-signature.util.test.ts`) and not
 * re-derived here; this file's job is the route-level wiring around it.
 *
 * **Deliberately reads `getEnv().STORAGE_ROOT` rather than tracking its own directory** (unlike
 * `reliability-users-profile-files.integration.test.ts`, which bypasses the env-driven
 * `getProfileService()`/`getStoragePortSingleton()` singletons entirely by constructing its own
 * `ProfileService`/`LocalDiskStorageAdapter` directly): this file specifically needs the REAL Route
 * Handler, which internally resolves storage via those singletons. Both are cached on `globalThis` for
 * the lifetime of the vitest worker process that first calls them — potentially by an *earlier* test
 * file sharing the same worker — so this file observes whatever root actually ended up cached rather
 * than trying to force its own (a `process.env.STORAGE_ROOT` mutation from inside a single test file's
 * `beforeAll` is not reliably honored once another file in the same worker has already triggered the
 * cache; found by direct empirical investigation while building this test). Only its own
 * tenant-scoped subdirectory is cleaned up in `afterAll` — never the shared root itself, since sibling
 * test files may still be using it.
 *
 * Run via (STORAGE_ROOT must point at a writable local directory for real disk writes to succeed):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     STORAGE_ROOT=<a writable local directory> \
 *     npx vitest run src/server/phase1-exception-profile.integration.test.ts
 */
describe('Phase 1 exception closure — profile.e2e-spec.ts adapted assertions (real MySQL + real disk, real routes)', () => {
  const slug = `pe1-profile-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let accessToken: string;
  let storageRoot: string;

  beforeAll(async () => {
    // Resolved (not assigned) — see this file's own doc comment for why a fallback default is used
    // only when no external override is set, matching `env.schema.ts`'s own default shape, and why
    // this file never mutates `process.env.STORAGE_ROOT` itself.
    storageRoot = getEnv().STORAGE_ROOT || join(tmpdir(), 'examland-phase1-exception-shared-storage');
    await mkdir(storageRoot, { recursive: true });

    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase1 Exception Profile Tenant', subdomainSlug: slug, adminEmail: `founder@${slug}.local` });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;

    const email = `profileuser-${randomUUID().slice(0, 8)}@${slug}.local`;
    const password = 'Profile-Phase1-Pass-1';
    const tenantHeaders: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema, 'content-type': 'application/json' };
    const registerRes = await registerPOST(
      new NextRequest('http://localhost/api/auth/register', { method: 'POST', headers: tenantHeaders, body: JSON.stringify({ email, password, firstName: 'Pro', lastName: 'File' }) }),
    );
    expect(registerRes.status).toBe(201);
    const loginRes = await loginPOST(new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: tenantHeaders, body: JSON.stringify({ email, password }) }));
    expect(loginRes.status).toBe(200);
    accessToken = (await loginRes.json()).accessToken as string;
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
    // Only this test's own tenant-scoped subtree — never the whole (possibly shared) storage root.
    await rm(join(storageRoot, 'tenants', tenantId), { recursive: true, force: true });
  });

  function tenantHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  function uploadRequest(formData: FormData, token: string | undefined, contentLength?: number): NextRequest {
    const headers = tenantHeaders(token);
    if (contentLength !== undefined) headers['content-length'] = String(contentLength);
    return new NextRequest('http://localhost/api/profile/picture', { method: 'POST', headers, body: formData });
  }

  it('rejects an unauthenticated avatar upload with 401 before ever touching disk (adapts profile.e2e-spec.ts\'s auth check)', async () => {
    const formData = new FormData();
    formData.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'a.jpg');
    const res = await picturePOST(uploadRequest(formData, undefined));
    expect(res.status).toBe(401);
  });

  it(
    'rejects an oversized upload with 413 FILE_TOO_LARGE via the real Content-Length pre-check — the actual regression ' +
      'test for sub-slice 1c\'s own documented real bug fix (a bare 500 from undici\'s formData() internals, fixed by ' +
      'checking Content-Length BEFORE ever calling request.formData())',
    async () => {
      // The precheck only ever reads the `Content-Length` HEADER (never the actual body) before
      // deciding whether to call `request.formData()` at all — so a real, deliberately tiny body with
      // a header value comfortably above whatever `MAX_AVATAR_SIZE_BYTES` is actually configured to in
      // this process (this file never overrides it, to avoid the exact composition-root-cache-timing
      // hazard described in this file's own doc comment) is sufficient to exercise the fix faithfully,
      // without needing to allocate/transmit a genuinely multi-megabyte buffer.
      const formData = new FormData();
      formData.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'big.jpg');

      const res = await picturePOST(uploadRequest(formData, accessToken, 50_000_000));
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe('FILE_TOO_LARGE');
    },
  );

  it(
    'rejects a non-image file with UNSUPPORTED_IMAGE_TYPE via the real magic-byte check, regardless of the declared ' +
      'filename/Content-Type (adapts profile.e2e-spec.ts\'s spoofed-extension proof)',
    async () => {
      const formData = new FormData();
      // Deliberately named/typed as a JPEG but contains plain text — the sniffed magic bytes must
      // still be what decides this, not the client-declared filename/mimetype.
      formData.set('file', new Blob([Buffer.from('this is not actually an image')], { type: 'image/jpeg' }), 'fake.jpg');

      const res = await picturePOST(uploadRequest(formData, accessToken, 200));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    },
  );

  it(
    'accepts a valid small PNG, writes it to real disk via the real StoragePort, and the persisted pictureKey is visible ' +
      'on a subsequent real GET /api/profile (adapts profile.e2e-spec.ts\'s avatar-upload exit gate)',
    async () => {
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const formData = new FormData();
      formData.set('file', new Blob([validPng], { type: 'image/png' }), 'avatar.png');

      const uploadRes = await picturePOST(uploadRequest(formData, accessToken, validPng.length + 300));
      expect(uploadRes.status).toBe(200);
      const uploadBody = await uploadRes.json();
      expect(uploadBody.pictureKey).toMatch(/\.png$/);

      // Genuinely on disk under the real (observed, not assumed) STORAGE_ROOT — not merely recorded
      // in the DB.
      const onDisk = await readFile(join(storageRoot, uploadBody.pictureKey));
      expect(onDisk.equals(validPng)).toBe(true);

      const getRes = await profileGET(new NextRequest('http://localhost/api/profile', { headers: tenantHeaders(accessToken) }));
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).pictureKey).toBe(uploadBody.pictureKey);
    },
  );
});
