/* =====================================================================================
   SHJ3 — 001_constraints.sql
   Everything data-model.md specifies that Prisma's SQL Server connector cannot declare.

   Prisma owns the schema (ADR-0005) and this file is owned by Prisma's migration
   history: ADR-0005's consequence is explicit — "where a feature is unavailable, the
   migration carries hand-written SQL in the migration file — still owned by Prisma's
   history." Nothing here is optional and nothing here is a workaround; each object is a
   business rule that Prisma has no syntax for.

   WHAT PRISMA CANNOT DECLARE, AND IS THEREFORE HERE
     · CHECK constraints                (§1.5 — the enum mechanism)
     · filtered / partial indexes       (§1.5 — "used heavily below to encode business
                                          rules"; every one is named in §4)
     · computed / PERSISTED columns     (§4.4, §4.7, §4.10, §4.12, §9.4)
     · triggers                         (§3.4, §4.x, §10.4)
     · views                            (§4.10 CampaignStates)
     · GRANT / DENY                     (ADR-0005 rule 5 — "code review is not the
                                          control; the grant is")
     · full-text indexes                (§4.17 — the user-guide search)
     · datetime2 precision              (§1.3 — @db.DateTime2 takes no argument)

   ------------------------------------------------------------------------------------
   HOW THIS FILE IS APPLIED — two sections, two different cardinalities
   ------------------------------------------------------------------------------------
   SECTION 1 · PLATFORM   Applied ONCE, against the literal `platform` schema.
   SECTION 2 · TENANT     Applied ONCE PER TENANT SCHEMA. The orchestrator substitutes
                          the token {{SCHEMA}} with the tenant's registry-derived,
                          pattern-validated slug (`sewa`, `customs`, `libraries`,
                          `sharjah_platform`, …) before execution.

   The orchestrator splits the file at the `-- === SECTION BOUNDARY ===` marker below and
   runs section 1 once and section 2 N times. It MUST NOT run section 2 against
   `platform`, nor section 1 against a tenant schema: the two sections name different
   tables and a cross-application would fail on object resolution.

   Within a section, statements are separated into batches at lines consisting solely of
   `GO` (the usual sqlcmd convention; `GO` is a client-side batch separator, not T-SQL, so
   the orchestrator strips those lines and submits each batch on its own). Batches exist
   only where a local variable's scope must end; every DDL statement here is otherwise
   batch-position-independent.

   {{SCHEMA}} is never interpolated from user input. It comes from `platform.Tenants`,
   which `CK_Tenants_slugPattern` has already constrained to `^[a-z][a-z0-9_]{2,29}$`
   with the reserved slugs excluded — ADR-0002 enforcement rule 4, which is what closes
   the identifier-injection path.

   EVERY statement is idempotent: re-applying the file is a no-op, which is what makes an
   N-tenant run resumable after partial failure (ADR-0005 §2). Constraint and index names
   are unqualified within a schema, so the same names recur in every tenant schema
   without collision — that is the point of schema-per-tenant.

   Minimum server: **SQL Server 2016 SP1** — `CREATE OR ALTER`, `STRING_SPLIT`-era T-SQL,
   `ISJSON` / `JSON_VALUE` and filtered-index features are all assumed.

   Triggers and views use `EXEC(N'CREATE OR ALTER …')` rather than a bare CREATE: those
   statements must be first in their batch, and wrapping them in dynamic SQL makes them
   idempotent without needing GO separators the orchestrator would have to parse.
   ===================================================================================== */


/* =====================================================================================
   -- @section: platform
   SECTION 1 · PLATFORM SCHEMA — apply exactly once
   ===================================================================================== */

-- -------------------------------------------------------------------------------------
-- 1.0  Timestamp precision (§1.3)
--      "Millisecond precision (3). Sufficient for audit ordering and cheaper than the
--      default (7)." Prisma's `@db.DateTime2` takes no precision argument, so the
--      connector emits datetime2(7) and this pass narrows it.
--      Columns that participate in an index key or INCLUDE list are skipped: SQL Server
--      refuses ALTER COLUMN on an indexed column, and dropping/recreating Prisma-owned
--      indexes from this file would put index definitions in two places. Those columns
--      keep datetime2(7), which stores exactly the same values — the data-access layer
--      serialises only millisecond-truncated UTC instants (§1.3) — at 2 bytes more per
--      row. Accepted, and recorded here rather than left to be discovered.
-- -------------------------------------------------------------------------------------
DECLARE @precisionSql NVARCHAR(MAX) = N'';
SELECT @precisionSql = @precisionSql
     + N'ALTER TABLE [platform].[' + t.name + N'] ALTER COLUMN [' + c.name + N'] datetime2(3) '
     + CASE WHEN c.is_nullable = 1 THEN N'NULL;' ELSE N'NOT NULL;' END + NCHAR(10)
FROM sys.columns  c
JOIN sys.tables   t  ON t.object_id     = c.object_id
JOIN sys.schemas  s  ON s.schema_id     = t.schema_id
JOIN sys.types    ty ON ty.user_type_id = c.user_type_id
WHERE s.name = N'platform'
  AND ty.name = N'datetime2'
  AND c.scale <> 3
  AND c.is_computed = 0
  AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic
                  WHERE ic.object_id = c.object_id AND ic.column_id = c.column_id);
IF LEN(@precisionSql) > 0 EXEC sys.sp_executesql @precisionSql;
GO

-- -------------------------------------------------------------------------------------
-- 1.1  platform.Tenants — the registry (§4.1, ADR-0002, ADR-0009, B9 tab 2)
-- -------------------------------------------------------------------------------------

-- CK_Tenants_slugPattern (§3.1). The slug reaches a connection string, a Qdrant
-- collection name AND a Cypher label, so validating it here is what closes the
-- identifier-injection path that logical graph partitioning would otherwise open
-- (ADR-0002 rule 4, ADR-0009 rule 3).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Tenants_slugPattern')
  ALTER TABLE [platform].[Tenants] WITH CHECK ADD CONSTRAINT CK_Tenants_slugPattern
    CHECK (slug LIKE '[a-z]%' AND slug NOT LIKE '%[^a-z0-9_]%' AND LEN(slug) BETWEEN 3 AND 30
       AND slug NOT IN ('platform','dbo','sys','guest','INFORMATION_SCHEMA','db_owner',
                        'db_accessadmin','db_securityadmin','db_ddladmin','db_backupoperator',
                        'db_datareader','db_datawriter','db_denydatareader','db_denydatawriter'));

-- CK_Tenants_status (§4.1). Closed set, per §1.5.
--
-- 'Failed' added after the original set (2026-09-08): ProvisionTenant's compensating
-- rollback needs a terminal state for a tenant that never reached Active, distinct from
-- 'Deprovisioned' (which implies it once was live). Conflating the two would lose exactly
-- the fact an operator investigating a stuck slug needs — whether the tenant was ever
-- actually serving traffic. Found running the real rollback path against a live database:
-- the original constraint rejected the write and masked the true provisioning error behind
-- a second one.
--
-- IF NOT EXISTS guards a *name* match, so changing an existing constraint's definition (as
-- this edit does) needs an explicit drop first, or the guard sees the old definition as
-- "already exists" and never applies the new CHECK list.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Tenants_status')
  ALTER TABLE [platform].[Tenants] DROP CONSTRAINT CK_Tenants_status;
ALTER TABLE [platform].[Tenants] WITH CHECK ADD CONSTRAINT CK_Tenants_status
  CHECK (status IN ('Provisioning','Active','Suspended','Deprovisioning','Deprovisioned','Failed'));

-- CK_Tenants_entityKind (§4.1, B9 tab 2 entity scopes).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Tenants_entityKind')
  ALTER TABLE [platform].[Tenants] WITH CHECK ADD CONSTRAINT CK_Tenants_entityKind
    CHECK (entityKind IN ('GovernmentEntity','PlatformOperator'));

-- CK_Tenants_derivedNames (§4.1, ADR-0002 rule 4, ADR-0009). The four isolation-unit
-- names are DERIVED, not typed — a graph label can never be hand-entered.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Tenants_derivedNames')
  ALTER TABLE [platform].[Tenants] WITH CHECK ADD CONSTRAINT CK_Tenants_derivedNames
    CHECK (sqlSchema = slug AND redisPrefix = slug AND neo4jTenantLabel = 'Tenant_' + slug);

-- CK_Tenants_statusTimestamps (§4.1). A deprovisioned tenant carries its timestamp.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Tenants_statusTimestamps')
  ALTER TABLE [platform].[Tenants] WITH CHECK ADD CONSTRAINT CK_Tenants_statusTimestamps
    CHECK ((status <> 'Active'        OR activatedAt      IS NOT NULL)
       AND (status <> 'Suspended'     OR suspendedAt      IS NOT NULL)
       AND (status <> 'Deprovisioned' OR deprovisionedAt  IS NOT NULL));

-- TR_Tenants_activationRequiresFourSteps (§4.1, ADR-0002 rule 6). "A half-provisioned
-- tenant is the one state where isolation reasoning breaks down", so activation is
-- refused until all four store steps are Completed. Provisioning atomicity survives
-- ADR-0009's change from DROP DATABASE to a batched label delete: the four-row shape is
-- untouched.
EXEC(N'
CREATE OR ALTER TRIGGER [platform].[TR_Tenants_activationRequiresFourSteps]
ON [platform].[Tenants] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    WHERE i.status = ''Active''
      AND (SELECT COUNT(*) FROM [platform].[TenantProvisioningSteps] p
           WHERE p.tenantId = i.id AND p.state = ''Completed'') < 4)
    THROW 51010, ''A tenant cannot become Active until all four store provisioning steps are Completed (ADR-0002 rule 6).'', 1;
END');

