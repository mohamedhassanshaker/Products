/* =====================================================================================
   SHJ3 — 003_tenant_drop.sql
   RB-10 reverse step 1 / RB-12 step 6: remove ONE tenant's SQL Server schema.

   THIS FILE DESTROYS DATA. It is reached from two places, both deliberate: the
   compensating rollback of a failed provisioning run, and de-provisioning proper — which
   is also the right-to-be-forgotten path at tenant scope (FR-GOV-22).

   WHY THE ORDER IS WHAT IT IS
   ------------------------------------------------------------------------------------
   `DROP SCHEMA` refuses while the schema contains any object, so the objects go first,
   and they go in dependency order:

     1. Foreign keys — in **both** directions. Outbound FKs (tenant -> platform) die with
        their table, but an *inbound* FK from any other schema would block the drop, and
        that is exactly the residue a half-provisioned tenant can leave behind. Dropping
        constraints before tables is what makes this file work on a schema whose contents
        are unknown, which is the state rollback actually finds.
     2. Views, procedures and functions — they may bind to the tables.
     3. Tables (triggers and indexes go with them).
     4. Sequences, synonyms and user-defined types — SQL Server refuses to drop a schema
        that still owns any of these, and a table type is easy to forget.

   Everything is generated from `sys` rather than named, because the object set is
   whatever the migration history produced and this file must not carry a second,
   drifting copy of it.

   IDEMPOTENCY
   ------------------------------------------------------------------------------------
   Every phase is a set-based generation over the *current* contents, so a schema that is
   already empty generates no statements and an absent schema generates nothing at all.
   That is what lets rollback re-run after failing part-way, per the
   `StoreProvisioner.destroy` contract.

   Names are emitted through `QUOTENAME`, and {{SCHEMA}} is substituted with
   `sqlSchemaFor(<registry-validated slug>)` — never interpolated from input
   (ADR-0002 enforcement rule 4).
   ===================================================================================== */

-- -------------------------------------------------------------------------------------
-- Phase 1 · foreign keys, in both directions.
-- -------------------------------------------------------------------------------------
DECLARE @dropForeignKeys NVARCHAR(MAX) = N'';

SELECT @dropForeignKeys = @dropForeignKeys
     + N'ALTER TABLE ' + QUOTENAME(ps.name) + N'.' + QUOTENAME(pt.name)
     + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';' + NCHAR(10)
FROM sys.foreign_keys fk
JOIN sys.tables   pt ON pt.object_id = fk.parent_object_id
JOIN sys.schemas  ps ON ps.schema_id = pt.schema_id
JOIN sys.tables   rt ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas  rs ON rs.schema_id = rt.schema_id
WHERE ps.name = N'{{SCHEMA}}' OR rs.name = N'{{SCHEMA}}';

IF LEN(@dropForeignKeys) > 0 EXEC sys.sp_executesql @dropForeignKeys;
GO

-- -------------------------------------------------------------------------------------
-- Phase 2 · programmable objects. Views before the tables they select from; functions
-- and procedures before the tables they touch, so a schema-bound module cannot block a
-- table drop.
-- -------------------------------------------------------------------------------------
DECLARE @dropModules NVARCHAR(MAX) = N'';

SELECT @dropModules = @dropModules
     + N'DROP ' + CASE o.type
                    WHEN 'V'  THEN N'VIEW'
                    WHEN 'P'  THEN N'PROCEDURE'
                    WHEN 'TR' THEN N'TRIGGER'
                    ELSE N'FUNCTION'
                  END
     + N' ' + QUOTENAME(s.name) + N'.' + QUOTENAME(o.name) + N';' + NCHAR(10)
FROM sys.objects  o
JOIN sys.schemas  s ON s.schema_id = o.schema_id
WHERE s.name = N'{{SCHEMA}}'
  AND o.type IN ('V', 'P', 'TR', 'FN', 'IF', 'TF', 'AF', 'FS', 'FT')
ORDER BY CASE o.type WHEN 'TR' THEN 0 WHEN 'V' THEN 1 WHEN 'P' THEN 2 ELSE 3 END;

IF LEN(@dropModules) > 0 EXEC sys.sp_executesql @dropModules;
GO

-- -------------------------------------------------------------------------------------
-- Phase 3 · tables. Indexes, statistics and remaining triggers go with them.
-- -------------------------------------------------------------------------------------
DECLARE @dropTables NVARCHAR(MAX) = N'';

SELECT @dropTables = @dropTables
     + N'DROP TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N';' + NCHAR(10)
FROM sys.tables   t
JOIN sys.schemas  s ON s.schema_id = t.schema_id
WHERE s.name = N'{{SCHEMA}}';

IF LEN(@dropTables) > 0 EXEC sys.sp_executesql @dropTables;
GO

-- -------------------------------------------------------------------------------------
-- Phase 4 · the leftovers that block `DROP SCHEMA` quietly: sequences, synonyms and
-- user-defined (including table) types.
-- -------------------------------------------------------------------------------------
DECLARE @dropLeftovers NVARCHAR(MAX) = N'';

SELECT @dropLeftovers = @dropLeftovers
     + N'DROP SEQUENCE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(sq.name) + N';' + NCHAR(10)
FROM sys.sequences sq
JOIN sys.schemas   s ON s.schema_id = sq.schema_id
WHERE s.name = N'{{SCHEMA}}';

SELECT @dropLeftovers = @dropLeftovers
     + N'DROP SYNONYM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(sy.name) + N';' + NCHAR(10)
FROM sys.synonyms sy
JOIN sys.schemas  s ON s.schema_id = sy.schema_id
WHERE s.name = N'{{SCHEMA}}';

SELECT @dropLeftovers = @dropLeftovers
     + N'DROP TYPE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(ty.name) + N';' + NCHAR(10)
FROM sys.types    ty
JOIN sys.schemas  s ON s.schema_id = ty.schema_id
WHERE s.name = N'{{SCHEMA}}' AND ty.is_user_defined = 1;

IF LEN(@dropLeftovers) > 0 EXEC sys.sp_executesql @dropLeftovers;
GO

-- -------------------------------------------------------------------------------------
-- Phase 5 · the schema itself, and only once it is provably empty.
--
-- The emptiness check is not decoration. If a phase above failed silently the schema
-- would still hold objects, and `DROP SCHEMA` would fail with an error naming one
-- arbitrary object — a far worse diagnostic than refusing here. Leaving the schema in
-- place is also the correct outcome: `verify` then reports residue and RB-10 says so.
-- -------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'{{SCHEMA}}')
   AND NOT EXISTS (SELECT 1
                   FROM sys.objects o
                   JOIN sys.schemas s ON s.schema_id = o.schema_id
                   WHERE s.name = N'{{SCHEMA}}')
  EXEC(N'DROP SCHEMA [{{SCHEMA}}]');
GO
