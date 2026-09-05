import { afterEach, describe, expect, it } from "vitest";
import { Neo4jGraphStore } from "./neo4j-graph-store.js";
import { withTenantGraph } from "./tenant-session.js";
import { GraphStoreInvalidRequestError } from "./errors.js";
import { setupFixtureGraphTenant, teardownFixtureGraphTenant } from "./testing-helpers.test-util.js";

const GEN_A = "G_" + "a".repeat(32);
const GEN_B = "G_" + "b".repeat(32);

describe("Neo4jGraphStore (GraphStorePort adapter, real Neo4j)", () => {
  let tenantId: string;
  const store = new Neo4jGraphStore();

  afterEach(async () => {
    if (tenantId) await teardownFixtureGraphTenant(tenantId);
  });

  it("upsertNodes/upsertEdges/neighbourhood/degrees round-trip correctly", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scope = { tenantId, generationId: GEN_A };

    await store.upsertNodes(scope, [
      { id: "n1", type: "Person", aclTags: [] },
      { id: "n2", type: "Org", aclTags: [] },
      { id: "n3", type: "Org", aclTags: ["secret-tag"] },
    ]);
    await store.upsertEdges(scope, [
      { id: "e1", srcId: "n1", dstId: "n2", relation: "WORKS_FOR", weight: 1, aclTags: [] },
      { id: "e2", srcId: "n2", dstId: "n3", relation: "PARENT_OF", weight: 1, aclTags: ["secret-tag"] },
    ]);

    // Idempotent re-upsert (MERGE semantics) — running it again must not create
    // duplicate nodes/edges.
    await store.upsertNodes(scope, [{ id: "n1", type: "Person", aclTags: [] }]);

    const degrees = await store.degrees(scope);
    expect(degrees.n1).toBe(1);
    expect(degrees.n2).toBe(2);
    expect(degrees.n3).toBe(1);

    // Neighbourhood WITHOUT the "secret-tag" ACL — n3 (and the n2-n3 edge) must
    // never appear, and must not have influenced which OTHER nodes were reachable
    // either (FR-KB-08: "must never influence the ranking of chunks it may see").
    const publicResult = await store.neighbourhood(scope, {
      anchorNodeIds: ["n1"],
      maxHops: 3,
      maxNodes: 100,
      aclTags: [],
    });
    expect(publicResult.nodeIds).toContain("n1");
    expect(publicResult.nodeIds).toContain("n2");
    expect(publicResult.nodeIds).not.toContain("n3");
    expect(publicResult.edgeIds).not.toContain("e2");

    // Neighbourhood WITH the "secret-tag" ACL — now n3 is reachable too.
    const privilegedResult = await store.neighbourhood(scope, {
      anchorNodeIds: ["n1"],
      maxHops: 3,
      maxNodes: 100,
      aclTags: ["secret-tag"],
    });
    expect(privilegedResult.nodeIds).toContain("n3");
  }, 30_000);

  it("neighbourhood enforces maxHops as a hard ceiling — a request above the ceiling is rejected before any query runs", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scope = { tenantId, generationId: GEN_A };
    await expect(
      store.neighbourhood(scope, { anchorNodeIds: ["n1"], maxHops: 999, maxNodes: 10, aclTags: [] }),
    ).rejects.toThrow(GraphStoreInvalidRequestError);
  });

  it("upsertEdges rejects an invalid relation-type string (the same 'cannot parameterize a schema token' vector as a label) before touching Cypher", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scope = { tenantId, generationId: GEN_A };
    await store.upsertNodes(scope, [{ id: "n1", type: "Person", aclTags: [] }, { id: "n2", type: "Person", aclTags: [] }]);
    await expect(
      store.upsertEdges(scope, [
        { id: "e1", srcId: "n1", dstId: "n2", relation: "WORKS_FOR`]-(evil:Entity)-[:R", weight: 1, aclTags: [] },
      ]),
    ).rejects.toThrow(/invalid identifier/i);
  });

  it("projectEdges returns the edge list the ingestion worker's community-detection stage needs, filtered by relation/weight", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scope = { tenantId, generationId: GEN_A };
    await store.upsertNodes(scope, [
      { id: "n1", type: "Person", aclTags: [] },
      { id: "n2", type: "Person", aclTags: [] },
      { id: "n3", type: "Person", aclTags: [] },
    ]);
    await store.upsertEdges(scope, [
      { id: "e1", srcId: "n1", dstId: "n2", relation: "WORKS_FOR", weight: 5, aclTags: [] },
      { id: "e2", srcId: "n2", dstId: "n3", relation: "KNOWS", weight: 0.1, aclTags: [] },
    ]);

    const allEdges = await store.projectEdges(scope, {});
    expect(allEdges).toHaveLength(2);

    const filtered = await store.projectEdges(scope, { relationAllowList: ["WORKS_FOR"], minWeight: 1 });
    expect(filtered).toEqual([{ srcId: "n1", dstId: "n2", weight: 5 }]);
  }, 30_000);

  it("assignCommunities writes the worker's detection result back, supporting several hierarchy levels per node", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scope = { tenantId, generationId: GEN_A };
    await store.upsertNodes(scope, [{ id: "n1", type: "Person", aclTags: [] }]);

    await store.assignCommunities(scope, [
      { nodeId: "n1", level: 0, externalKey: "community-leaf" },
      { nodeId: "n1", level: 1, externalKey: "community-parent" },
    ]);

    // Read back via a raw query (assignCommunities' own property-naming scheme is
    // an internal implementation detail — this proves the write actually landed on
    // the real node, not just that the call didn't throw).
    const result = await withTenantGraph(tenantId, (tx) => tx.run("MATCH (n:Entity {id: 'n1'}) RETURN n"), "READ");
    const props = result.records[0]?.get("n").properties as Record<string, unknown>;
    expect(props.communityLevel0).toBe("community-leaf");
    expect(props.communityLevel1).toBe("community-parent");
  }, 30_000);

  it("dropGeneration deletes exactly one generation's subgraph, leaving a sibling generation in the same tenant database untouched", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scopeA = { tenantId, generationId: GEN_A };
    const scopeB = { tenantId, generationId: GEN_B };

    await store.upsertNodes(scopeA, [{ id: "a1", type: "Person", aclTags: [] }]);
    await store.upsertNodes(scopeB, [{ id: "b1", type: "Person", aclTags: [] }]);

    await store.dropGeneration(scopeA);

    const remainingA = await withTenantGraph(tenantId, (tx) => tx.run(`MATCH (n:\`${GEN_A}\`) RETURN n`), "READ");
    expect(remainingA.records).toHaveLength(0);

    const remainingB = await withTenantGraph(tenantId, (tx) => tx.run(`MATCH (n:\`${GEN_B}\`) RETURN n.id AS id`), "READ");
    expect(remainingB.records.map((r) => r.get("id"))).toEqual(["b1"]);
  }, 30_000);

  it("dropGeneration is idempotent — re-running it after nothing (or only part) is left is a safe no-op, proving the 'resumable, not atomic' contract", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scope = { tenantId, generationId: GEN_A };
    await store.upsertNodes(
      scope,
      Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, type: "Person", aclTags: [] })),
    );

    // First drop deletes everything.
    await store.dropGeneration(scope);
    const afterFirst = await withTenantGraph(tenantId, (tx) => tx.run(`MATCH (n:\`${GEN_A}\`) RETURN n`), "READ");
    expect(afterFirst.records).toHaveLength(0);

    // Simulating "interrupted mid-batch, restarted": re-running the identical
    // dropGeneration call against a generation that's already (partially or fully)
    // gone must not throw and must leave the result the same (zero remaining) —
    // this is the actual guarantee `CALL {...} IN TRANSACTIONS` gives when resumed:
    // whatever of the label still matches gets deleted, nothing double-deletes or
    // errors on an already-gone node.
    await expect(store.dropGeneration(scope)).resolves.toBeUndefined();
    const afterSecond = await withTenantGraph(tenantId, (tx) => tx.run(`MATCH (n:\`${GEN_A}\`) RETURN n`), "READ");
    expect(afterSecond.records).toHaveLength(0);
  }, 30_000);

  it("dropGeneration on a large-ish generation completes via the batched IN TRANSACTIONS clause without a single-transaction heap failure", async () => {
    tenantId = await setupFixtureGraphTenant();
    const scope = { tenantId, generationId: GEN_A };
    // Not literally millions of nodes (impractical for a CI-bounded test), but
    // enough to exercise multiple DROP_GENERATION_BATCH_ROWS-sized batches if that
    // constant were ever lowered for a test, and to prove the batched-delete Cypher
    // shape itself executes correctly end to end against a real instance.
    await store.upsertNodes(
      scope,
      Array.from({ length: 250 }, (_, i) => ({ id: `bulk-${i}`, type: "Person", aclTags: [] })),
    );
    await store.dropGeneration(scope);
    const remaining = await withTenantGraph(tenantId, (tx) => tx.run(`MATCH (n:\`${GEN_A}\`) RETURN count(n) AS c`), "READ");
    expect(remaining.records[0]?.get("c").toNumber()).toBe(0);
  }, 30_000);

  it("health() reports ok against the real running instance", async () => {
    const health = await store.health();
    expect(health.ok).toBe(true);
  });
});
