/**
 * Text assembly for the tenant-provisioning SQL scripts.
 *
 * Everything in this module is a pure string transform, which is the point: the one
 * genuinely dangerous step in SQL provisioning is *deciding what text to send*, and it
 * is separated here so it can be unit-tested exhaustively without a database.
 *
 * ## The injection surface, stated plainly
 *
 * A SQL Server schema name lands in identifier position. There is no parameter binding
 * for an identifier, no `QUOTENAME` that can save a caller who never validated, and no
 * database-level fallback if this module gets it wrong — a crafted slug would execute as
 * DDL under the platform migrator's authority. ADR-0002 enforcement rule 4 answers this
 * by deriving every isolation-unit name from a registry-validated slug, and
 * `assertValidSlugShape` is the choke point that makes it true.
 *
 * So `safeSchemaName` re-asserts the slug even though the caller already holds a
 * `TenantSlug` brand. The brand is a compile-time claim; a runtime re-check is what
 * survives a cast, a JSON round-trip through the registry, or a future caller who builds
 * the value some other way. It costs one regex test per provisioning run.
 *
 * ## Why the scripts are files rather than literals
 *
 * `prisma/sql/*.sql` is owned by Prisma's migration history (ADR-0005), and the
 * `{{SCHEMA}}` token is the convention `001_constraints.sql` already established for its
 * per-tenant section. Reusing it means the provisioner and the N-tenant migration
 * orchestrator substitute identifiers by exactly one mechanism instead of two.
 */

import {
  assertValidSlugShape,
  sqlSchemaFor,
  type TenantSlug,
} from "../../../tenancy/tenant-slug.js";

/**
 * The marker `001_constraints.sql` uses to separate its apply-once platform section from
 * its apply-per-tenant section. Provisioning must run only the second: the two sections
 * name different tables, so a cross-application fails on object resolution.
 */
export const TENANT_SECTION_MARKER = "/* === SECTION BOUNDARY === */";

/** The template schema Prisma Migrate emits per-tenant DDL against (ADR-0005). */
export const TEMPLATE_SCHEMA = "tenant_template";

const SCHEMA_TOKEN = /\{\{SCHEMA\}\}/g;

/**
 * Any remaining `{{TOKEN}}` after substitution. A second token type introduced into the
 * SQL later must fail loudly here rather than reaching SQL Server as literal text, where
 * it would either error obscurely or — worse — succeed inside a string column.
 */
const UNSUBSTITUTED_TOKEN = /\{\{[^}]*\}\}/;

const TEMPLATE_REFERENCE = /\btenant_template\b/;
const TEMPLATE_REFERENCE_ALL = /\btenant_template\b/g;

/** Lines consisting solely of `GO`, sqlcmd's client-side batch separator. */
const BATCH_SEPARATOR = /^[ \t]*GO[ \t]*(?:--.*)?$/gim;

/** A statement terminator at end of line — how Prisma Migrate emits SQL Server DDL. */
const STATEMENT_TERMINATOR = /;[ \t]*(?:\r?\n|$)/;

export class TenantSqlScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantSqlScriptError";
  }
}

/**
 * The tenant's schema name, re-validated at the moment of use.
 *
 * **This is the only function in the SQL adapter permitted to produce a schema
 * identifier.** See the module comment for why the re-assertion is not redundant.
 */
export function safeSchemaName(slug: TenantSlug): string {
  return sqlSchemaFor(assertValidSlugShape(slug));
}

/**
 * The per-tenant half of `001_constraints.sql`.
 *
 * Throws rather than returning the whole file if the marker is missing: silently
 * applying the platform section to a tenant schema would fail mid-run and leave a
 * partially constrained schema, which is harder to diagnose than a refusal.
 */
export function tenantSection(constraintsSql: string): string {
  const index = constraintsSql.indexOf(TENANT_SECTION_MARKER);
  if (index === -1) {
    throw new TenantSqlScriptError(
      `Could not find "${TENANT_SECTION_MARKER}" in the constraints script. ` +
        "Provisioning must apply only the per-tenant section — the platform section names " +
        "different tables and would fail on object resolution.",
    );
  }
  return constraintsSql.slice(index + TENANT_SECTION_MARKER.length);
}

