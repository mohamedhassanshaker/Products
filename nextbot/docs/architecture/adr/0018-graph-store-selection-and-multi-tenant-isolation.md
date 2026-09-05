# ADR-0018 — Graph store: Neo4j, and its multi-tenant isolation strategy

**Status:** Accepted · 2026-08-28
**Context refs:** FR-KB-02, FR-KB-03, FR-KB-04, FR-KB-05, FR-KB-06, FR-KB-08, FR-SEC-04, FR-SEC-05,
FR-ADM-06, NFR-4, NFR-4a, NFR-6, NFR-12, spec §6.1a (Module B), §9.5 decision 1, Blueprint §7,
HLD §15.8, **ADR-0001** (whose isolation mechanism is Postgres-specific and does **not** extend to
this datastore), ADR-0007, ADR-0011
**Decision owner:** Architecture phase, on the user's explicit 2026-08-28 decision that the graph
store is a **dedicated graph database**, not graph tables plus the existing vector index

## 1. Context

Module B builds a GraphRAG subsystem: entities, typed relations, hierarchical communities, and
per-relation provenance back to the chunk each edge was extracted from — supporting four retrieval
strategies of which two (graph-local multi-hop, graph-global community map-reduce) are traversal
workloads.

The Blueprint left the store open (§14.2 item 1: dedicated graph database, or graph tables plus a
vector index in the existing store). **The user resolved this: a dedicated graph database.** The
logical shapes in spec §6.1a (`graph_entity`, `graph_edge`, `graph_community`) are unchanged; only
the physical store differs.

That decision creates a problem the platform has not had to solve before. **ADR-0001's isolation
model is Postgres-specific.** Row-Level Security, `FORCE ROW LEVEL SECURITY`, the non-owner app role
with no `BYPASSRLS`, and the transaction-local `app.current_tenant` GUC set by one `withTenant()`
primitive — none of that exists in a graph engine. A new datastore holding tenant knowledge content
therefore needs its own isolation design, held to the same standard ADR-0001 set: **the engine
denies by default, not the application**. ADR-0001 §3 explicitly rejected application-level
`WHERE tenant_id = ?` because "it makes every developer, on every query, the last line of defence,
and the failure mode is a silent cross-tenant data leak." A `WHERE n.tenantId = $t` predicate in
Cypher is precisely that rejected design, wearing a different query language.

Constraints the choice must satisfy: self-hostable inside a regional cell (the platform's Postgres/
Redis/ClickHouse stack is all self-hosted, and NFR-6 forbids a managed service outside the cell);
a first-class TypeScript driver (Stack B, TypeScript-only); an isolation mechanism enforced by the
engine; operational maturity appropriate to a datastore holding tenant content; and a license that
is either OSS-commercial-safe or an explicitly budgeted commercial one (guide §5.4).

## 2. Decision

### 2.1 Engine: **Neo4j 5, Enterprise Edition**, one cluster per regional cell

Bolt over the official `neo4j-driver` TypeScript package; Cypher as the query language; deployed as
a cluster inside each regional cell alongside Postgres/Redis/ClickHouse, so residency (NFR-6) is
satisfied by the same construction that satisfies it for every other store — a cell has no network
route to another cell's datastores.

Enterprise Edition specifically, because the two capabilities this ADR's isolation model is built on
— **multiple databases in one DBMS** and **role-based access control with user impersonation** — are
Enterprise-only. Community Edition supports exactly one database and no RBAC, which would leave only
the property-predicate approach ADR-0001 rejected. **This is a budgeted commercial license and is
recorded as such** per guide §5.4: it is the single deviation from this project's otherwise
OSS-only datastore set, and the reason is that the free alternative cannot express the security
boundary.

Development and CI use the Neo4j Enterprise container image under its evaluation/development licence
terms, via Testcontainers — so the isolation suite in §6 exercises the real multi-database and
impersonation behavior, not a single-database approximation.

### 2.2 Isolation: **one Neo4j database per tenant**, reached only by impersonating a per-tenant restricted role

This is the graph-side analogue of ADR-0001, layer by layer:

