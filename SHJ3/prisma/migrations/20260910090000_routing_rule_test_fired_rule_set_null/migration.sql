-- Escalations follow-up (2026-09-10): RoutingRuleTests.firedRoutingRuleId was
-- ON DELETE NO ACTION, so a routing rule that had ever been evaluated by B8's
-- tester could never be deleted afterward -- a real, unhandled FK violation
-- waiting to happen the first time an admin tried to delete a tested rule.
-- Changed to ON DELETE SET NULL: deleting a rule now detaches every test that
-- once fired it instead of blocking the delete outright. firedRuleOrdinal (a
-- plain snapshot int, no FK of its own) is untouched by this change and keeps
-- recording which position fired even once the id itself has been nulled.
--
-- CK_RoutingRuleTests_firedPaired (prisma/sql/001_constraints.sql) is
-- corrected in the same commit: its old, symmetric definition required
-- firedRoutingRuleId IS NULL to hold if and only if fellToDefaultQueue = 1,
-- which this SET NULL would now violate the first time a fired rule (fired
-- meaning fellToDefaultQueue = 0 at test time, a fixed historical fact) is
-- deleted -- the id becomes NULL as an unrelated referential side effect
-- while fellToDefaultQueue correctly stays 0. The corrected constraint keeps
-- the one direction that is still a real invariant (fellToDefaultQueue = 1
-- still requires no rule id was ever recorded against the test) and drops
-- only the direction this new delete behaviour makes untrue.
--
-- Hand-written to match the exact FK this project's own init migration
-- generated (RoutingRuleTests_firedRoutingRuleId_fkey), the same DROP-then-
-- re-ADD shape SQL Server requires for changing an existing FK's delete
-- action -- deliberately not spelled with the real per-tenant template
-- schema's own underscored name in this comment block: this file's own
-- tenant-statement extraction is a lexical substring match with no notion of
-- a SQL comment, so writing that literal identifier in prose here would make
-- this very sentence get executed as SQL. See sql-script.ts for the real
-- mechanism.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [tenant_template].[RoutingRuleTests] DROP CONSTRAINT [RoutingRuleTests_firedRoutingRuleId_fkey];
ALTER TABLE [tenant_template].[RoutingRuleTests] ADD CONSTRAINT [RoutingRuleTests_firedRoutingRuleId_fkey] FOREIGN KEY ([firedRoutingRuleId]) REFERENCES [tenant_template].[RoutingRules]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
