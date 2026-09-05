-- Target Architecture Blueprint Phase 7b (BL-38, ADR-0018, LLD §14.4) — Module B:
-- Knowledge and Graph RAG schema. Collections/sources/generations/chunks/embeddings
-- plus the Postgres side of the graph (graph_entity/graph_edge/graph_community —
-- structure+ids only, per ADR-0018's split; the graph store itself is Neo4j,
-- Phase 7a). See packages/db/src/schema/knowledge.ts for the Drizzle mirror and its
-- doc comments (disclosed narrowing: retrieval_event is NOT shipped this phase).
--
-- pgvector is already the platform's image (`pgvector/pgvector:pg16`, HLD §9) but the
-- extension itself was never created before this phase.
CREATE EXTENSION IF NOT EXISTS vector;
-- Needed for graph_entity.canonical_name's trigram search index (the Graph Explorer,
-- Phase 8, will use it; created now alongside the column it indexes).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE knowledge_collection_status AS ENUM ('Draft', 'Building', 'Ready', 'ReEmbedding', 'Stale', 'Failed');
CREATE TYPE knowledge_source_kind AS ENUM ('Upload', 'Url', 'McpResource', 'Connector');
CREATE TYPE knowledge_source_status AS ENUM ('Pending', 'Syncing', 'Synced', 'PartiallyFailed', 'Failed', 'Purged');
CREATE TYPE knowledge_generation_status AS ENUM ('Building', 'Ready', 'Superseded', 'Failed', 'Cancelled');
CREATE TYPE ingestion_stage AS ENUM ('Ingest', 'Parse', 'Chunk', 'ExtractEntities', 'Resolve', 'BuildGraph', 'CommunityDetection', 'CommunitySummaries', 'Embed', 'Index');
CREATE TYPE ingestion_job_status AS ENUM ('Queued', 'Leased', 'Succeeded', 'Failed', 'Skipped', 'Cancelled');
CREATE TYPE retrieval_strategy AS ENUM ('Vector', 'GraphLocal', 'GraphGlobal', 'Hybrid');
CREATE TYPE entity_merge_status AS ENUM ('Pending', 'Merged', 'Rejected');
CREATE TYPE embedding_owner_kind AS ENUM ('Chunk', 'EntitySummary', 'CommunitySummary');

-- ---------------------------------------------------------------------------
-- knowledge_collection (current_generation_id FK added below, once
-- knowledge_index_generation exists — same circular-reference pattern
-- skill/skill_version already established).
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_collection (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  description text,
  region region NOT NULL,
  retention_days integer,
  trust_level text NOT NULL DEFAULT 'SemiTrusted',
  status knowledge_collection_status NOT NULL DEFAULT 'Draft',
  current_generation_id uuid,
  chunking_config jsonb NOT NULL DEFAULT '{"targetTokens":512,"overlapTokens":64,"strategy":"semantic","preserveTables":true}'::jsonb,
  extraction_route_version_id uuid NOT NULL REFERENCES model_route_version (id),
  embedding_route_version_id uuid NOT NULL REFERENCES model_route_version (id),
  rerank_route_version_id uuid REFERENCES model_route_version (id),
  default_strategy retrieval_strategy,
  max_staleness_hours integer,
  min_relevance_score real NOT NULL DEFAULT 0.35,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_collection_min_relevance_score_range CHECK (min_relevance_score >= 0 AND min_relevance_score <= 1),
  CONSTRAINT knowledge_collection_retention_days_valid CHECK (retention_days IS NULL OR retention_days > 0 OR retention_days = -1)
);
CREATE UNIQUE INDEX knowledge_collection_tenant_name_key ON knowledge_collection (tenant_id, name);
CREATE INDEX knowledge_collection_tenant_status_idx ON knowledge_collection (tenant_id, status);
CREATE INDEX knowledge_collection_tenant_current_generation_idx ON knowledge_collection (tenant_id, current_generation_id);

