-- Security policy screen (2026-09-13): a new tenant-wide singleton, SecurityPolicies,
-- letting a tenant's own SuperAdmin/EntityAdmin edit session-timeout and account-lockout
-- policy that was previously only ever hardcoded (`modules/iam/domain/{session,lockout}.ts`).
-- Mirrors RouterConfigs/FlowAssistantConfigs' singleton shape exactly (see either table's
-- own CREATE TABLE for the template) -- a TinyInt singletonKey defaulted to 1, one row.
--
-- Hand-written (a brand-new, self-contained table with no FK into any table this history
-- has not already created) -- deliberately not spelled with the real per-tenant template
-- schema's own underscored name in this comment block: this file's own tenant-statement
-- extraction is a lexical substring match with no notion of a SQL comment, so writing
-- that literal identifier in prose here would make this very sentence get executed as
-- SQL. See sql-script.ts for the real mechanism.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [tenant_template].[SecurityPolicies] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [SecurityPolicies_singletonKey_df] DEFAULT 1,
    [staffSessionIdleMinutes] SMALLINT NOT NULL,
    [staffSessionAbsoluteHours] SMALLINT NOT NULL,
    [lockoutFailuresBeforeLock] TINYINT NOT NULL,
    [lockoutDurationMinutes] SMALLINT NOT NULL,
    [backoffCeilingSeconds] TINYINT NOT NULL,
    [updatedByStaffUserId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SecurityPolicies_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_SecurityPolicies_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