-- TR_Tenants_syncProfiles (§4.1). Mirrors the registry row into the tenant''s own
-- TenantProfiles singleton, so per-tenant triggers and queries can read tenant facts
-- without a cross-schema join and a restored schema is self-describing. The schema name
-- is taken from the row, which CK_Tenants_derivedNames and CK_Tenants_slugPattern have
-- already constrained — never from input.
EXEC(N'
CREATE OR ALTER TRIGGER [platform].[TR_Tenants_syncProfiles]
ON [platform].[Tenants] AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @slug sysname, @sql NVARCHAR(MAX);
  DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT i.sqlSchema FROM inserted i
    JOIN deleted d ON d.id = i.id
    WHERE i.displayName <> d.displayName OR i.dataResidency <> d.dataResidency;
  OPEN c; FETCH NEXT FROM c INTO @slug;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF EXISTS (SELECT 1 FROM sys.schemas WHERE name = @slug)
    BEGIN
      SET @sql = N''UPDATE p SET p.displayName = t.displayName, p.dataResidency = t.dataResidency,
                                p.updatedAt = SYSUTCDATETIME()
                    FROM '' + QUOTENAME(@slug) + N''.[TenantProfiles] p
                    JOIN [platform].[Tenants] t ON t.sqlSchema = '''''' + @slug + '''''';'';
      EXEC sys.sp_executesql @sql;
    END
    FETCH NEXT FROM c INTO @slug;
  END
  CLOSE c; DEALLOCATE c;
END');

-- -------------------------------------------------------------------------------------
-- 1.2  platform.TenantProvisioningSteps / TenantMigrations / MigrationRuns
--      (§4.1, ADR-0002 rule 6, ADR-0005 §2)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantProvisioningSteps_store')
  ALTER TABLE [platform].[TenantProvisioningSteps] WITH CHECK ADD CONSTRAINT CK_TenantProvisioningSteps_store
    CHECK (store IN ('SqlServer','Neo4j','Qdrant','Redis'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantProvisioningSteps_state')
  ALTER TABLE [platform].[TenantProvisioningSteps] WITH CHECK ADD CONSTRAINT CK_TenantProvisioningSteps_state
    CHECK (state IN ('Pending','Running','Completed','Failed','RolledBack'));

-- 'Running' added (theming backend wave, 2026-09-09): a real, pre-existing gap
-- found by actually wiring the first production MigrationExecutor/MigrationStatusStore
-- and running a real migration through RunTenantMigrations end-to-end — its own
-- execute() unconditionally writes status "Running" before "Applied"/"Failed" for
-- every tenant on every run (application/run-tenant-migrations.ts), so the original,
-- narrower closed set here blocked the very first status write on every single
-- invocation, not merely an edge case (unlike the analogous, deliberately-undone
-- CK_Tenants_status/"Failed" gap tenant-registry.ts's own module comment documents —
-- that one guards a rare failure-recovery path, this one guards the happy path).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantMigrations_state')
  ALTER TABLE [platform].[TenantMigrations] WITH CHECK ADD CONSTRAINT CK_TenantMigrations_state
    CHECK (state IN ('Pending','Running','Applied','Failed','Skipped'));

-- CK_TenantMigrations_appliedHasTime (§4.1). An Applied migration with no timestamp
-- would make the resumable orchestrator unable to order its own history.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantMigrations_appliedHasTime')
  ALTER TABLE [platform].[TenantMigrations] WITH CHECK ADD CONSTRAINT CK_TenantMigrations_appliedHasTime
    CHECK (state <> 'Applied' OR appliedAt IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MigrationRuns_state')
  ALTER TABLE [platform].[MigrationRuns] WITH CHECK ADD CONSTRAINT CK_MigrationRuns_state
    CHECK (state IN ('Running','Completed','Failed','PartiallyApplied','Resumed'));

-- CK_MigrationRuns_json (§4.1, §1.5 JSON rule).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MigrationRuns_json')
  ALTER TABLE [platform].[MigrationRuns] WITH CHECK ADD CONSTRAINT CK_MigrationRuns_json
    CHECK (ISJSON(migrationNamesJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MigrationRuns_counts')
  ALTER TABLE [platform].[MigrationRuns] WITH CHECK ADD CONSTRAINT CK_MigrationRuns_counts
    CHECK (tenantsApplied + tenantsFailed <= tenantsTotal);

-- -------------------------------------------------------------------------------------
-- 1.3  platform.Environments — the promotion chain (§4.1, B14 tab 1, architecture §12)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Environments_key')
  ALTER TABLE [platform].[Environments] WITH CHECK ADD CONSTRAINT CK_Environments_key
    CHECK ([key] IN ('development','uat','production'));

-- CK_Environments_noSelfPromotion (§4.1). An environment cannot promote to itself.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Environments_noSelfPromotion')
  ALTER TABLE [platform].[Environments] WITH CHECK ADD CONSTRAINT CK_Environments_noSelfPromotion
    CHECK (promotesToKey IS NULL OR promotesToKey <> [key]);

-- CK_Environments_terminalIsLive (§4.1). The end of the chain is the live environment,
-- by construction rather than by convention.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Environments_terminalIsLive')
  ALTER TABLE [platform].[Environments] WITH CHECK ADD CONSTRAINT CK_Environments_terminalIsLive
    CHECK (CAST(CASE WHEN promotesToKey IS NULL THEN 1 ELSE 0 END AS bit) = isLive);

-- UQ_Environments_isLive (§4.1) — FILTERED. Exactly one live environment; two would make
-- TR_PromotionRequests_gateMustPass ambiguous about which promotion the gate guards.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Environments_isLive'
               AND object_id = OBJECT_ID('[platform].[Environments]'))
  CREATE UNIQUE INDEX UQ_Environments_isLive ON [platform].[Environments](isLive) WHERE isLive = 1;

-- -------------------------------------------------------------------------------------
-- 1.4  platform.Policies / OverridablePolicies — the platform floor (§3.4, B12 tab 1)
--      "Locked policies cannot be toggled or overridden by any role. Attempting to
--      toggle them does nothing — the platform floor is not negotiable per entity."
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Policies_kind')
  ALTER TABLE [platform].[Policies] WITH CHECK ADD CONSTRAINT CK_Policies_kind
    CHECK (kind IN ('Boolean','Threshold','Enum'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Policies_appliesTo')
  ALTER TABLE [platform].[Policies] WITH CHECK ADD CONSTRAINT CK_Policies_appliesTo
    CHECK (appliesTo IN ('Runtime','Storage'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Policies_defaultValueJson_isJson')
  ALTER TABLE [platform].[Policies] WITH CHECK ADD CONSTRAINT CK_Policies_defaultValueJson_isJson
    CHECK (ISJSON(defaultValueJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Policies_floorValueJson_isJson')
  ALTER TABLE [platform].[Policies] WITH CHECK ADD CONSTRAINT CK_Policies_floorValueJson_isJson
    CHECK (floorValueJson IS NULL OR ISJSON(floorValueJson) = 1);

-- TR_Policies_syncOverridable (§3.4). Keeps the subset table honest: isLocked = 0 inserts
-- the key, flipping to 1 deletes it — cascading every tenant setting and per-agent
-- override away, which is the correct behaviour because locking a policy retracts every
-- existing override — and flipping back to 0 re-inserts it. This trigger is the reason
-- the per-tenant FKs can do the enforcement instead of application code.
EXEC(N'
CREATE OR ALTER TRIGGER [platform].[TR_Policies_syncOverridable]
ON [platform].[Policies] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  DELETE o FROM [platform].[OverridablePolicies] o
  JOIN inserted i ON i.policyKey = o.policyKey
  WHERE i.isLocked = 1;

  INSERT INTO [platform].[OverridablePolicies](policyKey, createdAt, updatedAt)
  SELECT i.policyKey, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM inserted i
  WHERE i.isLocked = 0
    AND NOT EXISTS (SELECT 1 FROM [platform].[OverridablePolicies] o WHERE o.policyKey = i.policyKey);
END');

-- -------------------------------------------------------------------------------------
-- 1.5  platform.Locales — the reference catalogue (§4.1, B10 tab 5)
-- -------------------------------------------------------------------------------------

-- CK_Locales_direction (§4.1). Direction is a property of the language, not of a
-- tenant's opinion of it — which is why it lives here and not in LocaleSettings.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Locales_direction')
  ALTER TABLE [platform].[Locales] WITH CHECK ADD CONSTRAINT CK_Locales_direction
    CHECK (direction IN ('LTR','RTL'));

-- CK_Locales_codePattern (§4.1). BCP-47: language, optional script/region subtags.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Locales_codePattern')
  ALTER TABLE [platform].[Locales] WITH CHECK ADD CONSTRAINT CK_Locales_codePattern
    CHECK (code LIKE '[a-z][a-z]' OR code LIKE '[a-z][a-z]-%' OR code LIKE '[a-z][a-z][a-z]' OR code LIKE '[a-z][a-z][a-z]-%');

-- -------------------------------------------------------------------------------------
-- 1.6  platform.VectorCollectionRegistry (§4.1, §7)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VectorCollectionRegistry_state')
  ALTER TABLE [platform].[VectorCollectionRegistry] WITH CHECK ADD CONSTRAINT CK_VectorCollectionRegistry_state
    CHECK (state IN ('Building','Active','Retiring','Retired'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VectorCollectionRegistry_distance')
  ALTER TABLE [platform].[VectorCollectionRegistry] WITH CHECK ADD CONSTRAINT CK_VectorCollectionRegistry_distance
    CHECK (distance IN ('Cosine','Dot','Euclid'));

-- CK_VectorCollectionRegistry_dimension (§4.1, §7.2). Only the two dimensions the
-- platform issues; anything else means a mixed-model collection.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VectorCollectionRegistry_dimension')
  ALTER TABLE [platform].[VectorCollectionRegistry] WITH CHECK ADD CONSTRAINT CK_VectorCollectionRegistry_dimension
    CHECK (embeddingDimension IN (1536, 3072));

-- UQ_VectorCollectionRegistry_tenantId_active (§4.1) — FILTERED. A tenant has exactly
-- one live collection; the alias switch of §7.5 is what makes a rebuild atomic.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_VectorCollectionRegistry_tenantId_active'
               AND object_id = OBJECT_ID('[platform].[VectorCollectionRegistry]'))
  CREATE UNIQUE INDEX UQ_VectorCollectionRegistry_tenantId_active
    ON [platform].[VectorCollectionRegistry](tenantId) WHERE state = 'Active';

-- -------------------------------------------------------------------------------------
-- 1.7  platform.PlatformAuditLogEntries — append-only (§3.3, B14 tab 2, architecture §10)
--      "Entries cannot be edited or deleted by any role, including Super Admin."
-- -------------------------------------------------------------------------------------

-- TR_PlatformAuditLogEntries_blockMutation (§3.3, §4.13 mechanism 2). Covers a future
-- db_owner connection, a migration, or a DBA session that the grants below do not
-- constrain.
EXEC(N'
CREATE OR ALTER TRIGGER [platform].[TR_PlatformAuditLogEntries_blockMutation]
ON [platform].[PlatformAuditLogEntries] INSTEAD OF UPDATE, DELETE AS
BEGIN
  THROW 51001, ''PlatformAuditLogEntries is append-only. See data-model.md §3.3, B14 tab 2 and architecture.md §10.'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformAuditLogEntries_beforeJson_isJson')
  ALTER TABLE [platform].[PlatformAuditLogEntries] WITH CHECK ADD CONSTRAINT CK_PlatformAuditLogEntries_beforeJson_isJson
    CHECK (beforeJson IS NULL OR ISJSON(beforeJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformAuditLogEntries_afterJson_isJson')
  ALTER TABLE [platform].[PlatformAuditLogEntries] WITH CHECK ADD CONSTRAINT CK_PlatformAuditLogEntries_afterJson_isJson
    CHECK (afterJson IS NULL OR ISJSON(afterJson) = 1);

-- CK_PlatformAuditLogEntries_tenantSnapshotPaired (§3.3). A tenant-scoped entry freezes
-- the slug, because the entry must remain intelligible after the tenant is deprovisioned.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformAuditLogEntries_tenantSnapshotPaired')
  ALTER TABLE [platform].[PlatformAuditLogEntries] WITH CHECK ADD CONSTRAINT CK_PlatformAuditLogEntries_tenantSnapshotPaired
    CHECK (tenantId IS NULL OR tenantSlugSnapshot IS NOT NULL);

-- usp_WritePlatformAuditLogEntry (§3.3, §4.13). The platform-schema twin of
-- [{{SCHEMA}}].[usp_WriteAuditLogEntry] (§2.15 below): same single-writer, same
-- hash-chain discipline, applied to PlatformAuditLogEntries because a cross-tenant
-- or pre-tenant action (tenant provisioning, migration runs, staff account
-- lifecycle, erasure completions) has no tenant schema to write into at all. The
-- model doc-comment in schema.prisma already promises this table the same
-- `prevHash`/`entryHash` chain as its tenant twin; this procedure is what keeps
-- that promise rather than leaving it to whichever caller remembers to hash
-- correctly. Preimage additionally covers `tenantId`/`tenantSlugSnapshot`, the two
-- business columns this table carries that the tenant table does not.
EXEC(N'
CREATE OR ALTER PROCEDURE [platform].[usp_WritePlatformAuditLogEntry]
  @actorStaffUserId         char(26)      = NULL,
  @actorDisplayNameSnapshot nvarchar(200),
  @actorRoleSnapshot        nvarchar(120),
  @action                   varchar(64),
  @targetKind               varchar(48),
  @targetId                 char(26)      = NULL,
  @targetLabelSnapshot      nvarchar(300),
  @summary                  nvarchar(500),
  @correlationId            char(26),
  @environmentKey           varchar(16)   = NULL,
  @beforeJson               nvarchar(max) = NULL,
  @afterJson                nvarchar(max) = NULL,
  @requestId                char(26)      = NULL,
  @ipHash                   char(64)      = NULL,
  @userAgentHash            char(64)      = NULL,
  @tenantId                 char(26)      = NULL,
  @tenantSlugSnapshot       nvarchar(30)  = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @now datetime2(3) = SYSUTCDATETIME();
  DECLARE @prevHash char(64);

  SELECT TOP (1) @prevHash = a.entryHash
  FROM [platform].[PlatformAuditLogEntries] a WITH (UPDLOCK, HOLDLOCK)
  ORDER BY a.sequenceNo DESC;

  DECLARE @preimage nvarchar(max) =
      ISNULL(@prevHash, N'''')                + N''|'' + CONVERT(nvarchar(30), @now, 126)
    + N''|'' + ISNULL(@actorStaffUserId, N'''') + N''|'' + @actorDisplayNameSnapshot
    + N''|'' + @actorRoleSnapshot              + N''|'' + @action
    + N''|'' + @targetKind                     + N''|'' + ISNULL(@targetId, N'''')
    + N''|'' + @targetLabelSnapshot            + N''|'' + @summary
    + N''|'' + ISNULL(@beforeJson, N'''')       + N''|'' + ISNULL(@afterJson, N'''')
    + N''|'' + ISNULL(@tenantId, N'''')         + N''|'' + ISNULL(@tenantSlugSnapshot, N'''');

  INSERT INTO [platform].[PlatformAuditLogEntries]
    (id, occurredAt, actorStaffUserId, actorDisplayNameSnapshot, actorRoleSnapshot, action,
     targetKind, targetId, targetLabelSnapshot, environmentKey, beforeJson, afterJson,
     summary, correlationId, requestId, ipHash, userAgentHash, prevHash, entryHash,
     tenantId, tenantSlugSnapshot, createdAt, updatedAt)
  VALUES
    (LEFT(REPLACE(CONVERT(char(36), NEWID()), ''-'', ''''), 26), @now, @actorStaffUserId,
     @actorDisplayNameSnapshot, @actorRoleSnapshot, @action, @targetKind, @targetId,
     @targetLabelSnapshot, @environmentKey, @beforeJson, @afterJson, @summary,
     @correlationId, @requestId, @ipHash, @userAgentHash, @prevHash,
     CONVERT(char(64), HASHBYTES(''SHA2_256'', @preimage), 2), @tenantId, @tenantSlugSnapshot,
     @now, @now);
END');

-- -------------------------------------------------------------------------------------
-- 1.8  platform.ErasureRequests — the proof that outlives the data (§3.3, §10.4)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformErasureRequests_subjectKind')
  ALTER TABLE [platform].[ErasureRequests] WITH CHECK ADD CONSTRAINT CK_PlatformErasureRequests_subjectKind
    CHECK (subjectKind IN ('Tenant','CitizenIdentity','ContactHash'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformErasureRequests_status')
  ALTER TABLE [platform].[ErasureRequests] WITH CHECK ADD CONSTRAINT CK_PlatformErasureRequests_status
    CHECK (status IN ('Received','InProgress','Completed','Rejected'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformErasureRequests_rejectedHasReason')
  ALTER TABLE [platform].[ErasureRequests] WITH CHECK ADD CONSTRAINT CK_PlatformErasureRequests_rejectedHasReason
    CHECK (status <> 'Rejected' OR rejectionReason IS NOT NULL);

-- FR-GOV-22: "report completion per store", and statutory retentions listed as retained
-- with the obligation cited. A completed request must carry its evidence.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformErasureRequests_completedHasEvidence')
  ALTER TABLE [platform].[ErasureRequests] WITH CHECK ADD CONSTRAINT CK_PlatformErasureRequests_completedHasEvidence
    CHECK (status <> 'Completed' OR (completedAt IS NOT NULL AND verificationEvidenceJson IS NOT NULL
                                     AND ISJSON(verificationEvidenceJson) = 1));

-- -------------------------------------------------------------------------------------
-- 1.9  platform.StaffUsers / StaffCredentials / TenantMemberships
--      (§3.2 #4–#6, B9 tab 1, architecture §11)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_StaffUsers_status')
  ALTER TABLE [platform].[StaffUsers] WITH CHECK ADD CONSTRAINT CK_StaffUsers_status
    CHECK (status IN ('Invited','Active','Suspended'));

-- CK_StaffUsers_invitedHasNoLogin (§4.2). An invited account that has already logged in
-- is a state B9 tab 1 cannot render.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_StaffUsers_invitedHasNoLogin')
  ALTER TABLE [platform].[StaffUsers] WITH CHECK ADD CONSTRAINT CK_StaffUsers_invitedHasNoLogin
    CHECK (status <> 'Invited' OR lastLoginAt IS NULL);

-- CK_StaffUsers_emailLowercase (§4.2). "Stored lowercased" — a case-varying duplicate
-- would defeat the unique index below under a case-sensitive collation.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_StaffUsers_emailLowercase')
  ALTER TABLE [platform].[StaffUsers] WITH CHECK ADD CONSTRAINT CK_StaffUsers_emailLowercase
    CHECK (email = LOWER(email) AND email LIKE '%_@_%._%');

-- UQ_StaffUsers_email (§4.2) — FILTERED. Email is globally unique across the backoffice,
-- which a per-tenant users table could not enforce; filtered on deletedAt so a
-- soft-deleted account releases its address.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_StaffUsers_email'
               AND object_id = OBJECT_ID('[platform].[StaffUsers]'))
  CREATE UNIQUE INDEX UQ_StaffUsers_email ON [platform].[StaffUsers](email) WHERE deletedAt IS NULL;

-- CK_StaffCredentials_algorithm (§4.2, architecture §11). Argon2id, pinned rather than
-- configurable: a downgrade to a weaker KDF must not be a data change.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_StaffCredentials_algorithm')
  ALTER TABLE [platform].[StaffCredentials] WITH CHECK ADD CONSTRAINT CK_StaffCredentials_algorithm
    CHECK (passwordAlgorithm = 'argon2id');

-- UQ_TenantMemberships_primary (§4.2) — FILTERED. Exactly one home tenant per live
-- principal, read pre-binding at login (§3.2 #6).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_TenantMemberships_primary'
               AND object_id = OBJECT_ID('[platform].[TenantMemberships]'))
  CREATE UNIQUE INDEX UQ_TenantMemberships_primary ON [platform].[TenantMemberships](staffUserId)
    WHERE isPrimary = 1 AND revokedAt IS NULL;

-- -------------------------------------------------------------------------------------
-- 1.10 platform.TokenSets / Skins — the system-default theme tier (§3.2 #13, ADR-0007)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformTokenSets_kind')
  ALTER TABLE [platform].[TokenSets] WITH CHECK ADD CONSTRAINT CK_PlatformTokenSets_kind
    CHECK (kind IN ('SystemDefault','TenantSkin','UserSkin'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformTokenSets_mode')
  ALTER TABLE [platform].[TokenSets] WITH CHECK ADD CONSTRAINT CK_PlatformTokenSets_mode
    CHECK (mode IN ('Light','Dark'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformTokenSets_tokensJson_isJson')
  ALTER TABLE [platform].[TokenSets] WITH CHECK ADD CONSTRAINT CK_PlatformTokenSets_tokensJson_isJson
    CHECK (ISJSON(tokensJson) = 1);

-- CK_TokenSets_noPrimitiveLeak (§4.16, ADR-0007 three-layer contract). A token set may
-- set only SEMANTIC tokens; a primitive (`--shj3-…`) in the payload would let a theme
-- reach into layer 1 and break every other theme's contract.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformTokenSets_noPrimitiveLeak')
  ALTER TABLE [platform].[TokenSets] WITH CHECK ADD CONSTRAINT CK_PlatformTokenSets_noPrimitiveLeak
    CHECK (tokensJson NOT LIKE '%--shj3-%');

-- CK_TokenSets_contrastGate (§4.16, ADR-0007). The contrast gate BLOCKS, it does not
-- warn: an unvalidated token set cannot be persisted at all, so a save that skipped the
-- WCAG 2.1 AA check fails at the database rather than shipping an unreadable government
-- service.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformTokenSets_contrastGate')
  ALTER TABLE [platform].[TokenSets] WITH CHECK ADD CONSTRAINT CK_PlatformTokenSets_contrastGate
    CHECK (deletedAt IS NOT NULL OR contrastValidatedAt IS NOT NULL);

-- UQ_TokenSets_kind_mode (§4.16) — FILTERED. Exactly one light and one dark system
-- default; the terminal fallback of ADR-0007's resolution order cannot be ambiguous.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_TokenSets_kind_mode'
               AND object_id = OBJECT_ID('[platform].[TokenSets]'))
  CREATE UNIQUE INDEX UQ_TokenSets_kind_mode ON [platform].[TokenSets](kind, mode) WHERE kind = 'SystemDefault';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformSkins_status')
  ALTER TABLE [platform].[Skins] WITH CHECK ADD CONSTRAINT CK_PlatformSkins_status
    CHECK (status IN ('Draft','Published'));

-- CK_Skins_modesDiffer (§4.16). A skin whose light and dark sets are the same row is not
-- a light/dark pair.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PlatformSkins_modesDiffer')
  ALTER TABLE [platform].[Skins] WITH CHECK ADD CONSTRAINT CK_PlatformSkins_modesDiffer
    CHECK (lightTokenSetId <> darkTokenSetId);

-- UQ_Skins_name (§4.16) — FILTERED on soft delete.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_PlatformSkins_name'
               AND object_id = OBJECT_ID('[platform].[Skins]'))
  CREATE UNIQUE INDEX UQ_PlatformSkins_name ON [platform].[Skins](name) WHERE deletedAt IS NULL;

-- TR_Skins_blockSystemDelete (§4.16). The two shipped skins cannot be deleted, which is
-- what keeps ADR-0007's one-click restore-to-default always available.
EXEC(N'
CREATE OR ALTER TRIGGER [platform].[TR_PlatformSkins_blockSystemDelete]
ON [platform].[Skins] AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted d WHERE d.isSystem = 1
             AND NOT EXISTS (SELECT 1 FROM inserted i WHERE i.id = d.id))
    THROW 51020, ''A system skin cannot be deleted (ADR-0007: restore-to-default must always be available).'', 1;
  IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
             WHERE d.isSystem = 1 AND i.deletedAt IS NOT NULL)
    THROW 51020, ''A system skin cannot be soft-deleted (ADR-0007).'', 1;
END');

-- -------------------------------------------------------------------------------------
-- 1.11 platform user guide — Phase F (§4.17)
-- -------------------------------------------------------------------------------------

-- CK_GuideSections_depth (§4.17). module -> submodule -> page, three levels, mirroring
-- real app navigation.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideSections_depth')
  ALTER TABLE [platform].[GuideSections] WITH CHECK ADD CONSTRAINT CK_GuideSections_depth
    CHECK (depth BETWEEN 0 AND 2);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideSections_noSelfParent')
  ALTER TABLE [platform].[GuideSections] WITH CHECK ADD CONSTRAINT CK_GuideSections_noSelfParent
    CHECK (parentSectionId IS NULL OR parentSectionId <> id);

-- TR_GuideSections_depthMatchesParent (§4.17). depth is denormalised for the side menu
-- render; the trigger stops it disagreeing with the tree.
EXEC(N'
CREATE OR ALTER TRIGGER [platform].[TR_GuideSections_depthMatchesParent]
ON [platform].[GuideSections] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    LEFT JOIN [platform].[GuideSections] p ON p.id = i.parentSectionId
    WHERE (i.parentSectionId IS NULL AND i.depth <> 0)
       OR (i.parentSectionId IS NOT NULL AND i.depth <> p.depth + 1))
    THROW 51030, ''GuideSections.depth must be 0 at the root and parent.depth + 1 otherwise (Phase F).'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideEntries_status')
  ALTER TABLE [platform].[GuideEntries] WITH CHECK ADD CONSTRAINT CK_GuideEntries_status
    CHECK (status IN ('Draft','Published'));

-- CK_GuideEntries_appRouteAbsolute (§4.17). UQ_GuideEntries_appRoute (declared in Prisma)
-- makes the route-manifest-to-guide comparison a set difference rather than a heuristic;
-- an absolute route is what makes the two sides comparable at all.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideEntries_appRouteAbsolute')
  ALTER TABLE [platform].[GuideEntries] WITH CHECK ADD CONSTRAINT CK_GuideEntries_appRouteAbsolute
    CHECK (appRoute LIKE '/%');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideEntries_howToStepsJson_isJson')
  ALTER TABLE [platform].[GuideEntries] WITH CHECK ADD CONSTRAINT CK_GuideEntries_howToStepsJson_isJson
    CHECK (ISJSON(howToStepsJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideEntries_permissionNotesJson_isJson')
  ALTER TABLE [platform].[GuideEntries] WITH CHECK ADD CONSTRAINT CK_GuideEntries_permissionNotesJson_isJson
    CHECK (permissionNotesJson IS NULL OR ISJSON(permissionNotesJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideAssets_mimeAllowed')
  ALTER TABLE [platform].[GuideAssets] WITH CHECK ADD CONSTRAINT CK_GuideAssets_mimeAllowed
    CHECK (mimeType IN ('image/png','image/webp'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideEntryTranslations_state')
  ALTER TABLE [platform].[GuideEntryTranslations] WITH CHECK ADD CONSTRAINT CK_GuideEntryTranslations_state
    CHECK (state IN ('Missing','Draft','Translated','Reviewed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GuideEntryTranslations_howToStepsJson_isJson')
  ALTER TABLE [platform].[GuideEntryTranslations] WITH CHECK ADD CONSTRAINT CK_GuideEntryTranslations_howToStepsJson_isJson
    CHECK (ISJSON(howToStepsJson) = 1);

-- IX_GuideScreenshots_isStale (§4.17) — FILTERED. The review queue that makes
-- "screenshots kept current with the UI" an operable obligation rather than an intention.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GuideScreenshots_isStale'
               AND object_id = OBJECT_ID('[platform].[GuideScreenshots]'))
  CREATE INDEX IX_GuideScreenshots_isStale ON [platform].[GuideScreenshots](guideEntryId) WHERE isStale = 1;

-- TR_GuideScreenshots_markStaleOnRelease (§4.17). A screenshot captured against an older
-- app version is stale by definition; the flag is derived, not typed.
EXEC(N'
CREATE OR ALTER TRIGGER [platform].[TR_GuideScreenshots_markStaleOnRelease]
ON [platform].[GuideScreenshots] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE s SET s.isStale = 1, s.updatedAt = SYSUTCDATETIME()
  FROM [platform].[GuideScreenshots] s
  JOIN inserted i ON i.id = s.id
  JOIN [platform].[GuideEntries] e ON e.id = s.guideEntryId
  WHERE s.capturedAppVersion <> e.releaseVersion AND s.isStale = 0;
END');

-- IX_GuideCoverageChecks_hasEntry (§4.17) — FILTERED. The undocumented-pages list.
-- Phase F: "a page with no guide entry fails review"; with no CI (ADR-0008) the
-- pre-commit route-manifest scan writes these rows and this index is what it reads.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GuideCoverageChecks_hasEntry'
               AND object_id = OBJECT_ID('[platform].[GuideCoverageChecks]'))
  CREATE INDEX IX_GuideCoverageChecks_hasEntry ON [platform].[GuideCoverageChecks](appRoute) WHERE hasEntry = 0;

-- Full-text index for the guide module's search (§4.17: "searchable, deep-linkable").
-- Prisma cannot declare full-text objects at all. Guarded so a server without full-text
-- installed still applies the rest of the file.
IF SERVERPROPERTY('IsFullTextInstalled') = 1
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'ftc_shj3_guide')
    EXEC(N'CREATE FULLTEXT CATALOG ftc_shj3_guide AS DEFAULT');
  IF NOT EXISTS (SELECT 1 FROM sys.fulltext_indexes WHERE object_id = OBJECT_ID('[platform].[GuideEntries]'))
    EXEC(N'CREATE FULLTEXT INDEX ON [platform].[GuideEntries](title, purpose, walkthroughMarkdown)
             KEY INDEX UQ_GuideEntries_slug ON ftc_shj3_guide WITH CHANGE_TRACKING AUTO');
END
GO

-- -------------------------------------------------------------------------------------
-- 1.12 GRANTS on the platform schema (ADR-0005 rule 5, §3.6)
--      "Write permissions are enforced at the database level, not by convention …
--      Code review is not the control; the grant is."
--      The AI runtime has no business in the tenant registry or in credentials, so the
--      whole schema is DENIED and exactly four reference tables are granted back.
-- -------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_ai')
BEGIN
  DENY  SELECT ON SCHEMA::[platform]                    TO shj3_ai;  -- credentials, registry: not the runtime's business
  GRANT SELECT ON [platform].[Policies]                 TO shj3_ai;  -- effective-policy resolution needs the floor (§3.4)
  GRANT SELECT ON [platform].[OverridablePolicies]      TO shj3_ai;
  GRANT SELECT ON [platform].[Environments]             TO shj3_ai;
  GRANT SELECT ON [platform].[Locales]                  TO shj3_ai;
END

-- StaffCredentials carries its own, narrower grant (§3.2 #5): Argon2id hashes, TOTP
-- secrets and lockout counters are readable by the auth adapter's role and by nothing
-- else, so a per-tenant export or an admin-facing user listing PHYSICALLY cannot include
-- them rather than relying on a column projection someone must remember to write.
DENY SELECT ON [platform].[StaffCredentials] TO PUBLIC;
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_auth')
  GRANT SELECT, INSERT, UPDATE ON [platform].[StaffCredentials] TO shj3_auth;

-- The platform audit log is append-only by grant as well as by trigger (§3.3, B14 tab 2).
DENY UPDATE, DELETE ON [platform].[PlatformAuditLogEntries] TO PUBLIC;
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_web')
BEGIN
  GRANT SELECT, INSERT ON [platform].[PlatformAuditLogEntries] TO shj3_web;
  GRANT EXECUTE ON [platform].[usp_WritePlatformAuditLogEntry] TO shj3_web;
  DENY  UPDATE, DELETE ON [platform].[PlatformAuditLogEntries] TO shj3_web;
END
GO


/* === SECTION BOUNDARY === */


/* =====================================================================================
   -- @section: tenant
   SECTION 2 · TENANT SCHEMA — apply once per tenant schema, {{SCHEMA}} substituted
   ===================================================================================== */

-- -------------------------------------------------------------------------------------
-- 2.0  Timestamp precision (§1.3). Same pass as 1.0; see the note there for why indexed
--      `…At` columns are skipped.
-- -------------------------------------------------------------------------------------
DECLARE @tenantPrecisionSql NVARCHAR(MAX) = N'';
SELECT @tenantPrecisionSql = @tenantPrecisionSql
     + N'ALTER TABLE [{{SCHEMA}}].[' + t.name + N'] ALTER COLUMN [' + c.name + N'] datetime2(3) '
     + CASE WHEN c.is_nullable = 1 THEN N'NULL;' ELSE N'NOT NULL;' END + NCHAR(10)
FROM sys.columns  c
JOIN sys.tables   t  ON t.object_id     = c.object_id
JOIN sys.schemas  s  ON s.schema_id     = t.schema_id
JOIN sys.types    ty ON ty.user_type_id = c.user_type_id
WHERE s.name = N'{{SCHEMA}}'
  AND ty.name = N'datetime2'
  AND c.scale <> 3
  AND c.is_computed = 0
  AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic
                  WHERE ic.object_id = c.object_id AND ic.column_id = c.column_id);
IF LEN(@tenantPrecisionSql) > 0 EXEC sys.sp_executesql @tenantPrecisionSql;
GO

-- -------------------------------------------------------------------------------------
-- 2.1  Tenancy substrate & outbox (§4.1, §9.1, ADR-0003 rule 4)
-- -------------------------------------------------------------------------------------

-- CK_TenantProfiles_singleton (§4.1 singleton pattern). Preferred over "just don't insert
-- a second row": a second profile would make tenant facts ambiguous to every trigger that
-- reads them.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantProfiles_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TenantProfiles]'))
  ALTER TABLE [{{SCHEMA}}].[TenantProfiles] WITH CHECK ADD CONSTRAINT CK_TenantProfiles_singleton
    CHECK (singletonKey = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OutboxEvents_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  ALTER TABLE [{{SCHEMA}}].[OutboxEvents] WITH CHECK ADD CONSTRAINT CK_OutboxEvents_state
    CHECK (state IN ('Pending','InFlight','Applied','Failed','Dead'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OutboxEvents_targetStore'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  ALTER TABLE [{{SCHEMA}}].[OutboxEvents] WITH CHECK ADD CONSTRAINT CK_OutboxEvents_targetStore
    CHECK (targetStore IN ('Neo4j','Qdrant','Both'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OutboxEvents_appliedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  ALTER TABLE [{{SCHEMA}}].[OutboxEvents] WITH CHECK ADD CONSTRAINT CK_OutboxEvents_appliedPaired
    CHECK (CAST(CASE WHEN state = 'Applied' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN appliedAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OutboxEvents_lockPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  ALTER TABLE [{{SCHEMA}}].[OutboxEvents] WITH CHECK ADD CONSTRAINT CK_OutboxEvents_lockPaired
    CHECK (CAST(CASE WHEN lockedBy IS NULL THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN lockedUntil IS NULL THEN 1 ELSE 0 END AS bit));

-- CK_OutboxEvents_deadIsExhausted (§9.1). A Dead row must have earned it; otherwise
-- reconciliation's "requeue Dead rows" step (§9.3 step 5) cannot distinguish a genuinely
-- exhausted intent from one abandoned early.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OutboxEvents_deadIsExhausted'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  ALTER TABLE [{{SCHEMA}}].[OutboxEvents] WITH CHECK ADD CONSTRAINT CK_OutboxEvents_deadIsExhausted
    CHECK (state <> 'Dead' OR attemptCount >= maxAttempts);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OutboxEvents_payloadJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  ALTER TABLE [{{SCHEMA}}].[OutboxEvents] WITH CHECK ADD CONSTRAINT CK_OutboxEvents_payloadJson_isJson
    CHECK (ISJSON(payloadJson) = 1);

-- IX_OutboxEvents_claimable (§9.1) — FILTERED and covering. The worker's only query
-- shape; filtered so the index stays small as Applied rows accumulate.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OutboxEvents_claimable'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  CREATE INDEX IX_OutboxEvents_claimable ON [{{SCHEMA}}].[OutboxEvents](availableAt, id)
    INCLUDE (targetStore, eventType, aggregateId)
    WHERE state IN ('Pending','Failed');

-- IX_OutboxEvents_dead (§9.1) — FILTERED. The dead-letter queue reconciliation requeues.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OutboxEvents_dead'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[OutboxEvents]'))
  CREATE INDEX IX_OutboxEvents_dead ON [{{SCHEMA}}].[OutboxEvents](occurredAt) WHERE state = 'Dead';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReconciliationRuns_store'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReconciliationRuns]'))
  ALTER TABLE [{{SCHEMA}}].[ReconciliationRuns] WITH CHECK ADD CONSTRAINT CK_ReconciliationRuns_store
    CHECK (store IN ('Neo4j','Qdrant'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReconciliationRuns_scope'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReconciliationRuns]'))
  ALTER TABLE [{{SCHEMA}}].[ReconciliationRuns] WITH CHECK ADD CONSTRAINT CK_ReconciliationRuns_scope
    CHECK (scope IN ('Tenant','Collection','Source'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReconciliationRuns_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReconciliationRuns]'))
  ALTER TABLE [{{SCHEMA}}].[ReconciliationRuns] WITH CHECK ADD CONSTRAINT CK_ReconciliationRuns_state
    CHECK (state IN ('Queued','Running','Completed','Failed'));

-- -------------------------------------------------------------------------------------
-- 2.2  iam — teams, roles, the 7x8 matrix (§4.2, B9 tabs 1-3)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Teams_scope'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Teams]'))
  ALTER TABLE [{{SCHEMA}}].[Teams] WITH CHECK ADD CONSTRAINT CK_Teams_scope
    CHECK (scope IN ('Tenant','AllEntities'));

-- UQ_Teams_name (§4.2) — FILTERED on soft delete.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Teams_name'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Teams]'))
  CREATE UNIQUE INDEX UQ_Teams_name ON [{{SCHEMA}}].[Teams](name) WHERE deletedAt IS NULL;

-- TR_Teams_crossEntityScope (§4.2, B9 tab 2). scope = 'AllEntities' is rejected unless
-- this schema belongs to the Platform tenant. That is how B9 tab 2's
-- "Platform -> All entities" row is legitimate and a SEWA-created equivalent is not — a
-- cross-entity team created inside an ordinary tenant would be a scope claim over
-- entities that never granted it.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_Teams_crossEntityScope]
ON [{{SCHEMA}}].[Teams] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted i WHERE i.scope = ''AllEntities'')
     AND NOT EXISTS (SELECT 1 FROM [{{SCHEMA}}].[TenantProfiles] p WHERE p.isPlatformTenant = 1)
    THROW 51100, ''Only the Platform tenant may own an AllEntities-scoped team (B9 tab 2).'', 1;
END');

-- UQ_TeamMembers_primary (§4.2) — FILTERED. B9 tab 1's single "Team" column renders the
-- primary; TeamMembers is a genuine many-to-many (ASSUMPTION 1) and this is what keeps
-- the registry column single-valued.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_TeamMembers_primary'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[TeamMembers]'))
  CREATE UNIQUE INDEX UQ_TeamMembers_primary ON [{{SCHEMA}}].[TeamMembers](staffUserId) WHERE isPrimary = 1;

-- UQ_Roles_key / UQ_Roles_ordinal (§4.2) — FILTERED. The ordinal fixes B9 tab 3's matrix
-- column order, so it must be unique among live roles.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_key'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Roles]'))
  CREATE UNIQUE INDEX UQ_Roles_key ON [{{SCHEMA}}].[Roles]([key]) WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_ordinal'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Roles]'))
  CREATE UNIQUE INDEX UQ_Roles_ordinal ON [{{SCHEMA}}].[Roles](ordinal) WHERE deletedAt IS NULL;

-- TR_Roles_blockSystemDelete (§4.2). One of the 7 seeded roles cannot be soft-deleted;
-- B9 tab 3's matrix rows are code-referenced.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_Roles_blockSystemDelete]
ON [{{SCHEMA}}].[Roles] AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted d WHERE d.isSystem = 1
             AND NOT EXISTS (SELECT 1 FROM inserted i WHERE i.id = d.id))
    THROW 51101, ''A system role cannot be deleted (B9 tab 3).'', 1;
  IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
             WHERE d.isSystem = 1 AND i.deletedAt IS NOT NULL AND d.deletedAt IS NULL)
    THROW 51101, ''A system role cannot be soft-deleted (B9 tab 3).'', 1;
END');

-- RolePermissions_permissionKey_fkey (§4.2, ADR-0011). One of the five relationships that
-- cross the platform/tenant boundary: a tenant cannot invent a permission, because a
-- permission with no enforcement point is a lie in a matrix (schema.prisma's
-- RolePermission.permissionKey doc comment). Before ADR-0011 this was a Prisma-managed
-- `@relation`, emitted once by Prisma Migrate into tenant_template's migration history and
-- replayed per tenant by the provisioning orchestrator. `prisma/tenant/schema.prisma` no
-- longer declares it — Prisma cannot express a `@relation` across two separately generated
-- clients — so it is hand-maintained here from this point on, under the SAME name Prisma
-- originally generated (so this check is a no-op against every already-provisioned tenant,
-- whose schema already carries the constraint from the historical migration replay).
--
-- Scoped by parent_object_id, not name alone: a constraint name is unique per SCHEMA, not
-- per database, so `sewa` already having this constraint must not make the check for
-- `customs` a false positive and skip creating its own copy.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE name = 'RolePermissions_permissionKey_fkey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RolePermissions]'))
  ALTER TABLE [{{SCHEMA}}].[RolePermissions] WITH CHECK ADD CONSTRAINT RolePermissions_permissionKey_fkey
    FOREIGN KEY ([permissionKey]) REFERENCES [platform].[Permissions]([key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- TR_RolePermissions_protectSuperAdmin (§4.2). The super_admin grant for
-- users:manage cannot be revoked, or the tenant locks itself out of its own IAM
-- screen — an unrecoverable state no support path can fix from inside the product.
--
-- BUG FOUND AND FIXED (B-2, 2026-09-09): this trigger originally checked
-- `d.permissionKey = ''manage_users_teams''`, a snake_case name that never matched any
-- permission key this system actually persists. `platform.Permissions.key` (and every
-- `RolePermissions.permissionKey` row derived from it) uses the `resource:action` form
-- domain/permissions.ts's `PERMISSIONS` constant defines and `permissions.test.ts`
-- transcribes from the wireframe — `users:manage` for "Manage users & teams" — which is
-- the real, load-bearing, tested convention (data-model.md's `manage_users_teams` is
-- illustrative prose, not a persisted value; see tasks/lessons.md's standing warning
-- about exactly this gap). With the stale literal, this trigger would never have fired
-- for any row this system could actually write — a protection that silently protected
-- nothing. `Role.key` values (`super_admin` etc.) are untouched: nothing persisted a
-- Role row before B-2, so this trigger''s pre-existing snake_case literal becomes the
-- established persisted convention going forward (domain/permissions.ts''s `ROLE_KEYS`).
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_RolePermissions_protectSuperAdmin]
ON [{{SCHEMA}}].[RolePermissions] AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted d
             JOIN [{{SCHEMA}}].[Roles] r ON r.id = d.roleId
             WHERE r.[key] = ''super_admin'' AND d.permissionKey = ''users:manage'')
    THROW 51102, ''The super_admin grant for users:manage cannot be revoked (B9 tab 3).'', 1;
END');

-- CK_SecurityPolicies_singleton (§4.2) — the Security tab's session/lockout policy is
-- tenant-wide, same reasoning as CK_RouterConfigs_singleton.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SecurityPolicies_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SecurityPolicies]'))
  ALTER TABLE [{{SCHEMA}}].[SecurityPolicies] WITH CHECK ADD CONSTRAINT CK_SecurityPolicies_singleton
    CHECK (singletonKey = 1);

-- CK_SecurityPolicies_ranges (§4.2) — every window is a real, positive duration. Upper
-- bounds are generous (a week idle, 30 days absolute, an hour lockout) rather than tight,
-- since the point is to stop a zero/negative/nonsensical value, not to second-guess a
-- deliberately lax tenant policy.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SecurityPolicies_ranges'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SecurityPolicies]'))
  ALTER TABLE [{{SCHEMA}}].[SecurityPolicies] WITH CHECK ADD CONSTRAINT CK_SecurityPolicies_ranges
    CHECK (staffSessionIdleMinutes BETWEEN 1 AND 10080
       AND staffSessionAbsoluteHours BETWEEN 1 AND 720
       AND lockoutFailuresBeforeLock BETWEEN 1 AND 20
       AND lockoutDurationMinutes BETWEEN 1 AND 1440
       AND backoffCeilingSeconds BETWEEN 1 AND 120);

-- -------------------------------------------------------------------------------------
-- 2.3  conversation (§4.3, A1-A3, B1 tab 2)
-- -------------------------------------------------------------------------------------

-- CK_Conversations_piiMaskApplied (§4.3, architecture §10). Masking is "applied before
-- persistence, not on read — a transcript is never stored unmasked, so a later bug cannot
-- leak it." A nullable or falsifiable flag would let an unmasked transcript exist as a
-- valid row; this check makes the unmasked state UNREPRESENTABLE. It can be a hard
-- constraint rather than a configurable one precisely because
-- `mask_pii_in_transcripts` is one of B12's two locked policies.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Conversations_piiMaskApplied'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Conversations]'))
  ALTER TABLE [{{SCHEMA}}].[Conversations] WITH CHECK ADD CONSTRAINT CK_Conversations_piiMaskApplied
    CHECK (piiMaskApplied = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Conversations_outcome'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Conversations]'))
  ALTER TABLE [{{SCHEMA}}].[Conversations] WITH CHECK ADD CONSTRAINT CK_Conversations_outcome
    CHECK (outcome IN ('Active','Resolved','Escalated','Abandoned'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Conversations_channelKey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Conversations]'))
  ALTER TABLE [{{SCHEMA}}].[Conversations] WITH CHECK ADD CONSTRAINT CK_Conversations_channelKey
    CHECK (channelKey IN ('WebWidget','WhatsApp','MobileApp','KioskIvr'));

-- IX_Conversations_retentionExpiresAt (§10.2) — FILTERED. The retention sweep's driving
-- index; filtered on erasedAt so already-purged stubs are not rescanned nightly.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Conversations_retentionExpiresAt'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Conversations]'))
  CREATE INDEX IX_Conversations_retentionExpiresAt ON [{{SCHEMA}}].[Conversations](retentionExpiresAt)
    WHERE erasedAt IS NULL;

-- IX_Conversations_citizenIdentityId (§4.3) — FILTERED. Anonymous sessions carry a NULL
-- identity (§4.11) and are the majority, so they are kept out of the index.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Conversations_citizenIdentityId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Conversations]'))
  CREATE INDEX IX_Conversations_citizenIdentityId ON [{{SCHEMA}}].[Conversations](citizenIdentityId)
    WHERE citizenIdentityId IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConversationTurns_role'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConversationTurns]'))
  ALTER TABLE [{{SCHEMA}}].[ConversationTurns] WITH CHECK ADD CONSTRAINT CK_ConversationTurns_role
    CHECK (role IN ('Citizen','Assistant','System','HumanAgent'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConversationTurns_contentFormat'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConversationTurns]'))
  ALTER TABLE [{{SCHEMA}}].[ConversationTurns] WITH CHECK ADD CONSTRAINT CK_ConversationTurns_contentFormat
    CHECK (contentFormat IN ('Text','Markdown','WhatsAppList'));

-- CK_ConversationTurns_refusalPaired (§4.3). A refusal without a reason cannot be
-- explained to a citizen or counted in B1's refusal analytics.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConversationTurns_refusalPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConversationTurns]'))
  ALTER TABLE [{{SCHEMA}}].[ConversationTurns] WITH CHECK ADD CONSTRAINT CK_ConversationTurns_refusalPaired
    CHECK (CAST(CASE WHEN wasRefused = 0 THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN refusalReason IS NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MessageFeedback_rating'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[MessageFeedback]'))
  ALTER TABLE [{{SCHEMA}}].[MessageFeedback] WITH CHECK ADD CONSTRAINT CK_MessageFeedback_rating
    CHECK (rating IN ('Up','Down'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConversationSlots_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConversationSlots]'))
  ALTER TABLE [{{SCHEMA}}].[ConversationSlots] WITH CHECK ADD CONSTRAINT CK_ConversationSlots_status
    CHECK (status IN ('Pending','Filled','Abandoned'));

-- The four assurance levels of §4.11. L0 Anonymous, L1 Verified, L2 VerifiedPlusOtp and
-- L2 VerifiedPlusDocument (alternative second factors, not a hierarchy). L3 is
-- deliberately not issued — RISK-006 — because a rank nothing can satisfy would be dead
-- configuration this constraint could not honestly permit.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConversationSlots_requiredAssurance'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConversationSlots]'))
  ALTER TABLE [{{SCHEMA}}].[ConversationSlots] WITH CHECK ADD CONSTRAINT CK_ConversationSlots_requiredAssurance
    CHECK (requiredAssurance IN ('Anonymous','Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

-- CK_QuickActions_ordinalRange (§4.3). A1 shows five chips; ten is the hard ceiling.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_QuickActions_ordinalRange'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[QuickActions]'))
  ALTER TABLE [{{SCHEMA}}].[QuickActions] WITH CHECK ADD CONSTRAINT CK_QuickActions_ordinalRange
    CHECK (ordinal BETWEEN 1 AND 10);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_QuickActions_channelScope'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[QuickActions]'))
  ALTER TABLE [{{SCHEMA}}].[QuickActions] WITH CHECK ADD CONSTRAINT CK_QuickActions_channelScope
    CHECK (channelScope IN ('All','WebWidget','WhatsApp'));

-- -------------------------------------------------------------------------------------
-- 2.4  agents — registry, versions, wizard configuration (§4.4, B2, B3)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Agents_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Agents]'))
  ALTER TABLE [{{SCHEMA}}].[Agents] WITH CHECK ADD CONSTRAINT CK_Agents_status
    CHECK (status IN ('Draft','Published','Archived'));

-- CK_Agents_archivedPaired (§4.4). B2's Archive "removes the agent from the registry" —
-- a status filter, not a delete, because B14 tab 1 still counts versions per environment.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Agents_archivedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Agents]'))
  ALTER TABLE [{{SCHEMA}}].[Agents] WITH CHECK ADD CONSTRAINT CK_Agents_archivedPaired
    CHECK (CAST(CASE WHEN status = 'Archived' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN archivedAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- CK_Agents_publishedHasVersion (§4.4). A published agent with no current version would
-- be routable to nothing.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Agents_publishedHasVersion'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Agents]'))
  ALTER TABLE [{{SCHEMA}}].[Agents] WITH CHECK ADD CONSTRAINT CK_Agents_publishedHasVersion
    CHECK (status <> 'Published' OR currentVersionId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Agents_noSelfClone'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Agents]'))
  ALTER TABLE [{{SCHEMA}}].[Agents] WITH CHECK ADD CONSTRAINT CK_Agents_noSelfClone
    CHECK (clonedFromAgentId IS NULL OR clonedFromAgentId <> id);

-- UQ_Agents_slug (§4.4) — FILTERED on soft delete.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Agents_slug'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Agents]'))
  CREATE UNIQUE INDEX UQ_Agents_slug ON [{{SCHEMA}}].[Agents](slug) WHERE deletedAt IS NULL;

-- AgentVersions.label — COMPUTED PERSISTED (§4.4). B2 renders `v2.4`; deriving it means
-- the displayed version string can never disagree with (major, minor).
IF COL_LENGTH('[{{SCHEMA}}].[AgentVersions]', 'label') IS NULL
  ALTER TABLE [{{SCHEMA}}].[AgentVersions]
    ADD label AS ('v' + CAST(major AS varchar(6)) + '.' + CAST(minor AS varchar(6))) PERSISTED;

