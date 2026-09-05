-- Phase 7 (BL-04/06): conversation + message (LLD §3.7). True monthly partitioning
-- of `message` is deferred (see packages/db/src/schema/conversations.ts's module
-- doc) — a plain table today, shaped so a later `PARTITION BY RANGE (created_at)`
-- conversion is a data migration, not a schema-shape change.

CREATE TYPE conversation_status AS ENUM ('Active', 'Resolved', 'Escalated', 'Abandoned');
CREATE TYPE resolution_type AS ENUM ('AI', 'Human', 'Abandoned');
CREATE TYPE message_sender AS ENUM ('Customer', 'AI', 'HumanAgent', 'System');
CREATE TYPE message_content_type AS ENUM (
  'Text', 'QuickReply', 'List', 'ExternalLink', 'Document', 'DataSummary', 'DataTable',
  'Form', 'OTP', 'Confirmation', 'TicketCreated', 'TicketStatus', 'FileUpload', 'Error'
);
CREATE TYPE delivery_status AS ENUM ('Pending', 'Sent', 'Delivered', 'Read', 'Failed');

CREATE TABLE conversation (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  channel_id uuid NOT NULL REFERENCES channel (id),
  external_thread_id text,
  customer_identifier text,
  customer_identifier_hash text,
  status conversation_status NOT NULL DEFAULT 'Active',
  recognized_goal text,
  resolution_type resolution_type,
  language text NOT NULL,
  agent_definition_version_id uuid,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  total_cost_usd numeric(18,8) NOT NULL DEFAULT 0,
  total_tokens_in integer NOT NULL DEFAULT 0,
  total_tokens_out integer NOT NULL DEFAULT 0,
  metadata jsonb,
  next_sequence integer NOT NULL DEFAULT 1,
  CONSTRAINT conversation_tenant_channel_thread_key UNIQUE (tenant_id, channel_id, external_thread_id)
);
CREATE INDEX conversation_tenant_status_activity_idx ON conversation (tenant_id, status, last_activity_at DESC);
CREATE INDEX conversation_tenant_channel_started_idx ON conversation (tenant_id, channel_id, started_at DESC);
CREATE INDEX conversation_tenant_customer_hash_idx ON conversation (tenant_id, customer_identifier_hash);

CREATE TABLE message (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  conversation_id uuid NOT NULL REFERENCES conversation (id),
  sequence integer NOT NULL,
  sender message_sender NOT NULL,
  sender_user_id uuid,
  content_type message_content_type NOT NULL,
  payload jsonb NOT NULL,
  payload_masked jsonb,
  confidence_score real,
  agent_run_id uuid,
  in_reply_to_tool_call_id uuid,
  delivery_status delivery_status NOT NULL DEFAULT 'Sent',
  client_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_tenant_conversation_sequence_key UNIQUE (tenant_id, conversation_id, sequence),
  CONSTRAINT message_tenant_conversation_client_id_key UNIQUE (tenant_id, conversation_id, client_message_id),
  CONSTRAINT message_confidence_score_range CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1))
);
CREATE INDEX message_tenant_conversation_idx ON message (tenant_id, conversation_id);