/**
 * The platform half of `001_constraints.sql` — the complement of {@link tenantSection}.
 *
 * Added for `scripts/bootstrap-platform-schema.ts` (Docker Compose's one-shot platform
 * bootstrap): before that script existed, nothing in this codebase ever called this half
 * — confirmed by search — because every existing caller (`SqlStoreProvisioner`,
 * `PrismaMigrationExecutor`) is tenant-scoped by construction and only ever needs
 * {@link tenantSection}. The file's own header comment already describes two sections,
 * "applied ONCE" (platform) and "applied ONCE PER TENANT SCHEMA" (tenant) — this function
 * is what makes the first half reachable at all, not a new convention.
 */
export function platformSection(constraintsSql: string): string {
  const index = constraintsSql.indexOf(TENANT_SECTION_MARKER);
  if (index === -1) {
    throw new TenantSqlScriptError(
      `Could not find "${TENANT_SECTION_MARKER}" in the constraints script. ` +
        "Bootstrap must apply only the platform section — the tenant section names " +
        "{{SCHEMA}}-templated objects and would fail unsubstituted.",
    );
  }
  return constraintsSql.slice(0, index);
}

/** Replace every `{{SCHEMA}}` with the tenant's re-validated schema name. */
export function substituteSchema(sql: string, slug: TenantSlug): string {
  const substituted = sql.replace(SCHEMA_TOKEN, safeSchemaName(slug));

  const leftover = UNSUBSTITUTED_TOKEN.exec(substituted);
  if (leftover) {
    throw new TenantSqlScriptError(
      `Unsubstituted template token "${leftover[0]}" would reach SQL Server as literal text. ` +
        "Every token in a provisioning script must have a substitution rule.",
    );
  }
  return substituted;
}

/**
 * Split a script into the batches `GO` delimits, dropping the ones that carry no SQL.
 *
 * `GO` is a client-side convention, not T-SQL, so it has to be stripped before the text
 * reaches a driver. The batches matter beyond syntax: a `DECLARE`d local's scope ends at
 * its batch boundary, which is how `001_constraints.sql` keeps its generated-DDL passes
 * from colliding.
 */
export function splitBatches(sql: string): readonly string[] {
  return sql
    .split(BATCH_SEPARATOR)
    .map((batch) => batch.trim())
    .filter((batch) => carriesSql(batch));
}

/**
 * The subset of a Prisma migration that belongs to a tenant schema, retargeted at that
 * tenant.
 *
 * ADR-0005's mechanism: Prisma Migrate emits the per-tenant DDL once against
 * `tenant_template`, and the orchestrator replays that same DDL under each validated
 * slug. Replaying it requires separating the tenant statements from the platform ones,
 * because a migration file contains both and the platform half has already run.
 *
 * The separation is lexical — statements are split on an end-of-line `;`, and a statement
 * is a tenant statement if it names `tenant_template`. That is a heuristic, and its one
 * failure mode is worth recording: a statement containing an end-of-line `;` inside a
 * string literal would be split in the wrong place. Prisma's SQL Server output does not
 * produce those, and the alternative — a T-SQL parser in the provisioner — would be a far
 * larger surface than the problem. A malformed split fails at SQL Server on the next
 * `create`, and `destroy` removes the partial schema, so the failure is loud and
 * recoverable rather than silent.
 *
 * Statements naming both schemas (a tenant table's FK into `platform`) are kept: they are
 * part of the tenant's shape and cannot be applied any other way.
 */
export function tenantTemplateStatements(
  migrationSql: string,
  slug: TenantSlug,
): readonly string[] {
  const schema = safeSchemaName(slug);
  return migrationSql
    .split(STATEMENT_TERMINATOR)
    .map((statement) => statement.trim())
    .filter((statement) => carriesSql(statement) && TEMPLATE_REFERENCE.test(statement))
    .map((statement) => statement.replace(TEMPLATE_REFERENCE_ALL, schema));
}

const PLATFORM_OR_TEMPLATE_REFERENCE =
  /\[platform\]\.|\btenant_template\b|CREATE SCHEMA \[platform\]/i;