-- UQ_AgentVersions_agentId_current (§4.4) — FILTERED. **Two current versions of one agent
-- is unrepresentable.** This is the constraint that makes B2's rule — "rollback changes
-- which version is current; promotion moves a version between environments" — safe:
-- rollback clears isCurrent on one row and sets it on another, and the index guarantees
-- no window in which both hold.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AgentVersions_agentId_current'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  CREATE UNIQUE INDEX UQ_AgentVersions_agentId_current ON [{{SCHEMA}}].[AgentVersions](agentId)
    WHERE isCurrent = 1;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersions_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersions] WITH CHECK ADD CONSTRAINT CK_AgentVersions_status
    CHECK (status IN ('Draft','Published','Archived'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersions_tone'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersions] WITH CHECK ADD CONSTRAINT CK_AgentVersions_tone
    CHECK (tone IN ('Helpful','Formal','Concise'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersions_temperature'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersions] WITH CHECK ADD CONSTRAINT CK_AgentVersions_temperature
    CHECK (temperature BETWEEN 0 AND 2);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersions_maxOutputTokens'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersions] WITH CHECK ADD CONSTRAINT CK_AgentVersions_maxOutputTokens
    CHECK (maxOutputTokens > 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersions_publishedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersions] WITH CHECK ADD CONSTRAINT CK_AgentVersions_publishedPaired
    CHECK (CAST(CASE WHEN status = 'Published' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN publishedAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- CK_AgentVersions_fallbackDiffers (§4.4). A fallback model identical to the primary is
-- not a fallback; it would silently retry the same failure.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersions_fallbackDiffers'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersions] WITH CHECK ADD CONSTRAINT CK_AgentVersions_fallbackDiffers
    CHECK (fallbackModel IS NULL OR fallbackModel <> primaryModel);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersions_noSelfClone'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersions]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersions] WITH CHECK ADD CONSTRAINT CK_AgentVersions_noSelfClone
    CHECK (clonedFromVersionId IS NULL OR clonedFromVersionId <> id);

-- TR_AgentVersions_publishedImmutable (§4.4). A Published version is a configuration
-- SNAPSHOT: a conversation turn references `agentVersionId`, so mutating a published
-- version would retroactively change what a past answer was produced by. Change means a
-- new version.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_AgentVersions_publishedImmutable]
ON [{{SCHEMA}}].[AgentVersions] AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE d.status = ''Published''
      AND (i.systemPrompt <> d.systemPrompt OR i.tone <> d.tone
           OR i.primaryModel <> d.primaryModel
           OR ISNULL(i.fallbackModel, N'''') <> ISNULL(d.fallbackModel, N'''')
           OR i.temperature <> d.temperature OR i.maxOutputTokens <> d.maxOutputTokens
           OR i.configHash <> d.configHash OR i.major <> d.major OR i.minor <> d.minor))
    THROW 51110, ''A Published agent version is immutable; create a new version instead (B2, B3).'', 1;
END');

-- CK_AgentSandboxRuns json guards (§4.4, §1.5).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentSandboxRuns_transcriptJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentSandboxRuns]'))
  ALTER TABLE [{{SCHEMA}}].[AgentSandboxRuns] WITH CHECK ADD CONSTRAINT CK_AgentSandboxRuns_transcriptJson_isJson
    CHECK (ISJSON(transcriptJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentSandboxRuns_traceJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentSandboxRuns]'))
  ALTER TABLE [{{SCHEMA}}].[AgentSandboxRuns] WITH CHECK ADD CONSTRAINT CK_AgentSandboxRuns_traceJson_isJson
    CHECK (traceJson IS NULL OR ISJSON(traceJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentVersionHistoryEntries_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentVersionHistoryEntries]'))
  ALTER TABLE [{{SCHEMA}}].[AgentVersionHistoryEntries] WITH CHECK ADD CONSTRAINT CK_AgentVersionHistoryEntries_kind
    CHECK (kind IN ('Created','Cloned','Published','Unpublished','RolledBack','Promoted','Archived'));

-- CK_AgentWizardDrafts_lastStep (§4.4). B3 is a ten-step wizard.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentWizardDrafts_lastStep'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentWizardDrafts]'))
  ALTER TABLE [{{SCHEMA}}].[AgentWizardDrafts] WITH CHECK ADD CONSTRAINT CK_AgentWizardDrafts_lastStep
    CHECK (lastStep BETWEEN 1 AND 10);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentWizardDrafts_stepStateJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentWizardDrafts]'))
  ALTER TABLE [{{SCHEMA}}].[AgentWizardDrafts] WITH CHECK ADD CONSTRAINT CK_AgentWizardDrafts_stepStateJson_isJson
    CHECK (ISJSON(stepStateJson) = 1);

-- UQ_AgentLocaleBindings_primary (§4.4) — FILTERED. One primary locale per version.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AgentLocaleBindings_primary'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[AgentLocaleBindings]'))
  CREATE UNIQUE INDEX UQ_AgentLocaleBindings_primary ON [{{SCHEMA}}].[AgentLocaleBindings](agentVersionId)
    WHERE isPrimary = 1;

-- TR_AgentFlowBindings_publishedNeedsPublishedFlow (§4.4, B3 step 6). B3 step 6 lists
-- "Update account details (Draft)" as bindable, so the block is at PUBLISH, not at bind:
-- a Published agent version may not reference a Draft flow version, because a citizen
-- would then be routed into an unfinished canvas.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_AgentFlowBindings_publishedNeedsPublishedFlow]
ON [{{SCHEMA}}].[AgentFlowBindings] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[AgentVersions] av ON av.id = i.agentVersionId
    JOIN [{{SCHEMA}}].[FlowVersions]  fv ON fv.id = i.flowVersionId
    WHERE av.status = ''Published'' AND fv.status <> ''Published'' AND i.isEnabled = 1)
    THROW 51111, ''A Published agent version cannot bind a Draft flow version (B3 step 6).'', 1;
END');
GO

-- -------------------------------------------------------------------------------------
-- 2.5  orchestration — router config and traces (§4.5, A2, B4)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_singleton
    CHECK (singletonKey = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_executionMode'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_executionMode
    CHECK (executionMode IN ('Sequential','Parallel','SupervisorWorker'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_routingStrategy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_routingStrategy
    CHECK (routingStrategy IN ('IntentClassifier','LlmRouter','RuleFirst'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_agentSelectionScope'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_agentSelectionScope
    CHECK (agentSelectionScope IN ('AllPublished','ChannelBound','ExplicitList'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_conflictResolution'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_conflictResolution
    CHECK (conflictResolution IN ('HighestConfidence','PreferOwningEntity','SupervisorArbitrates'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_responseMergePolicy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_responseMergePolicy
    CHECK (responseMergePolicy IN ('ConcatenateInOrder','DeduplicateOverlap','SupervisorRewrite'));

-- CK_RouterConfigs_maxHops (§4.5, B4). A hop ceiling is what stops a supervisor/worker
-- loop from burning the cost ceiling on one turn.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_maxHops'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_maxHops
    CHECK (maxHops BETWEEN 1 AND 10 AND maxLoopIterations BETWEEN 1 AND 20);

-- CK_RouterConfigs_scopeListPaired (§4.5). `ExplicitList` with no list is a router with
-- no candidates.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_scopeListPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_scopeListPaired
    CHECK (CAST(CASE WHEN agentSelectionScope = 'ExplicitList' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN agentScopeListJson IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_agentScopeListJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_agentScopeListJson_isJson
    CHECK (agentScopeListJson IS NULL OR ISJSON(agentScopeListJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_confidence'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_confidence
    CHECK (minRoutingConfidence BETWEEN 0 AND 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RouterConfigs_ceilings'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RouterConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RouterConfigs] WITH CHECK ADD CONSTRAINT CK_RouterConfigs_ceilings
    CHECK (costCeilingTokens > 0 AND costCeilingMicroAed > 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraces_confidence'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraces]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraces] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraces_confidence
    CHECK ((routingConfidence  IS NULL OR routingConfidence  BETWEEN 0 AND 1)
       AND (groundingConfidence IS NULL OR groundingConfidence BETWEEN 0 AND 1));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraces_hops'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraces]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraces] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraces_hops
    CHECK (hopCount <= 10);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraces_guardrailResults'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraces]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraces] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraces_guardrailResults
    CHECK (guardrailPreResult  IN ('Pass','Blocked','Rewritten','Skipped')
       AND guardrailPostResult IN ('Pass','Blocked','Rewritten','Skipped'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraceSteps_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraceSteps]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraceSteps] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraceSteps_kind
    CHECK (kind IN ('GuardrailPre','Route','AgentInvoke','ToolCall','Retrieval','Merge',
                    'GuardrailPost','Handover','FlowEscape'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraceSteps_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraceSteps]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraceSteps] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraceSteps_status
    CHECK (status IN ('Ok','Failed','Timeout','Blocked','Skipped'));

-- CK_OrchestrationTraceSteps_toolCallHasBinding (§4.5) — the tool-permission boundary
-- showing up in the trace. B3's rule: "Registered is not callable. A tool exists on the
-- server once discovered, but the agent can only invoke it if explicitly bound." A tool
-- that was discovered but never bound has no ToolBinding row, so a trace step recording
-- its invocation CANNOT BE INSERTED: an invocation that bypassed the binding check would
-- be impossible to log and would fail loudly.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraceSteps_toolCallHasBinding'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraceSteps]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraceSteps] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraceSteps_toolCallHasBinding
    CHECK (kind <> 'ToolCall' OR toolBindingId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraceSteps_argumentsMasked_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraceSteps]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraceSteps] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraceSteps_argumentsMasked_isJson
    CHECK (argumentsMasked IS NULL OR ISJSON(argumentsMasked) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraceSteps_confidence'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraceSteps]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraceSteps] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraceSteps_confidence
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1);

-- -------------------------------------------------------------------------------------
-- 2.5b  orchestration — pipeline designer (§4.5b). A real, versioned, drag-and-drop
-- multi-agent GRAPH replacing RouterConfigs.executionMode's single tenant-wide enum for
-- any tenant that activates one. See prisma/tenant/schema.prisma's own §4.5b header
-- comment for the full design; this section is its runtime enforcement.
-- -------------------------------------------------------------------------------------

-- CK_OrchestrationTraces_hops widened 10 -> 50 (probe-then-drop-then-recreate, since this
-- file is otherwise strictly additive): a real multi-branch pipeline turn legitimately
-- needs more headroom than the old 3-agent ceiling. Idempotent either way — a schema
-- already at 50 is left untouched.
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_OrchestrationTraces_hops'
             AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraces]')
             AND definition NOT LIKE '%50%')
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraces] DROP CONSTRAINT CK_OrchestrationTraces_hops;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraces_hops'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraces]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraces] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraces_hops
    CHECK (hopCount <= 50);

-- CK_OrchestrationTraceSteps_kind widened to add 'FanOut'/'LoopBack' — one FanOut step per
-- parallel fan-out point, one LoopBack step per loop decision (taken or not).
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_OrchestrationTraceSteps_kind'
             AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraceSteps]')
             AND definition NOT LIKE '%FanOut%')
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraceSteps] DROP CONSTRAINT CK_OrchestrationTraceSteps_kind;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraceSteps_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraceSteps]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraceSteps] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraceSteps_kind
    CHECK (kind IN ('GuardrailPre','Route','AgentInvoke','ToolCall','Retrieval','Merge',
                    'GuardrailPost','Handover','FlowEscape','FanOut','LoopBack'));

-- CK_OrchestrationTraces_executionMode — this column had NO check before. The three
-- legacy values stay real (historical rows carry them); a graph-executed turn writes
-- 'Pipeline'.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrchestrationTraces_executionMode'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[OrchestrationTraces]'))
  ALTER TABLE [{{SCHEMA}}].[OrchestrationTraces] WITH CHECK ADD CONSTRAINT CK_OrchestrationTraces_executionMode
    CHECK (executionMode IN ('Sequential','Parallel','SupervisorWorker','Pipeline'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineDesigns_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineDesigns]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineDesigns] WITH CHECK ADD CONSTRAINT CK_PipelineDesigns_status
    CHECK (status IN ('Draft','Published','Archived'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineDesigns_publishedHasVersion'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineDesigns]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineDesigns] WITH CHECK ADD CONSTRAINT CK_PipelineDesigns_publishedHasVersion
    CHECK (status <> 'Published' OR currentVersionId IS NOT NULL);

-- UQ_PipelineDesigns_slug (§4.5b) — FILTERED, mirrors UQ_Agents_slug/UQ_Flows_slug's own
-- "unique among non-deleted" shape.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_PipelineDesigns_slug'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineDesigns]'))
  CREATE UNIQUE INDEX UQ_PipelineDesigns_slug ON [{{SCHEMA}}].[PipelineDesigns](slug)
    WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_status
    CHECK (status IN ('Draft','Published','Archived'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_publishedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_publishedPaired
    CHECK (CAST(CASE WHEN status = 'Published' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN publishedAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_publishedHasEntry'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_publishedHasEntry
    CHECK (status <> 'Published' OR entryNodeId IS NOT NULL);

-- CK_PipelineVersions_ceilings (§4.5b) — mirrors CK_RouterConfigs_maxHops's own "one
-- constraint spanning the real related columns" shape.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_ceilings'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_ceilings
    CHECK (maxTotalHops BETWEEN 1 AND 50 AND costCeilingTokens > 0 AND costCeilingMicroAed > 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_confidence'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_confidence
    CHECK (minRoutingConfidence BETWEEN 0 AND 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_mergePolicy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_mergePolicy
    CHECK (defaultMergePolicy IN ('ConcatenateInOrder','DeduplicateOverlap','SupervisorRewrite'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_conflictResolution'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_conflictResolution
    CHECK (defaultConflictResolution IN ('HighestConfidence','PreferOwningEntity','SupervisorArbitrates'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineVersions_routingStrategy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineVersions] WITH CHECK ADD CONSTRAINT CK_PipelineVersions_routingStrategy
    CHECK (routingStrategy IN ('IntentClassifier','LlmRouter','RuleFirst'));

-- UQ_PipelineVersions_designId_current (§4.5b) — FILTERED, mirrors
-- UQ_FlowVersions_flowId_current/UQ_AgentVersions_agentId_current exactly.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_PipelineVersions_designId_current'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineVersions]'))
  CREATE UNIQUE INDEX UQ_PipelineVersions_designId_current ON [{{SCHEMA}}].[PipelineVersions](pipelineDesignId)
    WHERE isCurrent = 1;

-- TR_PipelineVersions_publishedImmutable (§4.5b). Same argument as agent/flow versions: a
-- live, activated pipeline is a snapshot other rows (traces) pin by id.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_PipelineVersions_publishedImmutable]
ON [{{SCHEMA}}].[PipelineVersions] AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE d.status = ''Published''
      AND (ISNULL(i.entryNodeId, N'''') <> ISNULL(d.entryNodeId, N'''')
           OR i.major <> d.major OR i.minor <> d.minor
           OR i.maxTotalHops <> d.maxTotalHops
           OR i.costCeilingTokens <> d.costCeilingTokens
           OR i.costCeilingMicroAed <> d.costCeilingMicroAed
           OR i.defaultMergePolicy <> d.defaultMergePolicy
           OR i.defaultConflictResolution <> d.defaultConflictResolution))
    THROW 51200, ''A Published pipeline version is immutable; create a new version instead.'', 1;
END');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_kind
    CHECK (kind IN ('Start','Agent','Supervisor','Response'));

-- CK_PipelineNodes_agentPaired (§4.5b) — exactly one of agentId/usesTurnBoundAgent on an
-- invoking node; neither on Start/Response.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_agentPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_agentPaired
    CHECK (
      (kind IN ('Agent','Supervisor')
        AND ((agentId IS NOT NULL AND usesTurnBoundAgent = 0)
          OR (agentId IS NULL AND usesTurnBoundAgent = 1)))
      OR (kind IN ('Start','Response') AND agentId IS NULL AND usesTurnBoundAgent = 0
          AND agentVersionPinId IS NULL AND timeoutMsOverride IS NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_pinNeedsAgent'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_pinNeedsAgent
    CHECK (agentVersionPinId IS NULL OR agentId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_inputContextMode'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_inputContextMode
    CHECK (inputContextMode IN ('UserTurnOnly','UpstreamRepliesFull','UpstreamRepliesSummary'));

-- CK_PipelineNodes_supervisorContext (§4.5b) — a supervisor that ignores its workers is
-- not a supervisor.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_supervisorContext'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_supervisorContext
    CHECK (kind <> 'Supervisor' OR inputContextMode <> 'UserTurnOnly');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_onErrorPolicy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_onErrorPolicy
    CHECK (onErrorPolicy IN ('FailTurn','SkipNode','RouteToFallbackAgent'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_mergePolicyOverride'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_mergePolicyOverride
    CHECK (mergePolicyOverride IS NULL
        OR mergePolicyOverride IN ('ConcatenateInOrder','DeduplicateOverlap','SupervisorRewrite'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_conflictResolutionOverride'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_conflictResolutionOverride
    CHECK (conflictResolutionOverride IS NULL
        OR conflictResolutionOverride IN ('HighestConfidence','PreferOwningEntity','SupervisorArbitrates'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineNodes_costOverrides'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineNodes] WITH CHECK ADD CONSTRAINT CK_PipelineNodes_costOverrides
    CHECK ((costCeilingTokensOverride IS NULL OR costCeilingTokensOverride > 0)
       AND (costCeilingMicroAedOverride IS NULL OR costCeilingMicroAedOverride > 0)
       AND (timeoutMsOverride IS NULL OR timeoutMsOverride BETWEEN 100 AND 120000));

-- UQ_PipelineNodes_start / UQ_PipelineNodes_turnBoundAgent (§4.5b) — FILTERED. Exactly one
-- Start node and at most one turn-bound node per version, declaratively.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_PipelineNodes_start'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  CREATE UNIQUE INDEX UQ_PipelineNodes_start ON [{{SCHEMA}}].[PipelineNodes](pipelineVersionId)
    WHERE kind = 'Start';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_PipelineNodes_turnBoundAgent'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineNodes]'))
  CREATE UNIQUE INDEX UQ_PipelineNodes_turnBoundAgent ON [{{SCHEMA}}].[PipelineNodes](pipelineVersionId)
    WHERE usesTurnBoundAgent = 1;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineEdges_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineEdges]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineEdges] WITH CHECK ADD CONSTRAINT CK_PipelineEdges_kind
    CHECK (kind IN ('Sequential','Parallel','LoopBack'));

-- CK_PipelineEdges_selfLoopOnlyLoopBack (§4.5b) — a self-edge is legal ONLY as a loop-back
-- ("retry this node N times"). A DELIBERATE divergence from CK_FlowEdges_noSelfLoop.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineEdges_selfLoopOnlyLoopBack'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineEdges]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineEdges] WITH CHECK ADD CONSTRAINT CK_PipelineEdges_selfLoopOnlyLoopBack
    CHECK (fromNodeId <> toNodeId OR kind = 'LoopBack');

-- CK_PipelineEdges_loopFields (§4.5b) — maxIterations is MANDATORY on a loop-back and
-- forbidden elsewhere: the hard backstop made unrepresentable-to-omit.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineEdges_loopFields'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineEdges]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineEdges] WITH CHECK ADD CONSTRAINT CK_PipelineEdges_loopFields
    CHECK (CAST(CASE WHEN kind = 'LoopBack' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN maxIterations IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineEdges_maxIterationsBounded'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineEdges]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineEdges] WITH CHECK ADD CONSTRAINT CK_PipelineEdges_maxIterationsBounded
    CHECK (maxIterations IS NULL OR maxIterations BETWEEN 1 AND 20);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineEdges_conditionOnlyOnLoop'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineEdges]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineEdges] WITH CHECK ADD CONSTRAINT CK_PipelineEdges_conditionOnlyOnLoop
    CHECK (conditionExpression IS NULL OR kind = 'LoopBack');

-- CK_PipelineEdges_conditionCharset (§4.5b) — a charset FLOOR under apps/ai's
-- domain/condition_expr.py grammar: even a seed script writing directly to SQL cannot
-- store a character the parser does not accept. The grammar itself (field names,
-- operators, numeric/string/boolean literals, and/or) is validated by
-- POST /v1/orchestration/pipelines/validate-condition, never by SQL Server.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PipelineEdges_conditionCharset'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PipelineEdges]'))
  ALTER TABLE [{{SCHEMA}}].[PipelineEdges] WITH CHECK ADD CONSTRAINT CK_PipelineEdges_conditionCharset
    CHECK (conditionExpression IS NULL
           OR conditionExpression NOT LIKE '%[^a-zA-Z0-9_ .<>=!''-]%');

-- TR_PipelineEdges_sameVersion (§4.5b) — direct TR_FlowEdges_sameVersion copy: both
-- endpoints must belong to pipelineVersionId, so a canvas cannot reference another
-- pipeline's node.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_PipelineEdges_sameVersion]
ON [{{SCHEMA}}].[PipelineEdges] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[PipelineNodes] f ON f.id = i.fromNodeId
    JOIN [{{SCHEMA}}].[PipelineNodes] t ON t.id = i.toNodeId
    WHERE f.pipelineVersionId <> i.pipelineVersionId OR t.pipelineVersionId <> i.pipelineVersionId)
    THROW 51201, ''Both endpoints of a pipeline edge must belong to the same pipeline version.'', 1;
END');
GO

-- TR_PipelineEdges_homogeneousFanOut (§4.5b) — for any (pipelineVersionId, fromNodeId),
-- the non-LoopBack outgoing edges are either exactly one Sequential, or two-or-more
-- all-Parallel. A 2-way "Sequential" fan-out has no defined execution order, and a 1-way
-- "Parallel" edge is a lie.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_PipelineEdges_homogeneousFanOut]
ON [{{SCHEMA}}].[PipelineEdges] AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT e.pipelineVersionId, e.fromNodeId
    FROM [{{SCHEMA}}].[PipelineEdges] e
    WHERE e.kind <> ''LoopBack''
      AND e.fromNodeId IN (
        SELECT i.fromNodeId FROM inserted i
        UNION SELECT d.fromNodeId FROM deleted d)
    GROUP BY e.pipelineVersionId, e.fromNodeId
    HAVING COUNT(*) > 1 AND SUM(CASE WHEN e.kind = ''Sequential'' THEN 1 ELSE 0 END) > 0)
    THROW 51202, ''A node''''s outgoing connections must be exactly one Sequential, or two or more all-Parallel.'', 1;
END');
GO

-- TR_PipelineVersions_publishGraphValid (§4.5b) — the whole-graph publish gate, fired only
-- when a version transitions to Published. Mirrored, not merely referenced, by
-- apps/ai's domain/pipeline.py::validate_definition (the runtime twin) and
-- modules/orchestration/domain/pipeline-graph.ts::analyzePipelineGraph (the live
-- client-side twin) — all three are meant to agree on exactly what a legal pipeline is.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_PipelineVersions_publishGraphValid]
ON [{{SCHEMA}}].[PipelineVersions] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted WHERE status = ''Published'') RETURN;

  -- (a) entryNodeId must be this version''s own Start node
  IF EXISTS (SELECT 1 FROM inserted i WHERE i.status = ''Published''
             AND NOT EXISTS (SELECT 1 FROM [{{SCHEMA}}].[PipelineNodes] n
                             WHERE n.id = i.entryNodeId AND n.pipelineVersionId = i.id
                               AND n.kind = ''Start''))
    THROW 51203, ''A Published pipeline version''''s entryNodeId must be its own Start node.'', 1;

  -- (b) at least one terminal/response node
  IF EXISTS (SELECT 1 FROM inserted i WHERE i.status = ''Published''
             AND NOT EXISTS (SELECT 1 FROM [{{SCHEMA}}].[PipelineNodes] n
                             WHERE n.pipelineVersionId = i.id AND n.kind = ''Response''))
    THROW 51204, ''A Published pipeline version must have at least one Response node.'', 1;

  -- (c) no orphans over FORWARD edges: every non-Start node has an inbound forward edge;
  --     every non-Response node has an outbound forward edge.
  IF EXISTS (SELECT 1 FROM inserted i
             JOIN [{{SCHEMA}}].[PipelineNodes] n ON n.pipelineVersionId = i.id
             WHERE i.status = ''Published'' AND n.kind <> ''Start''
               AND NOT EXISTS (SELECT 1 FROM [{{SCHEMA}}].[PipelineEdges] e
                               WHERE e.toNodeId = n.id AND e.kind <> ''LoopBack''))
    THROW 51205, ''A Published pipeline cannot contain a node with no inbound connection.'', 1;
  IF EXISTS (SELECT 1 FROM inserted i
             JOIN [{{SCHEMA}}].[PipelineNodes] n ON n.pipelineVersionId = i.id
             WHERE i.status = ''Published'' AND n.kind <> ''Response''
               AND NOT EXISTS (SELECT 1 FROM [{{SCHEMA}}].[PipelineEdges] e
                               WHERE e.fromNodeId = n.id AND e.kind <> ''LoopBack''))
    THROW 51206, ''A Published pipeline cannot contain a dead-end node with no outbound connection.'', 1;

  -- (d)+(e)+(f): one path-accumulating recursive walk over FORWARD edges only, from each
  --     version''s own Start node.
  ;WITH walk AS (
      SELECT i.id AS versionId, i.entryNodeId AS nodeId,
             CAST(N''|'' + i.entryNodeId + N''|'' AS NVARCHAR(4000)) AS path, 0 AS depth
      FROM inserted i WHERE i.status = ''Published''
      UNION ALL
      SELECT w.versionId, e.toNodeId,
             CAST(w.path + e.toNodeId + N''|'' AS NVARCHAR(4000)), w.depth + 1
      FROM walk w
      JOIN [{{SCHEMA}}].[PipelineEdges] e
        ON e.pipelineVersionId = w.versionId AND e.fromNodeId = w.nodeId AND e.kind <> ''LoopBack''
      WHERE w.path NOT LIKE N''%|'' + e.toNodeId + N''|%'' AND w.depth < 64)
  SELECT * INTO #pipelineWalk FROM walk OPTION (MAXRECURSION 256);

  -- (d) acyclic except through LoopBack: a forward edge whose target is already on the
  --     path that reached its source IS the cycle the walk refused to follow further.
  IF EXISTS (SELECT 1 FROM #pipelineWalk w
             JOIN [{{SCHEMA}}].[PipelineEdges] e
               ON e.pipelineVersionId = w.versionId AND e.fromNodeId = w.nodeId
              AND e.kind <> ''LoopBack''
             WHERE w.path LIKE N''%|'' + e.toNodeId + N''|%'')
    THROW 51207, ''A pipeline graph must be acyclic except through edges marked LoopBack.'', 1;

  -- (e) every node reachable from Start
  IF EXISTS (SELECT 1 FROM inserted i
             JOIN [{{SCHEMA}}].[PipelineNodes] n ON n.pipelineVersionId = i.id
             WHERE i.status = ''Published''
               AND NOT EXISTS (SELECT 1 FROM #pipelineWalk w WHERE w.versionId = i.id AND w.nodeId = n.id))
    THROW 51208, ''Every node in a Published pipeline must be reachable from the Start node.'', 1;

  -- (f) a LoopBack edge must target an ANCESTOR of its source over forward edges --
  --     otherwise it is a forward jump wearing a loop label, and the acyclicity
  --     exemption in (d) would be a hole rather than a rule.
  IF EXISTS (SELECT 1 FROM inserted i
             JOIN [{{SCHEMA}}].[PipelineEdges] e ON e.pipelineVersionId = i.id AND e.kind = ''LoopBack''
             WHERE i.status = ''Published''
               AND NOT EXISTS (SELECT 1 FROM #pipelineWalk w
                               WHERE w.versionId = i.id AND w.nodeId = e.fromNodeId
                                 AND (w.path LIKE N''%|'' + e.toNodeId + N''|%''
                                      OR e.toNodeId = e.fromNodeId)))
    THROW 51209, ''A LoopBack edge must point at a node already visited on the path to its source.'', 1;

  -- (g) a Published pipeline may not reference a Draft agent (or Draft pinned version) --
  --     TR_AgentFlowBindings_publishedNeedsPublishedFlow''s exact argument.
  IF EXISTS (SELECT 1 FROM inserted i
             JOIN [{{SCHEMA}}].[PipelineNodes] n ON n.pipelineVersionId = i.id
             LEFT JOIN [{{SCHEMA}}].[Agents] a ON a.id = n.agentId
             LEFT JOIN [{{SCHEMA}}].[AgentVersions] av ON av.id = n.agentVersionPinId
             WHERE i.status = ''Published''
               AND ((n.agentId IS NOT NULL AND a.status <> ''Published'')
                 OR (n.agentVersionPinId IS NOT NULL AND av.status <> ''Published'')))
    THROW 51210, ''A Published pipeline version cannot reference a Draft agent or agent version.'', 1;

  -- (h) a merge/conflict override only means something at a real join point
  IF EXISTS (SELECT 1 FROM inserted i
             JOIN [{{SCHEMA}}].[PipelineNodes] n ON n.pipelineVersionId = i.id
             WHERE i.status = ''Published''
               AND (n.mergePolicyOverride IS NOT NULL OR n.conflictResolutionOverride IS NOT NULL)
               AND (SELECT COUNT(*) FROM [{{SCHEMA}}].[PipelineEdges] e
                    WHERE e.toNodeId = n.id AND e.kind <> ''LoopBack'') < 2)
    THROW 51211, ''A merge/conflict override requires a node with two or more inbound connections.'', 1;

  -- (i) size ceiling -- keeps (d)''s recursion and the runtime interpreter bounded
  IF EXISTS (SELECT 1 FROM inserted i WHERE i.status = ''Published''
             AND ((SELECT COUNT(*) FROM [{{SCHEMA}}].[PipelineNodes] n WHERE n.pipelineVersionId = i.id) > 25
               OR (SELECT COUNT(*) FROM [{{SCHEMA}}].[PipelineEdges] e WHERE e.pipelineVersionId = i.id) > 60))
    THROW 51212, ''A pipeline version is limited to 25 nodes and 60 edges.'', 1;
END');
GO

-- TR_RouterConfigs_activePipelinePublished (§4.5b) — the tenant''s live pipeline pointer
-- must name a Published version, never a Draft.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_RouterConfigs_activePipelinePublished]
ON [{{SCHEMA}}].[RouterConfigs] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[PipelineVersions] v ON v.id = i.activePipelineVersionId
    WHERE i.activePipelineVersionId IS NOT NULL AND v.status <> ''Published'')
    THROW 51213, ''RouterConfigs.activePipelineVersionId must name a Published pipeline version.'', 1;
END');
GO

-- CK_GroundingCitations_rank (§4.5). topK is capped at 50 by CK_RetrievalConfigs_topK, so
-- a rank beyond it could only come from a bug.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GroundingCitations_rank'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GroundingCitations]'))
  ALTER TABLE [{{SCHEMA}}].[GroundingCitations] WITH CHECK ADD CONSTRAINT CK_GroundingCitations_rank
    CHECK (rank BETWEEN 1 AND 50);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GroundingCitations_retrievedVia'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GroundingCitations]'))
  ALTER TABLE [{{SCHEMA}}].[GroundingCitations] WITH CHECK ADD CONSTRAINT CK_GroundingCitations_retrievedVia
    CHECK (retrievedVia IN ('Graph','Vector','Hybrid'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GroundingCitations_scores'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GroundingCitations]'))
  ALTER TABLE [{{SCHEMA}}].[GroundingCitations] WITH CHECK ADD CONSTRAINT CK_GroundingCitations_scores
    CHECK (hybridScore BETWEEN 0 AND 1
       AND (vectorScore IS NULL OR vectorScore BETWEEN 0 AND 1)
       AND (graphScore  IS NULL OR graphScore  BETWEEN 0 AND 1)
       AND (rerankScore IS NULL OR rerankScore BETWEEN 0 AND 1));

-- -------------------------------------------------------------------------------------
-- 2.6  tools — skills, MCP, connectors, bindings, breakers (§4.6, B3 step 4, B5)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Skills_invocationKind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Skills]'))
  ALTER TABLE [{{SCHEMA}}].[Skills] WITH CHECK ADD CONSTRAINT CK_Skills_invocationKind
    CHECK (invocationKind IN ('Native','ApiConnector','McpTool'));

-- CK_Skills_exactlyOneSource (§4.6). A native skill has no projection source; a projected
-- one has exactly one. Two sources would make dispatch ambiguous.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Skills_exactlyOneSource'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Skills]'))
  ALTER TABLE [{{SCHEMA}}].[Skills] WITH CHECK ADD CONSTRAINT CK_Skills_exactlyOneSource
    CHECK ((CASE WHEN apiConnectorId IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN mcpToolId      IS NOT NULL THEN 1 ELSE 0 END)
         = CASE WHEN invocationKind = 'Native' THEN 0 ELSE 1 END);

-- CK_Skills_connectorHasRateLimit (§4.6). Can be a hard constraint only because
-- TR_ApiConnectors_projectSkill copies the connector's policy across on projection.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Skills_connectorHasRateLimit'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Skills]'))
  ALTER TABLE [{{SCHEMA}}].[Skills] WITH CHECK ADD CONSTRAINT CK_Skills_connectorHasRateLimit
    CHECK (invocationKind <> 'ApiConnector' OR rateLimitPolicyId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Skills_inputSchemaJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Skills]'))
  ALTER TABLE [{{SCHEMA}}].[Skills] WITH CHECK ADD CONSTRAINT CK_Skills_inputSchemaJson_isJson
    CHECK (ISJSON(inputSchemaJson) = 1
       AND (outputSchemaJson IS NULL OR ISJSON(outputSchemaJson) = 1));

-- UQ_Skills_key / _apiConnectorId / _mcpToolId (§4.6) — FILTERED. The two source uniques
-- guarantee the connector-to-skill projection is 1:1 and therefore IDEMPOTENT, which is
-- what lets TR_ApiConnectors_projectSkill re-run safely.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Skills_key'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Skills]'))
  CREATE UNIQUE INDEX UQ_Skills_key ON [{{SCHEMA}}].[Skills]([key]) WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Skills_apiConnectorId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Skills]'))
  CREATE UNIQUE INDEX UQ_Skills_apiConnectorId ON [{{SCHEMA}}].[Skills](apiConnectorId)
    WHERE apiConnectorId IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Skills_mcpToolId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Skills]'))
  CREATE UNIQUE INDEX UQ_Skills_mcpToolId ON [{{SCHEMA}}].[Skills](mcpToolId)
    WHERE mcpToolId IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_McpServers_transport'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[McpServers]'))
  ALTER TABLE [{{SCHEMA}}].[McpServers] WITH CHECK ADD CONSTRAINT CK_McpServers_transport
    CHECK (transport IN ('Stdio','Sse','StreamableHttp'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_McpServers_authMode'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[McpServers]'))
  ALTER TABLE [{{SCHEMA}}].[McpServers] WITH CHECK ADD CONSTRAINT CK_McpServers_authMode
    CHECK (authMode IN ('OAuth2ClientCredentials','MutualTls','ApiKey','None'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_McpServers_connectionState'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[McpServers]'))
  ALTER TABLE [{{SCHEMA}}].[McpServers] WITH CHECK ADD CONSTRAINT CK_McpServers_connectionState
    CHECK (connectionState IN ('NotConnected','Connected','Failed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_McpServers_authNeedsSecret'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[McpServers]'))
  ALTER TABLE [{{SCHEMA}}].[McpServers] WITH CHECK ADD CONSTRAINT CK_McpServers_authNeedsSecret
    CHECK (authMode = 'None' OR credentialSecretRef IS NOT NULL);

-- CK_McpServers_secretIsReference (§4.6, architecture §10). The column holds a REFERENCE,
-- never a secret. B3 step 4B registers mcp://customs.shj.ae with mTLS credentials; those
-- credentials live in config/env and this column names them.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_McpServers_secretIsReference'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[McpServers]'))
  ALTER TABLE [{{SCHEMA}}].[McpServers] WITH CHECK ADD CONSTRAINT CK_McpServers_secretIsReference
    CHECK (credentialSecretRef IS NULL
        OR credentialSecretRef LIKE 'env:%'
        OR credentialSecretRef LIKE 'k8s:%'
        OR credentialSecretRef LIKE 'vault:%');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_McpServers_endpoint'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[McpServers]'))
  CREATE UNIQUE INDEX UQ_McpServers_endpoint ON [{{SCHEMA}}].[McpServers](endpoint) WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_McpTools_inputSchemaJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[McpTools]'))
  ALTER TABLE [{{SCHEMA}}].[McpTools] WITH CHECK ADD CONSTRAINT CK_McpTools_inputSchemaJson_isJson
    CHECK (ISJSON(inputSchemaJson) = 1);

