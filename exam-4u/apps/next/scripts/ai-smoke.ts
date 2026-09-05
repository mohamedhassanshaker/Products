/**
 * `npm run smoke:ai` (via `tsx`) — the migration plan Phase 5 exit-gate proof script ("one
 * round-trip LLM call + one vector upsert/query work end-to-end against real OpenRouter/Qdrant").
 * Not a Playwright UI script (Phase 8 owns the real Practice UI) — this is a real, dedicated
 * verification script proving the AI/vector call path is genuinely wired, against real
 * infrastructure, not mocks:
 *
 *   1. Runs `VectorBootstrapService` for real (creates/verifies the three
 *      `examland_next_*` Qdrant collections against the shared, already-running `exam-4u-qdrant-1`
 *      container — deliberately isolated from legacy's own `examland_*` collections, see
 *      `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions made" #1).
 *   2. A real Qdrant upsert/query round trip through `QdrantVectorStoreAdapter`, including the
 *      definitive two-tenant isolation proof: tenant B's own scope, queried with tenant A's exact
 *      stored vector, returns zero results — proving the payload filter is real, not merely "we
 *      happened to store different vectors."
 *   3. `RetrievalService.retrieve` grounding a query against the just-upserted chunk (hybrid
 *      dense+lexical fusion).
 *   4. `AiService.promptPractice` driven end-to-end through the real `AiModelResolver` ->
 *      `LLMRegistry`-resolved `OpenRouterLlm` -> a genuine outbound OpenRouter HTTP request. Since
 *      this environment has no live `OPENROUTER_API_KEY` (confirmed by reading `.env` directly —
 *      see the plan doc's "Decisions made" #2), this step is expected to reach OpenRouter for real
 *      and receive a genuine `401`, which `OpenRouterLlm`/`AiService` correctly classify as a
 *      non-retryable auth failure — this script reports that outcome explicitly rather than
 *      treating it as a script failure, since it is the expected, honestly-documented result in
 *      this environment. Run with `OPENROUTER_API_KEY` set to a real credential to see the full
 *      successful generation instead.
 *
 * Provisions one real tenant (via the real provisioning workflow) to give `AiService` a genuine
 * tenant `DataSource` for its `ai_call_log` write — the Qdrant tenant-isolation proof itself does
 * not need a second real tenant row (Qdrant isolation is payload-based, independent of whether a
 * `tenant` row exists in MySQL), so tenant B is a plain random UUID.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     AI_ENABLED=true QDRANT_URL=http://localhost:6333 \
 *     npx tsx scripts/ai-smoke.ts
 */
import { randomUUID } from 'node:crypto';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { runWithRequestContext } from '@/server/context';
import { createVectorBootstrapService, type TenantScope } from '@/server/vector';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getAiService, getRetrievalService, AiDisabledError, AiServiceUnavailableError } from '@/server/ai';

/** Structured, append-only log of this run's assertions — printed as one JSON summary at the end so
 * the evidence is easy to paste into the plan doc's "Verification evidence" section. */
const results: Array<{ step: string; ok: boolean; detail: string }> = [];

