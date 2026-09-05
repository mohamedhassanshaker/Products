import { randomUUID } from 'node:crypto';
import type { ProvisioningStepName } from '@examland/contracts';
import { createTenantDataSource } from '@/server/infrastructure/database';
import type { ProvisioningContext, ProvisioningStep } from '@/server/tenancy';

/**
 * HLD §4.4 step 4: `INSERT User(adminEmail, passwordHash=NULL) + UserRole(Tenant Admin)` — ported
 * verbatim from `legacy/api/src/tenancy/provisioning/steps/seed-admin-user.step.ts`. The created user
 * has no usable password (`password_hash IS NULL`) — they authenticate for the first time via the
 * invite link `invite_admin` "sends" (the real password-set-via-token flow is the `auth` module's
 * job, a later Phase 1 sub-dispatch).
 *
 * Idempotent: looks the user up by email first (the tenant-unique `uq_user_email` key) rather than
 * blindly inserting, so a retry after a later step failed never creates a second admin user or a
 * duplicate `user_role` grant.
 *
 * First/last name are seeded with a placeholder (`Tenant`/`Admin`) since FR-MT-4 only names email as
 * a required provisioning input.
 */
export class SeedAdminUserStep implements ProvisioningStep {
  readonly name: ProvisioningStepName = 'seed_admin_user';

  async run(ctx: ProvisioningContext): Promise<void> {
    if (!ctx.adminEmail) {
      // Defensive assertion (should never happen — `TenantProvisioningService` persists
      // `pendingAdminEmail` before the first step ever runs).
      throw new Error(
        'Cannot seed the tenant admin user: no adminEmail is recorded for this tenant. This should never happen.',
      );
    }

    const dataSource = await createTenantDataSource(ctx.tenant.schemaName);
    try {
      const existing: { id: string }[] = await dataSource.query('SELECT id FROM `user` WHERE email = ? LIMIT 1', [
        ctx.adminEmail,
      ]);

      const userId = existing[0]?.id ?? randomUUID();
      if (existing.length === 0) {
        await dataSource.query(
          'INSERT INTO `user` (id, email, first_name, last_name, password_hash, is_active) VALUES (?, ?, ?, ?, NULL, 1)',
          [userId, ctx.adminEmail, 'Tenant', 'Admin'],
        );
      }

      await dataSource.query(
        `INSERT IGNORE INTO user_role (user_id, role_id)
         SELECT ?, r.id FROM role r WHERE r.name = 'Tenant Admin'`,
        [userId],
      );
    } finally {
      await dataSource.destroy();
    }
  }
}
