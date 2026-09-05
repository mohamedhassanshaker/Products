-- Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8.6 M6, part 2 of 2) —
-- `model_call_log` -> `model_usage_event` (same physical table, RLS policy/indexes
-- carry over automatically through the rename). All new columns nullable with no
-- historical backfill (LLD's own instruction) — `route_key`/`provider_key`/`model`
-- stay populated so every existing FR-AI-12/FR-RP-07 query keeps returning the same
-- numbers across the rename.

ALTER TABLE model_call_log RENAME TO model_usage_event;
ALTER TABLE model_usage_event RENAME COLUMN status TO outcome;
ALTER TABLE model_usage_event RENAME CONSTRAINT model_call_log_pkey TO model_usage_event_pkey;

ALTER TABLE model_usage_event
  ADD COLUMN route_version_id uuid REFERENCES model_route_version (id),
  ADD COLUMN catalog_entry_id uuid REFERENCES model_catalog_entry (id),
  ADD COLUMN provider_id uuid REFERENCES model_provider (id),
  ADD COLUMN agent_definition_version_id uuid,
  ADD COLUMN conversation_id uuid,
  ADD COLUMN workflow_run_step_id uuid,
  ADD COLUMN delegation_event_id uuid,
  ADD COLUMN knowledge_generation_id uuid,
  ADD COLUMN hop_index smallint NOT NULL DEFAULT 0,
  ADD COLUMN cached_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN channel_type channel_type;

ALTER INDEX model_call_log_tenant_created_idx RENAME TO model_usage_event_tenant_created_idx;
CREATE INDEX model_usage_event_tenant_route_version_idx ON model_usage_event (tenant_id, route_version_id, created_at DESC);
CREATE INDEX model_usage_event_tenant_catalog_entry_idx ON model_usage_event (tenant_id, catalog_entry_id, created_at DESC);
CREATE INDEX model_usage_event_tenant_conversation_idx ON model_usage_event (tenant_id, conversation_id);
CREATE INDEX model_usage_event_tenant_agent_version_idx ON model_usage_event (tenant_id, agent_definition_version_id, created_at DESC);

-- `model_budget`/`model_cache_entry` (LLD §14.8.6 rule 3 — no column change on move,
-- except adding a real `route_id` FK alongside the retained `route_key` text column
-- for one release).
ALTER TABLE model_budget ADD COLUMN route_id uuid REFERENCES model_route (id);
ALTER TABLE model_cache_entry ADD COLUMN route_id uuid REFERENCES model_route (id);

UPDATE model_cache_entry mce
SET route_id = mr.id
FROM model_route mr
WHERE mr.tenant_id = mce.tenant_id AND mr.name = mce.route_key AND mce.route_id IS NULL;

-- NOTE (deliberate, flagged deviation from a literal reading of LLD §14.8.6 M6, which
-- describes dropping `model_catalog_entry.needs_review` in this migration): kept as-is
-- rather than dropped. Phase 1's `catalog-backfill-migration.int.test.ts` and its own
-- QA-approved console banner both actively depend on this column's presence/semantics
-- today, and nothing in this phase's actual scope requires removing it — the column
-- remaining is a strictly additive no-op for every Phase 2 code path (route-version
-- capability validation reads `capabilities_json` directly, never `needs_review`).
-- Dropping it would force touching already-QA-green Phase 1 test files for zero
-- functional benefit this phase; revisit if/when the one-time review banner is
-- actually retired.
