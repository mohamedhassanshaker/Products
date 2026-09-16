/**
 * Backfills B4's `RouterConfigs` singleton for every already-Active tenant that predates the
 * real provisioning fix (`ProvisionDefaultRouterConfigForTenant`, wired into `ProvisionTenant`
 * via `ProvisionDefaultRouterConfigHook`) — the identical shape
 * `backfill-default-channels.ts` already established for B10 tab 1's channel catalogue.
 *
 * `sharjah`, `customs` and `libraries` were provisioned before that fix existed and hold zero
 * `RouterConfigs` rows — `/orchestrator`'s own `ExecutionModePanel` has no "configure" path
 * anywhere (execution mode is read-only, a tenant-wide fact `ProcessTurn` reads fresh every
 * turn, never a per-screen toggle), so without this backfill those tenants would show "No
 * router configuration yet" forever, through any UI path. `sewa` (the hand-seeded demo
 * tenant, already provisioned by `scripts/seed-agent-runtime-demo-data.ts`) is included too,
 * not special-cased out — proven safe by this script's own `--dry-run` output and by
 * `ProvisionDefaultRouterConfigForTenant`'s own idempotency (a tenant that already has the
 * singleton gets nothing created, its real row untouched).
 *
 * Run with: `npx tsx scripts/backfill-default-router-config.ts` (add `--dry-run` to only
 * report what would be created, without writing anything).
 */
import { randomUUID } from "node:crypto";
import { PrismaTenantRegistry } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-registry.js";
import { disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { ProvisionDefaultRouterConfigForTenant } from "../apps/web/src/modules/orchestration/application/provision-default-router-config.js";
import { PrismaRouterConfigRepository } from "../apps/web/src/modules/orchestration/adapters/outbound/sql/prisma-router-config-repository.js";

const DRY_RUN = process.argv.includes("--dry-run");

/** `getPlatformDb()` (which `TenantRegistry.listActive()` calls) is one of the two sanctioned
 *  cross-tenant paths (ADR-0002 rule 5) and refuses to run outside a `platformScope`-carrying
 *  context — mirrors `backfill-default-channels.ts`'s own identical helper. The bound
 *  `tenant` here is never read for registry listing; it exists only to satisfy the type. */
function runAsProvisioning<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    {
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "provisioning",
    },
    fn,
  );
}

interface TenantSummary {
  readonly slug: string;
  readonly created: boolean;
}

async function main(): Promise<void> {
  const registry = new PrismaTenantRegistry();
  const tenants = await runAsProvisioning(() => registry.listActive());

  if (tenants.length === 0) {
    console.info("[backfill-default-router-config] no Active tenants found — nothing to do.");
    return;
  }

  const now = new Date();
  const summary: TenantSummary[] = [];

  for (const tenant of tenants) {
    await runWithTenant(
      { tenant: tenant.slug, principal: null, traceId: randomUUID().replace(/-/g, "") },
      async () => {
        const routerConfig = new PrismaRouterConfigRepository();

        if (DRY_RUN) {
          // Mirror the real use case's own "is one already there" check without writing.
          const existing = await routerConfig.getSingleton();
          summary.push({ slug: tenant.slug, created: existing === null });
          return;
        }

        const useCase = new ProvisionDefaultRouterConfigForTenant({ routerConfig });
        const result = await useCase.execute({ now });
        summary.push({ slug: tenant.slug, created: result.created });
      },
    );
  }

  console.info(
    `[backfill-default-router-config] ${DRY_RUN ? "would create" : "created"} defaults for ${tenants.length} tenant(s):`,
  );
  for (const row of summary) {
    console.info(
      `  ${row.slug}: ${row.created ? "RouterConfigs singleton" : "already provisioned, nothing to do"}`,
    );
  }
}

main()
  .then(async () => {
    await disconnectAllTenantDbs();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[backfill-default-router-config] failed:", error);
    await disconnectAllTenantDbs().catch(() => {});
    process.exit(1);
  });