-- ---------------------------------------------------------------------------
-- knowledge_source
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_source (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  collection_id uuid NOT NULL REFERENCES knowledge_collection (id),
  kind knowledge_source_kind NOT NULL,
  name text NOT NULL,
  locator jsonb NOT NULL,
  acl_json jsonb NOT NULL,
  acl_tags text[] NOT NULL DEFAULT '{}'::text[],
  status knowledge_source_status NOT NULL DEFAULT 'Pending',
  document_count integer NOT NULL DEFAULT 0,
  failed_document_count integer NOT NULL DEFAULT 0,
  failures jsonb,
  last_synced_at timestamptz,
  sync_interval_seconds integer,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_source_tenant_collection_name_key ON knowledge_source (tenant_id, collection_id, name);
CREATE INDEX knowledge_source_tenant_collection_status_idx ON knowledge_source (tenant_id, collection_id, status);
CREATE INDEX knowledge_source_tenant_kind_idx ON knowledge_source (tenant_id, kind);
CREATE INDEX knowledge_source_acl_tags_gin_idx ON knowledge_source USING gin (acl_tags);

-- ---------------------------------------------------------------------------
-- knowledge_index_generation (immutable after Ready; FR-KB-03)
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_index_generation (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  collection_id uuid NOT NULL REFERENCES knowledge_collection (id),
  generation integer NOT NULL,
  embedding_provider_id uuid NOT NULL REFERENCES model_provider (id),
  embedding_catalog_entry_id uuid NOT NULL REFERENCES model_catalog_entry (id),
  dimension smallint NOT NULL,
  extraction_catalog_entry_id uuid NOT NULL REFERENCES model_catalog_entry (id),
  graph_generation_label text NOT NULL,
  status knowledge_generation_status NOT NULL DEFAULT 'Building',
  stage_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  chunk_count integer NOT NULL DEFAULT 0,
  entity_count integer NOT NULL DEFAULT 0,
  edge_count integer NOT NULL DEFAULT 0,
  community_count integer NOT NULL DEFAULT 0,
  build_cost_usd numeric(18,8) NOT NULL DEFAULT 0,
  supersedes_generation_id uuid REFERENCES knowledge_index_generation (id),
  built_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_index_generation_dimension_supported CHECK (dimension IN (384, 768, 1024, 1536, 3072))
);
CREATE UNIQUE INDEX knowledge_index_generation_tenant_collection_generation_key ON knowledge_index_generation (tenant_id, collection_id, generation);
CREATE UNIQUE INDEX knowledge_index_generation_graph_label_key ON knowledge_index_generation (graph_generation_label);
CREATE INDEX knowledge_index_generation_tenant_collection_idx ON knowledge_index_generation (tenant_id, collection_id);

ALTER TABLE knowledge_collection
  ADD CONSTRAINT knowledge_collection_current_generation_id_fkey
  FOREIGN KEY (current_generation_id) REFERENCES knowledge_index_generation (id);

-- ---------------------------------------------------------------------------
-- knowledge_document — the level between source and chunk, generation-independent
-- (a re-embed does not re-parse).
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_document (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  source_id uuid NOT NULL REFERENCES knowledge_source (id),
  external_ref text NOT NULL,
  title text,
  mime_type text NOT NULL,
  content_hash text NOT NULL,
  parsed_blocks jsonb,
  page_count integer,
  parse_status knowledge_source_status NOT NULL,
  parse_failure jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_document_tenant_source_external_ref_key ON knowledge_document (tenant_id, source_id, external_ref);
CREATE INDEX knowledge_document_tenant_source_idx ON knowledge_document (tenant_id, source_id);

-- ---------------------------------------------------------------------------
-- knowledge_chunk
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_chunk (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  generation_id uuid NOT NULL REFERENCES knowledge_index_generation (id),
  source_id uuid NOT NULL REFERENCES knowledge_source (id),
  document_id uuid NOT NULL REFERENCES knowledge_document (id),
  ordinal integer NOT NULL,
  text text NOT NULL,
  text_unmasked_ref text,
  token_count integer NOT NULL,
  provenance jsonb NOT NULL,
  acl_tags text[] NOT NULL DEFAULT '{}'::text[],
  pii_mask_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding_bucket smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_chunk_tenant_generation_document_ordinal_key ON knowledge_chunk (tenant_id, generation_id, document_id, ordinal);
CREATE INDEX knowledge_chunk_tenant_generation_source_idx ON knowledge_chunk (tenant_id, generation_id, source_id);
CREATE INDEX knowledge_chunk_tenant_document_idx ON knowledge_chunk (tenant_id, document_id);
CREATE INDEX knowledge_chunk_acl_tags_gin_idx ON knowledge_chunk USING gin (acl_tags);
CREATE INDEX knowledge_chunk_text_tsvector_gin_idx ON knowledge_chunk USING gin (to_tsvector('simple', text));

-- ---------------------------------------------------------------------------
-- knowledge_embedding_d{384,768,1024,1536,3072} — five physically distinct tables
-- (pgvector requires a fixed typmod to build an HNSW index; a variable dimension
-- can't be indexed on one column — LLD §14.4.2's reconciled, deliberate design).
-- No FK on owner_id: it is polymorphic (knowledge_chunk.id / graph_entity.id /
-- graph_community.id, discriminated by `kind`), matching the port-neutral design
-- LLD §14.4.2 specifies.
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_embedding_d384 (
  tenant_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  kind embedding_owner_kind NOT NULL,
  owner_id uuid NOT NULL,
  embedding vector(384) NOT NULL,
  PRIMARY KEY (tenant_id, generation_id, kind, owner_id)
);
CREATE INDEX knowledge_embedding_d384_tenant_generation_kind_idx ON knowledge_embedding_d384 (tenant_id, generation_id, kind);
CREATE INDEX knowledge_embedding_d384_hnsw_idx ON knowledge_embedding_d384 USING hnsw (embedding vector_cosine_ops);

CREATE TABLE knowledge_embedding_d768 (
  tenant_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  kind embedding_owner_kind NOT NULL,
  owner_id uuid NOT NULL,
  embedding vector(768) NOT NULL,
  PRIMARY KEY (tenant_id, generation_id, kind, owner_id)
);
CREATE INDEX knowledge_embedding_d768_tenant_generation_kind_idx ON knowledge_embedding_d768 (tenant_id, generation_id, kind);
CREATE INDEX knowledge_embedding_d768_hnsw_idx ON knowledge_embedding_d768 USING hnsw (embedding vector_cosine_ops);

CREATE TABLE knowledge_embedding_d1024 (
  tenant_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  kind embedding_owner_kind NOT NULL,
  owner_id uuid NOT NULL,
  embedding vector(1024) NOT NULL,
  PRIMARY KEY (tenant_id, generation_id, kind, owner_id)
);
CREATE INDEX knowledge_embedding_d1024_tenant_generation_kind_idx ON knowledge_embedding_d1024 (tenant_id, generation_id, kind);
CREATE INDEX knowledge_embedding_d1024_hnsw_idx ON knowledge_embedding_d1024 USING hnsw (embedding vector_cosine_ops);

CREATE TABLE knowledge_embedding_d1536 (
  tenant_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  kind embedding_owner_kind NOT NULL,
  owner_id uuid NOT NULL,
  embedding vector(1536) NOT NULL,
  PRIMARY KEY (tenant_id, generation_id, kind, owner_id)
);
CREATE INDEX knowledge_embedding_d1536_tenant_generation_kind_idx ON knowledge_embedding_d1536 (tenant_id, generation_id, kind);
CREATE INDEX knowledge_embedding_d1536_hnsw_idx ON knowledge_embedding_d1536 USING hnsw (embedding vector_cosine_ops);

-- pgvector's HNSW index has a hard 2000-dimension ceiling for the full-precision
-- `vector` type (verified against a real pgvector 0.8.6 instance: "column cannot
-- have more than 2000 dimensions for hnsw index"). 3072 (e.g. OpenAI's
-- `text-embedding-3-large`) exceeds it, so this table uses `halfvec`
-- (half-precision, HNSW-indexable up to 4000 dims) instead — a disclosed,
-- necessary correction to LLD §14.4.2's literal `vector(<dim>)` for this one
-- dimension. Every other supported dimension stays full-precision `vector`.
CREATE TABLE knowledge_embedding_d3072 (
  tenant_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  kind embedding_owner_kind NOT NULL,
  owner_id uuid NOT NULL,
  embedding halfvec(3072) NOT NULL,
  PRIMARY KEY (tenant_id, generation_id, kind, owner_id)
);
CREATE INDEX knowledge_embedding_d3072_tenant_generation_kind_idx ON knowledge_embedding_d3072 (tenant_id, generation_id, kind);
CREATE INDEX knowledge_embedding_d3072_hnsw_idx ON knowledge_embedding_d3072 USING hnsw (embedding halfvec_cosine_ops);

-- ---------------------------------------------------------------------------
-- graph_entity / graph_edge / graph_community — the Postgres side of ADR-0018's
-- split (identity/metadata/summary text; the graph store holds structure+ids only).
-- graph_entity.community_id FK added below, once graph_community exists.
-- ---------------------------------------------------------------------------
CREATE TABLE graph_entity (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  generation_id uuid NOT NULL REFERENCES knowledge_index_generation (id),
  canonical_name text NOT NULL,
  type text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  summary text,
  community_id uuid,
  degree integer NOT NULL DEFAULT 0,
  acl_tags text[] NOT NULL DEFAULT '{}'::text[],
  mention_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX graph_entity_tenant_generation_type_canonical_name_key ON graph_entity (tenant_id, generation_id, type, canonical_name);
CREATE INDEX graph_entity_tenant_generation_community_idx ON graph_entity (tenant_id, generation_id, community_id);
CREATE INDEX graph_entity_tenant_generation_degree_idx ON graph_entity (tenant_id, generation_id, degree);
CREATE INDEX graph_entity_aliases_gin_idx ON graph_entity USING gin (aliases);
CREATE INDEX graph_entity_acl_tags_gin_idx ON graph_entity USING gin (acl_tags);
CREATE INDEX graph_entity_canonical_name_trgm_idx ON graph_entity USING gin (canonical_name gin_trgm_ops);

CREATE TABLE graph_edge (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  generation_id uuid NOT NULL REFERENCES knowledge_index_generation (id),
  src_entity_id uuid NOT NULL REFERENCES graph_entity (id),
  dst_entity_id uuid NOT NULL REFERENCES graph_entity (id),
  relation text NOT NULL,
  weight real NOT NULL DEFAULT 1.0,
  confidence real NOT NULL,
  provenance_chunk_id uuid NOT NULL REFERENCES knowledge_chunk (id),
  provenance_span jsonb,
  acl_tags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_edge_no_self_loop CHECK (src_entity_id <> dst_entity_id),
  CONSTRAINT graph_edge_weight_positive CHECK (weight > 0),
  CONSTRAINT graph_edge_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);
CREATE UNIQUE INDEX graph_edge_tenant_generation_src_dst_relation_chunk_key ON graph_edge (tenant_id, generation_id, src_entity_id, dst_entity_id, relation, provenance_chunk_id);
CREATE INDEX graph_edge_tenant_generation_src_idx ON graph_edge (tenant_id, generation_id, src_entity_id);
CREATE INDEX graph_edge_tenant_generation_dst_idx ON graph_edge (tenant_id, generation_id, dst_entity_id);
CREATE INDEX graph_edge_tenant_provenance_chunk_idx ON graph_edge (tenant_id, provenance_chunk_id);

CREATE TABLE graph_community (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  generation_id uuid NOT NULL REFERENCES knowledge_index_generation (id),
  level smallint NOT NULL DEFAULT 0,
  parent_id uuid REFERENCES graph_community (id),
  external_key text NOT NULL,
  title text,
  summary text,
  summary_stale boolean NOT NULL DEFAULT true,
  entity_count integer NOT NULL DEFAULT 0,
  acl_tags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_community_level_range CHECK (level >= 0 AND level <= 8),
  CONSTRAINT graph_community_parent_requires_level CHECK (parent_id IS NULL OR level > 0)
);
CREATE UNIQUE INDEX graph_community_tenant_generation_level_external_key_key ON graph_community (tenant_id, generation_id, level, external_key);
CREATE INDEX graph_community_tenant_generation_idx ON graph_community (tenant_id, generation_id);

ALTER TABLE graph_entity
  ADD CONSTRAINT graph_entity_community_id_fkey
  FOREIGN KEY (community_id) REFERENCES graph_community (id);

-- ---------------------------------------------------------------------------
-- graph_entity_merge_candidate — the Resolve stage's human review queue (FR-KB-02)
-- ---------------------------------------------------------------------------
CREATE TABLE graph_entity_merge_candidate (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  generation_id uuid NOT NULL REFERENCES knowledge_index_generation (id),
  left_entity_id uuid NOT NULL REFERENCES graph_entity (id),
  right_entity_id uuid NOT NULL REFERENCES graph_entity (id),
  similarity real NOT NULL,
  rationale text NOT NULL,
  status entity_merge_status NOT NULL DEFAULT 'Pending',
  decided_by_user_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX graph_entity_merge_candidate_tenant_generation_pair_key ON graph_entity_merge_candidate (tenant_id, generation_id, least(left_entity_id, right_entity_id), greatest(left_entity_id, right_entity_id));
CREATE INDEX graph_entity_merge_candidate_tenant_generation_status_idx ON graph_entity_merge_candidate (tenant_id, generation_id, status);

-- ---------------------------------------------------------------------------
-- knowledge_ingestion_job — the Postgres work table drained by the scheduled pump
-- (LLD §14.4.3 — no queue library exists in this codebase; FOR UPDATE SKIP LOCKED
-- leases, same idiom as every other apps/worker job).
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_ingestion_job (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  generation_id uuid NOT NULL REFERENCES knowledge_index_generation (id),
  source_id uuid REFERENCES knowledge_source (id),
  document_id uuid REFERENCES knowledge_document (id),
  stage ingestion_stage NOT NULL,
  stage_ordinal smallint NOT NULL,
  status ingestion_job_status NOT NULL DEFAULT 'Queued',
  attempt smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at timestamptz,
  depends_on_job_id uuid REFERENCES knowledge_ingestion_job (id),
  input jsonb,
  output jsonb,
  error jsonb,
  cost_usd numeric(18,8) NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX knowledge_ingestion_job_tenant_generation_stage_status_idx ON knowledge_ingestion_job (tenant_id, generation_id, stage_ordinal, status);
CREATE INDEX knowledge_ingestion_job_pump_claim_idx ON knowledge_ingestion_job (status, lease_expires_at);
-- The idempotency key: re-enqueuing the same unit of work is a no-op.
CREATE UNIQUE INDEX knowledge_ingestion_job_idempotency_key ON knowledge_ingestion_job (tenant_id, generation_id, stage, coalesce(document_id, source_id, generation_id));
