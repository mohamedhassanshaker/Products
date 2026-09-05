-- Target Architecture Blueprint Phase 7a (ADR-0018 §2.2/§5, LLD §14.4.1) — the
-- Postgres-side routing record for a tenant's Neo4j database. See
-- packages/db/src/schema/tenancy.ts's doc comment on `tenantGraphDatabaseRoute` for
-- the disclosed eager-vs-lazy-provisioning deviation from ADR-0018 §2.2.

CREATE TABLE tenant_graph_database_route (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  cluster_url text NOT NULL,
  database_name text NOT NULL,
  provisioned_at timestamptz,
  last_provision_error_at timestamptz,
  last_provision_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_graph_database_route_database_name_key ON tenant_graph_database_route (database_name);
