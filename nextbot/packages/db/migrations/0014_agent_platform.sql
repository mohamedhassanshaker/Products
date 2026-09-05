-- Phase 10 (BL-07): Agent Platform — agent definitions/versions, tenant-owned Git
-- remote (LLD §3.10a / ADR-0009), eval-suite promotion gate (LLD §3.10), the Model
-- Gateway's routing/budget/cache/call-log tables (LLD §7.1 / ADR-0006), agent_run
-- (FR-AGT-09). See packages/db/src/schema/agent-platform.ts's module doc for the
-- deliberate `tenant_id NOT NULL` deviation from the LLD's nullable-for-platform-
-- shared columns.

CREATE TYPE git_provider AS ENUM ('GitHub', 'GitLab');
CREATE TYPE git_connection_status AS ENUM ('Connected', 'Unreachable', 'Disconnected');
CREATE TYPE git_pr_status AS ENUM ('None', 'Open', 'Merged', 'Closed');
CREATE TYPE graph_type AS ENUM ('ADK', 'LangGraph', 'PydanticAI', 'CustomFSM');
CREATE TYPE agent_version_status AS ENUM ('Draft', 'EvalGated', 'HumanReview', 'Approved', 'Production', 'Deprecated');
CREATE TYPE eval_run_status AS ENUM ('Queued', 'Running', 'Passed', 'Failed', 'Error');
CREATE TYPE eval_triggered_by AS ENUM ('VersionSubmitted', 'Manual', 'Scheduled');
CREATE TYPE deploy_environment AS ENUM ('Sandbox', 'Staging', 'Production');
CREATE TYPE deployment_action AS ENUM ('Deploy', 'SplitChange', 'PromoteCanary', 'Rollback');
CREATE TYPE model_provider_key AS ENUM ('openai', 'anthropic', 'gemini', 'azure-openai', 'openai-compatible');
CREATE TYPE routing_strategy AS ENUM ('FixedPriority', 'CostBased', 'LatencyBased');
CREATE TYPE cache_mode AS ENUM ('Off', 'ExactMatch', 'Semantic');
CREATE TYPE model_budget_scope AS ENUM ('Tenant', 'Agent');
CREATE TYPE model_budget_period AS ENUM ('Day', 'Month');
CREATE TYPE model_budget_on_exceed AS ENUM ('Throttle', 'HardStop', 'AlertOnly');
CREATE TYPE degraded_mode AS ENUM ('KnowledgeBaseOnly', 'ImmediateEscalation', 'StaticMessage');
CREATE TYPE model_call_status AS ENUM ('Success', 'ProviderError', 'Timeout', 'RateLimited', 'Filtered');
CREATE TYPE cache_kind AS ENUM ('None', 'Exact', 'Semantic');
CREATE TYPE run_trigger AS ENUM ('CustomerMessage', 'A2ATask', 'HumanAgentAction', 'EvalCase', 'SandboxTest', 'ResumeAfterHitl');
CREATE TYPE run_status AS ENUM ('Running', 'Succeeded', 'Failed', 'PausedForApproval', 'Cancelled', 'TimedOut');

-- Phase 10: two new credential kinds for the tenant's Git OAuth token / webhook HMAC
-- secret, stored in the existing envelope-encrypted vault (Phase 4).
ALTER TYPE credential_type ADD VALUE 'GitOAuthToken';
ALTER TYPE credential_type ADD VALUE 'WebhookSecret';

