import { int, isInt } from "neo4j-driver";
import type {
  GraphEdgeRecord,
  GraphNodeRecord,
  GraphScope,
  GraphStorePort,
  NeighbourhoodRequest,
  NeighbourhoodResult,
} from "./port.js";
import { withTenantGraph, withTenantGraphAutoCommit } from "./tenant-session.js";
import { assertValidGenerationLabel, assertValidRelationType } from "./naming.js";
import { GraphStoreInvalidRequestError } from "./errors.js";
import { checkGraphStoreHealth } from "./health.js";

/** LLD §14.4.6 acceptance item 3: `maxHops` is interpolated as a validated integer
 *  literal (Cypher cannot parameterize the bound of `*1..n`), bound-checked against
 *  this ceiling BEFORE interpolation, never taken from user input directly. */
const MAX_HOPS_CEILING = 6;

/** A generous but real ceiling on `maxNodes` — the port enforces this hard cap
 *  itself rather than trusting a query author (FR-KB-06), independent of whatever
 *  a caller passes. */
const MAX_NODES_CEILING = 10_000;

/** Client-side batch size for bulk upsert (LLD §14.4.6 acceptance item 7): each
 *  batch runs inside its own `session.executeWrite()` call so the driver's own
 *  retry handles a leader switch per batch, not just once for the whole call. */
const UPSERT_BATCH_SIZE = 1000;

/** `dropGeneration`'s server-side batch size for `CALL {...} IN TRANSACTIONS OF n
 *  ROWS` — Neo4j's own idiom for a large delete that must not exhaust the heap in
 *  one transaction (ADR-0018 §5 / LLD §14.4.6). */
const DROP_GENERATION_BATCH_ROWS = 10_000;

function validateHops(maxHops: number): number {
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > MAX_HOPS_CEILING) {
    throw new GraphStoreInvalidRequestError(`maxHops must be an integer in [1, ${MAX_HOPS_CEILING}], got ${maxHops}`);
  }
  return maxHops;
}

function validateMaxNodes(maxNodes: number): number {
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES_CEILING) {
    throw new GraphStoreInvalidRequestError(
      `maxNodes must be an integer in [1, ${MAX_NODES_CEILING}], got ${maxNodes}`,
    );
  }
  return maxNodes;
}

/** Neo4j returns 64-bit `Integer` objects for any integer value, not native JS
 *  numbers (LLD §14.4.6's driver-specifics list). Every count/degree crossing this
 *  adapter's boundary goes through this — with a safe-range check, since a real
 *  64-bit value could in principle exceed `Number.MAX_SAFE_INTEGER` (never expected
 *  for this port's actual values — node counts/degrees — but a silent precision
 *  loss must fail loudly rather than return a wrong number in a TypeBox-validated
 *  contract). */
