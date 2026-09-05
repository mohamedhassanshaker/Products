import { describe, expect, it } from "vitest";
import {
  assertValidGenerationLabel,
  assertValidRelationType,
  assertValidTenantId,
  tenantDatabaseName,
  tenantIdToHex,
  tenantRoleName,
  tenantUserName,
} from "./naming.js";
import { GraphStoreInvalidIdentifierError } from "./errors.js";

const VALID_TENANT_ID = "0198f2a4-1c2b-7def-9a12-abcdef012345";

describe("assertValidTenantId", () => {
  it("accepts a well-formed UUID", () => {
    expect(() => assertValidTenantId(VALID_TENANT_ID)).not.toThrow();
  });

  it.each(["not-a-uuid", "", "0198f2a4-1c2b-7def-9a12", 123 as unknown as string, null as unknown as string])(
    "rejects %j",
    (bad) => {
      expect(() => assertValidTenantId(bad)).toThrow(GraphStoreInvalidIdentifierError);
    },
  );
});

describe("tenantIdToHex", () => {
  it("strips dashes and lowercases", () => {
    expect(tenantIdToHex(VALID_TENANT_ID)).toBe("0198f2a41c2b7def9a12abcdef012345");
    expect(tenantIdToHex(VALID_TENANT_ID.toUpperCase())).toBe("0198f2a41c2b7def9a12abcdef012345");
  });
});

describe("tenantDatabaseName", () => {
  it("computes a Neo4j-legal database name using a dash separator, not underscore", () => {
    // Real Neo4j 5 database names may contain only ASCII alnum/dot/dash (verified
    // against a real instance during implementation) — `t_<hex>` (the ADR/LLD's
    // literal string) would be REJECTED by the server; `t-<hex>` is what this
    // package actually uses. See naming.ts's own doc comment for the full story.
    const name = tenantDatabaseName("t", VALID_TENANT_ID);
    expect(name).toBe("t-0198f2a41c2b7def9a12abcdef012345");
    expect(name).not.toContain("_");
    expect(name).toMatch(/^[a-z][a-z0-9.-]{2,62}$/);
  });

  it("throws rather than return an illegal name for a bad prefix", () => {
    expect(() => tenantDatabaseName("_bad", VALID_TENANT_ID)).toThrow(GraphStoreInvalidIdentifierError);
  });
});

describe("tenantUserName / tenantRoleName", () => {
  it("use underscore separators (Neo4j user/role names permit it, unlike database names)", () => {
    expect(tenantUserName(VALID_TENANT_ID)).toBe("u_0198f2a41c2b7def9a12abcdef012345");
    expect(tenantRoleName(VALID_TENANT_ID)).toBe("role_0198f2a41c2b7def9a12abcdef012345");
  });
});

describe("assertValidGenerationLabel", () => {
  it("accepts a well-formed G_<32 hex> label", () => {
    expect(() => assertValidGenerationLabel("G_0198f2a41c2b7def9a12abcdef012345")).not.toThrow();
  });

  it.each([
    "g_0198f2a41c2b7def9a12abcdef012345", // lowercase g
    "G_short",
    "G_0198f2a41c2b7def9a12abcdef01234g", // non-hex char
    "'; MATCH (n) DETACH DELETE n; //", // an injection attempt
    "G_0198f2a41c2b7def9a12abcdef012345`) DETACH DELETE (m", // interpolation-breakout attempt
  ])("rejects %j", (bad) => {
    expect(() => assertValidGenerationLabel(bad)).toThrow(GraphStoreInvalidIdentifierError);
  });
});

describe("assertValidRelationType", () => {
  it("accepts an uppercase-snake relationship type", () => {
    expect(() => assertValidRelationType("WORKS_FOR")).not.toThrow();
  });

  it.each(["works_for", "1BAD", "WORKS-FOR", "WORKS_FOR`]-(evil:Entity {x:1})-[:R", ""])(
    "rejects %j",
    (bad) => {
      expect(() => assertValidRelationType(bad)).toThrow(GraphStoreInvalidIdentifierError);
    },
  );
});
