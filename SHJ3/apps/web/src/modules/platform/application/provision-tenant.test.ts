import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVISIONING_STORES,
  TenantProvisioningError,
  isFullyProvisioned,
  stepsRequiringRollback,
  type ProvisioningStep,
  type ProvisioningStore,
  type Tenant,
  type TenantStatus,
} from "../domain/tenant.js";
import type {
  AuditActor,
  AuditSink,
  Clock,
  StoreProvisioner,
  TenantProvisionedHook,
  TenantRegistry,
} from "../ports/provisioning.js";
import { assertValidSlugShape } from "../tenancy/tenant-slug.js";
import { ProvisionTenant } from "./provision-tenant.js";

/**
 * Provisioning tests.
 *
 * The happy path is the least interesting thing here. What matters is that no
 * failure mode can leave a tenant **addressable but incomplete** — a
 * half-provisioned tenant is the single state in which the isolation reasoning
 * breaks down (ADR-0002 rule 6, RISK-013), because queries would succeed against
 * the stores that exist and fail against the ones that do not, and failing is
 * not the same as being isolated.
 *
 * So most of this file drives a different store to fail and asserts the tenant
 * never reaches `Active`.
 *
 * Covers FR-PLAT-02 and FR-PLAT-04.
 */

const SEWA = assertValidSlugShape("sewa");

// ---------------------------------------------------------------------------
// Fakes. The use case holds no vendor imports (architecture.md §4), which is
// precisely what makes this testable without four containers.
// ---------------------------------------------------------------------------

class FakeRegistry implements TenantRegistry {
  rows = new Map<string, { tenant: Tenant; steps: ProvisioningStep[] }>();
  statusHistory: TenantStatus[] = [];

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = this.rows.get(slug);
    if (!row) return null;
    return { ...row.tenant, steps: [...row.steps] };
  }

  async listActive(): Promise<readonly Tenant[]> {
    return [...this.rows.values()].filter((r) => r.tenant.status === "Active").map((r) => r.tenant);
  }

  async listAll(): Promise<readonly Tenant[]> {
    return [...this.rows.values()].map((r) => r.tenant);
  }

  async register(input: {
    slug: string;
    displayName: string;
    embeddingModel: string;
    embeddingDimensions: number;
  }): Promise<Tenant> {
    if (this.rows.has(input.slug)) throw new Error("duplicate slug");
    const tenant: Tenant = {
      slug: input.slug,
      displayName: input.displayName,
      status: "Provisioning",
      sqlSchema: input.slug,
      neo4jTenantLabel: `Tenant_${input.slug}`,
      qdrantCollection: `${input.slug}_knowledge`,
      redisPrefix: `${input.slug}:`,
      embeddingModel: input.embeddingModel,
      embeddingDimensions: input.embeddingDimensions,
      steps: [],
      createdAt: new Date("2026-09-08T00:00:00Z"),
    };
    this.rows.set(input.slug, { tenant, steps: [] });
    this.statusHistory.push("Provisioning");
    return tenant;
  }

  async recordStep(slug: string, step: ProvisioningStep): Promise<void> {
    const row = this.rows.get(slug);
    if (!row) throw new Error("unknown tenant");
    const index = row.steps.findIndex((s) => s.store === step.store);
    if (index === -1) row.steps.push(step);
    else row.steps[index] = step;
  }

  async setStatus(slug: string, status: TenantStatus, at: Date): Promise<void> {
    const row = this.rows.get(slug);
    if (!row) throw new Error("unknown tenant");

    // The registry's own guard, mirroring the real implementation. Belt and
    // braces alongside the use case: activation with an incomplete store set is
    // the one unrecoverable mistake.
    if (status === "Active" && !isFullyProvisioned(row.steps)) {
      throw new Error("registry refused activation: not all four steps completed");
    }
    row.tenant = { ...row.tenant, status, ...(status === "Active" ? { activatedAt: at } : {}) };
    this.statusHistory.push(status);
  }
}

class FakeProvisioner implements StoreProvisioner {
  created = false;
  destroyed = false;
  createCalls = 0;
  destroyCalls = 0;

