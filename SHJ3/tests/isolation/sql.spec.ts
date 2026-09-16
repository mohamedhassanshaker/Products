/**
 * SQL Server tenant isolation (docs/testing.md §5, cases 1/2/11; ADR-0002).
 *
 * Two claims, tested separately because they turned out **not** to stand or fall
 * together:
 *
 *  1. **The physical isolation unit exists.** `sewa` and `customs` each get their own SQL
 *     Server schema, with the tenant's full table set, created by the real
 *     `SqlStoreProvisioner` during `tests/isolation/setup.ts`'s provisioning. Asserted with
 *     the same `sys.schemas` / `sys.tables` introspection `SqlStoreProvisioner.verify()`
 *     itself uses, so this half is a released, already-trusted mechanism re-asserted here
 *     as the isolation suite's own foundation.
 *
 *  2. **The application reaches it through `getTenantDb()`.** This is the property
 *     ADR-0002 rule 3 actually promises feature code: "no unscoped client is exported…
 *     there is no vocabulary in which to express a cross-tenant query." Testing this
 *     against the real database (rather than trusting `tenant-db.ts`'s own comments) is
 *     the whole reason this suite exists rather than a fakes-based unit test — see
 *     testing.md §3's "a mocked repository … will pass indefinitely while the real schema
 *     is broken."
 *
 * **This file previously documented a real, confirmed defect (ADR-0010) and is now the
 * regression test that proves its fix (ADR-0011).** The original design built one
 * `PrismaClient` per tenant via a `schema=<slug>` connection-string parameter, in a single
 * `prisma/schema.prisma` file using Prisma's `multiSchema` preview feature for both
 * `platform` and `tenant_template`. That did not work: `multiSchema` resolves `@@schema()`
 * to a literal schema name at `prisma generate` time, identical for every client instance
 * regardless of its connection string, so `getTenantDb().<model>.*` queries were **always**
 * literally `[tenant_template].[<Table>]` — confirmed by enabling Prisma's query event log
 * and reading the emitted statement verbatim. Every tenant's ORM traffic landed in the same
 * physical `tenant_template` schema, which the schema file's own header comment describes as
 * a location where "at runtime NO ROW IS EVER READ OR WRITTEN."
 *
 * A follow-up experiment (ADR-0011), done before ADR-0010's raw-SQL fix was built, isolated
 * the real cause: the connection-string `schema=` mechanism itself is correct — proven
 * directly against a live database, for both reads and writes — and the defect was
 * specifically `multiSchema` overriding it. The fix: `prisma/schema.prisma` split into
 * `prisma/platform/schema.prisma` (keeps `multiSchema`, unaffected — `platform` is a single
 * fixed schema, exactly the case that feature is designed for) and
 * `prisma/tenant/schema.prisma` (no `@@schema()`, no `multiSchema` — restoring plain
 * connection-string routing). `getTenantDb()` is unchanged in shape and now built from the
 * tenant client (`tenant-db.ts`). The tests below assert the property ADR-0002 promises and
 * must be green — that is what "implemented," not just "written," means for this ADR.
 *
 * `sql-store-provisioner.ts` and `sql-script.ts` were never affected by any of this — they
 * never relied on ambient schema resolution. Every statement they send is schema-qualified
 * in its own text (`{{SCHEMA}}` substitution) or binds the schema name as an explicit
 * parameter, which is why tenant provisioning worked correctly throughout.
 */

import { afterAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import {
  assertValidSlugShape,
  InvalidTenantSlugError,
} from "../../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import type { TenantSlug } from "../../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import {
  getPlatformDb,
  getTenantDb,
} from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { CUSTOMS, SEWA, contextFor } from "./setup.js";

const COUNT_TABLES =
  "SELECT COUNT(*) AS value FROM sys.tables t " +
  "JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = @P1";

async function tableCount(schema: string): Promise<number> {
  return runWithTenant(
    { tenant: SEWA, principal: null, traceId: "sql-spec-setup", platformScope: "provisioning" },
    async () => {
      const rows = (await getPlatformDb("sql isolation spec").$queryRawUnsafe(
        COUNT_TABLES,
        schema,
      )) as { value: number | bigint }[];
      return Number(rows[0]?.value ?? 0);
    },
  );
}

describe("physical isolation unit: each tenant has its own SQL Server schema", () => {
  it("provisions sewa and customs as distinct schemas with the tenant's full table set", async () => {
    const [sewaTables, customsTables, templateTables] = await Promise.all([
      tableCount("sewa"),
      tableCount("customs"),
      tableCount("tenant_template"),
    ]);

    // Proves the query ran and found something, before the isolation claim.
    expect(templateTables).toBeGreaterThan(0);
    expect(sewaTables).toBe(templateTables);
    expect(customsTables).toBe(templateTables);
  });
});

describe("assertValidSlugShape closes the injection path before a schema name is ever built", () => {
  // testing.md case 11: a forged/injected tenant field is rejected at slug validation,
  // before it reaches a query builder or SQL Server — the foundation every store's
  // isolation-unit derivation (sqlSchemaFor, neo4jLabelFor, qdrantCollectionFor,
  // redisPrefixFor) depends on. Fast, no store required; re-asserted here because this
  // file's other cases build schema names from the same function.
  it.each([
    ["sewa; DROP SCHEMA customs", "batched statement"],
    ["../customs", "path traversal"],
    ["sewa-customs", "hyphenated — legal for Qdrant, unsafe as a SQL Server/Neo4j identifier"],
    ["customs] MATCH (n", "Cypher-shaped fragment"],
    ["dbo", "reserved SQL Server schema"],
    ["platform", "reserved platform schema"],
    ["tenant_template", "reserved template schema"],
    ["", "empty"],
    ["SEWA", "uppercase"],
    ["a".repeat(40), "over length"],
  ])("rejects %j (%s)", (candidate) => {
    expect(() => assertValidSlugShape(candidate)).toThrow(InvalidTenantSlugError);
  });

  it("accepts the two isolation tenants' own slugs", () => {
    expect(assertValidSlugShape("sewa")).toBe("sewa");
    expect(assertValidSlugShape("customs")).toBe("customs");
  });
});

describe("getTenantDb(): a tenant-scoped Prisma client scopes its queries (ADR-0011)", () => {
  // Distinguishing markers, not reused from the seeded fixture data, so a wrong-tenant
  // read is unambiguous (testing.md §5.3 — a wrong value, not an empty result, is what
  // makes the assertion meaningful).
  const SEWA_MARKER = "SQL-ISOLATION-SPEC-SEWA-MARKER";
  const CUSTOMS_MARKER = "SQL-ISOLATION-SPEC-CUSTOMS-MARKER";
  const SEWA_ROW_ID = "01SQLSPECSEWAMARKERROW001";
  const CUSTOMS_ROW_ID = "01SQLSPECCUSTOMSMARKERRW1";

  /**
   * `TenantProfile` is a strict singleton per schema —
   * `CK_TenantProfiles_singleton CHECK (singletonKey = 1)` plus
   * `UQ_TenantProfiles_singleton` (prisma/sql/001_constraints.sql §2.1) — so this suite
   * cannot distinguish rows by `singletonKey` the way an ordinary table's fixture would;
   * every tenant schema holds at most one row, and it must be keyed `1`. Each write below
   * clears the tenant's own row first, then inserts a fresh one keyed `1` with a known
   * `id` and a distinguishing `displayName`. That also makes each test independent of what
   * an earlier test in this file left behind, not just of `afterAll` having run — the same
   * "meaningful even if another test is skipped" property testing.md case 1 asks for.
   */
  async function seedSingleton(tenant: TenantSlug, id: string, displayName: string): Promise<void> {
    await runWithTenant(contextFor(tenant), async () => {
      const db = getTenantDb();
      await db.tenantProfile.deleteMany({});
      await db.tenantProfile.create({
        data: {
          id,
          singletonKey: 1,
          tenantId: id,
          slug: tenant,
          displayName,
          isPlatformTenant: false,
          dataResidency: "UaeSharjahDc",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
  }

  afterAll(async () => {
    for (const tenant of [SEWA, CUSTOMS]) {
      await runWithTenant(contextFor(tenant), async () => {
        await getTenantDb().tenantProfile.deleteMany({});
      });
    }
  });

  it("a row written as sewa is invisible to a query issued as customs", async () => {
    await seedSingleton(SEWA, SEWA_ROW_ID, SEWA_MARKER);
    await seedSingleton(CUSTOMS, CUSTOMS_ROW_ID, CUSTOMS_MARKER);

    const sewaVisibleRows = await runWithTenant(contextFor(SEWA), async () => {
      const db = getTenantDb();
      return db.tenantProfile.findMany({ where: { id: { in: [SEWA_ROW_ID, CUSTOMS_ROW_ID] } } });
    });

    // Proves the query ran and found the tenant's own data.
    expect(sewaVisibleRows.some((row) => row.displayName === SEWA_MARKER)).toBe(true);
    // The isolation claim itself (ADR-0011). customs's row must be invisible from sewa's
    // handle — `getTenantDb()` now scopes Prisma Client model queries to the calling
    // tenant's schema via connection-string routing, with `multiSchema` out of the way.
    expect(sewaVisibleRows.some((row) => row.displayName === CUSTOMS_MARKER)).toBe(false);
  });

  it("a direct cross-schema query for the other tenant's exact key fails or returns nothing", async () => {
    // Companion to the case above, phrased the way testing.md case 1 states it: "a direct
    // attempt to query across schemas fails or returns nothing."
    const rowId = "01SQLSPECDIRECTQUERYROW01";
    await seedSingleton(CUSTOMS, rowId, "SQL-ISOLATION-SPEC-DIRECT-QUERY");

    const foundBySewa = await runWithTenant(contextFor(SEWA), async () =>
      getTenantDb().tenantProfile.findUnique({ where: { id: rowId } }),
    );

    expect(foundBySewa).toBeNull();
  });
});
