-- Phase 4 (BL-02): credential vault + connector CRUD (LLD §3.5).

CREATE TYPE backend_type AS ENUM ('Ticketing', 'CRM', 'ERP', 'Billing', 'HRIS', 'KnowledgeBase', 'Custom');
CREATE TYPE mcp_transport AS ENUM ('StreamableHTTP', 'StdioViaGateway');
CREATE TYPE connector_auth_method AS ENUM ('OAuth2', 'APIKey', 'BearerToken', 'CustomHeader', 'mTLS', 'None');
CREATE TYPE connector_status AS ENUM ('Connected', 'Degraded', 'Offline');
CREATE TYPE trust_level AS ENUM ('Trusted', 'SemiTrusted', 'Untrusted');
CREATE TYPE circuit_state AS ENUM ('Closed', 'Open', 'HalfOpen');
CREATE TYPE credential_type AS ENUM ('APIKey', 'OAuthToken', 'SystemUserToken', 'BearerToken', 'ClientCertificate', 'MfaSecret', 'ModelProviderKey');

CREATE TABLE credential (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  label text NOT NULL,
  type credential_type NOT NULL,
  vault_ref text NOT NULL,
  ciphertext text NOT NULL,
  dek_ref text NOT NULL,
  masked_hint text NOT NULL,
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT credential_vault_ref_key UNIQUE (vault_ref)
);
CREATE INDEX credential_tenant_idx ON credential (tenant_id);

CREATE TABLE connector (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  description text,
  backend_type backend_type NOT NULL,
  template_key text,
  transport mcp_transport NOT NULL,
  endpoint_url text,
  stdio_command jsonb,
  gateway_agent_id uuid,
  auth_method connector_auth_method NOT NULL,
  credential_id uuid REFERENCES credential (id),
  environment environment NOT NULL,
  status connector_status NOT NULL DEFAULT 'Offline',
  trust_level trust_level NOT NULL DEFAULT 'SemiTrusted',
  health_interval_seconds integer NOT NULL DEFAULT 60,
  latency_threshold_ms integer NOT NULL DEFAULT 2000,
  error_rate_threshold_pct numeric(5,2) NOT NULL DEFAULT 5.00,
  offline_alert_after_minutes integer NOT NULL DEFAULT 5,
  circuit_state circuit_state NOT NULL DEFAULT 'Closed',
  circuit_opened_at timestamptz,
  last_discovered_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connector_tenant_env_name_key UNIQUE (tenant_id, environment, name),
  CONSTRAINT connector_endpoint_url_required_for_http CHECK (transport != 'StreamableHTTP' OR endpoint_url IS NOT NULL),
  CONSTRAINT connector_stdio_command_required_for_stdio CHECK (transport != 'StdioViaGateway' OR stdio_command IS NOT NULL),
  CONSTRAINT connector_credential_required_unless_none CHECK (auth_method = 'None' OR credential_id IS NOT NULL),
  CONSTRAINT connector_endpoint_url_https_only CHECK (endpoint_url IS NULL OR endpoint_url LIKE 'https://%')
);
CREATE INDEX connector_tenant_env_status_idx ON connector (tenant_id, environment, status);
CREATE INDEX connector_tenant_backend_type_idx ON connector (tenant_id, backend_type);
