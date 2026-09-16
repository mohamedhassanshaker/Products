/**
 * The real `KnowledgeAiClient` adapter — calls `apps/ai`'s locked `/v1/knowledge/*`
 * contract via `createTenantScopedAiClient()`, mirroring `ai-service-mcp-discovery-
 * client.ts`'s "web holds no vendor driver" rule exactly. Every endpoint here is real on
 * the `apps/ai` side (built in parallel, to this exact contract) — unlike the MCP
 * precedent, there is no "not implemented yet" branch to translate around.
 *
 * `AiClient.post<TResponse>()` already returns `(await response.json()) as TResponse`
 * (`platform/adapters/outbound/ai-client.ts`'s own `performPost`) — this codebase's
 * established boundary-trust convention for the internal API, matched here rather than
 * re-implementing a second, redundant runtime-validation layer this adapter would be the
 * only caller of. `AiServiceError` (thrown by `post()` on a non-2xx) is left to propagate
 * to this module's own application-layer callers, which translate it the same honest way
 * every other consumer of `ai-client.ts` does (only `.code`/`.status`/`.traceId` ever
 * cross into UI-facing error handling — api.md §2.2).
 */

import { createTenantScopedAiClient } from "../../../../platform/adapters/outbound/ai-client.js";
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
} from "../../../ports/knowledge-ai-client.js";

export class AiServiceKnowledgeClient implements KnowledgeAiClient {
  async chunkDocument(input: ChunkDocumentInput): Promise<ChunkDocumentResult> {
    const client = createTenantScopedAiClient();
    return client.post<ChunkDocumentResult>("/knowledge/ingest/chunk", { ...input });
  }

  async embedAndIndex(input: EmbedAndIndexInput): Promise<EmbedAndIndexResult> {
    const client = createTenantScopedAiClient();
    return client.post<EmbedAndIndexResult>("/knowledge/ingest/embed-and-index", { ...input });
  }

  async retrievalQuery(input: RetrievalQueryInput): Promise<RetrievalQueryResult> {
    const client = createTenantScopedAiClient();
    return client.post<RetrievalQueryResult>("/knowledge/retrieval/query", { ...input });
  }

  async browseGraph(input: GraphBrowseInput): Promise<GraphBrowseResult> {
    const client = createTenantScopedAiClient();
    return client.post<GraphBrowseResult>("/knowledge/graph/browse", { ...input });
  }

  async upsertGraphNode(input: UpsertGraphNodeInput): Promise<UpsertGraphNodeResult> {
    const client = createTenantScopedAiClient();
    return client.post<UpsertGraphNodeResult>("/knowledge/graph/nodes", { ...input });
  }

  async deleteGraphNode(canonicalKey: string): Promise<{ readonly ok: true }> {
    const client = createTenantScopedAiClient();
    return client.post<{ readonly ok: true }>("/knowledge/graph/nodes/delete", { canonicalKey });
  }

  async detectDuplicates(input: DetectDuplicatesInput): Promise<DetectDuplicatesResult> {
    const client = createTenantScopedAiClient();
    return client.post<DetectDuplicatesResult>("/knowledge/duplicates/detect", { ...input });
  }

  async mergeDuplicate(input: MergeOrIgnoreDuplicateInput): Promise<{ readonly ok: true }> {
    const client = createTenantScopedAiClient();
    return client.post<{ readonly ok: true }>("/knowledge/duplicates/merge", { ...input });
  }

  async ignoreDuplicate(input: MergeOrIgnoreDuplicateInput): Promise<{ readonly ok: true }> {
    const client = createTenantScopedAiClient();
    return client.post<{ readonly ok: true }>("/knowledge/duplicates/ignore", { ...input });
  }

  async reconcileInspect(input: ReconcileInspectInput): Promise<ReconcileInspectResult> {
    const client = createTenantScopedAiClient();
    return client.post<ReconcileInspectResult>("/knowledge/reconcile/inspect", { ...input });
  }

  async graphInvariants(): Promise<GraphInvariantsResult> {
    const client = createTenantScopedAiClient();
    return client.post<GraphInvariantsResult>("/knowledge/reconcile/graph-invariants", {});
  }
}
