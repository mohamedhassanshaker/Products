import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";

/**
 * Target Architecture Blueprint Phase 7b (BL-38, ADR-0018, LLD §14.4) — Module B
 * domain errors and shared shape mirrors.
 *
 * The plain TS interfaces below mirror `packages/db/src/schema/knowledge.ts`'s own
 * (independently declared) shapes exactly — the same "small mirror type in
 * `@nextbot/contracts`, a separate local copy for the DB layer's own `$type<>()`
 * JSONB annotations" convention `ModelCapabilities`/`model-gateway.ts` already
 * established, so `packages/modules/knowledge/src/domain/**` (which must stay
 * `@nextbot/db`-free per `no-db-inside-domain`) has a pure-package source for these
 * shapes instead of importing the infrastructure package.
 */

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

export interface ParsedBlock {
  kind: "text" | "table" | "heading" | "list" | "code";
  page?: number;
  section?: string;
  content: string;
  tableJson?: string[][];
}

export interface ChunkProvenance {
  documentTitle: string | null;
  page?: number;
  section?: string;
  blockIndex: number;
  charStart: number;
  charEnd: number;
}

export interface KnowledgeAcl {
  roleIds?: string[];
  capabilityGroupIds?: string[];
  tags: string[];
  visibility: "Tenant" | "Restricted";
}

/** Named error codes exactly as LLD §14.4.5's API-surface table lists them. */

export class KnowledgeCollectionNotFoundError extends DomainError {
  readonly code = "KNOWLEDGE_COLLECTION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Knowledge collection '${id}' was not found.`);
  }
}

export class KnowledgeCollectionNameDuplicateError extends DomainError {
  readonly code = "KNOWLEDGE_COLLECTION_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A knowledge collection named '${name}' already exists.`);
  }
}

export class KnowledgeSourceNotFoundError extends DomainError {
  readonly code = "KNOWLEDGE_SOURCE_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Knowledge source '${id}' was not found.`);
  }
}

/** FR-KB-08 — a collection configuration that would send chunks out of region is
 *  rejected at save time, never silently accepted (the same "reject at save time"
 *  convention Phase 2's route residency check established). */
export class KnowledgeRegionMismatchError extends DomainError {
  readonly code = "KNOWLEDGE_REGION_MISMATCH";
  readonly httpStatus = 422;
  constructor(collectionRegion: string, tenantRegion: string) {
    super(
      `This collection's region ('${collectionRegion}') does not match the tenant's configured storage region ('${tenantRegion}'), and out-of-region inference is not enabled for this tenant.`,
      [{ path: "region", code: "KNOWLEDGE_REGION_MISMATCH", message: "Collection region must match the tenant's residency region unless out-of-region inference is explicitly allowed." }],
    );
  }
}

/** FR-KB-03/§14.4.2 — the closed set of supported embedding dimensions
 *  (384/768/1024/1536/3072); pgvector needs a fixed typmod to build an HNSW index. */
export class EmbeddingDimensionUnsupportedError extends DomainError {
  readonly code = "EMBEDDING_DIMENSION_UNSUPPORTED";
  readonly httpStatus = 422;
  constructor(dimension: number) {
    super(`Embedding dimension ${dimension} is not one of the supported dimensions (384, 768, 1024, 1536, 3072).`, [
      { path: "embeddingRouteVersionId", code: "EMBEDDING_DIMENSION_UNSUPPORTED", message: "The pinned embedding model's dimension must be one of the supported set." },
    ]);
  }
}

/** FR-KB-03 — changing a collection's embedding model never silently re-embeds in
 *  place; building a new generation with a different embedding model than the
 *  current Ready generation requires explicit `confirmReEmbed: true`. */
export class EmbeddingModelChangeRequiresReembedError extends DomainError {
  readonly code = "EMBEDDING_MODEL_CHANGE_REQUIRES_REEMBED";
  readonly httpStatus = 409;
  constructor() {
    super("Changing the embedding model invalidates this index and requires a full re-embed — pass confirmReEmbed: true to proceed.");
  }
}

export class KnowledgeGenerationNotReadyError extends DomainError {
  readonly code = "KNOWLEDGE_GENERATION_NOT_READY";
  readonly httpStatus = 409;
  constructor(id: string) {
    super(`Knowledge generation '${id}' is not Ready.`);
  }
}

export class KnowledgeSourceLocatorInvalidError extends DomainError {
  readonly code = "KNOWLEDGE_SOURCE_LOCATOR_INVALID";
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`Invalid source locator: ${reason}`, [{ path: "locator", code: "KNOWLEDGE_SOURCE_LOCATOR_INVALID", message: reason }]);
  }
}

