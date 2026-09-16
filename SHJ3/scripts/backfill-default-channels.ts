/**
 * Backfills B10 tab 1's fixed four-channel catalogue, plus `WebWidget`'s default
 * `WidgetConfig` (B10 tab 2), for every already-Active tenant that predates the real
 * provisioning fix (`ProvisionDefaultChannelsForTenant`, wired into `ProvisionTenant` via
 * `ProvisionDefaultChannelsHook`).
 *
 * `sharjah`, `customs` and `libraries` were provisioned before that fix existed and hold zero
 * `Channel` rows — B10's own Channels tab has no "add channel" affordance, so without this
 * backfill those tenants would never get one through any UI path. Re-running this script
 * after its own first pass (which only had the `Channel`-row half of the fix) is exactly the
 * case `ProvisionDefaultChannelsForTenant`'s per-field idempotency exists for: it backfills
 * the still-missing `WidgetConfig` without touching the `Channel` rows the first pass already
 * created. `sewa` (the hand-seeded demo tenant, real WebWidget/WhatsApp already Live) is
 * included too, not special-cased out — proven safe by this script's own `--dry-run` output.
 *
 * Run with: `npx tsx scripts/backfill-default-channels.ts` (add `--dry-run` to only report
 * what would be created, without writing anything).
 */
import { PrismaTenantRegistry } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-registry.js";
import { disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { ProvisionDefaultChannelsForTenant } from "../apps/web/src/modules/channels/application/provision-default-channels.js";
import { PrismaChannelRepository } from "../apps/web/src/modules/channels/adapters/outbound/sql/prisma-channel-repository.js";
import { PrismaWidgetConfigRepository } from "../apps/web/src/modules/channels/adapters/outbound/sql/prisma-widget-config-repository.js";
import { CHANNEL_KEYS } from "../apps/web/src/modules/channels/domain/vocabulary.js";
import { randomUUID } from "node:crypto";

const DRY_RUN = process.argv.includes("--dry-run");

/** `getPlatformDb()` (which `TenantRegistry.listActive()` calls) is one of the two sanctioned
 *  cross-tenant paths (ADR-0002 rule 5) and refuses to run outside a `platformScope`-carrying
 *  context — mirrors `tests/isolation/setup.ts`'s own `runAsProvisioning` helper. The bound
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
  readonly createdKeys: readonly string[];
  readonly widgetConfigCreated: boolean;
}

async function main(): Promise<void> {
  const registry = new PrismaTenantRegistry();
  const tenants = await runAsProvisioning(() => registry.listActive());

  if (tenants.length === 0) {
    console.info("[backfill-default-channels] no Active tenants found — nothing to do.");
    return;
  }

  const now = new Date();
  const summary: TenantSummary[] = [];

  for (const tenant of tenants) {
    await runWithTenant(
      { tenant: tenant.slug, principal: null, traceId: randomUUID().replace(/-/g, "") },
      async () => {
        const channels = new PrismaChannelRepository();
        const widgetConfig = new PrismaWidgetConfigRepository();

        if (DRY_RUN) {
          // Mirror the real use case's own "what's missing" computation without writing.
          const existing = await channels.list();
          const existingByKey = new Map(existing.map((row) => [row.key, row]));
          const missingChannelKeys = CHANNEL_KEYS.filter((key) => !existingByKey.has(key));
          const webWidgetId = existingByKey.get("WebWidget")?.id;
          const widgetConfigMissing = webWidgetId
            ? (await widgetConfig.findByChannelId(webWidgetId)) === null
            : missingChannelKeys.includes("WebWidget");
          summary.push({
            slug: tenant.slug,
            createdKeys: missingChannelKeys,
            widgetConfigCreated: widgetConfigMissing,
          });
          return;
        }

        const useCase = new ProvisionDefaultChannelsForTenant({ channels, widgetConfig });
        const result = await useCase.execute({ now });
        summary.push({
          slug: tenant.slug,
          createdKeys: result.createdKeys,
          widgetConfigCreated: result.widgetConfigCreated,
        });
      },
    );
  }

  console.info(
    `[backfill-default-channels] ${DRY_RUN ? "would create" : "created"} defaults for ${tenants.length} tenant(s):`,
  );
  for (const row of summary) {
    const parts: string[] = [];
    if (row.createdKeys.length > 0) parts.push(`channels: ${row.createdKeys.join(", ")}`);
    if (row.widgetConfigCreated) parts.push("widget config");
    console.info(
      parts.length > 0
        ? `  ${row.slug}: ${parts.join("; ")}`
        : `  ${row.slug}: already fully provisioned, nothing to do`,
    );
  }
}

main()
  .then(async () => {
    await disconnectAllTenantDbs();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[backfill-default-channels] failed:", error);
    await disconnectAllTenantDbs().catch(() => {});
    process.exit(1);
  });
