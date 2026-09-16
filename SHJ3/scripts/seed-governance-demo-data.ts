/**
 * Deterministic reference data for B-9 (Governance): `platform.Environments` — the real
 * chain `Development -> UAT -> Production` B14 tab 1 and every `PromotionRequests` write
 * depends on (`TR_PromotionRequests_decisionRules` reads this table directly). Nothing had
 * ever seeded it before this wave (confirmed via a live query against the real dev
 * database — zero rows).
 *
 * Idempotent: checked by the real unique `key` before creating, matching every other
 * `scripts/seed-*.ts` file's own convention.
 */
import { randomUUID } from "node:crypto";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { getPlatformDb } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";

interface EnvironmentSeed {
  readonly key: string;
  readonly displayName: string;
  readonly ordinal: number;
  readonly promotesToKey: string | null;
  readonly isLive: boolean;
}

const ENVIRONMENTS: readonly EnvironmentSeed[] = [
  {
    key: "development",
    displayName: "Development",
    ordinal: 1,
    promotesToKey: "uat",
    isLive: false,
  },
  { key: "uat", displayName: "UAT", ordinal: 2, promotesToKey: "production", isLive: false },
  { key: "production", displayName: "Production", ordinal: 3, promotesToKey: null, isLive: true },
];

async function main(): Promise<void> {
  const now = new Date();
  // Any real tenant slug puts this call inside a bound TenantContext with
  // `platformScope` set, which is all `getPlatformDb()` requires — `Environments` is
  // platform-global, not tenant-scoped data.
  const sewa = assertValidSlugShape("sewa");

  await runWithTenant(
    {
      tenant: sewa,
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "provisioning",
    },
    async () => {
      const db = getPlatformDb();
      // Insert in reverse ordinal order: `promotesToKey` is a self-referencing FK
      // (`Environments_promotesToKey_fkey`), so the target row must already exist —
      // Production (no target) first, then UAT (-> Production), then Development.
      for (const environment of [...ENVIRONMENTS].reverse()) {
        const existing = await db.environment.findUnique({ where: { key: environment.key } });
        if (existing) {
          console.info(
            `[seed-governance] Environment "${environment.key}" already exists — skipping.`,
          );
          continue;
        }
        await db.environment.create({
          data: {
            key: environment.key,
            displayName: environment.displayName,
            ordinal: environment.ordinal,
            promotesToKey: environment.promotesToKey,
            isLive: environment.isLive,
            createdAt: now,
            updatedAt: now,
          },
        });
        console.info(`[seed-governance] Created Environment "${environment.key}".`);
      }
    },
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
