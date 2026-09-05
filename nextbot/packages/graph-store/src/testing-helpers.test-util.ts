// Test-only helpers shared across this package's own integration/isolation suites.
// Named `*.test-util.ts` (not `*.test.ts`) so vitest's test-file globs never pick it
// up as a suite of its own — it has no `describe`/`it` blocks. Not exported from
// any package entry point; every consumer is a relative import from within this
// same package's test files.
import crypto from "node:crypto";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "./provisioning/tenant-database-provisioner.js";

/** A fresh, valid tenant id for a single test — never reused, so tests can run
 *  concurrently without colliding on the same Neo4j database. */
export function freshTenantId(): string {
  return crypto.randomUUID();
}

/** Provisions a real tenant graph database for a test and returns its id — callers
 *  MUST pair this with `teardownFixtureGraphTenant` (typically in an `afterEach`)
 *  so the ephemeral Neo4j instance doesn't accumulate leftover tenant databases
 *  across a long-lived local `compose.test.yml` container. */
export async function setupFixtureGraphTenant(): Promise<string> {
  const tenantId = freshTenantId();
  await ensureTenantGraphDatabase(tenantId);
  return tenantId;
}

export async function teardownFixtureGraphTenant(tenantId: string): Promise<void> {
  await dropTenantGraphDatabase(tenantId);
}
