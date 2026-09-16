/* =====================================================================================
   SHJ3 — 000_tenant_schema.sql
   RB-09 step 1a: create ONE tenant's SQL Server schema.

   WHY THIS IS A FILE AND NOT A STRING IN THE PROVISIONER
   ------------------------------------------------------------------------------------
   `CREATE SCHEMA` is the one statement in the whole provisioning path that cannot be
   parameterised: a schema name lands in identifier position, where T-SQL offers no
   binding. Keeping it here rather than in TypeScript means the identifier arrives by
   exactly one route — token substitution performed by `sql-script.ts`, which re-asserts
   the slug against `assertValidSlugShape` immediately before it writes it — and the same
   route the platform migration orchestrator already uses for `001_constraints.sql`
   (ADR-0002 enforcement rule 4).

   {{SCHEMA}} is substituted with `sqlSchemaFor(<registry-validated slug>)`. It is never
   interpolated from input.

   IDEMPOTENCY
   ------------------------------------------------------------------------------------
   `CREATE SCHEMA` is NOT idempotent in T-SQL — there is no `IF NOT EXISTS` form and no
   `CREATE OR ALTER` for a schema — so the existence check is explicit against
   `sys.schemas`. RB-09 is resumable and an operator will re-run it, which the
   `StoreProvisioner.create` contract requires, so a second run must be a no-op rather
   than a collision.

   `CREATE SCHEMA` must also be the first statement in its batch. Wrapping it in `EXEC`
   makes the guard and the statement co-resident in one batch, which is the same
   convention `001_constraints.sql` uses for its triggers and views.

   AUTHORIZATION
   ------------------------------------------------------------------------------------
   RB-09 step 1 creates the schema owned by `shj3_migrator` so that ownership chaining
   cannot let a tenant's schema owner read another's. The principal only exists in a
   deployed environment; locally the schema is created under the connecting principal,
   which is why the branch exists rather than a bare `AUTHORIZATION`.
   ===================================================================================== */

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'{{SCHEMA}}')
BEGIN
  IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shj3_migrator')
    EXEC(N'CREATE SCHEMA [{{SCHEMA}}] AUTHORIZATION shj3_migrator');
  ELSE
    EXEC(N'CREATE SCHEMA [{{SCHEMA}}]');
END
GO
