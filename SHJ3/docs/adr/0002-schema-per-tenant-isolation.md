# ADR-0002 — Schema-per-tenant, carried into all four stores

- **Status:** Accepted, **partially amended by [ADR-0009](./0009-logical-graph-partitioning.md)**
- **Date:** 2026-09-08
- **Deciders:** Product owner (tenancy selection), architecture

> **Amendment (2026-09-08).** RISK-003 resolved in the negative: no Neo4j Enterprise licence is available, so **database-per-tenant is not implementable** and the Neo4j row of the isolation table below is superseded by [ADR-0009](./0009-logical-graph-partitioning.md) — single Community database with dual-encoded logical partitioning (tenant label + `tenant_id` property) behind a mandatory query builder. The graph's isolation guarantee becomes a code property rather than an infrastructure one; the standing consequence is **RISK-024**.
>
> **SQL Server, Qdrant and Redis are unaffected.** Rules 1, 2, 4, 5 and 6 below stand for all four stores. Only rule 3's mechanism differs for the graph, and ADR-0009 replaces it with an equivalent-in-intent builder pattern.

## Context

SHJ3 is multi-tenant. A tenant is a **Sharjah government entity** — the wireframe seeds four: SEWA, Sharjah Customs, Sharjah Libraries, and Platform (which has scope over all entities).

Tenancy is not cosmetic in this system. The wireframe makes it load-bearing in several places:

- **B9 tab 2** — teams carry an *entity scope*; `Platform` scopes to "All entities".
- **B2** — agents are owned by an entity (`SEWA & Utilities Billing Agent`, owner SEWA).
- **B6 tab 1** — knowledge sources are owned by an entity and must not ground another entity's answers.
- **B12 tab 2** — policy overrides are per-agent, and therefore effectively per-entity.
- **B14 tab 4** — erasure requests must be honourable, and data residency is per-deployment.
- **Phase E** — per-tenant branding is required, and "a tenant must never see another tenant's branding".

The selected model is **multi-tenant, schema-per-tenant**. This maps cleanly onto SQL Server, which has first-class schema support.

It does **not** map onto the other three stores, because Neo4j and Qdrant have no schema concept and Redis has no namespace concept. A tenancy decision that only covers one of four stores is not a tenancy decision. The isolation strategy for the remaining three had to be settled in the same breath, and was: **Neo4j database-per-tenant, Qdrant collection-per-tenant.**

## Options considered

For the relational store, schema-per-tenant was the selection; the real design work was the other three.

### A. Physical isolation in every store — **chosen**

SQL Server schema per tenant · Neo4j database per tenant · Qdrant collection per tenant · Redis key prefix per tenant.

- **For:** Isolation is a property of the *connection*, not of the query. A session opened against `neo4j://…/sewa` physically cannot traverse Customs' graph, regardless of the Cypher sent. Per-tenant backup, restore, export and erasure become single operations — which is what makes B14's right-to-be-forgotten setting tractable rather than a delete-by-filter job across four stores. Residency can differ per tenant if ever required.
- **Against:** Requires **Neo4j Enterprise** — multi-database is not available in Community edition, so this is a licence commitment. Migrations run N times, once per tenant. Qdrant's own guidance warns that a large number of collections is inefficient, and connection/collection handles must be pooled per tenant.

### B. Physical graph isolation, logical vector isolation

Neo4j database per tenant, but one Qdrant collection with an indexed `tenant_id` payload key and a mandatory filter.

- **For:** This is Qdrant's documented multitenancy best practice and scales to far more tenants. Fewer resources to manage.
- **Against:** Vector isolation becomes a code guarantee rather than an infrastructure guarantee. One missing filter in one retrieval path leaks another entity's source passages into a citizen-facing answer — and retrieval results are exactly what gets quoted back to the user. Inconsistent with schema-per-tenant everywhere else. Rejected on the grounds that the failure mode is a confidentiality breach in a government system, not a bug.

### C. Logical isolation everywhere

Single SQL schema with a tenant column, single Neo4j database with a tenant property, single Qdrant collection with a tenant key.

