# ADR-0010 — Raw schema-qualified SQL for tenant-scoped runtime queries

- **Status:** Superseded the same day by [ADR-0011](./0011-split-platform-and-tenant-prisma-schemas.md) — **do not implement this ADR.** Kept for the record: it correctly diagnosed the defect (a unified `multiSchema` Prisma file cannot route tenant queries by connection string) but its chosen fix was not the best available one. A same-day follow-up experiment found the connection-string mechanism itself works once `multiSchema` is out of the way, so ADR-0011 splits the Prisma schema in two instead of abandoning the ORM for tenant data. Read ADR-0011.
- **Date:** 2026-09-08
- **Deciders:** Product owner, architecture
- **Amends:** [ADR-0005](./0005-prisma-owns-schema-sqlalchemy-reads.md) — narrows what "Prisma owns the schema" means at runtime. [ADR-0002](./0002-schema-per-tenant-isolation.md) rule 3 is unaffected in intent; this ADR changes its *mechanism* for one store. **This amendment itself is superseded by ADR-0011.**
- **Related:** [ADR-0009](./0009-logical-graph-partitioning.md) — the second time this project has had to amend a foundational isolation mechanism after the chosen vendor tooling turned out not to support the design as originally assumed, and the second time the amendment was caught by testing against real infrastructure rather than by inspection.

## Context

ADR-0002 requires SQL Server isolation by **schema per tenant**, and `architecture.md` §5 describes the mechanism as: the data-access layer reads the bound tenant from request-scoped context and "produces store handles already scoped to the tenant." For SQL Server, `tenant-db.ts` implemented this as one `PrismaClient` per tenant, constructed with a `schema=<slug>` parameter appended to the SQL Server connection string, cached in a bounded pool.

