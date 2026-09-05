-- Phase 17 (BL-10): PII detection/masking policy, guardrail authoring, DSR tool
-- (FR-SEC-04, B.8.4).

CREATE TYPE pii_entity_type AS ENUM ('NationalId', 'CreditCard', 'IBAN', 'Phone', 'Email', 'Passport', 'DateOfBirth', 'Custom');
CREATE TYPE pii_context AS ENUM ('Transcript', 'ToolCallPayload', 'A2APayload', 'Export', 'HumanAgentView');
CREATE TYPE pii_mask_action AS ENUM ('Show', 'PartialMask', 'FullMask', 'Redact');
CREATE TYPE dsr_status AS ENUM ('Pending', 'InProgress', 'Completed', 'Failed');
CREATE TYPE dsr_type AS ENUM ('Search', 'Export', 'Delete');

CREATE TABLE pii_rule (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  entity_type pii_entity_type NOT NULL,
  label text NOT NULL,
  pattern text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pii_rule_tenant_idx ON pii_rule (tenant_id);
-- A Custom rule must actually carry the regex it's meant to apply.
ALTER TABLE pii_rule ADD CONSTRAINT pii_rule_custom_requires_pattern
  CHECK (entity_type != 'Custom' OR pattern IS NOT NULL);

CREATE TABLE pii_policy (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  entity_type pii_entity_type NOT NULL,
  context pii_context NOT NULL,
  trust_level text NOT NULL,
  action pii_mask_action NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pii_policy_tenant_matrix_key ON pii_policy (tenant_id, entity_type, context, trust_level);

CREATE TABLE guardrail_rule (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  ordinal integer NOT NULL,
  conditions jsonb NOT NULL,
  effect text NOT NULL,
  reason text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guardrail_rule_tenant_ordinal_idx ON guardrail_rule (tenant_id, ordinal);
CREATE UNIQUE INDEX guardrail_rule_tenant_ordinal_key ON guardrail_rule (tenant_id, ordinal);
ALTER TABLE guardrail_rule ADD CONSTRAINT guardrail_rule_effect_valid
  CHECK (effect IN ('BlockToolCall', 'EscalateToHuman'));

CREATE TABLE data_subject_request (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  request_type dsr_type NOT NULL,
  customer_identifier text NOT NULL,
  requested_by_user_id uuid,
  status dsr_status NOT NULL DEFAULT 'Pending',
  result_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX data_subject_request_tenant_idx ON data_subject_request (tenant_id, created_at);
