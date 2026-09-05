import type { TenantContext } from "@nextbot/db";
import type { ChunkProvenance, KnowledgeTrustLevel } from "@nextbot/db";
import { getGenerationOrThrow } from "../infrastructure/generation-repository.js";
import { getSource } from "../infrastructure/source-repository.js";
import { getDocument, getChunkOrThrow, listChunksByIds } from "../infrastructure/document-chunk-repository.js";
import { resolveChunkTextForCaller } from "./pii-reeval-service.js";
import {
  getEntityOrThrow,
  listEntitiesByIds,
  listEntitiesForGenerationPage,
  listEdgesForEntity,
  listCommunitiesForGeneration,
  listCommunitiesByIds,
  getCommunityOrThrow,
  listEntitiesForCommunity,
  type GraphEntityRow,
  type GraphCommunityRow,
} from "../infrastructure/graph-repository.js";
import { GraphEntityNotFoundError, GraphCommunityNotFoundError } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 8 (BL-39, FR-KB-04, LLD §14.4.5) — the Graph
 * Explorer's application layer.
 *
 * Design decision (recorded per this phase's own request for reasoning): every read
 * here goes through Postgres (`graph_entity`/`graph_edge`/`graph_community`/
 * `knowledge_chunk`) and NEVER touches `@nextbot/graph-store`/`withTenantGraph()`.
 * This is not an oversight — LLD §14.4.1's own split table is explicit that
 * entity/edge/community IDENTITY, METADATA, and SUMMARY TEXT are Postgres's job
 * ("system of record; rebuildable source for the graph store") and that the graph
 * store holds structure ONLY for traversal, with "deliberately NO name/summary/text
 * field" (§14.4.6's `GraphNodeRecord`/`GraphEdgeRecord`). Every field FR-KB-04 asks
 * this screen to show — canonical name, type, summary, community, relation
 * type/weight, and (critically) provenance — already lives in Postgres in full. A
 * live Neo4j traversal would add latency and a second failure mode for zero new
 * information; it would only earn its cost for a feature this phase does not build
 * (an N-hop neighbourhood walk, which is Phase 9/10's graph-local/graph-global
 * retrieval strategies' job, not a curator inspection screen's). Consequently this
 * phase adds ZERO new call sites into `@nextbot/graph-store` and the
 * `no-neo4j-driver-outside-graph-store` dependency-cruiser rule is untouched by
 * this dispatch.
 */

export interface EntityListItem {
  id: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  summary: string | null;
  degree: number;
  mentionCount: number;
  communityId: string | null;
  communityTitle: string | null;
}

function toEntityListItem(row: GraphEntityRow, communityTitle: string | null): EntityListItem {
  return {
    id: row.id,
    canonicalName: row.canonicalName,
    type: row.type,
    aliases: row.aliases,
    summary: row.summary,
    degree: row.degree,
    mentionCount: row.mentionCount,
    communityId: row.communityId,
    communityTitle,
  };
}

export interface CommunityListItem {
  id: string;
  level: number;
  title: string | null;
  summary: string | null;
  summaryStale: boolean;
  entityCount: number;
}

function toCommunityListItem(row: GraphCommunityRow): CommunityListItem {
  return {
    id: row.id,
    level: row.level,
    title: row.title,
    summary: row.summary,
    summaryStale: row.summaryStale,
    entityCount: row.entityCount,
  };
}

/** Opaque keyset cursor — `base64url(JSON({degree, id}))` of the last row on the
 *  previous page. Never a client-supplied offset (stable under concurrent inserts
 *  between page loads, unlike `OFFSET`). A malformed/tampered cursor is treated as
 *  "no cursor" (first page) rather than a hard error — this is an internal-only
 *  opaque token with no security consequence if garbled (worst case: page 1 instead
 *  of a 4xx), so failing open here is a usability choice, not a corner cut. */
function encodeEntityCursor(row: { degree: number; id: string }): string {
  return Buffer.from(JSON.stringify({ degree: row.degree, id: row.id })).toString("base64url");
}

function decodeEntityCursor(cursor: string | undefined): { degree: number; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (parsed && typeof parsed === "object" && typeof (parsed as { degree?: unknown }).degree === "number" && typeof (parsed as { id?: unknown }).id === "string") {
      return parsed as { degree: number; id: string };
    }
  } catch {
    // Fall through to "no cursor" — see doc comment above.
  }
  return undefined;
}

export interface ListGraphEntitiesQuery {
  q?: string;
  type?: string;
  communityId?: string;
  minDegree?: number;
  cursor?: string;
  limit?: number;
}