  constructor(
    readonly store: ProvisioningStore,
    private readonly behaviour: {
      failCreate?: boolean;
      failVerifyAfterCreate?: boolean;
      failDestroy?: boolean;
      /** Simulates a store that reports success but leaves the data behind. */
      lingerAfterDestroy?: boolean;
    } = {},
  ) {}

  async create(): Promise<void> {
    this.createCalls++;
    if (this.behaviour.failCreate) throw new Error(`${this.store} create failed`);
    this.created = true;
  }

  async destroy(): Promise<void> {
    this.destroyCalls++;
    if (this.behaviour.failDestroy) throw new Error(`${this.store} destroy failed`);
    if (!this.behaviour.lingerAfterDestroy) this.created = false;
    this.destroyed = true;
  }

  async verify(): Promise<boolean> {
    if (this.behaviour.failVerifyAfterCreate && this.created) return false;
    return this.created;
  }
}

function fixedClock(): Clock {
  return { now: () => new Date("2026-09-08T12:00:00Z") };
}

function fakeAudit(): AuditSink & { entries: unknown[] } {
  const entries: unknown[] = [];
  return {
    entries,
    async record(entry) {
      entries.push(entry);
    },
  };
}

/** A Super Admin actor, for the tests that need someone to have provisioned the tenant. */
const ACTOR: AuditActor = {
  kind: "Principal",
  principal: {
    id: "usr_super_admin",
    tenant: SEWA,
    displayName: "Noura Al Marzooqi",
    roles: ["Super Admin"],
    permissions: new Set(),
    assurance: "L2",
  },
};

function build(overrides: Partial<Record<ProvisioningStore, FakeProvisioner>> = {}) {
  const provisioners = PROVISIONING_STORES.map(
    (store) => overrides[store] ?? new FakeProvisioner(store),
  );
  const registry = new FakeRegistry();
  const audit = fakeAudit();
  const useCase = new ProvisionTenant({
    registry,
    provisioners,
    audit,
    clock: fixedClock(),
  });
  return { useCase, registry, audit, provisioners };
}

const input = {
  slug: SEWA,
  displayName: "Sharjah Electricity, Water & Gas Authority",
  embeddingModel: "text-embedding-3-large",
  embeddingDimensions: 3072,
  actor: ACTOR,
  environment: "development",
};

// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("creates all four isolation units and activates the tenant", async () => {
    const { useCase, provisioners, registry } = build();

    const tenant = await useCase.execute(input);

    expect(tenant.status).toBe("Active");
    expect(provisioners.every((p) => p.created)).toBe(true);
    expect(registry.statusHistory).toEqual(["Provisioning", "Active"]);
  });

  it("creates the stores in a fixed order regardless of injection order", async () => {
    // Creation order determines rollback order, so a caller passing
    // provisioners differently must not silently change it.
    const calls: ProvisioningStore[] = [];
    const provisioners = [...PROVISIONING_STORES].reverse().map((store) => {
      const p = new FakeProvisioner(store);
      const original = p.create.bind(p);
      p.create = async () => {
        calls.push(store);
        return original();
      };
      return p;
    });

    await new ProvisionTenant({
      registry: new FakeRegistry(),
      provisioners,
      audit: fakeAudit(),
      clock: fixedClock(),
    }).execute(input);

    expect(calls).toEqual([...PROVISIONING_STORES]);
  });

  it("records the embedding model and dimension on the tenant", async () => {
    // Changing either invalidates every vector in the collection, and a silent
    // mismatch poisons retrieval rather than failing it (RISK-016).
    const { useCase } = build();
    const tenant = await useCase.execute(input);
    expect(tenant.embeddingModel).toBe("text-embedding-3-large");
    expect(tenant.embeddingDimensions).toBe(3072);
  });

  it("audits the successful provisioning", async () => {
    // Provisioning is one of two sanctioned cross-tenant paths (ADR-0002 rule 5).
    const { useCase, audit } = build();
    await useCase.execute(input);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: "tenant.provision",
        summary: expect.stringContaining("provisioned across all four stores"),
      }),
    ]);
  });
});

