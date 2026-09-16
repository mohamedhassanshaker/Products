/**
 * Tenant slug validation.
 *
 * ADR-0002 rule 4: every isolation-unit name — SQL Server schema, Neo4j tenant
 * label, Qdrant collection, Redis key prefix — is *derived* from a slug that has
 * been validated against the tenant registry, and is never interpolated from
 * input.
 *
 * This module is the single choke point for that rule, and it closes two
 * distinct holes at once:
 *
 *  1. **Isolation.** A caller cannot name a tenant that does not exist, so it
 *     cannot address a store unit that is not theirs.
 *  2. **Injection.** Schema names, Cypher labels and collection names all end
 *     up in identifier position, where parameter binding is unavailable. A SQL
 *     Server schema cannot be a bound parameter, and neither can a Neo4j label.
 *     Validating the slug against a strict character class is therefore the only
 *     defence, and it has to happen before the value reaches any query builder.
 *
 * Both properties depend on this being the *only* way a slug becomes a store
 * name, which is why the derivation helpers live here rather than in each
 * adapter.
 */

/**
 * A slug that has passed validation. The brand exists so a plain string cannot
 * be passed where a validated slug is required — the compiler enforces that
 * every store name was derived from a checked value.
 */
export type TenantSlug = string & { readonly __brand: "TenantSlug" };

/**
 * Two to thirty characters: a lowercase letter, then lowercase alphanumerics and
 * underscores. Deliberately narrower than SQL Server, Neo4j and Qdrant each
 * allow, because the intersection of what all four stores accept as an
 * identifier is what actually matters, and because a narrow class is easier to
 * reason about than a permissive one.
 *
 * No hyphens: they are legal in Qdrant collection names but require quoting as a
 * SQL Server schema and as a Neo4j label, and an identifier whose safety depends
 * on remembering to quote it is not safe.
 */
const SLUG_PATTERN = /^[a-z][a-z0-9_]{1,29}$/;

/**
 * Names that must never become a tenant schema. Three groups, all of which
 * would cause real damage rather than a clean error:
 *
 *  - SQL Server's own schemas and system databases — a tenant called `dbo`
 *    would collide with the default schema.
 *  - This project's reserved schemas — `platform` holds the global tables and
 *    `tenant_template` is the DDL template every tenant schema is created from.
 *  - `neo4j`, which is the single Community database name (ADR-0009), so a
 *    label prefix derived from it would read as the database itself.
 */
const RESERVED = new Set([
  "platform",
  "tenant_template",
  "dbo",
  "sys",
  "guest",
  "information_schema",
  "db_owner",
  "db_datareader",
  "db_datawriter",
  "master",
  "model",
  "msdb",
  "tempdb",
  "neo4j",
  "system",
  "admin",
  "public",
]);

export class InvalidTenantSlugError extends Error {
  constructor(
    readonly value: string,
    readonly reason: string,
  ) {
    // The offending value is deliberately not interpolated into the message:
    // this error is raised on untrusted input, and the message reaches logs.
    super(`Invalid tenant slug: ${reason}`);
    this.name = "InvalidTenantSlugError";
  }
}

/**
 * Validate a candidate slug's *shape*. This does not prove the tenant exists —
 * that requires the registry, and is `resolveTenantSlug` in the repository.
 *
 * Shape validation is separate because provisioning needs to validate a slug
 * before the tenant row exists, while every request path needs the registry
 * check as well.
 */
export function assertValidSlugShape(value: unknown): TenantSlug {
  if (typeof value !== "string") {
    throw new InvalidTenantSlugError(String(value), "not a string");
  }
  if (!SLUG_PATTERN.test(value)) {
    throw new InvalidTenantSlugError(
      value,
      "must be 2-30 characters: a lowercase letter followed by lowercase letters, digits or underscores",
    );
  }
  if (RESERVED.has(value)) {
    throw new InvalidTenantSlugError(value, "reserved name");
  }
  return value as TenantSlug;
}

export function isValidSlugShape(value: unknown): value is TenantSlug {
  try {
    assertValidSlugShape(value);
    return true;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Derived store names. These are the ONLY functions permitted to turn a tenant
// into a store identifier. Each takes a validated slug, so there is no code
// path from raw input to an identifier.
// --------------------------------------------------------------------------

/** SQL Server schema holding this tenant's tables (ADR-0002). */
export function sqlSchemaFor(slug: TenantSlug): string {
  return slug;
}

/**
 * Neo4j tenant label (ADR-0009). One shared Community database, so the label is
 * half of the dual encoding — the other half is the `tenant_id` property, and
 * the two must always be written together.
 *
 * `Tenant_` + 30 characters is 37, which is why the registry column is
 * VARCHAR(38).
 */
export function neo4jLabelFor(slug: TenantSlug): string {
  return `Tenant_${slug}`;
}

/** Qdrant collection holding this tenant's chunk embeddings (ADR-0002). */
export function qdrantCollectionFor(slug: TenantSlug): string {
  return `${slug}_knowledge`;
}

/**
 * Redis key prefix (ADR-0002). Returned with the trailing colon so callers
 * cannot accidentally concatenate `sewasession:…` instead of `sewa:session:…`.
 */
export function redisPrefixFor(slug: TenantSlug): string {
  return `${slug}:`;
}