-- IX_McpTools_mcpServerId (§4.6) — FILTERED. A tool absent from a later discovery gets
-- removedAt set rather than being hard-deleted, so bindings stay resolvable and a trace
-- stays readable; the live set is what discovery and B5 tab 2 read.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_McpTools_mcpServerId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[McpTools]'))
  CREATE INDEX IX_McpTools_mcpServerId ON [{{SCHEMA}}].[McpTools](mcpServerId) WHERE removedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ApiConnectors_method'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ApiConnectors]'))
  ALTER TABLE [{{SCHEMA}}].[ApiConnectors] WITH CHECK ADD CONSTRAINT CK_ApiConnectors_method
    CHECK (method IN ('GET','POST','PUT','PATCH','DELETE'));

-- CK_ApiConnectors_httpsOnly (§4.6). A government service does not call a citizen-data
-- endpoint over plaintext, and a configuration screen is not the place to allow it.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ApiConnectors_httpsOnly'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ApiConnectors]'))
  ALTER TABLE [{{SCHEMA}}].[ApiConnectors] WITH CHECK ADD CONSTRAINT CK_ApiConnectors_httpsOnly
    CHECK (urlTemplate LIKE 'https://%');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ApiConnectors_testState'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ApiConnectors]'))
  ALTER TABLE [{{SCHEMA}}].[ApiConnectors] WITH CHECK ADD CONSTRAINT CK_ApiConnectors_testState
    CHECK (testState IN ('Untested','Tested','Failed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ApiConnectors_testedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ApiConnectors]'))
  ALTER TABLE [{{SCHEMA}}].[ApiConnectors] WITH CHECK ADD CONSTRAINT CK_ApiConnectors_testedPaired
    CHECK (CAST(CASE WHEN testState = 'Untested' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN lastTestedAt IS NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ApiConnectors_json'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ApiConnectors]'))
  ALTER TABLE [{{SCHEMA}}].[ApiConnectors] WITH CHECK ADD CONSTRAINT CK_ApiConnectors_json
    CHECK ((headersJson        IS NULL OR ISJSON(headersJson)        = 1)
       AND (requestSchemaJson  IS NULL OR ISJSON(requestSchemaJson)  = 1)
       AND (responseSchemaJson IS NULL OR ISJSON(responseSchemaJson) = 1)
       AND (sampleResponseJson IS NULL OR ISJSON(sampleResponseJson) = 1));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ApiConnectors_secretIsReference'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ApiConnectors]'))
  ALTER TABLE [{{SCHEMA}}].[ApiConnectors] WITH CHECK ADD CONSTRAINT CK_ApiConnectors_secretIsReference
    CHECK (credentialSecretRef IS NULL
        OR credentialSecretRef LIKE 'env:%'
        OR credentialSecretRef LIKE 'k8s:%'
        OR credentialSecretRef LIKE 'vault:%');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ApiConnectors_method_urlTemplate'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[ApiConnectors]'))
  CREATE UNIQUE INDEX UQ_ApiConnectors_method_urlTemplate
    ON [{{SCHEMA}}].[ApiConnectors](method, urlTemplate) WHERE deletedAt IS NULL;

-- TR_ApiConnectors_projectSkill (§4.6) — B3's second rule: "every API connector
-- automatically becomes a callable skill." A trigger rather than an application service,
-- so a connector created by a seed, an import or a second call site is projected too.
-- Idempotent through UQ_Skills_apiConnectorId; the soft delete cascades to the skill so a
-- retired connector stops being bindable while existing bindings remain resolvable for
-- trace readability.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_ApiConnectors_projectSkill]
ON [{{SCHEMA}}].[ApiConnectors] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [{{SCHEMA}}].[Skills]
    (id, [key], name, description, category, invocationKind, apiConnectorId, mcpToolId,
     inputSchemaJson, outputSchemaJson, rateLimitPolicyId, isSystem, isAttachedByDefault,
     createdAt, updatedAt)
  SELECT LEFT(REPLACE(CONVERT(char(36), NEWID()), ''-'', ''''), 26),
         ''connector_'' + LOWER(i.method) + ''_'' + LEFT(CONVERT(char(64), HASHBYTES(''SHA2_256'', i.urlTemplate), 2), 16),
         i.name, NULL, ''Connector'', ''ApiConnector'', i.id, NULL,
         ISNULL(i.requestSchemaJson, N''{}''), i.responseSchemaJson, i.rateLimitPolicyId, 0, 0,
         SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM inserted i
  WHERE i.deletedAt IS NULL
    AND NOT EXISTS (SELECT 1 FROM [{{SCHEMA}}].[Skills] s WHERE s.apiConnectorId = i.id);

  UPDATE s SET s.deletedAt = i.deletedAt, s.updatedAt = SYSUTCDATETIME()
  FROM [{{SCHEMA}}].[Skills] s JOIN inserted i ON i.id = s.apiConnectorId
  WHERE ISNULL(s.deletedAt, ''1900-01-01'') <> ISNULL(i.deletedAt, ''1900-01-01'');
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RateLimitPolicies_positive'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RateLimitPolicies]'))
  ALTER TABLE [{{SCHEMA}}].[RateLimitPolicies] WITH CHECK ADD CONSTRAINT CK_RateLimitPolicies_positive
    CHECK (requestsPerWindow > 0 AND windowSeconds > 0 AND burst >= 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RateLimitPolicies_scope'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RateLimitPolicies]'))
  ALTER TABLE [{{SCHEMA}}].[RateLimitPolicies] WITH CHECK ADD CONSTRAINT CK_RateLimitPolicies_scope
    CHECK (scope IN ('PerTenant','PerConversation','PerCitizen','PerAgent'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ToolBindings_targetKind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  ALTER TABLE [{{SCHEMA}}].[ToolBindings] WITH CHECK ADD CONSTRAINT CK_ToolBindings_targetKind
    CHECK (targetKind IN ('Skill','McpTool','ApiConnector'));

-- CK_ToolBindings_exactlyOneTarget (§4.6). The binding IS the permission, so it must name
-- exactly one thing to permit.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ToolBindings_exactlyOneTarget'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  ALTER TABLE [{{SCHEMA}}].[ToolBindings] WITH CHECK ADD CONSTRAINT CK_ToolBindings_exactlyOneTarget
    CHECK ((CASE WHEN skillId        IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN mcpToolId      IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN apiConnectorId IS NOT NULL THEN 1 ELSE 0 END) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ToolBindings_kindMatchesTarget'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  ALTER TABLE [{{SCHEMA}}].[ToolBindings] WITH CHECK ADD CONSTRAINT CK_ToolBindings_kindMatchesTarget
    CHECK ((targetKind = 'Skill'        AND skillId        IS NOT NULL)
        OR (targetKind = 'McpTool'      AND mcpToolId      IS NOT NULL)
        OR (targetKind = 'ApiConnector' AND apiConnectorId IS NOT NULL));

-- CK_ToolBindings_requiredAssurance (§4.6, B11 tab 2). The step-up level attaches to the
-- BINDING, not the tool, so get_bill_status can be anonymous for one agent and require
-- OTP for another.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ToolBindings_requiredAssurance'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  ALTER TABLE [{{SCHEMA}}].[ToolBindings] WITH CHECK ADD CONSTRAINT CK_ToolBindings_requiredAssurance
    CHECK (requiredAssurance IN ('Anonymous','Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ToolBindings_argumentPolicyJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  ALTER TABLE [{{SCHEMA}}].[ToolBindings] WITH CHECK ADD CONSTRAINT CK_ToolBindings_argumentPolicyJson_isJson
    CHECK (argumentPolicyJson IS NULL OR ISJSON(argumentPolicyJson) = 1);

-- UQ_ToolBindings_skill / _mcpTool / _apiConnector (§4.6) — three FILTERED uniques. One
-- binding per (agent version, target); a duplicate would make revocation ambiguous.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ToolBindings_skill'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  CREATE UNIQUE INDEX UQ_ToolBindings_skill ON [{{SCHEMA}}].[ToolBindings](agentVersionId, skillId)
    WHERE skillId IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ToolBindings_mcpTool'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  CREATE UNIQUE INDEX UQ_ToolBindings_mcpTool ON [{{SCHEMA}}].[ToolBindings](agentVersionId, mcpToolId)
    WHERE mcpToolId IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ToolBindings_apiConnector'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[ToolBindings]'))
  CREATE UNIQUE INDEX UQ_ToolBindings_apiConnector ON [{{SCHEMA}}].[ToolBindings](agentVersionId, apiConnectorId)
    WHERE apiConnectorId IS NOT NULL;

-- TR_ToolBindings_serverMustBeConnected (§4.6). Binding a tool on a NotConnected server
-- would grant a permission that cannot be exercised and would surface as a runtime
-- failure inside a citizen conversation rather than as a configuration error. The sibling
-- clause rejects a binding to a soft-deleted skill or connector.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_ToolBindings_serverMustBeConnected]
ON [{{SCHEMA}}].[ToolBindings] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[McpTools]   t ON t.id = i.mcpToolId
    JOIN [{{SCHEMA}}].[McpServers] s ON s.id = t.mcpServerId
    WHERE s.connectionState = ''NotConnected'' OR s.deletedAt IS NOT NULL OR t.removedAt IS NOT NULL)
    THROW 51120, ''A tool binding requires a Connected MCP server and a live tool (B3 step 4B, B5 tab 2).'', 1;

  IF EXISTS (SELECT 1 FROM inserted i JOIN [{{SCHEMA}}].[Skills] sk ON sk.id = i.skillId
             WHERE sk.deletedAt IS NOT NULL)
     OR EXISTS (SELECT 1 FROM inserted i JOIN [{{SCHEMA}}].[ApiConnectors] ac ON ac.id = i.apiConnectorId
                WHERE ac.deletedAt IS NOT NULL)
    THROW 51121, ''A soft-deleted skill or connector cannot be newly bound (§4.6).'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerConfigs_targetKind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerConfigs] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerConfigs_targetKind
    CHECK (targetKind IN ('ApiConnector','McpServer','Channel','Internal'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerConfigs_fallbackStrategy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerConfigs] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerConfigs_fallbackStrategy
    CHECK (fallbackStrategy IN ('ApologiseOfferLiveAgent','ServeCachedAnswer','QueueAndRetry','FailClosed'));

-- CK_CircuitBreakerConfigs_cachedStrategyNeedsMaxAge (§4.6, B5 tab 4). Serving a cached
-- answer with no age ceiling is how a government service quotes a superseded tariff.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerConfigs_cachedStrategyNeedsMaxAge'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerConfigs] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerConfigs_cachedStrategyNeedsMaxAge
    CHECK (fallbackStrategy <> 'ServeCachedAnswer' OR cachedAnswerMaxAgeSeconds IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerConfigs_positive'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerConfigs] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerConfigs_positive
    CHECK (failureThreshold > 0 AND windowSeconds > 0 AND cooldownSeconds > 0 AND halfOpenProbes > 0
       AND (cachedAnswerMaxAgeSeconds IS NULL OR cachedAnswerMaxAgeSeconds > 0));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerConfigs_targetPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerConfigs] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerConfigs_targetPaired
    CHECK ((CASE WHEN targetId  IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN targetKey IS NOT NULL THEN 1 ELSE 0 END) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerEvents_transition'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerEvents]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerEvents] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerEvents_transition
    CHECK (transition IN ('Open','HalfOpen','Closed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerEvents_reason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerEvents]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerEvents] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerEvents_reason
    CHECK (reason IN ('ThresholdBreached','ManualTrip','ManualReset','CooldownElapsed',
                      'ProbeSucceeded','ProbeFailed'));

-- CK_CircuitBreakerEvents_manualHasActor (§4.6, B5 tab 4 "Reset / Trip manually").
-- A manual trip is attributable; an automatic one is not.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CircuitBreakerEvents_manualHasActor'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CircuitBreakerEvents]'))
  ALTER TABLE [{{SCHEMA}}].[CircuitBreakerEvents] WITH CHECK ADD CONSTRAINT CK_CircuitBreakerEvents_manualHasActor
    CHECK (reason NOT IN ('ManualTrip','ManualReset') OR actorStaffUserId IS NOT NULL);

-- -------------------------------------------------------------------------------------
-- 2.7  knowledge — Graph RAG sources, chunks, retrieval, conflicts (§4.7, B6, §5, §9)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_KnowledgeCollections_slug'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[KnowledgeCollections]'))
  CREATE UNIQUE INDEX UQ_KnowledgeCollections_slug ON [{{SCHEMA}}].[KnowledgeCollections](slug)
    WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_KnowledgeSources_sourceType'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[KnowledgeSources]'))
  ALTER TABLE [{{SCHEMA}}].[KnowledgeSources] WITH CHECK ADD CONSTRAINT CK_KnowledgeSources_sourceType
    CHECK (sourceType IN ('Document','UrlCrawler','Database','SharePoint','ApiFeed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_KnowledgeSources_schedule'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[KnowledgeSources]'))
  ALTER TABLE [{{SCHEMA}}].[KnowledgeSources] WITH CHECK ADD CONSTRAINT CK_KnowledgeSources_schedule
    CHECK (schedule IN ('Manual','Daily','Weekly'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_KnowledgeSources_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[KnowledgeSources]'))
  ALTER TABLE [{{SCHEMA}}].[KnowledgeSources] WITH CHECK ADD CONSTRAINT CK_KnowledgeSources_status
    CHECK (status IN ('Idle','Crawling','Indexing','Failed'));

-- CK_KnowledgeSources_countsCoherent (§4.7). indexedChunkCount above chunkCount would
-- push indexedPercent above 100 and make B6 tab 1 lie about indexing progress.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_KnowledgeSources_countsCoherent'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[KnowledgeSources]'))
  ALTER TABLE [{{SCHEMA}}].[KnowledgeSources] WITH CHECK ADD CONSTRAINT CK_KnowledgeSources_countsCoherent
    CHECK (indexedChunkCount <= chunkCount AND chunkCount >= 0 AND documentCount >= 0);

-- KnowledgeSources.indexedPercent — COMPUTED PERSISTED (§4.7, §9.4). "Computed, never
-- typed": it is the honest UI surface of eventual consistency. A source at 70% means every
-- chunk's text is durably in SQL Server and citable and 30% are not yet retrievable — a
-- real, legitimate, temporary state. The wireframe's Re-crawl now jumps to 100% instantly
-- because the prototype has no backend; the real implementation must not, because "a
-- progress bar that lies is worse than no progress bar, because an admin will act on it."
IF COL_LENGTH('[{{SCHEMA}}].[KnowledgeSources]', 'indexedPercent') IS NULL
  ALTER TABLE [{{SCHEMA}}].[KnowledgeSources]
    ADD indexedPercent AS (CASE WHEN chunkCount = 0 THEN 0
                                ELSE (indexedChunkCount * 100) / chunkCount END) PERSISTED;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_KnowledgeSources_knowledgeCollectionId_name'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[KnowledgeSources]'))
  CREATE UNIQUE INDEX UQ_KnowledgeSources_knowledgeCollectionId_name
    ON [{{SCHEMA}}].[KnowledgeSources](knowledgeCollectionId, name) WHERE removedAt IS NULL;

-- IX_KnowledgeSources_nextScheduledAt (§4.7) — FILTERED. The crawl scheduler's only
-- query; Manual sources are never due, so they stay out of the index.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KnowledgeSources_nextScheduledAt'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[KnowledgeSources]'))
  CREATE INDEX IX_KnowledgeSources_nextScheduledAt ON [{{SCHEMA}}].[KnowledgeSources](nextScheduledAt)
    WHERE schedule <> 'Manual' AND removedAt IS NULL;

-- UQ_SourceDocuments_source_externalRef_live (§4.7) — FILTERED. One live version of a
-- document per source; superseded revisions remain for provenance.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_SourceDocuments_source_externalRef_live'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[SourceDocuments]'))
  CREATE UNIQUE INDEX UQ_SourceDocuments_source_externalRef_live
    ON [{{SCHEMA}}].[SourceDocuments](knowledgeSourceId, externalRef) WHERE supersededAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SourceDocuments_supersededPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SourceDocuments]'))
  ALTER TABLE [{{SCHEMA}}].[SourceDocuments] WITH CHECK ADD CONSTRAINT CK_SourceDocuments_supersededPaired
    CHECK (CAST(CASE WHEN supersededAt IS NULL THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN supersededByDocumentId IS NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Chunks_vectorState'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Chunks]'))
  ALTER TABLE [{{SCHEMA}}].[Chunks] WITH CHECK ADD CONSTRAINT CK_Chunks_vectorState
    CHECK (vectorState IN ('Pending','Indexed','Stale','Failed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Chunks_graphState'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Chunks]'))
  ALTER TABLE [{{SCHEMA}}].[Chunks] WITH CHECK ADD CONSTRAINT CK_Chunks_graphState
    CHECK (graphState IN ('Pending','Indexed','Stale','Failed'));

-- CK_Chunks_embeddedPaired (§5.2). An Indexed chunk always knows WHICH MODEL produced its
-- vector, which is what makes the model-change re-index of §7.5 able to identify exactly
-- which points are stale rather than rebuilding everything blindly.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Chunks_embeddedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Chunks]'))
  ALTER TABLE [{{SCHEMA}}].[Chunks] WITH CHECK ADD CONSTRAINT CK_Chunks_embeddedPaired
    CHECK (CAST(CASE WHEN vectorState = 'Indexed' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN embeddedAt IS NOT NULL AND embeddingModel IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Chunks_offsets'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Chunks]'))
  ALTER TABLE [{{SCHEMA}}].[Chunks] WITH CHECK ADD CONSTRAINT CK_Chunks_offsets
    CHECK (charEnd > charStart AND charStart >= 0 AND tokenCount > 0);

-- CK_Chunks_dimension (§4.7, §7.2). The platform embeds at 3072; a chunk claiming another
-- dimension could not be compared against the collection it lives in.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Chunks_dimension'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Chunks]'))
  ALTER TABLE [{{SCHEMA}}].[Chunks] WITH CHECK ADD CONSTRAINT CK_Chunks_dimension
    CHECK (embeddingDimension IS NULL OR embeddingDimension = 3072);

-- IX_Chunks_* (§4.7). These drive indexedPercent and the reconciliation scan of §9.3.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Chunks_knowledgeSourceId_vectorState'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Chunks]'))
  CREATE INDEX IX_Chunks_knowledgeSourceId_vectorState
    ON [{{SCHEMA}}].[Chunks](knowledgeSourceId, vectorState) INCLUDE (graphState, contentHash);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Chunks_knowledgeCollectionId_vectorState'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Chunks]'))
  CREATE INDEX IX_Chunks_knowledgeCollectionId_vectorState
    ON [{{SCHEMA}}].[Chunks](knowledgeCollectionId, vectorState);

-- TR_Chunks_recountSource (§9.4). Maintains KnowledgeSources.chunkCount and
-- indexedChunkCount, where indexedChunkCount counts chunks that are Indexed in BOTH
-- derived stores — a chunk retrievable by vector but absent from the graph is not fully
-- indexed, and B6 tab 1's percentage must say so.
--
-- COALESCE(SUM(...), 0), not bare SUM(...): SQL Server's SUM() over zero matching rows
-- returns NULL, not 0 (unlike COUNT(*), which correctly returns 0 either way). Found live,
-- against a real database, the first time a source's *last* chunk was removed — the CROSS
-- APPLY subquery then matches zero rows, x.indexed evaluates to NULL, and the UPDATE fails
-- the NOT NULL constraint on indexedChunkCount, breaking FR-KNOW-04''s remove-a-source
-- cascade for exactly the case it must handle (a source''s only chunk being deleted).
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_Chunks_recountSource]
ON [{{SCHEMA}}].[Chunks] AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  ;WITH touched AS (
    SELECT knowledgeSourceId FROM inserted
    UNION
    SELECT knowledgeSourceId FROM deleted
  )
  UPDATE ks
     SET ks.chunkCount        = x.total,
         ks.indexedChunkCount = x.indexed,
         ks.updatedAt         = SYSUTCDATETIME()
  FROM [{{SCHEMA}}].[KnowledgeSources] ks
  JOIN touched t ON t.knowledgeSourceId = ks.id
  CROSS APPLY (
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN c.vectorState = ''Indexed'' AND c.graphState = ''Indexed'' THEN 1 ELSE 0 END), 0) AS indexed
    FROM [{{SCHEMA}}].[Chunks] c
    WHERE c.knowledgeSourceId = ks.id AND c.erasedAt IS NULL
  ) x;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IngestionRuns_trigger'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[IngestionRuns]'))
  ALTER TABLE [{{SCHEMA}}].[IngestionRuns] WITH CHECK ADD CONSTRAINT CK_IngestionRuns_trigger
    CHECK ([trigger] IN ('Manual','Schedule','ReindexAll','Reconciliation'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IngestionRuns_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[IngestionRuns]'))
  ALTER TABLE [{{SCHEMA}}].[IngestionRuns] WITH CHECK ADD CONSTRAINT CK_IngestionRuns_state
    CHECK (state IN ('Queued','Running','Completed','Failed','Cancelled'));

-- UQ_IngestionRuns_activePerSource (§4.7) — FILTERED. One ingest per source at a time.
-- The Redis lock (§8) is the fast path; this index is the CORRECTNESS BACKSTOP, because a
-- lost lock must not produce two concurrent crawls writing the same chunks.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_IngestionRuns_activePerSource'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[IngestionRuns]'))
  CREATE UNIQUE INDEX UQ_IngestionRuns_activePerSource ON [{{SCHEMA}}].[IngestionRuns](knowledgeSourceId)
    WHERE state IN ('Queued','Running');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReindexJobs_scope'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReindexJobs]'))
  ALTER TABLE [{{SCHEMA}}].[ReindexJobs] WITH CHECK ADD CONSTRAINT CK_ReindexJobs_scope
    CHECK (scope IN ('Tenant','Collection','Source','Document'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReindexJobs_reason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReindexJobs]'))
  ALTER TABLE [{{SCHEMA}}].[ReindexJobs] WITH CHECK ADD CONSTRAINT CK_ReindexJobs_reason
    CHECK (reason IN ('Manual','EmbeddingModelChange','RetrievalConfigChange','Reconciliation',
                      'Restore','GraphMerge'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReindexJobs_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReindexJobs]'))
  ALTER TABLE [{{SCHEMA}}].[ReindexJobs] WITH CHECK ADD CONSTRAINT CK_ReindexJobs_state
    CHECK (state IN ('Queued','Running','Completed','Failed','Cancelled'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReindexJobs_progress'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReindexJobs]'))
  ALTER TABLE [{{SCHEMA}}].[ReindexJobs] WITH CHECK ADD CONSTRAINT CK_ReindexJobs_progress
    CHECK (progressPercent BETWEEN 0 AND 100 AND chunksProcessed >= 0);

-- CK_ReindexJobs_scopePaired (§4.7). A Source-scoped job must name a source; a
-- Collection-scoped one must name a collection; a Tenant-scoped one names neither.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReindexJobs_scopePaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReindexJobs]'))
  ALTER TABLE [{{SCHEMA}}].[ReindexJobs] WITH CHECK ADD CONSTRAINT CK_ReindexJobs_scopePaired
    CHECK ((scope = 'Tenant'     AND knowledgeSourceId IS NULL     AND knowledgeCollectionId IS NULL)
        OR (scope = 'Collection' AND knowledgeCollectionId IS NOT NULL)
        OR (scope IN ('Source','Document') AND knowledgeSourceId IS NOT NULL));

-- UQ_ReindexJobs_activeTenantScope (§4.7) — FILTERED. Only one whole-tenant re-index at a
-- time; B6 tab 3's "Re-index all sources now" must not be startable twice.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ReindexJobs_activeTenantScope'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[ReindexJobs]'))
  CREATE UNIQUE INDEX UQ_ReindexJobs_activeTenantScope ON [{{SCHEMA}}].[ReindexJobs](scope)
    WHERE scope = 'Tenant' AND state IN ('Queued','Running');

-- CK_RetrievalConfigs_weightsSumToOne (§4.7) — the load-bearing one. B6's slider is ONE
-- degree of freedom, so two independently-editable weights that fail to sum to 1 must be
-- unrepresentable; otherwise the hybrid score silently stops being a weighted blend.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalConfigs_weightsSumToOne'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalConfigs] WITH CHECK ADD CONSTRAINT CK_RetrievalConfigs_weightsSumToOne
    CHECK (graphWeight + vectorWeight = 1.000);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalConfigs_scope'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalConfigs] WITH CHECK ADD CONSTRAINT CK_RetrievalConfigs_scope
    CHECK (scope IN ('Tenant','Collection'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalConfigs_overlapLessThanSize'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalConfigs] WITH CHECK ADD CONSTRAINT CK_RetrievalConfigs_overlapLessThanSize
    CHECK (chunkOverlapTokens < chunkSizeTokens AND chunkOverlapTokens >= 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalConfigs_rerankerPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalConfigs] WITH CHECK ADD CONSTRAINT CK_RetrievalConfigs_rerankerPaired
    CHECK (CAST(CASE WHEN rerankerEnabled = 0 THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN rerankerModel IS NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalConfigs_dimensionMatchesModel'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalConfigs] WITH CHECK ADD CONSTRAINT CK_RetrievalConfigs_dimensionMatchesModel
    CHECK (embeddingModel <> 'text-embedding-3-large' OR embeddingDimension = 3072);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalConfigs_topK'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalConfigs] WITH CHECK ADD CONSTRAINT CK_RetrievalConfigs_topK
    CHECK (topK BETWEEN 1 AND 50 AND rerankCandidateCount >= topK
       AND minGroundingConfidence BETWEEN 0 AND 1 AND maxGraphHops BETWEEN 1 AND 6);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalConfigs_defaultConflictPolicy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalConfigs] WITH CHECK ADD CONSTRAINT CK_RetrievalConfigs_defaultConflictPolicy
    CHECK (defaultConflictPolicy IN ('PreferMostRecentlyUpdated','PreferOwningEntitySource','AlwaysAskAdmin'));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RetrievalConfigs_tenantScope'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  CREATE UNIQUE INDEX UQ_RetrievalConfigs_tenantScope ON [{{SCHEMA}}].[RetrievalConfigs](scope)
    WHERE scope = 'Tenant';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RetrievalConfigs_knowledgeCollectionId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalConfigs]'))
  CREATE UNIQUE INDEX UQ_RetrievalConfigs_knowledgeCollectionId
    ON [{{SCHEMA}}].[RetrievalConfigs](knowledgeCollectionId) WHERE knowledgeCollectionId IS NOT NULL;

-- TR_RetrievalConfigs_modelChangeQueuesReindex (§4.7, §7.5). Changing the embedding model
-- or dimension enqueues a scoped ReindexJob, because a collection holding vectors from two
-- models silently degrades every similarity comparison in it — and a degradation nobody
-- enqueued is a degradation nobody notices.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_RetrievalConfigs_modelChangeQueuesReindex]
ON [{{SCHEMA}}].[RetrievalConfigs] AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [{{SCHEMA}}].[ReindexJobs]
    (id, scope, knowledgeSourceId, knowledgeCollectionId, reason, state, progressPercent,
     chunksTotal, chunksProcessed, targetEmbeddingModel, createdAt, updatedAt)
  SELECT LEFT(REPLACE(CONVERT(char(36), NEWID()), ''-'', ''''), 26),
         CASE WHEN i.scope = ''Tenant'' THEN ''Tenant'' ELSE ''Collection'' END,
         NULL, i.knowledgeCollectionId, ''EmbeddingModelChange'', ''Queued'', 0,
         NULL, 0, i.embeddingModel, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM inserted i JOIN deleted d ON d.id = i.id
  WHERE i.embeddingModel <> d.embeddingModel OR i.embeddingDimension <> d.embeddingDimension;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetrievalPlaygroundRuns_json'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetrievalPlaygroundRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RetrievalPlaygroundRuns] WITH CHECK ADD CONSTRAINT CK_RetrievalPlaygroundRuns_json
    CHECK (ISJSON(configSnapshotJson) = 1 AND ISJSON(resultsJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SourceConflicts_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SourceConflicts]'))
  ALTER TABLE [{{SCHEMA}}].[SourceConflicts] WITH CHECK ADD CONSTRAINT CK_SourceConflicts_status
    CHECK (status IN ('Open','Resolved','Ignored'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SourceConflicts_authoritativeSide'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SourceConflicts]'))
  ALTER TABLE [{{SCHEMA}}].[SourceConflicts] WITH CHECK ADD CONSTRAINT CK_SourceConflicts_authoritativeSide
    CHECK (authoritativeSide IS NULL OR authoritativeSide IN ('A','B'));

-- CK_SourceConflicts_differentSources (§4.7). A source disagreeing with itself is a
-- chunking artefact, not a source conflict.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SourceConflicts_differentSources'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SourceConflicts]'))
  ALTER TABLE [{{SCHEMA}}].[SourceConflicts] WITH CHECK ADD CONSTRAINT CK_SourceConflicts_differentSources
    CHECK (sideAKnowledgeSourceId <> sideBKnowledgeSourceId);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SourceConflicts_resolvedHasSide'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SourceConflicts]'))
  ALTER TABLE [{{SCHEMA}}].[SourceConflicts] WITH CHECK ADD CONSTRAINT CK_SourceConflicts_resolvedHasSide
    CHECK (CAST(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN authoritativeSide IS NOT NULL AND resolvedByStaffUserId IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- CK_SourceConflicts_penalty (§4.7). groundingPenalty is subtracted from the hybrid score
-- of any citation on either side of an OPEN conflict — the mechanism behind B6 tab 4's
-- link to B12's refusal threshold. A column rather than a constant, so it is tunable
-- without a deploy.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SourceConflicts_penalty'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[SourceConflicts]'))
  ALTER TABLE [{{SCHEMA}}].[SourceConflicts] WITH CHECK ADD CONSTRAINT CK_SourceConflicts_penalty
    CHECK (groundingPenalty BETWEEN 0 AND 1);

