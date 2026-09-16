-- AI settings screen (2026-09-12): a new tenant-wide singleton, FlowAssistantConfigs,
-- letting an Agent Designer (agents:manage) set the Flow Designer AI sidebar's model
-- without an env edit plus a container recreate (`propose_flow_edit.py`'s own doc
-- comment). Mirrors RouterConfigs' singleton shape exactly (see the init migration's own
-- CREATE TABLE for that table) -- a TinyInt singletonKey defaulted to 1, no per-tenant
-- override, one row.
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
CREATE TABLE [tenant_template].[FlowAssistantConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [FlowAssistantConfigs_singletonKey_df] DEFAULT 1,
    [primaryModel] VARCHAR(120) NOT NULL,
    [fallbackModel] VARCHAR(120),
    [updatedByStaffUserId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FlowAssistantConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_FlowAssistantConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
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
