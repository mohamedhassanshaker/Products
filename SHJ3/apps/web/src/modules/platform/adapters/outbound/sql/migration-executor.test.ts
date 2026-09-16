import { describe, expect, it } from "vitest";
import { addedColumns, platformStatements } from "./migration-executor.js";

const THEMING_MIGRATION_SQL = `
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
`;

const MIXED_SCHEMA_SQL = `
BEGIN TRY
BEGIN TRAN;

-- CreateTable
CREATE TABLE [platform].[Widgets] (
    [id] CHAR(26) NOT NULL,
    CONSTRAINT [Widgets_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AlterTable
ALTER TABLE [tenant_template].[Gadgets] ADD [colour] VARCHAR(10);

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW
END CATCH
`;

describe("platformStatements", () => {
  it("is empty for a migration with no platform-schema statements (this wave's own migration)", () => {
    expect(platformStatements(THEMING_MIGRATION_SQL)).toEqual([]);
  });

  it("extracts only the statements naming [platform]., leaving tenant_template ones out", () => {
    const statements = platformStatements(MIXED_SCHEMA_SQL);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("[platform].[Widgets]");
    expect(statements.join("\n")).not.toContain("[tenant_template]");
  });
});

describe("addedColumns", () => {
  it("extracts every added column from a single-column ALTER TABLE ADD", () => {
    const [statement] = THEMING_MIGRATION_SQL.split(";").filter((s) =>
      s.includes("TenantBrandings"),
    );
    expect(addedColumns(`${statement};`)).toEqual([
      { table: "TenantBrandings", column: "fontSize" },
    ]);
  });

  it("extracts every added column from a multi-column ALTER TABLE ADD", () => {
    const statement =
      "ALTER TABLE [tenant_template].[UserThemePreferences] ADD [fontSize] VARCHAR(10),\n[reducedMotion] BIT";
    expect(addedColumns(statement)).toEqual([
      { table: "UserThemePreferences", column: "fontSize" },
      { table: "UserThemePreferences", column: "reducedMotion" },
    ]);
  });

  it("returns nothing for a statement that is not an ALTER TABLE ADD", () => {
    expect(addedColumns("CREATE TABLE [tenant_template].[Foo] ([id] CHAR(26) NOT NULL)")).toEqual(
      [],
    );
    expect(addedColumns("COMMIT TRAN")).toEqual([]);
  });
});
