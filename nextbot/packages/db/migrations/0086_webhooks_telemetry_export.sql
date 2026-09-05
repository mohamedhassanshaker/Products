-- Target Architecture Blueprint Phase 18 (BL-49, FR-API-02/FR-ADM-10) — outbound
-- webhooks + tenant-scoped OpenTelemetry/SIEM export.
--
-- Authority: docs/PRODUCT_SPECIFICATION.md FR-API-01/02, FR-ADM-10. No dedicated LLD
-- §14.x/§15.x section exists for this phase (it is genuinely under-specified, matching
-- its P2/last-scheduled status) — see docs/plans/public-api-webhooks-otel-siem-plan.md
-- for the disclosed design decisions this migration encodes.

-- ---------------------------------------------------------------------------
-- 1. Outbound webhooks
-- ---------------------------------------------------------------------------

CREATE TYPE webhook_event_category AS ENUM (
  'EscalationCreated',
  'ApprovalPending',
  'GuardrailTripped',
  'DeploymentChanged',
  'DriftDetected'
);

CREATE TYPE webhook_delivery_status AS ENUM ('Pending', 'Success', 'Failed', 'Exhausted');

CREATE TABLE webhook_subscription (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  target_url text NOT NULL,
  -- Array of webhook_event_category values, stored as jsonb (not a Postgres array of
  -- the enum type) so the application layer can validate/serialize it through the
  -- same TypeBox schema it validates the request body with, matching this codebase's
  -- established "jsonb + TypeBox at the boundary" convention for variable-shaped
  -- tenant-authored config (see domain_event.payload's own module doc).
  event_categories jsonb NOT NULL,
  signing_secret_credential_id uuid NOT NULL REFERENCES credential (id),
  enabled boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_subscription_tenant_enabled_idx ON webhook_subscription (tenant_id, enabled);

CREATE TABLE webhook_delivery (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  subscription_id uuid NOT NULL REFERENCES webhook_subscription (id),
  -- Deliberately FK-less: `domain_event` rows are cross-tenant-shared infrastructure
  -- (packages/db/src/schema/domain-event.ts) with no dedicated module owning it as a
  -- "module -> module" target, the same precedent `audit_log_entry.source_domain_
  -- event_id` already sets (migration 0017's own audit schema).
  domain_event_id uuid NOT NULL,
  event_category webhook_event_category NOT NULL,
  status webhook_delivery_status NOT NULL DEFAULT 'Pending',
  attempt_count smallint NOT NULL DEFAULT 0,
  last_response_code integer,
  last_error_message text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_delivery_subscription_status_idx ON webhook_delivery (subscription_id, status, next_attempt_at);
CREATE INDEX webhook_delivery_tenant_created_idx ON webhook_delivery (tenant_id, created_at);

-- Idempotency at the database level, not merely application logic — mirrors
-- `mcp_drift_event`'s own dedupe-index precedent (ADR-0014).
CREATE UNIQUE INDEX webhook_delivery_subscription_event_key ON webhook_delivery (subscription_id, domain_event_id);

-- ---------------------------------------------------------------------------
-- 2. Tenant-scoped OTel/SIEM export configuration (FR-ADM-10)
-- ---------------------------------------------------------------------------

CREATE TABLE otel_export_config (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  otlp_endpoint_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per tenant — created lazily on first configuration (see application service).
CREATE UNIQUE INDEX otel_export_config_tenant_key ON otel_export_config (tenant_id);

CREATE TABLE siem_export_config (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  endpoint_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  -- This table's OWN cursor — never `domain_event.processed`/`processed_at` (that
  -- column pair belongs exclusively to `@nextbot/audit`'s own outbox consumer). See
  -- this table's schema-file doc comment for the full non-interference rationale.
  last_exported_audit_log_id uuid,
  last_exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX siem_export_config_tenant_key ON siem_export_config (tenant_id);
