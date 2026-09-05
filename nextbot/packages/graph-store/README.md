# @nextbot/graph-store

Target Architecture Blueprint **Phase 7a** (ADR-0018, HLD §15.8, LLD §14.4.1/§14.4.6)
— the graph store's multi-tenant isolation primitive, proven correct in isolation
**before** any knowledge/ingestion pipeline logic is built on top of it (Phase 7b,
a separate later dispatch).

## What this package is

The single implementation of ADR-0018's isolation model: **one Neo4j 5 Enterprise
database per tenant** (`t-<hex(tenantId)>`), reached only by a **service** Neo4j
user that holds `IMPERSONATE` and no data privileges of its own, impersonating a
per-tenant user whose role grants `ACCESS` to exactly that one database — all of
it behind a single primitive, **`withTenantGraph(tenantId, fn)`**, the exact
graph-side analogue of `@nextbot/db`'s `withTenant()`. A cross-database access
attempt is an **authorization error raised by the engine**
(`Neo.ClientError.Security.Forbidden`), never an empty result set from a
forgotten predicate.

- `src/port.ts` — the product-neutral `GraphStorePort` contract (no product name
  appears in this file, per ADR-0018 §2.6/LLD §14.4.6 — the port is what keeps the
  engine replaceable if the Enterprise license ever becomes untenable).
- `src/neo4j-graph-store.ts` — `Neo4jGraphStore`, the Neo4j adapter behind the
  port. Every method opens its session via `withTenantGraph()`/
  `withTenantGraphAutoCommit()` — this class never calls `driver.session()` itself.