-- UQ_SourceConflicts_open (§4.7) — FILTERED. One open conflict per entity and topic, so
-- repeated detection UPDATES rather than duplicating a queue item an admin already saw.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_SourceConflicts_open'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[SourceConflicts]'))
  CREATE UNIQUE INDEX UQ_SourceConflicts_open ON [{{SCHEMA}}].[SourceConflicts](graphEntityKey, topic)
    WHERE status = 'Open';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphNodeRecords_label'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphNodeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphNodeRecords] WITH CHECK ADD CONSTRAINT CK_GraphNodeRecords_label
    CHECK (label IN ('Service','Provider','Fee','Document','Channel'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphNodeRecords_origin'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphNodeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphNodeRecords] WITH CHECK ADD CONSTRAINT CK_GraphNodeRecords_origin
    CHECK (origin IN ('Extracted','Authored'));

-- CK_GraphNodeRecords_authoredHasActor (§4.7). B6 tab 2's + Add node is an AUTHORED
-- decision; without an actor the rebuild path could not tell it from an extraction and
-- "Re-index all sources now" would become a data-loss button.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphNodeRecords_authoredHasActor'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphNodeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphNodeRecords] WITH CHECK ADD CONSTRAINT CK_GraphNodeRecords_authoredHasActor
    CHECK (origin <> 'Authored' OR authoredByStaffUserId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphNodeRecords_noSelfMerge'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphNodeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphNodeRecords] WITH CHECK ADD CONSTRAINT CK_GraphNodeRecords_noSelfMerge
    CHECK (mergedIntoNodeRecordId IS NULL OR mergedIntoNodeRecordId <> id);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphNodeRecords_json'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphNodeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphNodeRecords] WITH CHECK ADD CONSTRAINT CK_GraphNodeRecords_json
    CHECK ((aliasesJson    IS NULL OR ISJSON(aliasesJson)    = 1)
       AND (propertiesJson IS NULL OR ISJSON(propertiesJson) = 1));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GraphNodeRecords_label_canonicalKey'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GraphNodeRecords]'))
  CREATE UNIQUE INDEX UQ_GraphNodeRecords_label_canonicalKey
    ON [{{SCHEMA}}].[GraphNodeRecords](label, canonicalKey) WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GraphNodeRecords_mergedIntoNodeRecordId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GraphNodeRecords]'))
  CREATE INDEX IX_GraphNodeRecords_mergedIntoNodeRecordId
    ON [{{SCHEMA}}].[GraphNodeRecords](mergedIntoNodeRecordId) WHERE mergedIntoNodeRecordId IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphEdgeRecords_relationshipType'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphEdgeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphEdgeRecords] WITH CHECK ADD CONSTRAINT CK_GraphEdgeRecords_relationshipType
    CHECK (relationshipType IN ('PROVIDED_BY','HAS_FEE','DOCUMENTED_BY','PAYABLE_VIA','AVAILABLE_ON',
                                'MENTIONS','FROM_DOCUMENT','MERGED_INTO','SAME_AS'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphEdgeRecords_noSelfEdge'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphEdgeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphEdgeRecords] WITH CHECK ADD CONSTRAINT CK_GraphEdgeRecords_noSelfEdge
    CHECK (fromNodeRecordId <> toNodeRecordId);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphEdgeRecords_confidence'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphEdgeRecords]'))
  ALTER TABLE [{{SCHEMA}}].[GraphEdgeRecords] WITH CHECK ADD CONSTRAINT CK_GraphEdgeRecords_confidence
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GraphEdgeRecords_triple'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GraphEdgeRecords]'))
  CREATE UNIQUE INDEX UQ_GraphEdgeRecords_triple
    ON [{{SCHEMA}}].[GraphEdgeRecords](fromNodeRecordId, toNodeRecordId, relationshipType)
    WHERE deletedAt IS NULL;

-- TR_GraphEdgeRecords_typeMatchesLabels (§4.7, §6.2). Enforces the permitted label pairs.
-- Every relationship stays within one tenant by construction (the record lives in one
-- tenant schema), and this trigger stops a semantically impossible edge — e.g. a Fee
-- PROVIDED_BY a Document — from entering the rebuild path and then Neo4j.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_GraphEdgeRecords_typeMatchesLabels]
ON [{{SCHEMA}}].[GraphEdgeRecords] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[GraphNodeRecords] f ON f.id = i.fromNodeRecordId
    JOIN [{{SCHEMA}}].[GraphNodeRecords] t ON t.id = i.toNodeRecordId
    WHERE NOT (
         (i.relationshipType = ''PROVIDED_BY''   AND f.label = ''Service''  AND t.label = ''Provider'')
      OR (i.relationshipType = ''HAS_FEE''       AND f.label = ''Service''  AND t.label = ''Fee'')
      OR (i.relationshipType = ''DOCUMENTED_BY'' AND f.label = ''Service''  AND t.label = ''Document'')
      OR (i.relationshipType = ''PAYABLE_VIA''   AND f.label = ''Fee''      AND t.label = ''Channel'')
      OR (i.relationshipType = ''AVAILABLE_ON''  AND f.label IN (''Service'',''Fee'') AND t.label = ''Channel'')
      OR (i.relationshipType IN (''MERGED_INTO'',''SAME_AS'') AND f.label = t.label)))
    THROW 51130, ''Relationship type does not match the permitted label pair (data-model.md §6.2).'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphDuplicateCandidates_detectionMethod'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphDuplicateCandidates]'))
  ALTER TABLE [{{SCHEMA}}].[GraphDuplicateCandidates] WITH CHECK ADD CONSTRAINT CK_GraphDuplicateCandidates_detectionMethod
    CHECK (detectionMethod IN ('NormalizedName','AliasOverlap','FullTextSimilarity','Manual'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphDuplicateCandidates_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphDuplicateCandidates]'))
  ALTER TABLE [{{SCHEMA}}].[GraphDuplicateCandidates] WITH CHECK ADD CONSTRAINT CK_GraphDuplicateCandidates_state
    CHECK (state IN ('Open','Merged','Ignored'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphDuplicateCandidates_differentNodes'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphDuplicateCandidates]'))
  ALTER TABLE [{{SCHEMA}}].[GraphDuplicateCandidates] WITH CHECK ADD CONSTRAINT CK_GraphDuplicateCandidates_differentNodes
    CHECK (leftNodeRecordId <> rightNodeRecordId);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphDuplicateCandidates_similarity'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphDuplicateCandidates]'))
  ALTER TABLE [{{SCHEMA}}].[GraphDuplicateCandidates] WITH CHECK ADD CONSTRAINT CK_GraphDuplicateCandidates_similarity
    CHECK (similarity BETWEEN 0 AND 1);

-- GraphDuplicateCandidates.pairLowId / pairHighId — COMPUTED PERSISTED (§4.7), so
-- UQ_GraphDuplicateCandidates_pair can be unique on the ORDERED pair and
-- `SEWA <-> SEWA A&W` and its mirror are one row rather than two queue items for the same
-- human decision.
IF COL_LENGTH('[{{SCHEMA}}].[GraphDuplicateCandidates]', 'pairLowId') IS NULL
  ALTER TABLE [{{SCHEMA}}].[GraphDuplicateCandidates]
    ADD pairLowId AS (CASE WHEN leftNodeRecordId < rightNodeRecordId THEN leftNodeRecordId ELSE rightNodeRecordId END) PERSISTED,
        pairHighId AS (CASE WHEN leftNodeRecordId < rightNodeRecordId THEN rightNodeRecordId ELSE leftNodeRecordId END) PERSISTED;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GraphDuplicateCandidates_pair'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GraphDuplicateCandidates]'))
  CREATE UNIQUE INDEX UQ_GraphDuplicateCandidates_pair
    ON [{{SCHEMA}}].[GraphDuplicateCandidates](pairLowId, pairHighId);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphMergeDecisions_decision'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphMergeDecisions]'))
  ALTER TABLE [{{SCHEMA}}].[GraphMergeDecisions] WITH CHECK ADD CONSTRAINT CK_GraphMergeDecisions_decision
    CHECK (decision IN ('Merge','Ignore'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphMergeDecisions_mergePaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphMergeDecisions]'))
  ALTER TABLE [{{SCHEMA}}].[GraphMergeDecisions] WITH CHECK ADD CONSTRAINT CK_GraphMergeDecisions_mergePaired
    CHECK (CAST(CASE WHEN decision = 'Merge' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN survivingNodeRecordId IS NOT NULL AND absorbedNodeRecordId IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GraphMergeDecisions_distinctNodes'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GraphMergeDecisions]'))
  ALTER TABLE [{{SCHEMA}}].[GraphMergeDecisions] WITH CHECK ADD CONSTRAINT CK_GraphMergeDecisions_distinctNodes
    CHECK (survivingNodeRecordId IS NULL OR survivingNodeRecordId <> absorbedNodeRecordId);

-- UQ_GraphMergeDecisions_candidate (§4.7) — FILTERED. One live decision per candidate; a
-- reverted decision releases the slot so the pair can be decided again.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GraphMergeDecisions_candidate'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GraphMergeDecisions]'))
  CREATE UNIQUE INDEX UQ_GraphMergeDecisions_candidate
    ON [{{SCHEMA}}].[GraphMergeDecisions](graphDuplicateCandidateId) WHERE revertedAt IS NULL;

-- -------------------------------------------------------------------------------------
-- 2.8  flows — definitions, nodes, edges, the free-text escape (§4.8, B7, R3)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Flows_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Flows]'))
  ALTER TABLE [{{SCHEMA}}].[Flows] WITH CHECK ADD CONSTRAINT CK_Flows_status
    CHECK (status IN ('Draft','Published','Archived'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Flows_publishedHasVersion'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Flows]'))
  ALTER TABLE [{{SCHEMA}}].[Flows] WITH CHECK ADD CONSTRAINT CK_Flows_publishedHasVersion
    CHECK (status <> 'Published' OR currentVersionId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Flows_slug'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Flows]'))
  CREATE UNIQUE INDEX UQ_Flows_slug ON [{{SCHEMA}}].[Flows](slug) WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowVersions_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowVersions]'))
  ALTER TABLE [{{SCHEMA}}].[FlowVersions] WITH CHECK ADD CONSTRAINT CK_FlowVersions_status
    CHECK (status IN ('Draft','Published','Archived'));

-- CK_FlowVersions_publishedHasEscape (§4.8) — B7's purpose made
-- unrepresentable-to-violate. B7 exists to "author the dynamic journeys the brief calls
-- for, while guaranteeing free-text escape" (R3), and A2 step 4's rule says the escape
-- "is available at every node, and context is preserved rather than discarded." A
-- guarantee enforced by UI validation survives until someone writes a flow through an API
-- or a seed script; here a published flow version without an escape node is a constraint
-- violation, so the guarantee holds for EVERY write path including the migration seeds.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowVersions_publishedHasEscape'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowVersions]'))
  ALTER TABLE [{{SCHEMA}}].[FlowVersions] WITH CHECK ADD CONSTRAINT CK_FlowVersions_publishedHasEscape
    CHECK (status <> 'Published' OR (freeTextEscapeEnabled = 1 AND escapeNodeId IS NOT NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowVersions_publishedHasEntry'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowVersions]'))
  ALTER TABLE [{{SCHEMA}}].[FlowVersions] WITH CHECK ADD CONSTRAINT CK_FlowVersions_publishedHasEntry
    CHECK (status <> 'Published' OR entryNodeId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowVersions_publishedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowVersions]'))
  ALTER TABLE [{{SCHEMA}}].[FlowVersions] WITH CHECK ADD CONSTRAINT CK_FlowVersions_publishedPaired
    CHECK (CAST(CASE WHEN status = 'Published' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN publishedAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- UQ_FlowVersions_flowId_current (§4.8) — FILTERED.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_FlowVersions_flowId_current'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[FlowVersions]'))
  CREATE UNIQUE INDEX UQ_FlowVersions_flowId_current ON [{{SCHEMA}}].[FlowVersions](flowId)
    WHERE isCurrent = 1;

-- TR_FlowVersions_publishedImmutable (§4.8). Same argument as agent versions: a bound
-- agent version pins a flow version, so a published canvas is a snapshot.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_FlowVersions_publishedImmutable]
ON [{{SCHEMA}}].[FlowVersions] AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE d.status = ''Published''
      AND (ISNULL(i.entryNodeId, N'''') <> ISNULL(d.entryNodeId, N'''')
           OR ISNULL(i.escapeNodeId, N'''') <> ISNULL(d.escapeNodeId, N'''')
           OR i.freeTextEscapeEnabled <> d.freeTextEscapeEnabled
           OR i.major <> d.major OR i.minor <> d.minor))
    THROW 51140, ''A Published flow version is immutable; create a new version instead (B7).'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_type'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_type
    CHECK (type IN ('Message','Question','ToolCall','Handover','Condition'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_messageFields'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_messageFields
    CHECK (type <> 'Message' OR messageText IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_questionFields'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_questionFields
    CHECK (type <> 'Question' OR (slotName IS NOT NULL AND optionSourceKind IS NOT NULL));

-- CK_FlowNodes_toolCallFields (§4.8) — B7's retry contract. The inspector for "Fetch bill
-- by account #" reads "retries once on timeout, then falls through to the condition node."
-- A tool-call node with no onFailureNodeId is a node whose failure path is UNDEFINED, and
-- that undefined path is precisely what B7's rule connects to B8: "tool call failed twice
-- -> escalation reason on the ticket." Requiring the failure target at insert means the
-- flow-to-queue agreement cannot be broken by an incomplete node.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_toolCallFields'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_toolCallFields
    CHECK (type <> 'ToolCall' OR (toolBindingId IS NOT NULL AND retryCount IS NOT NULL
                                  AND onFailureNodeId IS NOT NULL));

-- CK_FlowNodes_handoverFields (§4.8). handoverReason draws on the same closed set as
-- EscalationTickets.reason, which is how "the flow definition and the operational queue
-- agree" (B7's rule) is maintained. UserRequest is the third value no flow node produces,
-- because it comes from the citizen.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_handoverFields'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_handoverFields
    CHECK (type <> 'Handover' OR handoverReason IN ('ToolFailure','LowConfidence'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_conditionFields'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_conditionFields
    CHECK (type <> 'Condition' OR conditionExpression IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_retryBounded'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_retryBounded
    CHECK (retryCount IS NULL OR retryCount BETWEEN 0 AND 3);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_optionSourceKind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_optionSourceKind
    CHECK (optionSourceKind IS NULL OR optionSourceKind IN ('Static','GraphEntityLabel','ToolResult'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_staticOptionsJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_staticOptionsJson_isJson
    CHECK (staticOptionsJson IS NULL OR ISJSON(staticOptionsJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowNodes_requiredAssurance'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowNodes]'))
  ALTER TABLE [{{SCHEMA}}].[FlowNodes] WITH CHECK ADD CONSTRAINT CK_FlowNodes_requiredAssurance
    CHECK (requiredAssurance IS NULL
        OR requiredAssurance IN ('Anonymous','Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowEdges_noSelfLoop'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowEdges]'))
  ALTER TABLE [{{SCHEMA}}].[FlowEdges] WITH CHECK ADD CONSTRAINT CK_FlowEdges_noSelfLoop
    CHECK (fromNodeId <> toNodeId);

-- UQ_FlowEdges_defaultBranch (§4.8) — FILTERED. One default branch per node, or branch
-- fallthrough would be non-deterministic.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_FlowEdges_defaultBranch'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[FlowEdges]'))
  CREATE UNIQUE INDEX UQ_FlowEdges_defaultBranch ON [{{SCHEMA}}].[FlowEdges](flowVersionId, fromNodeId)
    WHERE isDefaultBranch = 1;

-- TR_FlowEdges_sameVersion (§4.8). Both endpoints must belong to flowVersionId, so a
-- canvas cannot reference another flow's node — which would make a published flow's
-- behaviour depend on a version nobody pinned.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_FlowEdges_sameVersion]
ON [{{SCHEMA}}].[FlowEdges] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[FlowNodes] f ON f.id = i.fromNodeId
    JOIN [{{SCHEMA}}].[FlowNodes] t ON t.id = i.toNodeId
    WHERE f.flowVersionId <> i.flowVersionId OR t.flowVersionId <> i.flowVersionId)
    THROW 51141, ''Both endpoints of a flow edge must belong to the same flow version (B7).'', 1;
END');
GO

-- CK_FlowAssistantConfigs_singleton (§4.8) — the Flow Designer AI sidebar's model setting
-- is tenant-wide, same reasoning as CK_RouterConfigs_singleton: a second row would make
-- "which model answered this proposal" non-deterministic in a way no screen would reveal.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FlowAssistantConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FlowAssistantConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[FlowAssistantConfigs] WITH CHECK ADD CONSTRAINT CK_FlowAssistantConfigs_singleton
    CHECK (singletonKey = 1);

-- -------------------------------------------------------------------------------------
-- 2.9  handover — escalation queue, presence, routing rules (§4.9, B8, A3)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EscalationTickets_topicKey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  ALTER TABLE [{{SCHEMA}}].[EscalationTickets] WITH CHECK ADD CONSTRAINT CK_EscalationTickets_topicKey
    CHECK (topicKey IN ('Billing','Customs','Library','General'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EscalationTickets_priority'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  ALTER TABLE [{{SCHEMA}}].[EscalationTickets] WITH CHECK ADD CONSTRAINT CK_EscalationTickets_priority
    CHECK (priority IN ('Normal','High'));

-- CK_EscalationTickets_reason (§4.9, B7's rule). The SAME closed set as
-- FlowNodes.handoverReason plus UserRequest, which no flow node produces because it comes
-- from the citizen. Two triggers of the flow node, three reasons in the queue.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EscalationTickets_reason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  ALTER TABLE [{{SCHEMA}}].[EscalationTickets] WITH CHECK ADD CONSTRAINT CK_EscalationTickets_reason
    CHECK (reason IN ('ToolFailure','UserRequest','LowConfidence'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EscalationTickets_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  ALTER TABLE [{{SCHEMA}}].[EscalationTickets] WITH CHECK ADD CONSTRAINT CK_EscalationTickets_status
    CHECK (status IN ('Queued','Assigned','Active','Resolved','Abandoned'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EscalationTickets_assignedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  ALTER TABLE [{{SCHEMA}}].[EscalationTickets] WITH CHECK ADD CONSTRAINT CK_EscalationTickets_assignedPaired
    CHECK (CAST(CASE WHEN status IN ('Assigned','Active') THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN assignedStaffUserId IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EscalationTickets_contextSnapshotJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  ALTER TABLE [{{SCHEMA}}].[EscalationTickets] WITH CHECK ADD CONSTRAINT CK_EscalationTickets_contextSnapshotJson_isJson
    CHECK (ISJSON(contextSnapshotJson) = 1);

-- UQ_EscalationTickets_openPerConversation (§4.9) — FILTERED. One open ticket per
-- conversation; two would put the same citizen in two agents' queues.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_EscalationTickets_openPerConversation'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  CREATE UNIQUE INDEX UQ_EscalationTickets_openPerConversation
    ON [{{SCHEMA}}].[EscalationTickets](conversationId) WHERE status IN ('Queued','Assigned','Active');

-- IX_EscalationTickets_assignedStaffUserId (§4.9) — FILTERED. A live agent's own queue;
-- resolved tickets are the vast majority and stay out of it.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EscalationTickets_assignedStaffUserId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[EscalationTickets]'))
  CREATE INDEX IX_EscalationTickets_assignedStaffUserId
    ON [{{SCHEMA}}].[EscalationTickets](assignedStaffUserId) WHERE status IN ('Assigned','Active');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentPresence_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentPresence]'))
  ALTER TABLE [{{SCHEMA}}].[AgentPresence] WITH CHECK ADD CONSTRAINT CK_AgentPresence_status
    CHECK (status IN ('Available','Busy','Offline'));

-- CK_AgentPresence_capacity (§4.9). Assigning beyond capacity is how a queue silently
-- stops honouring its own concurrency limit.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentPresence_capacity'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentPresence]'))
  ALTER TABLE [{{SCHEMA}}].[AgentPresence] WITH CHECK ADD CONSTRAINT CK_AgentPresence_capacity
    CHECK (activeTicketCount <= maxConcurrentTickets AND activeTicketCount >= 0 AND maxConcurrentTickets > 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentPresence_offlineHasNoTickets'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AgentPresence]'))
  ALTER TABLE [{{SCHEMA}}].[AgentPresence] WITH CHECK ADD CONSTRAINT CK_AgentPresence_offlineHasNoTickets
    CHECK (status <> 'Offline' OR activeTicketCount = 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRules_attribute'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRules]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRules] WITH CHECK ADD CONSTRAINT CK_RoutingRules_attribute
    CHECK (attribute IN ('Topic','Priority','Channel','WaitTime'));

-- CK_RoutingRules_ordinalPositive (§4.9). Deliberately `> 0` so the reorder transaction's
-- park value of -1 is INVALID outside that transaction: a half-completed
-- "Move up" cannot be committed, and B8's rule tester can therefore prove the outcome of
-- a reordering before it goes live.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRules_ordinalPositive'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRules]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRules] WITH CHECK ADD CONSTRAINT CK_RoutingRules_ordinalPositive
    CHECK (ordinal > 0);

-- CK_RoutingRules_operatorMatchesAttribute (§4.9). B8's + Add rule form "auto-switches to
-- `>` for Wait time, `=` otherwise". The database asserts the same pairing, so a rule
-- created by an import or a seed cannot carry `Topic > Billing`, which would be
-- meaningless to the evaluator.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRules_operatorMatchesAttribute'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRules]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRules] WITH CHECK ADD CONSTRAINT CK_RoutingRules_operatorMatchesAttribute
    CHECK ((attribute =  'WaitTime' AND operator = 'Gt')
        OR (attribute <> 'WaitTime' AND operator = 'Eq'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRules_targetPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRules]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRules] WITH CHECK ADD CONSTRAINT CK_RoutingRules_targetPaired
    CHECK (CAST(CASE WHEN targetKind = 'Team' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN targetTeamId IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRules_targetKind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRules]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRules] WITH CHECK ADD CONSTRAINT CK_RoutingRules_targetKind
    CHECK (targetKind IN ('Team','Requeue'));

-- CK_RoutingRules_waitTimeNumeric (§4.9). A WaitTime rule compares seconds, so its value
-- must be a number.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRules_waitTimeNumeric'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRules]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRules] WITH CHECK ADD CONSTRAINT CK_RoutingRules_waitTimeNumeric
    CHECK (attribute <> 'WaitTime' OR value NOT LIKE '%[^0-9]%');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRuleTests_sampleJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRuleTests]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRuleTests] WITH CHECK ADD CONSTRAINT CK_RoutingRuleTests_sampleJson_isJson
    CHECK (ISJSON(sampleJson) = 1);

-- CK_RoutingRuleTests_firedPaired (§4.9). Loosened from a symmetric equality to a
-- one-way implication (2026-09-10, routing-rule-delete FK follow-up): the FK backing
-- firedRoutingRuleId changed from ON DELETE NO ACTION to ON DELETE SET NULL (see the
-- matching Prisma migration), so a test whose fired rule is later deleted now has
-- firedRoutingRuleId nulled out as a referential-integrity side effect while
-- fellToDefaultQueue correctly stays 0 (fellToDefaultQueue is a fixed historical fact
-- recorded at test time — a rule genuinely fired, and deleting it afterward does not
-- retroactively make the test "fall to the default queue"). The old symmetric equality
-- would reject exactly that state and make the FK's own SET NULL action fail the
-- moment it was ever exercised. The direction that remains a real invariant —
-- fellToDefaultQueue = 1 still requires no rule id was ever recorded — is kept.
--
-- IF NOT EXISTS guards a *name* match (CK_Tenants_status's own comment above explains
-- why), so this redefinition needs the same explicit drop-first shape.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RoutingRuleTests_firedPaired'
           AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RoutingRuleTests]'))
  ALTER TABLE [{{SCHEMA}}].[RoutingRuleTests] DROP CONSTRAINT CK_RoutingRuleTests_firedPaired;
ALTER TABLE [{{SCHEMA}}].[RoutingRuleTests] WITH CHECK ADD CONSTRAINT CK_RoutingRuleTests_firedPaired
  CHECK (fellToDefaultQueue = 0 OR firedRoutingRuleId IS NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CannedReplies_name_localeCode'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[CannedReplies]'))
  CREATE UNIQUE INDEX UQ_CannedReplies_name_localeCode
    ON [{{SCHEMA}}].[CannedReplies](name, localeCode) WHERE deletedAt IS NULL;

-- IX_CannedReplies_topicKey_localeCode (§4.9) — FILTERED. What B8's reply picker reads.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CannedReplies_topicKey_localeCode'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[CannedReplies]'))
  CREATE INDEX IX_CannedReplies_topicKey_localeCode ON [{{SCHEMA}}].[CannedReplies](topicKey, localeCode)
    WHERE isEnabled = 1 AND deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_HandoverConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[HandoverConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[HandoverConfigs] WITH CHECK ADD CONSTRAINT CK_HandoverConfigs_singleton
    CHECK (singletonKey = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_HandoverConfigs_positive'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[HandoverConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[HandoverConfigs] WITH CHECK ADD CONSTRAINT CK_HandoverConfigs_positive
    CHECK (maxWaitSecondsBeforeRequeue > 0);

-- CK_HandoverConfigs_offerRequiresMessage (§4.9, B10 tab 1's rule). If escalation is NOT
-- offered outside hours, the citizen must be told something instead — "otherwise users are
-- promised a handover that cannot happen."
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_HandoverConfigs_offerRequiresMessage'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[HandoverConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[HandoverConfigs] WITH CHECK ADD CONSTRAINT CK_HandoverConfigs_offerRequiresMessage
    CHECK (offerEscalationOutsideHours = 1 OR LEN(LTRIM(RTRIM(noAgentAvailableMessage))) > 0);

-- -------------------------------------------------------------------------------------
-- 2.10 channels — surfaces, widget, WhatsApp, templates, campaigns, locales (§4.10, B10)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Channels_key'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Channels]'))
  ALTER TABLE [{{SCHEMA}}].[Channels] WITH CHECK ADD CONSTRAINT CK_Channels_key
    CHECK ([key] IN ('WebWidget','WhatsApp','MobileApp','KioskIvr'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Channels_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Channels]'))
  ALTER TABLE [{{SCHEMA}}].[Channels] WITH CHECK ADD CONSTRAINT CK_Channels_state
    CHECK (state IN ('Live','Disabled'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Channels_availability'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Channels]'))
  ALTER TABLE [{{SCHEMA}}].[Channels] WITH CHECK ADD CONSTRAINT CK_Channels_availability
    CHECK (availability IN ('TwentyFourSeven','WorkingHours'));

-- CK_Channels_liveNeedsAgent (§4.10). B10 tab 1 shows Disabled channels with a dash for
-- agent and hours, so the pairing is real, not cosmetic.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Channels_liveNeedsAgent'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Channels]'))
  ALTER TABLE [{{SCHEMA}}].[Channels] WITH CHECK ADD CONSTRAINT CK_Channels_liveNeedsAgent
    CHECK (state <> 'Live' OR boundAgentId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Channels_disabledPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Channels]'))
  ALTER TABLE [{{SCHEMA}}].[Channels] WITH CHECK ADD CONSTRAINT CK_Channels_disabledPaired
    CHECK (state <> 'Disabled' OR disabledAt IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Channels_workingHoursPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Channels]'))
  ALTER TABLE [{{SCHEMA}}].[Channels] WITH CHECK ADD CONSTRAINT CK_Channels_workingHoursPaired
    CHECK (CAST(CASE WHEN availability = 'WorkingHours' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN workingHoursProfileId IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- CK_WorkingHoursProfiles_timezoneIana (§1.3, §4.10). An IANA zone, not an offset:
-- converting working hours to UTC at rest would silently break across a DST boundary in
-- any tenant that ever operates outside the Gulf.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WorkingHoursProfiles_timezoneIana'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WorkingHoursProfiles]'))
  ALTER TABLE [{{SCHEMA}}].[WorkingHoursProfiles] WITH CHECK ADD CONSTRAINT CK_WorkingHoursProfiles_timezoneIana
    CHECK (timezone LIKE '%/%' AND timezone NOT LIKE '%[+-]%');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WorkingHoursSlots_dayOfWeek'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WorkingHoursSlots]'))
  ALTER TABLE [{{SCHEMA}}].[WorkingHoursSlots] WITH CHECK ADD CONSTRAINT CK_WorkingHoursSlots_dayOfWeek
    CHECK (dayOfWeek BETWEEN 0 AND 6);

-- CK_WorkingHoursSlots_ordered (§4.10). An overnight window is TWO rows, which keeps the
-- open/closed comparison a single BETWEEN.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WorkingHoursSlots_ordered'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WorkingHoursSlots]'))
  ALTER TABLE [{{SCHEMA}}].[WorkingHoursSlots] WITH CHECK ADD CONSTRAINT CK_WorkingHoursSlots_ordered
    CHECK (closesAt > opensAt);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PublicHolidays_origin'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PublicHolidays]'))
  ALTER TABLE [{{SCHEMA}}].[PublicHolidays] WITH CHECK ADD CONSTRAINT CK_PublicHolidays_origin
    CHECK (origin IN ('AutoSync','Manual'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PublicHolidays_syncedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PublicHolidays]'))
  ALTER TABLE [{{SCHEMA}}].[PublicHolidays] WITH CHECK ADD CONSTRAINT CK_PublicHolidays_syncedPaired
    CHECK (origin <> 'AutoSync' OR syncedAt IS NOT NULL);

-- CK_WidgetConfigs_accentIsToken (§4.10, ADR-0007) — keeps the widget inside the design
-- system. B10 tab 2 offers 5 accent swatches with default #1F6F5C and it is tempting to
-- store the hex; but a hex literal in a config table is a hardcoded colour that has merely
-- moved from the code to the database, where the linter cannot see it. Storing a TOKEN KEY
-- resolved through the tenant's active TokenSet at render time means re-skinning a tenant
-- repaints the embedded widget too, with no widget-config edit and no re-issued snippet.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WidgetConfigs_accentIsToken'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WidgetConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[WidgetConfigs] WITH CHECK ADD CONSTRAINT CK_WidgetConfigs_accentIsToken
    CHECK (accentTokenKey NOT LIKE '#%' AND accentTokenKey NOT LIKE 'rgb%'
       AND accentTokenKey NOT LIKE 'hsl%' AND accentTokenKey LIKE '--%');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WidgetConfigs_launcherPosition'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WidgetConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[WidgetConfigs] WITH CHECK ADD CONSTRAINT CK_WidgetConfigs_launcherPosition
    CHECK (launcherPosition IN ('BottomRight','BottomLeft') AND defaultState IN ('Docked','Expanded'));

-- CK_WidgetAllowedDomains_noScheme / _noWildcardTld (§4.10). The embed allowlist is
-- security-relevant: a scheme or a path would not match at runtime, and a wildcard TLD
-- would allow the widget to be embedded anywhere.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WidgetAllowedDomains_noScheme'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WidgetAllowedDomains]'))
  ALTER TABLE [{{SCHEMA}}].[WidgetAllowedDomains] WITH CHECK ADD CONSTRAINT CK_WidgetAllowedDomains_noScheme
    CHECK (domain NOT LIKE '%://%' AND domain NOT LIKE '%/%' AND domain LIKE '%.%');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WidgetAllowedDomains_noWildcardTld'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WidgetAllowedDomains]'))
  ALTER TABLE [{{SCHEMA}}].[WidgetAllowedDomains] WITH CHECK ADD CONSTRAINT CK_WidgetAllowedDomains_noWildcardTld
    CHECK (domain NOT LIKE '*.%.*' AND domain NOT LIKE '%.*' AND domain <> '*');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WhatsAppConfigs_bspProvider'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WhatsAppConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[WhatsAppConfigs] WITH CHECK ADD CONSTRAINT CK_WhatsAppConfigs_bspProvider
    CHECK (bspProvider IN ('MetaCloudApi'));

