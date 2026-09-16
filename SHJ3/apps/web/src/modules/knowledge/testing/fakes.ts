/**
 * In-memory implementations of every `knowledge` port — mirrors `modules/tools/testing/
 * fakes.ts`'s own conventions exactly: ids are generated, never accepted; every documented
 * rejection reason is reachable from a test; deterministic counters so assertions can name
 * rows. Not a `.test.ts` file — this module's own test support, held to the same lint rules
 * as production code.
 */

import type {
  ChunkRepository,
  ChunkRow,
  NewChunkInput,
  NewSourceDocumentInput,
  SourceDocumentRow,
} from "../ports/chunk-repository.js";
import type { ConflictRepository, SourceConflictRow } from "../ports/conflict-repository.js";
import type {
  GraphDuplicateCandidateRow,
  GraphNodeRecordRow,
  GraphRepository,
  UpsertGraphEdgeRecordInput,
  UpsertGraphNodeRecordInput,
} from "../ports/graph-repository.js";
import type {
  ChunkDocumentInput,
  ChunkDocumentResult,
  DetectDuplicatesInput,
  DetectDuplicatesResult,
  EmbedAndIndexInput,
  EmbedAndIndexResult,
  GraphBrowseInput,
  GraphBrowseResult,
  GraphInvariantsResult,
  KnowledgeAiClient,
  MergeOrIgnoreDuplicateInput,
  ReconcileInspectInput,
  ReconcileInspectResult,
  RetrievalQueryInput,
  RetrievalQueryResult,
  UpsertGraphNodeInput,
  UpsertGraphNodeResult,
} from "../ports/knowledge-ai-client.js";
import type {
  CompleteIngestionRunInput,
  IngestionRunRow,
  KnowledgeCollectionRow,
  KnowledgeSourceRepository,
  KnowledgeSourceRow,
  NewIngestionRunInput,
  NewKnowledgeSourceInput,
} from "../ports/knowledge-source-repository.js";
import type {
  NewOutboxEventInput,
  OutboxEventRow,
  OutboxRepository,
} from "../ports/outbox-repository.js";
import type {
  CompleteReconciliationRunInput,
  NewReconciliationRunInput,
  ReconciliationRepository,
  ReconciliationRunRow,
} from "../ports/reconciliation-repository.js";
import type {
  NewReindexJobInput,
  ReindexJobRepository,
  ReindexJobRow,
  UpdateReindexJobProgressInput,
} from "../ports/reindex-job-repository.js";
import type {
  NewPlaygroundRunInput,
  RetrievalConfigRepository,
  RetrievalConfigRow,
  UpdateRetrievalConfigInput,
} from "../ports/retrieval-config-repository.js";
import { RETRIEVAL_CONFIG_DEFAULTS } from "../domain/retrieval-config.js";
import type { DerivedIndexState, SourceStatus } from "../domain/knowledge-catalog.js";

let sharedCounter = 0;
/** One shared counter across every fake in this file so seeded ids never collide across ports within one test, matching `tools/testing/fakes.ts`'s per-class counters but shared here since several fakes cross-reference each other's ids (e.g. a chunk id inside a duplicate candidate's evidence). */
function nextId(prefix: string): string {
  sharedCounter += 1;
  return `${prefix}_fake_${sharedCounter}`;
}

// ---------------------------------------------------------------------------
// KnowledgeSourceRepository
// ---------------------------------------------------------------------------

export class FakeKnowledgeSourceRepository implements KnowledgeSourceRepository {
  private readonly sources = new Map<string, KnowledgeSourceRow>();
  private collection: KnowledgeCollectionRow | null = null;
  private readonly runs = new Map<
    string,
    IngestionRunRow & { readonly knowledgeSourceId: string }
  >();
  private readonly runHistory: {
    readonly id: string;
    readonly knowledgeSourceId: string;
    readonly trigger: string;
    readonly state: string;
    readonly startedAt: Date;
    readonly finishedAt: Date | null;
    readonly error: string | null;
  }[] = [];

  seed(row: KnowledgeSourceRow): void {
    this.sources.set(row.id, row);
  }

  seedCollection(row: KnowledgeCollectionRow): void {
    this.collection = row;
  }

