import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The name this migration reserves for `user.education_level_id`'s foreign key. */
const FK_NAME = 'fk_user_edu';

/** A single foreign-key column row as reported by `information_schema.KEY_COLUMN_USAGE`. */
interface FkColumnRow {
  CONSTRAINT_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string | null;
  REFERENCED_COLUMN_NAME: string | null;
}

/**
 * The result of inspecting a tenant schema for this migration's intended foreign key.
 *
 * - `absent` — neither the correct relationship nor the reserved name exists; create the FK.
 * - `correct` — a foreign key already links `user.education_level_id` -> `education_level(id)`
 *   (under `constraintName`, which may or may not be `fk_user_edu`); skip — true idempotency.
 * - `conflicting` — a constraint already occupies the reserved name `fk_user_edu` but does **not**
 *   implement that relationship. An inconsistent schema no migration can safely reconcile on its own,
 *   so it must fail loudly rather than silently skip.
 */
type FkState =
  | { kind: 'absent' }
  | { kind: 'correct'; constraintName: string }
  | { kind: 'conflicting'; detail: string };

/**
 * Classifies the state of `user.education_level_id`'s foreign key in the current tenant schema —
 * ported verbatim (logic unchanged) from
 * `legacy/api/src/infrastructure/database/migrations/tenant/1730000000003-create-taxonomy-tables.ts`'s
 * `inspectUserEduFk`. Checks the **relationship**, not merely the constraint name — a same-named
 * constraint pointing at the wrong table must be a hard failure, not a silently-skipped false match
 * (legacy's own Dev-10 QA fix pass, retry 2, found and closed exactly this gap).
 *
 * `information_schema.KEY_COLUMN_USAGE` is used because, unlike `TABLE_CONSTRAINTS`, it exposes
 * `REFERENCED_TABLE_NAME`/`REFERENCED_COLUMN_NAME`, i.e. what the constraint actually enforces.
 *
 * @param queryRunner Query runner bound to the tenant schema being migrated.
 * @returns The three-way {@link FkState} classification for that schema.
 */
async function inspectUserEduFk(queryRunner: QueryRunner): Promise<FkState> {
  const fkColumns: FkColumnRow[] = await queryRunner.query(
    `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND REFERENCED_TABLE_NAME IS NOT NULL`,
  );

  const correct = fkColumns.find(
    (row) =>
      row.COLUMN_NAME === 'education_level_id' &&
      row.REFERENCED_TABLE_NAME === 'education_level' &&
      row.REFERENCED_COLUMN_NAME === 'id',
  );
  if (correct) {
    return { kind: 'correct', constraintName: correct.CONSTRAINT_NAME };
  }

  const sameNameFk = fkColumns.find((row) => row.CONSTRAINT_NAME === FK_NAME);
  if (sameNameFk) {
    return {
      kind: 'conflicting',
      detail:
        `foreign key \`${FK_NAME}\` already exists on \`user\` but references ` +
        `\`${sameNameFk.REFERENCED_TABLE_NAME}\`(\`${sameNameFk.REFERENCED_COLUMN_NAME}\`) from column ` +
        `\`${sameNameFk.COLUMN_NAME}\`, not \`education_level\`(\`id\`) from \`education_level_id\``,
    };
  }

  const collisionRows: Array<{ CONSTRAINT_TYPE: string }> = await queryRunner.query(
    `SELECT CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND CONSTRAINT_NAME = ?
      LIMIT 1`,
    [FK_NAME],
  );
  if (collisionRows.length > 0) {
    return {
      kind: 'conflicting',
      detail:
        `a constraint named \`${FK_NAME}\` already exists on \`user\` with type ` +
        `${collisionRows[0].CONSTRAINT_TYPE}, which is not the expected FOREIGN KEY to ` +
        `\`education_level\`(\`id\`)`,
    };
  }

  return { kind: 'absent' };
}

/** Builds the operator-facing error for a `conflicting` {@link FkState}. */
function fkConflictError(detail: string): Error {
  return new Error(
    `CreateTaxonomyTables20260815000003: refusing to continue — ${detail}. This schema is ` +
      `inconsistent (\`user.education_level_id\` must be constrained to \`education_level(id)\`, ` +
      `the DB-level backstop for FR-TAX-4) and cannot be reconciled automatically. Resolve it ` +
      `manually against this tenant schema (inspect the offending constraint on \`user\`, then drop ` +
      `or rename it), then re-run the tenant migration.`,
  );
}

