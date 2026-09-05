-- Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, Blueprint §7.5) —
-- `agent_definition_version` gains the bounded retrieval agent's own config:
-- `planner_route_version_id` (the "chat.router"-shaped classification/sufficiency-
-- check route, resolved the SAME way `model_route_version_id` already resolves
-- `spec.modelRoute`) and `knowledge_config` (the resolved `spec.knowledge` block —
-- collection NAMES turned into real ids at save time). Both nullable: every
-- pre-existing version, and every future non-knowledge-scoped version, simply never
-- sets either — a plain tool-calling/reply agent is completely unaffected.

ALTER TABLE agent_definition_version
  ADD COLUMN planner_route_version_id uuid REFERENCES model_route_version (id),
  ADD COLUMN knowledge_config jsonb;
