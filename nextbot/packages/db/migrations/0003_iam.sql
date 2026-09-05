-- Phase 2 (BL-01 auth/RBAC slice, LLD §3.3): app_user/role/user_role/sso_group_mapping/
-- login_attempt/login_lockout_policy. See packages/db/src/schema/iam.ts doc comments
-- for why credentials live directly on this RLS-protected schema rather than a
-- separately-adaptered Better-Auth table set.

CREATE TYPE user_status AS ENUM ('Active', 'Locked', 'Disabled', 'Invited');
CREATE TYPE mfa_method AS ENUM ('Totp', 'Sms', 'Email');
CREATE TYPE login_outcome AS ENUM ('Success', 'BadCredentials', 'Locked', 'NoRole', 'MfaFailed');

CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  email text NOT NULL,
  password_hash text,
  sso_subject text,
  display_name text NOT NULL,
  status user_status NOT NULL DEFAULT 'Active',
  mfa_enrolled boolean NOT NULL DEFAULT false,
  mfa_method mfa_method,
  mfa_secret_ref text,
  mfa_backup_codes_ref text,
  failed_login_count smallint NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_tenant_email_key UNIQUE (tenant_id, email),
  CONSTRAINT app_user_tenant_sso_subject_key UNIQUE (tenant_id, sso_subject)
);
CREATE INDEX app_user_tenant_idx ON app_user (tenant_id);

CREATE TABLE role (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permission_matrix jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE INDEX role_tenant_idx ON role (tenant_id);

CREATE TABLE user_role (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL REFERENCES app_user (id),
  role_id uuid NOT NULL REFERENCES role (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, role_id)
);
CREATE INDEX user_role_tenant_user_idx ON user_role (tenant_id, user_id);

CREATE TABLE sso_group_mapping (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  external_group text NOT NULL,
  role_id uuid NOT NULL REFERENCES role (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sso_group_mapping_tenant_group_key UNIQUE (tenant_id, external_group)
);

CREATE TABLE login_attempt (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  email text NOT NULL,
  ip inet,
  user_agent text,
  outcome login_outcome NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempt_tenant_email_created_idx ON login_attempt (tenant_id, email, created_at);

CREATE TABLE login_lockout_policy (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  max_failed_attempts integer NOT NULL DEFAULT 5,
  cooldown_minutes integer NOT NULL DEFAULT 15,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfa_secret (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL REFERENCES app_user (id),
  ciphertext text NOT NULL,
  dek_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