describe.each([...PROVISIONING_STORES])("when the %s step fails", (failing) => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build({ [failing]: new FakeProvisioner(failing, { failCreate: true }) });
  });

  it("never activates the tenant", async () => {
    await expect(ctx.useCase.execute(input)).rejects.toThrow(TenantProvisioningError);

    const tenant = await ctx.registry.findBySlug(SEWA);
    expect(tenant?.status).toBe("Failed");
    expect(ctx.registry.statusHistory).not.toContain("Active");
  });

  it("rolls back every store that created something", async () => {
    await expect(ctx.useCase.execute(input)).rejects.toThrow();

    for (const p of ctx.provisioners) {
      if (p.store === failing) continue;
      // Stores created before the failure must be destroyed; stores after it
      // were never reached.
      const createdBeforeFailure =
        PROVISIONING_STORES.indexOf(p.store) < PROVISIONING_STORES.indexOf(failing);
      expect(p.destroyed).toBe(createdBeforeFailure);
      if (createdBeforeFailure) expect(p.created).toBe(false);
    }
  });

  it("leaves no store created", async () => {
    await expect(ctx.useCase.execute(input)).rejects.toThrow();
    expect(ctx.provisioners.every((p) => !p.created)).toBe(true);
  });

  it("audits the failure and names the store", async () => {
    await expect(ctx.useCase.execute(input)).rejects.toThrow();
    expect(ctx.audit.entries).toContainEqual(
      expect.objectContaining({
        action: "tenant.provision",
        summary: expect.stringContaining(failing),
        after: expect.objectContaining({ failedStore: failing }),
      }),
    );
  });
});

