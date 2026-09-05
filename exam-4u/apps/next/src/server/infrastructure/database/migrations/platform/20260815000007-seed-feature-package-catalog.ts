import { randomUUID } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the FR-PKG-1/2/3 platform catalog (LLD §4.1: the exact 9 features and the `starter`/`pro`/
 * `enterprise` packages) — ported **verbatim** (feature keys/units/reset-periods, package
 * names/prices, and every per-package numeric limit) from `legacy/api/src/infrastructure/database/
 * migrations/platform/1730000000012-seed-feature-package-catalog.ts`, per this dispatch's explicit
 * instruction to reproduce the exact approved dataset rather than reinvent tier numbers.
 *
 * **Idempotency strategy, per-row**: every insert uses `ON DUPLICATE KEY UPDATE id = id` keyed on
 * each table's real unique key (`uq_feature_key`, `uq_package_key`, `uq_pkg_feature`) — a no-op when
 * the row already exists, so re-running this migration never duplicates rows nor fights a Platform
 * Admin's later catalog customization (Phase 2).
 *
 * **`starter` is `FALLBACK_PACKAGE_KEY`** (`getEnv().FALLBACK_PACKAGE_KEY`, default `'starter'`) — the
 * package a `CANCELED` subscription falls back to (FR-PKG-6) and the package
 * `CreateSubscriptionStep` subscribes every newly-provisioned tenant to. It must always exist once
 * this migration has run; `PackageRepository` treats its absence as fail-closed.
 */
export class SeedFeaturePackageCatalog20260815000007 implements MigrationInterface {
  name = 'SeedFeaturePackageCatalog20260815000007';

  private readonly features: { key: string; name: string; unit: string; resetPeriod: 'NONE' | 'DAILY' | 'MONTHLY' }[] = [
    { key: 'exams.create', name: 'Exam creation', unit: 'exams', resetPeriod: 'MONTHLY' },
    { key: 'exams.total', name: 'Total exam types', unit: 'exams', resetPeriod: 'NONE' },
    { key: 'pdf.generations', name: 'PDF pipeline runs', unit: 'generations', resetPeriod: 'MONTHLY' },
    { key: 'pdf.pages', name: 'PDF pages processed', unit: 'pages', resetPeriod: 'MONTHLY' },
    { key: 'curricula.total', name: 'Total curricula', unit: 'curricula', resetPeriod: 'NONE' },
    { key: 'curricula.documents', name: 'Curriculum documents uploaded', unit: 'documents', resetPeriod: 'MONTHLY' },
    { key: 'practice.prompt', name: 'AI practice-prompt sessions', unit: 'sessions', resetPeriod: 'DAILY' },
    { key: 'users.total', name: 'Total tenant users', unit: 'users', resetPeriod: 'NONE' },
    { key: 'attempts.monthly', name: 'Exam attempts', unit: 'attempts', resetPeriod: 'MONTHLY' },
  ];

  private readonly packages: { key: string; name: string; priceCents: number; sortOrder: number }[] = [
    { key: 'starter', name: 'Starter', priceCents: 0, sortOrder: 0 },
    { key: 'pro', name: 'Pro', priceCents: 4900, sortOrder: 1 },
    { key: 'enterprise', name: 'Enterprise', priceCents: 19900, sortOrder: 2 },
  ];

  /** Per-package limits, `null` = unlimited — verbatim from the legacy seed's already-approved
   * numbers. Every feature is `enabled` on every seeded package. */
  private readonly limits: Record<string, Record<string, number | null>> = {
    starter: {
      'exams.create': 5,
      'exams.total': 3,
      'pdf.generations': 5,
      'pdf.pages': 50,
      'curricula.total': 2,
      'curricula.documents': 5,
      'practice.prompt': 3,
      'users.total': 5,
      'attempts.monthly': 20,
    },
    pro: {
      'exams.create': 50,
      'exams.total': 25,
      'pdf.generations': 50,
      'pdf.pages': 1000,
      'curricula.total': 20,
      'curricula.documents': 100,
      'practice.prompt': 25,
      'users.total': 50,
      'attempts.monthly': 500,
    },
    enterprise: {
      'exams.create': null,
      'exams.total': null,
      'pdf.generations': null,
      'pdf.pages': null,
      'curricula.total': null,
      'curricula.documents': null,
      'practice.prompt': null,
      'users.total': null,
      'attempts.monthly': null,
    },
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const feature of this.features) {
      await queryRunner.query(
        `INSERT INTO feature (id, \`key\`, name, description, unit, reset_period)
         VALUES (?, ?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [randomUUID(), feature.key, feature.name, feature.unit, feature.resetPeriod],
      );
    }

    for (const pkg of this.packages) {
      await queryRunner.query(
        `INSERT INTO \`package\` (id, \`key\`, name, description, price_cents, currency, is_active, sort_order)
         VALUES (?, ?, ?, NULL, ?, 'usd', 1, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [randomUUID(), pkg.key, pkg.name, pkg.priceCents, pkg.sortOrder],
      );
    }

    for (const pkg of this.packages) {
      const [pkgRow]: { id: string }[] = await queryRunner.query('SELECT id FROM `package` WHERE `key` = ?', [pkg.key]);
      for (const feature of this.features) {
        const [featureRow]: { id: string }[] = await queryRunner.query('SELECT id FROM feature WHERE `key` = ?', [
          feature.key,
        ]);
        const limit = this.limits[pkg.key][feature.key];
        await queryRunner.query(
          `INSERT INTO package_feature (id, package_id, feature_id, \`limit\`, enabled)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE id = id`,
          [randomUUID(), pkgRow.id, featureRow.id, limit],
        );
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface requires the param; see doc comment for why down() is a no-op.
  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deliberately a no-op — same rationale as the legacy seed this is ported from: every insert is
    // an idempotent "grant a starting point" upsert, so there is no safe, unambiguous "undo" that
    // wouldn't risk deleting a Platform Admin's own later catalog customization.
  }
}
