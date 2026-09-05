-- Phase 12b (BL-045/047) — additive column for the metadata-filter
-- retrieval stage. Prisma-generated; no hand-added SQL needed (unlike
-- `embedding`/`search_vector`, `Json` has a first-class Prisma column type).
ALTER TABLE "knowledge_chunk" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
