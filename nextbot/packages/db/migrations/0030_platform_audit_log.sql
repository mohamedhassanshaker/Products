-- Platform Manager console Phase 1 (NFR-11): the platform-level audit trail.
-- No RLS — same reasoning as the `tenant` table itself: this table is written only
-- via withPlatform() (LLD §3.2 rule 4's two allowed callers), and a provisioning-time
-- action has no tenant row to scope RLS to yet. Append-only-ness (REVOKE UPDATE,
-- DELETE from the "app"/"platform" roles) is handled in ensure-roles.ts, re-applied
-- on every bootstrap run, not here — see that file's module doc for why a one-time
-- migration-level REVOKE would not be durable against the per-role blanket GRANT loop
-- that runs on every `pnpm db:migrate` (identical idiom to audit_log_entry, Phase 17).

CREATE TABLE platform_audit_log_entry (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_label text NOT NULL,
  action_type text NOT NULL,
  -- Nullable + ON DELETE SET NULL: an audit entry must outlive the tenant it once
  -- referenced (deleting a tenant must never cascade-delete or be blocked by its
  -- own audit history), and a cross-tenant rollup action may not target one tenant.
  target_tenant_id uuid REFERENCES tenant (id) ON DELETE SET NULL,
  details jsonb NOT NULL
);
CREATE INDEX platform_audit_log_entry_occurred_idx ON platform_audit_log_entry (occurred_at);
CREATE INDEX platform_audit_log_entry_target_tenant_idx ON platform_audit_log_entry (target_tenant_id);
