import { describe, expect, it } from "vitest";
import {
  currentTenant,
  MissingTenantContextError,
  requirePrincipal,
  requireTenantContext,
  runWithTenant,
  tryGetTenantContext,
  type Principal,
  type TenantContext,
} from "./tenant-context.js";
import { assertValidSlugShape } from "./tenant-slug.js";

/**
 * The tenant context is what makes a cross-tenant query unexpressible rather
 * than merely discouraged (ADR-0002 rule 2). Its correctness properties are
 * therefore security properties, and two of them are easy to get wrong:
 *
 *  - **Async propagation.** If the context is lost across an await, a promise
 *    chain or a background continuation, the data-access layer throws — which is
 *    a safe failure. But if it were to *leak* between concurrent requests, one
 *    government entity's request would read another's schema. The concurrency
 *    test below is the one that matters.
 *  - **No ambient default.** A missing context must throw, never fall back.
 *
 * Covers NFR-SEC-16, NFR-SEC-17 and FR-PLAT-07.
 */

const sewa = assertValidSlugShape("sewa");
const customs = assertValidSlugShape("customs");

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "usr_01",
    tenant: sewa,
    displayName: "Sara Al Mazrouei",
    roles: ["AgentDesigner"],
    permissions: new Set(["agents:manage"]),
    assurance: "L1",
    ...overrides,
  };
}

function context(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant: sewa,
    principal: principal(),
    traceId: "trace_01",
    ...overrides,
  };
}

describe("runWithTenant", () => {
  it("binds the tenant for the duration of the callback", () => {
    const seen = runWithTenant(context(), () => currentTenant("test"));
    expect(seen).toBe("sewa");
  });

  it("unbinds after the callback returns", () => {
    runWithTenant(context(), () => currentTenant("test"));
    expect(tryGetTenantContext()).toBeUndefined();
  });

  it("unbinds even when the callback throws", () => {
    expect(() =>
      runWithTenant(context(), () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    // A context surviving a thrown request would be the worst kind of leak:
    // the next request on this worker would inherit the previous tenant.
    expect(tryGetTenantContext()).toBeUndefined();
  });

  it("supports nesting, and restores the outer tenant on exit", () => {
    const order = runWithTenant(context({ tenant: sewa }), () => {
      const outer = currentTenant("outer");
      const inner = runWithTenant(context({ tenant: customs }), () => currentTenant("inner"));
      const afterInner = currentTenant("outer again");
      return [outer, inner, afterInner];
    });
    expect(order).toEqual(["sewa", "customs", "sewa"]);
  });
});

describe("async propagation", () => {
  it("survives an await", async () => {
    const seen = await runWithTenant(context(), async () => {
      await Promise.resolve();
      return currentTenant("after await");
    });
    expect(seen).toBe("sewa");
  });

  it("survives a timer continuation", async () => {
    const seen = await runWithTenant(context(), async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentTenant("after timer");
    });
    expect(seen).toBe("sewa");
  });

  it("survives a nested promise chain", async () => {
    const seen = await runWithTenant(context(), () =>
      Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => currentTenant("deep in chain")),
    );
    expect(seen).toBe("sewa");
  });

  it("does NOT leak between interleaved concurrent requests", async () => {
    // The property that actually matters. Two requests for different government
    // entities, deliberately interleaved so that if AsyncLocalStorage were
    // shared state rather than per-context, one would observe the other's
    // tenant partway through.
    const observations: string[] = [];

    const request = (tenant: typeof sewa, delays: number[]) =>
      runWithTenant(context({ tenant }), async () => {
        for (const delay of delays) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          observations.push(`${tenant}:${currentTenant("interleaved")}`);
        }
      });

    await Promise.all([request(sewa, [2, 4, 1]), request(customs, [1, 3, 5])]);

    expect(observations).toHaveLength(6);
    // Every observation must report the tenant its own request was bound to.
    for (const entry of observations) {
      const [bound, observed] = entry.split(":");
      expect(observed).toBe(bound);
    }
  });
});

describe("missing context", () => {
  it("throws rather than defaulting to any tenant", () => {
    // A default would be catastrophic: it would silently read some tenant's
    // data. The safe failure is a 500.
    expect(() => currentTenant("unbound read")).toThrow(MissingTenantContextError);
  });

  it("names the operation, so the stack is diagnosable", () => {
    expect(() => requireTenantContext("agents.list")).toThrow(/agents\.list/);
  });

  it("explains the fix in the message", () => {
    // These errors surface at 2am. The message should say what to do.
    expect(() => currentTenant("x")).toThrow(/runWithTenant/);
  });

  it("tryGetTenantContext returns undefined instead of throwing", () => {
    expect(tryGetTenantContext()).toBeUndefined();
  });
});

describe("principal", () => {
  it("returns the bound principal", () => {
    const p = runWithTenant(context(), () => requirePrincipal("test"));
    expect(p.id).toBe("usr_01");
  });

  it("throws when the request is anonymous", () => {
    expect(() =>
      runWithTenant(context({ principal: null }), () => requirePrincipal("agents.publish")),
    ).toThrow(/requires an authenticated principal/);
  });

  it("allows an anonymous citizen context to exist", () => {
    // Anonymous is legitimate on the citizen surface: B11 tab 2 permits
    // "view bill balance" at L0. Only privileged operations require a principal.
    const ctx = runWithTenant(context({ principal: null }), () =>
      requireTenantContext("citizen turn"),
    );
    expect(ctx.principal).toBeNull();
    expect(ctx.tenant).toBe("sewa");
  });

  it("carries an assurance level and nothing about how it was established", () => {
    // ADR-0006 rule 1: feature modules consume a Principal, never credentials.
    // This is what makes swapping the local adapter for UAE PASS a change to
    // session creation only.
    const p = principal({ assurance: "L2" });
    expect(p.assurance).toBe("L2");
    expect(Object.keys(p)).not.toContain("password");
    expect(Object.keys(p)).not.toContain("passwordHash");
    expect(Object.keys(p)).not.toContain("token");
    expect(Object.keys(p)).not.toContain("claims");
  });
});

describe("platform scope", () => {
  it("is absent by default", () => {
    // Cross-tenant access must be a decision visible in the code, not the
    // ambient default (ADR-0002 rule 5).
    const ctx = runWithTenant(context(), () => requireTenantContext("test"));
    expect(ctx.platformScope).toBeUndefined();
  });

  it.each(["provisioning", "analytics-rollup", "migration", "identity"] as const)(
    "can be declared as %s",
    (scope) => {
      const ctx = runWithTenant(context({ platformScope: scope }), () =>
        requireTenantContext("test"),
      );
      expect(ctx.platformScope).toBe(scope);
    },
  );
});