Building the tenant isolation test suite (testing.md's release gate, run for the first time against the real Docker stack rather than fakes) found that this does not work.

**The finding, confirmed directly against a live database, not inferred:**

```
SELECT SCHEMA_NAME() ... via a client connected with schema=sewa    → dbo
SELECT SCHEMA_NAME() ... via a client connected with schema=customs → dbo
```

The `schema=` parameter has no effect on session context at all — `default_schema_name` for the connecting login is a **login-level property** in SQL Server (`sys.database_principals.default_schema_name`), not a connection-string-settable session property the way PostgreSQL's `search_path` is. That was the first wrong assumption.

The second, and the one that actually matters, was found by inspecting the generated SQL directly:

```
client (schema=sewa)    → SELECT ... FROM [platform].[StaffUsers] ...
client (schema=customs) → SELECT ... FROM [platform].[StaffUsers] ...
```

Identical SQL, regardless of which connection string built the client. **Prisma's `multiSchema` preview feature resolves `@@schema("tenant_template")` to a literal, hardcoded schema name at `prisma generate` time.** It is not a runtime-selectable value. `multiSchema` is designed to let one fixed database expose models split across a small number of *known, fixed* schemas — `public` and `auth`, say — within one generated client. It was never designed to let the *same* model set address *N different, dynamically created* schemas chosen per connection. There is no supported Prisma mechanism for that.

The consequence, had this shipped: every tenant-scoped ORM query — every `client.agent.findMany()` a future feature module would have written — resolves against the literal `tenant_template` schema, identically, regardless of which government entity's data the caller believed it was reading or writing. `tenant_template` is meant to be a DDL source, never a data store. One shared write target for every tenant's application-level CRUD is a complete failure of the isolation guarantee this project's tenancy model rests on.

**This was caught by running the isolation suite against real containers before any feature code depended on it.** No unit test against a fake registry could have found it — the defect is entirely in what a real Prisma client does against a real SQL Server, and the fakes used in `provision-tenant.test.ts` and similar suites correctly implement the *intended* contract of `TenantRegistry`, which is exactly why they could not have caught the intended contract being unimplementable as designed. This is the second time in this project that testing against real infrastructure — rather than trusting a design that looked correct on paper and passed against fakes — found a foundational mechanism could not work as specified (the first was ADR-0009's Neo4j licensing pivot, though that was a vendor *availability* problem rather than a vendor *capability* problem; this one is closer to home).

What is **not** affected: everything that already goes through explicitly schema-qualified raw SQL — `SqlStoreProvisioner`, the constraint scripts, the N-tenant migration orchestrator. All of these build `[{{SCHEMA}}].[Table]` text via `safeSchemaName()` and were proven correct in the same live-infrastructure run that found this defect. `getPlatformDb()` is also unaffected: `platform` is one real, fixed, always-present schema, which is exactly the case `multiSchema` is designed for — the query log confirms `[platform].[StaffUsers]` resolves correctly and identically from any tenant-scoped client, because it is supposed to be identical; platform data is not tenant data.

## Options considered

### A. Per-tenant SQL Server logins with `DEFAULT_SCHEMA`

Provision a SQL login per tenant (`CREATE LOGIN shj3_tenant_sewa ...; ALTER USER ... WITH DEFAULT_SCHEMA = sewa`), connect using tenant-specific credentials, and remove `@@schema()` from tenant models so Prisma emits unqualified SQL that resolves via the connecting login's default schema — a mechanism SQL Server genuinely provides.

- **For:** Preserves full Prisma ORM ergonomics for all ~112 tenant-scoped models, for the entire remaining build. Feature code keeps writing `client.agent.findMany({ where: ... })` rather than hand-built SQL.
- **Against:** A new operational dimension appears: N SQL credentials to provision, store and rotate, one per government entity, on top of the existing per-tenant units in three other stores. Removing `@@schema()` from tenant models likely requires splitting `platform` and tenant models into two separate Prisma schema files / generated clients, since multiSchema's whole purpose is annotating *which* fixed schema a model belongs to — a model with no schema annotation and one with a fixed platform annotation don't obviously coexist in one generator invocation without restructuring. A materially bigger and riskier change to make correctly and securely under time pressure, and it multiplies the credential-management surface RISK-021 already flags for connection pooling.

### B. Raw, schema-qualified query layer for tenant-scoped data — **chosen**

Prisma continues to own the schema *structure* — DDL, migrations, the `tenant_template` definition — which is its stated job under ADR-0005 and is unaffected by this finding. `getPlatformDb()` is unchanged: platform data stays on the typed Prisma client, correctly, because `platform` is genuinely the fixed-schema case multiSchema handles.

For tenant-scoped runtime data, `getTenantDb()` is replaced by a narrower port returning a handle that builds **parameterized, schema-qualified SQL** — `SELECT ... FROM [sewa].[Agents] WHERE ...` — using the same `safeSchemaName()` / validated-`TenantSlug` mechanism `SqlStoreProvisioner` already uses safely today, re-asserted at the point of use per ADR-0002 rule 4. Values are always bound as parameters; only the schema identifier is interpolated, and only after re-validation.

- **For:** No new infrastructure. Works today, against the same single application credential every other part of the system already uses. Directly reuses a pattern already proven correct in this project (`sql-store-provisioner.ts`, `sql-script.ts`) rather than introducing a second, novel mechanism. The failure mode of a mistake here is a SQL error, not a silently-wrong schema — the query text names the schema explicitly, so there is nothing for a stale connection-string parameter to fail to convey.
- **Against:** Feature code loses the typed Prisma query builder for tenant data — the majority of the schema's ~112 models. Every future feature module writes structured SQL (or uses a lightweight typed helper built on top of it) instead of `client.model.findMany()`. This is a genuine, ongoing velocity and ergonomics cost across the rest of the build, not a one-time migration cost.

## Decision

**Option B.** Chosen over A because it is immediately actionable with no new operational surface, and because introducing per-tenant credentials is exactly the kind of infrastructure that deserves to be designed deliberately — with its own threat model, rotation policy and runbook — rather than adopted under the time pressure of unblocking a test suite. If ORM ergonomics prove costly enough in practice to justify that investment, Option A remains available later as a superseding ADR; nothing in Option B forecloses it, since the schema-per-tenant shape of the data itself is unchanged.

### What changes

1. **`getTenantDb()` is removed.** In its place, a `TenantSqlExecutor` (or equivalently named) port: schema-qualified parameterized query and execute methods, constructed from the bound `TenantContext` exactly as `getTenantDb()` was, so callers still cannot reach a store handle without a tenant context (ADR-0002 rule 2 is unaffected — only the *shape* of the returned handle changes, not how or when it is obtained).
2. **`getPlatformDb()` is unchanged.** It returns a real typed `PrismaClient` scoped to `platform`, which is correct today and stays correct.
3. **Row types are still generated, not hand-typed**, consistent with this project's stated aversion to hand-maintained duplicates of a single source of truth (`css.ts`'s naming-derivation comment, the Python model generator). The Prisma schema remains that single source; a lightweight generator produces TypeScript row interfaces for tenant models so the raw-SQL layer is still statically typed at its boundary, even though it is not the Prisma Client.
4. **`SqlStoreProvisioner`, the migration orchestrator and `getPlatformDb()` require no changes.** They already do not depend on the mechanism this ADR removes.
5. **The isolation suite's SQL cases are rewritten** against the new port, and must pass against the real stack before this ADR is considered implemented, not just written.

## Consequences

### Positive

- Closes a defect that would otherwise have mixed every government entity's application data in one schema — found before any feature code existed to be affected by it, which is the best time to find it.
- No new operational surface. No new secrets, no new runbook, no new rotation policy.
- Consistent with a pattern this project has already built, reviewed and proven correct, rather than a second novel mechanism alongside it.
- `platform` data keeps full Prisma ergonomics, which is the smaller and more stable part of the schema (23 of 135 models).

### Negative

- **A real, ongoing cost to every future feature module.** ~112 tenant-scoped models lose the Prisma query builder. This is not a one-time migration; it is how B-2 onward is written for the rest of the project, and it should be scoped into estimates for that work rather than treated as a rounding error.
- The raw query layer is new code with its own correctness burden — SQL injection safety for the *value* side is standard parameter binding, but the schema-qualification logic is security-critical (an error there is the same class of defect this ADR exists to fix) and needs its own thorough test coverage, mirroring `sql-script.ts`'s existing test discipline.
- A second, generated-but-lighter type layer (row interfaces) now exists alongside the full Prisma Client types used for platform data — two different ergonomics in one codebase depending on which kind of data a feature touches. This should be documented plainly for anyone writing a new feature module, so the split reads as a deliberate boundary rather than an inconsistency.

### Follow-up

- Track ORM-ergonomics pain as it accumulates through B-2 onward. If it becomes a real velocity problem, Option A (per-tenant logins) is the documented alternative and this ADR does not need to be re-litigated from scratch to adopt it later.
- The row-type generator belongs alongside `scripts/generate-python-models.mjs` in spirit — same "generate, check in, gate on drift" pattern already established for the Prisma→SQLAlchemy boundary.
- `data-model.md` and `architecture.md` §5's description of `getTenantDb()` need updating to match; they currently describe the mechanism this ADR removes.
