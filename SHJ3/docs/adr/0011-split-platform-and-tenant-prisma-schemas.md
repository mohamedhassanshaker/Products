# ADR-0011 — Split platform and tenant Prisma schemas; drop multiSchema

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Product owner, architecture
- **Supersedes:** [ADR-0010](./0010-raw-sql-for-tenant-runtime-queries.md), written the same day and never implemented. This ADR exists because further investigation, done before ADR-0010's fix was built, found a materially better answer to the same defect.
- **Amends:** [ADR-0005](./0005-prisma-owns-schema-sqlalchemy-reads.md), superseding the amendment ADR-0010 made to it.

## Context

ADR-0010 documents a real, confirmed defect: a `PrismaClient` built per tenant via a `schema=<slug>` connection-string parameter does not scope queries by tenant, because Prisma's `multiSchema` preview feature resolves `@@schema("tenant_template")` to a literal schema name at `prisma generate` time, identically for every client regardless of its connection string. ADR-0010's chosen fix was to stop using the Prisma Client for tenant-scoped runtime queries entirely — hand-built, schema-qualified raw SQL for all ~112 tenant models.

Before that fix was implemented, a follow-up experiment isolated *which part* of the setup was responsible. The suspicion: was the defect "Prisma cannot do connection-string schema routing on SQL Server at all," or specifically "`multiSchema` mode overrides connection-string routing"? These are different claims with very different consequences.

**The experiment, against the same live database:** a minimal, throwaway Prisma schema — one model, no `@@schema()` attribute, no `multiSchema` preview feature — generated into its own client. Two instances built from the same base connection string, differing only in the `schema=` parameter (`probea`, `probeb`), each with its own physical table and distinct seed row.

```
probea client → SELECT [probea].[ProbeRow]... → "I AM PROBE-A DATA"
probeb client → SELECT [probeb].[ProbeRow]... → "I AM PROBE-B DATA"
```

Both reads and a follow-up `upsert` write correctly resolved against the schema each client's connection string named. **The connection-string mechanism works.** The defect ADR-0010 found is specifically that `multiSchema` — the feature this project's single `prisma/schema.prisma` file uses to hold both `platform` and `tenant_template` models — overrides it.

## Options considered

### A. Raw schema-qualified SQL for all tenant-scoped queries (ADR-0010's answer)

Already documented in ADR-0010. Works, costs the Prisma query builder for all ~112 tenant models, indefinitely.

### B. Split into two Prisma schema files, drop `multiSchema` for the tenant side — chosen

`prisma/schema.prisma` becomes two files, two generators, two generated clients:

```
prisma/
├── platform/schema.prisma   → 23 models, single schema "platform", one client, unchanged
└── tenant/schema.prisma     → 112 models, NO @@schema(), NO multiSchema, N clients via schema=<slug>
```

The tenant client is built exactly as originally designed in `tenant-db.ts` — one `PrismaClient` per tenant, differing only in the connection string's `schema` parameter, pooled and cached — because that mechanism is now proven to work once `multiSchema` is out of the way.

- **For:** Full Prisma query builder ergonomics preserved for both model sets. No new infrastructure — same connection, same credential, same pooling approach ADR-0002 already specified. The fix is almost entirely mechanical: split one file into two, remove 112 `@@schema("tenant_template")` annotations, regenerate.
- **Against:** Prisma cannot express a `@relation` across two separate schema files — the generated clients are independent, with independent model graphs. A search of the schema found **10 relation fields across 5 relationships that cross the platform/tenant boundary**: `Environment ↔ VersionDeployment`, `Permission ↔ RolePermission`, `OverridablePolicy ↔ PolicySetting`, `OverridablePolicy ↔ PolicyOverride`, `Locale ↔ LocaleSetting`. Each must become a plain scalar foreign-key field (e.g. `environmentKey String`) rather than a modeled `@relation`, losing Prisma's `include`/nested-write sugar for exactly these five — resolved by an application-layer join (fetch the platform row via `getPlatformDb()`, the tenant rows via the tenant client, combine in code) where a query genuinely needs both sides at once. The underlying SQL Server foreign-key **constraints** for these five relationships are unaffected — they already live in `prisma/sql/001_constraints.sql` as hand-written DDL, not as Prisma-managed keys, so referential integrity at the database level does not change.