  async listSources(): Promise<readonly KnowledgeSourceRow[]> {
    return [...this.sources.values()]
      .filter((row) => row.removedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSource(id: string): Promise<KnowledgeSourceRow | null> {
    const row = this.sources.get(id);
    return row && row.removedAt === null ? row : null;
  }

  async ensureDefaultCollection(now: Date): Promise<KnowledgeCollectionRow> {
    void now;
    this.collection ??= {
      id: nextId("collection"),
      name: "Tenant knowledge base",
      slug: "default",
    };
    return this.collection;
  }

  async createSource(input: NewKnowledgeSourceInput): Promise<KnowledgeSourceRow> {
    const row: KnowledgeSourceRow = {
      id: nextId("source"),
      knowledgeCollectionId: input.knowledgeCollectionId,
      name: input.name,
      sourceType: input.sourceType,
      location: input.location,
      schedule: input.schedule,
      status: "Idle",
      documentCount: 0,
      chunkCount: 0,
      indexedChunkCount: 0,
      indexedPercent: 0,
      lastCrawledAt: null,
      nextScheduledAt: null,
      lastError: null,
      credentialSecretRef: input.credentialSecretRef,
      removedAt: null,
    };
    this.sources.set(row.id, row);
    return row;
  }

  async setStatus(id: string, status: SourceStatus, now: Date): Promise<void> {
    void now;
    const existing = this.sources.get(id);
    if (!existing) throw new Error(`No such knowledge source: "${id}".`);
    this.sources.set(id, { ...existing, status });
  }

  async recordLastError(id: string, error: string | null, now: Date): Promise<void> {
    void now;
    const existing = this.sources.get(id);
    if (!existing) throw new Error(`No such knowledge source: "${id}".`);
    this.sources.set(id, { ...existing, lastError: error });
  }

  async softDeleteSource(id: string, now: Date): Promise<void> {
    const existing = this.sources.get(id);
    if (!existing) throw new Error(`No such knowledge source: "${id}".`);
    this.sources.set(id, { ...existing, removedAt: now });
  }

  async startIngestionRun(input: NewIngestionRunInput): Promise<IngestionRunRow> {
    const row = {
      id: nextId("run"),
      knowledgeSourceId: input.knowledgeSourceId,
      state: "Running" as const,
    };
    this.runs.set(row.id, row);
    this.runHistory.push({
      id: row.id,
      knowledgeSourceId: input.knowledgeSourceId,
      trigger: input.trigger,
      state: "Running",
      startedAt: input.startedAt,
      finishedAt: null,
      error: null,
    });
    return row;
  }

  async completeIngestionRun(input: CompleteIngestionRunInput): Promise<void> {
    const index = this.runHistory.findIndex((run) => run.id === input.id);
    const run = index === -1 ? undefined : this.runHistory[index];
    if (index === -1 || !run) throw new Error(`No such ingestion run: "${input.id}".`);
    this.runHistory[index] = {
      ...run,
      state: input.state,
      finishedAt: input.finishedAt,
      error: input.error,
    };

    const source = this.sources.get(run.knowledgeSourceId);
    if (source) {
      this.sources.set(run.knowledgeSourceId, {
        ...source,
        status: input.state === "Completed" ? "Idle" : "Failed",
        lastCrawledAt: input.state === "Completed" ? input.finishedAt : source.lastCrawledAt,
        lastError: input.error,
      });
    }
  }

  async listIngestionRuns(knowledgeSourceId: string) {
    return this.runHistory
      .filter((run) => run.knowledgeSourceId === knowledgeSourceId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .map(({ id, trigger, state, startedAt, finishedAt, error }) => ({
        id,
        trigger,
        state,
        startedAt,
        finishedAt,
        error,
      }));
  }
}

// ---------------------------------------------------------------------------
// ChunkRepository
// ---------------------------------------------------------------------------

export class FakeChunkRepository implements ChunkRepository {
  private readonly documents = new Map<string, SourceDocumentRow>();
  private readonly chunks = new Map<string, ChunkRow>();

  seedChunk(row: ChunkRow): void {
    this.chunks.set(row.id, row);
  }

  async createDocumentWithChunks(input: {
    readonly document: NewSourceDocumentInput;
    readonly chunks: readonly Omit<NewChunkInput, "sourceDocumentId">[];
  }): Promise<{ readonly document: SourceDocumentRow; readonly chunks: readonly ChunkRow[] }> {
    if (input.document.supersedesDocumentId) {
      const prior = this.documents.get(input.document.supersedesDocumentId);
      if (prior) {
        this.documents.set(prior.id, { ...prior, supersededAt: input.document.now });
      }
    }
    const document: SourceDocumentRow = {
      id: nextId("document"),
      knowledgeSourceId: input.document.knowledgeSourceId,
      contentHash: input.document.contentHash,
      supersededAt: null,
    };
    this.documents.set(document.id, document);

    const chunks: ChunkRow[] = input.chunks.map((chunk) => ({
      id: nextId("chunk"),
      sourceDocumentId: document.id,
      knowledgeSourceId: chunk.knowledgeSourceId,
      knowledgeCollectionId: chunk.knowledgeCollectionId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      sectionPath: chunk.sectionPath,
      pageNumber: chunk.pageNumber,
      localeCode: chunk.localeCode,
      embeddingModel: null,
      embeddingDimension: null,
      vectorState: "Pending",
      graphState: "Pending",
      erasedAt: null,
    }));
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);

    return { document, chunks };
  }

  async listChunksBySource(knowledgeSourceId: string): Promise<readonly ChunkRow[]> {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.knowledgeSourceId === knowledgeSourceId && chunk.erasedAt === null)
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  async listChunksByIds(ids: readonly string[]): Promise<readonly ChunkRow[]> {
    const set = new Set(ids);
    return [...this.chunks.values()].filter((chunk) => set.has(chunk.id));
  }

  async listAllChunks(): Promise<readonly ChunkRow[]> {
    return [...this.chunks.values()].filter((chunk) => chunk.erasedAt === null);
  }

  async applyEmbedResult(input: {
    readonly chunkId: string;
    readonly vectorState: DerivedIndexState;
    readonly graphState: DerivedIndexState;
    readonly embeddingModel: string;
    readonly embeddingDimension: number;
    readonly now: Date;
  }): Promise<void> {
    const existing = this.chunks.get(input.chunkId);
    if (!existing) throw new Error(`No such chunk: "${input.chunkId}".`);
    this.chunks.set(input.chunkId, {
      ...existing,
      vectorState: input.vectorState,
      graphState: input.graphState,
      ...(input.vectorState === "Indexed"
        ? { embeddingModel: input.embeddingModel, embeddingDimension: input.embeddingDimension }
        : {}),
    });
  }

  async resetToPending(chunkIds: readonly string[], now: Date): Promise<void> {
    void now;
    for (const id of chunkIds) {
      const existing = this.chunks.get(id);
      if (existing)
        this.chunks.set(id, { ...existing, vectorState: "Pending", graphState: "Pending" });
    }
  }

  async markErased(chunkIds: readonly string[], now: Date): Promise<void> {
    for (const id of chunkIds) {
      const existing = this.chunks.get(id);
      if (existing) this.chunks.set(id, { ...existing, erasedAt: now });
    }
  }

  async countNonErasedChunksForSource(knowledgeSourceId: string): Promise<number> {
    return [...this.chunks.values()].filter(
      (chunk) => chunk.knowledgeSourceId === knowledgeSourceId && chunk.erasedAt === null,
    ).length;
  }
}

// ---------------------------------------------------------------------------
// GraphRepository
// ---------------------------------------------------------------------------

export class FakeGraphRepository implements GraphRepository {
  private readonly nodes = new Map<string, GraphNodeRecordRow>();
  private readonly duplicates = new Map<string, GraphDuplicateCandidateRow>();
  readonly mergeDecisions: {
    readonly graphDuplicateCandidateId: string;
    readonly decision: "Merge" | "Ignore";
    readonly survivingNodeRecordId: string | null;
    readonly absorbedNodeRecordId: string | null;
  }[] = [];

  seedNode(row: GraphNodeRecordRow): void {
    this.nodes.set(row.id, row);
  }

  seedDuplicate(row: GraphDuplicateCandidateRow): void {
    this.duplicates.set(row.id, row);
  }

  async upsertNode(input: UpsertGraphNodeRecordInput): Promise<GraphNodeRecordRow> {
    const existing = [...this.nodes.values()].find(
      (node) =>
        node.label === input.label &&
        node.canonicalKey === input.canonicalKey &&
        node.deletedAt === null,
    );
    if (existing) {
      const updated = { ...existing, canonicalName: input.canonicalName };
      this.nodes.set(existing.id, updated);
      return updated;
    }
    const row: GraphNodeRecordRow = {
      id: nextId("node"),
      label: input.label,
      canonicalKey: input.canonicalKey,
      canonicalName: input.canonicalName,
      origin: input.origin,
      firstSeenChunkId: input.firstSeenChunkId,
      mergedIntoNodeRecordId: null,
      deletedAt: null,
    };
    this.nodes.set(row.id, row);
    return row;
  }

  async findNodeByCanonicalKey(
    label: string,
    canonicalKey: string,
  ): Promise<GraphNodeRecordRow | null> {
    return (
      [...this.nodes.values()].find(
        (node) =>
          node.label === label && node.canonicalKey === canonicalKey && node.deletedAt === null,
      ) ?? null
    );
  }

  async getNode(id: string): Promise<GraphNodeRecordRow | null> {
    const row = this.nodes.get(id);
    return row && row.deletedAt === null ? row : null;
  }

  async listNodesFirstSeenIn(chunkIds: readonly string[]): Promise<readonly GraphNodeRecordRow[]> {
    const set = new Set(chunkIds);
    return [...this.nodes.values()].filter(
      (node) =>
        node.firstSeenChunkId !== null && set.has(node.firstSeenChunkId) && node.deletedAt === null,
    );
  }

  async upsertEdge(input: UpsertGraphEdgeRecordInput): Promise<void> {
    void input; // Edge identity is not asserted by any current test; kept as a no-op store-free stub matching the port shape.
  }

  async softDeleteNode(id: string, now: Date): Promise<void> {
    const existing = this.nodes.get(id);
    if (existing) this.nodes.set(id, { ...existing, deletedAt: now });
  }

  async listOpenDuplicateCandidates(): Promise<readonly GraphDuplicateCandidateRow[]> {
    return [...this.duplicates.values()]
      .filter((row) => row.state === "Open")
      .sort((a, b) => b.similarity - a.similarity);
  }

  async upsertDuplicateCandidate(input: {
    readonly leftNodeRecordId: string;
    readonly rightNodeRecordId: string;
    readonly similarity: number;
    readonly detectionMethod: "NormalizedName" | "AliasOverlap" | "FullTextSimilarity" | "Manual";
    readonly now: Date;
  }): Promise<GraphDuplicateCandidateRow> {
    const existing = [...this.duplicates.values()].find(
      (row) =>
        (row.leftNodeRecordId === input.leftNodeRecordId &&
          row.rightNodeRecordId === input.rightNodeRecordId) ||
        (row.leftNodeRecordId === input.rightNodeRecordId &&
          row.rightNodeRecordId === input.leftNodeRecordId),
    );
    const left = this.nodes.get(input.leftNodeRecordId);
    const right = this.nodes.get(input.rightNodeRecordId);
    if (existing) {
      const updated = { ...existing, similarity: input.similarity, detectedAt: input.now };
      this.duplicates.set(existing.id, updated);
      return updated;
    }
    const row: GraphDuplicateCandidateRow = {
      id: nextId("duplicate"),
      leftNodeRecordId: input.leftNodeRecordId,
      rightNodeRecordId: input.rightNodeRecordId,
      leftName: left?.canonicalName ?? "",
      rightName: right?.canonicalName ?? "",
      similarity: input.similarity,
      detectionMethod: input.detectionMethod,
      state: "Open",
      detectedAt: input.now,
    };
    this.duplicates.set(row.id, row);
    return row;
  }

  async setDuplicateCandidateState(
    id: string,
    state: "Open" | "Merged" | "Ignored",
    now: Date,
  ): Promise<void> {
    void now;
    const existing = this.duplicates.get(id);
    if (!existing) throw new Error(`No such duplicate candidate: "${id}".`);
    this.duplicates.set(id, { ...existing, state });
  }

  async getDuplicateCandidate(id: string): Promise<GraphDuplicateCandidateRow | null> {
    return this.duplicates.get(id) ?? null;
  }

  async recordMergeDecision(input: {
    readonly graphDuplicateCandidateId: string;
    readonly decision: "Merge" | "Ignore";
    readonly survivingNodeRecordId: string | null;
    readonly absorbedNodeRecordId: string | null;
    readonly decidedByStaffUserId: string;
    readonly now: Date;
  }): Promise<void> {
    this.mergeDecisions.push({
      graphDuplicateCandidateId: input.graphDuplicateCandidateId,
      decision: input.decision,
      survivingNodeRecordId: input.survivingNodeRecordId,
      absorbedNodeRecordId: input.absorbedNodeRecordId,
    });
    if (input.decision === "Merge" && input.absorbedNodeRecordId && input.survivingNodeRecordId) {
      const absorbed = this.nodes.get(input.absorbedNodeRecordId);
      if (absorbed) {
        this.nodes.set(absorbed.id, {
          ...absorbed,
          mergedIntoNodeRecordId: input.survivingNodeRecordId,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RetrievalConfigRepository
// ---------------------------------------------------------------------------

export class FakeRetrievalConfigRepository implements RetrievalConfigRepository {
  private config: RetrievalConfigRow | null = null;
  readonly playgroundRuns: NewPlaygroundRunInput[] = [];

  async ensureTenantConfig(now: Date): Promise<RetrievalConfigRow> {
    void now;
    this.config ??= {
      id: nextId("retrievalconfig"),
      scope: "Tenant",
      knowledgeCollectionId: null,
      ...RETRIEVAL_CONFIG_DEFAULTS,
    };
    return this.config;
  }

  async updateTenantConfig(input: UpdateRetrievalConfigInput): Promise<RetrievalConfigRow> {
    const existing = await this.ensureTenantConfig(input.now);
    const updated: RetrievalConfigRow = {
      ...existing,
      chunkSizeTokens: input.chunkSizeTokens,
      chunkOverlapTokens: input.chunkOverlapTokens,
      embeddingModel: input.embeddingModel,
      embeddingDimension: input.embeddingDimension,
      graphWeight: input.graphWeight,
      vectorWeight: input.vectorWeight,
      topK: input.topK,
      rerankerEnabled: input.rerankerEnabled,
      rerankerModel: input.rerankerModel,
      rerankCandidateCount: input.rerankCandidateCount,
      minGroundingConfidence: input.minGroundingConfidence,
      defaultConflictPolicy: input.defaultConflictPolicy,
      maxGraphHops: input.maxGraphHops,
    };
    this.config = updated;
    return updated;
  }

  async recordPlaygroundRun(input: NewPlaygroundRunInput): Promise<{ readonly id: string }> {
    this.playgroundRuns.push(input);
    return { id: nextId("playgroundrun") };
  }
}

// ---------------------------------------------------------------------------
// ReindexJobRepository
// ---------------------------------------------------------------------------

export class FakeReindexJobRepository implements ReindexJobRepository {
  private readonly jobs = new Map<string, ReindexJobRow>();

  seed(row: ReindexJobRow): void {
    this.jobs.set(row.id, row);
  }

  async create(input: NewReindexJobInput): Promise<ReindexJobRow> {
    const row: ReindexJobRow = {
      id: nextId("reindexjob"),
      scope: input.scope,
      knowledgeSourceId: input.knowledgeSourceId,
      knowledgeCollectionId: input.knowledgeCollectionId,
      reason: input.reason,
      state: "Queued",
      progressPercent: 0,
      chunksTotal: null,
      chunksProcessed: 0,
      targetEmbeddingModel: input.targetEmbeddingModel,
      startedAt: null,
      finishedAt: null,
      error: null,
      ranByStaffUserId: input.ranByStaffUserId,
      createdAt: input.now,
    };
    this.jobs.set(row.id, row);
    return row;
  }

  async updateProgress(input: UpdateReindexJobProgressInput): Promise<void> {
    const existing = this.jobs.get(input.id);
    if (!existing) throw new Error(`No such reindex job: "${input.id}".`);
    this.jobs.set(input.id, {
      ...existing,
      state: input.state,
      progressPercent: input.progressPercent,
      chunksTotal: input.chunksTotal,
      chunksProcessed: input.chunksProcessed,
      error: input.error,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    });
  }

  async get(id: string): Promise<ReindexJobRow | null> {
    return this.jobs.get(id) ?? null;
  }

  async list(): Promise<readonly ReindexJobRow[]> {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findActiveTenantScopeJob(): Promise<ReindexJobRow | null> {
    return (
      [...this.jobs.values()].find(
        (job) => job.scope === "Tenant" && (job.state === "Queued" || job.state === "Running"),
      ) ?? null
    );
  }
}

// ---------------------------------------------------------------------------
// ConflictRepository
// ---------------------------------------------------------------------------

export class FakeConflictRepository implements ConflictRepository {
  private readonly conflicts = new Map<string, SourceConflictRow>();

  seed(row: SourceConflictRow): void {
    this.conflicts.set(row.id, row);
  }

  async list(): Promise<readonly SourceConflictRow[]> {
    return [...this.conflicts.values()].sort(
      (a, b) => b.detectedAt.getTime() - a.detectedAt.getTime(),
    );
  }

  async get(id: string): Promise<SourceConflictRow | null> {
    return this.conflicts.get(id) ?? null;
  }

  async resolve(input: {
    readonly id: string;
    readonly authoritativeSide: "A" | "B";
    readonly resolvedByStaffUserId: string;
    readonly now: Date;
  }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: "knowledge.conflict_not_open" }
  > {
    const existing = this.conflicts.get(input.id);
    if (!existing || existing.status !== "Open") {
      return { ok: false, reason: "knowledge.conflict_not_open" };
    }
    this.conflicts.set(input.id, {
      ...existing,
      status: "Resolved",
      authoritativeSide: input.authoritativeSide,
      resolvedByStaffUserId: input.resolvedByStaffUserId,
      resolvedAt: input.now,
    });
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// OutboxRepository
// ---------------------------------------------------------------------------

export class FakeOutboxRepository implements OutboxRepository {
  private readonly events = new Map<string, OutboxEventRow>();

  seed(row: OutboxEventRow): void {
    this.events.set(row.id, row);
  }

  get all(): readonly OutboxEventRow[] {
    return [...this.events.values()];
  }

  async enqueue(input: NewOutboxEventInput): Promise<void> {
    const existing = [...this.events.values()].find((row) => row.dedupeKey === input.dedupeKey);
    if (existing) return;
    const row: OutboxEventRow = {
      id: nextId("outbox"),
      aggregateKind: input.aggregateKind,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      targetStore: input.targetStore,
      payloadJson: input.payloadJson,
      dedupeKey: input.dedupeKey,
      state: "Pending",
      attemptCount: 0,
      maxAttempts: 8,
      availableAt: input.now,
    };
    this.events.set(row.id, row);
  }

  async claimBatch(limit: number, workerId: string, now: Date): Promise<readonly OutboxEventRow[]> {
    void workerId;
    const claimable = [...this.events.values()]
      .filter(
        (row) =>
          (row.state === "Pending" || row.state === "Failed") &&
          row.availableAt.getTime() <= now.getTime(),
      )
      .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
      .slice(0, limit);
    for (const row of claimable) {
      this.events.set(row.id, { ...row, state: "InFlight", attemptCount: row.attemptCount + 1 });
    }
    return claimable.map((row) => ({
      ...row,
      state: "InFlight",
      attemptCount: row.attemptCount + 1,
    }));
  }

  async markApplied(id: string, now: Date): Promise<void> {
    void now;
    const existing = this.events.get(id);
    if (!existing) throw new Error(`No such outbox event: "${id}".`);
    this.events.set(id, { ...existing, state: "Applied" });
  }

  async markFailed(input: {
    readonly id: string;
    readonly error: string;
    readonly nextAvailableAt: Date;
    readonly becameDead: boolean;
  }): Promise<void> {
    const existing = this.events.get(input.id);
    if (!existing) throw new Error(`No such outbox event: "${input.id}".`);
    this.events.set(input.id, {
      ...existing,
      state: input.becameDead ? "Dead" : "Failed",
      availableAt: input.nextAvailableAt,
    });
  }

  async requeueDead(ids: readonly string[], now: Date): Promise<void> {
    for (const id of ids) {
      const existing = this.events.get(id);
      if (existing && existing.state === "Dead") {
        this.events.set(id, { ...existing, state: "Pending", attemptCount: 0, availableAt: now });
      }
    }
  }

  async listDeadForAggregate(
    aggregateKind: string,
    aggregateId: string,
  ): Promise<readonly OutboxEventRow[]> {
    return [...this.events.values()].filter(
      (row) =>
        row.aggregateKind === aggregateKind &&
        row.aggregateId === aggregateId &&
        row.state === "Dead",
    );
  }
}

// ---------------------------------------------------------------------------
// ReconciliationRepository
// ---------------------------------------------------------------------------

export class FakeReconciliationRepository implements ReconciliationRepository {
  private readonly runs = new Map<string, ReconciliationRunRow>();

  async start(input: NewReconciliationRunInput): Promise<{ readonly id: string }> {
    const row: ReconciliationRunRow = {
      id: nextId("reconciliation"),
      store: input.store,
      scope: input.scope,
      knowledgeSourceId: input.knowledgeSourceId,
      expectedCount: 0,
      observedCount: 0,
      driftFound: 0,
      driftRepaired: 0,
      state: "Running",
      startedAt: input.startedAt,
      finishedAt: null,
    };
    this.runs.set(row.id, row);
    return { id: row.id };
  }

  async complete(input: CompleteReconciliationRunInput): Promise<void> {
    const existing = this.runs.get(input.id);
    if (!existing) throw new Error(`No such reconciliation run: "${input.id}".`);
    this.runs.set(input.id, {
      ...existing,
      expectedCount: input.expectedCount,
      observedCount: input.observedCount,
      driftFound: input.driftFound,
      driftRepaired: input.driftRepaired,
      state: input.state,
      finishedAt: input.finishedAt,
    });
  }

  async list(): Promise<readonly ReconciliationRunRow[]> {
    return [...this.runs.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }
}

// ---------------------------------------------------------------------------
// KnowledgeAiClient
// ---------------------------------------------------------------------------

/**
 * Every method returns a settable, deliberately-obvious "not configured" result until the
 * test calls the matching `set*` — the same "reachable failure, no silent success" stance
 * `FakeMcpDiscoveryClient` takes, generalised to nine methods instead of one.
 */
export class FakeKnowledgeAiClient implements KnowledgeAiClient {
  private chunkDocumentResult: ChunkDocumentResult = { chunks: [] };
  private embedAndIndexResult: EmbedAndIndexResult = {
    results: [],
    graphWrites: [],
    edgeWrites: [],
  };
  private retrievalQueryResult: RetrievalQueryResult = {
    results: [],
    matchedSubgraph: { nodes: [], edges: [], renderedPath: null },
    degraded: false,
    degradationReasons: [],
    rerankApplied: false,
    groundingConfidence: 0,
    durationMs: 0,
  };
  private graphBrowseResult: GraphBrowseResult = { nodes: [], edges: [], truncated: false };
  private upsertGraphNodeResult: UpsertGraphNodeResult = { ok: true };
  private detectDuplicatesResult: DetectDuplicatesResult = { candidates: [] };
  private reconcileInspectResult: ReconcileInspectResult = {
    observedVectorChunkIds: [],
    observedGraphChunkIds: [],
  };
  private graphInvariantsResult: GraphInvariantsResult = {
    labelledButWrongProp: 0,
    propButNoLabel: 0,
    crossTenantEdges: 0,
  };

  readonly embedAndIndexCalls: EmbedAndIndexInput[] = [];
  readonly chunkDocumentCalls: ChunkDocumentInput[] = [];

  setChunkDocumentResult(result: ChunkDocumentResult): void {
    this.chunkDocumentResult = result;
  }
  setEmbedAndIndexResult(result: EmbedAndIndexResult): void {
    this.embedAndIndexResult = result;
  }
  setRetrievalQueryResult(result: RetrievalQueryResult): void {
    this.retrievalQueryResult = result;
  }
  setGraphBrowseResult(result: GraphBrowseResult): void {
    this.graphBrowseResult = result;
  }
  setUpsertGraphNodeResult(result: UpsertGraphNodeResult): void {
    this.upsertGraphNodeResult = result;
  }
  setDetectDuplicatesResult(result: DetectDuplicatesResult): void {
    this.detectDuplicatesResult = result;
  }
  setReconcileInspectResult(result: ReconcileInspectResult): void {
    this.reconcileInspectResult = result;
  }
  setGraphInvariantsResult(result: GraphInvariantsResult): void {
    this.graphInvariantsResult = result;
  }

  async chunkDocument(input: ChunkDocumentInput): Promise<ChunkDocumentResult> {
    this.chunkDocumentCalls.push(input);
    return this.chunkDocumentResult;
  }
  async embedAndIndex(input: EmbedAndIndexInput): Promise<EmbedAndIndexResult> {
    this.embedAndIndexCalls.push(input);
    return this.embedAndIndexResult;
  }
  async retrievalQuery(input: RetrievalQueryInput): Promise<RetrievalQueryResult> {
    void input;
    return this.retrievalQueryResult;
  }
  async browseGraph(input: GraphBrowseInput): Promise<GraphBrowseResult> {
    void input;
    return this.graphBrowseResult;
  }
  async upsertGraphNode(input: UpsertGraphNodeInput): Promise<UpsertGraphNodeResult> {
    void input;
    return this.upsertGraphNodeResult;
  }
  async deleteGraphNode(canonicalKey: string): Promise<{ readonly ok: true }> {
    void canonicalKey;
    return { ok: true };
  }
  async detectDuplicates(input: DetectDuplicatesInput): Promise<DetectDuplicatesResult> {
    void input;
    return this.detectDuplicatesResult;
  }
  async mergeDuplicate(input: MergeOrIgnoreDuplicateInput): Promise<{ readonly ok: true }> {
    void input;
    return { ok: true };
  }
  async ignoreDuplicate(input: MergeOrIgnoreDuplicateInput): Promise<{ readonly ok: true }> {
    void input;
    return { ok: true };
  }
  async reconcileInspect(input: ReconcileInspectInput): Promise<ReconcileInspectResult> {
    void input;
    return this.reconcileInspectResult;
  }
  async graphInvariants(): Promise<GraphInvariantsResult> {
    return this.graphInvariantsResult;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function knowledgeSourceRowFixture(
  overrides: Partial<KnowledgeSourceRow> = {},
): KnowledgeSourceRow {
  return {
    id: "source_fixture_1",
    knowledgeCollectionId: "collection_fixture_1",
    name: "SEWA tariff schedule",
    sourceType: "Document",
    location: "pasted-text",
    schedule: "Manual",
    status: "Idle",
    documentCount: 1,
    chunkCount: 10,
    indexedChunkCount: 7,
    indexedPercent: 70,
    lastCrawledAt: new Date("2026-09-07T00:00:00.000Z"),
    nextScheduledAt: null,
    lastError: null,
    credentialSecretRef: null,
    removedAt: null,
    ...overrides,
  };
}

export function chunkRowFixture(overrides: Partial<ChunkRow> = {}): ChunkRow {
  return {
    id: "chunk_fixture_1",
    sourceDocumentId: "document_fixture_1",
    knowledgeSourceId: "source_fixture_1",
    knowledgeCollectionId: "collection_fixture_1",
    ordinal: 0,
    text: "Pay your SEWA bill online within 30 days of issue.",
    charStart: 0,
    charEnd: 51,
    sectionPath: null,
    pageNumber: null,
    localeCode: "en",
    embeddingModel: null,
    embeddingDimension: null,
    vectorState: "Pending",
    graphState: "Pending",
    erasedAt: null,
    ...overrides,
  };
}

export function graphNodeRecordRowFixture(
  overrides: Partial<GraphNodeRecordRow> = {},
): GraphNodeRecordRow {
  return {
    id: "node_fixture_1",
    label: "Provider",
    canonicalKey: "sewa",
    canonicalName: "SEWA",
    origin: "Extracted",
    firstSeenChunkId: "chunk_fixture_1",
    mergedIntoNodeRecordId: null,
    deletedAt: null,
    ...overrides,
  };
}

export function reindexJobRowFixture(overrides: Partial<ReindexJobRow> = {}): ReindexJobRow {
  return {
    id: "reindexjob_fixture_1",
    scope: "Tenant",
    knowledgeSourceId: null,
    knowledgeCollectionId: null,
    reason: "Manual",
    state: "Queued",
    progressPercent: 0,
    chunksTotal: null,
    chunksProcessed: 0,
    targetEmbeddingModel: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    ranByStaffUserId: "usr_fixture_admin",
    createdAt: new Date("2026-09-09T09:00:00.000Z"),
    ...overrides,
  };
}

export function sourceConflictRowFixture(
  overrides: Partial<SourceConflictRow> = {},
): SourceConflictRow {
  return {
    id: "conflict_fixture_1",
    topic: "SEWA connection fee",
    graphEntityKey: "fee:sewa-connection",
    sideAChunkId: "chunk_fixture_a",
    sideAKnowledgeSourceId: "source_fixture_a",
    sideAKnowledgeSourceName: "SEWA tariff schedule (2025)",
    sideAValue: "AED 110",
    sideASourceUpdatedAt: new Date("2025-06-01T00:00:00.000Z"),
    sideBChunkId: "chunk_fixture_b",
    sideBKnowledgeSourceId: "source_fixture_b",
    sideBKnowledgeSourceName: "SEWA tariff schedule (2026)",
    sideBValue: "AED 130",
    sideBSourceUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    detectedAt: new Date("2026-09-01T00:00:00.000Z"),
    status: "Open",
    policyAtDetection: "PreferMostRecentlyUpdated",
    authoritativeSide: null,
    resolvedByStaffUserId: null,
    resolvedAt: null,
    groundingPenalty: 0.25,
    ...overrides,
  };
}
