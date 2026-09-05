import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the identity/RBAC tables in every tenant schema (LLD §5 DDL): `user`, `role`, `permission`,
 * `user_role`, `role_permission` — ported verbatim from `legacy/api/src/infrastructure/database/
 * migrations/tenant/1730000000002-create-rbac-tables.ts`. This dispatch's `seed_rbac`/
 * `seed_admin_user` provisioning steps are this migration's only consumer so far; the real
 * `User`/`Role`/`Permission` *application* layers (entities, services, DTOs, guards) belong to the
 * `auth`/`rbac`/`users` modules — later Phase 1 sub-dispatches, deliberately out of this dispatch's
 * scope. Until then these tables are written/read via raw SQL (matching HLD §4.4's own sequence
 * diagram), which is why `TENANT_ENTITIES` stays empty this dispatch (see
 * `tenant-data-source-factory.ts`'s own doc comment).
 *
 * **Forward reference, documented**: `user.education_level_id` is declared here as a plain nullable
 * `INT` with **no** foreign key to `education_level` — that table doesn't exist until the Taxonomy
 * phase (migration plan Phase 3). The LLD §5 DDL's `fk_user_edu` constraint is added by that phase's
 * own migration once `education_level` exists; adding it here would fail immediately (no such table).
 */
export class CreateRbacTables20260815000001 implements MigrationInterface {
  name = 'CreateRbacTables20260815000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user\` (
        id CHAR(36) NOT NULL,
        email VARCHAR(320) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name  VARCHAR(100) NOT NULL,
        password_hash VARCHAR(100) NULL,
        phone VARCHAR(40) NULL, occupation VARCHAR(150) NULL, company_name VARCHAR(200) NULL,
        country VARCHAR(100) NULL, education_level_id INT NULL,
        pic VARCHAR(512) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        password_reset_token_hash CHAR(64) NULL,
        password_reset_token_expiry DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        last_login_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_user_email (email),
        KEY ix_user_reset (password_reset_token_hash),
        KEY ix_user_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE role (
        id INT NOT NULL AUTO_INCREMENT, name VARCHAR(100) NOT NULL, description VARCHAR(300) NULL,
        is_system TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id), UNIQUE KEY uq_role_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE permission (
        id INT NOT NULL AUTO_INCREMENT, name VARCHAR(100) NOT NULL, description VARCHAR(300) NULL,
        \`group\` VARCHAR(50) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id), UNIQUE KEY uq_perm_name (name), KEY ix_perm_group (\`group\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE user_role (
        user_id CHAR(36) NOT NULL, role_id INT NOT NULL,
        PRIMARY KEY (user_id, role_id), KEY ix_ur_role (role_id),
        CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE,
        CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES role(id)   ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE role_permission (
        role_id INT NOT NULL, permission_id INT NOT NULL,
        PRIMARY KEY (role_id, permission_id), KEY ix_rp_perm (permission_id),
        CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES role(id) ON DELETE CASCADE,
        CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE role_permission`);
    await queryRunner.query(`DROP TABLE user_role`);
    await queryRunner.query(`DROP TABLE permission`);
    await queryRunner.query(`DROP TABLE role`);
    await queryRunner.query(`DROP TABLE \`user\``);
  }
}
