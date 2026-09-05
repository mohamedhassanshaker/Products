# ADR: Configurable tenant isolation strategies (FR-MT-3)

## Decision

Introduce a `TenantDataAccessStrategy` port
(`src/tenancy/strategies/tenantDataAccessStrategy.ts`), selected once at boot from
`TENANT_ISOLATION_MODE` (`database` | `schema` | `shared`, default `database`), and
consumed by `TenantResolutionMiddleware` instead of calling `TenantConnectionService`
directly.

- `database` and `schema` both bind to `DedicatedDatastoreStrategy`.
- `shared` binds to `SharedSchemaStrategy`, a stub that fails loudly
  (`InternalServerErrorException`) rather than pretending to work.

## Why database and schema collapse to one implementation

The spec (FR-MT-3) describes three isolation levels: database-per-tenant,
schema-per-tenant, and shared-schema (row-level). That distinction comes from Postgres,
where `CREATE SCHEMA` creates a lighter-weight namespace *within* one database,
addressable via `search_path` — meaningfully cheaper to provision and pool than a whole
new database.

MySQL (this project's system-of-record — see PRODUCT_SPECIFICATION.md §7 Constraints)
has no equivalent second concept: `CREATE SCHEMA` is a literal synonym for
`CREATE DATABASE` in MySQL. There is no separate, lighter-weight namespace to target —
a "schema" in MySQL *is* a database. Building a distinct `SchemaPerTenantStrategy` next
to `DedicatedDatastoreStrategy` would therefore mean writing two implementations of
identical behavior, purely to preserve a naming distinction from a different database
engine. Both isolation modes get exactly what `TenantConnectionService` already
provides: a dedicated MySQL database per tenant, connected via a per-tenant connection
string.

## Why shared-schema is stubbed, not built

Row-level tenancy requires a `tenantId` column and a `tenantId` filter on every query
across every tenant-scoped Prisma model — none of which exist today, since every
existing model relies entirely on physical per-database isolation. That's a
cross-cutting change touching most of the codebase (`src/modules/*`), materially larger
in scope than the connection-strategy abstraction itself, and was flagged to the user
rather than folded silently into this phase (see `docs/plans/saas-gaps-plan.md` feature
4's scope note). `SharedSchemaStrategy` exists so the port has a real second
implementation to prove the abstraction (and so a future team can find the extension
point), but selecting it today fails fast with an explicit "not implemented" error.

## Alternatives considered

- **Build a genuine Postgres-style schema strategy anyway, unused for MySQL today** —
  rejected: dead code with no MySQL-reachable behavior difference from the dedicated
  strategy: it would need `search_path`, which MySQL doesn't have.
- **Silently implement `shared` as an alias for `database`** — rejected: a platform
  admin setting `TENANT_ISOLATION_MODE=shared` expecting row-level tenancy would
  instead silently get full per-tenant databases, which is a *stronger* isolation
  guarantee than requested but a confusing, undocumented divergence from the setting's
  name. Failing loudly is safer than a silent behavior mismatch.
