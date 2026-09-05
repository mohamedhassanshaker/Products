-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('upload');

-- CreateEnum
CREATE TYPE "KnowledgeParser" AS ENUM ('plain_text', 'markdown', 'pdf');

-- CreateEnum
CREATE TYPE "ChunkingStrategy" AS ENUM ('fixed', 'semantic', 'heading_aware');

-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "knowledge_source" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "source_type" "KnowledgeSourceType" NOT NULL DEFAULT 'upload',
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "raw_content" BYTEA NOT NULL,
    "parser" "KnowledgeParser" NOT NULL DEFAULT 'plain_text',
    "parser_config" JSONB NOT NULL DEFAULT '{}',
    "chunking_strategy" "ChunkingStrategy" NOT NULL DEFAULT 'fixed',
    "chunk_size" INTEGER NOT NULL DEFAULT 800,
    "chunk_overlap" INTEGER NOT NULL DEFAULT 100,
    "embedding_model" VARCHAR(80) NOT NULL DEFAULT 'text-embedding-3-small',
    "embedding_credential_ref" VARCHAR(256),
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'pending',
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" VARCHAR(500),
    "config_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_indexed_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "knowledge_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Note: "embedding" is emitted here by Prisma itself from the schema's
-- `Unsupported("vector(1536)")` field — Prisma echoes the raw type string
-- literally, so no hand-added ALTER TABLE is needed for that column.
-- "search_vector" is deliberately NOT included here (see the hand-added
-- block below): Prisma's `Unsupported("tsvector")` only carries the column
-- type, not a `GENERATED ALWAYS AS (...) STORED` expression, so a plain
-- (always-NULL) column generated here would be wrong.
CREATE TABLE "knowledge_chunk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_gap" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_id" UUID,
    "query" VARCHAR(1000) NOT NULL,
    "best_score" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_gap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_source_tenant_id_status_idx" ON "knowledge_source"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_chunk_tenant_id_idx" ON "knowledge_chunk"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunk_source_id_chunk_index_key" ON "knowledge_chunk"("source_id", "chunk_index");

-- CreateIndex
CREATE INDEX "knowledge_gap_tenant_id_created_at_idx" ON "knowledge_gap"("tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added: Prisma has no first-class pgvector/tsvector column type
-- (ARCHITECTURE_NOTES.md §4.1). The `embedding` column above was emitted
-- by Prisma itself (it echoes the raw type string from
-- `Unsupported("vector(1536)")` literally into the CREATE TABLE), so only
-- `search_vector` needs adding here — Prisma's `Unsupported("tsvector")`
-- cannot express the `GENERATED ALWAYS AS (...) STORED` expression, so the
-- real, self-populating column definition is hand-written.
ALTER TABLE "knowledge_chunk" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED;

-- Hand-added: ANN index. HNSW chosen over IVFFlat — no training/list-count
-- tuning step needed and gives good recall immediately on a table that
-- starts empty per-tenant and grows source-by-source (an IVFFlat index's
-- centroids are only as good as the data present when it's built). Requires
-- pgvector >= 0.5.0.
CREATE INDEX "knowledge_chunk_embedding_hnsw_idx" ON "knowledge_chunk" USING hnsw ("embedding" vector_cosine_ops);

-- Hand-added: GIN index for the generated tsvector column — the
-- conventional index type for full-text search, added now since Phase 12b's
-- hybrid search will read this column (Phase 12a does not query it).
CREATE INDEX "knowledge_chunk_search_vector_idx" ON "knowledge_chunk" USING gin ("search_vector");
