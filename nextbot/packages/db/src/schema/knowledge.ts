import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  halfvec,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { modelRouteVersion, modelCatalogEntry, modelProvider } from "./model-gateway.js";
import { regionEnum } from "./enums.js";
import { agentDefinitionVersion, agentRun } from "./agent-platform.js";

/**
 * Target Architecture Blueprint Phase 7b (BL-38, ADR-0018, LLD §14.4) — Module B:
 * Knowledge and Graph RAG. Collections/sources/generations/chunks and their Postgres
 * side of the graph (`graph_entity`/`graph_edge`/`graph_community`) live here; the
 * graph store itself (Neo4j, node/edge structure+ids only) is `@nextbot/graph-store`
 * (Phase 7a, QA-approved), reached exclusively through `withTenantGraph()`.
 *
 * **Disclosed narrowing**: LLD §14.4.2 also names `retrieval_event`. Not shipped this
 * phase — nothing in Phase 7b's own scope reads or writes it (it belongs to the
 * retrieval executor, Phase 9/10, which does not exist yet); shipping an unused table
 * now would be schema for schema's sake. Adding it later is a pure additive migration
 * with no interaction with anything this phase ships.
 *
 * pgvector is already the platform's vector store (`compose.yaml`'s
 * `pgvector/pgvector:pg16` image, HLD §9) but the extension itself was never
 * `CREATE EXTENSION`'d before this phase — this phase's migration is the first to do
 * so, since it is the first to declare a `vector(...)` column.
 */

// ---------------------------------------------------------------------------
// Enums (LLD §14.4.2)
// ---------------------------------------------------------------------------

export const knowledgeCollectionStatusEnum = pgEnum("knowledge_collection_status", [
  "Draft",
  "Building",
  "Ready",
  "ReEmbedding",
  "Stale",
  "Failed",
]);

export const knowledgeSourceKindEnum = pgEnum("knowledge_source_kind", ["Upload", "Url", "McpResource", "Connector"]);

export const knowledgeSourceStatusEnum = pgEnum("knowledge_source_status", [
  "Pending",
  "Syncing",
  "Synced",
  "PartiallyFailed",
  "Failed",
  "Purged",
]);

export const knowledgeGenerationStatusEnum = pgEnum("knowledge_generation_status", [
  "Building",
  "Ready",
  "Superseded",
  "Failed",
  "Cancelled",
]);

export const ingestionStageEnum = pgEnum("ingestion_stage", [
  "Ingest",
  "Parse",
  "Chunk",
  "ExtractEntities",
  "Resolve",
  "BuildGraph",
  "CommunityDetection",
  "CommunitySummaries",
  "Embed",
  "Index",
]);

export const ingestionJobStatusEnum = pgEnum("ingestion_job_status", ["Queued", "Leased", "Succeeded", "Failed", "Skipped", "Cancelled"]);

export const retrievalStrategyEnum = pgEnum("retrieval_strategy", ["Vector", "GraphLocal", "GraphGlobal", "Hybrid"]);

export const entityMergeStatusEnum = pgEnum("entity_merge_status", ["Pending", "Merged", "Rejected"]);

/** Distinct from `@nextbot/contracts`' `ConnectorTrustLevelSchema` TypeBox union
 *  (which this mirrors) — this codebase's convention (confirmed against `pii.ts`/
 *  `connectors.ts`) is a plain `text` column validated at the API layer for this
 *  concept, not a native Postgres enum, so `trust_level` below is `text` too. */
export type KnowledgeTrustLevel = "Trusted" | "SemiTrusted" | "Untrusted";

export const embeddingOwnerKindEnum = pgEnum("embedding_owner_kind", ["Chunk", "EntitySummary", "CommunitySummary"]);

// ---------------------------------------------------------------------------
// knowledge_collection
// ---------------------------------------------------------------------------

