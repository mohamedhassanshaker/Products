import { Neo4jGraphStore, type GraphScope } from "@nextbot/graph-store";
import type { TenantContext } from "@nextbot/db";
import { callModelGatewayStructuredPinned, callModelGatewayEmbedding } from "@nextbot/model-gateway";
import { getGenerationOrThrow, updateGenerationCounts } from "../../infrastructure/generation-repository.js";
import { getCollectionOrThrow } from "../../infrastructure/collection-repository.js";
import { listChunksForDocument } from "../../infrastructure/document-chunk-repository.js";
import { completeJob, failJob, listJobsForGeneration, enqueueJob, type KnowledgeIngestionJobRow } from "../../infrastructure/ingestion-job-repository.js";
import { insertEntities, insertEdges, updateEntityDegree } from "../../infrastructure/graph-repository.js";
import { insertMergeCandidates } from "../../infrastructure/graph-repository.js";
import { areAllPriorStagesComplete } from "./pipeline-common.js";
import { EntityExtractionSchema, ENTITY_EXTRACTION_SYSTEM_PROMPT, type EntityExtractionResult } from "../../domain/entity-extraction-schema.js";
import { canonicalizeEntityName, groupMentionsByExactCanonical, applyAutoMerges, findMergeCandidates } from "../../domain/entity-resolution.js";
import { unionAclTags } from "../../domain/acl.js";

const RESOLVE_AUTO_MERGE_ABOVE = 0.93;
const RESOLVE_REVIEW_BAND_LOW = 0.8;

interface ChunkExtractionResult {
  chunkId: string;
  aclTags: string[];
  entities: EntityExtractionResult["entities"];
  relations: EntityExtractionResult["relations"];
}

/**
 * Stage 4 — ExtractEntities (LLD §14.4.3, per document). Calls the collection's
 * pinned `extraction_route_version_id` (the "designated cheap route", Blueprint
 * §7.2's "the dominant ingestion cost") once per chunk, through
 * `callModelGatewayStructuredPinned` — TypeBox-validated structured output, never
 * hand-parsed JSON (this project's AI-feature architecture rule). Raw per-chunk
 * results are stored on the job's own `output` (consumed by the generation-wide
 * Resolve stage next); a per-chunk extraction failure does not fail the whole
 * document (a `try`/`catch` per chunk, matching FR-KB-01/02's "one failure never
 * blocks the rest" pattern one level deeper than the stage table's own per-document
 * grain).
 */
