# ADR-0005 — Prisma owns the schema; SQLAlchemy models are generated

- **Status:** Accepted, **partially amended by [ADR-0011](./0011-split-platform-and-tenant-prisma-schemas.md)**
- **Date:** 2026-09-08
- **Deciders:** Product owner (data-layer selection), architecture

> **Amendment (2026-09-08, revised by ADR-0011 the same day).** "Prisma owns the schema" still holds for schema *structure* — DDL, migrations, the `tenant_template` definition — and for platform data, exactly as this ADR describes. The mechanism for tenant-scoped runtime queries changed: Prisma's `multiSchema` `@@schema()` attribute resolves to a literal schema name at generate time, not per connection at runtime, so a *single unified* `schema.prisma` using `multiSchema` for both `platform` and `tenant_template` cannot support "one PrismaClient per tenant via a `schema=` connection parameter" — confirmed directly against a live database. A first fix ([ADR-0010](./0010-raw-sql-for-tenant-runtime-queries.md)) proposed dropping the ORM for tenant queries entirely; a same-day follow-up experiment found the connection-string mechanism itself works fine once `multiSchema` is not fighting it, so [ADR-0011](./0011-split-platform-and-tenant-prisma-schemas.md) instead splits `platform` and `tenant_template` into two separate, non-multiSchema Prisma files — preserving full ORM ergonomics for all but five cross-schema relationships. Read ADR-0011, not ADR-0010, for the mechanism actually in force.

## Context

Two runtimes (ADR-0001) both need SQL Server access:

- `shj3-web` (Next.js) reads and writes all configuration and records via **Prisma**.
- `shj3-ai` (Python) reads agent config, flow definitions, guardrail policies, tool bindings and retrieval settings, and writes conversation turns, orchestration traces and re-index job status, via **SQLAlchemy 2.0**.

Two ORMs pointed at one database raises the obvious question: **who owns the schema?** Both Prisma Migrate and Alembic can generate and apply migrations. If both do, they will eventually disagree, and a schema disagreement in a system with per-tenant schemas (ADR-0002) is a very bad day.

Additional force: ADR-0002 requires **schema-per-tenant**, so migrations are N× and must be orchestrated and resumable. That machinery should exist once, not twice.

## Options considered

### A. Prisma owns the schema; Python models are generated — **chosen**

- **For:** One migration tool, one migration history, one place the N-tenant orchestration lives. Prisma's schema file is a readable single source of truth. Next.js gets generated types directly, which is the main reason Prisma was selected. Drift is detectable mechanically.
- **Against:** Python developers cannot add a column without touching the web repo's schema file. Generated SQLAlchemy models are less idiomatic than hand-written ones.

### B. Alembic owns the schema; Prisma introspects

- **For:** Alembic is more flexible for complex, data-carrying migrations, and the multi-schema orchestration is arguably more natural in Python.
- **Against:** `prisma db pull` then loses the hand-authored relation names and enums that make the generated TypeScript types pleasant, undermining the reason Prisma was chosen. Rejected.

### C. Both own their own tables

Prisma owns config tables, Alembic owns runtime tables (turns, traces, jobs).

- **For:** Each team owns what it writes; clean on paper.
- **Against:** Two migration histories in one database, and foreign keys crossing the boundary (a turn references an agent version) belong to neither. Two tools must then agree on ordering during deploy. This is the corruption scenario this ADR exists to prevent. Rejected.

### D. No shared database; the AI service reads everything over HTTP

- **For:** One writer, one ORM, absolute clarity. Strongest boundary.
- **Against:** The runtime would make several config round-trips per conversation turn, on the latency-critical path. Config is read far more often than it changes, so caching it behind HTTP reinvents a database. Rejected on latency; option A with generated models achieves the same safety without the hop.

## Decision

**Prisma is the sole owner of the SQL Server schema. Alembic is not used in this project.**

1. **`prisma/schema.prisma` is the single source of truth** for tables, columns, indexes, enums and relations.
2. **Migrations run only from `shj3-web`**, through a per-tenant orchestrator that iterates the tenant registry, applies the migration to each schema, records per-tenant status, and is resumable after partial failure.
3. **SQLAlchemy models in `shj3-ai` are generated**, never hand-written, by a `generate-python-models` script driven from the Prisma schema. The generated file carries a "do not edit" header.
4. **Drift is caught in pre-commit.** The hook regenerates the models and fails if the diff is non-empty. Since there is no CI (ADR-0008), this hook is the only enforcement — which makes it mandatory, not advisory.
5. **Write permissions are enforced at the database level, not by convention.** `shj3-ai` connects as a database user with `SELECT` on everything and `INSERT`/`UPDATE` on exactly three table groups:
   - conversation turns
   - orchestration traces
   - re-index job status

   Every other write attempt fails at the database. Code review is not the control; the grant is.
6. **Schema changes originate as a Prisma migration** regardless of which runtime needs them. A Python-driven need still edits `schema.prisma` first.

## Consequences

### Positive

- One migration history, so the schema has exactly one lineage and one truth.
- The N-tenant migration orchestrator is built and tested once.
- Schema drift between the runtimes is mechanically impossible rather than merely discouraged.
- The database-level grant means a coding mistake in the AI service cannot corrupt configuration — a genuine defence rather than a documented intention.
- Next.js keeps the generated Prisma types that motivated the choice.

### Negative

- Python contributors depend on the web repo for schema changes; adding a column is a two-repo change. Mitigated by both runtimes living in one monorepo.
- Generated SQLAlchemy models are less idiomatic and will occasionally need an escape hatch for a complex query. Raw SQL behind a repository port is the sanctioned escape, not a hand-edited model.
- The generation script is now build-critical infrastructure and needs its own test.
- Prisma's SQL Server support has known gaps in areas like computed columns and some index types. Where a feature is unavailable, the migration carries hand-written SQL in the migration file — still owned by Prisma's history.

### Follow-up

- `data-model.md` documents the three table groups the AI service may write.
- `deployment.md` documents the migration runbook, including resuming a partially applied N-tenant migration.
