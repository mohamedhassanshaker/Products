import { describe, expect, it } from "vitest";
import {
  assertValidSlugShape,
  InvalidTenantSlugError,
  isValidSlugShape,
  neo4jLabelFor,
  qdrantCollectionFor,
  redisPrefixFor,
  sqlSchemaFor,
  type TenantSlug,
} from "./tenant-slug.js";

/**
 * Tenant slug validation is a security control, not input tidying.
 *
 * Every isolation-unit name in the system is derived from a slug, and three of
 * those names land in identifier position where no parameter binding exists — a
 * SQL Server schema, a Neo4j label and a Qdrant collection name cannot be bound
 * parameters. So this character-class check is the only thing between a tenant
 * value and an injection, which is why the negative cases below matter as much
 * as the positive ones.
 *
 * Covers NFR-SEC-19 and FR-PLAT-03.
 */

const slug = (s: string) => assertValidSlugShape(s);

describe("assertValidSlugShape — accepts", () => {
  it.each(["sewa", "customs", "libraries", "sharjah_platform", "a1", "x_9_z", "a".repeat(30)])(
    "%s",
    (value) => {
      expect(assertValidSlugShape(value)).toBe(value);
    },
  );
});

describe("assertValidSlugShape — rejects malformed shapes", () => {
  it.each([
    ["", "empty"],
    ["a", "single character — below the 2-char minimum"],
    ["a".repeat(31), "31 characters — above the 30-char maximum"],
    ["1sewa", "starts with a digit"],
    ["_sewa", "starts with an underscore"],
    ["SEWA", "uppercase"],
    ["Sewa", "mixed case"],
    ["se-wa", "hyphen — legal in Qdrant but needs quoting as a SQL schema and a Neo4j label"],
    ["se wa", "whitespace"],
    ["se.wa", "dot — would read as a schema-qualified name"],
    ["sewa$", "dollar"],
    ["sewa\n", "trailing newline"],
    ["sewa\0", "null byte"],
    ["sewä", "non-ASCII"],
  ])("%s (%s)", (value) => {
    expect(() => assertValidSlugShape(value)).toThrow(InvalidTenantSlugError);
  });

  it.each([undefined, null, 42, {}, [], true, Symbol("sewa")])("non-string: %s", (value) => {
    expect(() => assertValidSlugShape(value)).toThrow(InvalidTenantSlugError);
  });
});

describe("assertValidSlugShape — rejects injection attempts", () => {
  /**
   * These are the payloads that would matter if a slug ever reached identifier
   * position unvalidated. Each is rejected by the character class rather than by
   * a denylist, which is why the list does not need to be exhaustive to be
   * sound — anything outside [a-z0-9_] cannot pass.
   */
  it.each([
    "sewa;DROP SCHEMA customs",
    "sewa--",
    "sewa/*",
    "sewa'",
    'sewa"',
    "sewa`",
    "sewa]-[",
    "customs`) MATCH (n) DETACH DELETE n //",
    "../customs",
    "sewa%00",
    "sewa OR 1=1",
  ])("%s", (value) => {
    expect(() => assertValidSlugShape(value)).toThrow(InvalidTenantSlugError);
  });

  it("does not echo the offending value into the error message", () => {
    // The message reaches logs, and this error is raised on untrusted input.
    const payload = "sewa'; DROP SCHEMA customs; --";
    try {
      assertValidSlugShape(payload);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTenantSlugError);
      expect((error as Error).message).not.toContain(payload);
      // The value is still available for structured handling, just not interpolated.
      expect((error as InvalidTenantSlugError).value).toBe(payload);
    }
  });
});

describe("assertValidSlugShape — rejects reserved names", () => {
  /**
   * Three groups, all of which would cause damage rather than a clean error:
   * SQL Server's own schemas and system databases, this project's reserved
   * schemas, and `neo4j` — the single Community database name (ADR-0009).
   */
  it.each([
    ["platform", "holds the global tables"],
    ["tenant_template", "the DDL template every tenant schema is created from"],
    ["dbo", "SQL Server's default schema"],
    ["sys", "SQL Server system schema"],
    ["information_schema", "SQL standard metadata schema"],
    ["master", "SQL Server system database"],
    ["tempdb", "SQL Server system database"],
    ["neo4j", "the single Community graph database (ADR-0009)"],
  ])("%s (%s)", (value) => {
    expect(() => assertValidSlugShape(value)).toThrow(/reserved/i);
  });

  it("reserves `platform` so no tenant can collide with the global schema", () => {
    // getPlatformDb() addresses "platform" as a compile-time constant. That is
    // only safe because no tenant can ever be named it.
    expect(isValidSlugShape("platform")).toBe(false);
  });
});

describe("derived store names", () => {
  const sewa: TenantSlug = slug("sewa");

  it("derives the SQL Server schema", () => {
    expect(sqlSchemaFor(sewa)).toBe("sewa");
  });

  it("derives the Neo4j tenant label with the Tenant_ prefix (ADR-0009)", () => {
    expect(neo4jLabelFor(sewa)).toBe("Tenant_sewa");
  });

  it("keeps the longest possible label within the registry column width", () => {
    // The registry column is VARCHAR(38); "Tenant_" + 30 chars = 37.
    const longest = slug("a".repeat(30));
    expect(neo4jLabelFor(longest)).toHaveLength(37);
    expect(neo4jLabelFor(longest).length).toBeLessThanOrEqual(38);
  });

  it("derives the Qdrant collection", () => {
    expect(qdrantCollectionFor(sewa)).toBe("sewa_knowledge");
  });

  it("derives the Redis prefix with a trailing colon", () => {
    // The colon is included so a caller cannot produce "sewasession:x" by
    // concatenation — a key that would sit outside the tenant's namespace.
    expect(redisPrefixFor(sewa)).toBe("sewa:");
    expect(`${redisPrefixFor(sewa)}session:abc`).toBe("sewa:session:abc");
  });

  it("produces distinct names for distinct tenants across every store", () => {
    const customs = slug("customs");
    expect(sqlSchemaFor(sewa)).not.toBe(sqlSchemaFor(customs));
    expect(neo4jLabelFor(sewa)).not.toBe(neo4jLabelFor(customs));
    expect(qdrantCollectionFor(sewa)).not.toBe(qdrantCollectionFor(customs));
    expect(redisPrefixFor(sewa)).not.toBe(redisPrefixFor(customs));
  });

  it("cannot produce a name where one tenant's prefix shadows another", () => {
    // A slug of "sewa" and one of "sewa_billing" must not collide under a
    // prefix match — otherwise a Redis SCAN for one would enumerate the other.
    const a = redisPrefixFor(slug("sewa"));
    const b = redisPrefixFor(slug("sewa_billing"));
    expect(b.startsWith(a)).toBe(false);
  });
});