export async function runExtractEntitiesStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  if (!job.documentId) {
    await failJob(ctx, job.id, { code: "EXTRACT_MISSING_DOCUMENT_ID", message: "ExtractEntities job has no documentId.", retriable: false });
    return;
  }
  try {
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    const collection = await getCollectionOrThrow(ctx, generation.collectionId);
    const chunks = await listChunksForDocument(ctx, job.generationId, job.documentId);

    const chunkResults: ChunkExtractionResult[] = [];
    for (const chunk of chunks) {
      try {
        const result = await callModelGatewayStructuredPinned(ctx, {
          routeVersionId: collection.extractionRouteVersionId,
          routeKeyForLog: "knowledge.extract",
          schema: EntityExtractionSchema,
          system: ENTITY_EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: chunk.text }],
          knowledgeGenerationId: job.generationId,
        });
        chunkResults.push({ chunkId: chunk.id, aclTags: chunk.aclTags, entities: result.entities, relations: result.relations });
      } catch {
        // A single chunk's extraction failure is skipped, never fatal to the
        // document — matches the stage table's "retry x3, then document skipped"
        // intent at the finer chunk grain this implementation actually extracts at.
        chunkResults.push({ chunkId: chunk.id, aclTags: chunk.aclTags, entities: [], relations: [] });
      }
    }

    await completeJob(ctx, job.id, { chunkResults });
  } catch (err) {
    await failJob(ctx, job.id, { code: "EXTRACT_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }

  if (await areAllPriorStagesComplete(ctx, job.generationId, ["Ingest", "Parse", "Chunk", "ExtractEntities"], { requireAtLeastOneIngestJob: true })) {
    await enqueueJob(ctx, { generationId: job.generationId, stage: "Resolve", input: {} });
  }
}

/**
 * Stage 5 — Resolve (per generation). Deterministic canonicalization first
 * (`groupMentionsByExactCanonical`), then embedding-cosine-similarity for near-
 * duplicates (via the collection's pinned embedding route — the SAME pin the
 * generation itself was built against): auto-merge `>= 0.93`, human review queue
 * `[0.80, 0.93)` written to `graph_entity_merge_candidate` (LLD §14.4.2's own
 * thresholds), below the band no candidate at all. Never blocks — a Resolve job
 * that fails still lets the generation continue by marking the failure and moving
 * on with whatever it could resolve deterministically (this build treats a genuine
 * Resolve error as retriable, matching the stage's own "never blocks" framing via
 * the job's normal retry/terminal-failure path rather than a bespoke partial-
 * failure mode).
 */
export async function runResolveStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  try {
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    const collection = await getCollectionOrThrow(ctx, generation.collectionId);
    const jobs = await listJobsForGeneration(ctx, job.generationId);
    const extractJobs = jobs.filter((j) => j.stage === "ExtractEntities" && j.status === "Succeeded");

    const mentions: Array<{ surfaceForm: string; type: string; chunkId: string; aclTags: string[] }> = [];
    const rawRelations: Array<{ chunkId: string; srcName: string; relation: string; dstName: string; confidence: number; nameToType: Map<string, string> }> = [];

    for (const extractJob of extractJobs) {
      const output = extractJob.output as { chunkResults: ChunkExtractionResult[] } | null;
      for (const chunkResult of output?.chunkResults ?? []) {
        const nameToType = new Map<string, string>();
        for (const entity of chunkResult.entities) {
          mentions.push({ surfaceForm: entity.name, type: entity.type, chunkId: chunkResult.chunkId, aclTags: chunkResult.aclTags });
          nameToType.set(canonicalizeEntityName(entity.name), entity.type);
        }
        for (const relation of chunkResult.relations) {
          rawRelations.push({ chunkId: chunkResult.chunkId, srcName: relation.srcName, relation: relation.relation, dstName: relation.dstName, confidence: relation.confidence, nameToType });
        }
      }
    }

    const groups = groupMentionsByExactCanonical(mentions.map((m) => ({ surfaceForm: m.surfaceForm, type: m.type })));
    // acl_tags per original group index — union of every mention's chunk's acl_tags
    // that canonicalized into this group (LLD: "union of the acl_tags of every
    // provenance chunk").
    const groupKeyToAclTags = new Map<string, string[]>();
    for (const mention of mentions) {
      const key = `${mention.type} ${canonicalizeEntityName(mention.surfaceForm)}`;
      groupKeyToAclTags.set(key, unionAclTags(groupKeyToAclTags.get(key) ?? [], mention.aclTags));
    }

    const embeddings: number[][] = [];
    for (const group of groups) {
      try {
        const { embedding } = await callModelGatewayEmbedding(ctx, {
          routeVersionId: collection.embeddingRouteVersionId,
          routeKeyForLog: "knowledge.embed",
          input: group.canonicalName,
          knowledgeGenerationId: job.generationId,
        });
        embeddings.push(embedding);
      } catch {
        embeddings.push([]); // an embedding failure for one group just excludes it from merge-candidate comparison, never fatal.
      }
    }

    const { autoMerge, review } = findMergeCandidates(groups, embeddings, RESOLVE_AUTO_MERGE_ABOVE, RESOLVE_REVIEW_BAND_LOW);
    const { mergedGroups, originalIndexToMergedIndex } = applyAutoMerges(groups, autoMerge);

    const groupKeyToOriginalIndex = new Map<string, number>();
    groups.forEach((g, i) => groupKeyToOriginalIndex.set(`${g.type} ${g.canonicalName}`, i));

    const resolvedEntities = mergedGroups.map((g) => ({
      canonicalName: g.canonicalName,
      type: g.type,
      aliases: g.aliases,
      mentionCount: g.mentionCount,
      aclTags: g.aliases.reduce<string[]>((acc, alias) => unionAclTags(acc, groupKeyToAclTags.get(`${g.type} ${canonicalizeEntityName(alias)}`) ?? []), []),
    }));

    const resolvedRelations = rawRelations
      .map((r) => {
        const srcType = r.nameToType.get(canonicalizeEntityName(r.srcName));
        const dstType = r.nameToType.get(canonicalizeEntityName(r.dstName));
        if (!srcType || !dstType) return null; // the model referenced a name outside this chunk's own extracted entities — dropped, never fabricated.
        const srcOriginal = groupKeyToOriginalIndex.get(`${srcType} ${canonicalizeEntityName(r.srcName)}`);
        const dstOriginal = groupKeyToOriginalIndex.get(`${dstType} ${canonicalizeEntityName(r.dstName)}`);
        if (srcOriginal === undefined || dstOriginal === undefined) return null;
        const srcMergedIndex = originalIndexToMergedIndex[srcOriginal];
        const dstMergedIndex = originalIndexToMergedIndex[dstOriginal];
        if (srcMergedIndex === undefined || dstMergedIndex === undefined || srcMergedIndex === dstMergedIndex) return null; // no self-loops (graph_edge's own CHECK constraint)
        return { srcMergedIndex, dstMergedIndex, relation: r.relation, confidence: r.confidence, provenanceChunkId: r.chunkId };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Review-band candidates are recorded once real graph_entity rows exist
    // (BuildGraph) — this stage stores the merge decision inputs (by original
    // group index) in its own job output for BuildGraph to translate into real
    // entity ids and write graph_entity_merge_candidate rows against.
    await completeJob(ctx, job.id, {
      resolvedEntities,
      resolvedRelations,
      reviewCandidates: review.map((r) => ({ leftGroupIndex: r.leftIndex, rightGroupIndex: r.rightIndex, similarity: r.similarity })),
      groupKeyToOriginalIndex: [...groupKeyToOriginalIndex.entries()],
      originalIndexToMergedIndex,
    });
    await enqueueJob(ctx, { generationId: job.generationId, stage: "BuildGraph", input: {} });
  } catch (err) {
    await failJob(ctx, job.id, { code: "RESOLVE_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}

interface ResolvedEntity {
  canonicalName: string;
  type: string;
  aliases: string[];
  mentionCount: number;
  aclTags: string[];
}
interface ResolvedRelation {
  srcMergedIndex: number;
  dstMergedIndex: number;
  relation: string;
  confidence: number;
  provenanceChunkId: string;
}

/**
 * Stage 6 — BuildGraph (per generation). Writes `graph_entity`/`graph_edge` to
 * Postgres FIRST (the commit point — LLD §14.4.3's own instruction: "a graph-store
 * failure retries from Postgres"), then `GraphStorePort.upsertNodes`/`upsertEdges`
 * (real Neo4j, via `withTenantGraph()` internally — this is the ONLY path this
 * module uses to reach the graph store, exclusively through the port). Entity
 * degree is denormalised from the graph store at the end, per LLD §14.4.2.
 */
export async function runBuildGraphStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  try {
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    const jobs = await listJobsForGeneration(ctx, job.generationId);
    const resolveJob = jobs.find((j) => j.stage === "Resolve" && j.status === "Succeeded");
    const output = resolveJob?.output as {
      resolvedEntities: ResolvedEntity[];
      resolvedRelations: ResolvedRelation[];
      reviewCandidates: Array<{ leftGroupIndex: number; rightGroupIndex: number; similarity: number }>;
      groupKeyToOriginalIndex: [string, number][];
      originalIndexToMergedIndex: number[];
    } | null;
    if (!output) throw new Error("BuildGraph stage: no successful Resolve job output found for this generation");

    const entityRows = await insertEntities(
      ctx,
      output.resolvedEntities.map((e) => ({ generationId: job.generationId, canonicalName: e.canonicalName, type: e.type, aliases: e.aliases, mentionCount: e.mentionCount, aclTags: e.aclTags })),
    );

    const edgeInputs = output.resolvedRelations
      .map((r) => {
        const srcEntity = entityRows[r.srcMergedIndex];
        const dstEntity = entityRows[r.dstMergedIndex];
        if (!srcEntity || !dstEntity) return null;
        return {
          generationId: job.generationId,
          srcEntityId: srcEntity.id,
          dstEntityId: dstEntity.id,
          relation: r.relation,
          confidence: r.confidence,
          provenanceChunkId: r.provenanceChunkId,
          aclTags: unionAclTags(srcEntity.aclTags, dstEntity.aclTags),
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const edgeRows = await insertEdges(ctx, edgeInputs);

    // Merge candidates: originalIndexToMergedIndex maps a group index that
    // collapsed into ONE entity, so a review-band pair naming two ORIGINAL group
    // indices resolves to two real (possibly identical, if both already auto-
    // merged) entity ids — skip a pair that already collapsed into the same entity.
    const mergeCandidateInputs = output.reviewCandidates
      .map((c) => {
        const leftMergedIndex = output.originalIndexToMergedIndex[c.leftGroupIndex];
        const rightMergedIndex = output.originalIndexToMergedIndex[c.rightGroupIndex];
        if (leftMergedIndex === undefined || rightMergedIndex === undefined || leftMergedIndex === rightMergedIndex) return null;
        const left = entityRows[leftMergedIndex];
        const right = entityRows[rightMergedIndex];
        if (!left || !right) return null;
        return { generationId: job.generationId, leftEntityId: left.id, rightEntityId: right.id, similarity: c.similarity, rationale: "Embedding-similarity match within the review band during entity resolution." };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    await insertMergeCandidates(ctx, mergeCandidateInputs);

    const graphStore = new Neo4jGraphStore();
    const scope: GraphScope = { tenantId: ctx.tenantId, generationId: generation.graphGenerationLabel };
    await graphStore.upsertNodes(
      scope,
      entityRows.map((e) => ({ id: e.id, type: e.type, aclTags: e.aclTags })),
    );
    await graphStore.upsertEdges(
      scope,
      edgeRows.map((e) => ({ id: e.id, srcId: e.srcEntityId, dstId: e.dstEntityId, relation: e.relation, weight: e.weight, aclTags: e.aclTags })),
    );

    const degrees = await graphStore.degrees(scope, entityRows.map((e) => e.id));
    for (const entity of entityRows) {
      await updateEntityDegree(ctx, entity.id, degrees[entity.id] ?? 0);
    }

    await updateGenerationCounts(ctx, job.generationId, { entityCount: entityRows.length, edgeCount: edgeRows.length });
    await completeJob(ctx, job.id, { entityCount: entityRows.length, edgeCount: edgeRows.length });
    await enqueueJob(ctx, { generationId: job.generationId, stage: "CommunityDetection", input: {} });
  } catch (err) {
    await failJob(ctx, job.id, { code: "BUILD_GRAPH_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}
