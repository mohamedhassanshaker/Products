-- Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06, LLD §14.4.2) —
-- `retrieval_event`, explicitly deferred by Phase 7b's own migration (0065) and again
-- by Phase 9's own dispatch: nothing before this phase's bounded retrieval agent
-- reads or writes it. Reuses the `retrieval_strategy` enum Phase 7b already created
-- (0065) unchanged. Plain table today (no `PARTITION BY RANGE`), mirroring `message`'s
-- own already-established "shaped for a later partitioning conversion, not partitioned
-- yet" precedent (`packages/db/src/schema/conversations.ts`'s module doc).

CREATE TYPE retrieval_strategy_source AS ENUM ('Auto', 'Pinned', 'PlaygroundOverride');

CREATE TABLE retrieval_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  conversation_id uuid,
  agent_run_id uuid REFERENCES agent_run (id),
  agent_definition_version_id uuid REFERENCES agent_definition_version (id),
  collection_id uuid NOT NULL REFERENCES knowledge_collection (id),
  generation_id uuid NOT NULL REFERENCES knowledge_index_generation (id),
  strategy retrieval_strategy NOT NULL,
  strategy_source retrieval_strategy_source NOT NULL,
  query_text_hash text NOT NULL,
  query_text_masked text,
  hops smallint NOT NULL DEFAULT 0,
  expansions smallint NOT NULL DEFAULT 0,
  chunk_ids text[] NOT NULL DEFAULT '{}',
  citation_ids text[] NOT NULL DEFAULT '{}',
  top_score real,
  grounded boolean NOT NULL,
  refused boolean NOT NULL DEFAULT false,
  truncated_by_budget boolean NOT NULL DEFAULT false,
  latency_ms integer NOT NULL,
  cost_usd numeric(18,8) NOT NULL DEFAULT 0,
  scope_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retrieval_event_tenant_conversation_created_idx ON retrieval_event (tenant_id, conversation_id, created_at);
CREATE INDEX retrieval_event_tenant_collection_created_idx ON retrieval_event (tenant_id, collection_id, created_at DESC);
CREATE INDEX retrieval_event_tenant_grounded_created_idx ON retrieval_event (tenant_id, grounded, created_at DESC);
-- LLD §14.4.2's coverage-report index: every retrieval that found nothing above a
-- reasonable relevance floor (or nothing at all, top_score IS NULL) — FR-KB-08's
-- "questions asked in production that retrieved nothing above threshold."
CREATE INDEX retrieval_event_tenant_collection_coverage_idx ON retrieval_event (tenant_id, collection_id)
  WHERE top_score IS NULL OR top_score < 0.35;
