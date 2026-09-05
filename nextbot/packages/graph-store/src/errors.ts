/**
 * Thrown when a tenantId/generationId/relation-type string fails this package's
 * strict validation regex before being interpolated into a Cypher query string.
 * Labels and relationship types cannot be parameterized in Cypher — this is the
 * graph-store analogue of a SQL identifier-injection guard (`naming.ts`).
 */
export class GraphStoreInvalidIdentifierError extends Error {
  constructor(reason: string) {
    super(`@nextbot/graph-store: invalid identifier: ${reason}`);
    this.name = "GraphStoreInvalidIdentifierError";
  }
}

/** Thrown when a request parameter (e.g. `maxHops`/`maxNodes`) falls outside its
 *  validated hard ceiling (FR-KB-06 — enforced in the port, never trusted to a
 *  query author). */
export class GraphStoreInvalidRequestError extends Error {
  constructor(reason: string) {
    super(`@nextbot/graph-store: invalid request: ${reason}`);
    this.name = "GraphStoreInvalidRequestError";
  }
}

/**
 * Thrown when Neo4j rejects an operation as a security/authorization violation
 * (`Neo.ClientError.Security.Forbidden` / `.Unauthorized`). Per ADR-0018 §2.2 and
 * LLD §14.4.6's "Failure mapping" this must NEVER be treated as "no data" — it is a
 * hard signal that something attempted to cross the tenant isolation boundary (a
 * crafted cross-database access, a misconfigured grant, or the provisioning
 * bootstrap itself being wrong) and must alert, not fail silently. Every catch site
 * in this package that sees this Neo4j error code re-throws this type; none of them
 * ever convert it into an empty result.
 */
export class GraphStoreForbiddenError extends Error {
  public readonly neo4jCode?: string;

  constructor(cause: unknown, context: { tenantId?: string; database?: string } = {}) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const code = isNeo4jErrorLike(cause) ? cause.code : undefined;
    super(
      `SECURITY ALERT: Neo4j rejected an operation as a security/authorization violation ` +
        `(tenant isolation boundary signal, never treat as empty) ` +
        `[tenantId=${context.tenantId ?? "unknown"} database=${context.database ?? "unknown"} code=${code ?? "unknown"}]: ${causeMessage}`,
    );
    this.name = "GraphStoreForbiddenError";
    this.neo4jCode = code;
    this.cause = cause;
  }
}

/** Thrown when Neo4j is unreachable/unavailable. Maps to ADR-0018 §2.8's
 *  degradation path (retrieval falls back to Vector strategy) — a Phase 9/10
 *  concern; this phase only defines the typed error that degradation path will
 *  branch on. */
export class GraphStoreUnavailableError extends Error {
  constructor(cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`@nextbot/graph-store: graph store unavailable: ${causeMessage}`);
    this.name = "GraphStoreUnavailableError";
    this.cause = cause;
  }
}

/** Narrow structural check for a `neo4j-driver` `Neo4jError` without importing the
 *  driver's class for an `instanceof` check at every call site (keeps this file
 *  import-light; the actual mapping logic lives in `tenant-session.ts`, the one
 *  place close enough to the driver call to do this safely). */
function isNeo4jErrorLike(err: unknown): err is { code: string; message: string } {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code?: unknown }).code === "string";
}

export { isNeo4jErrorLike };
