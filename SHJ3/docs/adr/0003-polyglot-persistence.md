# ADR-0003 — Four stores, one role each

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Product owner (store selection), architecture

## Context

The intake selected four data stores: **SQL Server**, **Neo4j**, **Qdrant**, and (via the data-layer question) **Redis**.

Four stores in one system is a significant operational commitment, so each must have a role that the others genuinely cannot fill. The wireframe justifies them:

- **B6 "Knowledge — Graph RAG"** is the brief's mandated requirement (R6). It needs *both* an entity graph — `Service → Provider → Fee`, duplicate detection, merge, traversal — and vector similarity, blended at a configurable **60% graph / 40% vector** weighting with a top-K and a reranker. That is two different retrieval mechanisms over the same corpus.
- **B5 tab 4** requires circuit breakers with trip counts, cooldown windows and state shared across replicas.
- **B10 tab 4** requires an outbound campaign queue with quiet hours.
- Everything else — agents, versions, users, roles, sources, flows, rules, transactions, audit — is relational, transactional configuration and record-keeping.

The risk to manage is not "too many stores" in the abstract; it is **overlapping responsibility**, where the same fact lives in two places and they disagree.

## Options considered

### A. Consolidate onto SQL Server alone

Relational tables, plus a recursive-CTE adjacency model for the graph and a vector column for embeddings.

- **For:** One store, one backup, one connection pool, transactional consistency everywhere.
- **Against:** SQL Server has no first-class vector index (no equivalent of HNSW with tunable ef/M) and no Cypher-like traversal. Multi-hop traversal via recursive CTEs is slow and unreadable at the depth B6's graph explorer implies. The hybrid graph/vector weighting the spec requires would have to be hand-built. Rejected — this fights the mandated Graph RAG requirement.

### B. Consolidate onto PostgreSQL + pgvector + Apache AGE

- **For:** Two extensions, one store; genuinely capable of both roles.
- **Against:** SQL Server was explicitly selected as the relational store. Apache AGE is materially less mature than Neo4j for graph work. Rejected as contrary to the intake decision.

### C. Four stores, strictly non-overlapping roles — **chosen**

## Decision

Four stores, each with **exactly one** responsibility, and a written rule for what may not live in it.

| Store | Role | Must **not** hold |
|---|---|---|
| **SQL Server** | System of record. All configuration, all records, all audit, all tenant metadata. | Embeddings; graph edges; ephemeral session state |
| **Neo4j** | Knowledge graph — entities, relationships, traversal for Graph RAG | Chunk text; embeddings; anything that is not an entity or edge |
| **Qdrant** | Vector index — chunk embeddings + minimal payload for filtering and citation | Authoritative source content; configuration |
| **Redis** | Ephemeral only — chat sessions, circuit-breaker state, rate limits, campaign queue | Anything whose loss is not acceptable — **including payment idempotency keys**, see rule 2 |

### Derived rules

1. **SQL Server is the only system of record.** Neo4j and Qdrant are *derived indexes*. Both must be fully rebuildable from SQL Server plus the original source documents, by running re-index. This is what makes B6's "Re-index all sources now" a real recovery mechanism and not just a refresh button.
2. **Redis is allowed to be lost.** If Redis is flushed, active conversations degrade and breakers reset to closed, but no record is destroyed. Nothing whose loss would matter is stored there. Consequently Redis is not backed up, and that is a decision rather than an oversight.

   **Amended 2026-09-08 (RISK-012).** An earlier draft of this ADR listed *idempotency keys* among Redis's contents, which contradicted this very rule. A payment idempotency key whose loss is acceptable is not an idempotency key: a flush or failover between a gateway call and its callback would let the same payment be initiated twice, and B11 tab 4 records real money. The durable key therefore lives on the SQL Server transaction row, enforced by a unique constraint, and is the sole authority on whether a payment has already been attempted. Redis may still hold a short-lived cache of non-financial request idempotency to shed duplicate work, but it is never the arbiter of whether a side effect has occurred. The general form of the rule: **if losing a key can cause a side effect to repeat, the key is not ephemeral.**
3. **A chunk's authoritative text lives in SQL Server**, with its embedding in Qdrant and its entity links in Neo4j, joined by a shared `chunk_id`. Citations in B6's retrieval playground resolve through SQL Server, so a stale vector payload can never produce a fabricated citation.
4. **No distributed transactions.** Writes are ordered SQL Server first, then derived stores, with an outbox and a reconciliation job. If a derived write fails, the source of truth is still correct and re-index repairs the index. Two-phase commit across four stores is not attempted.
5. **Every store sits behind a port** — `SourceRepository`, `GraphStore`, `VectorStore`, `CacheStore`. No domain or application file imports `neo4j`, `qdrant_client`, `@prisma/client` or `redis`. The swap test in `architecture.md` §4 is the enforcement.

### Ownership by runtime

| Store | Written by | Read by |
|---|---|---|
| SQL Server | `shj3-web` (see ADR-0005) | both |
| Neo4j | `shj3-ai` | `shj3-ai` |
| Qdrant | `shj3-ai` | `shj3-ai` |
| Redis | both | both |

The web tier never opens a graph or vector connection. If a backoffice screen needs graph data — B6's graph explorer does — it calls the AI service's HTTP API. This keeps the derived stores behind a single writer, which is what makes reconciliation tractable.

## Consequences

### Positive

- Each retrieval mechanism the spec requires is served by a store designed for it. The 60/40 hybrid weighting, top-K and reranker in B6 tab 3 are configuration over two purpose-built indexes rather than hand-rolled SQL.
- Because the derived stores are rebuildable, corruption in either is recoverable without data loss — and the recovery path is a feature that already exists in the product.
- Not backing up Redis is safe, which removes an entire class of operational work.
- Non-overlapping roles mean there is exactly one answer to "where does this fact live", which is the failure mode this ADR exists to prevent.

### Negative

- Four stores to run, secure, monitor, upgrade and (for two of them) back up. Combined with ADR-0002's per-tenant isolation, that is four × N isolation units to provision.
- Local development needs all four running. Mitigated by `docker compose up`.
- Eventual consistency between SQL Server and the derived indexes is now a visible product concern: a source can be saved but not yet indexed. The wireframe already models this — B6 tab 1 shows per-source **Indexed %** and *Last crawled*, so the UI must keep surfacing indexing state rather than implying immediacy.
- The outbox and reconciliation job are required infrastructure from the first knowledge feature, not a later addition.
- Neo4j Enterprise licensing (ADR-0002, RISK-003) is part of this commitment.

### Follow-up

- `data-model.md` defines the `chunk_id` contract that joins the three stores, and the outbox table.
- `deployment.md` documents backup scope: SQL Server and Neo4j backed up; Qdrant rebuildable; Redis not backed up.
- Reconciliation lag needs a metric and an alert, surfaced in B14 tab 3 alongside the other service health rows.
