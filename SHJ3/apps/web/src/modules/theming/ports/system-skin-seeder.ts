/**
 * The one-time, idempotent platform bootstrap: seeding the two shipped skins as real
 * `platform.Skins` / `platform.TokenSets` rows (design-system.md §9.3; ADR-0007).
 *
 * Separate from `ThemeRepository` deliberately: this is a platform-scoped bootstrap
 * action run once per environment, not a per-request tenant/user read.
 */

import type { ColorMode, ContrastReport, SemanticColorTokens } from "@shj3/tokens";

export interface SystemSkinModeSeed {
  readonly tokens: SemanticColorTokens;
  readonly contrastReport: ContrastReport;
}

export interface SystemSkinSeedInput {
  readonly name: string;
  readonly schemaVersion: number;
  readonly modes: Readonly<Record<ColorMode, SystemSkinModeSeed>>;
}

export interface SystemSkinSeeder {
  /** True once the one system-default `Skins` row exists — the idempotency check. */
  hasSystemDefaultSkin(): Promise<boolean>;

  /** Writes the two `TokenSets` rows (one per mode) and the one `Skins` row pairing
   *  them, all in a single transaction — never partially seeded. */
  seedSystemDefaultSkin(input: SystemSkinSeedInput): Promise<void>;
}