-- CK_WhatsAppConfigs_sessionWindow (§4.10). The 24-hour window is a Meta PLATFORM RULE,
-- not a preference, so it is pinned rather than made editable — an admin cannot configure
-- their way into sending outside it.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WhatsAppConfigs_sessionWindow'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WhatsAppConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[WhatsAppConfigs] WITH CHECK ADD CONSTRAINT CK_WhatsAppConfigs_sessionWindow
    CHECK (sessionWindowHours = 24);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WhatsAppConfigs_secretIsReference'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[WhatsAppConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[WhatsAppConfigs] WITH CHECK ADD CONSTRAINT CK_WhatsAppConfigs_secretIsReference
    CHECK ((credentialSecretRef    LIKE 'env:%' OR credentialSecretRef    LIKE 'k8s:%' OR credentialSecretRef    LIKE 'vault:%')
       AND (webhookVerifySecretRef LIKE 'env:%' OR webhookVerifySecretRef LIKE 'k8s:%' OR webhookVerifySecretRef LIKE 'vault:%'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MessageTemplates_approvalStatus'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[MessageTemplates]'))
  ALTER TABLE [{{SCHEMA}}].[MessageTemplates] WITH CHECK ADD CONSTRAINT CK_MessageTemplates_approvalStatus
    CHECK (approvalStatus IN ('Draft','Pending','Approved','Rejected'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MessageTemplates_rejectedHasReason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[MessageTemplates]'))
  ALTER TABLE [{{SCHEMA}}].[MessageTemplates] WITH CHECK ADD CONSTRAINT CK_MessageTemplates_rejectedHasReason
    CHECK (approvalStatus <> 'Rejected' OR rejectionReason IS NOT NULL);

-- CK_MessageTemplates_approvedHasBspId (§4.10). An Approved template with no BSP id could
-- not actually be sent, and TR_Campaigns_templateMustBeApproved would then unblock a
-- campaign that cannot deliver.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MessageTemplates_approvedHasBspId'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[MessageTemplates]'))
  ALTER TABLE [{{SCHEMA}}].[MessageTemplates] WITH CHECK ADD CONSTRAINT CK_MessageTemplates_approvedHasBspId
    CHECK (approvalStatus <> 'Approved' OR bspTemplateId IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MessageTemplates_variablesJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[MessageTemplates]'))
  ALTER TABLE [{{SCHEMA}}].[MessageTemplates] WITH CHECK ADD CONSTRAINT CK_MessageTemplates_variablesJson_isJson
    CHECK (variablesJson IS NULL OR ISJSON(variablesJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_MessageTemplates_name_localeCode'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[MessageTemplates]'))
  CREATE UNIQUE INDEX UQ_MessageTemplates_name_localeCode
    ON [{{SCHEMA}}].[MessageTemplates](name, localeCode) WHERE deletedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Campaigns_trigger'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Campaigns]'))
  ALTER TABLE [{{SCHEMA}}].[Campaigns] WITH CHECK ADD CONSTRAINT CK_Campaigns_trigger
    CHECK ([trigger] IN ('RelativeToDueDate','OnBookingCreated','OnPaymentSettled','Manual'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Campaigns_offsetPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Campaigns]'))
  ALTER TABLE [{{SCHEMA}}].[Campaigns] WITH CHECK ADD CONSTRAINT CK_Campaigns_offsetPaired
    CHECK (CAST(CASE WHEN [trigger] = 'RelativeToDueDate' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN triggerOffsetHours IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Campaigns_audienceDefinitionJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Campaigns]'))
  ALTER TABLE [{{SCHEMA}}].[Campaigns] WITH CHECK ADD CONSTRAINT CK_Campaigns_audienceDefinitionJson_isJson
    CHECK (ISJSON(audienceDefinitionJson) = 1);

-- TR_Campaigns_templateMustBeApproved (§4.10) — B10 tab 4's dependency, ENFORCED rather
-- than described: "A campaign whose template is not Approved shows Blocked and its toggle
-- will not turn on. Approving appointment_confirmation in Tab 3 unblocks it — the
-- dependency is enforced, not just described." `Blocked` is therefore NOT a stored state:
-- storing it would create two facts that can disagree.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_Campaigns_templateMustBeApproved]
ON [{{SCHEMA}}].[Campaigns] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[MessageTemplates] t ON t.id = i.messageTemplateId
    WHERE i.isEnabled = 1 AND t.approvalStatus <> ''Approved'')
    THROW 51150, ''A campaign cannot be enabled while its message template is not Approved (B10 tab 4).'', 1;
END');

-- TR_MessageTemplates_blockDependentCampaigns (§4.10). The other half: a template moving
-- OUT of Approved forces its dependent campaigns off, so the Blocked badge and the toggle
-- can never disagree.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_MessageTemplates_blockDependentCampaigns]
ON [{{SCHEMA}}].[MessageTemplates] AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE c SET c.isEnabled = 0, c.updatedAt = SYSUTCDATETIME()
  FROM [{{SCHEMA}}].[Campaigns] c
  JOIN inserted i ON i.id = c.messageTemplateId
  JOIN deleted  d ON d.id = i.id
  WHERE d.approvalStatus = ''Approved'' AND i.approvalStatus <> ''Approved'' AND c.isEnabled = 1;
END');

-- CampaignStates (§4.10) — the three-state badge as a PROJECTION, so the UI renders from
-- data rather than from a stored flag that could disagree with the template.
EXEC(N'
CREATE OR ALTER VIEW [{{SCHEMA}}].[CampaignStates] AS
SELECT c.id,
       CASE WHEN t.approvalStatus <> ''Approved'' THEN ''Blocked''
            WHEN c.isEnabled = 1                 THEN ''On''
            ELSE                                      ''Off'' END AS state
FROM [{{SCHEMA}}].[Campaigns] c
JOIN [{{SCHEMA}}].[MessageTemplates] t ON t.id = c.messageTemplateId');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CampaignSends_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CampaignSends]'))
  ALTER TABLE [{{SCHEMA}}].[CampaignSends] WITH CHECK ADD CONSTRAINT CK_CampaignSends_state
    CHECK (state IN ('Queued','Sent','Delivered','Failed','Suppressed'));

-- CK_CampaignSends_suppressedPaired (§4.10). Both gates are re-checked AT SEND TIME, not
-- only at configuration time (B10 tab 4's second rule); this column is the record of that
-- re-check, so a suppressed send is never a silent drop.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CampaignSends_suppressedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CampaignSends]'))
  ALTER TABLE [{{SCHEMA}}].[CampaignSends] WITH CHECK ADD CONSTRAINT CK_CampaignSends_suppressedPaired
    CHECK (CAST(CASE WHEN state = 'Suppressed' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN suppressionReason IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CampaignSends_suppressionReason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CampaignSends]'))
  ALTER TABLE [{{SCHEMA}}].[CampaignSends] WITH CHECK ADD CONSTRAINT CK_CampaignSends_suppressionReason
    CHECK (suppressionReason IS NULL
        OR suppressionReason IN ('QuietHours','NoOptIn','TemplateNotApproved','Duplicate','ChannelDisabled'));

-- IX_CampaignSends_state (§4.10) — FILTERED. The send queue; delivered history is large
-- and irrelevant to the worker.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CampaignSends_state'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[CampaignSends]'))
  CREATE INDEX IX_CampaignSends_state ON [{{SCHEMA}}].[CampaignSends](queuedAt) WHERE state = 'Queued';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_QuietHoursConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[QuietHoursConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[QuietHoursConfigs] WITH CHECK ADD CONSTRAINT CK_QuietHoursConfigs_singleton
    CHECK (singletonKey = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_QuietHoursConfigs_timezoneIana'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[QuietHoursConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[QuietHoursConfigs] WITH CHECK ADD CONSTRAINT CK_QuietHoursConfigs_timezoneIana
    CHECK (timezone LIKE '%/%' AND timezone NOT LIKE '%[+-]%');

-- LocaleSettings_localeCode_fkey (§4.10, ADR-0011). One of the five relationships that
-- cross the platform/tenant boundary. Before ADR-0011 this was a Prisma-managed
-- `@relation`, emitted once by Prisma Migrate into tenant_template's migration history and
-- replayed per tenant by the provisioning orchestrator. `prisma/tenant/schema.prisma` no
-- longer declares it — Prisma cannot express a `@relation` across two separately generated
-- clients — so it is hand-maintained here from this point on, under the SAME name Prisma
-- originally generated (so this check is a no-op against every already-provisioned tenant,
-- whose schema already carries the constraint from the historical migration replay).
--
-- Scoped by parent_object_id, not name alone: a constraint name is unique per SCHEMA, not
-- per database, so `sewa` already having this constraint must not make the check for
-- `customs` a false positive and skip creating its own copy.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE name = 'LocaleSettings_localeCode_fkey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[LocaleSettings]'))
  ALTER TABLE [{{SCHEMA}}].[LocaleSettings] WITH CHECK ADD CONSTRAINT LocaleSettings_localeCode_fkey
    FOREIGN KEY ([localeCode]) REFERENCES [platform].[Locales]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- LocaleSettings.translatedPercent — COMPUTED PERSISTED (§4.10). This is what makes B10
-- tab 5's 82% Arabic figure a REAL number rather than a typed one, and it is the value
-- B13's locale gate joins against — there is no stored "is this agent locale-ready" flag
-- anywhere, because such a flag would be a fourth copy of a number that already exists
-- once.
IF COL_LENGTH('[{{SCHEMA}}].[LocaleSettings]', 'translatedPercent') IS NULL
  ALTER TABLE [{{SCHEMA}}].[LocaleSettings]
    ADD translatedPercent AS (CASE WHEN totalStringCount = 0 THEN 0
                                   ELSE (translatedStringCount * 100) / totalStringCount END) PERSISTED;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LocaleSettings_countsCoherent'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[LocaleSettings]'))
  ALTER TABLE [{{SCHEMA}}].[LocaleSettings] WITH CHECK ADD CONSTRAINT CK_LocaleSettings_countsCoherent
    CHECK (translatedStringCount <= totalStringCount AND translatedStringCount >= 0);

-- CK_LocaleSettings_fallbackMustBeEnabled (§4.10). A disabled fallback is not a fallback.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LocaleSettings_fallbackMustBeEnabled'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[LocaleSettings]'))
  ALTER TABLE [{{SCHEMA}}].[LocaleSettings] WITH CHECK ADD CONSTRAINT CK_LocaleSettings_fallbackMustBeEnabled
    CHECK (isFallback = 0 OR isEnabled = 1);

-- UQ_LocaleSettings_fallback (§4.10) — FILTERED. Exactly one fallback locale, because
-- "fall back to whichever" is not a behaviour.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_LocaleSettings_fallback'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[LocaleSettings]'))
  CREATE UNIQUE INDEX UQ_LocaleSettings_fallback ON [{{SCHEMA}}].[LocaleSettings](isFallback)
    WHERE isFallback = 1;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TranslationStrings_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TranslationStrings]'))
  ALTER TABLE [{{SCHEMA}}].[TranslationStrings] WITH CHECK ADD CONSTRAINT CK_TranslationStrings_state
    CHECK (state IN ('Missing','Draft','Translated','Reviewed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TranslationStrings_valuePaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TranslationStrings]'))
  ALTER TABLE [{{SCHEMA}}].[TranslationStrings] WITH CHECK ADD CONSTRAINT CK_TranslationStrings_valuePaired
    CHECK (CAST(CASE WHEN state = 'Missing' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN value IS NULL THEN 1 ELSE 0 END AS bit));

-- TR_TranslationStrings_recountLocale (§4.10). Maintains
-- LocaleSettings.translatedStringCount / totalStringCount, which feed translatedPercent,
-- which feeds B13's locale gate. One number, one place, three readers.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_TranslationStrings_recountLocale]
ON [{{SCHEMA}}].[TranslationStrings] AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  ;WITH touched AS (
    SELECT localeCode FROM inserted UNION SELECT localeCode FROM deleted
  )
  UPDATE ls
     SET ls.totalStringCount      = x.total,
         ls.translatedStringCount = x.done,
         ls.updatedAt             = SYSUTCDATETIME()
  FROM [{{SCHEMA}}].[LocaleSettings] ls
  JOIN touched t ON t.localeCode = ls.localeCode
  CROSS APPLY (
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN ts.state IN (''Translated'',''Reviewed'') THEN 1 ELSE 0 END) AS done
    FROM [{{SCHEMA}}].[TranslationStrings] ts
    WHERE ts.localeCode = ls.localeCode
  ) x;
END');

-- -------------------------------------------------------------------------------------
-- 2.11 verification — providers, step-up, identity stitching (§4.11, B11 tabs 1-2 & 5)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationProviders_key'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationProviders]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationProviders] WITH CHECK ADD CONSTRAINT CK_VerificationProviders_key
    CHECK ([key] IN ('UaePass','OtpSms','EmiratesIdScan'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationProviders_providerType'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationProviders]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationProviders] WITH CHECK ADD CONSTRAINT CK_VerificationProviders_providerType
    CHECK (providerType IN ('NationalDigitalIdentity','PossessionFactor','DocumentCheck'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationProviders_providesAssurance'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationProviders]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationProviders] WITH CHECK ADD CONSTRAINT CK_VerificationProviders_providesAssurance
    CHECK (providesAssurance IN ('Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

-- CK_VerificationProviders_enabledNeedsCredential (§4.11). An enabled provider with no
-- credential reference fails at the first citizen who needs it.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationProviders_enabledNeedsCredential'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationProviders]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationProviders] WITH CHECK ADD CONSTRAINT CK_VerificationProviders_enabledNeedsCredential
    CHECK (isEnabled = 0 OR credentialSecretRef IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationProviders_configJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationProviders]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationProviders] WITH CHECK ADD CONSTRAINT CK_VerificationProviders_configJson_isJson
    CHECK (configJson IS NULL OR ISJSON(configJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationConfigs] WITH CHECK ADD CONSTRAINT CK_VerificationConfigs_singleton
    CHECK (singletonKey = 1);

-- CK_VerificationConfigs_disableNeedsReason (§4.11) — the ownership check. B11 tab 1:
-- "With ownership checking off, a user could look up or pay against an account they do
-- not hold. This is the single most consequential toggle in the prototype." Turning it off
-- is permitted, because the wireframe makes it a toggle; turning it off SILENTLY is not.
-- With the mandatory audit write on every config change, the disabled state always has a
-- name and a stated justification attached to it.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationConfigs_disableNeedsReason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationConfigs] WITH CHECK ADD CONSTRAINT CK_VerificationConfigs_disableNeedsReason
    CHECK (accountOwnershipCheckEnabled = 1
        OR (ownershipCheckDisabledReason IS NOT NULL
            AND ownershipCheckLastChangedByStaffUserId IS NOT NULL
            AND LEN(LTRIM(RTRIM(ownershipCheckDisabledReason))) >= 10));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationConfigs_otpBounds'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationConfigs] WITH CHECK ADD CONSTRAINT CK_VerificationConfigs_otpBounds
    CHECK (otpLengthDigits BETWEEN 4 AND 8 AND otpTtlSeconds BETWEEN 30 AND 900
       AND otpMaxAttempts BETWEEN 1 AND 10);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_StepUpRules_actionKey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[StepUpRules]'))
  ALTER TABLE [{{SCHEMA}}].[StepUpRules] WITH CHECK ADD CONSTRAINT CK_StepUpRules_actionKey
    CHECK (actionKey IN ('ViewBillBalance','LinkUtilityAccount','InitiatePayment','ChangeRegisteredMobile'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_StepUpRules_requiredAssurance'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[StepUpRules]'))
  ALTER TABLE [{{SCHEMA}}].[StepUpRules] WITH CHECK ADD CONSTRAINT CK_StepUpRules_requiredAssurance
    CHECK (requiredAssurance IN ('Anonymous','Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

-- TR_StepUpRules_paymentFloor (§4.11, FR-PAY-06). InitiatePayment may not be relaxed
-- below a second factor. A configuration screen must not be able to authorise an
-- unverified payment, which is the same rule CK_Transactions_verifiedOnly enforces at the
-- other end of the journey.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_StepUpRules_paymentFloor]
ON [{{SCHEMA}}].[StepUpRules] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted i
             WHERE i.actionKey = ''InitiatePayment''
               AND (i.isEnabled = 0
                    OR i.requiredAssurance NOT IN (''VerifiedPlusOtp'',''VerifiedPlusDocument'')))
    THROW 51160, ''InitiatePayment requires assurance level L2 and cannot be disabled (FR-PAY-06, B11 tab 2).'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IdentityStitchingConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[IdentityStitchingConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[IdentityStitchingConfigs] WITH CHECK ADD CONSTRAINT CK_IdentityStitchingConfigs_singleton
    CHECK (singletonKey = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IdentityStitchingConfigs_stitchingKey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[IdentityStitchingConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[IdentityStitchingConfigs] WITH CHECK ADD CONSTRAINT CK_IdentityStitchingConfigs_stitchingKey
    CHECK (stitchingKey IN ('VerifiedEmiratesIdHash','MobileNumber','NeverStitch')
       AND conversationMemoryScope IN ('PerVerifiedIdentity','PerChannelSession','NoMemory'));

-- CK_IdentityStitchingConfigs_neverStitchCoherent (§4.11). "Stitch on, key = never" is a
-- contradiction the screen cannot express, so neither can the table.
-- NOTE: `memoryRetentionDays` is deliberately absent (RISK-022 resolved, §10.5).
-- PrivacyConfigs.transcriptRetention is the single retention authority. Do not add a
-- retention column here; two clocks over one body of data made B14's 7-year option
-- unreachable.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IdentityStitchingConfigs_neverStitchCoherent'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[IdentityStitchingConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[IdentityStitchingConfigs] WITH CHECK ADD CONSTRAINT CK_IdentityStitchingConfigs_neverStitchCoherent
    CHECK (CAST(CASE WHEN stitchingKey = 'NeverStitch' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN stitchAcrossChannels = 0 THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CitizenIdentities_assuranceLevel'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CitizenIdentities]'))
  ALTER TABLE [{{SCHEMA}}].[CitizenIdentities] WITH CHECK ADD CONSTRAINT CK_CitizenIdentities_assuranceLevel
    CHECK (assuranceLevel IN ('Anonymous','Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

-- CK_CitizenIdentities_verifiedHasEvidence (§4.11). A verified identity with no provider
-- and no timestamp is an unevidenced claim.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CitizenIdentities_verifiedHasEvidence'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CitizenIdentities]'))
  ALTER TABLE [{{SCHEMA}}].[CitizenIdentities] WITH CHECK ADD CONSTRAINT CK_CitizenIdentities_verifiedHasEvidence
    CHECK (assuranceLevel = 'Anonymous'
        OR (verifiedByProviderKey IS NOT NULL AND verifiedAt IS NOT NULL)
        OR erasedAt IS NOT NULL);

-- CK_CitizenIdentities_noPlaintextId (§4.11). Only hashes and masks are ever stored; a
-- 64-character hex digest is the only permitted shape.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CitizenIdentities_noPlaintextId'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[CitizenIdentities]'))
  ALTER TABLE [{{SCHEMA}}].[CitizenIdentities] WITH CHECK ADD CONSTRAINT CK_CitizenIdentities_noPlaintextId
    CHECK ((emiratesIdHash IS NULL OR (LEN(emiratesIdHash) = 64 AND emiratesIdHash NOT LIKE '%[^0-9a-fA-F]%'))
       AND (mobileHash     IS NULL OR (LEN(mobileHash)     = 64 AND mobileHash     NOT LIKE '%[^0-9a-fA-F]%')));

-- UQ_CitizenIdentities_emiratesIdHash (§4.11) — FILTERED. One identity per verified
-- Emirates ID; the erasure tombstone releases the value.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CitizenIdentities_emiratesIdHash'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[CitizenIdentities]'))
  CREATE UNIQUE INDEX UQ_CitizenIdentities_emiratesIdHash ON [{{SCHEMA}}].[CitizenIdentities](emiratesIdHash)
    WHERE emiratesIdHash IS NOT NULL AND erasedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CitizenIdentities_mobileHash'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[CitizenIdentities]'))
  CREATE INDEX IX_CitizenIdentities_mobileHash ON [{{SCHEMA}}].[CitizenIdentities](mobileHash)
    WHERE mobileHash IS NOT NULL;

-- CK_IdentityLinks_verifiedOnly (§4.11) — B11 tab 5's rule made structural: "Stitching
-- only ever joins verified sessions. An anonymous web chat is never merged into a verified
-- WhatsApp identity." The level is recorded AT THE MOMENT OF LINKING rather than read from
-- the identity, because an identity's assurance can be re-established later and that later
-- verification must not retroactively legitimise a link that was anonymous when made.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IdentityLinks_verifiedOnly'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[IdentityLinks]'))
  ALTER TABLE [{{SCHEMA}}].[IdentityLinks] WITH CHECK ADD CONSTRAINT CK_IdentityLinks_verifiedOnly
    CHECK (assuranceLevelAtLink IN ('Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_IdentityLinks_channelKey_channelSubjectHash'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[IdentityLinks]'))
  CREATE UNIQUE INDEX UQ_IdentityLinks_channelKey_channelSubjectHash
    ON [{{SCHEMA}}].[IdentityLinks](channelKey, channelSubjectHash) WHERE unlinkedAt IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VerificationAttempts_result'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VerificationAttempts]'))
  ALTER TABLE [{{SCHEMA}}].[VerificationAttempts] WITH CHECK ADD CONSTRAINT CK_VerificationAttempts_result
    CHECK (result IN ('Success','Failed','Expired','Cancelled','RateLimited'));

-- CK_LinkedServiceAccounts_verifiedPaired (§4.11). "Ownership proven" and "when it was
-- proven" are one fact; splitting them lets a claim look verified with no evidence.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LinkedServiceAccounts_verifiedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[LinkedServiceAccounts]'))
  ALTER TABLE [{{SCHEMA}}].[LinkedServiceAccounts] WITH CHECK ADD CONSTRAINT CK_LinkedServiceAccounts_verifiedPaired
    CHECK (CAST(CASE WHEN ownershipVerified = 0 THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN ownershipVerifiedAt IS NULL THEN 1 ELSE 0 END AS bit));

-- CK_LinkedServiceAccounts_maskedNotFull (§4.11). The masked column must actually be
-- masked; A2 step 3 shows the citizen a masked account number, never the full one.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LinkedServiceAccounts_maskedNotFull'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[LinkedServiceAccounts]'))
  ALTER TABLE [{{SCHEMA}}].[LinkedServiceAccounts] WITH CHECK ADD CONSTRAINT CK_LinkedServiceAccounts_maskedNotFull
    CHECK (accountNumberMasked LIKE '%[*x]%');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_LinkedServiceAccounts_identity_provider_hash'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[LinkedServiceAccounts]'))
  CREATE UNIQUE INDEX UQ_LinkedServiceAccounts_identity_provider_hash
    ON [{{SCHEMA}}].[LinkedServiceAccounts](citizenIdentityId, providerKey, accountNumberHash)
    WHERE unlinkedAt IS NULL;

-- -------------------------------------------------------------------------------------
-- 2.12 payments — gateways, transactions, refunds (§4.12, B11 tabs 3-4, §10.1)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PaymentGateways_mode'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PaymentGateways]'))
  ALTER TABLE [{{SCHEMA}}].[PaymentGateways] WITH CHECK ADD CONSTRAINT CK_PaymentGateways_mode
    CHECK (mode IN ('Live','Sandbox'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PaymentGateways_methodsJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PaymentGateways]'))
  ALTER TABLE [{{SCHEMA}}].[PaymentGateways] WITH CHECK ADD CONSTRAINT CK_PaymentGateways_methodsJson_isJson
    CHECK (ISJSON(methodsJson) = 1);

-- CK_PaymentGateways_liveNeedsRefundPolicy (§4.12). A live gateway that cannot process a
-- refund leaves B11 tab 4's Approve refund with nowhere to go.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PaymentGateways_liveNeedsRefundPolicy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PaymentGateways]'))
  ALTER TABLE [{{SCHEMA}}].[PaymentGateways] WITH CHECK ADD CONSTRAINT CK_PaymentGateways_liveNeedsRefundPolicy
    CHECK (mode <> 'Live' OR isEnabled = 0 OR supportsRefunds = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ReceiptConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ReceiptConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[ReceiptConfigs] WITH CHECK ADD CONSTRAINT CK_ReceiptConfigs_singleton
    CHECK (singletonKey = 1);

-- Transactions.retentionExpiresAt — COMPUTED PERSISTED (§10.1 mechanism 2). Statutory
-- 7 years from initiation. It is NOT WRITABLE, so it cannot be shortened by an update —
-- which is the whole point: a configurable column could be misconfigured, and a computed
-- one cannot.
IF COL_LENGTH('[{{SCHEMA}}].[Transactions]', 'retentionExpiresAt') IS NULL
  ALTER TABLE [{{SCHEMA}}].[Transactions]
    ADD retentionExpiresAt AS (DATEADD(YEAR, 7, initiatedAt)) PERSISTED;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Transactions_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Transactions]'))
  ALTER TABLE [{{SCHEMA}}].[Transactions] WITH CHECK ADD CONSTRAINT CK_Transactions_status
    CHECK (status IN ('Initiated','Pending','Settled','Failed','Declined','RefundRequested','Refunded'));

-- CK_Transactions_verifiedOnly (§4.12) — closes the loop from A2 to B11. A2 step 3's rule
-- calls the `awaiting slot: account_number` line "the visible seam between conversation and
-- transaction — this is the point where Identity & transactions (B11) requires step-up
-- verification before proceeding", and B11 tab 2 adds that the pause happens "before the
-- tool call is made — not after." A transaction created without a completed step-up is
-- therefore not merely a policy violation: it is A ROW THAT CANNOT EXIST.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Transactions_verifiedOnly'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Transactions]'))
  ALTER TABLE [{{SCHEMA}}].[Transactions] WITH CHECK ADD CONSTRAINT CK_Transactions_verifiedOnly
    CHECK (assuranceLevelAtPayment <> 'Anonymous'
       AND assuranceLevelAtPayment IN ('Verified','VerifiedPlusOtp','VerifiedPlusDocument'));

