# ADR-0009 — Logical graph partitioning on Neo4j Community

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Product owner (licence decision), architecture
- **Amends:** [ADR-0002](./0002-schema-per-tenant-isolation.md) — the Neo4j row of its isolation table only. Every other store keeps physical isolation.
- **Related:** [ADR-0003](./0003-polyglot-persistence.md) (Neo4j as a derived store)

## Context

[ADR-0002](./0002-schema-per-tenant-isolation.md) chose physical per-tenant isolation in every store, which for Neo4j meant **database-per-tenant**. That ADR recorded the dependency plainly: multi-database is a Neo4j **Enterprise** feature, absent from Community, and the licence was an unconfirmed commercial decision tracked as **RISK-003**.

RISK-003 has now resolved in the negative: **no Neo4j Enterprise licence is available.** ADR-0002's option A is therefore not implementable, and its own consequences section named the required response — supersede rather than work around in code.

Community edition removes three capabilities this design was leaning on, and it is worth being precise about all three rather than only the one that prompted the change:

| Capability | Enterprise | Community | Consequence here |
|---|---|---|---|
| Multi-database | Yes | **No** — one database, `neo4j` | Isolation must become logical |
| Fine-grained RBAC / roles | Yes | **No** | There is no database-level enforcement to fall back on |
| Clustering / causal cluster | Yes | **No** — single instance | Neo4j becomes a single point of failure |

The second is the one that changes the character of the decision. Under ADR-0002, three of four stores enforced isolation through infrastructure and the fourth (Redis) through a wrapper that made unprefixed keys unreachable. Community offers **neither** a database boundary nor a user-permission boundary for the graph, so the graph guarantee now rests entirely on application code. That is a genuine weakening, and this ADR's job is to state it honestly and then make the code guarantee as close to structural as code can get.

One mitigating fact carries real weight: **Neo4j is a derived store** (ADR-0003 rule 1). It holds no system of record, and it is fully rebuildable from SQL Server plus the original source documents by running re-index — a path that already exists as a product feature in B6. Losing the graph is recoverable; leaking it is not.

## Options considered

### A. Property-based partitioning with a mandatory filter

Single database, every node carries `tenant_id`, every query filtered.

- **For:** Simple, portable, works on Community.
- **Against:** A single omitted `WHERE` clause returns another entity's subgraph — and retrieval output is quoted back to a citizen, so the failure mode is a confidentiality breach with a paper trail. Nothing in the query planner or the schema notices the omission. Rejected on its own; adopted as one half of option C.

### B. Label-per-tenant partitioning

Single database, tenant encoded as a node label (`:Tenant_sewa:Service`).

- **For:** Labels participate in index selection, so a label-scoped query cannot accidentally scan another tenant's nodes even on a full label scan — the isolation rides along with the access path rather than sitting in a predicate that can be dropped. Composite index and constraint scoping become natural.
- **Against:** Labels are part of the query text, so the same omission risk exists; label proliferation with tenant count; a label typo silently matches nothing rather than failing loudly.

### C. Both, behind a query builder that makes unscoped Cypher unwritable — **chosen**

Label **and** property, with all Cypher constructed by a tenant-aware builder inside the adapter, and no raw Cypher permitted anywhere else in the codebase.

- **For:** Two independent encodings of the same fact, so a defect must defeat both to leak. The builder is the structural part: application code has no way to express an unscoped graph query, mirroring the `getTenantDb()` pattern ADR-0002 rule 3 already applies to the other three stores. A static check can then enforce the absence of raw Cypher, which is a mechanical guarantee rather than a review convention.
- **Against:** Still ultimately code, not infrastructure. The builder is now security-critical and needs its own tests. Some legitimate complex traversals will strain a builder and want raw Cypher — that pressure has to be resisted or channelled.

### D. Move the graph into SQL Server

Drop Neo4j; model the graph as relational adjacency with recursive CTEs, inheriting schema-per-tenant isolation for free.

