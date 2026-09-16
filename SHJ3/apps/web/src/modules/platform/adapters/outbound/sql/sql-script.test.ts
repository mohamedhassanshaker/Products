import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { InvalidTenantSlugError, assertValidSlugShape } from "../../../tenancy/tenant-slug.js";
import type { TenantSlug } from "../../../tenancy/tenant-slug.js";
import {
  TENANT_SECTION_MARKER,
  TenantSqlScriptError,
  safeSchemaName,
  splitBatches,
  substituteSchema,
  tenantSection,
  tenantTemplateStatements,
} from "./sql-script.js";

/**
 * Tests for the SQL provisioning script assembly.
 *
 * This module decides what DDL text is sent to SQL Server under a schema name, and the
 * schema name lands in identifier position where no parameter binding exists. There is no
 * database-level control beneath it: a crafted name would execute as DDL with the
 * migrator's authority. So the tests that matter here are the ones that force a bad value
 * through the type system and assert it is still refused (ADR-0002 enforcement rule 4).
 *
 * The rest pin down the file conventions the platform migration orchestrator already
 * relies on — the `{{SCHEMA}}` token, the section boundary and `GO` batching — because
 * getting those wrong applies the platform section to a tenant schema, or a tenant's
 * constraints to `platform`.
 *
 * Covers FR-PLAT-02.
 */

const SEWA = assertValidSlugShape("sewa");
const CONSTRAINTS = resolve(process.cwd(), "prisma", "sql", "001_constraints.sql");

/** A value the compiler believes is validated and is not. */
function forge(value: string): TenantSlug {
  return value as unknown as TenantSlug;
}

describe("safeSchemaName", () => {
  it("returns the slug as the schema name", () => {
    expect(safeSchemaName(SEWA)).toBe("sewa");
  });

  it.each([
    ["sewa]; DROP SCHEMA platform --", "a bracket escape out of identifier position"],
    ["sewa customs", "whitespace"],
    ["sewa-customs", "a hyphen, which would need quoting"],
    ["SEWA", "uppercase"],
    ["platform", "a reserved schema"],
    ["tenant_template", "the DDL template schema"],
    ["dbo", "SQL Server's default schema"],
    ["", "an empty name"],
  ])("refuses %j — %s — even when the brand claims it is validated", (value) => {
    // The brand is a compile-time claim. The runtime re-check is what survives a cast, a
    // registry round trip, or a future caller who builds the value some other way.
    expect(() => safeSchemaName(forge(value))).toThrow(InvalidTenantSlugError);
  });

  it("does not echo the offending value, because the message reaches logs", () => {
    const payload = "sewa'; EXEC xp_cmdshell 'whoami' --";
    expect(() => safeSchemaName(forge(payload))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(payload) }),
    );
  });
});

describe("substituteSchema", () => {
  it("replaces every occurrence of the token", () => {
    const sql = "SELECT 1 FROM [{{SCHEMA}}].[Agents] JOIN [{{SCHEMA}}].[Teams]";
    expect(substituteSchema(sql, SEWA)).toBe("SELECT 1 FROM [sewa].[Agents] JOIN [sewa].[Teams]");
  });

  it("leaves a script with no token untouched", () => {
    expect(substituteSchema("SELECT 1", SEWA)).toBe("SELECT 1");
  });

  it("refuses a token it has no substitution rule for", () => {
    // A second token introduced into the SQL later must fail loudly rather than reach the
    // server as literal text, where it could succeed inside a string column.
    expect(() => substituteSchema("SELECT '{{TENANT_ID}}'", SEWA)).toThrow(TenantSqlScriptError);
  });

  it("validates before substituting, not after", () => {
    expect(() => substituteSchema("[{{SCHEMA}}]", forge("bad slug"))).toThrow(
      InvalidTenantSlugError,
    );
  });
});

describe("tenantSection", () => {
  it("returns only the text after the boundary marker", () => {
    const source = `platform statements${TENANT_SECTION_MARKER}tenant statements`;
    expect(tenantSection(source)).toBe("tenant statements");
  });

  it("refuses a script with no boundary rather than returning the whole file", () => {
    // Applying the platform section to a tenant schema fails mid-run and leaves a
    // partially constrained schema, which is harder to diagnose than a refusal.
    expect(() => tenantSection("no marker here")).toThrow(TenantSqlScriptError);
  });

  it("splits the real constraints file into a tenant half that carries the token", async () => {
    const source = await readFile(CONSTRAINTS, "utf8");
    const tenant = tenantSection(source);

    expect(tenant).toContain("{{SCHEMA}}");
    // `platform.Tenants` is the registry — a platform-only table. Finding it in the
    // tenant half would mean the boundary moved and every tenant would get the registry's
    // constraints applied to a schema that has no such table.
    expect(tenant).not.toContain("[platform].[Tenants]");
  });

  it("produces a tenant half whose every token substitutes cleanly", async () => {
    const source = await readFile(CONSTRAINTS, "utf8");
    const applied = substituteSchema(tenantSection(source), SEWA);

    expect(applied).not.toContain("{{");
    expect(applied).toContain("[sewa]");
  });
});