export interface EntityListResult {
  entities: EntityListItem[];
  nextCursor: string | null;
}

/** `GET .../graph/entities?q&type&communityId&minDegree&cursor` (LLD §14.4.5). */
export async function listGraphEntities(ctx: TenantContext, generationId: string, query: ListGraphEntitiesQuery): Promise<EntityListResult> {
  await getGenerationOrThrow(ctx, generationId); // 404s if the generation doesn't exist / isn't this tenant's
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const page = await listEntitiesForGenerationPage(ctx, generationId, {
    q: query.q,
    type: query.type,
    communityId: query.communityId,
    minDegree: query.minDegree,
    cursor: decodeEntityCursor(query.cursor),
    limit,
  });

  const communityIds = [...new Set(page.rows.map((r) => r.communityId).filter((id): id is string => id !== null))];
  const communities = await listCommunitiesByIds(ctx, communityIds);
  const titleByCommunityId = new Map(communities.map((c) => [c.id, c.title]));

  const entities = page.rows.map((r) => toEntityListItem(r, r.communityId ? (titleByCommunityId.get(r.communityId) ?? null) : null));
  const lastRow = page.rows[page.rows.length - 1];
  const nextCursor = page.hasMore && lastRow ? encodeEntityCursor(lastRow) : null;
  return { entities, nextCursor };
}

export interface RelationProvenance {
  chunkId: string;
  documentTitle: string | null;
  page?: number;
  section?: string;
  blockIndex: number;
  /** The specific character span WITHIN the chunk this relation was extracted from,
   *  when the extractor recorded one (`graph_edge.provenance_span`) — narrower than
   *  the chunk's own document-level span in `provenance` above. */
  span: { charStart: number; charEnd: number } | null;
}

export interface RelationItem {
  edgeId: string;
  direction: "outgoing" | "incoming";
  relation: string;
  weight: number;
  confidence: number;
  otherEntity: { id: string; canonicalName: string; type: string };
  provenance: RelationProvenance;
}

export interface EntityDetailResult {
  entity: EntityListItem;
  relations: RelationItem[];
}

/** `GET .../graph/entities/{entityId}` — entity + EVERY relation touching it (either
 *  direction) + each relation's provenance (LLD §14.4.5's "+ relations +
 *  provenance"). This is the FR-KB-04 critical path: every relation traces back to
 *  the chunk that produced it. */
export async function getGraphEntityDetail(ctx: TenantContext, generationId: string, entityId: string): Promise<EntityDetailResult> {
  await getGenerationOrThrow(ctx, generationId);
  const entity = await getEntityOrThrow(ctx, entityId);
  // Defence-in-depth correctness check, not a tenant-isolation boundary (RLS already
  // enforces the tenant scope inside every repository call above) — an entity id
  // that resolves but belongs to a DIFFERENT generation of the same tenant is a
  // wrong URL, not a different tenant's data, and should 404 rather than silently
  // rendering an entity from the wrong generation.
  if (entity.generationId !== generationId) throw new GraphEntityNotFoundError(entityId);

  const edges = await listEdgesForEntity(ctx, generationId, entityId);
  const otherEntityIds = [...new Set(edges.map((e) => (e.srcEntityId === entityId ? e.dstEntityId : e.srcEntityId)))];
  const chunkIds = [...new Set(edges.map((e) => e.provenanceChunkId))];
  const [otherEntities, chunks, communityTitle] = await Promise.all([
    listEntitiesByIds(ctx, otherEntityIds),
    listChunksByIds(ctx, chunkIds),
    entity.communityId ? getCommunityOrThrow(ctx, entity.communityId).then((c) => c.title) : Promise.resolve(null),
  ]);
  const otherEntityById = new Map(otherEntities.map((e) => [e.id, e]));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));

  const relations: RelationItem[] = edges.map((e) => {
    const direction: "outgoing" | "incoming" = e.srcEntityId === entityId ? "outgoing" : "incoming";
    const otherId = direction === "outgoing" ? e.dstEntityId : e.srcEntityId;
    const other = otherEntityById.get(otherId);
    const chunk = chunkById.get(e.provenanceChunkId);
    const provenance: ChunkProvenance | undefined = chunk?.provenance;
    return {
      edgeId: e.id,
      direction,
      relation: e.relation,
      weight: e.weight,
      confidence: e.confidence,
      // A missing "other side" entity should be structurally impossible (the FK is
      // NOT NULL and both sides share this generation), but the explorer degrades to
      // a labelled placeholder rather than throwing, matching FR-KB-04's own
      // boundary philosophy ("isolated node still renders, tagged distinctly" — the
      // same non-hiding treatment applied to a would-be dangling reference).
      otherEntity: other ? { id: other.id, canonicalName: other.canonicalName, type: other.type } : { id: otherId, canonicalName: "(entity not found)", type: "Unknown" },
      provenance: {
        chunkId: e.provenanceChunkId,
        documentTitle: provenance?.documentTitle ?? null,
        page: provenance?.page,
        section: provenance?.section,
        blockIndex: provenance?.blockIndex ?? 0,
        span: e.provenanceSpan ?? null,
      },
    };
  });

  return { entity: toEntityListItem(entity, communityTitle), relations };
}

