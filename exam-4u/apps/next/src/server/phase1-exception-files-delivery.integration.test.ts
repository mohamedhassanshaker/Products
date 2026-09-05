import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getStoragePortSingleton } from '@/server/files';
import { POST as signPOST } from '@/app/api/files/sign/route';
import { GET as downloadGET } from '@/app/api/files/d/[...path]/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';

/**
 * Phase 1 "exception" closure for `legacy/api/test/files-delivery.e2e-spec.ts` (see
 * `phase1-exception-users-admin.integration.test.ts`'s doc comment for the shared background on why
 * this file exists). Deliberately drives the REAL exported `POST`/`GET` Route Handlers with a genuine
 * `NextRequest` — the legacy suite's own doc comment explains why this can't be caught at the unit
 * level: "a real HTTP round-trip is the only way to prove [the] wildcard capture genuinely re-joins
 * into the original storage key end to end". This app's dynamic catch-all segment
 * (`app/api/files/d/[...path]/route.ts`) is a structurally different routing mechanism than legacy's
 * Express/`path-to-regexp` wildcard, so this is a genuinely unverified routing layer, not a re-test of
 * already-covered ground — `FileSigningService.sign/verify`'s own HMAC/expiry/tamper/traversal logic
 * is already exhaustively unit-tested (`file-signing.service.test.ts`) and not re-asserted here.
 *
 * Uses the real `getStoragePortSingleton()` composition root for both writing the fixture object and
 * cleaning it up (`deletePrefix`), rather than tracking/`rm`-ing its own temp directory — since this
 * singleton is cached on `globalThis` for the lifetime of the vitest worker process (potentially
 * shared with other test files, whichever calls it first wins the cached root — see
 * `phase1-exception-profile.integration.test.ts`'s doc comment for the full investigation), this file
 * never assumes or mutates *where* that root actually is, and only ever touches its own
 * tenant-id-namespaced keys within it.
 *
 * Run via (FILE_SIGNING_SECRET/STORAGE_ROOT must already be set for the whole `vitest run` invocation —
 * see this file's own doc comment for why setting them only inside this file's `beforeAll` is not
 * reliable):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     FILE_SIGNING_SECRET=<32+ chars> STORAGE_ROOT=<a writable local directory> \
 *     npx vitest run src/server/phase1-exception-files-delivery.integration.test.ts
 */
