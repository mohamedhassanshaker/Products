/**
 * Phase 6, sub-slice "6d" — the real cross-tenant isolation proof this dispatch's exit gate requires
 * for "Find similar questions": a query from one tenant must never return another tenant's indexed
 * question-bank points, even when both tenants index the byte-identical question text (the strongest
 * form of this proof — only the mandatory `TenantScope.tenantId` filter can account for the
 * difference, not merely differing vector content).
 *
 * **A synthetic second `tenantId`, not a full second provisioned tenant/schema** — mirrors
 * `scripts/phase6b-ingestion-qdrant-proof.ts`'s own identical, documented judgment call: Qdrant tenant
 * isolation is a pure vector-store property keyed on `TenantScope.tenantId` (payload filter + the
 * adapter's own post-read leak assertion), so a second real MySQL schema would add nothing to this
 * proof while adding connection pressure to an already-strained shared dev MySQL host (73+ accumulated
 * tenant schemas at the time of this dispatch). Both writes/reads below go through the REAL
 * `QuestionBankIndexingService`/`QdrantVectorStoreAdapter` against the REAL `exam-4u-qdrant-1`
 * instance — nothing here is mocked.
 *
 * Run:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     npx tsx scripts/phase6d-cross-tenant-isolation-proof.ts
 */
import { randomUUID } from 'node:crypto';
import { getQdrantVectorStoreAdapter } from '../src/server/infrastructure/vector';
import { getEmbeddingsPort } from '../src/server/infrastructure/embeddings';
import { createVectorBootstrapService } from '../src/server/vector';
import { QuestionBankIndexingService } from '../src/server/pdf-processing';
import { ExamTypeQuestionEntity } from '../src/server/infrastructure/database';

const results: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function fakeQuestion(examTypeId: string, questionText: string): ExamTypeQuestionEntity {
  return Object.assign(new ExamTypeQuestionEntity(), {
    id: randomUUID(),
    examTypeId,
    moduleName: 'Module: Organelles',
    questionKey: `gq_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    questionText,
    optionsJson: { A: 'Mitochondria', B: 'Nucleus' },
    correctAnswer: 'A',
    explanation: null,
    sourceGeneratedQuestionId: randomUUID(),
  });
}

async function main(): Promise<void> {
  const adapter = getQdrantVectorStoreAdapter();
  const embeddings = getEmbeddingsPort();
  await (await createVectorBootstrapService()).run();
  results.push('PASS: vector collections bootstrapped against real Qdrant');

  const indexing = new QuestionBankIndexingService(adapter, embeddings, adapter);

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const sharedText = 'Cross-tenant isolation probe: what is the powerhouse of the cell?';

  try {
    // Real, unmocked indexing writes for BOTH tenants, the byte-identical question text — the
    // strongest form of this proof (only the tenant filter, never differing vector content, can
    // explain any difference in what each tenant's own query returns).
    await indexing.indexQuestions(tenantA, `et-a-${tenantA}`, 'Tenant A Exam', [fakeQuestion(`et-a-${tenantA}`, sharedText)]);
    await indexing.indexQuestions(tenantB, `et-b-${tenantB}`, 'Tenant B Exam', [fakeQuestion(`et-b-${tenantB}`, sharedText)]);
    results.push('PASS: real, unmocked QuestionBankIndexingService writes committed for two distinct tenants with byte-identical question text');

    const [queryVector] = await embeddings.embed([sharedText]);

    const asA = await adapter.searchQuestions({ tenantId: tenantA }, queryVector, {}, 10, 0);
    const asB = await adapter.searchQuestions({ tenantId: tenantB }, queryVector, {}, 10, 0);

    assert(asA.length === 1, `expected tenant A to see exactly its own 1 point, saw ${asA.length}`);
    assert(asB.length === 1, `expected tenant B to see exactly its own 1 point, saw ${asB.length}`);
    assert(asA[0].payload.examTypeId === `et-a-${tenantA}`, "tenant A's own result must be its own point, not tenant B's");
    assert(asB[0].payload.examTypeId === `et-b-${tenantB}`, "tenant B's own result must be its own point, not tenant A's");
    results.push('PASS: the byte-identical query vector returns ONLY each tenant\'s own point under its own scope — never the other tenant\'s, despite identical vector content (payload-filter tenant isolation)');

    // A third, never-indexed tenant must see zero points despite two other tenants holding real ones
    // in the same shared collection.
    const tenantC = randomUUID();
    const asC = await adapter.searchQuestions({ tenantId: tenantC }, queryVector, {}, 10, 0);
    assert(asC.length === 0, `expected an uninvolved third tenant to see zero points, saw ${asC.length}`);
    results.push('PASS: a third, uninvolved tenant sees zero points in the same shared collection');
  } finally {
    // Best-effort cleanup — this script's own throwaway synthetic tenant ids, purged so this proof
    // never leaves orphan points behind in the shared Qdrant instance.
    await adapter.deleteQuestions({ tenantId: tenantA }, {});
    await adapter.deleteQuestions({ tenantId: tenantB }, {});
  }

  console.log(results.map((r) => `  ${r}`).join('\n'));
  console.log('\nPhase 6 sub-slice "6d" cross-tenant isolation proof passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
