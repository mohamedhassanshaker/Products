import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { createCollection } from "./application/collection-service.js";

/** ADR-0001 §6 cross-tenant proof for `knowledge_collection` (Target Architecture
 *  Blueprint Phase 7b, BL-38) — the same generic RLS-isolation shape every other
 *  tenant-scoped module's own isolation test already establishes. */
describe("knowledge_collection tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's knowledge_collection (incl. by direct id lookup)", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bCollection = await createCollection(b, {
      name: "B's Collection",
      region: b.region,
      extractionRouteKey: "test.isolation.extract",
      embeddingRouteKey: "test.isolation.embed",
    });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.knowledgeCollection).where(eq(schema.knowledgeCollection.id, bCollection.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });
});
