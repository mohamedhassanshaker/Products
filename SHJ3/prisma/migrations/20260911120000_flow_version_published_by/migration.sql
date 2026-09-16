-- Flow Designer Publish feature (2026-09-11): FlowVersions gains
-- publishedByStaffUserId, mirroring AgentVersions.publishedByStaffUserId
-- exactly -- a real, attributed actor for a flow-version publish, which
-- previously had nowhere to be recorded at all (FlowVersions carried only
-- publishedAt). A plain, unconstrained CHAR(26) with no FK, for the identical
-- reason AgentVersions' own column is unconstrained: StaffUser lives in the
-- platform schema, and this project's "no multiSchema" design (ADR-0011)
-- means a cross-schema FK cannot be declared in Prisma at all, only
-- validated at the application layer.
--
-- Hand-written (a single nullable column addition, no diff tooling needed) --
-- deliberately not spelled with the real per-tenant template schema's own
-- underscored name in this comment block: this file's own tenant-statement
-- extraction is a lexical substring match with no notion of a SQL comment,
-- so writing that literal identifier in prose here would make this very
-- sentence get executed as SQL. See sql-script.ts for the real mechanism.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [tenant_template].[FlowVersions] ADD [publishedByStaffUserId] CHAR(26);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
