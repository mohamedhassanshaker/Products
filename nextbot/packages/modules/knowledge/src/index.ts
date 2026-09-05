// PUBLIC API for the "knowledge" module (Target Architecture Blueprint Phase 7b,
// BL-38, ADR-0018, LLD §14.4). The ONLY file other packages may import from.

export {
  createCollection,
  listCollections,
  getCollectionOrThrow,
  updateCollection,
  updateCollectionConfiguration,
  softDeleteCollection,
  type CreateCollectionRequest,
  type UpdateCollectionConfigRequest,
} from "./application/collection-service.js";

export {
  createSource,
  storeUploadAndBuildLocator,
  listSourcesForCollection,
  getSourceOrThrow,
  deleteSource,
  triggerSourceSync,
  type CreateSourceRequest,
} from "./application/source-service.js";

export {
  buildGeneration,
  listGenerationsForCollection,
  getGenerationOrThrow,
  cancelGeneration,
  type BuildGenerationRequest,
} from "./application/generation-service.js";

export {
  listGraphEntities,
  getGraphEntityDetail,
  listGraphCommunities,
  getGraphCommunityDetail,
  getChunkDetail,
  type ListGraphEntitiesQuery,
  type EntityListItem,
  type EntityListResult,
  type EntityDetailResult,
  type RelationItem,
  type RelationProvenance,
  type CommunityListItem,
  type CommunityDetailResult,
  type ChunkDetailResult,
} from "./application/graph-explorer-service.js";

// Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05) — the four retrieval
// strategies + the Retrieval Playground orchestrator. See
// `application/retrieval/retrieval-types.ts` for the shared result/metric shapes.
export { runRetrievalPlayground, type RetrievalPlaygroundRequest, type RetrievalPlaygroundResult } from "./application/retrieval/playground-service.js";
export { runVectorRetrieval } from "./application/retrieval/vector-strategy.js";
export { runGraphLocalRetrieval } from "./application/retrieval/graph-local-strategy.js";
export { runGraphGlobalRetrieval } from "./application/retrieval/graph-global-strategy.js";
export { runHybridRetrieval } from "./application/retrieval/hybrid-strategy.js";
export {
  ALL_RETRIEVAL_STRATEGIES,
  type RetrievalStrategyName,
  type RetrievalEvidenceItem,
  type RetrievalStrategyMetrics,
  type RetrievalStrategyResult,
} from "./application/retrieval/retrieval-types.js";

// Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06/07) — the bounded
// retrieval agent (`orchestration/application/turn-pipeline.ts`'s call site) plus its
// two cheap-route sub-calls, independently exported for direct testing.
export { runBoundedRetrieval, type RetrievalExecutorRequest, type RetrievalExecutorResult } from "./application/retrieval/retrieval-executor.js";
export { classifyRetrievalStrategy, type ClassifiedStrategy, type QueryClassificationResult } from "./application/retrieval/query-classifier.js";
export { checkSufficiency, type SufficiencyCheckResult } from "./application/retrieval/sufficiency-check.js";
export { insertRetrievalEvent, listRetrievalEventsForConversation, type RetrievalEventRow, type InsertRetrievalEventInput } from "./infrastructure/retrieval-event-repository.js";

export type { KnowledgeCollectionRow, UpdateCollectionFields } from "./infrastructure/collection-repository.js";
// Target Architecture Blueprint Phase 10 (BL-41) — save-time pin resolution for an
// agent version's `spec.knowledge.collections` (see `@nextbot/agent-platform`'s
// `createAgentDefinitionVersion`, mirroring `@nextbot/skills`'s `resolveSkillPin`).
export { resolveKnowledgeCollectionPin } from "./application/collection-pin-resolver.js";
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the opaque ACL-tag
// derivation `knowledge_source.acl_tags` already uses at ingestion time, now also
// used by `@nextbot/agent-platform`'s save-time resolver to turn a knowledge-scoped
// agent version's declared `spec.knowledge.aclScope` into the SAME tag-hash shape a
// chunk/entity/edge/community's own `acl_tags` carries (`unionAclTags` re-exported
// too — `retention-service.ts`'s cascade-purge community-membership recompute needs
// it to re-derive a community's acl_tags after a member entity is removed).
export { deriveAclTags, unionAclTags } from "./domain/acl.js";
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — PII read-time
// re-evaluation, reused directly by `retrieval-executor.ts`'s citation path and
// exposed publicly in case a future admin surface wants the identical mechanism.
export { resolveChunkTextForCaller } from "./application/pii-reeval-service.js";
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — retention
// cascade (explicit `deleteSource` now routes through this too, see
// `source-service.ts`) and the scheduled sweep `apps/worker` runs.
export { purgeSourceContent, sweepKnowledgeRetention, type PurgeSourceResult, type KnowledgeRetentionSweepResult } from "./application/retention-service.js";
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — Freshness badge +
// Coverage report, both read-only.
export { getCollectionFreshness, type CollectionFreshness, type CollectionFreshnessStatus } from "./application/freshness-service.js";
export { getCoverageReport, type CoverageReportQuery, type CoverageReportItem, type CoverageReportResult } from "./application/coverage-service.js";
export type { KnowledgeSourceRow } from "./infrastructure/source-repository.js";
export type { KnowledgeGenerationRow } from "./infrastructure/generation-repository.js";
export type { GraphEntityRow, GraphEdgeRow, GraphCommunityRow } from "./infrastructure/graph-repository.js";
export {
  listEntitiesForGeneration,
  listEdgesForGeneration,
  listCommunitiesForGeneration,
  listMergeCandidatesForGeneration,
  decideMergeCandidate,
} from "./infrastructure/graph-repository.js";

// The ingestion pipeline's own scheduled-job entry points, wired into
// `apps/worker`'s job registry (this phase's disclosed narrowing of LLD §15.3.2's
// literal `apps/ingest` deployable — see this module's README).
export { pumpIngestionJobs, reclaimExpiredIngestionLeases, type PumpResult } from "./application/pipeline/pump.js";
export { syncDueSources } from "./application/pipeline/source-sync.js";

export {
  handleListCollections,
  handleCreateCollection,
  handleGetCollection,
  handleUpdateCollection,
  handleUpdateCollectionConfig,
  handleDeleteCollection,
  handleListSources,
  handleCreateSource,
  handleUploadFile,
  handleGetSource,
  handleDeleteSource,
  handleSyncSource,
  handleGetSourceFailures,
  handleListGenerations,
  handleBuildGeneration,
  handleGetGenerationProgress,
  handleCancelGeneration,
  handleListGraphEntities,
  handleGetGraphEntity,
  handleListGraphCommunities,
  handleGetGraphCommunity,
  handleGetChunk,
  handleRunRetrievalPlayground,
  handleGetCollectionFreshness,
  handleGetCoverageReport,
} from "./http/admin-routes.js";
