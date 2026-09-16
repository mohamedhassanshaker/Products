/**
 * CLI entry point for B10's deterministic demo data. Mirrors `scripts/seed-agents-tools-
 * demo-data.ts`'s own shape: bind the `sewa` tenant once, look up the real, already-seeded
 * "SEWA & Utilities Billing Agent" and "SEWA Billing" team by name (never hardcode an id —
 * this project's own lessons.md discipline), then run this module's seed functions in
 * dependency order.
 *
 * Run with: `npx tsx scripts/seed-channels-demo-data.ts`. Not wired into `package.json`'s
 * `db:seed:*` family in this pass — `package.json` is a shared file a concurrent wave may
 * also be editing (this repo's own lessons.md flags exactly this coordination hazard), and
 * adding a script entry there was out of this wave's stated file scope. Whoever next edits
 * `package.json` for this module should add:
 *   "db:seed:channels": "tsx scripts/seed-channels-demo-data.ts"
 */
import { randomUUID } from "node:crypto";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import {
  getPlatformDb,
  getTenantDb,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import {
  seedChannelsAndHandoverHours,
  seedLocaleSettings,
  seedQuietHours,
  seedTemplatesAndCampaigns,
} from "../apps/web/src/modules/channels/adapters/outbound/sql/seed-channels-demo-data.js";
import { seedQuickActions } from "../apps/web/src/modules/conversation/adapters/outbound/sql/seed-quick-actions.js";

const SEWA_AGENT_NAME = "SEWA & Utilities Billing Agent";
const SEWA_TEAM_NAME = "SEWA Billing";

/**
 * `platform.Locale` (the platform-wide locale catalogue `LocaleSetting.localeCode`
 * references) turned out to have zero rows anywhere in this environment — confirmed
 * directly with a throwaway query before writing this, not assumed. That catalogue is a
 * different module's own seed concern (platform-wide i18n, not B10's), and genuinely
 * belongs to whichever wave first owns `platform`-scope locale seeding — but nothing has
 * created it yet, and `seedLocaleSettings`'s own tenant-side rows have a real FK to it
 * (`LocaleSettings_localeCode_fkey`), so this script seeds the two rows it needs as an
 * honestly-labelled prerequisite rather than silently working around the gap or inventing a
 * parallel, un-keyed locale concept.
 */
async function ensurePlatformLocales(now: Date): Promise<void> {
  const db = getPlatformDb();
  const existing = await db.locale.findMany({ where: { code: { in: ["en", "ar"] } } });
  const codes = new Set(existing.map((l) => l.code));

  if (!codes.has("en")) {
    await db.locale.create({
      data: {
        code: "en",
        englishName: "English",
        nativeName: "English",
        direction: "LTR",
        defaultVoiceName: "Aria (EN)",
        isEnabledPlatformWide: true,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  if (!codes.has("ar")) {
    await db.locale.create({
      data: {
        code: "ar",
        englishName: "Arabic",
        nativeName: "العربية",
        direction: "RTL",
        defaultVoiceName: "Layla (AR)",
        isEnabledPlatformWide: true,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const sewa = assertValidSlugShape("sewa");

  await runWithTenant(
    {
      tenant: sewa,
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "identity",
    },
    async () => {
      const db = getTenantDb();
      const agent = await db.agent.findFirst({ where: { name: SEWA_AGENT_NAME } });
      if (!agent) {
        throw new Error(
          `seed-channels-demo-data: no Agent named "${SEWA_AGENT_NAME}" found in the sewa tenant — ` +
            "run scripts/seed-agents-tools-demo-data.ts first.",
        );
      }
      const team = await db.team.findFirst({ where: { name: SEWA_TEAM_NAME } });
      if (!team) {
        throw new Error(
          `seed-channels-demo-data: no Team named "${SEWA_TEAM_NAME}" found in the sewa tenant — ` +
            "run scripts/seed-iam-demo-data.ts first.",
        );
      }

      await ensurePlatformLocales(now);
      await seedChannelsAndHandoverHours({
        boundAgentId: agent.id,
        defaultQueueTeamId: team.id,
        now,
      });
      await seedTemplatesAndCampaigns(now);
      await seedQuietHours(now);
      await seedLocaleSettings(now);
      await seedQuickActions(now);

      console.info("[seed-channels-demo-data] done.");
    },
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed-channels-demo-data] failed:", error);
    process.exit(1);
  });