- **For:** Cheapest to operate, works on Neo4j Community, one migration run.
- **Against:** Contradicts the selected tenancy model. Weakest possible guarantee — every store depends on query-layer discipline. Per-tenant erasure and export become bulk filtered deletes with no way to prove completeness. Rejected.

### D. Database-per-tenant in SQL Server too

- **For:** Strongest isolation of all; per-tenant residency and backup at the relational layer.
- **Against:** Heaviest ops; connection-pool multiplication; overkill for ~10s of government entities unless one contractually demands physical separation. Not selected, but the schema-per-tenant design deliberately keeps this migration path open — see Consequences.

## Decision

**Physical, per-tenant isolation in every store**, with the isolation unit chosen per store:

| Store | Isolation unit | Example |
|---|---|---|
| SQL Server | Schema | `sewa.Agents`, `customs.Agents` |
| Neo4j | Database (Enterprise multi-database) | `neo4j://…/sewa` |
| Qdrant | Collection | `sewa_knowledge` |
| Redis | Key prefix | `sewa:session:{id}` |

### Enforcement rules — non-negotiable

1. **Tenant is resolved from the authenticated principal only.** Never from a header, query string, route param or request body. A caller cannot name their own tenant.
2. **Tenant context is bound to the request scope** — `AsyncLocalStorage` (Node), `contextvars` (Python) — and read by the data-access layer, not passed as an argument through application code.
3. **Unscoped store clients are not exported.** The module surface offers `getTenantDb()`, `getTenantGraph()`, `getTenantVectors()`, `getTenantCache()`. There is no exported `prisma`, `neo4jDriver`, `qdrantClient` or `redis`. An application-layer author has no vocabulary in which to express a cross-tenant query.
4. **Collection and database names are derived**, never interpolated from input. A tenant slug is validated against the tenant registry before it reaches a connection string, which also closes the injection path.
5. **Two audited escape hatches only** — tenant provisioning and cross-tenant analytics rollups. Both live in the `platform` module, both require `Super Admin`, both write to the audit log.
6. **Provisioning is atomic.** Creating a tenant creates the SQL schema, the Neo4j database, the Qdrant collection and the Redis prefix, or it rolls back all four. A half-provisioned tenant is the one state where isolation reasoning breaks down.

### Required test

`tenant-isolation.spec` is a release gate. It proves that a principal scoped to tenant A cannot read, write, retrieve, embed or cache against tenant B, exercised across **all four stores**, and including negative cases where the request payload attempts to forge a tenant identifier. Per the project's testing rule, a requirement with no passing test is incomplete — and this is the requirement that, if wrong, invalidates the others.

## Consequences

### Positive

- Cross-tenant leakage is prevented by infrastructure in three of four stores, not by developer vigilance.
- Right-to-be-forgotten and per-entity export (B14 tab 4) become bounded, provable operations: drop a schema, drop a database, drop a collection, drop a key prefix.
- Per-tenant branding (Phase E) cannot bleed, because tenant theme rows live in the tenant's own schema.
- Noisy-neighbour blast radius is reduced — one tenant's re-index touches one Qdrant collection and one Neo4j database.
- The path to full database-per-tenant (option D) stays open: schemas migrate to databases without touching application code, because everything already goes through scoped handles.

### Negative

- **Neo4j Enterprise licence is now a hard dependency.** This must be confirmed commercially before build; if Community is mandated instead, this ADR must be superseded and the graph falls back to option B's logical partitioning. Tracked as **RISK-003**.
- Migrations are N× — schema migration becomes an orchestrated, resumable job with per-tenant status, not a single `prisma migrate deploy`. Partial-failure handling is required from the first migration, not retrofitted.
- Connection and client pooling must be per-tenant and bounded, or a few dozen tenants exhaust SQL Server connections and Qdrant resources.
- Cross-tenant analytics (the platform-wide metrics in B1 when scoped to `Platform`) require a deliberate rollup path rather than a simple `GROUP BY`.
- Qdrant collection count grows linearly with tenants. Acceptable at government-entity scale (10s); would need revisiting at 1,000+.

### Follow-up

- `data-model.md` must specify which tables are per-tenant and which are platform-global (tenant registry, audit log destination, user accounts).
- Onboarding a tenant needs a runbook entry in `deployment.md`, since it is a four-store operation.
