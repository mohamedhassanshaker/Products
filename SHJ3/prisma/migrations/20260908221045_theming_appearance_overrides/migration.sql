-- Theming backend wave (2026-09-09): the two schema gaps found against
-- design-system.md's Phase E control matrix (docs/data-model.md's theming section).
--
-- TenantBranding.fontSize / UserThemePreference.fontSize / .reducedMotion -- see the
-- doc comments on those Prisma models for the full reasoning. The matching CHECK
-- constraints and the new skin-active-delete-guard trigger live in
-- prisma/sql/001_constraints.sql's tenant section, applied the same way every other
-- tenant constraint is.
--
-- Generated via a pure schema-to-schema `prisma migrate diff` (a pre-edit snapshot
-- against the edited prisma/tenant/schema.prisma), then hand-corrected to qualify
-- both tables against the per-tenant template schema this history is replayed
-- against -- deliberately not spelled with an underscore in this comment block: this
-- file's own tenant-statement extraction is a lexical substring match with no notion
-- of a SQL comment, so writing that literal identifier in prose here would make this
-- very sentence get executed as SQL. See sql-script.ts for the real mechanism.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [tenant_template].[TenantBrandings] ADD [fontSize] VARCHAR(10) NOT NULL CONSTRAINT [TenantBrandings_fontSize_df] DEFAULT '0.875rem';

-- AlterTable
ALTER TABLE [tenant_template].[UserThemePreferences] ADD [fontSize] VARCHAR(10),
[reducedMotion] BIT;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
