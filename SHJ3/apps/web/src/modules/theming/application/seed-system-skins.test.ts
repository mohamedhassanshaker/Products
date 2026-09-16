import { describe, expect, it } from "vitest";
import { seedSystemSkins, SYSTEM_DEFAULT_SKIN_NAME } from "./seed-system-skins.js";
import type { SystemSkinSeedInput, SystemSkinSeeder } from "../ports/system-skin-seeder.js";

class FakeSystemSkinSeeder implements SystemSkinSeeder {
  seeded: SystemSkinSeedInput | null = null;

  async hasSystemDefaultSkin(): Promise<boolean> {
    return this.seeded !== null;
  }

  async seedSystemDefaultSkin(input: SystemSkinSeedInput): Promise<void> {
    this.seeded = input;
  }
}

describe("seedSystemSkins", () => {
  it("seeds real token values read from @shj3/tokens, already contrast-validated", async () => {
    const seeder = new FakeSystemSkinSeeder();
    const result = await seedSystemSkins(seeder);

    expect(result).toBe("seeded");
    expect(seeder.seeded).not.toBeNull();
    expect(seeder.seeded?.name).toBe(SYSTEM_DEFAULT_SKIN_NAME);
    // Real values, not placeholders: the shipped default's own primary brand colour.
    expect(seeder.seeded?.modes.light.tokens.primary).toBeTruthy();
    expect(seeder.seeded?.modes.dark.tokens.primary).toBeTruthy();
    // The contrast report attached is real and passing — assertContrastPasses would
    // have thrown otherwise, so reaching this point already proves it ran.
    expect(seeder.seeded?.modes.light.contrastReport.passed).toBe(true);
    expect(seeder.seeded?.modes.dark.contrastReport.passed).toBe(true);
  });

  it("is idempotent — a second run is a no-op", async () => {
    const seeder = new FakeSystemSkinSeeder();
    await seedSystemSkins(seeder);
    const firstSeed = seeder.seeded;

    const secondResult = await seedSystemSkins(seeder);

    expect(secondResult).toBe("already-seeded");
    // Confirms it did not re-seed (same object reference, never replaced).
    expect(seeder.seeded).toBe(firstSeed);
  });
});
