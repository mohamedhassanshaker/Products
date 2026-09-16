/**
 * The real `SystemSkinSeeder` — `platform.TokenSets` / `platform.Skins`
 * (`PlatformTokenSet` / `PlatformSkin` in `prisma/platform/schema.prisma`).
 *
 * Reached exclusively through `getPlatformDb()`, same as every other platform-scoped
 * write in this codebase (ADR-0002 rule 3: no unscoped store client). Writing the two
 * `TokenSets` rows and the one `Skins` row that pairs them is a bootstrap action run
 * once per environment, inside `runWithTenant({ platformScope: "provisioning" })` —
 * the same scope tenant provisioning itself uses, since seeding the platform's own
 * default theme is exactly that kind of one-time, audited, environment-bootstrap
 * write, not a per-request read (see `seed-system-skins.run.ts`).
 */

import { getPlatformDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { SystemSkinSeedInput, SystemSkinSeeder } from "../../../ports/system-skin-seeder.js";

const OPERATION = "system skin seeding";

export class PrismaSystemSkinSeeder implements SystemSkinSeeder {
  async hasSystemDefaultSkin(): Promise<boolean> {
    const db = getPlatformDb(OPERATION);
    const existing = await db.platformSkin.findFirst({ where: { isSystem: true } });
    return existing !== null;
  }

  async seedSystemDefaultSkin(input: SystemSkinSeedInput): Promise<void> {
    const db = getPlatformDb(OPERATION);
    const now = new Date();

    // Distinct millisecond stamps so three ULIDs minted in the same tick still sort
    // in creation order — cosmetic here (no code reads TokenSet/Skin creation order),
    // kept only for consistency with `tenant-registry.ts`'s own established pattern.
    const lightId = newUlid(now);
    const darkId = newUlid(new Date(now.getTime() + 1));
    const skinId = newUlid(new Date(now.getTime() + 2));

    // One transaction: the two TokenSets rows must exist before the Skin row's FKs
    // can reference them, and a partial write here would leave a Skins row impossible
    // to construct correctly — Prisma's array form runs these sequentially, in order,
    // inside one transaction.
    await db.$transaction([
      db.platformTokenSet.create({
        data: {
          id: lightId,
          name: `${input.name} (Light)`,
          kind: "SystemDefault",
          mode: "Light",
          schemaVersion: input.schemaVersion,
          tokensJson: JSON.stringify(input.modes.light.tokens),
          contrastValidatedAt: now,
          contrastReportJson: JSON.stringify(input.modes.light.contrastReport),
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.platformTokenSet.create({
        data: {
          id: darkId,
          name: `${input.name} (Dark)`,
          kind: "SystemDefault",
          mode: "Dark",
          schemaVersion: input.schemaVersion,
          tokensJson: JSON.stringify(input.modes.dark.tokens),
          contrastValidatedAt: now,
          contrastReportJson: JSON.stringify(input.modes.dark.contrastReport),
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.platformSkin.create({
        data: {
          id: skinId,
          name: input.name,
          description:
            "The platform default skin, shipped read-only — the terminal fallback of the theme resolution chain (design-system.md §9.4).",
          lightTokenSetId: lightId,
          darkTokenSetId: darkId,
          isSystem: true,
          status: "Published",
          exportSchemaVersion: input.schemaVersion,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);
  }
}