| ADR-0001 (Postgres) | This ADR (Neo4j) |
|---|---|
| Shared schema, `tenant_id` on every row | **One database per tenant**, `t_<tenant_id>` — the tenant boundary is physical, not a predicate |
| RLS policy on `app.current_tenant`, `FORCE ROW LEVEL SECURITY` | A per-tenant Neo4j **role** granted `ACCESS` to exactly that one database and nothing else; the service user has **no** direct data privileges |
| App connects as a non-owner role with no `BYPASSRLS` | The application connects as a service user holding only `IMPERSONATE` on the per-tenant users — it cannot read tenant data as itself |
| `withTenant(tenantId, fn)` sets `SET LOCAL app.current_tenant` — the single primitive | **`withTenantGraph(tenantId, fn)`** opens a session with `{ database: 't_<id>', impersonatedUser: 'u_<id>' }` — the single primitive; no other code obtains a session |
| ESLint rule + code-owner gate on `packages/db` bans raw pool access | The same shape: `neo4j-driver` is importable **only** from `packages/graph-store` (a new dependency-cruiser rule beside the existing `no-provider-sdk-outside-ai-registry`), and raw `driver.session()` outside `withTenantGraph()` is lint-banned |
| Enterprise plan tier routes to a dedicated database | A `tenant → graph cluster + database` routing row, mirroring ADR-0001 §5's connection-routing table; `plan_tier = Enterprise` routes to a dedicated Neo4j instance |
| Cross-tenant isolation suite in CI (§6) | The same suite, extended (§6 below) |

Impersonation is what makes this work with **one connection pool**: without it, database-per-tenant
would mean either a per-tenant credential in the vault (thousands of secrets) or a service user with
access to every database (application-level scoping again). With it, the pool is shared, the
credential is one, and the engine still refuses a cross-database read — attempting to touch another
tenant's database while impersonating `u_<id>` is an authorization error from Neo4j, not an empty
result set from a forgotten predicate.

**Databases are created lazily**, on a tenant's first knowledge collection build, and dropped when
its last collection is deleted — so tenants that never use Module B cost nothing. A per-cluster
database budget (operationally capped, initially ~300 per cluster) is enforced by the routing table:
when a cluster reaches its budget, the next tenant is allocated to the next cluster in the cell.
Adding a cluster is a capacity operation, not a re-architecture, for the same reason adding a cell
is.

### 2.3 Generation scoping is a predicate, and that is a deliberate distinction

Multiple `knowledge_index_generation`s coexist inside one tenant database (an old generation stays
queryable while a new one builds, FR-KB-03). Generation scoping is enforced as a **mandatory
`generationId` property plus a per-generation label, with a required index** — a query predicate,
not a database boundary.

The distinction is intentional and worth stating: **the tenant boundary is a security boundary and
gets engine enforcement; the generation boundary is a correctness boundary and gets a predicate plus
a test.** Mixing two tenants is a breach; mixing two generations is a bug (mixed vector spaces in one
ranking pass, which FR-KB-03 forbids). They warrant different mechanisms. A single
`GraphStore` API surface that requires `generationId` on every call, with no overload that omits it,
is what keeps the bug class closed.

### 2.4 What lives where — the graph store holds the graph, and only the graph

| Data | Store | Why |
|---|---|---|
| `knowledge_collection`, `knowledge_source`, `knowledge_index_generation`, `knowledge_chunk` (text, ACL, PII mask), `retrieval_event` | **Postgres** (RLS, ADR-0001) | Relational, tenant-scoped, subject to retention/DSR; unchanged isolation story |
| Chunk embeddings | **Postgres + pgvector** | HLD §9 already chose pgvector to avoid a separate vector database; nothing here changes that. Vector recall stays where it is |
| `graph_entity`, `graph_edge`, `graph_community` — **structure and ids only** | **Neo4j** | Multi-hop traversal and community structure are the access pattern the dedicated engine exists for |
| Entity/community **summary text** | **Postgres** | Clarified 2026-08-28 during the HLD/LLD reconciliation pass, to agree with the paragraph immediately below (nodes and edges carry only `generationId`, `aclTags`, the PII marker and `provenanceChunkId`; "everything else is fetched from Postgres by id") and with LLD §14.4.1. The graph store holds no tenant text, so a graph-store compromise leaks *structure*, not content — the deliberate risk reduction §2.4's own port acceptance list (LLD §14.4.6 item 6) asked this ADR to record. §2.7's treatment of summaries as tenant content is unchanged and applies to them in Postgres |
| Entity/community summary **embeddings** | **Postgres + pgvector** | Keeps one vector index, one similarity implementation, one dimension-pinning story (FR-KB-03) |

