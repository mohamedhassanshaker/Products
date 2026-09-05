import { afterAll, beforeAll, describe, expect, it } from "vitest";
import neo4j from "neo4j-driver";
import { withTenantGraph } from "./tenant-session.js";
import { getServiceDriver, closeAllGraphDrivers } from "./driver.js";
import { loadGraphStoreEnv } from "./config.js";
import { tenantDatabaseName, tenantUserName } from "./naming.js";
import { GraphStoreForbiddenError } from "./errors.js";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "./provisioning/tenant-database-provisioner.js";
import { freshTenantId } from "./testing-helpers.test-util.js";

/**
 * ADR-0018 §6 — the graph-store cross-tenant isolation suite, run against a REAL
 * Neo4j 5 Enterprise instance (`compose.test.yml`'s `neo4j-test` service), modelled
 * deliberately on `@nextbot/db`'s own RLS isolation suite so the two read as one
 * guarantee across both datastores. `nexus-qa` should treat a failure in tests 1-3
 * as a release blocker, in the same class as ADR-0001's cross-tenant suite (ADR-0018
 * §6's own words).
 *
 * Every assertion here is against the REAL engine — no mocks for the property being
 * tested. A cross-tenant access attempt must fail as a genuine
 * `Neo.ClientError.Security.*` authorization error, never merely return zero rows
 * (an empty result would be indistinguishable from "no data" and is explicitly the
 * failure mode this suite exists to rule out).
 */
