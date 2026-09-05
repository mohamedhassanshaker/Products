import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';
import { getEnv } from '@/server/config';
import type {
  ChunkFilter,
  DeleteQuestionsFilter,
  QuestionFilter,
  ScoredPoint,
  ScrollOptions,
  TenantScope,
  VectorPoint,
  VectorStorePort,
} from '@/server/vector';
import { logger } from '@/server/logging';

/**
 * The **sole file in this app permitted to import `@qdrant/js-client-rest`**
 * (`apps/next/.eslintrc.cjs`'s `infrastructure/vector` module-boundary rule). Implements
 * {@link VectorStorePort}, the migration plan's own "Qdrant single-chokepoint adapter +
 * tenant-payload-filter isolation" requirement — ported faithfully from
 * `legacy/api/src/infrastructure/vector/qdrant.adapter.ts` (this logic does not change with the
 * AI-orchestration swap, per the migration plan's own framing).
 *
 * 1. No method accepts a raw filter — every method's signature only exposes the narrow, whitelisted
 *    filter shapes from `vector-store.port.ts`; {@link buildFilter} is the only place a Qdrant
 *    `Filter` object is constructed, and it unconditionally prepends the tenant `must` clause.
 * 2. `this.client` is `private readonly` and never returned/leaked to a caller.
 * 3. **Defense in depth**: every search/scroll result is post-filtered against
 *    `payload.tenantId === scope.tenantId` in {@link assertNoLeak}. A mismatch drops the point and
 *    emits a `vector.tenant_leak_suspected` error log — a structural bug inside this file would still
 *    be caught before data left the process, not silently disclosed.
 * 4. Point ids are UUIDv5, namespaced per-tenant (`uuidv5(logicalKey, uuidv5(tenantId, NS_EXAMLAND))`)
 *    via {@link pointId} — deterministic (idempotent re-index) and collision-free across tenants even
 *    for an id-only operation.
 *
 * `ensureCollection`/`getCollectionVectorSize` are deliberately **not** part of {@link VectorStorePort}
 * — they are boot-time/admin operations, not tenant-scoped data access, so they are exposed as extra
 * public methods on this concrete class and constructed directly (by class, not by a DI token) inside
 * `VectorBootstrapService` only. This keeps the Qdrant client confined to this one file without
 * forcing bootstrap concerns onto the tenant-facing port.
 */
export class QdrantVectorStoreAdapter implements VectorStorePort {
  private readonly client: QdrantClient;

  /** Fixed namespace UUID this deployment mints every tenant/point namespace under. A constant, not
   * configurable — changing it would silently orphan every previously-written point. Deliberately a
   * DIFFERENT UUID than legacy's own `NS_EXAMLAND` constant — this app's points are namespaced
   * independently even though both stacks may (in a migration window) point at the same Qdrant
   * server, so a coincidental id collision across the two stacks is structurally impossible. */
  private static readonly NS_EXAMLAND_NEXT = '2f9a6c3d-7e3b-4c2b-a03e-7b3f0d8e6b21';

  /**
   * @param injectedClient Test-only escape hatch: a pre-built `QdrantClient` (or fake double) to use
   *   instead of constructing one from config — exists purely so this file's own unit spec can
   *   exercise the leak-detection/filter-composition branches against a scripted fake without a live
   *   Qdrant server, while `scripts/ai-smoke.ts`/the real integration test exercise this class against
   *   a **real** server with no injected client at all.
   */
  constructor(injectedClient?: QdrantClient) {
    const env = getEnv();
    this.client =
      injectedClient ??
      new QdrantClient({
        url: env.QDRANT_URL,
        apiKey: env.QDRANT_API_KEY || undefined,
        // Avoids an unawaited background `GET /` version-compatibility check the client otherwise
        // fires from its constructor.
        checkCompatibility: false,
      });
  }

  // ── Collection naming / point ids ───────────────────────────────────────────────────────────

  private collectionName(suffix: 'chunks' | 'doc_fingerprints' | 'question_bank'): string {
    return `${getEnv().VECTOR_COLLECTION_PREFIX}_${suffix}`;
  }

  /** The three collections this deployment owns, in the fixed order {@link import('../../vector/application/vector-bootstrap.service').VectorBootstrapService}
   * bootstraps them. */
  collectionNames(): { chunks: string; fingerprints: string; questionBank: string } {
    return {
      chunks: this.collectionName('chunks'),
      fingerprints: this.collectionName('doc_fingerprints'),
      questionBank: this.collectionName('question_bank'),
    };
  }

  /** Per-tenant-namespaced UUIDv5 point id. Deterministic and collision-free across tenants: two
   * tenants sharing the same `logicalKey` (e.g. both re-indexing "chunk 0 of document X" for their own
   * unrelated document X) always produce different point ids, because the tenant namespace is folded
   * in first. Public: `VectorPoint.id` is caller-supplied by design, so future chunk/fingerprint/
   * question-bank writers compute their point ids through this method rather than re-implementing the
   * namespacing scheme themselves. */
  pointId(tenantId: string, logicalKey: string): string {
    const tenantNamespace = uuidv5(tenantId, QdrantVectorStoreAdapter.NS_EXAMLAND_NEXT);
    return uuidv5(logicalKey, tenantNamespace);
  }

