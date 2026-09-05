-- Phase 7 (BL-04): channels + channel_capability reference data (LLD §3.4).

CREATE TYPE channel_type AS ENUM (
  'WebWidget', 'WhatsApp', 'Messenger', 'Instagram', 'Voice', 'Email', 'Sms', 'Slack', 'Teams'
);
CREATE TYPE channel_status AS ENUM ('Active', 'Inactive', 'Error');
CREATE TYPE form_strategy AS ENUM ('Native', 'SequentialPrompt');
CREATE TYPE list_strategy AS ENUM ('Native', 'NumberedText');

CREATE TABLE channel (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  type channel_type NOT NULL,
  name text NOT NULL,
  status channel_status NOT NULL DEFAULT 'Inactive',
  environment environment NOT NULL,
  config jsonb NOT NULL,
  credential_id uuid REFERENCES credential (id),
  agent_definition_version_id uuid,
  public_key text NOT NULL,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT channel_tenant_env_name_key UNIQUE (tenant_id, environment, name),
  CONSTRAINT channel_public_key_key UNIQUE (public_key)
);

CREATE TABLE channel_capability (
  channel_type channel_type PRIMARY KEY,
  supports_rich_cards boolean NOT NULL,
  supports_quick_replies boolean NOT NULL,
  supports_lists boolean NOT NULL,
  supports_forms boolean NOT NULL,
  supports_file_upload boolean NOT NULL,
  supports_markdown boolean NOT NULL,
  supports_typing_indicator boolean NOT NULL,
  max_quick_replies integer,
  max_button_label_chars integer,
  max_text_chars integer,
  form_strategy form_strategy NOT NULL,
  list_strategy list_strategy NOT NULL
);

-- FR-OC-06 seed reference data: every channel type's rendering capability, so the
-- automatic degradation rule has real data to read from day one, even though only
-- WebWidget is a working channel this phase.
INSERT INTO channel_capability (
  channel_type, supports_rich_cards, supports_quick_replies, supports_lists, supports_forms,
  supports_file_upload, supports_markdown, supports_typing_indicator,
  max_quick_replies, max_button_label_chars, max_text_chars, form_strategy, list_strategy
) VALUES
  ('WebWidget',  true,  true,  true,  true,  true,  true,  true,  NULL, NULL, NULL, 'Native',           'Native'),
  ('WhatsApp',   true,  true,  true,  false, true,  false, true,  3,    20,   4096, 'SequentialPrompt', 'Native'),
  ('Messenger',  true,  true,  true,  false, true,  false, true,  13,   20,   2000, 'SequentialPrompt', 'Native'),
  ('Instagram',  false, true,  false, false, true,  false, false, 13,   20,   1000, 'SequentialPrompt', 'NumberedText'),
  ('Voice',      false, false, false, false, false, false, false, NULL, NULL, NULL, 'SequentialPrompt', 'NumberedText'),
  ('Email',      false, false, false, false, true,  true,  false, NULL, NULL, NULL, 'SequentialPrompt', 'NumberedText'),
  ('Sms',        false, false, false, false, false, false, false, NULL, NULL, 320,  'SequentialPrompt', 'NumberedText'),
  ('Slack',      true,  true,  true,  false, true,  true,  true,  10,   75,   4000, 'SequentialPrompt', 'Native'),
  ('Teams',      true,  true,  true,  false, true,  true,  true,  6,    20,   4000, 'SequentialPrompt', 'Native');

CREATE INDEX channel_tenant_env_status_idx ON channel (tenant_id, environment, status);
