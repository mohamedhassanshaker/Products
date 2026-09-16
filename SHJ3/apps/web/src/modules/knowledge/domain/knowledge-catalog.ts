/**
 * Enums for the Knowledge / Graph RAG domain (B6, all four tabs) — transcribed directly
 * from `prisma/tenant/schema.prisma`'s own doc comments for `KnowledgeSource`, `Chunk`,
 * `IngestionRun`, `ReindexJob`, `RetrievalConfig`, `SourceConflict`, `GraphNodeRecord`,
 * `GraphEdgeRecord`, `GraphDuplicateCandidate`, `GraphMergeDecision` and `OutboxEvent`
 * (each model's field comments name its own CHECK-constrained vocabulary; the schema file
 * is ground truth per this project's own lessons, not the wireframe or requirements prose).
 * Pure domain: no vendor imports, no Prisma types (architecture.md §4).
 */

export const SOURCE_TYPES = [
  "Document",
  "UrlCrawler",
  "Database",
  "SharePoint",
  "ApiFeed",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

/** The only source type this wave wires end to end (see this module's README-equivalent — the knowledge route's module comment). */
export const FULLY_WIRED_SOURCE_TYPE: SourceType = "Document";

export const SOURCE_SCHEDULES = ["Manual", "Daily", "Weekly"] as const;
export type SourceSchedule = (typeof SOURCE_SCHEDULES)[number];
export function isSourceSchedule(value: string): value is SourceSchedule {
  return (SOURCE_SCHEDULES as readonly string[]).includes(value);
}

export const SOURCE_STATUSES = ["Idle", "Crawling", "Indexing", "Failed"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export function isSourceStatus(value: string): value is SourceStatus {
  return (SOURCE_STATUSES as readonly string[]).includes(value);
}

/** `Chunks.vectorState`/`graphState` — identical vocabulary, two independent columns. */
export const DERIVED_INDEX_STATES = ["Pending", "Indexed", "Stale", "Failed"] as const;
export type DerivedIndexState = (typeof DERIVED_INDEX_STATES)[number];
export function isDerivedIndexState(value: string): value is DerivedIndexState {
  return (DERIVED_INDEX_STATES as readonly string[]).includes(value);
}

export const INGESTION_TRIGGERS = ["Manual", "Schedule", "ReindexAll", "Reconciliation"] as const;
export type IngestionTrigger = (typeof INGESTION_TRIGGERS)[number];

export const INGESTION_RUN_STATES = ["Queued", "Running", "Completed", "Failed"] as const;
export type IngestionRunState = (typeof INGESTION_RUN_STATES)[number];

export const REINDEX_SCOPES = ["Tenant", "Collection", "Source", "Document"] as const;
export type ReindexScope = (typeof REINDEX_SCOPES)[number];
export function isReindexScope(value: string): value is ReindexScope {
  return (REINDEX_SCOPES as readonly string[]).includes(value);
}

/**
 * `ReindexJobs.reason`. `EmbeddingModelChange` is the one reason with a hard, tested
 * invariant attached (`domain/reindex-selection.ts`): it always selects every in-scope
 * chunk, never only the ones that look stale.
 */
export const REINDEX_REASONS = [
  "Manual",
  "EmbeddingModelChange",
  "RetrievalConfigChange",
  "Reconciliation",
  "Restore",
  "GraphMerge",
] as const;
export type ReindexReason = (typeof REINDEX_REASONS)[number];
export function isReindexReason(value: string): value is ReindexReason {
  return (REINDEX_REASONS as readonly string[]).includes(value);
}

export const REINDEX_JOB_STATES = ["Queued", "Running", "Completed", "Failed"] as const;
export type ReindexJobState = (typeof REINDEX_JOB_STATES)[number];
export function isReindexJobState(value: string): value is ReindexJobState {
  return (REINDEX_JOB_STATES as readonly string[]).includes(value);
}

export const RETRIEVAL_CONFIG_SCOPES = ["Tenant", "Collection"] as const;
export type RetrievalConfigScope = (typeof RETRIEVAL_CONFIG_SCOPES)[number];

/** FR-KNOW-19's three named policies, in the order the requirement lists them. */
export const CONFLICT_POLICIES = [
  "PreferMostRecentlyUpdated",
  "PreferOwningEntitySource",
  "AlwaysAskAdmin",
] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];
export function isConflictPolicy(value: string): value is ConflictPolicy {
  return (CONFLICT_POLICIES as readonly string[]).includes(value);
}

export const CONFLICT_STATUSES = ["Open", "Resolved", "Ignored"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];
export function isConflictStatus(value: string): value is ConflictStatus {
  return (CONFLICT_STATUSES as readonly string[]).includes(value);
}

export const CONFLICT_SIDES = ["A", "B"] as const;
export type ConflictSide = (typeof CONFLICT_SIDES)[number];
export function isConflictSide(value: string): value is ConflictSide {
  return (CONFLICT_SIDES as readonly string[]).includes(value);
}

/** `GraphNodeRecords.label` — the five entity types FR-KNOW-06 fixes for this release. */
export const GRAPH_LABELS = ["Service", "Provider", "Fee", "Document", "Channel"] as const;
export type GraphLabel = (typeof GRAPH_LABELS)[number];
export function isGraphLabel(value: string): value is GraphLabel {
  return (GRAPH_LABELS as readonly string[]).includes(value);
}

/** `GraphEdgeRecords.relationshipType`. */
export const GRAPH_RELATIONSHIP_TYPES = [
  "PROVIDED_BY",
  "HAS_FEE",
  "DOCUMENTED_BY",
  "PAYABLE_VIA",
  "AVAILABLE_ON",
  "MENTIONS",
  "FROM_DOCUMENT",
  "MERGED_INTO",
  "SAME_AS",
] as const;
export type GraphRelationshipType = (typeof GRAPH_RELATIONSHIP_TYPES)[number];

/** Shared by `GraphNodeRecords.origin` and `GraphEdgeRecords.origin`. */
export const GRAPH_ORIGINS = ["Extracted", "Authored"] as const;
export type GraphOrigin = (typeof GRAPH_ORIGINS)[number];
export function isGraphOrigin(value: string): value is GraphOrigin {
  return (GRAPH_ORIGINS as readonly string[]).includes(value);
}

export const DUPLICATE_DETECTION_METHODS = [
  "NormalizedName",
  "AliasOverlap",
  "FullTextSimilarity",
  "Manual",
] as const;
export type DuplicateDetectionMethod = (typeof DUPLICATE_DETECTION_METHODS)[number];
export function isDuplicateDetectionMethod(value: string): value is DuplicateDetectionMethod {
  return (DUPLICATE_DETECTION_METHODS as readonly string[]).includes(value);
}

export const DUPLICATE_STATES = ["Open", "Merged", "Ignored"] as const;
export type DuplicateState = (typeof DUPLICATE_STATES)[number];
export function isDuplicateState(value: string): value is DuplicateState {
  return (DUPLICATE_STATES as readonly string[]).includes(value);
}

export const MERGE_DECISION_KINDS = ["Merge", "Ignore"] as const;
export type MergeDecisionKind = (typeof MERGE_DECISION_KINDS)[number];

/** `GroundingCitations.retrievedVia` / the AI service's `retrieval/query` response. */
export const RETRIEVED_VIA_KINDS = ["Graph", "Vector", "Hybrid"] as const;
export type RetrievedViaKind = (typeof RETRIEVED_VIA_KINDS)[number];

/** `OutboxEvents.aggregateKind`. */
export const OUTBOX_AGGREGATE_KINDS = [
  "Chunk",
  "SourceDocument",
  "GraphNodeRecord",
  "GraphEdgeRecord",
  "KnowledgeSource",
] as const;
export type OutboxAggregateKind = (typeof OUTBOX_AGGREGATE_KINDS)[number];
export function isOutboxAggregateKind(value: string): value is OutboxAggregateKind {
  return (OUTBOX_AGGREGATE_KINDS as readonly string[]).includes(value);
}

/** `OutboxEvents.targetStore`. */
export const OUTBOX_TARGET_STORES = ["Neo4j", "Qdrant", "Both"] as const;
export type OutboxTargetStore = (typeof OUTBOX_TARGET_STORES)[number];
export function isOutboxTargetStore(value: string): value is OutboxTargetStore {
  return (OUTBOX_TARGET_STORES as readonly string[]).includes(value);
}

/** `OutboxEvents.state`. */
export const OUTBOX_STATES = ["Pending", "InFlight", "Applied", "Failed", "Dead"] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];
export function isOutboxState(value: string): value is OutboxState {
  return (OUTBOX_STATES as readonly string[]).includes(value);
}

/** `ReconciliationRuns.store`. */
export const RECONCILIATION_STORES = ["Neo4j", "Qdrant"] as const;
export type ReconciliationStore = (typeof RECONCILIATION_STORES)[number];
export function isReconciliationStore(value: string): value is ReconciliationStore {
  return (RECONCILIATION_STORES as readonly string[]).includes(value);
}

/** `ReconciliationRuns.scope`. */
export const RECONCILIATION_SCOPES = ["Tenant", "Collection", "Source"] as const;
export type ReconciliationScope = (typeof RECONCILIATION_SCOPES)[number];
export function isReconciliationScope(value: string): value is ReconciliationScope {
  return (RECONCILIATION_SCOPES as readonly string[]).includes(value);
}

export const RECONCILIATION_STATES = ["Running", "Completed", "Failed"] as const;
export type ReconciliationRunState = (typeof RECONCILIATION_STATES)[number];
export function isReconciliationRunState(value: string): value is ReconciliationRunState {
  return (RECONCILIATION_STATES as readonly string[]).includes(value);
}