-- CK_Transactions_amountPositive (§4.12). Minor units, exact integers: AED 412.00 is
-- 41200 fils, because a rounding difference in a government payment record is a
-- reconciliation incident.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Transactions_amountPositive'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Transactions]'))
  ALTER TABLE [{{SCHEMA}}].[Transactions] WITH CHECK ADD CONSTRAINT CK_Transactions_amountPositive
    CHECK (amountMinor > 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Transactions_currency'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Transactions]'))
  ALTER TABLE [{{SCHEMA}}].[Transactions] WITH CHECK ADD CONSTRAINT CK_Transactions_currency
    CHECK (currency = UPPER(currency) AND currency NOT LIKE '%[^A-Z]%');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Transactions_settledPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Transactions]'))
  ALTER TABLE [{{SCHEMA}}].[Transactions] WITH CHECK ADD CONSTRAINT CK_Transactions_settledPaired
    CHECK (CAST(CASE WHEN status IN ('Settled','RefundRequested','Refunded') THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN settledAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Transactions_failurePaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Transactions]'))
  ALTER TABLE [{{SCHEMA}}].[Transactions] WITH CHECK ADD CONSTRAINT CK_Transactions_failurePaired
    CHECK (CAST(CASE WHEN status IN ('Failed','Declined') THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN failureCode IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- TR_Transactions_blockDelete (§10.1 mechanism 3). Rejects any delete inside the statutory
-- window, WHATEVER THE CALLER'S ROLE. This is what makes B14 tab 4's carve-out —
-- "transaction records follow the statutory 7-year rule regardless of this setting" —
-- structural rather than a code branch. The retention sweep therefore purges
-- asymmetrically: turns, traces and citations go; the transaction stays with
-- conversationId nulled, and RetentionSweepRuns.transactionsSkipped records the count.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_Transactions_blockDelete]
ON [{{SCHEMA}}].[Transactions] INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted WHERE retentionExpiresAt > SYSUTCDATETIME())
    THROW 51002, ''Transactions are retained for 7 years (statutory). See data-model.md §10.1 and B14 tab 4.'', 1;
  DELETE t FROM [{{SCHEMA}}].[Transactions] t JOIN deleted d ON d.id = t.id;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RefundRequests_requestedByKind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RefundRequests]'))
  ALTER TABLE [{{SCHEMA}}].[RefundRequests] WITH CHECK ADD CONSTRAINT CK_RefundRequests_requestedByKind
    CHECK (requestedByKind IN ('Citizen','LiveAgent','BackOffice')
       AND (requestedByKind = 'Citizen' OR requestedByStaffUserId IS NOT NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RefundRequests_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RefundRequests]'))
  ALTER TABLE [{{SCHEMA}}].[RefundRequests] WITH CHECK ADD CONSTRAINT CK_RefundRequests_status
    CHECK (status IN ('Pending','Approved','Declined'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RefundRequests_decidedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RefundRequests]'))
  ALTER TABLE [{{SCHEMA}}].[RefundRequests] WITH CHECK ADD CONSTRAINT CK_RefundRequests_decidedPaired
    CHECK (CAST(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN decidedByStaffUserId IS NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RefundRequests_amountPositive'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RefundRequests]'))
  ALTER TABLE [{{SCHEMA}}].[RefundRequests] WITH CHECK ADD CONSTRAINT CK_RefundRequests_amountPositive
    CHECK (amountMinor > 0);

-- UQ_RefundRequests_pendingPerTransaction (§4.12) — FILTERED. One pending refund per
-- transaction, so B11 tab 4's Approve/Decline is never ambiguous about which request it
-- decided.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RefundRequests_pendingPerTransaction'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[RefundRequests]'))
  CREATE UNIQUE INDEX UQ_RefundRequests_pendingPerTransaction
    ON [{{SCHEMA}}].[RefundRequests](transactionId) WHERE status = 'Pending';

-- TR_RefundRequests_amountWithinTransaction (§4.12). The refund cannot exceed the settled
-- amount less prior approved refunds — over-refunding a government payment is a financial
-- incident, not a validation message.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_RefundRequests_amountWithinTransaction]
ON [{{SCHEMA}}].[RefundRequests] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [{{SCHEMA}}].[Transactions] t ON t.id = i.transactionId
    CROSS APPLY (
      SELECT ISNULL(SUM(r.amountMinor), 0) AS priorRefunded
      FROM [{{SCHEMA}}].[RefundRequests] r
      WHERE r.transactionId = i.transactionId AND r.status = ''Approved'' AND r.id <> i.id
    ) p
    WHERE i.amountMinor + p.priorRefunded > t.amountMinor)
    THROW 51170, ''A refund cannot exceed the settled transaction amount less prior refunds (B11 tab 4).'', 1;
END');

-- CK_PaymentEvents_signatureVerified (§4.12). An unverified webhook is rejected at the
-- adapter and NEVER BECOMES A ROW — a gateway ledger that can hold unauthenticated events
-- is not evidence of anything.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PaymentEvents_signatureVerified'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PaymentEvents]'))
  ALTER TABLE [{{SCHEMA}}].[PaymentEvents] WITH CHECK ADD CONSTRAINT CK_PaymentEvents_signatureVerified
    CHECK (signatureVerified = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PaymentEvents_payloadRedactedJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PaymentEvents]'))
  ALTER TABLE [{{SCHEMA}}].[PaymentEvents] WITH CHECK ADD CONSTRAINT CK_PaymentEvents_payloadRedactedJson_isJson
    CHECK (ISJSON(payloadRedactedJson) = 1);
GO

-- -------------------------------------------------------------------------------------
-- 2.13 governance — policies, promotion, audit, privacy, ops (§4.13, B12, B14, §10)
-- -------------------------------------------------------------------------------------

-- PolicySettings_policyKey_fkey / PolicyOverrides_policyKey_fkey (§3.4, §4.13, ADR-0011).
-- Two of the five relationships that cross the platform/tenant boundary: both foreign-key
-- into platform.OverridablePolicies, which holds a row ONLY for unlocked policies, so a
-- tenant toggle or per-agent override of a locked platform-floor policy fails at the
-- database — there is no row to point at (schema.prisma's OverridablePolicy doc comment).
-- Before ADR-0011 these were Prisma-managed `@relation`s, emitted once by Prisma Migrate
-- into tenant_template's migration history and replayed per tenant by the provisioning
-- orchestrator. `prisma/tenant/schema.prisma` no longer declares them — Prisma cannot
-- express a `@relation` across two separately generated clients — so they are
-- hand-maintained here from this point on, under the SAME names Prisma originally
-- generated (so these checks are no-ops against every already-provisioned tenant, whose
-- schema already carries both constraints from the historical migration replay).
--
-- Scoped by parent_object_id, not name alone: a constraint name is unique per SCHEMA, not
-- per database, so `sewa` already having these constraints must not make the checks for
-- `customs` false positives and skip creating its own copies.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE name = 'PolicySettings_policyKey_fkey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PolicySettings]'))
  ALTER TABLE [{{SCHEMA}}].[PolicySettings] WITH CHECK ADD CONSTRAINT PolicySettings_policyKey_fkey
    FOREIGN KEY ([policyKey]) REFERENCES [platform].[OverridablePolicies]([policyKey]) ON DELETE CASCADE ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE name = 'PolicyOverrides_policyKey_fkey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PolicyOverrides]'))
  ALTER TABLE [{{SCHEMA}}].[PolicyOverrides] WITH CHECK ADD CONSTRAINT PolicyOverrides_policyKey_fkey
    FOREIGN KEY ([policyKey]) REFERENCES [platform].[OverridablePolicies]([policyKey]) ON DELETE CASCADE ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PolicySettings_valueJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PolicySettings]'))
  ALTER TABLE [{{SCHEMA}}].[PolicySettings] WITH CHECK ADD CONSTRAINT CK_PolicySettings_valueJson_isJson
    CHECK (valueJson IS NULL OR ISJSON(valueJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PolicyOverrides_mode'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PolicyOverrides]'))
  ALTER TABLE [{{SCHEMA}}].[PolicyOverrides] WITH CHECK ADD CONSTRAINT CK_PolicyOverrides_mode
    CHECK (mode IN ('Value','Disabled'));

-- CK_PolicyOverrides_reasonSubstantive (§4.13, B12 tab 2). An override with a blank or
-- one-word justification is the audit failure B12 exists to prevent, so the minimum is a
-- constraint rather than a placeholder.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PolicyOverrides_reasonSubstantive'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PolicyOverrides]'))
  ALTER TABLE [{{SCHEMA}}].[PolicyOverrides] WITH CHECK ADD CONSTRAINT CK_PolicyOverrides_reasonSubstantive
    CHECK (LEN(LTRIM(RTRIM(reason))) >= 10);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PolicyOverrides_valuePaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PolicyOverrides]'))
  ALTER TABLE [{{SCHEMA}}].[PolicyOverrides] WITH CHECK ADD CONSTRAINT CK_PolicyOverrides_valuePaired
    CHECK (CAST(CASE WHEN mode = 'Value' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN valueJson IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PolicyOverrides_removedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PolicyOverrides]'))
  ALTER TABLE [{{SCHEMA}}].[PolicyOverrides] WITH CHECK ADD CONSTRAINT CK_PolicyOverrides_removedPaired
    CHECK (CAST(CASE WHEN removedAt IS NULL THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN removedByStaffUserId IS NULL THEN 1 ELSE 0 END AS bit));

-- UQ_PolicyOverrides_active (§4.13) — FILTERED. One live override per (agent, policy);
-- two would make COALESCE(override, tenantSetting, platformDefault) non-deterministic.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_PolicyOverrides_active'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[PolicyOverrides]'))
  CREATE UNIQUE INDEX UQ_PolicyOverrides_active ON [{{SCHEMA}}].[PolicyOverrides](agentId, policyKey)
    WHERE removedAt IS NULL;

-- TR_PolicyOverrides_respectFloor (§4.13, B12 tab 1). An override may not be WEAKER than
-- platform.Policies.floorValueJson. The locked/unlocked half is already structural via
-- FK_PolicyOverrides_OverridablePolicies (§3.4); this trigger covers the second half — an
-- unlocked policy that still has a floor, e.g. a refusal threshold that may be raised but
-- never lowered below the platform minimum.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_PolicyOverrides_respectFloor]
ON [{{SCHEMA}}].[PolicyOverrides] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [platform].[Policies] p ON p.policyKey = i.policyKey
    WHERE i.removedAt IS NULL
      AND p.floorValueJson IS NOT NULL
      AND (   (p.kind = ''Threshold'' AND i.mode = ''Value''
               AND TRY_CONVERT(decimal(9,4), JSON_VALUE(i.valueJson, ''$.value''))
                 < TRY_CONVERT(decimal(9,4), JSON_VALUE(p.floorValueJson, ''$.value'')))
           OR (p.kind = ''Boolean'' AND i.mode = ''Disabled''
               AND JSON_VALUE(p.floorValueJson, ''$.value'') = ''true'')))
    THROW 51180, ''A per-agent override may not be weaker than the platform floor (B12 tab 1).'', 1;
END');

-- VersionDeployments_environmentKey_fkey (§4.13, ADR-0011). One of the five relationships
-- that cross the platform/tenant boundary: the promotion chain is a property of the
-- deployment topology, identical for every tenant, so a tenant inventing a fourth
-- environment would break the symmetry with the Kubernetes namespaces of architecture §12
-- (schema.prisma's VersionDeployment doc comment). Before ADR-0011 this was a
-- Prisma-managed `@relation`, emitted once by Prisma Migrate into tenant_template's
-- migration history and replayed per tenant by the provisioning orchestrator.
-- `prisma/tenant/schema.prisma` no longer declares it — Prisma cannot express a `@relation`
-- across two separately generated clients — so it is hand-maintained here from this point
-- on, under the SAME name Prisma originally generated (so this check is a no-op against
-- every already-provisioned tenant, whose schema already carries the constraint from the
-- historical migration replay).
--
-- Scoped by parent_object_id, not name alone: a constraint name is unique per SCHEMA, not
-- per database, so `sewa` already having this constraint must not make the check for
-- `customs` a false positive and skip creating its own copy.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE name = 'VersionDeployments_environmentKey_fkey'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VersionDeployments]'))
  ALTER TABLE [{{SCHEMA}}].[VersionDeployments] WITH CHECK ADD CONSTRAINT VersionDeployments_environmentKey_fkey
    FOREIGN KEY ([environmentKey]) REFERENCES [platform].[Environments]([key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VersionDeployments_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VersionDeployments]'))
  ALTER TABLE [{{SCHEMA}}].[VersionDeployments] WITH CHECK ADD CONSTRAINT CK_VersionDeployments_state
    CHECK (state IN ('Deployed','Superseded'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VersionDeployments_supersededPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[VersionDeployments]'))
  ALTER TABLE [{{SCHEMA}}].[VersionDeployments] WITH CHECK ADD CONSTRAINT CK_VersionDeployments_supersededPaired
    CHECK (CAST(CASE WHEN state = 'Superseded' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN supersededAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- UQ_VersionDeployments_live (§4.13) — FILTERED. One version of one agent per
-- environment, which is what makes B14 tab 1's `v1.3 / v2.1 / v2.4` column well-defined.
-- This table is the PROMOTION half of B2's rule; AgentVersions.isCurrent is the ROLLBACK
-- half, and they are separate tables so the two operations cannot be conflated.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_VersionDeployments_live'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[VersionDeployments]'))
  CREATE UNIQUE INDEX UQ_VersionDeployments_live ON [{{SCHEMA}}].[VersionDeployments](agentId, environmentKey)
    WHERE state = 'Deployed';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PromotionRequests_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PromotionRequests]'))
  ALTER TABLE [{{SCHEMA}}].[PromotionRequests] WITH CHECK ADD CONSTRAINT CK_PromotionRequests_status
    CHECK (status IN ('AwaitingApproval','Approved','Rejected','Withdrawn'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PromotionRequests_differentEnvironments'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PromotionRequests]'))
  ALTER TABLE [{{SCHEMA}}].[PromotionRequests] WITH CHECK ADD CONSTRAINT CK_PromotionRequests_differentEnvironments
    CHECK (fromEnvironmentKey <> toEnvironmentKey);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PromotionRequests_decidedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PromotionRequests]'))
  ALTER TABLE [{{SCHEMA}}].[PromotionRequests] WITH CHECK ADD CONSTRAINT CK_PromotionRequests_decidedPaired
    CHECK (CAST(CASE WHEN status = 'AwaitingApproval' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN decidedByStaffUserId IS NULL THEN 1 ELSE 0 END AS bit));

-- UQ_PromotionRequests_pending (§4.13) — FILTERED. One pending promotion per
-- (version, target environment).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_PromotionRequests_pending'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[PromotionRequests]'))
  CREATE UNIQUE INDEX UQ_PromotionRequests_pending
    ON [{{SCHEMA}}].[PromotionRequests](agentVersionId, toEnvironmentKey) WHERE status = 'AwaitingApproval';

-- usp_WriteAuditLogEntry (§4.13). The single writer for the hash-chained, append-only
-- log. It exists because two triggers below and the application layer must all produce a
-- correctly linked chain, and three copies of the linkage logic would be three chances to
-- break it. Not a data-model.md entity — an implementation vehicle for the mechanism
-- data-model.md specifies.
--
-- CHAIN PREIMAGE, and a stated refinement: §4.13 writes the preimage as
-- SHA256(prevHash || sequenceNo || occurredAt || actor || action || target || summary).
-- `sequenceNo` is IDENTITY, so its value is not knowable before the INSERT, and the
-- append-only trigger forbids the UPDATE that would patch it in afterwards. The preimage
-- here therefore covers prevHash plus every business column, and `sequenceNo` supplies the
-- chain ORDER (UQ_AuditLogEntries_sequenceNo guarantees it is gapless and unique) rather
-- than participating in its own row's digest. The tamper-detection property is unchanged:
-- altering any audited value still breaks the link to every later entry.
EXEC(N'
CREATE OR ALTER PROCEDURE [{{SCHEMA}}].[usp_WriteAuditLogEntry]
  @actorStaffUserId         char(26)      = NULL,
  @actorDisplayNameSnapshot nvarchar(200),
  @actorRoleSnapshot        nvarchar(120),
  @action                   varchar(64),
  @targetKind               varchar(48),
  @targetId                 char(26)      = NULL,
  @targetLabelSnapshot      nvarchar(300),
  @summary                  nvarchar(500),
  @correlationId            char(26),
  @environmentKey           varchar(16)   = NULL,
  @beforeJson               nvarchar(max) = NULL,
  @afterJson                nvarchar(max) = NULL,
  @requestId                char(26)      = NULL,
  @ipHash                   char(64)      = NULL,
  @userAgentHash            char(64)      = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @now datetime2(3) = SYSUTCDATETIME();
  DECLARE @prevHash char(64);

  SELECT TOP (1) @prevHash = a.entryHash
  FROM [{{SCHEMA}}].[AuditLogEntries] a WITH (UPDLOCK, HOLDLOCK)
  ORDER BY a.sequenceNo DESC;

  DECLARE @preimage nvarchar(max) =
      ISNULL(@prevHash, N'''')                + N''|'' + CONVERT(nvarchar(30), @now, 126)
    + N''|'' + ISNULL(@actorStaffUserId, N'''') + N''|'' + @actorDisplayNameSnapshot
    + N''|'' + @actorRoleSnapshot              + N''|'' + @action
    + N''|'' + @targetKind                     + N''|'' + ISNULL(@targetId, N'''')
    + N''|'' + @targetLabelSnapshot            + N''|'' + @summary
    + N''|'' + ISNULL(@beforeJson, N'''')       + N''|'' + ISNULL(@afterJson, N'''');

  INSERT INTO [{{SCHEMA}}].[AuditLogEntries]
    (id, occurredAt, actorStaffUserId, actorDisplayNameSnapshot, actorRoleSnapshot, action,
     targetKind, targetId, targetLabelSnapshot, environmentKey, beforeJson, afterJson,
     summary, correlationId, requestId, ipHash, userAgentHash, prevHash, entryHash,
     createdAt, updatedAt)
  VALUES
    (LEFT(REPLACE(CONVERT(char(36), NEWID()), ''-'', ''''), 26), @now, @actorStaffUserId,
     @actorDisplayNameSnapshot, @actorRoleSnapshot, @action, @targetKind, @targetId,
     @targetLabelSnapshot, @environmentKey, @beforeJson, @afterJson, @summary,
     @correlationId, @requestId, @ipHash, @userAgentHash, @prevHash,
     CONVERT(char(64), HASHBYTES(''SHA2_256'', @preimage), 2), @now, @now);
END');

-- TR_AuditLogEntries_blockMutation (§4.13 mechanism 2). B14 tab 2's rule is absolute:
-- "Entries cannot be edited or deleted by any role, including Super Admin." The grant
-- below is mechanism 1; this trigger covers a future db_owner connection, a migration, or
-- a DBA session that the grants do not constrain. Mechanism 3 is the hash chain, which
-- makes a mutation that defeated both DETECTABLE rather than merely forbidden; mechanism 4
-- is the absence of this table from every purge path in §10, erasure included.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_AuditLogEntries_blockMutation]
ON [{{SCHEMA}}].[AuditLogEntries] INSTEAD OF UPDATE, DELETE AS
BEGIN
  THROW 51001, ''AuditLogEntries is append-only. See B14 tab 2 and architecture.md §10.'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AuditLogEntries_beforeJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AuditLogEntries]'))
  ALTER TABLE [{{SCHEMA}}].[AuditLogEntries] WITH CHECK ADD CONSTRAINT CK_AuditLogEntries_beforeJson_isJson
    CHECK (beforeJson IS NULL OR ISJSON(beforeJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AuditLogEntries_afterJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[AuditLogEntries]'))
  ALTER TABLE [{{SCHEMA}}].[AuditLogEntries] WITH CHECK ADD CONSTRAINT CK_AuditLogEntries_afterJson_isJson
    CHECK (afterJson IS NULL OR ISJSON(afterJson) = 1);

-- TR_PromotionRequests_followsChain / _gateMustPass / _separationOfDuties /
-- _auditOnDecision (§4.13, §4.14, B14 tab 1, B13 tab 3, FR-GOV-15). Four rules in one
-- trigger because they all fire on the same transition and must all hold before it
-- commits:
--   · the promotion follows platform.Environments.promotesToKey, so UAT->Production is
--     legal and Development->Production is not;
--   · where PublishGates.blockOnSuiteFailure = 1, a request targeting the live environment
--     carries a passing GateEvaluation for the SAME version — and the trigger reads the
--     singleton itself, one place, rather than each call site remembering to consult it;
--   · the approver is not the requester (separation of duties);
--   · the audit entry is written IN THE SAME TRANSACTION as the decision, because B14
--     tab 1 says either action "writes an entry to the audit log in real time" and a
--     trigger cannot be bypassed by a second call site the way a service method can.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_PromotionRequests_decisionRules]
ON [{{SCHEMA}}].[PromotionRequests] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i
    LEFT JOIN [platform].[Environments] e ON e.[key] = i.fromEnvironmentKey
    WHERE ISNULL(e.promotesToKey, N'''') <> i.toEnvironmentKey)
    THROW 51190, ''A promotion must follow the environment chain (B14 tab 1, architecture §12).'', 1;

  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN [platform].[Environments] target ON target.[key] = i.toEnvironmentKey
    CROSS JOIN [{{SCHEMA}}].[PublishGates] g
    WHERE target.isLive = 1 AND g.blockOnSuiteFailure = 1
      AND NOT EXISTS (SELECT 1 FROM [{{SCHEMA}}].[GateEvaluations] ge
                      WHERE ge.id = i.gateEvaluationId
                        AND ge.agentVersionId = i.agentVersionId
                        AND ge.passed = 1))
    THROW 51191, ''Promotion to the live environment requires a passing gate evaluation for this version (B13 tab 3).'', 1;

  IF EXISTS (SELECT 1 FROM inserted i
             WHERE i.decidedByStaffUserId IS NOT NULL
               AND i.decidedByStaffUserId = i.requestedByStaffUserId)
    THROW 51192, ''A requester cannot approve their own promotion (FR-GOV-15).'', 1;

  DECLARE @id char(26), @status varchar(20), @actor char(26), @versionId char(26),
          @fromEnv varchar(16), @toEnv varchar(16);
  DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT i.id, i.status, i.decidedByStaffUserId, i.agentVersionId, i.fromEnvironmentKey, i.toEnvironmentKey
    FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE i.status <> d.status AND i.status IN (''Approved'',''Rejected'');
  OPEN cur; FETCH NEXT FROM cur INTO @id, @status, @actor, @versionId, @fromEnv, @toEnv;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    EXEC [{{SCHEMA}}].[usp_WriteAuditLogEntry]
      @actorStaffUserId = @actor,
      @actorDisplayNameSnapshot = N''(promotion decision)'',
      @actorRoleSnapshot = N''(recorded by trigger)'',
      @action = ''promotion.decided'',
      @targetKind = ''AgentVersion'',
      @targetId = @versionId,
      @targetLabelSnapshot = N''Promotion request'',
      @summary = @status,
      @correlationId = @id,
      @environmentKey = @toEnv;
    FETCH NEXT FROM cur INTO @id, @status, @actor, @versionId, @fromEnv, @toEnv;
  END
  CLOSE cur; DEALLOCATE cur;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PrivacyConfigs_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PrivacyConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[PrivacyConfigs] WITH CHECK ADD CONSTRAINT CK_PrivacyConfigs_singleton
    CHECK (singletonKey = 1);

-- CK_PrivacyConfigs_transcriptRetention (§4.13, §10.5). The SINGLE retention authority
-- over transcripts and derived memory. All four options are reachable, which is exactly
-- what retiring IdentityStitchingConfigs.memoryRetentionDays fixed (RISK-022): with two
-- settings and a stricter-of-two resolution, B14 tab 4's 7-year option was unreachable.
-- There is deliberately NO transaction-retention column anywhere: a setting that does not
-- exist cannot be misconfigured, and no screen can offer it (§10.1 mechanism 1).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PrivacyConfigs_transcriptRetention'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PrivacyConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[PrivacyConfigs] WITH CHECK ADD CONSTRAINT CK_PrivacyConfigs_transcriptRetention
    CHECK (transcriptRetention IN ('Days30','Days90','Year1','Year7'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PrivacyConfigs_dataResidency'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PrivacyConfigs]'))
  ALTER TABLE [{{SCHEMA}}].[PrivacyConfigs] WITH CHECK ADD CONSTRAINT CK_PrivacyConfigs_dataResidency
    CHECK (dataResidency IN ('UaeSharjahDc','UaeDubaiDc','RegionFlexible'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConsentLedgerEntries_purpose'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConsentLedgerEntries]'))
  ALTER TABLE [{{SCHEMA}}].[ConsentLedgerEntries] WITH CHECK ADD CONSTRAINT CK_ConsentLedgerEntries_purpose
    CHECK (purpose IN ('ProactiveMessaging','TranscriptRetention','IdentityStitching'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConsentLedgerEntries_action'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConsentLedgerEntries]'))
  ALTER TABLE [{{SCHEMA}}].[ConsentLedgerEntries] WITH CHECK ADD CONSTRAINT CK_ConsentLedgerEntries_action
    CHECK (action IN ('OptIn','OptOut'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConsentLedgerEntries_identityPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConsentLedgerEntries]'))
  ALTER TABLE [{{SCHEMA}}].[ConsentLedgerEntries] WITH CHECK ADD CONSTRAINT CK_ConsentLedgerEntries_identityPaired
    CHECK (CAST(CASE WHEN subjectKind = 'CitizenIdentity' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN citizenIdentityId IS NOT NULL THEN 1 ELSE 0 END AS bit));

-- TR_ConsentLedgerEntries_project (§10.3). Maintains ConsentStates, the projection that
-- gives B10 tab 4's send-time check ("a recorded opt-in, checked at send time") a single
-- indexed read. The ledger stays append-only — an opt-out is a NEW entry, never an update
-- of the opt-in — because the ledger is the evidence that a send or a purge was lawful and
-- its lifetime must exceed that of the data it authorises.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_ConsentLedgerEntries_project]
ON [{{SCHEMA}}].[ConsentLedgerEntries] AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  MERGE [{{SCHEMA}}].[ConsentStates] AS tgt
  USING (
    SELECT i.subjectHash, i.channelKey, i.purpose, i.action, i.occurredAt, i.id
    FROM inserted i
    WHERE i.id = (SELECT TOP (1) j.id FROM inserted j
                  WHERE j.subjectHash = i.subjectHash AND j.channelKey = i.channelKey
                    AND j.purpose = i.purpose
                  ORDER BY j.occurredAt DESC, j.id DESC)
  ) AS src
    ON  tgt.subjectHash = src.subjectHash
    AND tgt.channelKey  = src.channelKey
    AND tgt.purpose     = src.purpose
  WHEN MATCHED AND src.occurredAt >= tgt.effectiveAt THEN
    UPDATE SET tgt.state = CASE WHEN src.action = ''OptIn'' THEN ''OptedIn'' ELSE ''OptedOut'' END,
               tgt.lastLedgerEntryId = src.id,
               tgt.effectiveAt = src.occurredAt,
               tgt.updatedAt = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (id, subjectHash, channelKey, purpose, state, lastLedgerEntryId, effectiveAt, createdAt, updatedAt)
    VALUES (LEFT(REPLACE(CONVERT(char(36), NEWID()), ''-'', ''''), 26), src.subjectHash, src.channelKey,
            src.purpose, CASE WHEN src.action = ''OptIn'' THEN ''OptedIn'' ELSE ''OptedOut'' END,
            src.id, src.occurredAt, SYSUTCDATETIME(), SYSUTCDATETIME());
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConsentStates_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConsentStates]'))
  ALTER TABLE [{{SCHEMA}}].[ConsentStates] WITH CHECK ADD CONSTRAINT CK_ConsentStates_state
    CHECK (state IN ('OptedIn','OptedOut'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ErasureRequests_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ErasureRequests]'))
  ALTER TABLE [{{SCHEMA}}].[ErasureRequests] WITH CHECK ADD CONSTRAINT CK_ErasureRequests_status
    CHECK (status IN ('Received','InProgress','Completed','Rejected'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ErasureRequests_rejectedHasReason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ErasureRequests]'))
  ALTER TABLE [{{SCHEMA}}].[ErasureRequests] WITH CHECK ADD CONSTRAINT CK_ErasureRequests_rejectedHasReason
    CHECK (status <> 'Rejected' OR rejectionReason IS NOT NULL);

-- UQ_ErasureRequests_openPerSubject (§4.13) — FILTERED. One open request per subject.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ErasureRequests_openPerSubject'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[ErasureRequests]'))
  CREATE UNIQUE INDEX UQ_ErasureRequests_openPerSubject ON [{{SCHEMA}}].[ErasureRequests](subjectHash)
    WHERE status IN ('Received','InProgress');

-- TR_ErasureRequests_completionRequiresAllStores (§10.4). How completeness is proven —
-- NOT by the absence of an error. A request cannot reach Completed until all four store
-- tasks are Completed with verifiedAt set, and CK_ErasureTasks_completedIsVerified means a
-- task is Completed only if its verification query returned zero. A missed store therefore
-- leaves the request InProgress: visible, alertable, and impossible to mistake for done.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_ErasureRequests_completionRequiresAllStores]
ON [{{SCHEMA}}].[ErasureRequests] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    WHERE i.status = ''Completed''
      AND (SELECT COUNT(*) FROM [{{SCHEMA}}].[ErasureTasks] t
           WHERE t.erasureRequestId = i.id
             AND t.state = ''Completed'' AND t.verifiedAt IS NOT NULL) < 4)
    THROW 51003, ''An erasure request cannot complete until all four store tasks are verified.'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ErasureRequests_verificationEvidenceJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ErasureRequests]'))
  ALTER TABLE [{{SCHEMA}}].[ErasureRequests] WITH CHECK ADD CONSTRAINT CK_ErasureRequests_verificationEvidenceJson_isJson
    CHECK (verificationEvidenceJson IS NULL OR ISJSON(verificationEvidenceJson) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ErasureTasks_store'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ErasureTasks]'))
  ALTER TABLE [{{SCHEMA}}].[ErasureTasks] WITH CHECK ADD CONSTRAINT CK_ErasureTasks_store
    CHECK (store IN ('SqlServer','Neo4j','Qdrant','Redis'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ErasureTasks_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ErasureTasks]'))
  ALTER TABLE [{{SCHEMA}}].[ErasureTasks] WITH CHECK ADD CONSTRAINT CK_ErasureTasks_state
    CHECK (state IN ('Pending','Running','Completed','Failed'));

-- CK_ErasureTasks_completedIsVerified (§10.4). A store where nothing needed deleting is
-- still recorded Completed with affectedCount = 0, because "a store that was not checked
-- is indistinguishable from a store that was found clean."
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ErasureTasks_completedIsVerified'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ErasureTasks]'))
  ALTER TABLE [{{SCHEMA}}].[ErasureTasks] WITH CHECK ADD CONSTRAINT CK_ErasureTasks_completedIsVerified
    CHECK (state <> 'Completed' OR (verifiedAt IS NOT NULL AND affectedCount IS NOT NULL
                                    AND verificationQuery IS NOT NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetentionSweepRuns_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetentionSweepRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RetentionSweepRuns] WITH CHECK ADD CONSTRAINT CK_RetentionSweepRuns_state
    CHECK (state IN ('Running','Completed','Failed'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RetentionSweepRuns_retentionSetting'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RetentionSweepRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RetentionSweepRuns] WITH CHECK ADD CONSTRAINT CK_RetentionSweepRuns_retentionSetting
    CHECK (retentionSetting IN ('Days30','Days90','Year1','Year7'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ServiceHealthSamples_errorRate'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ServiceHealthSamples]'))
  ALTER TABLE [{{SCHEMA}}].[ServiceHealthSamples] WITH CHECK ADD CONSTRAINT CK_ServiceHealthSamples_errorRate
    CHECK (errorRate BETWEEN 0 AND 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ServiceHealthSamples_window'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ServiceHealthSamples]'))
  ALTER TABLE [{{SCHEMA}}].[ServiceHealthSamples] WITH CHECK ADD CONSTRAINT CK_ServiceHealthSamples_window
    CHECK (windowEnd > windowStart);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ServiceHealthSamples_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ServiceHealthSamples]'))
  ALTER TABLE [{{SCHEMA}}].[ServiceHealthSamples] WITH CHECK ADD CONSTRAINT CK_ServiceHealthSamples_status
    CHECK (status IN ('Healthy','Degraded','Down'));

-- -------------------------------------------------------------------------------------
-- 2.14 evaluation — golden sets, regression runs, the publish gate (§4.14, B13)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GoldenSets_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenSets]'))
  ALTER TABLE [{{SCHEMA}}].[GoldenSets] WITH CHECK ADD CONSTRAINT CK_GoldenSets_kind
    CHECK (kind IN ('Journey','LanguageParity','RedTeam','ToolAccuracy'));

