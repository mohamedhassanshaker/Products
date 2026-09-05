import { GraphStoreInvalidIdentifierError } from "./errors.js";

/** Same UUID shape `@nextbot/db`'s `assertValidTenantContext` validates against. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The generation label regex from LLD §14.4.6 verbatim: `G_<32 lowercase hex chars>`.
 * `GraphScope.generationId` IS this label string (it doubles as both the Cypher
 * label interpolated into every query and the `generationId` node/edge property
 * value) — every call site MUST validate a caller-supplied value against this regex
 * BEFORE it is ever interpolated into a Cypher string, because Cypher has no way to
 * parameterize a label (this is the graph-store analogue of a SQL identifier-
 * injection guard).
 */
const GENERATION_LABEL_RE = /^G_[0-9a-f]{32}$/;

/**
 * Neo4j relationship TYPE names have the exact same "cannot be parameterized"
 * property as labels (`-[:TYPE]->` is baked into the query text, never a bind
 * parameter) — LLD §14.4.6 only calls this out explicitly for labels, but the
 * underlying Cypher constraint is identical for relationship types, and
 * `GraphEdgeRecord.relation` is exactly as attacker-reachable (ingestion-pipeline-
 * derived, ultimately model-influenced text) as a generation label. This regex is a
 * disclosed, defense-in-depth addition beyond the LLD's literal text, applying the
 * same fix to the same class of vulnerability. Uppercase-snake-case, Neo4j's own
 * relationship-type naming convention.
 */
const RELATION_TYPE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Neo4j **database names** may contain only ASCII alphanumeric characters, dots, and
 * dashes — NOT underscore — must start with an ASCII letter, and must be 3-63
 * characters (verified directly against a real Neo4j 5 Enterprise instance during
 * this phase's implementation: `CREATE DATABASE t_<hex>` is rejected with "Database
 * name ... contains illegal characters", where ADR-0018/LLD §14.4.6's literal
 * `t_<tenantId>` naming would have failed at the first tenant provisioned). This is
 * a disclosed, necessary correction to the ADR/LLD's literal naming string — the
 * *design* (one database per tenant, named deterministically from the tenant id) is
 * unchanged; only the separator character is `-` instead of `_` to satisfy Neo4j's
 * real constraint. User/role names (`u_<hex>`/`role_<hex>`) are unaffected — Neo4j's
 * user/role name grammar does allow underscore, confirmed the same way.
 */
const DATABASE_NAME_RE = /^[a-z][a-z0-9.-]{2,62}$/;

/** Throws if `tenantId` is not a well-formed UUID. Mirrors `@nextbot/db`'s
 *  `assertValidTenantContext` tenantId check, duplicated rather than imported so
 *  this package never depends on `@nextbot/db` (it must stay usable from anywhere,
 *  including a future non-Postgres composition root, and per ADR-0018 the graph
 *  store's isolation model is independent of Postgres's). */
export function assertValidTenantId(tenantId: string): asserts tenantId is string {
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
    throw new GraphStoreInvalidIdentifierError(`tenantId must be a UUID string, got ${JSON.stringify(tenantId)}`);
  }
}

/** Strips the UUID's dashes, producing the 32-lowercase-hex-char form every
 *  per-tenant identifier (database/user/role name) is derived from. */
export function tenantIdToHex(tenantId: string): string {
  assertValidTenantId(tenantId);
  return tenantId.replace(/-/g, "").toLowerCase();
}

/**
 * Computes and validates the tenant's Neo4j database name. Throws
 * `GraphStoreInvalidIdentifierError` rather than returning an unsafe string if the
 * result would somehow fail Neo4j's own naming grammar (defense in depth — `prefix`
 * is operator-configured, not attacker-reachable, but a misconfigured prefix must
 * fail loudly rather than produce a database name Neo4j silently rejects at a much
 * less obvious call site).
 */
export function tenantDatabaseName(prefix: string, tenantId: string): string {
  const name = `${prefix}-${tenantIdToHex(tenantId)}`;
  if (!DATABASE_NAME_RE.test(name)) {
    throw new GraphStoreInvalidIdentifierError(
      `computed database name '${name}' is not a valid Neo4j database identifier`,
    );
  }
  return name;
}

/** The per-tenant user `withTenantGraph()` impersonates. Never logged into directly
 *  (impersonation bypasses needing its password) — see the provisioner's doc comment. */
export function tenantUserName(tenantId: string): string {
  return `u_${tenantIdToHex(tenantId)}`;
}

/** The per-tenant role granted `ACCESS` to exactly the tenant's own database. */
export function tenantRoleName(tenantId: string): string {
  return `role_${tenantIdToHex(tenantId)}`;
}

/** Validates a generation label/id (`G_<hex>`) before it is interpolated into
 *  Cypher. Every `GraphStorePort` method must call this on `scope.generationId`
 *  before building any query string that embeds it as a label. */
export function assertValidGenerationLabel(generationId: string): asserts generationId is string {
  if (typeof generationId !== "string" || !GENERATION_LABEL_RE.test(generationId)) {
    throw new GraphStoreInvalidIdentifierError(
      `generationId must match ${GENERATION_LABEL_RE} (a 'G_<32 hex chars>' label), got ${JSON.stringify(generationId)}`,
    );
  }
}

/** Validates a relationship type string before it is interpolated into Cypher.
 *  See `RELATION_TYPE_RE`'s doc comment above for why this exists alongside the
 *  label check. */
export function assertValidRelationType(relation: string): asserts relation is string {
  if (typeof relation !== "string" || !RELATION_TYPE_RE.test(relation)) {
    throw new GraphStoreInvalidIdentifierError(
      `relation type must match ${RELATION_TYPE_RE}, got ${JSON.stringify(relation)}`,
    );
  }
}
