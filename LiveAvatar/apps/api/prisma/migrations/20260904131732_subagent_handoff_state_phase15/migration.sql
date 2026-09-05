-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'handoff_requested';

-- Pre-existing Prisma/schema drift note: `prisma migrate dev`'s diff also
-- proposed dropping `knowledge_chunk_embedding_hnsw_idx` /
-- `knowledge_chunk_search_vector_idx` and clearing `search_vector`'s
-- generated-column default — the same known false-positive documented in
-- the `hitl_phase14` and `skills_phase13` migrations (caused by
-- `Unsupported("tsvector")` not round-tripping the GENERATED ALWAYS AS
-- expression those indexes depend on). Deliberately excluded again here.
