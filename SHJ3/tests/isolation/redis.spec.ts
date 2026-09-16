/**
 * Redis tenant isolation (docs/testing.md §5, case 5; ADR-0002).
 *
 * Redis has no schemas, databases-per-tenant or collections (`tenant-cache.ts`'s module
 * comment) — its isolation unit is a key prefix, applied by `handleFor()` on every command
 * the returned `TenantCache` exposes. Unlike the SQL Server mechanism this suite's
 * `sql.spec.ts` finds broken, the Redis prefix is plain JavaScript string concatenation
 * inside the one module that holds the raw client, so there is no ambient-connection trick
 * for the mechanism to silently fail to apply — every key really is `<prefix><key>` on the
 * wire, which is what this file proves directly against the real Redis container.
 *
 * The interesting case is `scanKeys`: `SCAN` with `MATCH "*"` is, by construction, a request
 * to enumerate *everything* — the property worth proving is that even that maximally broad
 * pattern cannot escape the tenant's own prefix, because the match pattern itself is built
 * as `<prefix><callerPattern>` before it reaches Redis (`tenant-cache.ts`'s `scanKeys`).
 */

import { afterAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { getTenantCache } from "../../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { CUSTOMS, SEWA, contextFor } from "./setup.js";

const SEWA_MARKER = "redis-isolation-spec:sewa-marker";
const CUSTOMS_MARKER = "redis-isolation-spec:customs-marker";

afterAll(async () => {
  for (const tenant of [SEWA, CUSTOMS]) {
    await runWithTenant(contextFor(tenant), async () => {
      await getTenantCache().del("session:isolation-spec", "breaker:isolation-spec");
    });
  }
});

describe("a key written under one tenant's prefix is unreachable under another's", () => {
  it("customs cannot read a key set by sewa", async () => {
    await runWithTenant(contextFor(SEWA), async () => {
      await getTenantCache().set("session:isolation-spec", SEWA_MARKER);
    });

    const sewaRead = await runWithTenant(contextFor(SEWA), () =>
      getTenantCache().get("session:isolation-spec"),
    );
    const customsRead = await runWithTenant(contextFor(CUSTOMS), () =>
      getTenantCache().get("session:isolation-spec"),
    );

    // Proves the write and the same-tenant read actually ran, before the isolation claim.
    expect(sewaRead).toBe(SEWA_MARKER);
    // The isolation claim: the identical logical key, read as a different tenant, is a
    // miss — not a value, and specifically never sewa's value.
    expect(customsRead).toBeNull();
  });

  it("a wrong-value check: two tenants holding the same key never observe each other's value", async () => {
    // testing.md §5.3's methodology — an empty result is ambiguous, a wrong value is not.
    // Both tenants set the identical logical key to different, distinguishable values.
    await runWithTenant(contextFor(SEWA), () =>
      getTenantCache().set("breaker:isolation-spec", SEWA_MARKER),
    );
    await runWithTenant(contextFor(CUSTOMS), () =>
      getTenantCache().set("breaker:isolation-spec", CUSTOMS_MARKER),
    );

    const sewaRead = await runWithTenant(contextFor(SEWA), () =>
      getTenantCache().get("breaker:isolation-spec"),
    );
    const customsRead = await runWithTenant(contextFor(CUSTOMS), () =>
      getTenantCache().get("breaker:isolation-spec"),
    );

    expect(sewaRead).toBe(SEWA_MARKER);
    expect(customsRead).toBe(CUSTOMS_MARKER);
    expect(sewaRead).not.toBe(customsRead);
  });
});

describe("scanKeys('*') cannot enumerate outside the calling tenant's prefix", () => {
  it("a wildcard scan as sewa never returns a key that was only ever written as customs", async () => {
    const customsOnlyKey = "queue:isolation-spec-customs-only";

    await runWithTenant(contextFor(CUSTOMS), async () => {
      await getTenantCache().set(customsOnlyKey, CUSTOMS_MARKER);
    });

    try {
      const sewaScan = await runWithTenant(contextFor(SEWA), () =>
        getTenantCache().scanKeys("*", 1000),
      );

      // Proves the scan actually walked the keyspace and found sewa's own keys (session:
      // and breaker: were written by the tests above, in the same afterAll-scoped run).
      expect(sewaScan.length).toBeGreaterThan(0);
      // The isolation claim: even an unrestricted "*" pattern, issued as sewa, cannot
      // surface a key that only ever existed under customs's prefix.
      expect(sewaScan).not.toContain(customsOnlyKey);

      const customsScan = await runWithTenant(contextFor(CUSTOMS), () =>
        getTenantCache().scanKeys("*", 1000),
      );
      expect(customsScan).toContain(customsOnlyKey);
    } finally {
      await runWithTenant(contextFor(CUSTOMS), async () => {
        await getTenantCache().del(customsOnlyKey);
      });
    }
  });

  it('a scan pattern crafted to look like an escape ("../*", "*:*") still resolves inside the prefix', async () => {
    // The pattern is concatenated as `${prefix}${patternWithinTenant}` (tenant-cache.ts), so
    // there is no string the caller can supply that reaches outside `<tenant>:` — Redis
    // key patterns have no path-traversal semantics for `SCAN` to begin with, but this
    // pins down that a caller cannot construct one that means "every tenant" either.
    const marker = "escape-attempt:isolation-spec";
    await runWithTenant(contextFor(SEWA), () => getTenantCache().set(marker, SEWA_MARKER));

    try {
      for (const pattern of ["*:*", "../*", "*"]) {
        const customsScan = await runWithTenant(contextFor(CUSTOMS), () =>
          getTenantCache().scanKeys(pattern, 1000),
        );
        expect(customsScan).not.toContain(marker);
      }
    } finally {
      await runWithTenant(contextFor(SEWA), () => getTenantCache().del(marker));
    }
  });
});
