-- Target Architecture Blueprint Phase 7b (BL-38) — RLS for every new tenant-scoped
-- knowledge table (LLD §3.2 rule 1). knowledge_embedding_d* tables are included —
-- they carry tenant_id directly even though it's not FK-constrained (polymorphic
-- owner_id), so the same single-clause policy applies.

ALTER TABLE knowledge_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_collection FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_collection
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_source FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_source
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_index_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_index_generation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_index_generation
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_document
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunk FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_chunk
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_embedding_d384 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embedding_d384 FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_embedding_d384
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_embedding_d768 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embedding_d768 FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_embedding_d768
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_embedding_d1024 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embedding_d1024 FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_embedding_d1024
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_embedding_d1536 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embedding_d1536 FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_embedding_d1536
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_embedding_d3072 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embedding_d3072 FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_embedding_d3072
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE graph_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON graph_entity
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE graph_edge ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON graph_edge
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE graph_community ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_community FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON graph_community
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE graph_entity_merge_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entity_merge_candidate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON graph_entity_merge_candidate
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_ingestion_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_ingestion_job FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_ingestion_job
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