/** `GET .../graph/communities?level` (LLD §14.4.5). `level` is left optional/
 *  unfiltered by default since Phase 7b's ingestion pipeline only ever populates
 *  level 0 (its own disclosed single-level-detection narrowing) — the filter exists
 *  so the API/screen don't need a schema change once a future phase adds
 *  hierarchical levels. */
export async function listGraphCommunities(ctx: TenantContext, generationId: string, level?: number): Promise<CommunityListItem[]> {
  await getGenerationOrThrow(ctx, generationId);
  const rows = await listCommunitiesForGeneration(ctx, generationId, level);
  return rows.map(toCommunityListItem);
}

export interface CommunityDetailResult {
  community: CommunityListItem;
  members: EntityListItem[];
}

/** `GET .../graph/communities/{communityId}` — community + its member entities
 *  (FR-KB-04: "entities grouped by community, with the community's own generated
 *  summary visible"). */
export async function getGraphCommunityDetail(ctx: TenantContext, generationId: string, communityId: string): Promise<CommunityDetailResult> {
  await getGenerationOrThrow(ctx, generationId);
  const community = await getCommunityOrThrow(ctx, communityId);
  if (community.generationId !== generationId) throw new GraphCommunityNotFoundError(communityId);
  const members = await listEntitiesForCommunity(ctx, generationId, communityId);
  return { community: toCommunityListItem(community), members: members.map((m) => toEntityListItem(m, community.title)) };
}

export interface ChunkDetailResult {
  id: string;
  text: string;
  tokenCount: number;
  provenance: ChunkProvenance;
  documentId: string;
  documentTitle: string | null;
  sourceId: string;
  sourceName: string;
  generationId: string;
}

/**
 * `GET .../chunks/{chunkId}` — the provenance drill-down's terminal step (FR-KB-04:
 * "so a wrong or strange-looking answer... can be traced back to the exact sentence
 * that produced the bad edge"). Returns the chunk's actual TEXT (never merely its
 * id), plus the document title and source name so a curator can see, at a glance,
 * which document/page/section it came from without a second navigation hop. This
 * endpoint has no dedicated entry in LLD §14.4.5's literal endpoint list — a
 * disclosed, necessary addition, since FR-KB-04's own text explicitly requires this
 * exact capability ("clicking through must show the actual chunk text") and no
 * existing endpoint in that list serves a single chunk by id.
 */
/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — `callerTrustLevel` is
 * OPTIONAL and additive: every pre-existing caller (the console's own Graph Explorer
 * UI, which does not pass one) keeps getting `chunk.text` exactly as already
 * index-time-masked, zero behavior change. When a caller DOES supply its own trust
 * level (the bounded retrieval agent's citation path, see `retrieval-executor.ts`),
 * this re-evaluates the masking against THAT trust level via
 * `resolveChunkTextForCaller` — the same chunk can therefore render differently
 * masked depending on who's asking.
 */
export async function getChunkDetail(ctx: TenantContext, chunkId: string, callerTrustLevel?: KnowledgeTrustLevel): Promise<ChunkDetailResult> {
  const chunk = await getChunkOrThrow(ctx, chunkId);
  const [document, source] = await Promise.all([getDocument(ctx, chunk.documentId), getSource(ctx, chunk.sourceId)]);
  const text = callerTrustLevel ? await resolveChunkTextForCaller(ctx, chunk, callerTrustLevel) : chunk.text;
  return {
    id: chunk.id,
    text,
    tokenCount: chunk.tokenCount,
    provenance: chunk.provenance,
    documentId: chunk.documentId,
    documentTitle: document?.title ?? chunk.provenance.documentTitle ?? null,
    sourceId: chunk.sourceId,
    sourceName: source?.name ?? "(unknown source)",
    generationId: chunk.generationId,
  };
}