- **For:** Restores physical isolation for graph data. One fewer store to run, secure and back up. No licence question.
- **Against:** ADR-0003 rejected this on capability grounds and those grounds have not changed — B6's mandated Graph RAG needs multi-hop traversal blended with vector similarity at a tunable weighting, and recursive CTEs are slow and unreadable at that depth. Trading the brief's mandated requirement (R6) for an isolation property is the wrong trade when option C can reach an acceptable guarantee. **Reconsider only if the graph turns out to be shallow in practice** — see Follow-up.

## Decision

**Single Neo4j Community database with dual-encoded logical tenant partitioning, enforced by a tenant-aware query builder.**

### Data shape

Every node carries both encodings, and they must agree:

```cypher
(:Tenant_sewa:Service { tenant_id: 'sewa', key: 'pay-utilities-bill', … })
```

- **Label** `:Tenant_<slug>` — scopes the access path and index selection.
- **Property** `tenant_id` — scopes the predicate, and makes constraints composite.
- Every relationship stays **within** one tenant. A cross-tenant edge is invalid by definition; a constraint check asserts none exists.
- Uniqueness constraints become composite on `(tenant_id, key)` rather than `key`, so two entities may both hold a `Provider` called `SEWA` without collision.
- Indexes are created per tenant label at provisioning time.

### Enforcement rules — these replace ADR-0002 rule 3 for the graph store

1. **No raw Cypher outside the graph adapter.** All queries are produced by a tenant-aware builder that reads the request-scoped tenant context (`contextvars`) and emits both the label and the `tenant_id` predicate. Application code cannot express an unscoped query, exactly as it cannot for SQL Server, Qdrant or Redis.
2. **Enforced statically.** A check fails the build if a Cypher string literal — `MATCH`, `MERGE`, `CREATE`, `CALL db.` — appears anywhere outside `adapters/outbound/graph/`. With no CI (ADR-0008) this runs in pre-commit and in `verify`, and it is listed among the standing gates in `testing.md`.
3. **The tenant slug is validated before it reaches a query.** Slugs come from the tenant registry and match `^[a-z][a-z0-9_]{1,30}$`. A label is built from a validated slug, never from interpolated input — closing the Cypher-injection path that label interpolation would otherwise open.
4. **Defence in depth on the way out.** Retrieval results are re-filtered against the request tenant *after* they leave the graph and before they can ground an answer. A leak must therefore defeat the label, the predicate **and** the post-filter. This is the same redundant-filter pattern already applied to Qdrant payloads.
5. **The invariant is asserted on the write path, not only by a sweep.** Every write sets label and property together through the builder, and the builder itself asserts agreement at write time — a node whose label set and `tenant_id` disagree is rejected before it is committed, not discovered later. A periodic reconciliation query then re-asserts the same three invariants across the whole graph (no disagreement, no node with neither encoding, no cross-tenant edge) as a backstop.

   This split is deliberate and was tightened after review. Controls 1–4 are all preventive and act at build or request time; if the reconciliation sweep were the *only* check on encoding agreement, the sole detective control would run on an interval and a leak inside that window would already have been quoted into a citizen transcript before anyone knew. A periodic sweep is an acceptable backstop for drift caused outside the application — a migration, a manual `cypher-shell` session, a restore — but it is not acceptable as the primary guard on a write the application itself performed. Hence both.
6. **Erasure is a filtered delete with a proof.** Tenant de-provisioning runs `MATCH (n:Tenant_<slug>) DETACH DELETE n` in batches, then **proves completeness** by asserting zero nodes match either encoding. Under ADR-0002 this was `DROP DATABASE`, which needed no proof; the proof now replaces the guarantee.

### Availability

Community is single-instance, so the graph has no HA story. Accepted, because ADR-0003 already established Neo4j as derived:

- Graph unavailable → retrieval **degrades to vector-only** from Qdrant, with the degradation recorded and surfaced. Grounding confidence drops accordingly, which correctly makes the refusal and escalation paths more likely rather than serving ungrounded answers. A citizen conversation must never fail because the graph is down.
- Graph lost or corrupted → **rebuild by re-index** (B6), per tenant or wholesale. This is the primary recovery path.
- Backup becomes an **optimisation, not a dependency** — a restore is merely faster than a full re-index. This is a simplification over ADR-0002's position and removes the weekly-full/nightly-incremental burden from the critical path.

