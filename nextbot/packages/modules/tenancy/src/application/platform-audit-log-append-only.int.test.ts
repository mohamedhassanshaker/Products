import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import { schema, generateId, loadDbEnv, getOwnerPool } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";

const insertedEntryIds: string[] = [];
afterEach(async () => {
  // `platform_audit_log_entry` is genuinely append-only for both the "app" and
  // "platform" roles (that's exactly what this file proves) — only the
  // schema-owner role (migrations/bootstrap only, never used by application code)
  // retains DELETE, so test-only cleanup uses it directly, mirroring
  // `deleteFixtureTenant`'s identical handling of `audit_log_entry`.
  for (const id of insertedEntryIds.splice(0)) {
    await getOwnerPool().query(`DELETE FROM platform_audit_log_entry WHERE id = $1`, [id]);
  }
});

/**
 * Security-review-required DB-level proof (Platform Manager console Phase 1,
 * NFR-11): `platform_audit_log_entry` must be genuinely append-only —
 * `UPDATE`/`DELETE` denied at the database privilege level for both the "app" and
 * "platform" roles (`ensure-roles.ts`), not merely "not called" at the application
 * layer. Connects directly with `pg` (bypassing Drizzle) so this proves the actual
 * grant, mirroring `audit-log-append-only.int.test.ts`'s identical proof for
 * `audit_log_entry`.
 */
describe("platform_audit_log_entry append-only grants (NFR-11 security review)", () => {
  it("the platform (BYPASSRLS) role can INSERT/SELECT but not UPDATE/DELETE", async () => {
    const entryId = generateId();
    await withPlatform(async (db) => {
      await db.insert(schema.platformAuditLogEntry).values({
        id: entryId,
        actorLabel: "test-actor",
        actionType: "test.action",
        targetTenantId: null,
        details: { note: "grant test" },
      });
    });
    insertedEntryIds.push(entryId);

    const env = loadDbEnv();
    const platformClient = new pg.Client({ connectionString: env.NEXTBOT_DB_PLATFORM_URL });
    await platformClient.connect();
    try {
      const selectResult = await platformClient.query(`SELECT id FROM platform_audit_log_entry WHERE id = $1`, [entryId]);
      expect(selectResult.rows).toHaveLength(1);

      await expect(
        platformClient.query(`UPDATE platform_audit_log_entry SET actor_label = 'tampered' WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/permission denied/i);

      await expect(
        platformClient.query(`DELETE FROM platform_audit_log_entry WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await platformClient.end();
    }
  });

  it("the app (non-BYPASSRLS) role also cannot UPDATE/DELETE (it can SELECT — no RLS restricts this table by design)", async () => {
    const entryId = generateId();
    await withPlatform(async (db) => {
      await db.insert(schema.platformAuditLogEntry).values({
        id: entryId,
        actorLabel: "test-actor",
        actionType: "test.action",
        targetTenantId: null,
        details: {},
      });
    });
    insertedEntryIds.push(entryId);

    const env = loadDbEnv();
    const appClient = new pg.Client({ connectionString: env.NEXTBOT_DB_APP_URL });
    await appClient.connect();
    try {
      await expect(
        appClient.query(`UPDATE platform_audit_log_entry SET actor_label = 'tampered' WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        appClient.query(`DELETE FROM platform_audit_log_entry WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await appClient.end();
    }
  });
});
