# ADR-0001 — Multi-tenant isolation: shared schema + PostgreSQL Row-Level Security

**Status:** Accepted · 2026-08-15
**Context refs:** NFR-4, NFR-6, NFR-3, NFR-11, FR-SEC-02, FR-SEC-05, FR-AGT-10, spec §9.1/§9.4-3
**Decision owner:** Architecture phase (explicitly deferred here by the specification)

## 1. Context

The specification leaves the isolation mechanism open and names three candidates: schema-per-tenant,
row-level security with a shared schema, and per-tier logical databases. NFR-4 requires isolation of
four distinct things, which are often conflated and must be decided separately:

1. **Data** — no tenant can read another's rows.
2. **Credentials** — a data-layer compromise must not yield another tenant's backend secrets.
3. **Agent-run execution load** — one tenant cannot starve another (concurrent-run quotas,
   tokens/min, tool-egress allowlists per FR-AGT-10).
4. **Residency** — a tenant's data must not leave its configured region (NFR-6/FR-SEC-05).

Expected shape: many tenants (SaaS self-serve through enterprise), a wide schema (~25 core entities
plus analytics), frequent schema migrations across a 5-phase build, and a hard requirement for
operator-observable per-tenant quotas.

## 2. Decision

**A four-layer isolation model:**

| Layer | Mechanism |
|---|---|
| Data | **Shared schema, one row set, `tenant_id NOT NULL` on every tenant-scoped table, PostgreSQL Row-Level Security with `ENABLE` + `FORCE ROW LEVEL SECURITY`.** Policies compare `tenant_id` to the transaction-local GUC `app.current_tenant`. The application connects as a **non-owner, non-superuser** role that has no `BYPASSRLS`. |
| Credentials | Not protected by RLS alone. Ciphertext lives in a separate `vault` schema whose tables are granted **only** to the Gateway Plane's database role; each tenant has its own KMS-wrapped data encryption key, so reading another tenant's ciphertext yields nothing (ADR-0007). |
| Execution | Per-tenant concurrent-run quota, tokens/minute cap, tool-call rate cap and tool-egress allowlist enforced in Redis counters at the Data and Gateway planes; the run queue claims work with weighted fairness so a single tenant's backlog cannot monopolise the worker fleet. |
| Residency | Physical: one full stack ("cell") per region; a tenant exists in exactly one cell. Cells have no network route to each other's datastores. |

**Tenant context is established exactly one way.** A single `withTenant(tenantId, fn)` primitive
opens a transaction and issues `SET LOCAL app.current_tenant = $1` before any statement. No
application code obtains a connection any other way; an ESLint rule and a code-owner review gate on
`packages/db` enforce that. Transaction-local (not session-local) GUCs are used so the setting cannot
leak across a pooled connection.

**Escape hatch, same schema.** An enterprise tenant that contractually requires physical separation
is moved to a **dedicated database running the identical schema and the identical migration set**,
selected by a connection-routing lookup on `tenant_id`. This is a deployment/routing change, not a
code change, because the application already scopes every query by `tenant_id` — RLS simply becomes
redundant rather than load-bearing for that tenant.

### 2a. Amendment (2026-08-15) — Enterprise plan tier makes the escape hatch concrete

NFR-4a (spec §9.2) subsequently formalized three tenant plan tiers — Starter, Growth,
Enterprise — each fixing default runtime-quota values. This makes the previously
abstract "an enterprise tenant that contractually requires physical separation" trigger
concrete: **`tenant.plan_tier = Enterprise` is what invokes this section's escape
hatch.** Provisioning (BL-01) routes an Enterprise tenant's connection-routing row (§5)
to a dedicated database at creation time, in the same step that seeds its
`tenant_runtime_quota` defaults from the Enterprise tier row (LLD §3.10). Starter and
Growth tenants stay on the shared-schema/RLS path described above; only `plan_tier`
determines which path a tenant is on, and a tenant is not moved between them by tuning
its individual quota values. See LLD §3.3/§3.10 for the field-level detail.

## 3. Alternatives considered

**Schema-per-tenant.** Rejected. Migrations fan out linearly with tenant count and become the
dominant operational risk across a 5-phase build that will ship dozens of migrations; connection
pooling degrades (search_path churn or pool-per-schema); `pg_catalog` bloat and planner overhead grow
with thousands of schemas; cross-tenant platform-operator queries (NFR-11 capacity dashboards)
require iterating every schema. It buys a stronger *default* than RLS but pays for it in exactly the
dimension this product is weakest in — migration velocity.

**Database-per-tenant for everyone.** Rejected as the default for the same migration reasons plus
per-database connection and memory overhead at self-serve tenant counts. Retained as the enterprise
escape hatch (§2), which captures its benefit where it is actually paid for.

**Application-level `WHERE tenant_id = ?` only, no RLS.** Rejected. It makes every developer, on
every query, the last line of defence, and the failure mode is a silent cross-tenant data leak — the
single worst outcome for a platform whose value proposition is enterprise trust. RLS makes the
default deny rather than the default leak.

**Per-tier logical database (shared DB per plan tier).** Rejected: gives most of database-per-tenant's
migration cost with none of its contractual clarity, and blast radius is still multi-tenant.

## 4. Consequences

**Positive.** One migration set. One connection pool. Cross-tenant operator analytics are a plain
query. Deny-by-default at the engine, not in application code. Enterprise physical separation stays
available without a rewrite.

**Negative / accepted costs.**

- Every query runs inside a transaction to carry the GUC. Measured cost is small but non-zero; the
  read-heavy reporting path avoids it entirely by reading ClickHouse (ADR-0008).
- RLS adds a predicate to every plan. Mitigation: `tenant_id` is the leading column of every
  composite index on tenant-scoped tables (LLD to specify).
- A misconfigured policy is a systemic risk rather than a per-tenant one. Mitigated by §6.
- Connection poolers must be used in **transaction** pooling mode only; session pooling would break
  `SET LOCAL` semantics. This is a hard operational constraint, recorded here so it is not
  rediscovered in production.

## 5. Consequences for the LLD

- Every tenant-scoped table: `tenant_id UUID NOT NULL REFERENCES tenant(id)`, RLS enabled and forced,
  a single `USING`/`WITH CHECK` policy, and `tenant_id` first in composite indexes.
- Append-only tables (`audit_log_entry`, `tool_call`, approval decisions) additionally have
  `UPDATE`/`DELETE` revoked from the application role (NFR-10).
- The `vault` schema is granted only to the gateway role; the web and runtime roles have no grant.
- A connection-routing table maps `tenant_id → database DSN` for the enterprise escape hatch, even if
  every MVP row points at the shared cluster database.

## 6. Verification (this ADR is only real if it is tested)

A mandatory CI suite, run against a Testcontainers Postgres seeded with two tenants:

1. For every tenant-scoped table: reading under tenant A's context returns zero of tenant B's rows.
2. Insert with a mismatched `tenant_id` under tenant A's context is rejected by `WITH CHECK`.
3. Any query issued outside `withTenant()` returns zero rows (no GUC set → policy matches nothing),
   proving fail-closed rather than fail-open.
4. The application role cannot `UPDATE`/`DELETE` an audit or tool-call row.
5. The web and runtime roles cannot `SELECT` from the `vault` schema.
6. A schema-drift test asserting that any newly added table carrying a `tenant_id` column also has
   RLS enabled — so the guarantee cannot silently regress as the schema grows across phases.

`nexus-qa` should treat a failure in this suite as a release blocker, not a defect to triage.