describe("post-create verification", () => {
  it("treats an unverifiable store as a failure", async () => {
    // "The statement ran" is not "the isolation unit exists" — especially for
    // Neo4j, where ADR-0009 replaced CREATE DATABASE with label-scoped index
    // creation inside a shared database.
    const { useCase, registry } = build({
      Neo4j: new FakeProvisioner("Neo4j", { failVerifyAfterCreate: true }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(TenantProvisioningError);
    expect((await registry.findBySlug(SEWA))?.status).toBe("Failed");
  });
});

describe("rollback resilience", () => {
  it("continues rolling back other stores when one destroy throws", async () => {
    // Leaving three units behind because the fourth refused would be strictly
    // worse than leaving one.
    const stubborn = new FakeProvisioner("Sql", { failDestroy: true });
    const { useCase, provisioners } = build({
      Sql: stubborn,
      Redis: new FakeProvisioner("Redis", { failCreate: true }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(TenantProvisioningError);

    const neo4j = provisioners.find((p) => p.store === "Neo4j")!;
    const qdrant = provisioners.find((p) => p.store === "Qdrant")!;
    expect(neo4j.destroyed).toBe(true);
    expect(qdrant.destroyed).toBe(true);
    expect(stubborn.destroyCalls).toBe(1);
  });

  it("detects a store that reports success but leaves data behind", async () => {
    // Erasure must be demonstrated, not assumed. Under ADR-0009 the graph path
    // is a filtered delete, so a successful call is not proof the data is gone.
    const lingering = new FakeProvisioner("Neo4j", { lingerAfterDestroy: true });
    const { useCase, audit } = build({
      Neo4j: lingering,
      Redis: new FakeProvisioner("Redis", { failCreate: true }),
    });

    await expect(useCase.execute(input)).rejects.toThrow();

    expect(audit.entries).toContainEqual(
      expect.objectContaining({
        action: "tenant.provision.rollback",
        after: expect.objectContaining({
          uncleaned: expect.arrayContaining([
            expect.objectContaining({ store: "Neo4j", reason: "still present after destroy" }),
          ]),
        }),
      }),
    );
  });

  it("still surfaces the original provisioning error, not the rollback error", async () => {
    // The provisioning failure is the actionable one; rollback residue goes to
    // logs and alerting so it does not mask the cause.
    const { useCase } = build({
      Sql: new FakeProvisioner("Sql", { failDestroy: true }),
      Redis: new FakeProvisioner("Redis", { failCreate: true }),
    });
    await expect(useCase.execute(input)).rejects.toThrow(TenantProvisioningError);
  });
});

describe("guards", () => {
  it("refuses to reuse a slug that is already registered", async () => {
    // Its stores may still hold residue; reusing the slug is how one government
    // entity would inherit another's data.
    const { useCase } = build();
    await useCase.execute(input);
    await expect(useCase.execute(input)).rejects.toThrow(/already registered/);
  });

  it("refuses to reuse a slug left in Failed", async () => {
    const { useCase } = build({ Redis: new FakeProvisioner("Redis", { failCreate: true }) });
    await expect(useCase.execute(input)).rejects.toThrow();
    await expect(useCase.execute(input)).rejects.toThrow(/already registered/);
  });

  it("refuses to start without a provisioner for every store", async () => {
    // Provisioning three of four stores produces exactly the half-provisioned
    // state ADR-0002 rule 6 exists to prevent.
    const useCase = new ProvisionTenant({
      registry: new FakeRegistry(),
      provisioners: [new FakeProvisioner("Sql"), new FakeProvisioner("Redis")],
      audit: fakeAudit(),
      clock: fixedClock(),
    });
    await expect(useCase.execute(input)).rejects.toThrow(/Missing: Neo4j, Qdrant/);
  });

  it("does not register the tenant when a provisioner is missing", async () => {
    const registry = new FakeRegistry();
    const useCase = new ProvisionTenant({
      registry,
      provisioners: [new FakeProvisioner("Sql")],
      audit: fakeAudit(),
      clock: fixedClock(),
    });
    await expect(useCase.execute(input)).rejects.toThrow();
    expect(await registry.findBySlug(SEWA)).toBeNull();
  });
});

describe("post-provision hooks", () => {
  // Proves the fix for the real bug this wave closed: `ProvisionTenant` never created any
  // `Channel` rows because nothing called into `channels` at all. These tests cover the
  // generic hook mechanism (platform depends on nothing, so it cannot import `channels`
  // directly — `channels`' own `provision-default-channels.test.ts` covers the real use
  // case's behaviour).
  function fakeHook(
    name: string,
    behaviour: { fail?: boolean } = {},
  ): TenantProvisionedHook & { calls: string[] } {
    const calls: string[] = [];
    return {
      name,
      calls,
      async onTenantProvisioned(slug) {
        calls.push(slug);
        if (behaviour.fail) throw new Error(`${name} failed`);
      },
    };
  }

  it("runs every hook after the tenant is already Active", async () => {
    const registry = new FakeRegistry();
    const hook = fakeHook("channels.provision-default-channels");
    const useCase = new ProvisionTenant({
      registry,
      provisioners: PROVISIONING_STORES.map((store) => new FakeProvisioner(store)),
      audit: fakeAudit(),
      clock: fixedClock(),
      postProvisionHooks: [hook],
    });

    const tenant = await useCase.execute(input);

    expect(tenant.status).toBe("Active");
    expect(hook.calls).toEqual([SEWA]);
  });

  it("a failing hook does not fail provisioning or roll back the tenant", async () => {
    // Hooks seed convenience default data, not the isolation guarantee the four-store
    // commit already proved — a broken hook must never turn a correctly-provisioned tenant
    // into one that looks failed.
    const registry = new FakeRegistry();
    const failingHook = fakeHook("channels.provision-default-channels", { fail: true });
    const useCase = new ProvisionTenant({
      registry,
      provisioners: PROVISIONING_STORES.map((store) => new FakeProvisioner(store)),
      audit: fakeAudit(),
      clock: fixedClock(),
      postProvisionHooks: [failingHook],
    });

    const tenant = await useCase.execute(input);

    expect(tenant.status).toBe("Active");
    expect((await registry.findBySlug(SEWA))?.status).toBe("Active");
  });

  it("audits a failing hook by name and reason without masking the success entry", async () => {
    const audit = fakeAudit();
    const failingHook = fakeHook("channels.provision-default-channels", { fail: true });
    const useCase = new ProvisionTenant({
      registry: new FakeRegistry(),
      provisioners: PROVISIONING_STORES.map((store) => new FakeProvisioner(store)),
      audit,
      clock: fixedClock(),
      postProvisionHooks: [failingHook],
    });

    await useCase.execute(input);

    expect(audit.entries).toContainEqual(expect.objectContaining({ action: "tenant.provision" }));
    expect(audit.entries).toContainEqual(
      expect.objectContaining({
        action: "tenant.provision.postHookFailed",
        summary: expect.stringContaining("channels.provision-default-channels"),
        after: expect.objectContaining({
          hook: "channels.provision-default-channels",
          reason: "channels.provision-default-channels failed",
        }),
      }),
    );
  });

  it("runs a second hook even when an earlier one fails", async () => {
    const first = fakeHook("first", { fail: true });
    const second = fakeHook("second");
    const useCase = new ProvisionTenant({
      registry: new FakeRegistry(),
      provisioners: PROVISIONING_STORES.map((store) => new FakeProvisioner(store)),
      audit: fakeAudit(),
      clock: fixedClock(),
      postProvisionHooks: [first, second],
    });

    await useCase.execute(input);

    expect(second.calls).toEqual([SEWA]);
  });

  it("with no hooks configured, behaves exactly as before (default empty array)", async () => {
    const { useCase } = build();
    const tenant = await useCase.execute(input);
    expect(tenant.status).toBe("Active");
  });
});

describe("domain invariants", () => {
  const step = (store: ProvisioningStore, status: ProvisioningStep["status"]) => ({
    store,
    status,
  });

  it("isFullyProvisioned requires all four stores completed", () => {
    expect(isFullyProvisioned(PROVISIONING_STORES.map((s) => step(s, "Completed")))).toBe(true);
  });

  it("isFullyProvisioned rejects a missing store", () => {
    // Three completed steps is not "no failures" — it is an incomplete tenant.
    expect(isFullyProvisioned([step("Sql", "Completed"), step("Neo4j", "Completed")])).toBe(false);
  });

  it("isFullyProvisioned rejects a still-pending store", () => {
    const steps = PROVISIONING_STORES.map((s) => step(s, s === "Redis" ? "Pending" : "Completed"));
    expect(isFullyProvisioned(steps)).toBe(false);
  });

  it("isFullyProvisioned rejects duplicate store entries", () => {
    expect(
      isFullyProvisioned([
        step("Sql", "Completed"),
        step("Sql", "Completed"),
        step("Neo4j", "Completed"),
        step("Qdrant", "Completed"),
      ]),
    ).toBe(false);
  });

  it("rollback order is the reverse of creation order", () => {
    const steps = PROVISIONING_STORES.map((s) => step(s, "Completed"));
    expect(stepsRequiringRollback(steps)).toEqual([...PROVISIONING_STORES].reverse());
  });

  it("rollback includes a Failed step, because it may have created something partially", () => {
    // A collection with no payload index, say. Rollback operations are
    // idempotent by contract, so over-rolling-back is safe and under-rolling-back
    // is not.
    const steps = [step("Sql", "Completed"), step("Neo4j", "Failed")];
    expect(stepsRequiringRollback(steps)).toEqual(["Neo4j", "Sql"]);
  });

  it("rollback excludes stores that were never reached", () => {
    const steps = [step("Sql", "Completed"), step("Neo4j", "Pending")];
    expect(stepsRequiringRollback(steps)).toEqual(["Sql"]);
  });
});

describe("registry safety net", () => {
  it("the registry itself refuses activation with incomplete steps", async () => {
    // Independent of the use case's own guard. This invariant's violation is
    // unrecoverable, so it is checked in both places.
    const registry = new FakeRegistry();
    await registry.register({
      slug: SEWA,
      displayName: "SEWA",
      embeddingModel: "text-embedding-3-large",
      embeddingDimensions: 3072,
    });
    await registry.recordStep(SEWA, { store: "Sql", status: "Completed" });

    await expect(registry.setStatus(SEWA, "Active", new Date())).rejects.toThrow(
      /refused activation/,
    );
  });
});

describe("clock", () => {
  it("is injected, so provisioning timestamps are assertable", async () => {
    const now = vi.fn(() => new Date("2026-09-08T12:00:00Z"));
    const { registry } = build();
    const useCase = new ProvisionTenant({
      registry,
      provisioners: PROVISIONING_STORES.map((s) => new FakeProvisioner(s)),
      audit: fakeAudit(),
      clock: { now },
    });
    const tenant = await useCase.execute(input);
    expect(tenant.activatedAt).toEqual(new Date("2026-09-08T12:00:00Z"));
    expect(now).toHaveBeenCalled();
  });
});