- `src/tenant-session.ts` — **`withTenantGraph()`**, the ONE place in this package
  (and, because `neo4j-driver` is dependency-cruiser-restricted to this package —
  `no-neo4j-driver-outside-graph-store` — in the entire codebase) that ever calls
  `driver.session(...)`. Also `withTenantGraphAutoCommit()`, the one deliberate
  exception for `dropGeneration()`'s batched `CALL {...} IN TRANSACTIONS` clause
  (Neo4j's server REJECTS that clause inside an explicit transaction — verified
  against a real instance during this phase's implementation).
- `src/naming.ts` — the identifier-injection guard: strict regexes for tenant
  database/user/role names, the `G_<hex>` generation label, and relationship-type
  strings, validated **before** any of them is interpolated into a Cypher query
  string (Cypher cannot parameterize a label, a relationship type, or a database
  name — the same class of vulnerability SQL string-building has, and the same
  fix).
- `src/errors.ts` — `GraphStoreForbiddenError` (a hard alert — see below),
  `GraphStoreUnavailableError`, `GraphStoreInvalidIdentifierError`,
  `GraphStoreInvalidRequestError`.
- `src/provisioning/tenant-database-provisioner.ts` — `ensureTenantGraphDatabase`/
  `dropTenantGraphDatabase`, the idempotent admin-credentialed primitives that
  create/drop a tenant's database + role + user + grants + schema
  constraints/indexes. Exported separately at `@nextbot/graph-store/provisioning`
  (mirroring `@nextbot/db/platform-only`'s pattern) so a tenant-data-plane caller
  never accidentally reaches for the admin-credentialed path instead of
  `withTenantGraph()`.

## Two credentials, two trust levels

| | Credential | Privileges | Used by |
|---|---|---|---|
| **Admin** | `GRAPH_STORE_ADMIN_USER`/`_CREDENTIAL_REF` | Real DBMS-admin (`CREATE DATABASE`, `CREATE ROLE`, `GRANT`, schema constraint/index management) | `provisioning/` only |
| **Service** | `GRAPH_STORE_SERVICE_USER`/`_CREDENTIAL_REF` | **No data privileges of its own** — only `IMPERSONATE` on the per-tenant users provisioning creates | `withTenantGraph()`/`withTenantGraphAutoCommit()` only, in `tenant-session.ts` |

This is what makes database-per-tenant work with **one connection pool**: without
impersonation, database-per-tenant would mean either a per-tenant credential in
the vault (thousands of secrets) or a service user with access to every database
(application-level scoping again, exactly what ADR-0001 §3 already rejected for
Postgres). With it, the pool is shared, the credential is one, and the engine
still refuses a cross-database read.

## Neo4j edition: Enterprise, not Community — and why this matters for local dev/test

**Community Edition supports exactly one database and no role-based access
control/user impersonation** — verified directly (not assumed) against the real
`neo4j:5-enterprise` container image during this phase's implementation. Since
ADR-0018's entire isolation model is built on multi-database + impersonation,
Community cannot express this security boundary at all — it would leave only the
client-side `WHERE tenantId = ...` predicate approach ADR-0001 §3 already rejected
for Postgres, wearing a different query language. This is why `compose.yaml`
(dev) and `compose.test.yml` (ephemeral test infra) both run `neo4j:5-enterprise`
with `NEO4J_ACCEPT_LICENSE_AGREEMENT=yes` — Neo4j's own standard, documented
mechanism for running the Enterprise image under its evaluation/development
licence terms (ADR-0018 §2.1). **This is not a production license** — a real
deployment needs a purchased Enterprise licence per ADR-0018 §4's disclosed
commercial-license cost.

## Real driver-API corrections found during implementation (documented here since
they correct the ADR/LLD's literal text, not just this file's own code)

- **Database names cannot contain underscore.** Neo4j 5's database-name grammar
  is ASCII letters/digits/dots/dashes only (`CREATE DATABASE t_<hex>` is rejected
  with "Database name ... contains illegal characters"). ADR-0018/LLD §14.4.6's
  literal `t_<tenantId>` naming is corrected to `t-<hex(tenantId)>` (dash, not
  underscore) — user/role names (`u_<hex>`/`role_<hex>`) are unaffected (Neo4j's
  user/role grammar does allow underscore).
- **`dropGeneration()`'s batched delete cannot run inside an explicit
  transaction.** `CALL {...} IN TRANSACTIONS` is rejected by the server with
  `Neo.DatabaseError.Transaction.TransactionStartFailed` when run via
  `session.executeWrite()` — it requires an implicit/auto-commit transaction via
  plain `session.run()`. See `withTenantGraphAutoCommit()`'s own doc comment.
- **`size((n)--())` is deprecated/rejected** on current Neo4j 5.x — replaced with
  `COUNT { (n)--() }` in `degrees()`.
- **Idempotent DDL races under genuine concurrency.** `CREATE ROLE`/`CREATE USER
  ... IF NOT EXISTS` is check-then-act, not atomic, across two truly concurrent
  sessions — verified empirically (20 concurrent `CREATE ROLE` calls for the same
  role produced 19 "already exists" errors alongside the one that won the race).
  `CREATE DATABASE` races the same way with its own distinct error code
  (`Neo.ClientError.Database.ExistingDatabaseFound`), and concurrent `CREATE
  CONSTRAINT`/`CREATE INDEX` against the same database can produce a genuine
  `Neo.TransientError.Transaction.DeadlockDetected`. `tenant-database-
  provisioner.ts`'s `runIdempotentDdl()` helper tolerates the former (treats
  "already satisfied by a race" as success) and retries the latter (via the
  driver's own `neo4j.isRetriableError()` classifier) — required for ADR-0018 §4's
  own "provisioning a tenant now touches two engines... must do so idempotently"
  to actually hold under real concurrent tenant onboarding, not just a
  single-caller happy path.
- **A per-tenant user must be `ACTIVE`, never `SUSPENDED`, to be impersonated** —
  `IMPERSONATE` fails with "Cannot impersonate user ..." against a suspended
  user. `ensureTenantGraphDatabase()` always calls `ALTER USER ... SET STATUS
  ACTIVE` unconditionally (idempotent, harmless if already active).
- **`RETURN 1` is rejected against the `system` database** ("This Cypher command
  can only be executed in a user database") — `checkGraphStoreHealth()` uses
  `SHOW DATABASES` instead, which doubles as a real "the admin credential can
  still reach the DBMS" check.
- **Writing a brand-new dynamic label/relationship-type/property-key requires an
  explicit privilege** beyond `ALL GRAPH PRIVILEGES` — `CREATE NEW NODE LABEL`/
  `CREATE NEW RELATIONSHIP TYPE`/`CREATE NEW PROPERTY NAME` on the database, all
  three granted to the tenant's role (needed because each generation introduces a
  brand-new `:G_<hex>` label the tenant role must be able to create).

## Disclosed scope narrowing (7a vs. 7b)

- `packages/db/src/schema/tenancy.ts`'s `tenantGraphDatabaseRoute` table records
  the tenant → cluster/database routing intent, written and provisioned **eagerly
  at tenant-creation time** (`packages/modules/tenancy`'s `provisionTenant()`) —
  a disclosed, deliberate deviation from ADR-0018 §2.2's "created lazily, on a
  tenant's first knowledge collection build" (there is no ingestion pipeline yet
  to hang that hook off; see that table's own doc comment for the full
  rationale). `provisionTenantGraphDatabase()` is **best-effort and non-fatal to
  tenant creation** — a missing graph-store config or an unreachable Neo4j leaves
  `provisionedAt IS NULL` (ADR-0018 §4's own "repairable by a re-run" signal)
  rather than failing the whole tenant-provisioning call.
- The `(:Entity {generationId, canonicalName})` unique constraint LLD §14.4.6
  names is deferred to Phase 7b — `canonicalName` is an entity-resolution/dedup
  concept from the (not-yet-built) ingestion pipeline, not part of this phase's
  `GraphNodeRecord` port shape (which deliberately carries no name/text field).
  This phase creates the constraints/indexes the current port shape actually
  supports: unique `(:Entity {id})`, an index on `(:Entity {generationId})`, and
  an index on `(:Entity {aclTags})`.
- The in-memory `GraphStorePort` adapter LLD §14.4.6 describes ("ships in
  `packages/testing`") is deliberately NOT built this phase — there is no
  knowledge-module unit test to exercise it yet (Phase 7b's scope). The isolation
  suite below runs against a real Neo4j instance regardless, since an in-memory
  adapter could never prove the isolation property this phase exists to verify.
- `packages/modules/knowledge`'s collections/ingestion pipeline itself (BL-38) is
  explicitly **out of scope** for this phase — see the plan doc's Phase 7
  section.

## Verification

- `src/*.test.ts` — unit tests (naming/config/error-mapping), no real database.
- `src/*.int.test.ts` — integration tests against a real Neo4j (`compose.test.yml`'s
  `neo4j-test` service): full `GraphStorePort` CRUD/traversal/ACL-filtering/
  dropGeneration coverage, provisioning idempotency.
- `src/tenant-session.isolation.test.ts` — **the ADR-0018 §6 adversarial
  cross-tenant isolation suite**, run against the same real instance: tenant A
  reading tenant B's database returns zero rows AND is separately proven to be a
  genuine engine-level `Neo.ClientError.Security.Forbidden` (not merely an empty
  result); an unimpersonated session is fail-closed; a label-injection attempt is
  rejected by regex validation before ever reaching Cypher; re-provisioning is a
  genuine no-op. Treat a failure in this file as a release blocker, in the same
  class as `@nextbot/db`'s own RLS isolation suite (ADR-0018 §6's own words).
