// packages/graph-store/src/port.ts — no product name appears in this file
// (ADR-0018 §2.6 / LLD §14.4.6: the port stays product-neutral so a future adapter
// swap — e.g. NebulaGraph, if the Neo4j Enterprise license ever becomes untenable —
// does not require every caller to change).

/**
 * The two-boundary scope every `GraphStorePort` method requires.
 *
 * The tenant and generation boundaries are DELIBERATELY given different mechanisms
 * (ADR-0018 §2.3): mixing two tenants is a security breach and gets engine
 * enforcement; mixing two generations is a correctness bug (a mixed vector space in
 * one ranking pass) and gets a predicate plus a test. A single opaque `namespace`
 * key would have hidden that distinction and invited a future adapter to demote the
 * tenant boundary to a predicate — so the two are split into separate fields here.
 */
export interface GraphScope {
  /** Selects the tenant's ISOLATED STORE. In the Neo4j adapter this is the database
   *  `t-<hex(tenantId)>`, entered only via `withTenantGraph()` — never a query
   *  predicate. */
  tenantId: string;
  /** Correctness boundary, always a predicate: the `:G_<hex>` label +
   *  `generationId` property = `knowledge_index_generation.graph_generation_label`.
   *  REQUIRED on every method — there is no overload that omits it (ADR-0018 §2.3). */
  generationId: string;
}

/** A graph node as the port sees it. Deliberately carries NO name/summary/text
 *  field — entity/community summary text lives in Postgres only (LLD §14.4.1); a
 *  graph-store compromise must leak structure, never tenant content. */
export interface GraphNodeRecord {
  /** = `graph_entity.id` (uuid) — the system of record is Postgres; this store is a
   *  rebuildable cache with an index over it. */
  id: string;
  type: string;
  /** Opaque hashes only — never a readable role/ACL name (pre-ranking ACL
   *  filtering, FR-KB-08). */
  aclTags: string[];
}

/** A graph edge as the port sees it. `relation` is a Cypher relationship TYPE —
 *  see `naming.ts`'s `assertValidRelationType` for why it must be validated before
 *  ever touching a query string. */
export interface GraphEdgeRecord {
  /** = `graph_edge.id` (uuid). */
  id: string;
  srcId: string;
  dstId: string;
  relation: string;
  weight: number;
  aclTags: string[];
}

export interface NeighbourhoodRequest {
  anchorNodeIds: string[];
  /** Hard cap, honoured server-side (FR-KB-06) — bound-checked before being
   *  interpolated as a Cypher variable-length-path upper bound literal (Cypher
   *  cannot parameterize that bound). */
  maxHops: number;
  /** Hard cap, honoured server-side. */
  maxNodes: number;
  relationAllowList?: string[];
  /** MUST be applied DURING traversal, not after (FR-KB-08 — a chunk the caller may
   *  not see must never influence the ranking of chunks it may see). */
  aclTags: string[];
  minWeight?: number;
}

export interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
  totalWeight: number;
}

export interface NeighbourhoodResult {
  nodeIds: string[];
  edgeIds: string[];
  paths: GraphPath[];
  truncated: boolean;
}

/**
 * The product-neutral graph-store contract (ADR-0018 §2.6, LLD §14.4.6). The Neo4j
 * adapter (`neo4j-graph-store.ts`) is the only implementation this phase ships; every
 * method internally opens its Neo4j session via `withTenantGraph()` — there is no
 * method here, and no code path in the adapter, that opens a raw driver session
 * itself.
 */
export interface GraphStorePort {
  upsertNodes(scope: GraphScope, nodes: GraphNodeRecord[]): Promise<void>;
  upsertEdges(scope: GraphScope, edges: GraphEdgeRecord[]): Promise<void>;
  deleteNodes(scope: GraphScope, nodeIds: string[]): Promise<void>;
  /** Retention / DSR / generation supersession. Deletes exactly this generation's
   *  subgraph inside the tenant's database. Idempotent and resumable — NOT a single
   *  transaction (a batched `CALL {...} IN TRANSACTIONS` — see the adapter's doc
   *  comment for why a single transaction over a multi-million-node generation is
   *  unsafe, and why this can never be atomic in the traditional sense). A
   *  partially-dropped generation is never *read*: the generation is already marked
   *  superseded in Postgres, which is the authoritative gate (ADR-0018 §5). */
  dropGeneration(scope: GraphScope): Promise<void>;
  neighbourhood(scope: GraphScope, req: NeighbourhoodRequest): Promise<NeighbourhoodResult>;
  degrees(scope: GraphScope, nodeIds?: string[]): Promise<Record<string, number>>;
  /** Read-only projection for the pipeline's community-detection stage (ADR-0018
   *  §2.5: detection runs in the ingestion worker, NOT in the database via GDS).
   *  Returns the edge list only. */
  projectEdges(
    scope: GraphScope,
    req: { relationAllowList?: string[]; minWeight?: number },
  ): Promise<Array<{ srcId: string; dstId: string; weight: number }>>;
  /** Writes the worker's detection result back as a node property + index. */
  assignCommunities(
    scope: GraphScope,
    assignments: Array<{ nodeId: string; level: number; externalKey: string }>,
  ): Promise<void>;
  health(): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;
}
