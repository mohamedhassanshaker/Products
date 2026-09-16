/* =====================================================================================
   SHJ3 — 002_tenant_grants.sql
   RB-09 step 1c: the least-privilege grants on ONE tenant's schema.

   ADR-0005 rule 5, stated there and worth restating here because it is the reason this
   file exists at all: *"Write permissions are enforced at the database level, not by
   convention … Code review is not the control; the grant is."*

   So `shj3-ai` reading a tenant table it has no business in fails **at SQL Server**,
   whatever the application code did — which is the only limb of the isolation argument
   that survives a defect in the data-access layer. It runs AFTER the template DDL,
   because a table-scoped grant cannot name a table that does not exist yet.

   Every statement is guarded on principal existence, because the four service principals
   are created by the environment's bootstrap and are absent in local development, where
   a single `sa` connection serves every role. A missing principal must make this file a
   no-op rather than a failure — otherwise `docker compose up` could not provision a
   tenant, and the local isolation suite (deployment.md §6.4) would have nothing to run
   against.

   Table-scoped statements are additionally guarded on `OBJECT_ID`, so a tenant schema
   provisioned before those tables entered the model still applies the rest of the file.

   {{SCHEMA}} is substituted with `sqlSchemaFor(<registry-validated slug>)`.
   ===================================================================================== */

-- -------------------------------------------------------------------------------------
-- The application principal: full DML on the tenant's own schema, nothing outside it.
-- -------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_app')
  EXEC(N'GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[{{SCHEMA}}] TO shj3_app');

-- -------------------------------------------------------------------------------------
-- The AI runtime: read-only across the schema, and INSERT/UPDATE on exactly three table
-- groups (ADR-0005). The negative half of this grant is the important half — RB-11
-- check 4 asserts that `INSERT INTO <tenant>.Agents` as this principal FAILS, because a
-- positive-only grant test proves nothing.
-- -------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_ai_ro')
BEGIN
  EXEC(N'GRANT SELECT ON SCHEMA::[{{SCHEMA}}] TO shj3_ai_ro');

  IF OBJECT_ID(N'[{{SCHEMA}}].[ConversationTurns]') IS NOT NULL
    EXEC(N'GRANT INSERT, UPDATE ON [{{SCHEMA}}].[ConversationTurns] TO shj3_ai_ro');

  IF OBJECT_ID(N'[{{SCHEMA}}].[OrchestrationTraces]') IS NOT NULL
    EXEC(N'GRANT INSERT, UPDATE ON [{{SCHEMA}}].[OrchestrationTraces] TO shj3_ai_ro');

  -- B-5 (agent runtime): the "orchestration traces" write group named in
  -- architecture.md §6 and ADR-0005 rule 5 is really the trace AND its two
  -- child record types the pipeline writes in the same turn -- a per-step trace
  -- row (OrchestrationTraceSteps) and a per-cited-passage row
  -- (GroundingCitations, api.md §5.3's `sources[]`). Both were left out of this
  -- file when it was first written (before the module that needed them
  -- existed); found and fixed here rather than routing the write through a
  -- table this principal already had a grant on, which would have silently
  -- misattributed step- and citation-level detail to the parent trace row.
  IF OBJECT_ID(N'[{{SCHEMA}}].[OrchestrationTraceSteps]') IS NOT NULL
    EXEC(N'GRANT INSERT, UPDATE ON [{{SCHEMA}}].[OrchestrationTraceSteps] TO shj3_ai_ro');

  IF OBJECT_ID(N'[{{SCHEMA}}].[GroundingCitations]') IS NOT NULL
    EXEC(N'GRANT INSERT, UPDATE ON [{{SCHEMA}}].[GroundingCitations] TO shj3_ai_ro');

  -- RB-09 step 1 calls this group `ReindexJobStatus`; the model settled on `ReindexJobs`
  -- (schema.prisma `@@map("ReindexJobs")`). The schema is the fact.
  IF OBJECT_ID(N'[{{SCHEMA}}].[ReindexJobs]') IS NOT NULL
    EXEC(N'GRANT INSERT, UPDATE ON [{{SCHEMA}}].[ReindexJobs] TO shj3_ai_ro');
END
GO

-- -------------------------------------------------------------------------------------
-- The tenant audit log is append-only for EVERY principal, including Super Admin
-- (B14 tab 2). DENY outranks GRANT in SQL Server, so this survives the schema-wide
-- grant above rather than racing it.
-- -------------------------------------------------------------------------------------
IF OBJECT_ID(N'[{{SCHEMA}}].[AuditLogEntries]') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_app')
    EXEC(N'DENY UPDATE, DELETE ON [{{SCHEMA}}].[AuditLogEntries] TO shj3_app');
  IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_ai_ro')
    EXEC(N'DENY UPDATE, DELETE ON [{{SCHEMA}}].[AuditLogEntries] TO shj3_ai_ro');
END
GO
