-- Phase 18 (BL-11): MCP server health monitoring + alert configuration
-- (FR-MCP-08, B.3A.4).

CREATE TABLE connector_health_check (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  connector_id uuid NOT NULL REFERENCES connector (id),
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  latency_ms integer,
  error_message text
);
CREATE INDEX connector_health_check_tenant_connector_checked_idx
  ON connector_health_check (tenant_id, connector_id, checked_at);

CREATE TYPE alert_destination_kind AS ENUM ('Email', 'Slack', 'InApp');
CREATE TYPE alert_metric AS ENUM ('LatencyMs', 'ErrorRatePct', 'OfflineMinutes');

CREATE TABLE connector_alert_rule (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  connector_id uuid NOT NULL REFERENCES connector (id),
  metric alert_metric NOT NULL,
  threshold_value numeric(10, 2) NOT NULL,
  destination_kind alert_destination_kind NOT NULL,
  destination_email text,
  destination_credential_id uuid REFERENCES credential (id),
  enabled boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connector_alert_rule_tenant_connector_idx ON connector_alert_rule (tenant_id, connector_id);
-- A Slack destination must reference a vaulted credential, never a plaintext
-- webhook URL column; an Email destination must carry an address.
ALTER TABLE connector_alert_rule ADD CONSTRAINT connector_alert_rule_destination_valid
  CHECK (
    (destination_kind = 'Slack' AND destination_credential_id IS NOT NULL) OR
    (destination_kind = 'Email' AND destination_email IS NOT NULL) OR
    (destination_kind = 'InApp')
  );
