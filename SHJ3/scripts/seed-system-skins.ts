/**
 * CLI entry point for `seedSystemSkins` — run once per environment (idempotent, safe
 * to re-run on every deploy).
 *
 *   pnpm exec tsx scripts/seed-system-skins.ts
 *
 * (also wired as `pnpm db:seed:appearance`.) Lives here, not inside
 * `modules/theming/application/`, because it is a composition root — it constructs a
 * concrete adapter (`PrismaSystemSkinSeeder`) directly, which `application/` code may
 * never do (the swap test, architecture.md §4). `scripts/` is where this repo's other
 * CLI-shaped composition happens (`generate-python-models.mjs` and friends), so this
 * follows that precedent rather than inventing a second one under `apps/web/`.
 *
 * Not a general migration/seed CLI — `scripts/migrate-tenants.mjs` is referenced by
 * `package.json`'s `db:migrate` but does not exist on disk (a pre-existing gap found,
 * not fixed, while building this: no production `MigrationExecutor` existed anywhere
 * in this codebase before this wave — see
 * `apps/web/src/modules/platform/adapters/outbound/sql/migration-executor.ts`).
 * Building that general CLI is out of scope for the theming backend; this is a
 * narrow, real, permanent entry point for exactly the one seed this wave needs.
 */

import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { PrismaSystemSkinSeeder } from "../apps/web/src/modules/theming/adapters/outbound/sql/prisma-system-skin-seeder.js";
import { seedSystemSkins } from "../apps/web/src/modules/theming/application/seed-system-skins.js";

async function main(): Promise<void> {
  // Platform-scoped (ADR-0002 rule 5) — seeding the platform's own default theme is a
  // one-time, audited, environment-bootstrap write, the same class of action as tenant
  // provisioning. The tenant field is never read for a platform-scoped call (mirrors
  // tests/isolation/setup.ts's own `runAsProvisioning` — arbitrary and harmless).
  const result = await runWithTenant(
    {
      tenant: assertValidSlugShape("bootstrap"),
      principal: null,
      traceId: "seed-system-skins",
      platformScope: "provisioning",
    },
    () => seedSystemSkins(new PrismaSystemSkinSeeder()),
  );

  console.info(`[seed-system-skins] ${result}`);
  await disconnectAllTenantDbs();
}

main().catch((error: unknown) => {
  console.error("[seed-system-skins] failed:", error);
  process.exitCode = 1;
});
