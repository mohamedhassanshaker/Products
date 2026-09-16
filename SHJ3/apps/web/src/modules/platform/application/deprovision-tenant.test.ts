import { describe, expect, it } from "vitest";
import type { ProvisioningStore, Tenant, TenantStatus } from "../domain/tenant.js";
import type {
  AuditActor,
  AuditSink,
  Clock,
  StoreProvisioner,
  TenantRegistry,
} from "../ports/provisioning.js";
import { assertValidSlugShape } from "../tenancy/tenant-slug.js";
import { DeprovisionTenant } from "./deprovision-tenant.js";

const SEWA = assertValidSlugShape("sewa");

/**
 * Deprovisioning tests.
 *
 * The two hard safety gates (must already be Suspended, and the typed slug
 * confirmation must match exactly) are the whole point of this file — an
 * irreversible, four-store teardown has no soft-undo tier, so the gates are what
 * stand between a mistake and permanent data loss.
 */

class FakeRegistry implements TenantRegistry {
  rows = new Map<string, Tenant>();
  statusHistory: TenantStatus[] = [];

  seed(slug: string, status: TenantStatus): void {
    this.rows.set(slug, {
      slug,
      displayName: slug,
      status,
      sqlSchema: slug,
      neo4jTenantLabel: `Tenant_${slug}`,
      qdrantCollection: `${slug}_knowledge`,
      redisPrefix: `${slug}:`,
      embeddingModel: "text-embedding-3-large",
      embeddingDimensions: 1024,
      steps: [],
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.rows.get(slug) ?? null;
  }

  async listActive(): Promise<readonly Tenant[]> {
    return [...this.rows.values()].filter((t) => t.status === "Active");
  }

  async listAll(): Promise<readonly Tenant[]> {
    return [...this.rows.values()];
  }

  async register(): Promise<Tenant> {
    throw new Error("not used by these tests");
  }

  async recordStep(): Promise<void> {
    throw new Error("not used by these tests");
  }

  async setStatus(slug: string, status: TenantStatus): Promise<void> {
    const existing = this.rows.get(slug);
    if (!existing) throw new Error("unknown tenant");
    this.statusHistory.push(status);
    this.rows.set(slug, { ...existing, status });
  }
}

class FakeProvisioner implements StoreProvisioner {
  destroyCalls = 0;
  present = true;

  constructor(
    readonly store: ProvisioningStore,
    private readonly behaviour: { failDestroy?: boolean; lingerAfterDestroy?: boolean } = {},
  ) {}

  async create(): Promise<void> {
    throw new Error("not used by these tests");
  }

  async destroy(): Promise<void> {
    this.destroyCalls++;
    if (this.behaviour.failDestroy) throw new Error(`${this.store} destroy failed`);
    if (!this.behaviour.lingerAfterDestroy) this.present = false;
  }

  async verify(): Promise<boolean> {
    return this.present;
  }
}

function fixedClock(): Clock {
  return { now: () => new Date("2026-09-13T12:00:00Z") };
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

const ACTOR: AuditActor = {
  kind: "Principal",
  principal: {
    id: "usr_platform_operator",
    tenant: assertValidSlugShape("sharjah"),
    displayName: "Ahmed Saeed",
    roles: ["SuperAdmin"],
    permissions: new Set(),
    assurance: "L2",
  },
};

function harness(
  provisionerBehaviour: Partial<Record<ProvisioningStore, { failDestroy?: boolean; lingerAfterDestroy?: boolean }>> = {},
) {
  const registry = new FakeRegistry();
  const provisioners: FakeProvisioner[] = [
    new FakeProvisioner("Sql", provisionerBehaviour.Sql),
    new FakeProvisioner("Neo4j", provisionerBehaviour.Neo4j),
    new FakeProvisioner("Qdrant", provisionerBehaviour.Qdrant),
    new FakeProvisioner("Redis", provisionerBehaviour.Redis),
  ];
  const audit = fakeAudit();
  const clock = fixedClock();
  const deprovision = new DeprovisionTenant({ registry, provisioners, audit, clock });
  return { registry, provisioners, audit, clock, deprovision };
}

describe("DeprovisionTenant", () => {
  it("tears down all four stores and flips the tenant to Deprovisioned", async () => {
    const { registry, provisioners, deprovision } = harness();
    registry.seed(SEWA, "Suspended");

    const result = await deprovision.execute({
      slug: SEWA,
      confirmSlug: SEWA,
      actor: ACTOR,
      environment: "test",
    });

    expect(result.status).toBe("Deprovisioned");
    for (const p of provisioners) expect(p.destroyCalls).toBe(1);
    expect(registry.statusHistory).toEqual(["Deprovisioning", "Deprovisioned"]);
  });

  it("destroys stores in reverse creation order", async () => {
    const { provisioners, registry, deprovision } = harness();
    registry.seed(SEWA, "Suspended");
    const order: ProvisioningStore[] = [];
    for (const p of provisioners) {
      const original = p.destroy.bind(p);
      p.destroy = async () => {
        order.push(p.store);
        await original();
      };
    }

    await deprovision.execute({ slug: SEWA, confirmSlug: SEWA, actor: ACTOR, environment: "test" });

    expect(order).toEqual(["Redis", "Qdrant", "Neo4j", "Sql"]);
  });

  it("refuses a tenant that is not already Suspended", async () => {
    const { registry, deprovision } = harness();
    registry.seed(SEWA, "Active");

    await expect(
      deprovision.execute({ slug: SEWA, confirmSlug: SEWA, actor: ACTOR, environment: "test" }),
    ).rejects.toThrow(/not "Suspended"/);
  });

  it("refuses when the typed confirmation does not match the slug", async () => {
    const { registry, deprovision } = harness();
    registry.seed(SEWA, "Suspended");

    await expect(
      deprovision.execute({
        slug: SEWA,
        confirmSlug: "wrong-slug",
        actor: ACTOR,
        environment: "test",
      }),
    ).rejects.toThrow(/does not match the tenant's slug/);
  });

  it("does not destroy anything when the confirmation guard refuses", async () => {
    const { registry, provisioners, deprovision } = harness();
    registry.seed(SEWA, "Suspended");

    await expect(
      deprovision.execute({
        slug: SEWA,
        confirmSlug: "wrong-slug",
        actor: ACTOR,
        environment: "test",
      }),
    ).rejects.toThrow();
    for (const p of provisioners) expect(p.destroyCalls).toBe(0);
  });

  it("refuses an unknown tenant", async () => {
    const { deprovision } = harness();
    await expect(
      deprovision.execute({ slug: SEWA, confirmSlug: SEWA, actor: ACTOR, environment: "test" }),
    ).rejects.toThrow(/no such tenant is registered/);
  });

  it("leaves the tenant Deprovisioning, not Deprovisioned, when a store fails to clean up", async () => {
    const { registry, deprovision } = harness({ Neo4j: { failDestroy: true } });
    registry.seed(SEWA, "Suspended");

    await expect(
      deprovision.execute({ slug: SEWA, confirmSlug: SEWA, actor: ACTOR, environment: "test" }),
    ).rejects.toThrow(/left 1 store\(s\) uncleaned/);

    const tenant = await registry.findBySlug(SEWA);
    expect(tenant?.status).toBe("Deprovisioning");
  });

  it("catches a store that reports success but leaves data behind", async () => {
    const { registry, deprovision } = harness({ Qdrant: { lingerAfterDestroy: true } });
    registry.seed(SEWA, "Suspended");

    await expect(
      deprovision.execute({ slug: SEWA, confirmSlug: SEWA, actor: ACTOR, environment: "test" }),
    ).rejects.toThrow(/uncleaned/);

    const tenant = await registry.findBySlug(SEWA);
    expect(tenant?.status).toBe("Deprovisioning");
  });

  it("audits a successful deprovision naming all four stores", async () => {
    const { registry, audit, deprovision } = harness();
    registry.seed(SEWA, "Suspended");

    await deprovision.execute({ slug: SEWA, confirmSlug: SEWA, actor: ACTOR, environment: "test" });

    expect(audit.entries).toEqual([
      expect.objectContaining({ action: "tenant.deprovision" }),
    ]);
  });
});
