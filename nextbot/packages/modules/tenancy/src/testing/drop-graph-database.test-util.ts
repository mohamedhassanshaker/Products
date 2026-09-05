// Test-only helper. Named `*.test-util.ts` (not `*.test.ts`) so vitest's test-file
// globs never pick it up as a suite of its own.
import { dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";

/**
 * Best-effort cleanup for the real Neo4j database `provisionTenant()`'s Phase 7a
 * hook (`provisionTenantGraphDatabase`) may have created for a test tenant.
 * Swallows every error: the graph store may not be configured in this test
 * environment at all (in which case there is nothing to drop), or the database
 * may already be gone — either way this is test hygiene, not a correctness
 * assertion, so it must never fail a test's cleanup step.
 */
export async function dropFixtureTenantGraphDatabase(tenantId: string): Promise<void> {
  await dropTenantGraphDatabase(tenantId).catch(() => {
    // Intentionally swallowed — see this function's own doc comment.
  });
}