CREATE TABLE git_connection (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  provider git_provider NOT NULL,
  base_url text,
  repo_owner text NOT NULL,
  repo_name text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  credential_id uuid NOT NULL REFERENCES credential (id),
  webhook_secret_credential_id uuid REFERENCES credential (id),
  status git_connection_status NOT NULL DEFAULT 'Disconnected',
  last_checked_at timestamptz,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_definition (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  description text,
  repo_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_definition_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE INDEX agent_definition_tenant_idx ON agent_definition (tenant_id);

CREATE TABLE agent_definition_version (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_definition_id uuid NOT NULL REFERENCES agent_definition (id),
  version text NOT NULL,
  graph_type graph_type NOT NULL DEFAULT 'ADK',
  status agent_version_status NOT NULL DEFAULT 'Draft',
  definition_yaml text NOT NULL,
  definition_hash text NOT NULL,
  git_commit_sha text,
  git_pr_number integer,
  git_pr_status git_pr_status NOT NULL DEFAULT 'None',
  eval_suite_id uuid,
  last_eval_run_id uuid,
  model_route_key text NOT NULL,
  created_by_user_id uuid,
  approved_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_definition_version_def_version_key UNIQUE (agent_definition_id, version)
);
CREATE INDEX agent_definition_version_tenant_idx ON agent_definition_version (tenant_id);
CREATE INDEX agent_definition_version_status_idx ON agent_definition_version (tenant_id, agent_definition_id, status);

CREATE TABLE eval_suite (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  description text,
  cost_budget_usd numeric(18, 4),
  latency_budget_ms integer,
  pass_threshold_pct numeric(5, 2) NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_suite_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE INDEX eval_suite_tenant_idx ON eval_suite (tenant_id);

CREATE TABLE eval_case (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  eval_suite_id uuid NOT NULL REFERENCES eval_suite (id),
  name text NOT NULL,
  input_transcript jsonb NOT NULL,
  expected_tool_calls jsonb,
  expected_response_pattern text,
  weight smallint NOT NULL DEFAULT 1
);
CREATE INDEX eval_case_tenant_suite_idx ON eval_case (tenant_id, eval_suite_id);

CREATE TABLE eval_run (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  eval_suite_id uuid NOT NULL REFERENCES eval_suite (id),
  agent_definition_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  definition_hash text NOT NULL,
  status eval_run_status NOT NULL DEFAULT 'Queued',
  pass_rate_pct numeric(5, 2),
  total_cost_usd numeric(18, 4),
  p95_latency_ms integer,
  triggered_by eval_triggered_by NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eval_run_tenant_version_idx ON eval_run (tenant_id, agent_definition_version_id);
CREATE INDEX eval_run_tenant_status_idx ON eval_run (tenant_id, status);

CREATE TABLE eval_case_result (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  eval_run_id uuid NOT NULL REFERENCES eval_run (id),
  eval_case_id uuid NOT NULL REFERENCES eval_case (id),
  passed boolean NOT NULL,
  actual_tool_calls jsonb,
  actual_response text,
  diff jsonb,
  cost_usd numeric(18, 4),
  latency_ms integer,
  failure_reason text
);
CREATE INDEX eval_case_result_tenant_run_idx ON eval_case_result (tenant_id, eval_run_id);

CREATE TABLE deployment (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_definition_id uuid NOT NULL REFERENCES agent_definition (id),
  agent_definition_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  environment deploy_environment NOT NULL,
  traffic_split_pct smallint NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  activated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT deployment_traffic_split_range CHECK (traffic_split_pct >= 0 AND traffic_split_pct <= 100)
);
CREATE INDEX deployment_tenant_agent_env_idx ON deployment (tenant_id, agent_definition_id, environment);

CREATE TABLE deployment_history (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_definition_id uuid NOT NULL REFERENCES agent_definition (id),
  environment deploy_environment NOT NULL,
  action deployment_action NOT NULL,
  from_state jsonb,
  to_state jsonb,
  reason text NOT NULL,
  actor_user_id uuid,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deployment_history_tenant_agent_idx ON deployment_history (tenant_id, agent_definition_id);

-- Platform-level reference data (no tenant_id) — same category as channel_capability.
CREATE TABLE model_provider (
  id uuid PRIMARY KEY,
  key model_provider_key NOT NULL,
  label text NOT NULL,
  base_url text,
  credential_id uuid REFERENCES credential (id),
  regions text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_route (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  route_key text NOT NULL,
  strategy routing_strategy NOT NULL DEFAULT 'FixedPriority',
  chain jsonb NOT NULL,
  total_timeout_ms integer NOT NULL DEFAULT 30000,
  cache_mode cache_mode NOT NULL DEFAULT 'Off',
  semantic_threshold numeric(4, 3) NOT NULL DEFAULT 0.95,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_route_tenant_key_key UNIQUE (tenant_id, route_key)
);
CREATE INDEX model_route_tenant_idx ON model_route (tenant_id);

CREATE TABLE model_budget (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  scope model_budget_scope NOT NULL,
  agent_definition_id uuid REFERENCES agent_definition (id),
  period model_budget_period NOT NULL,
  cap_usd numeric(18, 4) NOT NULL,
  alert_pcts smallint[] NOT NULL DEFAULT '{80,90,100}',
  on_exceed model_budget_on_exceed NOT NULL DEFAULT 'AlertOnly',
  degraded_mode degraded_mode,
  degraded_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_budget_tenant_idx ON model_budget (tenant_id);

CREATE TABLE model_call_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_run_id uuid,
  route_key text NOT NULL,
  provider_key text NOT NULL,
  model text NOT NULL,
  attempt smallint NOT NULL DEFAULT 1,
  cached boolean NOT NULL DEFAULT false,
  cache_kind cache_kind NOT NULL DEFAULT 'None',
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(18, 8),
  latency_ms integer,
  status model_call_status NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_call_log_tenant_created_idx ON model_call_log (tenant_id, created_at);

CREATE TABLE model_cache_entry (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  route_key text NOT NULL,
  prompt_hash text NOT NULL,
  response jsonb NOT NULL,
  tokens_saved integer NOT NULL DEFAULT 0,
  hits integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_cache_entry_tenant_route_hash_key UNIQUE (tenant_id, route_key, prompt_hash)
);
CREATE INDEX model_cache_entry_tenant_idx ON model_cache_entry (tenant_id);

CREATE TABLE agent_run (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_definition_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  conversation_id uuid,
  trigger run_trigger NOT NULL,
  status run_status NOT NULL DEFAULT 'Running',
  paused_tool_call_id uuid,
  resume_token text,
  checkpoint jsonb,
  otel_trace_id text NOT NULL,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(18, 8),
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX agent_run_tenant_version_idx ON agent_run (tenant_id, agent_definition_version_id);
CREATE INDEX agent_run_tenant_conversation_idx ON agent_run (tenant_id, conversation_id);
