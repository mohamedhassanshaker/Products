-- Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — Consented Break-Glass
-- Operator Access. `tenant_breakglass_grant` is the tenant-side, explicitly-consented
-- half: a NextBot Platform Operator can only be granted time-boxed, scoped read access
-- to a tenant's data for incident diagnosis when a row here exists, is unexpired, and
-- is unrevoked (checked synchronously at every access attempt — see
-- `packages/db/src/schema/tenancy.ts`'s doc comment for the full rationale, including
-- why no background expiry-sweep job is needed here unlike Tier-3 approvals/workflow
-- suspensions/escalation SLAs).

CREATE TABLE tenant_breakglass_grant (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  granted_by_user_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_user_id uuid
);

CREATE INDEX tenant_breakglass_grant_tenant_idx ON tenant_breakglass_grant (tenant_id, created_at);
CREATE INDEX tenant_breakglass_grant_tenant_active_idx ON tenant_breakglass_grant (tenant_id, revoked_at, expires_at);