### What does not change

Schema-per-tenant in SQL Server, collection-per-tenant in Qdrant and key-prefix in Redis are untouched. ADR-0002's rules 1, 2, 4, 5 and 6 stand for all four stores, including the graph — tenant still resolves from the authenticated principal only, unscoped clients are still unexported, names are still derived and never interpolated, the escape hatches are still audited, and provisioning is still atomic across four stores.

## Consequences

### Positive

- No Enterprise licence cost, and no blocked build.
- Dual encoding plus a mandatory builder plus a post-filter means three independent things must fail together to leak, which is a stronger position than the single mandatory filter that option A would have given.
- The static no-raw-Cypher check is mechanical, so this guarantee does not decay under delivery pressure the way a review convention would.
- Neo4j backup drops out of the critical path, and RISK-017's self-hosted-cluster operational burden disappears with it — Community could not have clustered anyway.
- One fewer store to back up and restore-drill.

### Negative

- **The graph's isolation guarantee is now a code property, not an infrastructure one.** This is the real cost and it should not be softened. Three of four stores are defended by infrastructure; the graph is defended by a builder, a static check and a post-filter. A sufficiently determined defect can still defeat code.
- **No database-level fallback.** Community has no RBAC, so unlike SQL Server — where ADR-0005's grant makes an AI-service write mistake fail at the database — there is no second line for the graph.
- **Data-integrity constraints are lost too, not only isolation ones.** Property-existence constraints are also Enterprise-only, so rules such as "a `Service` must have a name" or "a chunk must cite a source document" cannot be declared in the database at all. They move into the builder plus a reconciliation assertion, which *detects* a violation rather than *preventing* it. This was not visible when the options above were weighed; it is a second concrete face of the same weakness, and it means the licence decision costs integrity guarantees as well as isolation guarantees.
- **Routine node drains now take the graph down platform-wide.** With no cluster there is no PodDisruptionBudget worth setting, so a Kubernetes node drain interrupts graph-grounded retrieval for the duration of the reschedule. This is absorbed by degrading to vector-only, but nothing *gates* a drain — it currently rests on operator convention rather than a control. See Follow-up.
- **Neo4j is a single point of failure** for graph-grounded retrieval. Mitigated by degrading to vector-only, but answers are measurably less well grounded while it is down.
- Composite constraints and per-tenant labels mean provisioning creates index and constraint objects per tenant in one database; object count grows with tenant count and needs watching.
- The isolation test suite grows: the graph cases change from "a connection to database A cannot see database B" — which was true by construction — to explicit per-tenant-property and per-label assertions, plus a negative test per query path. More tests, proving something weaker.
- `docs/data-model.md`, `deployment.md`, `testing.md` and `requirements.md` all need revision, since all four were written against database-per-tenant.

### Follow-up

- **RISK-003 is closed** (resolved: no licence). It is replaced by **RISK-024** — *graph tenant isolation is enforced in application code with no infrastructure or database-level fallback* — which is a standing risk for the life of the system, reviewed at every release, not a decision awaiting an answer.
- The isolation suite must gain a graph section with a negative test **per query path**, not per store. Tracked in `testing.md`.
- Add a reconciliation job asserting label/property agreement and the absence of cross-tenant edges. A drift here is the early warning that precedes a leak. **It is a backstop, not the primary guard** — rule 5 above requires the same invariant on the write path.
- **Gate node drains rather than relying on convention.** A `neo4j-0`-aware preflight in the deploy script, or a scheduled maintenance window for node operations, would turn "drain during working hours and expect a P2" into an actual control. As it stands a routine cluster upgrade can interrupt graph retrieval because an operator forgot.
- **Revisit option D if the graph proves shallow.** If production traversals turn out to be one or two hops — which B6's seeded `Service → Provider → Fee` pattern suggests is plausible — then moving the graph into SQL Server would restore physical isolation at little capability cost, and would be the better design. Worth measuring hop depth in UAT before treating Neo4j as settled.
