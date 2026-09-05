/**
 * Thrown when `withTenant` is invoked without a valid tenant context. This is the
 * fail-closed guard from LLD §3.2 rule 4: there must be no code path that reaches the
 * database with the tenant GUC unset. Guarding here (before a connection is even
 * opened) makes the failure cheap and immediate rather than a raised Postgres error
 * deep in a query — the DB-level raise is the backstop, not the primary mechanism.
 */
export class TenantContextRequiredError extends Error {
  constructor(reason: string) {
    super(`withTenant() requires a valid TenantContext: ${reason}`);
    this.name = "TenantContextRequiredError";
  }
}

/**
 * Thrown when the underlying Postgres session has no `app.current_tenant` GUC set at
 * query time — i.e. the RLS policy's `current_setting('app.current_tenant')` call
 * raised because the setting is missing. Surfacing this as a typed error (rather than
 * letting the raw `pg` driver error propagate) lets calling code and tests assert on
 * the fail-closed behavior by name.
 */
export class TenantIsolationViolationError extends Error {
  constructor(cause: unknown) {
    super(`Tenant isolation guard rejected the query (GUC unset or invalid): ${String(cause)}`);
    this.name = "TenantIsolationViolationError";
    this.cause = cause;
  }
}