function toSafeNumber(value: unknown, fieldName: string): number {
  if (isInt(value)) {
    if (!value.inSafeRange()) {
      throw new GraphStoreInvalidRequestError(`${fieldName} exceeds Number.MAX_SAFE_INTEGER: ${value.toString()}`);
    }
    return value.toNumber();
  }
  if (typeof value === "number") return value;
  throw new GraphStoreInvalidRequestError(`${fieldName} was not a Neo4j Integer or JS number: ${JSON.stringify(value)}`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * The Neo4j 5 Enterprise adapter behind `GraphStorePort` (ADR-0018, LLD §14.4.6).
 * Every method opens its session via `withTenantGraph()`/`withTenantGraphAutoCommit()`
 * — this class never calls `driver.session()` itself.
 */
export class Neo4jGraphStore implements GraphStorePort {
  async upsertNodes(scope: GraphScope, nodes: GraphNodeRecord[]): Promise<void> {
    assertValidGenerationLabel(scope.generationId);
    if (nodes.length === 0) return;
    const label = scope.generationId; // already validated above
    for (const batch of chunk(nodes, UPSERT_BATCH_SIZE)) {
      await withTenantGraph(scope.tenantId, async (tx) => {
        await tx.run(
          `UNWIND $rows AS r
           MERGE (n:Entity:\`${label}\` {id: r.id})
           SET n.type = r.type, n.aclTags = r.aclTags, n.generationId = $generationId`,
          { rows: batch, generationId: scope.generationId },
        );
      });
    }
  }

  async upsertEdges(scope: GraphScope, edges: GraphEdgeRecord[]): Promise<void> {
    assertValidGenerationLabel(scope.generationId);
    if (edges.length === 0) return;
    const label = scope.generationId;
    // Every distinct relation type in this batch must itself be validated before
    // interpolation (naming.ts's `assertValidRelationType` doc comment) — grouping
    // by relation lets each batch still write in bulk per Cypher's own "type name
    // cannot be parameterized" constraint.
    const byRelation = new Map<string, GraphEdgeRecord[]>();
    for (const edge of edges) {
      assertValidRelationType(edge.relation);
      const group = byRelation.get(edge.relation) ?? [];
      group.push(edge);
      byRelation.set(edge.relation, group);
    }
    for (const [relation, groupEdges] of byRelation) {
      for (const batch of chunk(groupEdges, UPSERT_BATCH_SIZE)) {
        await withTenantGraph(scope.tenantId, async (tx) => {
          await tx.run(
            `UNWIND $rows AS r
             MATCH (a:Entity:\`${label}\` {id: r.srcId})
             MATCH (b:Entity:\`${label}\` {id: r.dstId})
             MERGE (a)-[e:\`${relation}\` {id: r.id}]->(b)
             SET e.weight = r.weight, e.aclTags = r.aclTags, e.generationId = $generationId`,
            { rows: batch, generationId: scope.generationId },
          );
        });
      }
    }
  }

  async deleteNodes(scope: GraphScope, nodeIds: string[]): Promise<void> {
    assertValidGenerationLabel(scope.generationId);
    if (nodeIds.length === 0) return;
    const label = scope.generationId;
    for (const batch of chunk(nodeIds, UPSERT_BATCH_SIZE)) {
      await withTenantGraph(scope.tenantId, async (tx) => {
        await tx.run(`UNWIND $ids AS id MATCH (n:Entity:\`${label}\` {id: id}) DETACH DELETE n`, { ids: batch });
      });
    }
  }

  async dropGeneration(scope: GraphScope): Promise<void> {
    assertValidGenerationLabel(scope.generationId);
    const label = scope.generationId;
    // ADR-0018 §5 / LLD §14.4.6: NOT one transaction — a single transaction over a
    // multi-million-node generation exhausts the heap. `CALL (n) {...} IN
    // TRANSACTIONS OF n ROWS` is Neo4j's own idiom for a large delete, and (verified
    // empirically against a real Neo4j 5 Enterprise instance) can ONLY run in an
    // implicit/auto-commit transaction — hence `withTenantGraphAutoCommit`, not
    // `withTenantGraph`. This is idempotent and resumable by construction: re-running
    // the identical query after an interruption simply deletes whatever of the
    // label's nodes are still there; it never double-deletes or corrupts state, and
    // the generation is never *read* while a drop may be in flight (Postgres's
    // `knowledge_index_generation` row is already marked superseded, which is the
    // authoritative gate).
    await withTenantGraphAutoCommit(scope.tenantId, async (ctx) => {
      await ctx.run(
        `MATCH (n:\`${label}\`) CALL (n) { WITH n DETACH DELETE n } IN TRANSACTIONS OF ${DROP_GENERATION_BATCH_ROWS} ROWS`,
      );
    });
  }

  async neighbourhood(scope: GraphScope, req: NeighbourhoodRequest): Promise<NeighbourhoodResult> {
    assertValidGenerationLabel(scope.generationId);
    const label = scope.generationId;
    const maxHops = validateHops(req.maxHops);
    const maxNodes = validateMaxNodes(req.maxNodes);
    if (req.relationAllowList) {
      for (const relation of req.relationAllowList) assertValidRelationType(relation);
    }
    // Relationship-type allow-list segment: `[:TYPE_A|TYPE_B]` — every element was
    // just validated above, so this interpolation is safe. Omitted entirely (an
    // untyped `-[*1..n]-`) when no allow-list is given.
    const relSegment = req.relationAllowList?.length ? `:${req.relationAllowList.join("|")}` : "";

    return withTenantGraph(
      scope.tenantId,
      async (tx) => {
        // Acceptance item 3 (LLD §14.4.6): plain Cypher, ACL applied DURING
        // expansion (every node on the path must carry an allowed aclTag or none at
        // all — an untagged node is public within its generation), `maxHops`
        // interpolated only after validation above, `LIMIT $maxNodes` enforced
        // server-side.
        const result = await tx.run(
          `MATCH (anchor:Entity:\`${label}\`) WHERE anchor.id IN $anchorNodeIds
           MATCH path = (anchor)-[r${relSegment}*1..${maxHops}]-(m:\`${label}\`)
           WHERE ALL(n IN nodes(path) WHERE size(n.aclTags) = 0 OR ANY(tag IN n.aclTags WHERE tag IN $aclTags))
             AND ALL(rel IN relationships(path) WHERE $minWeight IS NULL OR rel.weight >= $minWeight)
           WITH path, nodes(path) AS ns, relationships(path) AS rels
           LIMIT $maxNodesPlusOne
           RETURN [n IN ns | n.id] AS nodeIds, [rel IN rels | rel.id] AS edgeIds,
                  reduce(w = 0.0, rel IN rels | w + rel.weight) AS totalWeight`,
          {
            anchorNodeIds: req.anchorNodeIds,
            aclTags: req.aclTags,
            minWeight: req.minWeight ?? null,
            // Requested one more than maxNodes' worth of PATHS so `truncated` can be
            // detected without a second COUNT query — see below.
            maxNodesPlusOne: int(maxNodes + 1),
          },
        );

        const nodeIds = new Set<string>();
        const edgeIds = new Set<string>();
        const paths: NeighbourhoodResult["paths"] = [];
        let truncated = false;
        for (const record of result.records) {
          if (nodeIds.size >= maxNodes) {
            truncated = true;
            break;
          }
          const pathNodeIds = record.get("nodeIds") as string[];
          const pathEdgeIds = record.get("edgeIds") as string[];
          const totalWeight = record.get("totalWeight") as number;
          for (const id of pathNodeIds) nodeIds.add(id);
          for (const id of pathEdgeIds) edgeIds.add(id);
          paths.push({ nodeIds: pathNodeIds, edgeIds: pathEdgeIds, totalWeight });
        }
        return { nodeIds: [...nodeIds].slice(0, maxNodes), edgeIds: [...edgeIds], paths, truncated };
      },
      "READ",
    );
  }

  async degrees(scope: GraphScope, nodeIds?: string[]): Promise<Record<string, number>> {
    assertValidGenerationLabel(scope.generationId);
    const label = scope.generationId;
    return withTenantGraph(
      scope.tenantId,
      async (tx) => {
        // `size((n)--())` (the historically-idiomatic degree-count pattern) is
        // REJECTED by newer Neo4j 5.x versions ("A pattern expression should only
        // be used in order to test the existence of a pattern... replace size()
        // with COUNT {}" — verified against a real instance during this phase's
        // implementation) — `COUNT { (n)--() }` is the replacement syntax.
        const result = await tx.run(
          `MATCH (n:\`${label}\`) WHERE $nodeIds IS NULL OR n.id IN $nodeIds
           RETURN n.id AS id, COUNT { (n)--() } AS degree`,
          { nodeIds: nodeIds ?? null },
        );
        const out: Record<string, number> = {};
        for (const record of result.records) {
          out[record.get("id") as string] = toSafeNumber(record.get("degree"), "degree");
        }
        return out;
      },
      "READ",
    );
  }

  async projectEdges(
    scope: GraphScope,
    req: { relationAllowList?: string[]; minWeight?: number },
  ): Promise<Array<{ srcId: string; dstId: string; weight: number }>> {
    assertValidGenerationLabel(scope.generationId);
    const label = scope.generationId;
    if (req.relationAllowList) {
      for (const relation of req.relationAllowList) assertValidRelationType(relation);
    }
    return withTenantGraph(
      scope.tenantId,
      async (tx) => {
        const result = await tx.run(
          `MATCH (a:\`${label}\`)-[r]->(b:\`${label}\`)
           WHERE ($relationAllowList IS NULL OR type(r) IN $relationAllowList)
             AND ($minWeight IS NULL OR r.weight >= $minWeight)
           RETURN a.id AS srcId, b.id AS dstId, r.weight AS weight`,
          { relationAllowList: req.relationAllowList ?? null, minWeight: req.minWeight ?? null },
        );
        return result.records.map((record) => ({
          srcId: record.get("srcId") as string,
          dstId: record.get("dstId") as string,
          weight: record.get("weight") as number,
        }));
      },
      "READ",
    );
  }

  async assignCommunities(
    scope: GraphScope,
    assignments: Array<{ nodeId: string; level: number; externalKey: string }>,
  ): Promise<void> {
    assertValidGenerationLabel(scope.generationId);
    const label = scope.generationId;
    if (assignments.length === 0) return;
    for (const batch of chunk(assignments, UPSERT_BATCH_SIZE)) {
      await withTenantGraph(scope.tenantId, async (tx) => {
        // Dynamic property-key access (`n[key] = val`, verified against a real
        // Neo4j 5 Enterprise instance during this phase's implementation) stores
        // each hierarchy level as its own property (`communityLevel0`,
        // `communityLevel1`, ...) without needing the levels pre-declared — a node
        // can belong to several levels' communities simultaneously (FR-KB-02's
        // hierarchical communities).
        await tx.run(
          `UNWIND $rows AS r
           MATCH (n:\`${label}\` {id: r.nodeId})
           SET n[('communityLevel' + toString(r.level))] = r.externalKey`,
          { rows: batch.map((a) => ({ nodeId: a.nodeId, level: int(a.level), externalKey: a.externalKey })) },
        );
      });
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    return checkGraphStoreHealth();
  }
}
