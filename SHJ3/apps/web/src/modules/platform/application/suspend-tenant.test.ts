import { describe, expect, it } from "vitest";
import type { Tenant, TenantStatus } from "../domain/tenant.js";
import type {
  AuditActor,
  AuditSink,
  Clock,
  TenantRegistry,
  TenantSessionRevoker,
} from "../ports/provisioning.js";
import { assertValidSlugShape } from "../tenancy/tenant-slug.js";
import { SuspendTenant } from "./suspend-tenant.js";

const SEWA = assertValidSlugShape("sewa");

/**
 * Suspension tests.
 *
 * The interesting property: suspension is not a status flip alone. It must also end
 * every live session, and it must refuse to run at all against a tenant that is not
 * currently Active — a second suspend, or a suspend of a Provisioning/Failed tenant,
 * is a caller mistake, not a no-op to swallow silently.
 */

class FakeRegistry implements TenantRegistry {
  rows = new Map<string, Tenant>();

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

  async setStatus(slug: string, status: TenantStatus, at: Date): Promise<void> {
    const existing = this.rows.get(slug);
    if (!existing) throw new Error("unknown tenant");
    this.rows.set(slug, { ...existing, status, activatedAt: existing.activatedAt ?? at });
  }
}

class FakeSessionRevoker implements TenantSessionRevoker {
  calls: string[] = [];
  destroyedCount = 3;

  async destroyAllSessions(tenant: string): Promise<number> {
    this.calls.push(tenant);
    return this.destroyedCount;
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

function harness() {
  const registry = new FakeRegistry();
  const sessionRevoker = new FakeSessionRevoker();
  const audit = fakeAudit();
  const clock = fixedClock();
  const suspend = new SuspendTenant({ registry, sessionRevoker, audit, clock });
  return { registry, sessionRevoker, audit, clock, suspend };
}

describe("SuspendTenant", () => {
  it("flips an Active tenant to Suspended and destroys every live session", async () => {
    const { registry, sessionRevoker, suspend } = harness();
    registry.seed(SEWA, "Active");

    const result = await suspend.execute({ slug: SEWA, actor: ACTOR, environment: "test" });

    expect(result.status).toBe("Suspended");
    expect(sessionRevoker.calls).toEqual([SEWA]);
  });

  it("records an audit entry naming how many sessions were destroyed", async () => {
    const { registry, sessionRevoker, audit, suspend } = harness();
    registry.seed(SEWA, "Active");
    sessionRevoker.destroyedCount = 7;

    await suspend.execute({ slug: SEWA, actor: ACTOR, environment: "test" });

    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: "tenant.suspend",
        after: { status: "Suspended", destroyedSessions: 7 },
      }),
    ]);
  });

  it("refuses an unknown tenant", async () => {
    const { suspend } = harness();
    await expect(
      suspend.execute({ slug: SEWA, actor: ACTOR, environment: "test" }),
    ).rejects.toThrow(/no such tenant is registered/);
  });

  it("refuses a tenant that is not Active", async () => {
    const { registry, suspend } = harness();
    registry.seed(SEWA, "Suspended");

    await expect(
      suspend.execute({ slug: SEWA, actor: ACTOR, environment: "test" }),
    ).rejects.toThrow(/not "Active"/);
  });

  it("does not call the session revoker when the status guard refuses", async () => {
    const { registry, sessionRevoker, suspend } = harness();
    registry.seed(SEWA, "Provisioning");

    await expect(
      suspend.execute({ slug: SEWA, actor: ACTOR, environment: "test" }),
    ).rejects.toThrow();
    expect(sessionRevoker.calls).toEqual([]);
  });
});