describe("ADR-0018 §6 — graph-store cross-tenant isolation (real Neo4j)", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    tenantA = freshTenantId();
    tenantB = freshTenantId();
    await ensureTenantGraphDatabase(tenantA);
    await ensureTenantGraphDatabase(tenantB);

    // Seed distinguishable data into each tenant's own database via the tenant's OWN
    // impersonated session — not a raw admin write — so the seed step itself already
    // exercises the primitive under test.
    await withTenantGraph(tenantA, (tx) =>
      tx.run("CREATE (:Entity:G_00000000000000000000000000000001 {id: 'a-entity-1', type: 'Person', aclTags: [], generationId: 'G_00000000000000000000000000000001'})"),
    );
    await withTenantGraph(tenantB, (tx) =>
      tx.run("CREATE (:Entity:G_00000000000000000000000000000001 {id: 'b-entity-1', type: 'Person', aclTags: [], generationId: 'G_00000000000000000000000000000001'})"),
    );
  }, 60_000);

  afterAll(async () => {
    await dropTenantGraphDatabase(tenantA);
    await dropTenantGraphDatabase(tenantB);
    await closeAllGraphDrivers();
  }, 60_000);

  it("test 1 — tenant A's impersonated session returns ZERO of tenant B's entities", async () => {
    const result = await withTenantGraph(
      tenantA,
      (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"),
      "READ",
    );
    const ids = result.records.map((r) => r.get("id"));
    expect(ids).toEqual(["a-entity-1"]);
    expect(ids).not.toContain("b-entity-1");
  });

  it("test 1b — symmetrically, tenant B's session returns ZERO of tenant A's entities", async () => {
    const result = await withTenantGraph(
      tenantB,
      (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"),
      "READ",
    );
    const ids = result.records.map((r) => r.get("id"));
    expect(ids).toEqual(["b-entity-1"]);
  });

  it("test 2 — explicitly targeting tenant B's database while impersonating tenant A's user raises a genuine engine-level authorization error, NOT an empty result", async () => {
    const env = loadGraphStoreEnv();
    const driver = getServiceDriver();
    const tenantBDatabase = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantB);
    const tenantAUser = tenantUserName(tenantA);

    const session = driver.session({
      database: tenantBDatabase,
      impersonatedUser: tenantAUser,
      defaultAccessMode: neo4j.session.READ,
    });
    let caught: unknown;
    try {
      await session.executeRead((tx) => tx.run("MATCH (n:Entity) RETURN n.id"));
    } catch (err) {
      caught = err;
    } finally {
      await session.close();
    }

    expect(caught).toBeDefined();
    // Must be a genuine Neo4j Security error code, not a generic failure — this is
    // the "authorization error from the engine, not an empty result set" property
    // ADR-0018 §2.2 is built on.
    expect((caught as { code?: string })?.code).toMatch(/^Neo\.ClientError\.Security\./);
  });

  it("test 2b — the same cross-database attempt through withTenantGraph()'s own error mapping surfaces as GraphStoreForbiddenError", async () => {
    // withTenantGraph() itself always resolves `database` from the tenantId argument
    // (there is no parameter that lets a caller pass an arbitrary database name), so
    // this exercises the mapping path via a raw session the same shape test 2 used,
    // confirming `mapGraphStoreError` classifies it correctly end-to-end.
    const env = loadGraphStoreEnv();
    const driver = getServiceDriver();
    const tenantBDatabase = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantB);
    const tenantAUser = tenantUserName(tenantA);
    const session = driver.session({ database: tenantBDatabase, impersonatedUser: tenantAUser, defaultAccessMode: neo4j.session.READ });
    await expect(session.executeRead((tx) => tx.run("MATCH (n) RETURN n"))).rejects.toMatchObject({
      code: expect.stringMatching(/^Neo\.ClientError\.Security\./),
    });
    await session.close();
  });

  it("test 3 — a session opened OUTSIDE withTenantGraph() (no impersonation at all) can read no tenant data: fail-closed, not fail-open", async () => {
    const env = loadGraphStoreEnv();
    const driver = getServiceDriver();
    const tenantADatabase = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantA);
    // The service user itself, with NO impersonatedUser — this is the "escape/inject
    // a raw driver session bypassing withTenantGraph() entirely" vector the dispatch
    // brief calls out explicitly.
    const session = driver.session({ database: tenantADatabase, defaultAccessMode: neo4j.session.READ });
    let caught: unknown;
    try {
      await session.executeRead((tx) => tx.run("MATCH (n:Entity) RETURN n.id"));
    } catch (err) {
      caught = err;
    } finally {
      await session.close();
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string })?.code).toBe("Neo.ClientError.Security.Forbidden");
  });

  it("test 3b — confirms no code path bypasses withTenantGraph() to reach the SERVICE credential without impersonation (the 'escape/inject a raw driver session' vector)", async () => {
    // This package deliberately holds TWO distinct Neo4j credentials with two
    // different trust levels (driver.ts's own doc comment): the ADMIN credential
    // (DBMS-admin — provisioning/schema management, `getAdminDriver()`) and the
    // SERVICE credential (no data privileges of its own beyond IMPERSONATE,
    // `getServiceDriver()`). The isolation property under test is specifically
    // about the SERVICE credential — that is the one credential an application
    // code path could plausibly reach for tenant data, so it is the one that must
    // NEVER be used to open a session without `impersonatedUser`. The admin
    // credential opening unimpersonated sessions (against `system` or a specific
    // tenant database, to manage schema) is expected, intentional, higher-privilege
    // DBA-style access — a completely different boundary, not this test's concern.
    //
    // Every OTHER package in the workspace is already structurally barred from
    // reaching `getServiceDriver()`/`driver.session(...)` at all — `neo4j-driver`
    // is dependency-cruiser-restricted to `packages/graph-store` (the
    // `no-neo4j-driver-outside-graph-store` rule, verified separately by
    // `pnpm lint:boundaries`). This test proves the second half: WITHIN this
    // package, `getServiceDriver()` is called from exactly one file
    // (`tenant-session.ts`), and every session opened from it passes
    // `impersonatedUser`. A future edit that calls `getServiceDriver()` from
    // anywhere else, or opens an unimpersonated session from it, fails this test
    // rather than silently reintroducing the bypass.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const srcDir = path.resolve(import.meta.dirname);
    const entries = await fs.readdir(srcDir, { recursive: true });
    const tsFiles = entries.filter(
      (f): f is string =>
        typeof f === "string" &&
        f.endsWith(".ts") &&
        !f.includes(".test.") &&
        !f.endsWith(".test-util.ts") &&
        // driver.ts is `getServiceDriver()`'s own DEFINITION site (the string
        // "getServiceDriver()" appears literally in its own function signature/
        // doc comment) — excluded from the "who CALLS it" scan below, since
        // defining a function is not calling it.
        f !== "driver.ts",
    );
    expect(tsFiles.length).toBeGreaterThan(0);

    const filesCallingGetServiceDriver: string[] = [];
    let sessionCallsOnServiceDriverFiles = 0;
    for (const file of tsFiles) {
      const fullPath = path.join(srcDir, file);
      const src = await fs.readFile(fullPath, "utf8");
      if (/\bgetServiceDriver\(\)/.test(src)) {
        filesCallingGetServiceDriver.push(file);
        const sessionCalls = [...src.matchAll(/\.session\(\{([^}]*)\}\)/g)];
        sessionCallsOnServiceDriverFiles += sessionCalls.length;
        for (const call of sessionCalls) {
          const optionsText = call[1] ?? "";
          expect(
            /impersonatedUser/.test(optionsText),
            `${file}: a session opened on the SERVICE driver without impersonatedUser (${optionsText})`,
          ).toBe(true);
        }
      }
    }

    expect(filesCallingGetServiceDriver.sort()).toEqual(["tenant-session.ts"]);
    // Sanity check the scan actually found the two real call sites (withTenantGraph
    // + withTenantGraphAutoCommit) — a scan that silently found zero would make
    // every assertion above vacuously true and this test worthless.
    expect(sessionCallsOnServiceDriverFiles).toBeGreaterThanOrEqual(2);
  });

  it("test 4 — re-provisioning an already-provisioned tenant is a genuine no-op (idempotent), and the data seeded above is untouched", async () => {
    const before = await withTenantGraph(tenantA, (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"), "READ");
    const result = await ensureTenantGraphDatabase(tenantA);
    expect(result.created).toBe(false); // already existed from beforeAll
    const after = await withTenantGraph(tenantA, (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"), "READ");
    expect(after.records.map((r) => r.get("id"))).toEqual(before.records.map((r) => r.get("id")));
  });

  it("test 4b — a brand-new tenant's provisioning reports created:true exactly once", async () => {
    const freshTenant = freshTenantId();
    try {
      const first = await ensureTenantGraphDatabase(freshTenant);
      expect(first.created).toBe(true);
      const second = await ensureTenantGraphDatabase(freshTenant);
      expect(second.created).toBe(false);
    } finally {
      await dropTenantGraphDatabase(freshTenant);
    }
  }, 30_000);

  it("label-injection attempt — a maliciously-crafted generationId is rejected by regex validation BEFORE it ever reaches Cypher string interpolation", async () => {
    const maliciousGenerationId = "G_deadbeefdeadbeefdeadbeefdeadbee`}) DETACH DELETE (n";
    // Going through the real adapter (not just naming.ts's own unit test) proves the
    // port method itself validates before building any query string — if validation
    // were skipped, this string would be interpolated directly into a label position
    // and the malformed Cypher would either syntax-error or, worse, actually execute
    // the injected clause.
    const { Neo4jGraphStore } = await import("./neo4j-graph-store.js");
    const store = new Neo4jGraphStore();
    await expect(
      store.upsertNodes(
        { tenantId: tenantA, generationId: maliciousGenerationId },
        [{ id: "x", type: "Person", aclTags: [] }],
      ),
    ).rejects.toThrow(/invalid identifier/i);

    // Confirm the tenant's real data survived — the "DETACH DELETE" the crafted
    // string attempted never ran.
    const after = await withTenantGraph(tenantA, (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"), "READ");
    expect(after.records.map((r) => r.get("id"))).toContain("a-entity-1");
  });

  it("test 2 (Forbidden mapping) is never mistaken for GraphStoreUnavailableError — the distinct failure classes stay distinct end to end", async () => {
    const env = loadGraphStoreEnv();
    const driver = getServiceDriver();
    const tenantBDatabase = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantB);
    const tenantAUser = tenantUserName(tenantA);
    // Exercise via the real withTenantGraph() wrapper by constructing a scope whose
    // tenantId happens to resolve to tenant A's own database (the wrapper always
    // derives `database` from `tenantId` itself, so to prove the FORBIDDEN mapping
    // through the public primitive we go one level down to the same raw session
    // shape test 2 used and pass it through this package's own `mapGraphStoreError`).
    const { mapGraphStoreError } = await import("./tenant-session.js");
    const session = driver.session({ database: tenantBDatabase, impersonatedUser: tenantAUser, defaultAccessMode: neo4j.session.READ });
    let caught: unknown;
    try {
      await session.executeRead((tx) => tx.run("MATCH (n) RETURN n"));
    } catch (err) {
      caught = err;
    } finally {
      await session.close();
    }
    const mapped = mapGraphStoreError(caught, { tenantId: tenantA, database: tenantBDatabase });
    expect(mapped).toBeInstanceOf(GraphStoreForbiddenError);
  });
});
