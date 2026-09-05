-- Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8.2/§14.8.7) — RLS for the new
-- `model_route_version` table (standard single-clause tenant-scoped shape, same as
-- every other Phase 2 table except the platform-shared ones) and
-- `platform_provider_type_policy` (FR-AGT-26's mechanism — no `tenant_id` at all, same
-- category as `channel_capability`/`platform_audit_log_entry`, excluded from RLS
-- entirely, written only via `withPlatform()`).

ALTER TABLE model_route_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_route_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_route_version
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE TABLE platform_provider_type_policy (
  plan_tier plan_tier PRIMARY KEY,
  allowed_provider_types text[] NOT NULL,
  updated_by_operator_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seeded permissive for every tier (FR-AGT-26 ships the *mechanism*; spec §9.5 item 6
-- deliberately leaves the actual restriction policy open — shipping this table
-- changes NO behaviour for any existing tenant until a Platform Manager operator
-- narrows it via `PUT /api/internal/ops/model-gateway/provider-type-policy/{planTier}`).
INSERT INTO platform_provider_type_policy (plan_tier, allowed_provider_types) VALUES
  ('Starter', ARRAY['openai','anthropic','gemini','azure-openai','openai-compatible','google-vertex','bedrock','openrouter','ollama','cohere','mistral','custom']),
  ('Growth', ARRAY['openai','anthropic','gemini','azure-openai','openai-compatible','google-vertex','bedrock','openrouter','ollama','cohere','mistral','custom']),
  ('Enterprise', ARRAY['openai','anthropic','gemini','azure-openai','openai-compatible','google-vertex','bedrock','openrouter','ollama','cohere','mistral','custom']);
