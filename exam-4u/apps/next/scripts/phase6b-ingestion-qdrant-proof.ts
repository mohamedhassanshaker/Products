/**
 * Phase 6, sub-slice "6b" — the real, end-to-end Curriculum-ingestion proof this dispatch's exit gate
 * requires: a genuine PDF uploaded through the REAL `POST /api/curricula/:id/documents` Route Handler
 * is genuinely chunked, embedded, and upserted into the REAL Qdrant instance, then read back by a
 * REAL tenant-scoped query, and finally proven tenant-isolated (a second tenant's identical query
 * returns none of the first tenant's points).
 *
 * Deliberately a standalone script, not part of the vitest integration suite: it mutates real Qdrant
 * state and must clean that state up afterward, and it needs the whole provisioning→upload→search
 * chain live in one process. It follows the same shape as `scripts/ai-smoke.ts` (Phase 5's own real-
 * infrastructure proof) rather than inventing a new pattern.
 *
 * Run:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+> JWT_PLATFORM_SECRET=<32+, different> FILE_SIGNING_SECRET=<32+> \
 *     STORAGE_ROOT=<writable dir> npx tsx scripts/phase6b-ingestion-qdrant-proof.ts
 *
 * `EMBEDDINGS_PROVIDER` is left at its default `null` in this environment (no live embeddings
 * credential — see the Phase 5/6a plan docs' identical finding). `NullEmbeddingsAdapter` produces
 * REAL, deterministic hash-derived vectors of the configured dimensionality, so every Qdrant write and
 * read below is genuinely exercised end to end; only the vectors' semantic quality is synthetic, which
 * is a deployment-configuration fact, not a test double.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { getEnv } from '../src/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '../src/server/infrastructure/database';
import { getTenantProvisioningService } from '../src/server/platform/provisioning';
import { getAuthService } from '../src/server/auth';
import { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '../src/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '../src/server/context';
import { getTaxonomyService } from '../src/server/taxonomy';
import { createVectorBootstrapService } from '../src/server/vector';
import { getQdrantVectorStoreAdapter } from '../src/server/infrastructure/vector';
import { getEmbeddingsPort } from '../src/server/infrastructure/embeddings';
import { POST as curriculaPOST } from '../src/app/api/curricula/route';
import { POST as documentsPOST } from '../src/app/api/curricula/[id]/documents/route';
import { GET as searchGET } from '../src/app/api/curricula/[id]/search/route';

const results: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function buildPdf(pageTexts: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const text of pageTexts) {
      doc.addPage();
      doc.text(text);
    }
    doc.end();
  });
}

interface Provisioned {
  id: string;
  slug: string;
  schemaName: string;
  token: string;
  subjectId: number;
}

async function provisionTenant(label: string): Promise<Provisioned> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const provisioning = await getTenantProvisioningService();
  const tenant = await provisioning.provisionNewTenant({ name: `Phase6b ${label}`, subdomainSlug: slug, adminEmail: `admin@${slug}.local` });

  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(tenant.schemaName);
  try {
    return await runWithRequestContext(
      { requestId: randomUUID(), tenantId: tenant.id, tenantSlug: slug, tenantSchema: tenant.schemaName, tenantDataSource: dataSource },
      async () => {
        const auth = await getAuthService();
        const roles = new RoleRepository(requireTenantDataSource());
        const assignment = new UserRoleAssignmentService(roles, new UserRoleRepository(requireTenantDataSource()));
        const email = `admin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const registered = await auth.register({ email, password: 'Abcdefg1', firstName: 'P6b', lastName: 'Admin' });
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded');
        await assignment.replaceRolesForUser(registered.user.id, [tenantAdminRole.id]);
        const token = (await auth.login({ email, password: 'Abcdefg1' })).accessToken;

        const taxonomy = getTaxonomyService();
        const level = await taxonomy.createOrFetchEducationLevel(`Level-${slug}`);
        const stage = await taxonomy.createOrFetchStage(level.entity.id, `Stage-${slug}`);
        const subject = await taxonomy.createOrFetchSubject(stage.entity.id, `Biology-${slug}`);

        return { id: tenant.id, slug, schemaName: tenant.schemaName, token, subjectId: subject.entity.id };
      },
    );
  } finally {
    registry.release(tenant.schemaName);
  }
}

function headers(tenant: Provisioned, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-tenant-id': tenant.id,
    'x-tenant-slug': tenant.slug,
    'x-tenant-schema': tenant.schemaName,
    authorization: `Bearer ${tenant.token}`,
    ...extra,
  };
}

async function createCurriculum(tenant: Provisioned, name: string): Promise<string> {
  const res = await curriculaPOST(
    new NextRequest('http://localhost/api/curricula', {
      method: 'POST',
      headers: headers(tenant, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name, subjectId: tenant.subjectId }),
    }),
  );
  assert(res.status === 201, `expected 201 creating curriculum, got ${res.status}`);
  return (await res.json()).id;
}

async function uploadDocument(tenant: Provisioned, curriculumId: string, pdf: Buffer): Promise<{ id: string; chunkCount: number }> {
  const formData = new FormData();
  formData.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'reference.pdf');
  const res = await documentsPOST(
    new NextRequest(`http://localhost/api/curricula/${curriculumId}/documents`, { method: 'POST', headers: headers(tenant), body: formData }),
    { params: Promise.resolve({ id: curriculumId }) },
  );
  // The body is read exactly once: a failure path reads it for the message, the success path parses
  // it as JSON. (Building the failure message eagerly inside `assert(...)`'s own template literal
  // would consume the body even on success — `Response` bodies are single-use streams.)
  if (res.status !== 201) throw new Error(`ASSERTION FAILED: expected 201 uploading document, got ${res.status} ${await res.text()}`);
  return res.json();
}

async function cleanupTenant(tenant: Provisioned, storageRoot: string): Promise<void> {
  await getQdrantVectorStoreAdapter()
    .purgeTenant({ tenantId: tenant.id })
    .catch(() => undefined);
  const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${tenant.schemaName}\``);
  } finally {
    await conn.end();
  }
  const platformDs = await getPlatformDataSource();
  await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenant.id]);
  await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenant.id]);
  await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenant.id]);
  await rm(join(storageRoot, 'tenants', tenant.id), { recursive: true, force: true });
}

async function main(): Promise<void> {
  const storageRoot = getEnv().STORAGE_ROOT || join(tmpdir(), 'examland-phase6b-proof');
  await mkdir(storageRoot, { recursive: true });

  const adapter = getQdrantVectorStoreAdapter();
  const collections = adapter.collectionNames();
  results.push(`INFO: embeddings provider = ${getEnv().EMBEDDINGS_PROVIDER} (model "${getEmbeddingsPort().model}"), AI_ENABLED = ${getEnv().AI_ENABLED}`);
  results.push(`INFO: qdrant chunks collection = ${collections.chunks}`);

  // Real collections must exist before any upsert — the same boot-time bootstrap the app runs.
  await (await createVectorBootstrapService()).run();
  results.push('PASS: vector collections bootstrapped against real Qdrant');

  const tenantA = await provisionTenant('p6bA');
  // The isolation check below uses a SECOND, synthetic tenant id rather than a second provisioned
  // tenant: Qdrant tenant isolation is a pure vector-store property keyed on `TenantScope.tenantId`
  // (payload filter + the adapter's own post-read leak assertion), so a second MySQL schema would add
  // nothing to the proof while roughly doubling this script's connection footprint against a shared
  // dev MySQL that other work on this host is already using heavily.
  const otherTenantId = randomUUID();
  try {
    const curriculumA = await createCurriculum(tenantA, `Biology-${tenantA.slug}`);

    const beforeA = await adapter.countsForTenant({ tenantId: tenantA.id });
    assert((beforeA[collections.chunks] ?? 0) === 0, 'tenant A must start with zero chunks');
    results.push('PASS: tenant A starts with zero indexed chunks');

    const pdf = await buildPdf([
      'Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose molecules. '.repeat(15),
      'Mitochondria are the powerhouse of the cell, producing ATP through the process of oxidative phosphorylation. '.repeat(15),
    ]);

    const document = await uploadDocument(tenantA, curriculumA, pdf);
    assert(document.chunkCount > 0, 'ingestion must produce at least one real chunk');
    results.push(`PASS: real PDF ingested through the real route — ${document.chunkCount} chunks recorded on curriculum_document`);

    const afterA = await adapter.countsForTenant({ tenantId: tenantA.id });
    assert(
      (afterA[collections.chunks] ?? 0) === document.chunkCount,
      `Qdrant must hold exactly ${document.chunkCount} points for tenant A, found ${afterA[collections.chunks]}`,
    );
    results.push(`PASS: real Qdrant query confirms exactly ${document.chunkCount} points genuinely upserted for tenant A`);

    // The real FR-CUR-3 read path, through the real Route Handler.
    const searchRes = await searchGET(
      new NextRequest(`http://localhost/api/curricula/${curriculumA}/search?query=${encodeURIComponent('photosynthesis glucose')}&limit=5`, {
        headers: headers(tenantA),
      }),
      { params: Promise.resolve({ id: curriculumA }) },
    );
    assert(searchRes.status === 200, `expected 200 from search, got ${searchRes.status}`);
    const hits = await searchRes.json();
    assert(Array.isArray(hits) && hits.length > 0, 'search must return at least one indexed chunk');
    assert(
      hits.every((h: { documentId: string; fileName: string; pageNumber: number }) => h.documentId === document.id && h.fileName === 'reference.pdf' && h.pageNumber > 0),
      'every hit must cite its originating document and a real 1-based page (FR-CUR-3)',
    );
    results.push(`PASS: real semantic search returned ${hits.length} hits, each citing its originating document and page`);

    // ── Tenant isolation, the same standard Phase 5/6a held themselves to ────────────────────────
    const countsB = await adapter.countsForTenant({ tenantId: otherTenantId });
    assert((countsB[collections.chunks] ?? 0) === 0, 'a second tenant must see zero chunks despite tenant A having indexed some');
    results.push('PASS: a second tenant id sees ZERO chunks in the SAME shared collection while tenant A holds real points (payload-filter isolation)');

    // The byte-identical query vector tenant A just matched on, replayed under the other tenant's
    // scope against the same collection — the strongest form of this proof, since only the tenant
    // filter can be what makes the difference.
    const [queryVector] = await getEmbeddingsPort().embed(['photosynthesis glucose']);
    const asA = await adapter.searchChunks({ tenantId: tenantA.id }, queryVector, {}, 10);
    const asOther = await adapter.searchChunks({ tenantId: otherTenantId }, queryVector, {}, 10);
    assert(asA.length > 0, "tenant A's own scoped search must return its indexed chunks");
    assert(asOther.length === 0, `the identical query under another tenant scope must return NOTHING, got ${asOther.length}`);
    results.push(`PASS: identical query vector returns ${asA.length} hits for tenant A and 0 for another tenant — cross-tenant read is structurally impossible`);

    // A second identical ingestion must not duplicate the first document's points (deterministic ids
    // are per-document, so this genuinely adds a second document's worth — asserted explicitly rather
    // than assumed either way).
    const second = await uploadDocument(tenantA, curriculumA, pdf);
    const afterSecond = await adapter.countsForTenant({ tenantId: tenantA.id });
    assert(
      (afterSecond[collections.chunks] ?? 0) === document.chunkCount + second.chunkCount,
      'a second upload records its own document with its own points',
    );
    results.push('PASS: a second ingestion of the same file records its own document/points (per-document point ids, never silently overwriting)');
  } finally {
    await cleanupTenant(tenantA, storageRoot).catch((err) => console.error('cleanup A failed', err));
    await getTenantDataSourceRegistry().destroyAll();
    await (await getPlatformDataSource()).destroy();
  }

  console.log(results.map((r) => `  ${r}`).join('\n'));
  console.log('\nAll Phase 6b ingestion/Qdrant proof assertions passed.');
}

main().catch((err) => {
  console.error(results.map((r) => `  ${r}`).join('\n'));
  console.error(err);
  process.exit(1);
});
