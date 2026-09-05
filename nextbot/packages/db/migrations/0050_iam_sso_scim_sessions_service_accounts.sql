-- Phase 4 (BL-36, FR-SEC-10): SSO (SAML/OIDC), SCIM provisioning, persisted session
-- revocation, and service-account scoped API keys. See
-- packages/modules/iam/README.md's Phase 4 decision log for the design rationale.

CREATE TYPE user_kind AS ENUM ('Human', 'ServiceAccount');
CREATE TYPE sso_protocol AS ENUM ('Saml', 'Oidc');
CREATE TYPE sso_connection_status AS ENUM ('Disabled', 'Active');

ALTER TABLE app_user ADD COLUMN kind user_kind NOT NULL DEFAULT 'Human';

CREATE TABLE sso_connection (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  protocol sso_protocol NOT NULL,
  display_name text NOT NULL,
  status sso_connection_status NOT NULL DEFAULT 'Disabled',
  jit_provisioning_enabled boolean NOT NULL DEFAULT true,
  default_role_id uuid REFERENCES role (id),
  group_claim_name text,
  oidc_issuer_url text,
  oidc_client_id text,
  oidc_client_secret_ciphertext text,
  oidc_client_secret_dek_ref text,
  saml_entry_point text,
  saml_issuer text,
  saml_idp_certificate text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sso_connection_tenant_key UNIQUE (tenant_id)
);

CREATE TABLE auth_session (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL REFERENCES app_user (id),
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX auth_session_tenant_user_idx ON auth_session (tenant_id, user_id);

CREATE TABLE scim_token (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  token_prefix text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX scim_token_tenant_idx ON scim_token (tenant_id);

CREATE TABLE api_key (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  service_account_user_id uuid NOT NULL REFERENCES app_user (id),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scope_matrix jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT api_key_tenant_prefix_key UNIQUE (tenant_id, key_prefix)
);
CREATE INDEX api_key_tenant_service_account_idx ON api_key (tenant_id, service_account_user_id);