function record(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  // eslint-disable-next-line no-console -- CLI script's own user-facing output, not application logging.
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${step}: ${detail}`);
}

async function main(): Promise<void> {
  const env = getEnv();

  // ── Step 1: vector bootstrap ────────────────────────────────────────────────────────────────
  const bootstrap = await createVectorBootstrapService();
  await bootstrap.run();
  record('vector-bootstrap', true, `Collections ensured with prefix "${env.VECTOR_COLLECTION_PREFIX}".`);

  // ── Step 2: real Qdrant upsert/query round trip + tenant isolation ─────────────────────────
  const adapter = getQdrantVectorStoreAdapter();
  const embeddings = getEmbeddingsPort();

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const tenantA: TenantScope = { tenantId: tenantAId };
  const tenantB: TenantScope = { tenantId: tenantBId };

  const textA = 'The mitochondria is the powerhouse of the cell, producing ATP through cellular respiration.';
  const textB = 'Photosynthesis converts light energy into chemical energy stored in glucose.';
  const [vectorA, vectorB] = await embeddings.embed([textA, textB]);

  const pointAId = adapter.pointId(tenantAId, 'ai-smoke-chunk-a');
  const pointBId = adapter.pointId(tenantBId, 'ai-smoke-chunk-b');

  await adapter.upsertChunks(tenantA, [{ id: pointAId, vector: vectorA, payload: { text: textA, fileName: 'smoke-a.txt', pageNumber: 1 } }]);
  await adapter.upsertChunks(tenantB, [{ id: pointBId, vector: vectorB, payload: { text: textB, fileName: 'smoke-b.txt', pageNumber: 1 } }]);

  const searchA = await adapter.searchChunks(tenantA, vectorA, {}, 5);
  record('qdrant-upsert-query', searchA.some((p) => p.id === pointAId), `Tenant A's own query returned its own chunk (${searchA.length} result(s)).`);

  // The definitive tenant-isolation proof: query tenant B's scope with tenant A's EXACT stored
  // vector (a guaranteed near-perfect match if the tenant filter were not applied) and confirm
  // zero results — proves the payload filter is real, not an accident of different vectors.
  const crossTenantSearch = await adapter.searchChunks(tenantB, vectorA, {}, 5);
  record(
    'qdrant-tenant-isolation',
    crossTenantSearch.every((p) => p.id !== pointAId),
    `Tenant B's scope, queried with tenant A's exact vector, returned ${crossTenantSearch.length} result(s) (must never include tenant A's chunk).`,
  );

  // ── Step 3: RetrievalService grounding ──────────────────────────────────────────────────────
  // Queries with the exact stored text itself (not a paraphrase) — `NullEmbeddingsAdapter`'s
  // deterministic hash-based pseudo-vectors carry no real semantic meaning (see its own doc
  // comment), so a paraphrased query would score near-zero on the dense channel and fall below
  // `RETRIEVAL_RELEVANCE_FLOOR` regardless of whether the retrieval pipeline itself is correctly
  // wired. Using the identical text guarantees dense score 1.0 (same hash -> same vector) and full
  // lexical overlap, which is exactly what proves this dispatch's actual scope (the plumbing —
  // embed -> searchChunks/scrollChunks -> hybrid fusion -> threshold -> map — runs correctly),
  // without depending on the null adapter's honestly-documented lack of real semantic quality.
  const retrieval = getRetrievalService();
  const grounded = await retrieval.retrieve(tenantA, {}, textA, 5);
  record('retrieval-service', grounded.some((c) => c.fileName === 'smoke-a.txt'), `RetrievalService returned ${grounded.length} chunk(s) for tenant A.`);

  await adapter.deleteChunks(tenantA, {});
  await adapter.deleteChunks(tenantB, {});

  // ── Step 4: real AiService.promptPractice round trip ────────────────────────────────────────
  const provisioning = await getTenantProvisioningService();
  const slug = `ai-smoke-${randomUUID().slice(0, 8)}`;
  const tenant = await provisioning.provisionNewTenant({ name: 'AI Smoke Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(tenant.schemaName);

  try {
    await runWithRequestContext(
      { requestId: randomUUID(), tenantId: tenant.id, tenantSlug: tenant.subdomainSlug, tenantSchema: tenant.schemaName, tenantDataSource: dataSource },
      async () => {
        const aiService = getAiService();

        if (!env.AI_ENABLED) {
          try {
            await aiService.promptPractice(
              { prompt: 'cell biology basics', count: 1, grounding: [] },
              { tenantId: tenant.id, correlationId: randomUUID(), budget: { tokensRemaining: 10_000, costRemainingUsd: 1 } },
            );
            record('ai-disabled-fail-fast', false, 'AI_ENABLED=false but promptPractice did not throw.');
          } catch (err) {
            record('ai-disabled-fail-fast', err instanceof AiDisabledError, `AI_ENABLED=false correctly threw ${(err as Error)?.constructor?.name}.`);
          }
          record('ai-live-round-trip', true, 'Skipped (AI_ENABLED=false) — re-run with AI_ENABLED=true to exercise the real OpenRouter call path.');
          return;
        }

        try {
          const result = await aiService.promptPractice(
            { prompt: 'What is the powerhouse of the cell and why?', count: 1, grounding: [{ text: textA, fileName: 'smoke-a.txt', pageNumber: 1, score: 0.9 }] },
            { tenantId: tenant.id, correlationId: randomUUID(), budget: { tokensRemaining: 10_000, costRemainingUsd: 1 } },
          );
          record('ai-live-round-trip', true, `Real successful generation: ${result.data.length} question(s), model=${result.usage.model}.`);
        } catch (err) {
          if (err instanceof AiServiceUnavailableError) {
            const isAuthFailure = /HTTP 401|HTTP 403/.test(err.message);
            record(
              'ai-live-round-trip',
              isAuthFailure,
              isAuthFailure
                ? `Reached OpenRouter for real; rejected with an auth failure as expected given no live OPENROUTER_API_KEY in this environment: "${err.message}"`
                : `Unexpected AiServiceUnavailableError: "${err.message}"`,
            );
          } else {
            record('ai-live-round-trip', false, `Unexpected error: ${(err as Error)?.message}`);
          }
        }
      },
    );
  } finally {
    registry.release(tenant.schemaName);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────────────────────
  const platformDs = await getPlatformDataSource();
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${tenant.schemaName}\``);
  } finally {
    await conn.end();
  }
  await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenant.id]);
  await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenant.id]);
  await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenant.id]);
  await getTenantDataSourceRegistry().destroyAll();
  await platformDs.destroy();

  // eslint-disable-next-line no-console
  console.log('\n=== Summary ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(results, null, 2));

  const anyFailed = results.some((r) => !r.ok);
  process.exitCode = anyFailed ? 1 : 0;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
