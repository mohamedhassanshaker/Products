/**
 * The web-side seam onto `apps/ai`'s locked `/v1/knowledge/*` contract — the counterpart to
 * `modules/tools/ports/mcp-discovery-client.ts`, one method per documented endpoint rather
 * than a generic `post()` passthrough, so each call site gets real input/output types
 * instead of re-deriving the wire shape by hand. Unlike that MCP port, **every endpoint
 * here is real on the `apps/ai` side** (built in parallel with this module, to this exact
 * contract) — nothing in this file is a documented-but-absent placeholder.
 *
 * `GET`-shaped reads are still `POST`s (`AiClient.post()` is the only method the shared
 * transport exposes — see `platform/adapters/outbound/ai-client.ts`'s own module comment
 * for why extending it is out of scope unless truly unavoidable, which it was not here).
 */

import type { GraphLabel, RetrievedViaKind } from "../domain/knowledge-catalog.js";

// ---------------------------------------------------------------------------
// 1. POST /knowledge/ingest/chunk — pure compute, no store writes on the ai side.
// ---------------------------------------------------------------------------

export interface ChunkDocumentInput {
  readonly documentText: string;
  readonly chunkSizeTokens: number;
  readonly chunkOverlapTokens: number;
  readonly localeCode: string;
}

export interface ChunkedPassage {
  readonly ordinal: number;
  readonly text: string;
  readonly tokenCount: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly contentHash: string;
}

export interface ChunkDocumentResult {
  readonly chunks: readonly ChunkedPassage[];
}

// ---------------------------------------------------------------------------
// 2. POST /knowledge/ingest/embed-and-index
// ---------------------------------------------------------------------------

export interface EmbedAndIndexChunkInput {
  readonly chunkId: string;
  readonly text: string;
  readonly ordinal: number;
  readonly sectionPath: string | null;
  readonly pageNumber: number | null;
  readonly localeCode: string;
}

export interface EmbedAndIndexInput {
  readonly knowledgeCollectionId: string;
  readonly knowledgeSourceId: string;
  readonly embeddingModel: string;
  readonly embeddingDimension: number;
  readonly chunks: readonly EmbedAndIndexChunkInput[];
}

export interface EmbedAndIndexChunkResult {
  readonly chunkId: string;
  readonly vectorState: "Indexed" | "Failed";
  readonly graphState: "Indexed" | "Failed";
  readonly error: string | null;
}

export interface EmbedAndIndexGraphNodeWrite {
  readonly label: string;
  readonly canonicalKey: string;
  readonly canonicalName: string;
  readonly firstSeenChunkId: string;
}

export interface EmbedAndIndexGraphEdgeWrite {
  readonly relationshipType: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly evidenceChunkId: string;
  readonly confidence: number;
}

export interface EmbedAndIndexResult {
  readonly results: readonly EmbedAndIndexChunkResult[];
  readonly graphWrites: readonly EmbedAndIndexGraphNodeWrite[];
  readonly edgeWrites: readonly EmbedAndIndexGraphEdgeWrite[];
}

// ---------------------------------------------------------------------------
// 3. POST /knowledge/retrieval/query
// ---------------------------------------------------------------------------

export interface RetrievalQueryInput {
  readonly query: string;
  readonly knowledgeCollectionIds: readonly string[] | null;
}

export interface RetrievalResultRow {
  readonly chunkId: string;
  readonly score: number;
  readonly graphScore: number | null;
  readonly vectorScore: number | null;
  readonly text: string;
  readonly sectionPath: string | null;
  readonly pageNumber: number | null;
  readonly knowledgeSourceId: string;
  readonly knowledgeSourceName: string;
  readonly retrievedVia: RetrievedViaKind;
}

export interface MatchedSubgraphNode {
  readonly key: string;
  readonly label: string;
  readonly name: string;
}

export interface MatchedSubgraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

