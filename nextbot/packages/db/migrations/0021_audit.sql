-- Phase 17 (BL-10): append-only audit log (LLD §3.x, FR-ADM-03/NFR-5).

CREATE TYPE audit_outcome AS ENUM ('Success', 'Failure', 'Denied');

CREATE TABLE audit_log_entry (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_label text NOT NULL,
  action_type text NOT NULL,
  target_type text,
  target_id text,
  outcome audit_outcome NOT NULL DEFAULT 'Success',
  details jsonb NOT NULL,
  source_domain_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entry_tenant_occurred_idx ON audit_log_entry (tenant_id, occurred_at);
CREATE INDEX audit_log_entry_tenant_action_type_idx ON audit_log_entry (tenant_id, action_type);
CREATE INDEX audit_log_entry_tenant_target_idx ON audit_log_entry (tenant_id, target_type, target_id);
-- Full-text search index (B.8.2's audit log search box) over the columns an
-- operator actually searches by free text.
CREATE INDEX audit_log_entry_fts_idx ON audit_log_entry
  USING GIN (to_tsvector('english', action_type || ' ' || actor_label || ' ' || coalesce(target_type, '') || ' ' || coalesce(target_id, '')));
-- Prevents the same domain_event row from ever being synced into audit_log_entry
-- twice (the outbox consumer's own idempotency guarantee, enforced by the DB, not
-- just check-then-act application code).
CREATE UNIQUE INDEX audit_log_entry_source_event_key ON audit_log_entry (source_domain_event_id) WHERE source_domain_event_id IS NOT NULL;
