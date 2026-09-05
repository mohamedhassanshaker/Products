import { describe, expect, it } from 'vitest';
import { SeedFeaturePackageCatalog20260815000007 } from './20260815000007-seed-feature-package-catalog';

/**
 * Pure-logic assertions on the ported-verbatim catalog dataset itself (no real database — the real
 * "did it actually seed correctly" proof is the integration test/exit-gate MySQL run). Guards against
 * a transcription slip while porting the dataset from `legacy/api/src/infrastructure/database/
 * migrations/platform/1730000000012-seed-feature-package-catalog.ts` — this dispatch's explicit
 * instruction was to reproduce the exact approved dataset, not reinvent tier numbers.
 */
describe('SeedFeaturePackageCatalog20260815000007 (dataset shape)', () => {
  // Private fields are still readable at runtime (TypeScript's `private` is compile-time-only) —
  // deliberately reaching into them here rather than duplicating the dataset a second time in the
  // test itself, which would just prove the copy matches the copy.
  const migration = new SeedFeaturePackageCatalog20260815000007() as unknown as {
    features: { key: string; name: string; unit: string; resetPeriod: string }[];
    packages: { key: string; name: string; priceCents: number; sortOrder: number }[];
    limits: Record<string, Record<string, number | null>>;
  };

  it('defines exactly the 9 approved feature keys', () => {
    expect(migration.features).toHaveLength(9);
    expect(migration.features.map((f) => f.key).sort()).toEqual(
      [
        'attempts.monthly',
        'curricula.documents',
        'curricula.total',
        'exams.create',
        'exams.total',
        'pdf.generations',
        'pdf.pages',
        'practice.prompt',
        'users.total',
      ].sort(),
    );
  });

  it('defines exactly the 3 approved packages, in starter/pro/enterprise sort order', () => {
    expect(migration.packages.map((p) => p.key)).toEqual(['starter', 'pro', 'enterprise']);
    expect(migration.packages.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('prices starter at 0, pro at 4900, enterprise at 19900 cents', () => {
    const byKey = Object.fromEntries(migration.packages.map((p) => [p.key, p.priceCents]));
    expect(byKey).toEqual({ starter: 0, pro: 4900, enterprise: 19900 });
  });

  it('defines a limit entry for every (package, feature) pair — no gaps', () => {
    for (const pkg of migration.packages) {
      for (const feature of migration.features) {
        expect(Object.prototype.hasOwnProperty.call(migration.limits[pkg.key], feature.key)).toBe(true);
      }
    }
  });

  it('enterprise has every limit set to null (unlimited)', () => {
    const enterpriseLimits = Object.values(migration.limits.enterprise);
    expect(enterpriseLimits.every((v) => v === null)).toBe(true);
  });

  it('starter has a strictly smaller (or equal) numeric limit than pro for every feature', () => {
    for (const feature of migration.features) {
      const starterLimit = migration.limits.starter[feature.key];
      const proLimit = migration.limits.pro[feature.key];
      expect(typeof starterLimit).toBe('number');
      expect(typeof proLimit).toBe('number');
      expect((starterLimit as number) <= (proLimit as number)).toBe(true);
    }
  });
});