/**
 * Creates the three-level taxonomy tables in every tenant schema (migration plan Phase 3, FR-TAX-1..4):
 * `education_level -> stage -> subject` — ported verbatim (DDL/logic unchanged) from
 * `legacy/api/src/infrastructure/database/migrations/tenant/1730000000003-create-taxonomy-tables.ts`.
 * Each level's `name` is unique within its parent (FR-TAX-1) and that uniqueness is case-insensitive
 * (FR-TAX-2) purely via the table's `utf8mb4_0900_ai_ci` collation — no `LOWER()` normalization column
 * needed, matching `user.email`'s identical existing convention.
 *
 * **Closes sub-slice 1a's forward reference**: `CreateRbacTables20260815000001`'s own doc comment
 * documented `user.education_level_id` as "a plain nullable INT with no foreign key... added by that
 * phase's own migration once education_level exists" (the Taxonomy phase, i.e. this one). This
 * migration adds that FK now (`fk_user_edu`), `ON DELETE SET NULL`, a defensive DB-level backstop only
 * — **this does not by itself satisfy FR-TAX-4** ("referenced by... User cannot be deleted outright"):
 * `TaxonomyService` checks for referencing `user` rows *before* issuing the delete and rejects with
 * `TAXONOMY_ENTRY_IN_USE`, since `ON DELETE SET NULL` would otherwise silently succeed rather than
 * error. See `TaxonomyService`'s own doc comment for the full two-part enforcement strategy.
 *
 * **Idempotent DDL, retry-safe from a partially-applied state**: `CREATE TABLE IF NOT EXISTS` for the
 * three tables; the trailing `ALTER TABLE` is skipped when the FK it creates is genuinely already in
 * place, and fails loudly (never silently) if the reserved constraint name is occupied by something
 * else — ported verbatim from legacy's own Dev-10 QA-fix-pass-hardened version, not the original.
 */
export class CreateTaxonomyTables20260815000003 implements MigrationInterface {
  name = 'CreateTaxonomyTables20260815000003';

  /**
   * Creates `education_level`/`stage`/`subject` and `user.education_level_id`'s foreign key.
   *
   * @param queryRunner Query runner bound to the tenant schema being migrated.
   * @throws Error if a constraint named `fk_user_edu` already exists on `user` without implementing
   *   the `education_level_id -> education_level(id)` relationship this migration owns.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS education_level (
        id INT NOT NULL AUTO_INCREMENT, name VARCHAR(150) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id), UNIQUE KEY uq_edu_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stage (
        id INT NOT NULL AUTO_INCREMENT, education_level_id INT NOT NULL, name VARCHAR(150) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id), UNIQUE KEY uq_stage_name (education_level_id, name),
        CONSTRAINT fk_stage_edu FOREIGN KEY (education_level_id) REFERENCES education_level(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subject (
        id INT NOT NULL AUTO_INCREMENT, stage_id INT NOT NULL, name VARCHAR(150) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id), UNIQUE KEY uq_subject_name (stage_id, name),
        CONSTRAINT fk_subject_stage FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const state = await inspectUserEduFk(queryRunner);
    if (state.kind === 'conflicting') {
      throw fkConflictError(state.detail);
    }
    if (state.kind === 'absent') {
      await queryRunner.query(`
        ALTER TABLE \`user\`
          ADD CONSTRAINT ${FK_NAME} FOREIGN KEY (education_level_id) REFERENCES education_level(id) ON DELETE SET NULL
      `);
    }
    // state.kind === 'correct' -> nothing to do: the FK this migration owns is already enforced.
  }

  /**
   * Drops the foreign key and the three taxonomy tables.
   *
   * @param queryRunner Query runner bound to the tenant schema being reverted.
   * @throws Error if a constraint named `fk_user_edu` exists but is not the FK this migration created.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const state = await inspectUserEduFk(queryRunner);
    if (state.kind === 'conflicting') {
      throw fkConflictError(state.detail);
    }
    if (state.kind === 'correct') {
      await queryRunner.query(`ALTER TABLE \`user\` DROP FOREIGN KEY \`${state.constraintName}\``);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS subject`);
    await queryRunner.query(`DROP TABLE IF EXISTS stage`);
    await queryRunner.query(`DROP TABLE IF EXISTS education_level`);
  }
}