/** `ChunkingConfigSchema` (LLD §14.4.2) — persisted verbatim in `chunking_config`. */
export interface ChunkingConfig {
  targetTokens: number;
  overlapTokens: number;
  strategy: "semantic" | "fixed";
  preserveTables: boolean;
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  targetTokens: 512,
  overlapTokens: 64,
  strategy: "semantic",
  preserveTables: true,
};

export const knowledgeCollection = pgTable(
  "knowledge_collection",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    // CHECK-enforced against tenant_data_policy.residency_region at the application
    // layer (FR-KB-08) — same "reject at save time, never silently allow" pattern
    // Phase 2's capability-validator uses for route residency (KNOWLEDGE_REGION_MISMATCH).
    region: regionEnum("region").notNull(),
    retentionDays: integer("retention_days"),
    trustLevel: text("trust_level").notNull().default("SemiTrusted").$type<KnowledgeTrustLevel>(),
    // Computed by the pipeline only — no API path sets this directly (LLD's own callout).
    status: knowledgeCollectionStatusEnum("status").notNull().default("Draft"),
    // No Drizzle-level `.references()` (avoids a circular table-definition reference
    // within this file, same pattern `skill.current_version_id` uses) — the real FK
    // constraint is added by the migration itself once `knowledge_index_generation`
    // exists, via a standalone `ALTER TABLE ... ADD CONSTRAINT`.
    currentGenerationId: uuid("current_generation_id"),
    chunkingConfig: jsonb("chunking_config").notNull().$type<ChunkingConfig>().default(DEFAULT_CHUNKING_CONFIG),
    // The immutable pin (FR-KB-03/FR-AGT-27) — a specific model_route_version, never
    // a free-text string. `knowledge_config`-gated (spec/blueprint §5.2).
    extractionRouteVersionId: uuid("extraction_route_version_id")
      .notNull()
      .references(() => modelRouteVersion.id),
    embeddingRouteVersionId: uuid("embedding_route_version_id")
      .notNull()
      .references(() => modelRouteVersion.id),
    rerankRouteVersionId: uuid("rerank_route_version_id").references(() => modelRouteVersion.id),
    defaultStrategy: retrievalStrategyEnum("default_strategy"),
    maxStalenessHours: integer("max_staleness_hours"),
    minRelevanceScore: real("min_relevance_score").notNull().default(0.35),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_collection_tenant_name_key").on(t.tenantId, t.name),
    index("knowledge_collection_tenant_status_idx").on(t.tenantId, t.status),
    index("knowledge_collection_tenant_current_generation_idx").on(t.tenantId, t.currentGenerationId),
    check("knowledge_collection_min_relevance_score_range", sql`${t.minRelevanceScore} >= 0 AND ${t.minRelevanceScore} <= 1`),
    check(
      "knowledge_collection_retention_days_valid",
      sql`${t.retentionDays} IS NULL OR ${t.retentionDays} > 0 OR ${t.retentionDays} = -1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_source
// ---------------------------------------------------------------------------

/** `KnowledgeSourceLocatorSchema` (LLD §14.4.2) — discriminated on `kind`. */
export type KnowledgeSourceLocator =
  | { kind: "Upload"; storageRef: string; filename: string; mimeType: string; sizeBytes: number }
  | { kind: "Url"; url: string; crawlDepth: number; includePatterns: string[]; excludePatterns: string[]; respectRobots: boolean }
  | { kind: "McpResource"; mcpManifestItemId: string; mcpServerVersionId: string; uri: string }
  | { kind: "Connector"; connectorId: string; toolName: string; argTemplate: Record<string, unknown> };

/** `KnowledgeAclSchema` (LLD §14.4.2) — captured at ingestion, propagated to every
 *  downstream chunk/entity/edge. */
export interface KnowledgeAcl {
  roleIds?: string[];
  capabilityGroupIds?: string[];
  tags: string[];
  visibility: "Tenant" | "Restricted";
}

/** `[{ documentRef, stage, code, message }]` — per-document, so one failure never
 *  blocks the source (FR-KB-01/FR-KB-02). */
export interface KnowledgeSourceFailure {
  documentRef: string;
  stage: string;
  code: string;
  message: string;
}

export const knowledgeSource = pgTable(
  "knowledge_source",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollection.id),
    kind: knowledgeSourceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    locator: jsonb("locator").notNull().$type<KnowledgeSourceLocator>(),
    aclJson: jsonb("acl_json").notNull().$type<KnowledgeAcl>(),
    // Opaque `sha256(tenantId‖dimension‖value)[:16]` hashes — the only ACL form ever
    // written to the graph store (ADR-0018 §2.4/§14.4.1).
    aclTags: text("acl_tags").array().notNull().default(sql`'{}'::text[]`),
    status: knowledgeSourceStatusEnum("status").notNull().default("Pending"),
    documentCount: integer("document_count").notNull().default(0),
    failedDocumentCount: integer("failed_document_count").notNull().default(0),
    failures: jsonb("failures").$type<KnowledgeSourceFailure[]>(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    syncIntervalSeconds: integer("sync_interval_seconds"),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_source_tenant_collection_name_key").on(t.tenantId, t.collectionId, t.name),
    index("knowledge_source_tenant_collection_status_idx").on(t.tenantId, t.collectionId, t.status),
    index("knowledge_source_tenant_kind_idx").on(t.tenantId, t.kind),
    index("knowledge_source_acl_tags_gin_idx").using("gin", t.aclTags),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_index_generation
// ---------------------------------------------------------------------------

/** `Record<IngestionStage, {done, total, failed}>` — the progress UI's only source. */
export type IngestionStageProgress = Partial<
  Record<
    "Ingest" | "Parse" | "Chunk" | "ExtractEntities" | "Resolve" | "BuildGraph" | "CommunityDetection" | "CommunitySummaries" | "Embed" | "Index",
    { done: number; total: number; failed: number }
  >
>;

/** The closed set of supported embedding dimensions (§14.4.2/§14.4.3) — pgvector
 *  requires a fixed typmod to build an HNSW index, so a variable dimension can't be
 *  indexed on one column; this is the reconciled, deliberate design this LLD section
 *  asked not to be second-guessed. */
export const SUPPORTED_EMBEDDING_DIMENSIONS = [384, 768, 1024, 1536, 3072] as const;
export type SupportedEmbeddingDimension = (typeof SUPPORTED_EMBEDDING_DIMENSIONS)[number];

export const knowledgeIndexGeneration = pgTable(
  "knowledge_index_generation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollection.id),
    generation: integer("generation").notNull(),
    embeddingProviderId: uuid("embedding_provider_id")
      .notNull()
      .references(() => modelProvider.id),
    // The pin. Not a string (FR-KB-03/FR-AGT-21) — captured once at generation-build
    // time from the collection's `embedding_route_version_id`'s resolved catalog
    // entry, and NEVER updated afterward: changing the collection's configured
    // embedding model does not touch any existing generation row (immutability is
    // structural here, not merely a convention — there is no update path for this
    // column anywhere in this module's repository layer).
    embeddingCatalogEntryId: uuid("embedding_catalog_entry_id")
      .notNull()
      .references(() => modelCatalogEntry.id),
    dimension: smallint("dimension").notNull(),
    extractionCatalogEntryId: uuid("extraction_catalog_entry_id")
      .notNull()
      .references(() => modelCatalogEntry.id),
    // The Neo4j label this generation's nodes carry inside the tenant's own database
    // (ADR-0018 §2.3) — format `G_<hex>`, label-safe (leading letter, hex only).
    graphGenerationLabel: text("graph_generation_label").notNull(),
    status: knowledgeGenerationStatusEnum("status").notNull().default("Building"),
    stageProgress: jsonb("stage_progress").notNull().$type<IngestionStageProgress>().default({}),
    chunkCount: integer("chunk_count").notNull().default(0),
    entityCount: integer("entity_count").notNull().default(0),
    edgeCount: integer("edge_count").notNull().default(0),
    communityCount: integer("community_count").notNull().default(0),
    buildCostUsd: numeric("build_cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    supersedesGenerationId: uuid("supersedes_generation_id"),
    builtAt: timestamp("built_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_index_generation_tenant_collection_generation_key").on(t.tenantId, t.collectionId, t.generation),
    uniqueIndex("knowledge_index_generation_graph_label_key").on(t.graphGenerationLabel),
    index("knowledge_index_generation_tenant_collection_idx").on(t.tenantId, t.collectionId),
    check(
      "knowledge_index_generation_dimension_supported",
      sql`${t.dimension} IN (384, 768, 1024, 1536, 3072)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_document — the level between source and chunk, generation-independent
// (a re-embed does not re-parse).
// ---------------------------------------------------------------------------

/** `ParsedBlockSchema[]` — tables are preserved as structured blocks, never
 *  flattened to prose (FR-KB-02). */
export interface ParsedBlock {
  kind: "text" | "table" | "heading" | "list" | "code";
  page?: number;
  section?: string;
  content: string;
  /** Present only when `kind === "table"` — rows of cell strings. */
  tableJson?: string[][];
}

export const knowledgeDocument = pgTable(
  "knowledge_document",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSource.id),
    externalRef: text("external_ref").notNull(),
    title: text("title"),
    mimeType: text("mime_type").notNull(),
    // sha256 of parsed text; unchanged hash => Parse/Chunk stages skipped on re-sync.
    contentHash: text("content_hash").notNull(),
    parsedBlocks: jsonb("parsed_blocks").$type<ParsedBlock[]>(),
    pageCount: integer("page_count"),
    parseStatus: knowledgeSourceStatusEnum("parse_status").notNull(),
    parseFailure: jsonb("parse_failure").$type<{ code: string; message: string } | null>(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_document_tenant_source_external_ref_key").on(t.tenantId, t.sourceId, t.externalRef),
    index("knowledge_document_tenant_source_idx").on(t.tenantId, t.sourceId),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_chunk
// ---------------------------------------------------------------------------

/** `{ documentTitle, page?, section?, blockIndex, charStart, charEnd }`. */
export interface ChunkProvenance {
  documentTitle: string | null;
  page?: number;
  section?: string;
  blockIndex: number;
  charStart: number;
  charEnd: number;
}

/** `[{ ruleId, kind, charStart, charEnd, appliedAction }]` — drives read-time
 *  re-evaluation (FR-KB-08).
 *
 *  **Target Architecture Blueprint Phase 11 correction**: `appliedAction`'s
 *  vocabulary is `@nextbot/pii`'s own `PiiMaskAction` (`"Show" | "PartialMask" |
 *  "FullMask" | "Redact"`) — this column was scaffolded ahead of Phase 11 with a
 *  speculative, DIFFERENT placeholder vocabulary (`"Mask" | "Redact" |
 *  "Tokenize"`) before this phase determined the real masking mechanism to reuse
 *  (FR-SEC-04's own, already-shipped masker, never a second one). Since this is a
 *  JSONB annotation with no DB-level enum constraint, correcting the TS type here
 *  is the whole fix — no migration needed, and no row was ever written under the
 *  old placeholder vocabulary (nothing wrote to this column before this phase). */
export interface PiiMaskEntry {
  ruleId: string;
  kind: string;
  charStart: number;
  charEnd: number;
  appliedAction: "Show" | "PartialMask" | "FullMask" | "Redact";
}

export const knowledgeChunk = pgTable(
  "knowledge_chunk",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => knowledgeIndexGeneration.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSource.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocument.id),
    ordinal: integer("ordinal").notNull(),
    // Index-time masked per collection trust_level.
    text: text("text").notNull(),
    // Object-store key; written only when the collection's trust level permits and
    // PII policy requires read-time re-evaluation to be able to REDUCE masking.
    // Never returned by any API.
    textUnmaskedRef: text("text_unmasked_ref"),
    tokenCount: integer("token_count").notNull(),
    provenance: jsonb("provenance").notNull().$type<ChunkProvenance>(),
    // Copied from the source, NOT recomputed.
    aclTags: text("acl_tags").array().notNull().default(sql`'{}'::text[]`),
    piiMaskJson: jsonb("pii_mask_json").notNull().$type<PiiMaskEntry[]>().default([]),
    // Mirrors generation.dimension — names the knowledge_embedding_d* table holding
    // this chunk's vector.
    embeddingBucket: smallint("embedding_bucket").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_chunk_tenant_generation_document_ordinal_key").on(t.tenantId, t.generationId, t.documentId, t.ordinal),
    index("knowledge_chunk_tenant_generation_source_idx").on(t.tenantId, t.generationId, t.sourceId),
    index("knowledge_chunk_tenant_document_idx").on(t.tenantId, t.documentId),
    index("knowledge_chunk_acl_tags_gin_idx").using("gin", t.aclTags),
    index("knowledge_chunk_text_tsvector_gin_idx").using("gin", sql`to_tsvector('simple', ${t.text})`),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_embedding_d{384,768,1024,1536,3072} — five physically distinct tables,
// generated from one factory, because pgvector requires a fixed typmod to build an
// HNSW index. `packages/modules/knowledge/src/infrastructure/embedding-table.ts`
// exports `tableForDimension(dim)`; no other file may switch on dimension.
// ---------------------------------------------------------------------------

function embeddingTable(dimension: SupportedEmbeddingDimension) {
  return pgTable(
    `knowledge_embedding_d${dimension}`,
    {
      tenantId: uuid("tenant_id").notNull(),
      generationId: uuid("generation_id").notNull(),
      kind: embeddingOwnerKindEnum("kind").notNull(),
      // knowledge_chunk.id / graph_entity.id / graph_community.id, discriminated by `kind`.
      ownerId: uuid("owner_id").notNull(),
      // pgvector's HNSW index has a hard 2000-dimension ceiling for the full-
      // precision `vector` type (verified empirically against a real pgvector
      // 0.8.6 instance during this phase's implementation: `column cannot have
      // more than 2000 dimensions for hnsw index`). 3072 (the dimension of e.g.
      // OpenAI's `text-embedding-3-large`) exceeds it, so this ONE table uses
      // `halfvec` (half-precision, HNSW-indexable up to 4000 dims) instead of
      // `vector` — a disclosed, necessary correction to LLD §14.4.2's literal
      // `vector(<dim>)` for this dimension only. Every other dimension in the
      // supported set (384/768/1024/1536) stays full-precision `vector`.
      embedding: dimension === 3072 ? halfvec("embedding", { dimensions: dimension }).notNull() : vector("embedding", { dimensions: dimension }).notNull(),
    },
    (t) => [
      uniqueIndex(`knowledge_embedding_d${dimension}_pk`).on(t.tenantId, t.generationId, t.kind, t.ownerId),
      index(`knowledge_embedding_d${dimension}_tenant_generation_kind_idx`).on(t.tenantId, t.generationId, t.kind),
      // The real `HNSW (embedding vector_cosine_ops | halfvec_cosine_ops)` index is
      // authored directly in migration SQL (Drizzle's vector column builders have
      // no HNSW index-method helper as of this version) — see
      // `0065_knowledge_schema.sql`.
    ],
  );
}

export const knowledgeEmbeddingD384 = embeddingTable(384);
export const knowledgeEmbeddingD768 = embeddingTable(768);
export const knowledgeEmbeddingD1024 = embeddingTable(1024);
export const knowledgeEmbeddingD1536 = embeddingTable(1536);
export const knowledgeEmbeddingD3072 = embeddingTable(3072);

// ---------------------------------------------------------------------------
// graph_entity / graph_edge / graph_community — the Postgres side of ADR-0018's
// split (identity/metadata/summary text; the graph store holds structure+ids only).
// ---------------------------------------------------------------------------

export const graphEntity = pgTable(
  "graph_entity",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => knowledgeIndexGeneration.id),
    canonicalName: text("canonical_name").notNull(),
    // Open vocabulary (Person, Product, Policy, Amount, ...) — not an enum,
    // extraction is LLM-driven.
    type: text("type").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    // Postgres only, never sent to the graph store.
    summary: text("summary"),
    // No Drizzle-level `.references()` (circular with graph_community below) — real
    // FK added by the migration once graph_community exists.
    communityId: uuid("community_id"),
    // Denormalised from the graph store at the end of BuildGraph; 0 is legal and
    // renders as "No relations extracted" (FR-KB-04 boundary).
    degree: integer("degree").notNull().default(0),
    aclTags: text("acl_tags").array().notNull().default(sql`'{}'::text[]`),
    mentionCount: integer("mention_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("graph_entity_tenant_generation_type_canonical_name_key").on(t.tenantId, t.generationId, t.type, t.canonicalName),
    index("graph_entity_tenant_generation_community_idx").on(t.tenantId, t.generationId, t.communityId),
    index("graph_entity_tenant_generation_degree_idx").on(t.tenantId, t.generationId, t.degree),
    index("graph_entity_aliases_gin_idx").using("gin", t.aliases),
    index("graph_entity_acl_tags_gin_idx").using("gin", t.aclTags),
    index("graph_entity_canonical_name_trgm_idx").using("gin", sql`${t.canonicalName} gin_trgm_ops`),
  ],
);

export const graphEdge = pgTable(
  "graph_edge",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => knowledgeIndexGeneration.id),
    srcEntityId: uuid("src_entity_id")
      .notNull()
      .references(() => graphEntity.id),
    dstEntityId: uuid("dst_entity_id")
      .notNull()
      .references(() => graphEntity.id),
    relation: text("relation").notNull(),
    weight: real("weight").notNull().default(1.0),
    confidence: real("confidence").notNull(),
    // NOT NULL is the point (FR-KB-04: every relation traces to the sentence that
    // produced it).
    provenanceChunkId: uuid("provenance_chunk_id")
      .notNull()
      .references(() => knowledgeChunk.id),
    provenanceSpan: jsonb("provenance_span").$type<{ charStart: number; charEnd: number } | null>(),
    aclTags: text("acl_tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("graph_edge_tenant_generation_src_dst_relation_chunk_key").on(
      t.tenantId,
      t.generationId,
      t.srcEntityId,
      t.dstEntityId,
      t.relation,
      t.provenanceChunkId,
    ),
    index("graph_edge_tenant_generation_src_idx").on(t.tenantId, t.generationId, t.srcEntityId),
    index("graph_edge_tenant_generation_dst_idx").on(t.tenantId, t.generationId, t.dstEntityId),
    index("graph_edge_tenant_provenance_chunk_idx").on(t.tenantId, t.provenanceChunkId),
    check("graph_edge_no_self_loop", sql`${t.srcEntityId} <> ${t.dstEntityId}`),
    check("graph_edge_weight_positive", sql`${t.weight} > 0`),
    check("graph_edge_confidence_range", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
  ],
);

export const graphCommunity = pgTable(
  "graph_community",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => knowledgeIndexGeneration.id),
    // 0 = finest. Phase 7b ships single-level (0) community detection only
    // (disclosed narrowing — see this module's README); the column supports future
    // hierarchical levels without a schema change.
    level: smallint("level").notNull().default(0),
    parentId: uuid("parent_id"),
    // The graph store's own community id (this build: a stable hash of its sorted
    // member entity ids, since detection runs single-level in the worker).
    externalKey: text("external_key").notNull(),
    title: text("title"),
    // Postgres only.
    summary: text("summary"),
    // Set when membership changes; the CommunitySummaries stage regenerates only
    // stale rows (FR-KB-02 "regenerated incrementally").
    summaryStale: boolean("summary_stale").notNull().default(true),
    entityCount: integer("entity_count").notNull().default(0),
    aclTags: text("acl_tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("graph_community_tenant_generation_level_external_key_key").on(t.tenantId, t.generationId, t.level, t.externalKey),
    index("graph_community_tenant_generation_idx").on(t.tenantId, t.generationId),
    check("graph_community_level_range", sql`${t.level} >= 0 AND ${t.level} <= 8`),
    check("graph_community_parent_requires_level", sql`${t.parentId} IS NULL OR ${t.level} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// graph_entity_merge_candidate — the Resolve stage's human review queue (FR-KB-02)
// ---------------------------------------------------------------------------

export const graphEntityMergeCandidate = pgTable(
  "graph_entity_merge_candidate",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => knowledgeIndexGeneration.id),
    leftEntityId: uuid("left_entity_id")
      .notNull()
      .references(() => graphEntity.id),
    rightEntityId: uuid("right_entity_id")
      .notNull()
      .references(() => graphEntity.id),
    similarity: real("similarity").notNull(),
    rationale: text("rationale").notNull(),
    status: entityMergeStatusEnum("status").notNull().default("Pending"),
    decidedByUserId: uuid("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // `(tenant_id, generation_id, least(left,right), greatest(left,right))` is
    // authored directly in migration SQL (Drizzle has no portable
    // `least()`/`greatest()`-in-an-index-builder shape).
    index("graph_entity_merge_candidate_tenant_generation_status_idx").on(t.tenantId, t.generationId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_ingestion_job — the Postgres work table drained by the scheduled pump
// (LLD §14.4.3 — no queue library exists in this codebase; `FOR UPDATE SKIP LOCKED`
// leases, same idiom as every other `apps/worker` job).
// ---------------------------------------------------------------------------

export interface IngestionJobError {
  code: string;
  message: string;
  retriable: boolean;
}

export const knowledgeIngestionJob = pgTable(
  "knowledge_ingestion_job",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => knowledgeIndexGeneration.id),
    // NULL for collection-wide stages (CommunityDetection, CommunitySummaries, Index).
    sourceId: uuid("source_id").references(() => knowledgeSource.id),
    // Set for per-document stages (Parse, Chunk, ExtractEntities).
    documentId: uuid("document_id").references(() => knowledgeDocument.id),
    stage: ingestionStageEnum("stage").notNull(),
    // 1..10, the fixed stage order — the pump never leases a job whose stage_ordinal
    // exceeds min(stage_ordinal) of unfinished jobs in the same generation FOR
    // COLLECTION-WIDE STAGES; per-document stages run freely in parallel.
    stageOrdinal: smallint("stage_ordinal").notNull(),
    status: ingestionJobStatusEnum("status").notNull().default("Queued"),
    attempt: smallint("attempt").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(3),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    dependsOnJobId: uuid("depends_on_job_id"),
    input: jsonb("input"),
    output: jsonb("output"),
    error: jsonb("error").$type<IngestionJobError | null>(),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("knowledge_ingestion_job_tenant_generation_stage_status_idx").on(t.tenantId, t.generationId, t.stageOrdinal, t.status),
    index("knowledge_ingestion_job_pump_claim_idx").on(t.status, t.leaseExpiresAt),
    // The idempotency key: re-enqueuing the same unit of work is a no-op.
    // `coalesce(document_id, source_id, generation_id)` is authored directly in
    // migration SQL (Drizzle has no portable `coalesce()`-in-a-unique-index shape).
  ],
);

// ---------------------------------------------------------------------------
// retrieval_event — LLD §14.4.2. Named in Phase 7b's own schema file as an
// explicitly-deferred table ("nothing in Phase 7b's own scope reads or writes it...
// adding it later is a pure additive migration with no interaction with anything
// this phase ships") and again by Phase 9's own dispatch ("nothing in Phase 9's own
// scope reads/writes it — Phase 10/11's own scope"). Target Architecture Blueprint
// Phase 10 (BL-41, FR-KB-06) is that later phase: every retrieval the bounded
// retrieval agent (`knowledge/application/retrieval/retrieval-executor.ts`) performs
// writes exactly one row here, win or refuse alike.
//
// **Disclosed narrowing (mirrors `message`'s own already-established precedent,
// `conversations.ts`'s module doc)**: true monthly `PARTITION BY RANGE (created_at)`
// is deferred — a plain table today, shaped so a later partitioning conversion is a
// data migration, not a schema-shape change.
// ---------------------------------------------------------------------------

export const retrievalStrategySourceEnum = pgEnum("retrieval_strategy_source", ["Auto", "Pinned", "PlaygroundOverride"]);

export const retrievalEvent = pgTable(
  "retrieval_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    // NULL for playground/eval runs (LLD's own callout) — this phase's own writer
    // (a real conversation turn) always supplies one, but the column stays nullable
    // for a future eval/batch-run caller with no live conversation.
    conversationId: uuid("conversation_id"),
    agentRunId: uuid("agent_run_id").references(() => agentRun.id),
    agentDefinitionVersionId: uuid("agent_definition_version_id").references(() => agentDefinitionVersion.id),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollection.id),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => knowledgeIndexGeneration.id),
    strategy: retrievalStrategyEnum("strategy").notNull(),
    strategySource: retrievalStrategySourceEnum("strategy_source").notNull(),
    // sha256 of the raw query — the raw text itself is never stored here (it already
    // lives in `message`), keeping the coverage report PII-free by construction.
    queryTextHash: text("query_text_hash").notNull(),
    // Written only when the collection's PII policy permits (Phase 11/BL-42 scope —
    // this phase always leaves it NULL, a disclosed narrowing: no PII-policy-aware
    // masked-query capture exists yet).
    queryTextMasked: text("query_text_masked"),
    hops: smallint("hops").notNull().default(0),
    expansions: smallint("expansions").notNull().default(0),
    chunkIds: text("chunk_ids").array().notNull().default(sql`'{}'::text[]`),
    citationIds: text("citation_ids").array().notNull().default(sql`'{}'::text[]`),
    // NULL => nothing retrieved at all; a real score below `collection.
    // min_relevance_score` is still a real number (a coverage-gap row), never NULL.
    topScore: real("top_score"),
    grounded: boolean("grounded").notNull(),
    refused: boolean("refused").notNull().default(false),
    truncatedByBudget: boolean("truncated_by_budget").notNull().default(false),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    // The permission-intersection evaluator result this retrieval ran under (LLD
    // §14.2's `scopeHash`). **Disclosed narrowing**: `agent_definition_version` does
    // not yet persist a real `ScopeDescriptor`/`scope_json` in this build (Phase 6's
    // own module doc already discloses this — teams/workflows/knowledge chain-ref
    // resolution is Phase 14/15/7+ scope), so this phase computes a deterministic
    // sha256 over the resolved `ResolvedAgentKnowledgeConfig` instead of a real
    // evaluator scope hash — a placeholder with the SAME shape/purpose (a stable,
    // comparable fingerprint of "what scope governed this retrieval"), not a security
    // boundary itself (this table is an observability/audit trail, not an
    // authorization check).
    scopeHash: text("scope_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("retrieval_event_tenant_conversation_created_idx").on(t.tenantId, t.conversationId, t.createdAt),
    index("retrieval_event_tenant_collection_created_idx").on(t.tenantId, t.collectionId, t.createdAt),
    index("retrieval_event_tenant_grounded_created_idx").on(t.tenantId, t.grounded, t.createdAt),
  ],
);