### C. Per-tenant SQL logins (ADR-0010's option A)

Still available, still not chosen, for the same reasons ADR-0010 gave: a new operational surface (credential provisioning and rotation per tenant) that deserves deliberate design rather than adoption under time pressure, and no longer necessary now that option B closes the gap option C was meant to close.

## Decision

**Option B.** It preserves ORM ergonomics for 107 of 112 tenant models at a bounded, enumerated cost — five relationships, not the whole schema — and needs no new infrastructure. This is a strictly better outcome than ADR-0010's answer for the same underlying defect, found before ADR-0010 was implemented rather than after, which is why it supersedes rather than amends.

### What changes from ADR-0010's plan

1. **`getTenantDb()` is restored**, not removed — with its original signature and caching design from `tenant-db.ts` and `architecture.md` §5, now built against `prisma/tenant/schema.prisma`'s generated client rather than the single unified schema. The mechanism ADR-0010 believed was fundamentally broken was specifically "`multiSchema` plus connection-string routing"; "connection-string routing alone" is fine.
2. **`prisma/schema.prisma` is split.** `apps/web`'s Prisma-related tooling (`db:generate`, the N-tenant migration orchestrator, the constraint-application scripts) must run against both files where they previously ran against one. The `{{SCHEMA}}` substitution convention in `prisma/sql/001_constraints.sql` and `sql-script.ts` is unaffected — it already operates on raw SQL text, not on which Prisma file a model lives in.
3. **The Prisma → SQLAlchemy generator** (`scripts/generate-python-models.mjs`) reads two schema files instead of one; its output and the drift gate's behaviour are otherwise unchanged.
4. **Five relationships lose Prisma relation modeling**, enumerated above. Each becomes a plain scalar FK field on the tenant-side model, with the underlying DB constraint unaffected. Call sites that need both sides of one of these five relationships in one logical operation perform two queries — one per client — and combine in application code; this is the one place ADR-0010's "no ORM ergonomics" cost still applies, narrowed to five specific relationships instead of the whole tenant schema.
5. **No raw `TenantSqlExecutor` port is built.** ADR-0010's port design is not needed.

## Consequences

### Positive

- Full Prisma ergonomics for the overwhelming majority (107/112) of tenant-scoped data, for the rest of the project — the outcome ADR-0010 explicitly gave up in exchange for avoiding new infrastructure. This achieves both.
- No new operational surface: same credential, same connection pooling shape already specified in ADR-0002.
- The fix is mechanical and low-risk: split a file, remove an attribute from most of it, regenerate. Far less new code than ADR-0010's raw-SQL layer would have needed.
- The defect that motivated both ADRs is closed either way; this route closes it while preserving more of the system's original design intent.

### Negative

- Two Prisma schema files means two `prisma generate` invocations, two migration histories to keep in step (platform migrations and tenant migrations must still be ordered correctly relative to each other — the N-tenant migration orchestrator's "platform first, then tenants" ordering, already established, continues to matter and now spans two files instead of one).
- Five relationships require hand-written application-layer joins wherever both sides are needed together. This needs to be documented plainly for whoever writes the first feature module touching one of the five, so it reads as a deliberate, narrow exception rather than an inconsistency discovered by surprise.
- The generated-row-type / drift-gate work ADR-0010 specified is now unnecessary — full Prisma types are available directly. That planned work is dropped, not merely deferred.

### Follow-up

- `architecture.md` §5 and `data-model.md` §3.5 need updating to describe this mechanism, not ADR-0010's raw-SQL design (which itself replaced an earlier, also-inaccurate description — get this one right and cite the live experiment, so the next reader does not have to rediscover it).
- `data-model.md`'s "Two Prisma schemas, two generated clients" framing (§3.5, written before either the multiSchema implementation or this correction) turns out to have been the right instinct originally; the implementation that shipped diverged from it into `multiSchema`, which is what produced the defect. Worth noting in that section as the reason the document's original framing is now the enforced one, not merely the historical one.
- The five cross-schema relationships should be listed explicitly wherever a developer would reach for `@relation`/`include` and not find one — a comment on each affected scalar field pointing at this ADR is cheaper than a developer re-discovering the constraint mid-feature.