export interface MatchedSubgraph {
  readonly nodes: readonly MatchedSubgraphNode[];
  readonly edges: readonly MatchedSubgraphEdge[];
  readonly renderedPath: string | null;
}

export interface RetrievalQueryResult {
  readonly results: readonly RetrievalResultRow[];
  readonly matchedSubgraph: MatchedSubgraph;
  readonly degraded: boolean;
  readonly degradationReasons: readonly string[];
  readonly rerankApplied: boolean;
  readonly groundingConfidence: number;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// 4. POST /knowledge/graph/browse
// ---------------------------------------------------------------------------

export interface GraphBrowseInput {
  readonly rootKey: string | null;
  readonly depth: number;
  readonly types: readonly string[] | null;
  readonly limit: number;
}

export interface GraphBrowseNode {
  readonly key: string;
  readonly label: string;
  readonly name: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface GraphBrowseEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

export interface GraphBrowseResult {
  readonly nodes: readonly GraphBrowseNode[];
  readonly edges: readonly GraphBrowseEdge[];
  readonly truncated: boolean;
}

// ---------------------------------------------------------------------------
// 5 & 6. POST /knowledge/graph/nodes[/delete]
// ---------------------------------------------------------------------------

export interface UpsertGraphNodeInput {
  readonly label: GraphLabel;
  readonly canonicalKey: string;
  readonly canonicalName: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly parentKey: string | null;
  readonly relationshipType: string | null;
}

export type UpsertGraphNodeResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// 7, 8 & 9. POST /knowledge/duplicates/{detect,merge,ignore}
// ---------------------------------------------------------------------------

export interface DetectDuplicatesInput {
  readonly label: GraphLabel;
}

export interface DuplicateCandidateFromAi {
  readonly leftCanonicalKey: string;
  readonly rightCanonicalKey: string;
  readonly leftName: string;
  readonly rightName: string;
  readonly similarity: number;
  readonly detectionMethod: string;
}

export interface DetectDuplicatesResult {
  readonly candidates: readonly DuplicateCandidateFromAi[];
}

export interface MergeOrIgnoreDuplicateInput {
  readonly keepCanonicalKey: string;
  readonly absorbCanonicalKey: string;
}

// ---------------------------------------------------------------------------
// 10 & 11. POST /knowledge/reconcile/{inspect,graph-invariants}
// ---------------------------------------------------------------------------

export interface ReconcileInspectInput {
  readonly knowledgeSourceId: string;
}

export interface ReconcileInspectResult {
  readonly observedVectorChunkIds: readonly string[];
  readonly observedGraphChunkIds: readonly string[];
}

export interface GraphInvariantsResult {
  readonly labelledButWrongProp: number;
  readonly propButNoLabel: number;
  readonly crossTenantEdges: number;
}

export interface KnowledgeAiClient {
  chunkDocument(input: ChunkDocumentInput): Promise<ChunkDocumentResult>;
  embedAndIndex(input: EmbedAndIndexInput): Promise<EmbedAndIndexResult>;
  retrievalQuery(input: RetrievalQueryInput): Promise<RetrievalQueryResult>;
  browseGraph(input: GraphBrowseInput): Promise<GraphBrowseResult>;
  upsertGraphNode(input: UpsertGraphNodeInput): Promise<UpsertGraphNodeResult>;
  deleteGraphNode(canonicalKey: string): Promise<{ readonly ok: true }>;
  detectDuplicates(input: DetectDuplicatesInput): Promise<DetectDuplicatesResult>;
  mergeDuplicate(input: MergeOrIgnoreDuplicateInput): Promise<{ readonly ok: true }>;
  ignoreDuplicate(input: MergeOrIgnoreDuplicateInput): Promise<{ readonly ok: true }>;
  reconcileInspect(input: ReconcileInspectInput): Promise<ReconcileInspectResult>;
  graphInvariants(): Promise<GraphInvariantsResult>;
}
