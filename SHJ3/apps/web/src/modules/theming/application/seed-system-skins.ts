/**
 * Seed the two shipped skins as real `platform.Skins` rows (task 2 of the theming
 * backend wave). Idempotent — safe to run on every deploy, a no-op after the first.
 *
 * ## One `Skins` row, not two
 *
 * The brief that started this wave asked for the two shipped skins "as real rows" —
 * read literally, two `Skins` rows. The ACTUAL, already-built `PlatformSkin` model
 * (`prisma/platform/schema.prisma`) structurally pairs a light and a dark `TokenSet`
 * in ONE row (`lightTokenSetId NOT NULL`, `darkTokenSetId NOT NULL`,
 * `CK_Skins_modesDiffer CHECK (lightTokenSetId <> darkTokenSetId)`) — a `Skin` row
 * cannot exist with only one mode, unlike `@shj3/tokens`' `Skin` TypeScript type
 * (`SHARJAH_DEFAULT` / `SHARJAH_DARK`), which is genuinely mode-independent (each is a
 * standalone JSON *interchange* document, §7.1). Those are two different levels of the
 * system with justifiably different shapes: the JSON format is what an export/import
 * round-trips; the DB row is what `Skins.isTenantDefault` / `TR_Skins_blockSystemDelete`
 * /`UQ_Skins_name` already assume — one identity, two mode variants.
 *
 * Seeding two `PlatformSkin` rows that both point at the SAME two `TokenSets` rows
 * (the only way to satisfy `UQ_TokenSets_kind_mode`'s "exactly one light and one dark
 * system default") would produce two identically-rendering rows differing only in
 * `name` — redundant, and answering a question ("which of two IDENTICAL skins is
 * active") the resolution algorithm never asks. So: exactly one `PlatformSkin` row,
 * "Sharjah Default", pairing exactly the two required `TokenSets` rows. Documented
 * here rather than left implicit, since it is a real, deliberate departure from the
 * brief's literal wording once the brief's own instruction ("check the real, current
 * API... not something to copy verbatim") is followed all the way through.
 */

import {
  resolveSkinTokens,
  SHARJAH_DARK,
  SHARJAH_DEFAULT,
  SKIN_SCHEMA_VERSION,
  type ColorMode,
} from "@shj3/tokens";
import { assertContrastPasses } from "./appearance-gate.js";
import type { SystemSkinSeedInput, SystemSkinSeeder } from "../ports/system-skin-seeder.js";

export const SYSTEM_DEFAULT_SKIN_NAME = "Sharjah Default";

export type SeedSystemSkinsResult = "seeded" | "already-seeded";

/**
 * Reads token values from `@shj3/tokens` — never hand-retyped — and re-validates them
 * through the real contrast gate (`assertContrastPasses`, the same function every
 * future save/apply path in this module calls) before writing anything, so a save that
 * skipped the check is not how the platform's own fallback theme reaches the database.
 */
export async function seedSystemSkins(seeder: SystemSkinSeeder): Promise<SeedSystemSkinsResult> {
  if (await seeder.hasSystemDefaultSkin()) {
    return "already-seeded";
  }

  const modes: Record<ColorMode, { tokens: ReturnType<typeof resolveSkinTokens> }> = {
    light: { tokens: resolveSkinTokens(SHARJAH_DEFAULT, "light") },
    dark: { tokens: resolveSkinTokens(SHARJAH_DARK, "dark") },
  };

  const input: SystemSkinSeedInput = {
    name: SYSTEM_DEFAULT_SKIN_NAME,
    schemaVersion: SKIN_SCHEMA_VERSION,
    modes: {
      light: {
        tokens: modes.light.tokens,
        // Real, not fabricated: an unvalidated token set cannot be persisted at all
        // per CK_PlatformTokenSets_contrastGate, so the timestamp this proves is
        // exactly the one the constraint requires.
        contrastReport: assertContrastPasses(modes.light.tokens),
      },
      dark: {
        tokens: modes.dark.tokens,
        contrastReport: assertContrastPasses(modes.dark.tokens),
      },
    },
  };

  await seeder.seedSystemDefaultSkin(input);
  return "seeded";
}
