import neo4j from "neo4j-driver";
import { getAdminDriver } from "./driver.js";
import { GraphStoreUnavailableError } from "./errors.js";

/**
 * Cluster-level connectivity check — deliberately NOT tenant-scoped (it runs
 * against the `system` database via the admin driver, so it needs no
 * `withTenantGraph()` call and no tenant to exist yet). Backs `GraphStorePort.
 * health()` and is also useful standalone for a deploy-time "is Neo4j reachable at
 * all" smoke check (ADR-0018 §2.8's degradation path decides whether to fall back
 * to Vector strategy based on this signal, once Phase 9/10 wires that in).
 */
export async function checkGraphStoreHealth(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const start = Date.now();
  const driver = getAdminDriver();
  const session = driver.session({ database: "system", defaultAccessMode: neo4j.session.READ });
  try {
    // `RETURN 1` is REJECTED against the `system` database ("This Cypher command
    // can only be executed in a user database" — verified against a real Neo4j 5
    // Enterprise instance during this phase's implementation, since `system` only
    // accepts DBMS/administration commands). `SHOW DATABASES` is a legitimate
    // system-database command this package's own provisioning code already relies
    // on, so it doubles as a real connectivity + "the admin credential can still
    // reach the DBMS" check.
    await session.executeRead((tx) => tx.run("SHOW DATABASES"));
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs: Date.now() - start, detail };
  } finally {
    await session.close().catch(() => {
      // Closing a session on an already-broken connection can itself throw; the
      // health result above is what matters, not this cleanup's own outcome.
    });
  }
}

/** Throwing variant for callers (e.g. a startup smoke test) that want a hard
 *  failure rather than an `{ ok: false }` result. */
export async function assertGraphStoreHealthy(): Promise<void> {
  const result = await checkGraphStoreHealth();
  if (!result.ok) {
    throw new GraphStoreUnavailableError(result.detail ?? "health check failed");
  }
}