/**
 * Every `platform`- or `tenant_template`-touching statement of a Prisma migration, in
 * the migration's OWN original order, unsubstituted, run exactly once.
 *
 * `tenant_template` itself (`TEMPLATE_SCHEMA`) is a reserved name (`tenant-slug.ts`'s
 * `RESERVED` set) precisely because it is not a real tenant — so it can never hold a
 * `TenantSlug`, and {@link tenantTemplateStatements} can never be called with it (that
 * function requires one). But `tenant_template` still has to exist as a real schema
 * with real tables: `SqlStoreProvisioner.create()` and `.verify()` both read its table
 * count as the expected shape every tenant schema is compared against, and throw
 * outright if it holds none. `platform` likewise has to exist before any tenant can be
 * provisioned at all. `scripts/bootstrap-platform-schema.ts` is what populates both,
 * once, at environment bootstrap — never per request, never touched by any production
 * request path.
 *
 * ## Why ONE function, not `platformStatements()` (migration-executor.ts) plus a
 * `tenant_template` counterpart run as two separately-ordered passes
 *
 * A real, found-not-assumed bug in exactly that combination, hit while building the
 * bootstrap script this function was added for: `20260908130800_init/migration.sql`
 * contains ADR-0011's five cross-schema foreign keys, e.g. (line 2726) `ALTER TABLE
 * [tenant_template].[RolePermissions] ADD CONSTRAINT ... FOREIGN KEY ([permissionKey])
 * REFERENCES [platform].[Permissions]([key])`. That single statement legitimately
 * belongs to BOTH a `platform`-filtered pass (it names `[platform].`) and a
 * `tenant_template`-filtered pass (it names `tenant_template`) — `migration-
 * executor.ts`'s own doc comment already says as much ("a statement can legitimately
 * mention ... both"). Running "all of platform, then all of tenant_template" (or the
 * reverse) as two independently-complete passes breaks the moment such a statement
 * exists: whichever half runs SECOND succeeds (both referenced tables already exist by
 * then), but the half that runs FIRST fails outright — confirmed directly, not
 * theorised: `applyToPlatform()` run before `tenant_template.RolePermissions` existed
 * failed with SQL Server error 4902, "Cannot find the object". This is not a defect in
 * `platformStatements()` for the use it is actually tested against —
 * `RunTenantMigrations`'s incremental per-tenant migrations, where `platform` and
 * `tenant_template` both already exist and neither pass's ordering matters — it is a
 * genuine gap in using that combination for BOOTSTRAPPING an empty environment, which
 * nothing needed until this script. Flagged here and in tasks/todo.md rather than
 * fixed inside `migration-executor.ts` itself: that function backs an already-tested
 * production path this Docker-packaging pass has no reason to widen the blast radius
 * of (CLAUDE.md's "minimal impact").
 *
 * The fix is to not need two independently-ordered passes at all. Prisma's own
 * generation order already puts every `CREATE TABLE`/`CREATE INDEX` (both schemas)
 * before every `ALTER TABLE ... ADD CONSTRAINT` (both schemas) — confirmed by reading
 * the real file, not assumed — so replaying the file's OWN statement order, filtered
 * only by "does this statement touch either schema at all" rather than split by WHICH
 * schema, is what Prisma's own migration application already guarantees is safe.
 */
export function platformAndTemplateStatements(migrationSql: string): readonly string[] {
  return migrationSql
    .split(STATEMENT_TERMINATOR)
    .map((statement) => statement.trim())
    .filter((statement) => carriesSql(statement) && PLATFORM_OR_TEMPLATE_REFERENCE.test(statement));
}

/**
 * Whether a fragment holds anything a driver should be asked to run.
 *
 * Both provisioning scripts and Prisma migrations are heavily commented — the constraints
 * file ends with a 40-line block comment — and sending a comment-only batch is at best
 * pointless round trips and at worst a driver error.
 */
function carriesSql(fragment: string): boolean {
  return stripComments(fragment).trim().length > 0;
}

/**
 * Remove `--` and `/* … *\/` comments. Used only to decide whether a fragment is empty,
 * never to build text that is executed — so it does not need to handle a comment
 * delimiter appearing inside a string literal, and deliberately does not try.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
