-- Phase 3 (BL-15, WhatsApp slice): meta_business_account / whatsapp_number /
-- whatsapp_template / consent_record / consent_import_log (LLD §12.3).

ALTER TYPE credential_type ADD VALUE 'MetaAppSecret';
ALTER TYPE credential_type ADD VALUE 'MetaWebhookVerifyToken';

CREATE TYPE meta_business_account_status AS ENUM ('Disconnected', 'Connected', 'Unreachable');
CREATE TYPE whatsapp_phone_verification_status AS ENUM ('Verified', 'Pending', 'Unverified');
CREATE TYPE whatsapp_messaging_tier AS ENUM ('Tier1', 'Tier2', 'Tier3', 'Tier4');
CREATE TYPE whatsapp_template_status AS ENUM ('Approved', 'Pending', 'Rejected');
CREATE TYPE consent_state AS ENUM ('OptedIn', 'OptedOut');

CREATE TABLE meta_business_account (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  channel_id uuid NOT NULL REFERENCES channel (id),
  business_id text NOT NULL,
  business_name text NOT NULL,
  waba_id text,
  status meta_business_account_status NOT NULL DEFAULT 'Disconnected',
  system_user_token_credential_id uuid REFERENCES credential (id),
  app_id text,
  app_secret_credential_id uuid REFERENCES credential (id),
  webhook_verify_token_credential_id uuid REFERENCES credential (id),
  session_window_warning_enabled boolean NOT NULL DEFAULT true,
  linked_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_business_account_tenant_channel_key UNIQUE (tenant_id, channel_id)
);

CREATE TABLE whatsapp_number (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  meta_business_account_id uuid NOT NULL REFERENCES meta_business_account (id),
  phone_number_id text NOT NULL,
  e164 text NOT NULL,
  display_name text,
  verification_status whatsapp_phone_verification_status NOT NULL DEFAULT 'Unverified',
  messaging_tier whatsapp_messaging_tier NOT NULL DEFAULT 'Tier1',
  quality_rating text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_number_tenant_phone_number_id_key UNIQUE (tenant_id, phone_number_id)
);

CREATE TABLE whatsapp_template (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  channel_id uuid NOT NULL REFERENCES channel (id),
  external_template_id text,
  name text NOT NULL,
  language text NOT NULL,
  category text,
  status whatsapp_template_status NOT NULL,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_template_tenant_channel_name_lang_key UNIQUE (tenant_id, channel_id, name, language)
);

CREATE TABLE consent_record (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  channel_id uuid NOT NULL REFERENCES channel (id),
  customer_identifier text NOT NULL,
  channel_type text NOT NULL DEFAULT 'WhatsApp',
  state consent_state NOT NULL,
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_record_tenant_channel_customer_key UNIQUE (tenant_id, channel_id, customer_identifier)
);

CREATE TABLE consent_import_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  channel_id uuid NOT NULL REFERENCES channel (id),
  filename text,
  total_rows integer NOT NULL,
  succeeded_rows integer NOT NULL,
  failed_rows integer NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_by_user_id uuid,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_template_tenant_channel_idx ON whatsapp_template (tenant_id, channel_id);
CREATE INDEX consent_record_tenant_channel_idx ON consent_record (tenant_id, channel_id);
CREATE INDEX consent_import_log_tenant_channel_idx ON consent_import_log (tenant_id, channel_id);
