import { describe, expect, it } from "vitest";
import type { Tenant, TenantStatus } from "../domain/tenant.js";
import type { TenantRegistry } from "../ports/provisioning.js";
import { assertValidSlugShape } from "../tenancy/tenant-slug.js";
import { ListTenants } from "./list-tenants.js";

const SEWA = assertValidSlugShape("sewa");
const CUSTOMS = assertValidSlugShape("customs");

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

  async setStatus(): Promise<void> {
    throw new Error("not used by these tests");
  }
}

describe("ListTenants", () => {
  it("returns every tenant regardless of status", async () => {
    const registry = new FakeRegistry();
    registry.seed(SEWA, "Active");
    registry.seed(CUSTOMS, "Suspended");

    const result = await new ListTenants({ registry }).execute();

    expect(result.map((t) => t.slug).sort()).toEqual([CUSTOMS, SEWA].sort());
  });
});
