import { describe, expect, it } from "vitest";
import { loadGraphStoreEnv } from "../config.js";
import { tenantDatabaseName } from "../naming.js";
import { withTenantGraph } from "../tenant-session.js";
import { checkGraphStoreHealth } from "../health.js";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "./tenant-database-provisioner.js";
import { freshTenantId } from "../testing-helpers.test-util.js";

describe("ensureTenantGraphDatabase / dropTenantGraphDatabase (ADR-0018 §2.2, real Neo4j)", () => {
  it("provisions a database/role/user, is idempotent, and the tenant can immediately read+write via withTenantGraph()", async () => {
    const tenantId = freshTenantId();
    const env = loadGraphStoreEnv();
    try {
      const first = await ensureTenantGraphDatabase(tenantId);
      expect(first.created).toBe(true);
      expect(first.databaseName).toBe(tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantId));

      // Re-running is a genuine no-op — not an error, and reports created:false.
      const second = await ensureTenantGraphDatabase(tenantId);
      expect(second.created).toBe(false);
      expect(second.databaseName).toBe(first.databaseName);

      // The freshly-provisioned tenant can write and read back through the real
      // primitive immediately — no separate manual grant step needed.
      await withTenantGraph(tenantId, (tx) =>
        tx.run("CREATE (:Entity:G_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb {id: 'e1', type: 'Person', aclTags: []})"),
      );
      const result = await withTenantGraph(tenantId, (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"), "READ");
      expect(result.records.map((r) => r.get("id"))).toEqual(["e1"]);
    } finally {
      await dropTenantGraphDatabase(tenantId);
    }
  }, 30_000);

  it("drop removes the database entirely — a subsequent withTenantGraph() call against it fails (there is nothing left to read)", async () => {
    const tenantId = freshTenantId();
    await ensureTenantGraphDatabase(tenantId);
    await dropTenantGraphDatabase(tenantId);

    await expect(withTenantGraph(tenantId, (tx) => tx.run("MATCH (n) RETURN n"), "READ")).rejects.toBeDefined();
  }, 30_000);

  it("dropping a tenant that was never provisioned is a safe no-op (IF EXISTS semantics)", async () => {
    const neverProvisioned = freshTenantId();
    await expect(dropTenantGraphDatabase(neverProvisioned)).resolves.toBeUndefined();
  });

  it("checkGraphStoreHealth() reports ok against the real running instance", async () => {
    const health = await checkGraphStoreHealth();
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("Phase 7b fast-follow: 5 concurrent ensureTenantGraphDatabase() calls for the SAME brand-new tenant all succeed cleanly (QA's 7a exact repro, now fixed)", async () => {
    // QA's 7a pass fired 5 concurrent calls for one fresh tenant and reliably (4/4
    // independent runs) got 1-2 rejected promises with
    // Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists from
    // ensureIndexesAndConstraints()'s own CREATE INDEX/CONSTRAINT race — a real gap
    // in ALREADY_SATISFIED_CODES this fast-follow closes. This reproduces the exact
    // scenario against the real Neo4j instance and asserts every promise resolves.
    const tenantId = freshTenantId();
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => ensureTenantGraphDatabase(tenantId)),
      );
      const rejected = results.filter((r) => r.status === "rejected");
      if (rejected.length > 0) {
        const reasons = rejected.map((r) => (r as PromiseRejectedResult).reason);
        console.error("Concurrent ensureTenantGraphDatabase rejections:", reasons);
      }
      expect(rejected).toHaveLength(0);

      // Exactly one of the 5 concurrent calls should report having actually created
      // the database (the winning racer); the rest see it already exists.
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof ensureTenantGraphDatabase>>> => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(5);
      expect(fulfilled.filter((r) => r.value.created).length).toBe(1);

      // And the database is genuinely usable afterward — the race didn't leave it
      // half-provisioned.
      await withTenantGraph(tenantId, (tx) =>
        tx.run("CREATE (:Entity:G_cccccccccccccccccccccccccccccccc {id: 'e1', type: 'Person', aclTags: []})"),
      );
      const result = await withTenantGraph(tenantId, (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"), "READ");
      expect(result.records.map((r) => r.get("id"))).toEqual(["e1"]);
    } finally {
      await dropTenantGraphDatabase(tenantId);
    }
  }, 60_000);
});