Graph nodes and edges carry the minimum needed to be self-sufficient for traversal-time filtering:
`generationId`, `aclTags` (a denormalized projection of the source's `acl_json`), a PII-masking
marker, and `provenanceChunkId` on every edge (FR-KB-04's traceability requirement). Everything else
is fetched from Postgres by id.

**ACL filtering happens inside the traversal, before ranking** — `aclTags` on the node/edge is what
makes FR-KB-08's "a chunk the caller may not see must never influence the ranking of chunks it may
see" true for graph strategies, not just vector ones. Postgres re-filters on the chunk fetch. This
is the same "decide at selection, enforce at egress" defense-in-depth pattern the tool path already
uses (HLD §5).

### 2.5 Community detection runs in the pipeline, not in the database

Hierarchical community detection (Leiden or equivalent) runs in the ingestion worker over a
projected subgraph, writing `community_id` back to the nodes — **not** via Neo4j's Graph Data
Science library. That keeps the graph store a store, avoids a second separately-licensed component,
and keeps the clustering implementation swappable and unit-testable without a database. Incremental
re-summarization on membership change (FR-KB-02) is a pipeline stage, not a database feature.

### 2.6 The store sits behind a port

`packages/graph-store` exposes a `GraphStore` port (upsert entities/edges, traverse from anchors
with a hop cap, fetch community subtree, provenance lookup) with a Neo4j adapter behind it —
the same pattern as `GraphRuntime` (ADR-0003) and for the same reason (NFR-12). The port is not
decorative: it is what makes §3's rejected alternatives re-choosable if this one disappoints, and it
is where `maxHops` is enforced as a hard ceiling (FR-KB-06) rather than trusted to a query author.

### 2.7 Access paths and residency

`apps/ingest` writes (the pipeline), `apps/runtime` reads (retrieval at turn time), `apps/web` reads
(the Graph Explorer, FR-KB-04). `apps/gateway` does **not** connect: the graph store is an in-cell
datastore like Postgres, not third-party egress, so ADR-0004's choke point is untouched. Embedding
and extraction model calls made *during* ingestion are ordinary model calls and do go through the
Model Gateway (ADR-0011/ADR-0006), which is where the residency and data-locality controls for them
already live.

Entity and community **summaries are model-generated text derived from tenant content and must be
treated as tenant content**: PII detection runs at ingestion and masking is applied at index time
per the collection's trust level, then re-evaluated at read time against the requesting agent's
trust level (FR-KB-08). Retention and DSR purge cascade into the graph — deleting a source removes
its chunks, removes extracted entities with no other provenance, and triggers community
re-summarization for affected communities.

### 2.8 Disaster recovery: the graph is derived data

Neo4j Enterprise online per-database backup runs on the cell's normal backup schedule. But the
governing posture is that **the graph is fully rebuildable** from Postgres (collections, sources,
chunks) by re-running the pipeline. That materially lowers the criticality of graph-store durability
relative to Postgres, and it is the reason a graph-store outage degrades retrieval to Vector
strategy rather than failing the turn — which must be an explicit, traced degradation, not a silent
one, and must respect `refuseWhenUngrounded` (FR-KB-06) rather than answering ungrounded.

## 3. Alternatives considered

**Graph tables in Postgres + pgvector (the Blueprint's simpler option; and Apache AGE as its
extension form).** Not evaluated on merits — **excluded by explicit user decision** (spec §9.5
item 1). Recorded here because the guide requires deviations and directions to be attributable: the
simpler-operationally option was available and was not chosen.

**Memgraph.** Genuinely attractive: Cypher/Bolt-compatible (so the driver and query language story
matches Neo4j), fast, actively developed. Rejected on two grounds. Its multi-tenancy (multiple
databases) and RBAC are **Enterprise-gated too**, so it does not avoid the licensing cost that is
the main objection to Neo4j; and its in-memory-first storage model makes the RAM cost of holding
hundreds of tenant graphs resident a materially worse operational profile than Neo4j's page-cache
model for a workload where most tenant graphs are cold most of the time.

**FalkorDB.** The most interesting rejection. Its sparse-matrix design makes many-graphs-per-instance
cheap — arguably the best fit for "one graph per tenant" at scale, and it is explicitly marketed at
GraphRAG. Rejected for this build on maturity and license: it is young relative to the datastore
tier it would join, its per-graph access control is thinner than Neo4j role/impersonation, and SSPL
adds a licensing review this project does not otherwise need. The §2.6 port exists partly so this
can be revisited if Neo4j's per-database overhead becomes the binding constraint.

**NebulaGraph.** Apache-2.0 (the only strong-multi-tenancy candidate that avoids a commercial
license), with graph spaces and space-level RBAC that map cleanly onto space-per-tenant, and real
large-scale production use. Rejected on stack fit: nGQL rather than full Cypher, a three-service
deployment topology (metad/graphd/storaged) that meaningfully raises per-cell operational cost, and
a community-maintained Node.js driver — a poor bet for the one datastore in the system whose driver
sits on the retrieval hot path in a TypeScript-only stack. This is the alternative to revisit first
if the Enterprise license becomes untenable.

**ArangoDB.** Database-per-tenant is native and its multi-model story would let chunks and graph
share a store. Rejected: the 2024 BSL relicensing and Community-distribution changes make its
long-term licensing posture harder to plan against than a straightforwardly-purchased commercial
license, and its traversal ergonomics for this workload are weaker than Cypher's.

**Amazon Neptune (or any managed graph service).** Rejected outright: managed-only conflicts with
the platform's self-hosted regional-cell model and with tenants who require on-prem/sovereign
deployment.

**Database-per-*collection* rather than per-tenant.** Rejected: it multiplies databases by an
unbounded per-tenant factor for no additional security (a tenant's collections are not mutually
untrusted) and would hit the per-cluster database budget far sooner.

**Shared database with a `tenantId` property predicate (Neo4j Community).** Rejected — this is
ADR-0001 §3's rejected application-level isolation, and adopting it here would mean the platform's
weakest isolation boundary is the newest datastore holding the most model-derived, hardest-to-audit
content.

## 4. Consequences

**Positive.** Tenant isolation in the graph store is *stronger* than in Postgres (physically separate
databases rather than a policy predicate), which is a defensible answer to the obvious enterprise
question "you added a new datastore — how is my data separated in it?" One connection pool, one
credential, one primitive, one lint rule, and a test suite that mirrors an existing one the team
already trusts. Multi-hop traversal and community queries are expressed in the language designed for
them. The port keeps the engine replaceable.

**Negative / accepted costs.**

- **A commercial license.** The clearest cost, and the one to re-examine annually against
  NebulaGraph and FalkorDB. It buys the security boundary; a free edition would not.
- **A new stateful component per cell** — backup, upgrade, monitoring, capacity, and a database-count
  budget with a routing table to manage it. Partially offset by §2.8: the graph is derived data, so
  its restore path is "re-run the pipeline", not "or the data is gone."
- **Two stores in one retrieval path.** Hybrid retrieval touches Neo4j (traversal) and Postgres
  (chunks + vectors) in one turn, so latency is the sum and there is no single-store transaction
  across them. Accepted: the graph is derived and idempotently rebuildable, so eventual consistency
  between the two is repairable by re-running a generation; the LLD must define the reconciliation
  for a pipeline that fails between the Postgres write and the graph write.
- **Per-database overhead** puts a real ceiling on tenants per cluster. Handled by the routing table
  and lazy creation, but it is a capacity dimension the operator console must surface (NFR-11).
- **Provisioning a tenant now touches two engines.** The tenancy module must create/drop the Neo4j
  database, role, and user alongside the Postgres rows, and must do so idempotently — a
  half-provisioned tenant that has a Postgres row and no graph database must be repairable by a
  re-run, not by hand.

## 5. Consequences for the LLD

- The `GraphStore` port surface, the Neo4j adapter, and the `withTenantGraph()` primitive (including
  its session/transaction and retry semantics).
- Node/edge/community label and property model, required indexes and constraints (unique
  `(generationId, canonicalName)` on entities; index on `generationId`, on `aclTags`, and on the
  traversal-relevant relation types).
- The `tenant → graph cluster + database` routing table, and the lazy create/drop lifecycle in the
  tenancy module (idempotent, with a repair path).
- The Neo4j role/user provisioning statements and the exact privilege set (`ACCESS` on one database;
  `IMPERSONATE` on the service user; **no** `BYPASS` equivalent anywhere).
- The Postgres↔Neo4j reconciliation for a partially-failed generation build, and the generation
  cutover/invalidation sequence for FR-KB-03.
- The retrieval query shapes for graph-local and graph-global, with `maxHops`/`maxExpansions`/budget
  ceilings enforced in the port.
- The retention/DSR cascade into the graph, and the degradation path when the graph store is
  unavailable.

## 6. Verification (this ADR is only real if it is tested)

A graph-store isolation suite in CI, run against a Testcontainers Neo4j Enterprise instance seeded
with two tenants — deliberately modelled on ADR-0001 §6 so the two read as one guarantee:

1. Reading under tenant A's impersonated session returns zero of tenant B's entities, edges, and
   communities.
2. Explicitly targeting tenant B's database while impersonating tenant A's user raises an
   **authorization error** from the engine — not an empty result — proving the boundary is enforced
   by Neo4j rather than by a predicate.
3. A session opened **outside** `withTenantGraph()` (service user, no impersonation) can read no
   tenant data at all: fail-closed, not fail-open.
4. A newly provisioned tenant gets its database, role, and user; re-running provisioning is a no-op;
   deleting the last collection drops them.
5. Generation scoping: a query omitting `generationId` is impossible through the port's type
   signature, and a mixed-generation ranking pass is rejected (FR-KB-03).
6. ACL: a caller lacking an `aclTag` neither receives nor *influences the ranking of* chunks it may
   not see — asserted by comparing rankings with and without the restricted content present
   (FR-KB-08).
7. Residency: a network-policy test asserting the graph cluster is reachable only from within its own
   cell, matching the existing cross-cell datastore assertion (HLD §7.4).
8. Degradation: with the graph store down, retrieval falls back to Vector strategy, the degradation
   is traced, and `refuseWhenUngrounded` still refuses rather than answering ungrounded.

`nexus-qa` should treat a failure in tests 1–3 as a release blocker, in the same class as ADR-0001's
cross-tenant suite.