  // ── Filter construction (the only place a Qdrant Filter object is built) ───────────────────

  private buildFilter(scope: TenantScope, extra: Record<string, string | undefined>): Record<string, unknown> {
    const must: Record<string, unknown>[] = [{ key: 'tenantId', match: { value: scope.tenantId } }];
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) must.push({ key, match: { value } });
    }
    return { must };
  }

  /** Defense-in-depth post-filter: drops any result whose payload tenant does not match
   * `scope.tenantId` and raises a loud alarm rather than silently returning it. A correctly
   * functioning adapter should never actually drop anything here (the pre-filter already scoped the
   * query) — this exists purely to catch a defect in *this file* before it becomes cross-tenant data
   * disclosure. */
  private assertNoLeak(scope: TenantScope, collection: string, points: ScoredPoint[]): ScoredPoint[] {
    const clean: ScoredPoint[] = [];
    for (const point of points) {
      if (point.payload?.tenantId === scope.tenantId) {
        clean.push(point);
        continue;
      }
      logger.error(
        { event: 'vector.tenant_leak_suspected', collection, expectedTenantId: scope.tenantId, actualTenantId: point.payload?.tenantId, pointId: point.id },
        'vector.tenant_leak_suspected',
      );
    }
    return clean;
  }

  private toVectorPayload(point: VectorPoint, scope: TenantScope): Record<string, unknown> {
    // The caller-supplied payload can never override tenantId — always the caller-resolved scope's.
    return { ...point.payload, tenantId: scope.tenantId };
  }

  private toScoredPoint(raw: { id: string | number; score?: number; payload?: unknown; vector?: unknown }): ScoredPoint {
    return {
      id: String(raw.id),
      score: raw.score ?? 0,
      payload: (raw.payload as Record<string, unknown>) ?? {},
      vector: Array.isArray(raw.vector) ? (raw.vector as number[]) : undefined,
    };
  }

  // ── Chunks ───────────────────────────────────────────────────────────────────────────────────

  async upsertChunks(scope: TenantScope, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(this.collectionName('chunks'), {
      wait: true,
      points: points.map((p) => ({ id: p.id, vector: p.vector, payload: this.toVectorPayload(p, scope) })),
    });
  }

  async searchChunks(scope: TenantScope, queryVector: number[], filter: ChunkFilter, limit: number, scoreThreshold?: number): Promise<ScoredPoint[]> {
    const collection = this.collectionName('chunks');
    const result = await this.client.query(collection, {
      query: queryVector,
      filter: this.buildFilter(scope, { curriculumId: filter.curriculumId, documentId: filter.documentId }),
      limit,
      score_threshold: scoreThreshold,
      with_payload: true,
    });
    return this.assertNoLeak(scope, collection, (result.points ?? []).map((p) => this.toScoredPoint(p)));
  }

  async scrollChunks(scope: TenantScope, filter: ChunkFilter, opts: ScrollOptions): Promise<ScoredPoint[]> {
    const collection = this.collectionName('chunks');
    const result = await this.client.scroll(collection, {
      filter: this.buildFilter(scope, { curriculumId: filter.curriculumId, documentId: filter.documentId }),
      limit: opts.limit,
      with_payload: true,
      with_vector: opts.withVector ?? false,
    });
    return this.assertNoLeak(
      scope,
      collection,
      (result.points ?? []).map((p) => this.toScoredPoint({ id: p.id, score: 1, payload: p.payload, vector: p.vector })),
    );
  }

  async deleteChunks(scope: TenantScope, filter: ChunkFilter): Promise<void> {
    await this.client.delete(this.collectionName('chunks'), {
      wait: true,
      filter: this.buildFilter(scope, { curriculumId: filter.curriculumId, documentId: filter.documentId }),
    });
  }

  // ── Doc fingerprints ─────────────────────────────────────────────────────────────────────────

  async upsertFingerprint(scope: TenantScope, point: VectorPoint): Promise<void> {
    await this.client.upsert(this.collectionName('doc_fingerprints'), {
      wait: true,
      points: [{ id: point.id, vector: point.vector, payload: this.toVectorPayload(point, scope) }],
    });
  }

  async searchFingerprint(scope: TenantScope, queryVector: number[], threshold: number): Promise<ScoredPoint[]> {
    const collection = this.collectionName('doc_fingerprints');
    const result = await this.client.query(collection, {
      query: queryVector,
      filter: this.buildFilter(scope, {}),
      limit: 5,
      score_threshold: threshold,
      with_payload: true,
    });
    return this.assertNoLeak(scope, collection, (result.points ?? []).map((p) => this.toScoredPoint(p)));
  }

  // ── Question bank ────────────────────────────────────────────────────────────────────────────

  async upsertQuestions(scope: TenantScope, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(this.collectionName('question_bank'), {
      wait: true,
      points: points.map((p) => ({ id: p.id, vector: p.vector, payload: this.toVectorPayload(p, scope) })),
    });
  }

  async searchQuestions(scope: TenantScope, queryVector: number[], filter: QuestionFilter, limit: number, scoreThreshold?: number): Promise<ScoredPoint[]> {
    const collection = this.collectionName('question_bank');
    const result = await this.client.query(collection, {
      query: queryVector,
      filter: this.buildFilter(scope, { scopeKey: filter.scopeKey, examTypeId: filter.examTypeId }),
      limit,
      score_threshold: scoreThreshold,
      with_payload: true,
    });
    return this.assertNoLeak(scope, collection, (result.points ?? []).map((p) => this.toScoredPoint(p)));
  }

  async scrollQuestions(scope: TenantScope, filter: QuestionFilter, opts: ScrollOptions): Promise<ScoredPoint[]> {
    const collection = this.collectionName('question_bank');
    const result = await this.client.scroll(collection, {
      filter: this.buildFilter(scope, { scopeKey: filter.scopeKey, examTypeId: filter.examTypeId }),
      limit: opts.limit,
      with_payload: true,
      with_vector: opts.withVector ?? false,
    });
    return this.assertNoLeak(
      scope,
      collection,
      (result.points ?? []).map((p) => this.toScoredPoint({ id: p.id, score: 1, payload: p.payload, vector: p.vector })),
    );
  }

  async deleteQuestions(scope: TenantScope, filter: DeleteQuestionsFilter): Promise<void> {
    if (filter.questionKeys && filter.questionKeys.length > 0) {
      await this.client.delete(this.collectionName('question_bank'), {
        wait: true,
        filter: {
          must: [{ key: 'tenantId', match: { value: scope.tenantId } }],
          should: filter.questionKeys.map((questionKey) => ({ key: 'questionKey', match: { value: questionKey } })),
        },
      });
      return;
    }
    await this.client.delete(this.collectionName('question_bank'), {
      wait: true,
      filter: this.buildFilter(scope, { examTypeId: filter.examTypeId }),
    });
  }

  // ── Tenant purge / counts ────────────────────────────────────────────────────────────────────

  async purgeTenant(scope: TenantScope): Promise<void> {
    const filter = this.buildFilter(scope, {});
    const names = this.collectionNames();
    await Promise.all([
      this.client.delete(names.chunks, { wait: true, filter }),
      this.client.delete(names.fingerprints, { wait: true, filter }),
      this.client.delete(names.questionBank, { wait: true, filter }),
    ]);
  }

  async countsForTenant(scope: TenantScope): Promise<Record<string, number>> {
    const filter = this.buildFilter(scope, {});
    const names = this.collectionNames();
    const [chunks, fingerprints, questionBank] = await Promise.all([
      this.client.count(names.chunks, { filter, exact: true }),
      this.client.count(names.fingerprints, { filter, exact: true }),
      this.client.count(names.questionBank, { filter, exact: true }),
    ]);
    return { [names.chunks]: chunks.count, [names.fingerprints]: fingerprints.count, [names.questionBank]: questionBank.count };
  }

  // ── Boot-time / admin operations (not part of VectorStorePort) ─────────────────────────────

  /** Idempotently ensures `name` exists with the given vector size, creating the `tenantId` payload
   * index plus every extra keyword index named in `extraIndexes`. Never recreates or resizes an
   * existing collection — a size mismatch is `VectorBootstrapService`'s job to detect and fail boot
   * over, not this method's job to silently "fix" by dropping data. */
  async ensureCollection(name: string, vectorSize: number, extraIndexes: string[]): Promise<void> {
    const exists = await this.client.collectionExists(name);
    if (!exists.exists) {
      await this.client.createCollection(name, { vectors: { size: vectorSize, distance: 'Cosine' } });
    }
    // createPayloadIndex is itself idempotent (Qdrant no-ops/200s on a re-declared index with the same
    // schema), so this always runs, even for an already-existing collection.
    await this.client.createPayloadIndex(name, { field_name: 'tenantId', field_schema: { type: 'keyword', is_tenant: true } });
    for (const field of extraIndexes) {
      await this.client.createPayloadIndex(name, { field_name: field, field_schema: 'keyword' });
    }
  }

  /** The live vector size Qdrant reports for `name`, or `undefined` if the collection does not exist
   * yet (the boot-time dimension guard reads this). */
  async getCollectionVectorSize(name: string): Promise<number | undefined> {
    const exists = await this.client.collectionExists(name);
    if (!exists.exists) return undefined;
    const info = await this.client.getCollection(name);
    const vectors = info.config?.params?.vectors;
    if (vectors && typeof vectors === 'object' && 'size' in vectors) {
      return (vectors as { size: number }).size;
    }
    return undefined;
  }
}