describe("splitBatches", () => {
  it("splits on a GO line and strips it", () => {
    expect(splitBatches("ALTER TABLE a\nGO\nALTER TABLE b")).toEqual([
      "ALTER TABLE a",
      "ALTER TABLE b",
    ]);
  });

  it("accepts the sqlcmd variations: indentation, trailing space, lowercase, a comment", () => {
    const sql = "one\n  GO  \ntwo\ngo\nthree\nGO -- end of batch\nfour";
    expect(splitBatches(sql)).toEqual(["one", "two", "three", "four"]);
  });

  it("does not split on GO inside a statement", () => {
    // `GOVERNANCE` and a column named `go` must not become batch boundaries.
    const sql = "SELECT go FROM [x].[GOVERNANCE_RULES]";
    expect(splitBatches(sql)).toEqual([sql]);
  });

  it("drops batches that carry no SQL", () => {
    // The constraints file ends with a 40-line block comment, and sending a comment-only
    // batch is at best a pointless round trip.
    const sql = "real statement\nGO\n-- just a line comment\nGO\n/* just a block comment */";
    expect(splitBatches(sql)).toEqual(["real statement"]);
  });

  it("returns nothing for an empty script", () => {
    expect(splitBatches("   \n\n  ")).toEqual([]);
  });

  it("splits the real constraints file's tenant half into runnable batches", async () => {
    const source = await readFile(CONSTRAINTS, "utf8");
    const batches = splitBatches(substituteSchema(tenantSection(source), SEWA));

    expect(batches.length).toBeGreaterThan(0);
    expect(batches.every((batch) => !/^\s*GO\s*$/im.test(batch))).toBe(true);
  });
});

describe("tenantTemplateStatements", () => {
  const MIGRATION = [
    "-- CreateTable",
    "CREATE TABLE [platform].[Tenants] (",
    "  [slug] VARCHAR(30) NOT NULL",
    ");",
    "",
    "-- CreateTable",
    "CREATE TABLE [tenant_template].[Agents] (",
    "  [id] CHAR(26) NOT NULL",
    ");",
    "",
    "-- AddForeignKey",
    "ALTER TABLE [tenant_template].[Agents] ADD CONSTRAINT [FK_Agents_tenant]",
    "  FOREIGN KEY ([tenantId]) REFERENCES [platform].[Tenants]([id]);",
    "",
  ].join("\n");

  it("keeps only the statements that belong to a tenant schema", () => {
    const statements = tenantTemplateStatements(MIGRATION, SEWA);

    // The platform half has already been applied once; replaying it per tenant would fail
    // on the first object that exists.
    expect(statements.some((s) => s.includes("[platform].[Tenants] ("))).toBe(false);
    expect(statements).toHaveLength(2);
  });

  it("retargets the template schema at the tenant", () => {
    const statements = tenantTemplateStatements(MIGRATION, SEWA);

    expect(statements[0]).toContain("[sewa].[Agents]");
    expect(statements.join("\n")).not.toContain("tenant_template");
  });

  it("keeps a statement that spans both schemas", () => {
    // A tenant table's foreign key into `platform` is part of the tenant's shape and
    // cannot be applied any other way.
    const foreignKey = tenantTemplateStatements(MIGRATION, SEWA)[1];

    expect(foreignKey).toContain("[sewa].[Agents]");
    expect(foreignKey).toContain("[platform].[Tenants]");
  });

  it("drops fragments that are only a comment", () => {
    // Prisma annotates its migrations heavily, and a trailing note mentioning the template
    // schema would otherwise be sent to the server as a statement.
    const annotated = `${MIGRATION}\n-- nothing further for tenant_template in this migration\n`;

    expect(tenantTemplateStatements(annotated, SEWA)).toHaveLength(2);
  });

  it("returns nothing for a migration that touches no tenant table", () => {
    expect(
      tenantTemplateStatements("CREATE TABLE [platform].[Locales] ([code] CHAR(2));", SEWA),
    ).toHaveLength(0);
  });

  it("validates the slug before it can reach a statement", () => {
    expect(() => tenantTemplateStatements(MIGRATION, forge("sewa; DROP SCHEMA platform"))).toThrow(
      InvalidTenantSlugError,
    );
  });
});