-- CK_GoldenSets_parityHasLocale (§4.14). A language-parity set that names no language
-- cannot be scored against B13 tab 3's locale gate.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GoldenSets_parityHasLocale'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenSets]'))
  ALTER TABLE [{{SCHEMA}}].[GoldenSets] WITH CHECK ADD CONSTRAINT CK_GoldenSets_parityHasLocale
    CHECK (kind <> 'LanguageParity' OR localeCode IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GoldenSets_lastScore'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenSets]'))
  ALTER TABLE [{{SCHEMA}}].[GoldenSets] WITH CHECK ADD CONSTRAINT CK_GoldenSets_lastScore
    CHECK (lastScore IS NULL OR lastScore BETWEEN 0 AND 1);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GoldenSets_name'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenSets]'))
  CREATE UNIQUE INDEX UQ_GoldenSets_name ON [{{SCHEMA}}].[GoldenSets](name) WHERE deletedAt IS NULL;

-- CK_GoldenCases_refusalHasNoTools (§4.14). A case that must refuse cannot also expect a
-- tool call; that would be a test asserting two incompatible outcomes.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GoldenCases_refusalHasNoTools'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenCases]'))
  ALTER TABLE [{{SCHEMA}}].[GoldenCases] WITH CHECK ADD CONSTRAINT CK_GoldenCases_refusalHasNoTools
    CHECK (mustRefuse = 0 OR expectedToolCallsJson IS NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GoldenCases_json'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenCases]'))
  ALTER TABLE [{{SCHEMA}}].[GoldenCases] WITH CHECK ADD CONSTRAINT CK_GoldenCases_json
    CHECK ((expectedToolCallsJson IS NULL OR ISJSON(expectedToolCallsJson) = 1)
       AND (expectedCitationSourceIdsJson IS NULL OR ISJSON(expectedCitationSourceIdsJson) = 1));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GoldenCases_goldenSetId_ordinal'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenCases]'))
  CREATE UNIQUE INDEX UQ_GoldenCases_goldenSetId_ordinal
    ON [{{SCHEMA}}].[GoldenCases](goldenSetId, ordinal) WHERE deletedAt IS NULL;

-- UQ_GoldenCases_sourceConversation (§4.14) — FILTERED. This is what makes B1's
-- **Add to golden set** button "disable itself with confirmation text" A DATA FACT rather
-- than a UI memory: a second attempt to add the same conversation to the same set violates
-- the index.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GoldenCases_sourceConversation'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[GoldenCases]'))
  CREATE UNIQUE INDEX UQ_GoldenCases_sourceConversation
    ON [{{SCHEMA}}].[GoldenCases](goldenSetId, sourceConversationId)
    WHERE sourceConversationId IS NOT NULL AND deletedAt IS NULL;

-- TR_GoldenCases_recount (§4.14). B1's Add to golden set must increment a figure B13
-- reads; a stale count would break the cross-module wiring the wireframe demonstrates.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_GoldenCases_recount]
ON [{{SCHEMA}}].[GoldenCases] AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  ;WITH touched AS (SELECT goldenSetId FROM inserted UNION SELECT goldenSetId FROM deleted)
  UPDATE gs
     SET gs.caseCount = (SELECT COUNT(*) FROM [{{SCHEMA}}].[GoldenCases] gc
                         WHERE gc.goldenSetId = gs.id AND gc.deletedAt IS NULL),
         gs.updatedAt = SYSUTCDATETIME()
  FROM [{{SCHEMA}}].[GoldenSets] gs
  JOIN touched t ON t.goldenSetId = gs.id;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RegressionRuns_triggeredBy'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RegressionRuns] WITH CHECK ADD CONSTRAINT CK_RegressionRuns_triggeredBy
    CHECK (triggeredBy IN ('Manual','Publish','Promotion','Schedule'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RegressionRuns_state'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RegressionRuns] WITH CHECK ADD CONSTRAINT CK_RegressionRuns_state
    CHECK (state IN ('Queued','Running','Completed','Failed','Cancelled'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RegressionRuns_scoresInRange'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RegressionRuns] WITH CHECK ADD CONSTRAINT CK_RegressionRuns_scoresInRange
    CHECK ((accuracy     IS NULL OR accuracy     BETWEEN 0 AND 1)
       AND (groundedness IS NULL OR groundedness BETWEEN 0 AND 1)
       AND (toolAccuracy IS NULL OR toolAccuracy BETWEEN 0 AND 1)
       AND (localeParity IS NULL OR localeParity BETWEEN 0 AND 1)
       AND casesPassed <= casesTotal);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RegressionRuns_finishedHasResult'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RegressionRuns] WITH CHECK ADD CONSTRAINT CK_RegressionRuns_finishedHasResult
    CHECK (CAST(CASE WHEN state = 'Completed' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RegressionRuns_result'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionRuns]'))
  ALTER TABLE [{{SCHEMA}}].[RegressionRuns] WITH CHECK ADD CONSTRAINT CK_RegressionRuns_result
    CHECK (result IS NULL OR result IN ('Passed','Failed','Error'));

-- UQ_RegressionRuns_active (§4.14) — FILTERED. One active run per (set, version).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RegressionRuns_active'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionRuns]'))
  CREATE UNIQUE INDEX UQ_RegressionRuns_active
    ON [{{SCHEMA}}].[RegressionRuns](goldenSetId, agentVersionId) WHERE state IN ('Queued','Running');

-- CK_RegressionCaseResults_failedHasReason (§4.14). A failure must name why, or B13 tab 2
-- can report a red row it cannot explain.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RegressionCaseResults_failedHasReason'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionCaseResults]'))
  ALTER TABLE [{{SCHEMA}}].[RegressionCaseResults] WITH CHECK ADD CONSTRAINT CK_RegressionCaseResults_failedHasReason
    CHECK (passed = 1 OR failureReason IS NOT NULL);

-- IX_RegressionCaseResults_regressionRunId (§4.14) — FILTERED. The failure list, which is
-- the only part usually read.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RegressionCaseResults_regressionRunId'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[RegressionCaseResults]'))
  CREATE INDEX IX_RegressionCaseResults_regressionRunId
    ON [{{SCHEMA}}].[RegressionCaseResults](regressionRunId) WHERE passed = 0;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PublishGates_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PublishGates]'))
  ALTER TABLE [{{SCHEMA}}].[PublishGates] WITH CHECK ADD CONSTRAINT CK_PublishGates_singleton
    CHECK (singletonKey = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PublishGates_thresholds'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[PublishGates]'))
  ALTER TABLE [{{SCHEMA}}].[PublishGates] WITH CHECK ADD CONSTRAINT CK_PublishGates_thresholds
    CHECK (minAccuracy BETWEEN 0 AND 1 AND minGroundedness BETWEEN 0 AND 1);

-- CK_GateEvaluations_failedHasReasons (§4.14) — B13's rule as a constraint: "the gate
-- explains WHY something is blocked rather than only that it is — the blocking set, its
-- score and the threshold it missed are all named." A failed evaluation with a null reasons
-- array cannot be inserted, so B13 tab 3's live sentence ("General FAQ Agent v3.0 is
-- currently blocked — Arabic parity at 71% is below the 85% floor") is rendered FROM DATA
-- rather than assembled by string concatenation at the call site. `gateSnapshotJson`
-- freezes the thresholds in force, so switching the gate off later does not rewrite the
-- history of a past block.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GateEvaluations_failedHasReasons'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GateEvaluations]'))
  ALTER TABLE [{{SCHEMA}}].[GateEvaluations] WITH CHECK ADD CONSTRAINT CK_GateEvaluations_failedHasReasons
    CHECK (CAST(CASE WHEN passed = 1 THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN blockingReasonsJson IS NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GateEvaluations_gateSnapshotJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GateEvaluations]'))
  ALTER TABLE [{{SCHEMA}}].[GateEvaluations] WITH CHECK ADD CONSTRAINT CK_GateEvaluations_gateSnapshotJson_isJson
    CHECK (ISJSON(gateSnapshotJson) = 1
       AND (blockingReasonsJson IS NULL OR ISJSON(blockingReasonsJson) = 1));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GateEvaluations_evaluatedForKind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[GateEvaluations]'))
  ALTER TABLE [{{SCHEMA}}].[GateEvaluations] WITH CHECK ADD CONSTRAINT CK_GateEvaluations_evaluatedForKind
    CHECK (evaluatedForKind IN ('Publish','Promotion'));

-- -------------------------------------------------------------------------------------
-- 2.15 analytics — rollups, feedback queues, gaps (§4.15, B1)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ConversationMetricsDaily_coherent'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[ConversationMetricsDaily]'))
  ALTER TABLE [{{SCHEMA}}].[ConversationMetricsDaily] WITH CHECK ADD CONSTRAINT CK_ConversationMetricsDaily_coherent
    CHECK (containedCount + escalatedCount + abandonedCount <= conversationCount
       AND toolErrorCount <= toolCallCount);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IntentMetricsDaily_coherent'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[IntentMetricsDaily]'))
  ALTER TABLE [{{SCHEMA}}].[IntentMetricsDaily] WITH CHECK ADD CONSTRAINT CK_IntentMetricsDaily_coherent
    CHECK (escalatedCount + resolvedCount <= conversationCount);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FeedbackIssues_rootCause'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FeedbackIssues]'))
  ALTER TABLE [{{SCHEMA}}].[FeedbackIssues] WITH CHECK ADD CONSTRAINT CK_FeedbackIssues_rootCause
    CHECK (rootCause IN ('MissingKnowledge','StaleSource','ToolFailure','GuardrailRefusal','Other'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FeedbackIssues_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FeedbackIssues]'))
  ALTER TABLE [{{SCHEMA}}].[FeedbackIssues] WITH CHECK ADD CONSTRAINT CK_FeedbackIssues_status
    CHECK (status IN ('Open','Fixed','Reopened'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FeedbackIssues_fixedPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[FeedbackIssues]'))
  ALTER TABLE [{{SCHEMA}}].[FeedbackIssues] WITH CHECK ADD CONSTRAINT CK_FeedbackIssues_fixedPaired
    CHECK (CAST(CASE WHEN status = 'Fixed' THEN 1 ELSE 0 END AS bit)
         = CAST(CASE WHEN fixedAt IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_UnansweredQuestions_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[UnansweredQuestions]'))
  ALTER TABLE [{{SCHEMA}}].[UnansweredQuestions] WITH CHECK ADD CONSTRAINT CK_UnansweredQuestions_status
    CHECK (status IN ('Open','ResolvedAsKnowledge','ResolvedAsFlow','Dismissed'));

-- CK_UnansweredQuestions_resolutionPaired (§4.15). B1 tab 3's rule says an unanswered
-- question "becomes either a knowledge entry or a new flow"; this makes "resolved,
-- pointing at nothing" unrepresentable, so the improvement loop cannot be closed by
-- clicking without doing.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_UnansweredQuestions_resolutionPaired'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[UnansweredQuestions]'))
  ALTER TABLE [{{SCHEMA}}].[UnansweredQuestions] WITH CHECK ADD CONSTRAINT CK_UnansweredQuestions_resolutionPaired
    CHECK (CAST(CASE WHEN status = 'ResolvedAsKnowledge' THEN 1 ELSE 0 END AS bit)
             = CAST(CASE WHEN resolutionKnowledgeSourceId IS NOT NULL THEN 1 ELSE 0 END AS bit)
       AND CAST(CASE WHEN status = 'ResolvedAsFlow' THEN 1 ELSE 0 END AS bit)
             = CAST(CASE WHEN resolutionFlowId IS NOT NULL THEN 1 ELSE 0 END AS bit)
       AND CAST(CASE WHEN status IN ('ResolvedAsKnowledge','ResolvedAsFlow') THEN 1 ELSE 0 END AS bit)
             = CAST(CASE WHEN resolvedByStaffUserId IS NOT NULL THEN 1 ELSE 0 END AS bit));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TranscriptExports_format'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TranscriptExports]'))
  ALTER TABLE [{{SCHEMA}}].[TranscriptExports] WITH CHECK ADD CONSTRAINT CK_TranscriptExports_format
    CHECK (format IN ('Csv','Json') AND ISJSON(filterJson) = 1);

-- CK_TranscriptExports_redactionApplied (§4.15). An unredacted export of citizen
-- transcripts cannot be represented, which is the storage-side companion to
-- CK_Conversations_piiMaskApplied.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TranscriptExports_redactionApplied'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TranscriptExports]'))
  ALTER TABLE [{{SCHEMA}}].[TranscriptExports] WITH CHECK ADD CONSTRAINT CK_TranscriptExports_redactionApplied
    CHECK (redactionApplied = 1);

-- TR_TranscriptExports_audit (§4.15, B14 tab 2). Writes the audit entry IN THE SAME
-- TRANSACTION as the export record — "Exported 42 conversation transcripts" is exactly the
-- row B14 tab 2 shows, and a data export that is not audited is the failure mode B14 tab 2
-- exists to prevent. Note the entry references a COUNT AND A FILTER, never a subject,
-- which is what keeps the audit log outside every erasure path (§4.13 mechanism 4).
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_TranscriptExports_audit]
ON [{{SCHEMA}}].[TranscriptExports] AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @id char(26), @actor char(26), @rows int, @filter nvarchar(max), @summary nvarchar(500);
  DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT i.id, i.requestedByStaffUserId, i.exportedRowCount, i.filterJson FROM inserted i;
  OPEN cur; FETCH NEXT FROM cur INTO @id, @actor, @rows, @filter;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    -- T-SQL''s EXEC @param = value grammar accepts a literal or a variable as a
    -- named-parameter value, but not a function call: CONCAT(...) inline here is a
    -- syntax error (verified directly against the live server), so the value is
    -- computed into a local first.
    SET @summary = CONCAT(N''Exported '', @rows, N'' conversation transcripts'');
    EXEC [{{SCHEMA}}].[usp_WriteAuditLogEntry]
      @actorStaffUserId = @actor,
      @actorDisplayNameSnapshot = N''(transcript export)'',
      @actorRoleSnapshot = N''(recorded by trigger)'',
      @action = ''transcripts.exported'',
      @targetKind = ''TranscriptExport'',
      @targetId = @id,
      @targetLabelSnapshot = N''Transcript export'',
      @summary = @summary,
      @correlationId = @id,
      @afterJson = @filter;
    FETCH NEXT FROM cur INTO @id, @actor, @rows, @filter;
  END
  CLOSE cur; DEALLOCATE cur;
END');

-- -------------------------------------------------------------------------------------
-- 2.16 theming — tokens, skins, branding, preferences (§4.16, Phase E, ADR-0007)
-- -------------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TokenSets_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TokenSets]'))
  ALTER TABLE [{{SCHEMA}}].[TokenSets] WITH CHECK ADD CONSTRAINT CK_TokenSets_kind
    CHECK (kind IN ('SystemDefault','TenantSkin','UserSkin') AND mode IN ('Light','Dark'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TokenSets_tokensJson_isJson'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TokenSets]'))
  ALTER TABLE [{{SCHEMA}}].[TokenSets] WITH CHECK ADD CONSTRAINT CK_TokenSets_tokensJson_isJson
    CHECK (ISJSON(tokensJson) = 1
       AND (contrastReportJson IS NULL OR ISJSON(contrastReportJson) = 1));

-- CK_TokenSets_noPrimitiveLeak (§4.16, ADR-0007's three-layer contract). A token set may
-- set only SEMANTIC tokens. A primitive in the payload would let one theme reach into
-- layer 1 and break the contract every other theme depends on — the database-side twin of
-- the "no hardcoded design values" gate.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TokenSets_noPrimitiveLeak'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TokenSets]'))
  ALTER TABLE [{{SCHEMA}}].[TokenSets] WITH CHECK ADD CONSTRAINT CK_TokenSets_noPrimitiveLeak
    CHECK (tokensJson NOT LIKE '%--shj3-%');

-- CK_TokenSets_contrastGate (§4.16, ADR-0007). The gate BLOCKS, it does not warn: an
-- unvalidated token set cannot be persisted at all, so a save that skipped the WCAG 2.1 AA
-- check fails at the database rather than shipping an unreadable government service.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TokenSets_contrastGate'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TokenSets]'))
  ALTER TABLE [{{SCHEMA}}].[TokenSets] WITH CHECK ADD CONSTRAINT CK_TokenSets_contrastGate
    CHECK (deletedAt IS NOT NULL OR contrastValidatedAt IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Skins_status'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Skins]'))
  ALTER TABLE [{{SCHEMA}}].[Skins] WITH CHECK ADD CONSTRAINT CK_Skins_status
    CHECK (status IN ('Draft','Published'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Skins_modesDiffer'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[Skins]'))
  ALTER TABLE [{{SCHEMA}}].[Skins] WITH CHECK ADD CONSTRAINT CK_Skins_modesDiffer
    CHECK (lightTokenSetId <> darkTokenSetId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Skins_name'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Skins]'))
  CREATE UNIQUE INDEX UQ_Skins_name ON [{{SCHEMA}}].[Skins](name) WHERE deletedAt IS NULL;

-- UQ_Skins_tenantDefault (§4.16) — FILTERED. One default skin per tenant; the tenant tier
-- of ADR-0007's resolution order must resolve to exactly one thing.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Skins_tenantDefault'
               AND object_id = OBJECT_ID('[{{SCHEMA}}].[Skins]'))
  CREATE UNIQUE INDEX UQ_Skins_tenantDefault ON [{{SCHEMA}}].[Skins](isTenantDefault)
    WHERE isTenantDefault = 1;

-- TR_Skins_blockSystemDelete (§4.16). Keeps ADR-0007's one-click restore-to-default
-- always available.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_Skins_blockSystemDelete]
ON [{{SCHEMA}}].[Skins] AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted d WHERE d.isSystem = 1
             AND NOT EXISTS (SELECT 1 FROM inserted i WHERE i.id = d.id))
    THROW 51020, ''A system skin cannot be deleted (ADR-0007).'', 1;
  IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
             WHERE d.isSystem = 1 AND i.deletedAt IS NOT NULL AND d.deletedAt IS NULL)
    THROW 51020, ''A system skin cannot be soft-deleted (ADR-0007).'', 1;
END');

-- TR_Skins_blockActiveDeletion (theming backend wave, 2026-09-09). The sibling guard to
-- TR_Skins_blockSystemDelete above: that one protects the two shipped skins; this one
-- protects whichever TENANT-AUTHORED skin is currently applied as this tenant's branding.
-- The FK on TenantBrandings.activeSkinId is NoAction, which blocks a hard DELETE — but the
-- real "delete" path this schema uses is the soft-delete UPDATE ... SET deletedAt = ...,
-- which the FK cannot see at all (it is just an UPDATE to a nullable column, not a row
-- deletion). Deliberately NOT mirrored onto UserThemePreferences.skinId: a personal skin
-- being retired must not block cleanup for every other user who never chose it —
-- resolveTheme() instead treats a dangling/soft-deleted personal skinId the same as NULL
-- (defer to the tenant tier), which is an application-level read, not a DB invariant, for
-- exactly that reason.
EXEC(N'
CREATE OR ALTER TRIGGER [{{SCHEMA}}].[TR_Skins_blockActiveDeletion]
ON [{{SCHEMA}}].[Skins] AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted d
             JOIN [{{SCHEMA}}].[TenantBrandings] tb ON tb.activeSkinId = d.id
             WHERE NOT EXISTS (SELECT 1 FROM inserted i WHERE i.id = d.id))
    THROW 51021, ''A skin currently applied as active tenant branding cannot be deleted. Apply a different skin first.'', 1;
  IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
             JOIN [{{SCHEMA}}].[TenantBrandings] tb ON tb.activeSkinId = d.id
             WHERE i.deletedAt IS NOT NULL AND d.deletedAt IS NULL)
    THROW 51021, ''A skin currently applied as active tenant branding cannot be soft-deleted. Apply a different skin first.'', 1;
END');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantBrandings_singleton'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TenantBrandings]'))
  ALTER TABLE [{{SCHEMA}}].[TenantBrandings] WITH CHECK ADD CONSTRAINT CK_TenantBrandings_singleton
    CHECK (singletonKey = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantBrandings_defaultMode'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TenantBrandings]'))
  ALTER TABLE [{{SCHEMA}}].[TenantBrandings] WITH CHECK ADD CONSTRAINT CK_TenantBrandings_defaultMode
    CHECK (defaultMode IN ('Light','Dark','System')
       AND defaultDirection IN ('LTR','RTL')
       AND density IN ('Compact','Comfortable'));

-- CK_TenantBrandings_fontSize (§9.3, theming backend wave 2026-09-09). Base font size is
-- tenant-settable exactly like mode/density/direction above (unlike font FAMILY, which
-- stays admin-only and has no column at all — see the Prisma model comment). A separate,
-- independently-guarded constraint rather than folding into CK_TenantBrandings_defaultMode:
-- that constraint is already applied on every live tenant, and T-SQL has no ALTER of an
-- existing CHECK's definition (only DROP then re-ADD), so a new column earns its own new
-- constraint rather than an unsafe rewrite of one already in force.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantBrandings_fontSize'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TenantBrandings]'))
  ALTER TABLE [{{SCHEMA}}].[TenantBrandings] WITH CHECK ADD CONSTRAINT CK_TenantBrandings_fontSize
    CHECK (fontSize IN ('0.8125rem','0.875rem','0.9375rem','1rem'));

-- CK_TenantBrandings_whiteLabelNeedsLogos (§4.16). White-labelling with no logos would
-- render a tenant's product with no identity at all.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TenantBrandings_whiteLabelNeedsLogos'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[TenantBrandings]'))
  ALTER TABLE [{{SCHEMA}}].[TenantBrandings] WITH CHECK ADD CONSTRAINT CK_TenantBrandings_whiteLabelNeedsLogos
    CHECK (whiteLabelEnabled = 0 OR (logoLightAssetId IS NOT NULL AND logoDarkAssetId IS NOT NULL));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_BrandAssets_kind'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[BrandAssets]'))
  ALTER TABLE [{{SCHEMA}}].[BrandAssets] WITH CHECK ADD CONSTRAINT CK_BrandAssets_kind
    CHECK (kind IN ('LogoLight','LogoDark','Favicon','OgImage'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_BrandAssets_mimeAllowed'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[BrandAssets]'))
  ALTER TABLE [{{SCHEMA}}].[BrandAssets] WITH CHECK ADD CONSTRAINT CK_BrandAssets_mimeAllowed
    CHECK (mimeType IN ('image/svg+xml','image/png','image/webp','image/x-icon'));

-- CK_BrandAssets_byteSize (§4.16). 1 MiB ceiling: brand assets are inlined on the
-- first-paint path.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_BrandAssets_byteSize'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[BrandAssets]'))
  ALTER TABLE [{{SCHEMA}}].[BrandAssets] WITH CHECK ADD CONSTRAINT CK_BrandAssets_byteSize
    CHECK (byteSize > 0 AND byteSize <= 1048576);

-- CK_UserThemePreferences_nullMeansDefer (§4.16). Every preference column is nullable and
-- NULL means "defer to the tenant tier"; copying tenant values into the user row would
-- freeze a user's theme against later tenant re-branding.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_UserThemePreferences_enums'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[UserThemePreferences]'))
  ALTER TABLE [{{SCHEMA}}].[UserThemePreferences] WITH CHECK ADD CONSTRAINT CK_UserThemePreferences_enums
    CHECK ((mode      IS NULL OR mode      IN ('Light','Dark','System'))
       AND (density   IS NULL OR density   IN ('Compact','Comfortable'))
       AND (direction IS NULL OR direction IN ('LTR','RTL')));

-- CK_UserThemePreferences_fontSize (§9.3, theming backend wave 2026-09-09). NULL means
-- "defer to the tenant tier", matching every other column on this table. A separate
-- constraint from CK_UserThemePreferences_enums above for the same DROP/re-ADD reason
-- CK_TenantBrandings_fontSize documents.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_UserThemePreferences_fontSize'
               AND parent_object_id = OBJECT_ID('[{{SCHEMA}}].[UserThemePreferences]'))
  ALTER TABLE [{{SCHEMA}}].[UserThemePreferences] WITH CHECK ADD CONSTRAINT CK_UserThemePreferences_fontSize
    CHECK (fontSize IS NULL OR fontSize IN ('0.8125rem','0.875rem','0.9375rem','1rem'));
GO

-- -------------------------------------------------------------------------------------
-- 2.17 GRANTS on the tenant schema (ADR-0005 rule 5, §3.6)
--
--      THE GRANT IS THE CONTROL, NOT THE CODE. ADR-0005 rule 5: "Write permissions are
--      enforced at the database level, not by convention … Every other write attempt
--      fails at the database. Code review is not the control; the grant is."
--
--      `shj3-ai` gets SELECT on everything and INSERT/UPDATE on exactly three table
--      groups. There is NO DELETE anywhere, and no INSERT/UPDATE on any other table.
--      Widening this requires a new ADR — the narrowness is a design constraint with a
--      visible consequence (§3.6): the pending slot, the escalation ticket, breaker
--      transitions and health samples all reach SQL Server through `shj3-web`'s API or
--      through `shj3-worker`, because none of those tables are AI-writable.
-- -------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_ai')
BEGIN
  GRANT SELECT ON SCHEMA::[{{SCHEMA}}] TO shj3_ai;

  -- Group 1 · conversation turns
  GRANT INSERT, UPDATE ON [{{SCHEMA}}].[ConversationTurns]       TO shj3_ai;

  -- Group 2 · orchestration traces
  GRANT INSERT, UPDATE ON [{{SCHEMA}}].[OrchestrationTraces]     TO shj3_ai;
  GRANT INSERT, UPDATE ON [{{SCHEMA}}].[OrchestrationTraceSteps] TO shj3_ai;
  GRANT INSERT, UPDATE ON [{{SCHEMA}}].[GroundingCitations]      TO shj3_ai;

  -- Group 3 · re-index job status
  GRANT INSERT, UPDATE ON [{{SCHEMA}}].[ReindexJobs]             TO shj3_ai;
  GRANT INSERT, UPDATE ON [{{SCHEMA}}].[IngestionRuns]           TO shj3_ai;

  -- Deny the whole of DELETE, and deny writes to the tables the runtime must never touch
  -- even though it can read them.
  DENY DELETE ON SCHEMA::[{{SCHEMA}}]                            TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[Transactions]             TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[PaymentEvents]            TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[RefundRequests]           TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[AuditLogEntries]          TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[ConsentLedgerEntries]     TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[EscalationTickets]        TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[ConversationSlots]        TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[CircuitBreakerEvents]     TO shj3_ai;
  DENY INSERT, UPDATE ON [{{SCHEMA}}].[ServiceHealthSamples]     TO shj3_ai;
  DENY SELECT ON [{{SCHEMA}}].[CitizenIdentities]                TO shj3_ai;
  DENY SELECT ON [{{SCHEMA}}].[LinkedServiceAccounts]            TO shj3_ai;
END

-- The append-only ledgers are append-only BY GRANT as well as by trigger (§1.4, §4.13).
DENY UPDATE, DELETE ON [{{SCHEMA}}].[AuditLogEntries]            TO PUBLIC;
DENY UPDATE, DELETE ON [{{SCHEMA}}].[ConsentLedgerEntries]       TO PUBLIC;
DENY UPDATE, DELETE ON [{{SCHEMA}}].[AgentVersionHistoryEntries] TO PUBLIC;
DENY UPDATE, DELETE ON [{{SCHEMA}}].[PipelineVersionHistoryEntries] TO PUBLIC;
DENY UPDATE, DELETE ON [{{SCHEMA}}].[CircuitBreakerEvents]       TO PUBLIC;
DENY UPDATE, DELETE ON [{{SCHEMA}}].[VerificationAttempts]       TO PUBLIC;
DENY UPDATE, DELETE ON [{{SCHEMA}}].[PaymentEvents]              TO PUBLIC;

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_web')
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[{{SCHEMA}}]   TO shj3_web;
  GRANT EXECUTE ON [{{SCHEMA}}].[usp_WriteAuditLogEntry]         TO shj3_web;
  -- Append-only, for shj3_web too: B14 tab 2's rule admits no role, Super Admin included.
  DENY UPDATE, DELETE ON [{{SCHEMA}}].[AuditLogEntries]          TO shj3_web;
  DENY UPDATE, DELETE ON [{{SCHEMA}}].[ConsentLedgerEntries]     TO shj3_web;
  DENY UPDATE, DELETE ON [{{SCHEMA}}].[AgentVersionHistoryEntries] TO shj3_web;
  DENY UPDATE, DELETE ON [{{SCHEMA}}].[PipelineVersionHistoryEntries] TO shj3_web;
  DENY UPDATE, DELETE ON [{{SCHEMA}}].[PaymentEvents]            TO shj3_web;
  DENY UPDATE, DELETE ON [{{SCHEMA}}].[VerificationAttempts]     TO shj3_web;
END
GO

/* =====================================================================================
   NOTES — where this file knowingly refines data-model.md, and why
   -------------------------------------------------------------------------------------
   1. `datetime2(3)` (§1.3). Prisma's `@db.DateTime2` accepts no precision argument, so
      the connector emits `datetime2(7)`. Sections 1.0 and 2.0 narrow every non-indexed
      `…At` column. Indexed ones are skipped, because SQL Server refuses ALTER COLUMN on
      an indexed column and dropping/recreating Prisma-owned indexes from this file would
      put index definitions in two places — the drift vector §1.1 exists to eliminate.
      Those columns hold exactly the same values (the data-access layer serialises only
      millisecond-truncated UTC instants) at 2 bytes more per row.

   2. Audit hash preimage (§4.13). §4.13 writes the preimage as
      SHA256(prevHash || sequenceNo || …). `sequenceNo` is IDENTITY, so it is unknown
      before the INSERT, and TR_AuditLogEntries_blockMutation forbids the UPDATE that
      would patch it in. `usp_WriteAuditLogEntry` therefore hashes prevHash plus every
      business column, and `sequenceNo` supplies the chain's gapless ORDER rather than
      participating in its own digest. Tamper detection is unchanged: altering any audited
      value still breaks the link to every later entry.

   3. Ids minted inside triggers. Where a trigger must insert a row (the connector-to-skill
      projection, the model-change re-index job, the ConsentStates projection, the audit
      writes) it mints the id in T-SQL rather than receiving a ULID from the application.
      §1.2's ULID contract governs application writes, which are the overwhelming majority
      and the only ones whose ids are exposed in an API surface; a trigger-minted id is
      still a 26-character Crockford-safe token and is still globally unique, but it is not
      time-sortable. The alternative — moving these five projections into application code —
      would put them behind a call site that a seed script or a second writer could bypass,
      which is precisely what each of them exists to prevent.

   4. `TR_Tenants_syncProfiles` uses dynamic SQL because it writes across schemas, into a
      schema name known only at runtime. The name comes from `platform.Tenants.sqlSchema`,
      which `CK_Tenants_slugPattern` and `CK_Tenants_derivedNames` have already constrained,
      and it is passed through QUOTENAME — ADR-0002 enforcement rule 4.

   5. Neo4j and Qdrant objects are NOT in this file. §6.3's graph constraints and indexes
      and §7's collection parameters are created by the provisioning path against those
      stores; `platform.TenantProvisioningSteps` records that they were, and ADR-0009's
      reconciliation assertions (§9.3 step 6) substitute for the property-existence
      constraints Neo4j Community cannot enforce (standing RISK-024).
   ===================================================================================== */