/**
 * Target Architecture Blueprint Phase 8 (BL-39, FR-KB-04, LLD §14.4.5) — the Graph
 * Explorer's own not-found errors. `graph_entity`/`graph_community`/`knowledge_chunk`
 * previously had no dedicated "not found" error because nothing outside the
 * ingestion pipeline itself ever looked one up by id; the explorer is the first
 * caller that does.
 */
export class GraphEntityNotFoundError extends DomainError {
  readonly code = "GRAPH_ENTITY_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Entity '${id}' was not found.`);
  }
}

export class GraphCommunityNotFoundError extends DomainError {
  readonly code = "GRAPH_COMMUNITY_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Community '${id}' was not found.`);
  }
}

/** FR-KB-04's own critical requirement: a relation's provenance must resolve to the
 *  actual source chunk text, never merely an id — this is the error when it can't. */
export class KnowledgeChunkNotFoundError extends DomainError {
  readonly code = "KNOWLEDGE_CHUNK_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Chunk '${id}' was not found.`);
  }
}

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, LLD §14.4.5) — the
 * Retrieval Playground's own save-time validation: an empty query has nothing to
 * embed/anchor/search against, so it is rejected at the boundary rather than
 * silently producing four empty result sets.
 */
export class RetrievalQueryRequiredError extends DomainError {
  readonly code = "RETRIEVAL_QUERY_REQUIRED";
  readonly httpStatus = 422;
  constructor() {
    super("A non-empty query is required to run a retrieval strategy.", [{ path: "query", code: "RETRIEVAL_QUERY_REQUIRED", message: "Query must not be empty." }]);
  }
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06/07, LLD §14.4.4) — the
 * bounded retrieval agent's shared vocabulary. `RetrievalStrategySchema` mirrors
 * `packages/db/src/schema/knowledge.ts`'s pre-existing `retrieval_strategy` Postgres
 * enum exactly (same "small TypeBox mirror, one native DB enum" convention this file's
 * own module doc already establishes).
 */
export const RetrievalStrategySchema = Type.Union([
  Type.Literal("Vector"),
  Type.Literal("GraphLocal"),
  Type.Literal("GraphGlobal"),
  Type.Literal("Hybrid"),
]);
export type RetrievalStrategyValue = Static<typeof RetrievalStrategySchema>;

/** LLD §14.4.4's `RetrievalResultSchema.outcome` — the five terminal states the
 *  bounded retrieval agent can end a turn in. `Refused` is the safety-critical one:
 *  set only when `refuseWhenUngrounded` fired, and the ONLY outcome whose answer text
 *  is never the model's own synthesized text (see `retrieval-executor.ts`). */
export const RetrievalOutcomeSchema = Type.Union([
  Type.Literal("Grounded"),
  Type.Literal("Ungrounded"),
  Type.Literal("Refused"),
  Type.Literal("BudgetTruncated"),
  Type.Literal("Stale"),
]);
export type RetrievalOutcomeValue = Static<typeof RetrievalOutcomeSchema>;

/**
 * LLD §14.4.4's `CitationSchema` verbatim — "structured references: collection,
 * document, chunk and, for graph retrieval, the relation path" (Blueprint §7.5). This
 * is what rides on `TextPayload.citations` (`packages/contracts/src/messages.ts`) and
 * what `retrieval_event.citation_ids` names by id.
 */
export const CitationSchema = Type.Object({
  collectionId: Type.String({ format: "uuid" }),
  collectionName: Type.String(),
  documentId: Type.String({ format: "uuid" }),
  documentTitle: Type.String(),
  chunkId: Type.String({ format: "uuid" }),
  page: Type.Optional(Type.Integer()),
  section: Type.Optional(Type.String()),
  /** Read-time content — already index-time masked per the collection's trust level
   *  (Phase 7b); real per-caller read-time re-evaluation against the caller's own
   *  trust level is Phase 11's (BL-42) scope, not this phase's — see
   *  `retrieval-executor.ts`'s own doc comment for the disclosed narrowing. */
  snippet: Type.String(),
  /** Graph strategies only — the relation path that justified this chunk. */
  relationPath: Type.Optional(
    Type.Array(
      Type.Object({
        srcName: Type.String(),
        relation: Type.String(),
        dstName: Type.String(),
        provenanceChunkId: Type.String({ format: "uuid" }),
      }),
    ),
  ),
});
export type Citation = Static<typeof CitationSchema>;
