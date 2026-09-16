/**
 * The two audited escape hatches (docs/testing.md §5, cases 15/16; ADR-0002 rule 5).
 *
 * `getPlatformDb()` (`tenant-db.ts`) is the only way any code reaches `platform.*` tables —
 * the tenant registry, staff accounts, the platform audit log — and ADR-0002 rule 5 permits
 * exactly two reasons to: tenant provisioning and cross-tenant analytics rollups. Both must
 * declare `platformScope` on the bound `TenantContext` before `getPlatformDb()` will hand
 * back a client; without it, the call is cross-tenant access with no sanctioned reason, and
 * `tenant-db.ts` refuses.
 *
 * This is a `tenant-db.ts`-internal guard (a plain `if` on the bound context, no database
 * feature involved), so it is largely already proven by that mechanism's own existence —
 * this file's job is to prove it holds against the real database rather than a fake
 * `PrismaClient`, and to prove the "succeeds when scoped correctly" half, not only the
 * refusal.
 */

import { describe, expect, it } from "vitest";
import {
  runWithTenant,
  type TenantContext,
} from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { getPlatformDb } from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { SEWA } from "./setup.js";

function unscopedContext(): TenantContext {
  return { tenant: SEWA, principal: null, traceId: "cross-tenant-analytics-spec-unscoped" };
  // No platformScope — this is the point of this fixture.
}

function scopedContext(scope: "provisioning" | "analytics-rollup"): TenantContext {
  return {
    tenant: SEWA,
    principal: null,
    traceId: `cross-tenant-analytics-spec-${scope}`,
    platformScope: scope,
  };
}

describe("getPlatformDb() refuses cross-tenant access with no declared scope", () => {
  it("throws when platformScope is unset, before any query reaches SQL Server", async () => {
    await runWithTenant(unscopedContext(), async () => {
      expect(() => getPlatformDb("cross-tenant-analytics-spec")).toThrow(
        /platform scope|platformScope/i,
      );
    });
  });

  it("throwing on the client factory means no platform-schema query can be issued at all", async () => {
    // There is no getPlatformDb() call that returns a usable-but-unaudited handle — the
    // refusal happens before a PrismaClient object exists, so there is nothing left to
    // query with. Asserted by confirming the thrown error, not a query result, is what a
    // caller receives.
    await runWithTenant(unscopedContext(), async () => {
      let handle: unknown;
      expect(() => {
        handle = getPlatformDb("cross-tenant-analytics-spec");
      }).toThrow();
      expect(handle).toBeUndefined();
    });
  });
});

describe("getPlatformDb() succeeds for each of the two sanctioned scopes", () => {
  it.each(["provisioning", "analytics-rollup"] as const)(
    "returns a working platform-schema client when platformScope is %s",
    async (scope) => {
      const count = await runWithTenant(scopedContext(scope), async () => {
        const db = getPlatformDb("cross-tenant-analytics-spec");
        // A real query against platform.Tenants — not merely "did not throw" — so this
        // proves the client is genuinely usable, not just constructed.
        return db.tenant.count();
      });
      expect(count).toBeGreaterThanOrEqual(0);
    },
  );
});

describe("no third path", () => {
  // A finding, not merely a passing assertion: getPlatformDb()'s runtime guard
  // (tenant-db.ts) is `if (!context.platformScope) throw` — it checks *presence*, not
  // *membership* in the two sanctioned values. The restriction to exactly "provisioning" |
  // "analytics-rollup" is enforced by TypeScript's literal-union type on every call site
  // that sets platformScope (tenant-context.ts), never by a runtime check of the value —
  // there is no code path from request input to platformScope (api.md §12 invariant 1
  // keeps every tenant-shaped field, and this one, off the request entirely), so this is a
  // defence-in-depth gap rather than a reachable leak, and it is recorded here rather than
  // silently assumed away.
  it("a truthy but non-sanctioned scope value is still accepted by the runtime guard", async () => {
    const forged = {
      tenant: SEWA,
      principal: null,
      traceId: "cross-tenant-analytics-spec-forged-scope",
      platformScope: "reporting",
    } as unknown as TenantContext;

    const count = await runWithTenant(forged, async () => {
      const db = getPlatformDb("cross-tenant-analytics-spec");
      return db.tenant.count();
    });
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
