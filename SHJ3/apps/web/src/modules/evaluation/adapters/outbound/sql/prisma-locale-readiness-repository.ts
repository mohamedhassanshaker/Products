import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { currentTenant } from "../../../../platform/tenancy/tenant-context.js";
import { sqlSchemaFor } from "../../../../platform/tenancy/tenant-slug.js";
import type {
  BoundLocaleReadinessRow,
  LocaleReadinessRepository,
} from "../../../ports/locale-readiness-repository.js";

interface Row {
  readonly localeCode: string;
  /** SQL Server can surface an `int` computed column as either — see
   *  `sql-store-provisioner.ts`'s identical `countScalar` comment on the same connector
   *  behaviour for `COUNT(*)`. */
  readonly translatedPercent: number | bigint;
}

export class PrismaLocaleReadinessRepository implements LocaleReadinessRepository {
  async listForVersion(agentVersionId: string): Promise<readonly BoundLocaleReadinessRow[]> {
    // `LocaleSettings.translatedPercent` is a DB computed, persisted column (§4.10) with no
    // corresponding Prisma model field — read via raw SQL, which has nothing else to
    // select here at all.
    //
    // FIX (found live, 2026-09-10): a bare, unqualified `FROM AgentLocaleBindings` fails
    // against any real tenant schema with SQL Server error 208 ("Invalid object name") —
    // ADR-0011's connection-string `schema=` routing is what makes Prisma's OWN generated
    // SQL (`db.model.findMany()` etc.) resolve to the right tenant schema; it does nothing
    // for a hand-written raw query's bare identifiers, which SQL Server resolves against
    // the login's actual default schema instead (never the calling tenant's). This was
    // never exercised against a real, provisioned tenant schema before (no other tenant-
    // scoped raw query exists anywhere in this codebase to have caught it first) — every
    // caller of `EvaluateGateForVersion` up to now was a unit test against a fake. Fixed
    // by schema-qualifying both tables with the real, bound tenant's schema name (`slug`
    // is validated shape-safe before it is ever bound into `TenantContext`, so
    // interpolating it into a bracketed identifier is exactly the same trust boundary
    // `substituteSchema()` already relies on for the DDL scripts) and binding
    // `agentVersionId` as a real parameter via `$queryRawUnsafe`'s positional args.
    const schema = sqlSchemaFor(currentTenant("evaluation locale readiness"));
    const rows = await getTenantDb("evaluation locale readiness").$queryRawUnsafe<Row[]>(
      `SELECT ls.localeCode AS localeCode, ls.translatedPercent AS translatedPercent
       FROM [${schema}].[AgentLocaleBindings] alb
       INNER JOIN [${schema}].[LocaleSettings] ls ON ls.localeCode = alb.localeCode
       WHERE alb.agentVersionId = @P1`,
      agentVersionId,
    );
    return rows.map((row) => ({
      localeCode: row.localeCode,
      translatedPercent: Number(row.translatedPercent),
    }));
  }
}