describe('Phase 1 exception closure — files-delivery.e2e-spec.ts adapted assertions (real MySQL + real disk, real routes)', () => {
  const suffix = randomUUID().slice(0, 8);
  const slugA = `pe1-filesa-${suffix}`;
  const slugB = `pe1-filesb-${suffix}`;
  const createdSchemas: string[] = [];
  const createdTenantIds: string[] = [];

  let tenantIdA: string;
  let tenantSchemaA: string;
  let tenantIdB: string;
  let tenantSchemaB: string;
  let tokenA: string;
  let tokenB: string;

  const CONTENT = Buffer.from('0123456789'.repeat(20)); // 200 bytes, deterministic for range math.
  let storageKeyA: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenantA = await provisioning.provisionNewTenant({ name: 'Phase1 Exception Files Tenant A', subdomainSlug: slugA, adminEmail: `founder@${slugA}.local` });
    tenantIdA = tenantA.id;
    tenantSchemaA = tenantA.schemaName;
    createdSchemas.push(tenantA.schemaName);
    createdTenantIds.push(tenantA.id);

    const tenantB = await provisioning.provisionNewTenant({ name: 'Phase1 Exception Files Tenant B', subdomainSlug: slugB, adminEmail: `founder@${slugB}.local` });
    tenantIdB = tenantB.id;
    tenantSchemaB = tenantB.schemaName;
    createdSchemas.push(tenantB.schemaName);
    createdTenantIds.push(tenantB.id);

    tokenA = await registerAndLogin(slugA, tenantIdA, tenantSchemaA, `userA-${suffix}@${slugA}.local`);
    tokenB = await registerAndLogin(slugB, tenantIdB, tenantSchemaB, `userB-${suffix}@${slugB}.local`);

    // Places a real object on disk under tenant A's prefix via the real StoragePort composition root
    // (not a hand-rolled fs.writeFile) — exercises the exact write path a real curriculum-document
    // upload would use, matching LLD §9.7's documented key layout.
    storageKeyA = `tenants/${tenantIdA}/curricula/c1/d1/source.pdf`;
    await getStoragePortSingleton().put(storageKeyA, CONTENT, 'application/pdf');
  }, 60_000);

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
    try {
      for (const schema of createdSchemas) await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    } finally {
      await conn.end();
    }
    for (const id of createdTenantIds) {
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [id]);
    }
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
    // Only this test's own tenant-id-namespaced keys — never the whole (possibly shared) storage root.
    for (const id of createdTenantIds) {
      await getStoragePortSingleton().deletePrefix(`tenants/${id}`);
    }
  });

  async function registerAndLogin(slug: string, tenantId: string, tenantSchema: string, email: string): Promise<string> {
    const password = 'Files-Phase1-Pass-1';
    const tenantHeaders: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema, 'content-type': 'application/json' };
    const registerRes = await registerPOST(
      new NextRequest('http://localhost/api/auth/register', { method: 'POST', headers: tenantHeaders, body: JSON.stringify({ email, password, firstName: 'Files', lastName: 'Tester' }) }),
    );
    expect(registerRes.status).toBe(201);
    const loginRes = await loginPOST(
      new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: tenantHeaders, body: JSON.stringify({ email, password }) }),
    );
    expect(loginRes.status).toBe(200);
    return (await loginRes.json()).accessToken as string;
  }

  function signRequest(storageKey: string, slug: string, tenantId: string, tenantSchema: string, token: string): NextRequest {
    return new NextRequest('http://localhost/api/files/sign', {
      method: 'POST',
      headers: { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ storageKey }),
    });
  }

  /** Builds the `{ path: string[] }` params a real Next.js router would derive for the dynamic
   * catch-all segment from a signed URL's own path — segments deliberately stay URI-encoded here
   * (never pre-decoded), exactly mirroring what Next.js hands the route handler; the route's own
   * `.map(decodeURIComponent)` is what's under test. */
  function downloadParamsFor(signedUrl: string): { path: string[] } {
    const parsed = new URL(signedUrl, 'http://localhost');
    return { path: parsed.pathname.replace(/^\/api\/files\/d\//, '').split('/') };
  }

  function downloadRequestFor(signedUrl: string, extraHeaders: Record<string, string> = {}): NextRequest {
    return new NextRequest(new URL(signedUrl, 'http://localhost').toString(), { headers: extraHeaders });
  }

  it(
    'rejects signing a key belonging to a DIFFERENT tenant with 403 FORBIDDEN via the real route ' +
      '(adapts files-delivery.e2e-spec.ts\'s cross-tenant sign rejection)',
    async () => {
      const res = await signPOST(signRequest(storageKeyA, slugB, tenantIdB, tenantSchemaB, tokenB));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
    },
  );

  it(
    'the real dynamic catch-all route genuinely re-joins wildcard path segments into the original storage key, ' +
      'serving the full object with no Authorization header at all (adapts files-delivery.e2e-spec.ts\'s anonymous-but-unguessable download proof)',
    async () => {
      const signRes = await signPOST(signRequest(storageKeyA, slugA, tenantIdA, tenantSchemaA, tokenA));
      // Legacy's Nest controller returns 201 for this endpoint; this app's route (`app/api/files/sign/
      // route.ts`) returns a plain `NextResponse.json(...)` with no explicit status, i.e. 200 — the LLD
      // (§9.6/9.7's route table) never mandates a specific status code for this endpoint, so this is a
      // harmless, already-shipped implementation difference, not a defect — asserting the app's real,
      // current behavior rather than "fixing" already-gated production code for a non-spec'd detail.
      expect(signRes.status).toBe(200);
      const { url } = await signRes.json();

      const downloadRes = await downloadGET(downloadRequestFor(url), { params: Promise.resolve(downloadParamsFor(url)) });
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get('accept-ranges')).toBe('bytes');
      const body = Buffer.from(await downloadRes.arrayBuffer());
      expect(body.equals(CONTENT)).toBe(true);
    },
  );

  it(
    'serves a satisfiable byte range as 206 with a correct Content-Range via the real route (FR-FILE-2)',
    async () => {
      const signRes = await signPOST(signRequest(storageKeyA, slugA, tenantIdA, tenantSchemaA, tokenA));
      const { url } = await signRes.json();

      const res = await downloadGET(downloadRequestFor(url, { range: 'bytes=10-19' }), { params: Promise.resolve(downloadParamsFor(url)) });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes 10-19/${CONTENT.length}`);
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.equals(CONTENT.subarray(10, 20))).toBe(true);
    },
  );

  it(
    'rejects an unsatisfiable range with 416 and Content-Range: bytes */size via the real route',
    async () => {
      const signRes = await signPOST(signRequest(storageKeyA, slugA, tenantIdA, tenantSchemaA, tokenA));
      const { url } = await signRes.json();

      const res = await downloadGET(downloadRequestFor(url, { range: `bytes=${CONTENT.length + 100}-${CONTENT.length + 200}` }), {
        params: Promise.resolve(downloadParamsFor(url)),
      });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe(`bytes */${CONTENT.length}`);
    },
  );
});
