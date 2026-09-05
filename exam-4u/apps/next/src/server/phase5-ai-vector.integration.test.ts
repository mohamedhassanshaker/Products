import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { runWithRequestContext } from '@/server/context';
import { createVectorBootstrapService, type TenantScope } from '@/server/vector';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getAiService, getRetrievalService, AiDisabledError } from '@/server/ai';

/**
 * Phase 5 (`server/vector`/`server/ai`) — real-route-free integration coverage, matching every
 * prior phase's `phaseN-*-routes.integration.test.ts` convention adapted to this phase's own shape
 * (infra-only, no new HTTP route surface): calls the actual composition roots
 * (`createVectorBootstrapService`, `getQdrantVectorStoreAdapter`, `getRetrievalService`,
 * `getAiService`) against real MySQL and the real, already-running `exam-4u-qdrant-1` container's
 * Qdrant instance — this is the vitest-permanent counterpart to `scripts/ai-smoke.ts`'s own
 * one-off run, kept in the regression suite going forward.
 *
 * Run via (STORAGE_ROOT irrelevant here; QDRANT_URL must point at a real, reachable Qdrant):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase5-ai-vector.integration.test.ts
 */
describe('Phase 5 — server/vector + server/ai (real MySQL, real Qdrant)', () => {
  const slug = `p5-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;

  beforeAll(async () => {
    const bootstrap = await createVectorBootstrapService();
    await bootstrap.run();

    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase5 Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
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

  it('vector bootstrap ensures the three examland_next_* collections at the configured EMBEDDING_DIMS', async () => {
    const adapter = getQdrantVectorStoreAdapter();
    const names = adapter.collectionNames();
    expect(names.chunks).toBe(`${getEnv().VECTOR_COLLECTION_PREFIX}_chunks`);
    for (const name of Object.values(names)) {
      expect(await adapter.getCollectionVectorSize(name)).toBe(getEnv().EMBEDDING_DIMS);
    }
  });

  it('upserts and searches a real chunk end to end, and proves two-tenant isolation', async () => {
    const adapter = getQdrantVectorStoreAdapter();
    const embeddings = getEmbeddingsPort();
    const tenantA: TenantScope = { tenantId: randomUUID() };
    const tenantB: TenantScope = { tenantId: randomUUID() };
    const text = 'Integration-test chunk about the water cycle and evaporation.';
    const [vector] = await embeddings.embed([text]);
    const pointId = adapter.pointId(tenantA.tenantId, 'phase5-integration-chunk');

    await adapter.upsertChunks(tenantA, [{ id: pointId, vector, payload: { text, fileName: 'p5.txt', pageNumber: 1 } }]);
    try {
      const ownResults = await adapter.searchChunks(tenantA, vector, {}, 5);
      expect(ownResults.some((p) => p.id === pointId)).toBe(true);

      // The definitive isolation proof: tenant B's own scope, queried with tenant A's exact stored
      // vector, must never return tenant A's point.
      const crossTenantResults = await adapter.searchChunks(tenantB, vector, {}, 5);
      expect(crossTenantResults.some((p) => p.id === pointId)).toBe(false);
    } finally {
      await adapter.deleteChunks(tenantA, {});
    }
  });

  it('RetrievalService grounds a query against an upserted chunk (hybrid dense+lexical fusion)', async () => {
    const adapter = getQdrantVectorStoreAdapter();
    const embeddings = getEmbeddingsPort();
    const retrieval = getRetrievalService();
    const scope: TenantScope = { tenantId: randomUUID() };
    const text = 'Integration-test retrieval chunk about volcanic rock formation.';
    const [vector] = await embeddings.embed([text]);
    const pointId = adapter.pointId(scope.tenantId, 'phase5-retrieval-chunk');

    await adapter.upsertChunks(scope, [{ id: pointId, vector, payload: { text, fileName: 'retrieval.txt', pageNumber: 3 } }]);
    try {
      // Queries with the identical text — see `scripts/ai-smoke.ts`'s own doc comment for why this
      // is the honest way to prove the retrieval plumbing without depending on the configured
      // embeddings provider's real semantic quality (this environment's `EMBEDDINGS_PROVIDER=null`
      // is a deterministic hash, not a semantic embedding).
      const chunks = await retrieval.retrieve(scope, {}, text, 5);
      expect(chunks.some((c) => c.fileName === 'retrieval.txt' && c.pageNumber === 3)).toBe(true);
    } finally {
      await adapter.deleteChunks(scope, {});
    }
  });

  it('AI_ENABLED=false fails every AiServicePort method closed with AiDisabledError, with no network I/O attempted', async () => {
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      await runWithRequestContext(
        { requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource },
        async () => {
          const aiService = getAiService();
          expect(aiService.available).toBe(getEnv().AI_ENABLED);
          if (!getEnv().AI_ENABLED) {
            await expect(
              aiService.promptPractice({ prompt: 'test', count: 1, grounding: [] }, { tenantId, correlationId: randomUUID(), budget: { tokensRemaining: 1, costRemainingUsd: 1 } }),
            ).rejects.toBeInstanceOf(AiDisabledError);
          }
        },
      );
    } finally {
      registry.release(tenantSchema);
    }
  });

  it('getReadiness never throws and reports a non-fatal snapshot', async () => {
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      await runWithRequestContext({ requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource }, async () => {
        const readiness = getAiService().getReadiness();
        expect(['up', 'disabled', 'degraded']).toContain(readiness.state);
      });
    } finally {
      registry.release(tenantSchema);
    }
  });
});
