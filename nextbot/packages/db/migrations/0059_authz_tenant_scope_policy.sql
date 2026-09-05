-- Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2.6) —
-- `tenant_scope_policy`: the one table `@nextbot/authz` owns. One row per tenant,
-- derived (never hand-edited) — see packages/db/src/schema/authz.ts's doc comment
-- for the disclosed narrowing of exactly what's derived this phase.

CREATE TABLE tenant_scope_policy (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  scope_json jsonb NOT NULL,
  scope_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
