import type { ProvisioningStepName } from '@examland/contracts';
import { createTenantDataSource } from '@/server/infrastructure/database';
import type { ProvisioningContext, ProvisioningStep } from '@/server/tenancy';

/** LLD §5.1's exact permission catalog, grouped for readability but seeded as a flat list — ported
 * verbatim from `legacy/api/src/tenancy/provisioning/steps/seed-rbac.step.ts`. The grouping only
 * affects the `group` column, used later by a Phase 2/RBAC-admin UI to render permission checkboxes
 * under a heading, never by authorization logic itself. */
const PERMISSIONS: { name: string; group: string; description: string }[] = [
  { name: 'users.read', group: 'Users', description: 'View users' },
  { name: 'users.create', group: 'Users', description: 'Create users' },
  { name: 'users.update', group: 'Users', description: 'Update users' },
  { name: 'users.delete', group: 'Users', description: 'Delete users' },
  { name: 'users.assign_roles', group: 'Users', description: 'Assign roles to users' },
  { name: 'roles.read', group: 'Roles', description: 'View roles' },
  { name: 'roles.create', group: 'Roles', description: 'Create roles' },
  { name: 'roles.update', group: 'Roles', description: 'Update roles' },
  { name: 'roles.delete', group: 'Roles', description: 'Delete roles' },
  { name: 'permissions.read', group: 'Permissions', description: 'View permissions' },
  { name: 'exams.read', group: 'Exams', description: 'View exam types' },
  { name: 'exams.create', group: 'Exams', description: 'Create exam types' },
  { name: 'exams.update', group: 'Exams', description: 'Update exam types' },
  { name: 'exams.delete', group: 'Exams', description: 'Delete exam types' },
  { name: 'exams.review', group: 'Exams', description: 'Review AI-generated questions' },
  { name: 'exams.finalize', group: 'Exams', description: 'Finalize a PDF pipeline session into an exam type' },
  { name: 'exams.remap_subjects', group: 'Exams', description: 'Remap generated questions to a different subject' },
  { name: 'taxonomy.read', group: 'Taxonomy', description: 'View taxonomy' },
  { name: 'taxonomy.create', group: 'Taxonomy', description: 'Create taxonomy entries' },
  { name: 'taxonomy.delete', group: 'Taxonomy', description: 'Delete taxonomy entries' },
  { name: 'curricula.read_all', group: 'Curricula', description: 'View every curriculum in the tenant' },
  { name: 'curricula.manage_own', group: 'Curricula', description: 'Manage curricula the user owns' },
  { name: 'attempts.take', group: 'Attempts', description: 'Start/take an exam attempt' },
  { name: 'attempts.read_own', group: 'Attempts', description: "View one's own attempts" },
  { name: 'attempts.read_all', group: 'Attempts', description: 'View every attempt in the tenant' },
  { name: 'pdf.upload', group: 'Pipeline', description: 'Upload a PDF for AI processing' },
  { name: 'pdf.review', group: 'Pipeline', description: 'Review a PDF processing session' },
  { name: 'billing.read', group: 'Billing', description: 'View billing/subscription information' },
  { name: 'tenant.settings.manage', group: 'Settings', description: 'Manage tenant registration/branding settings' },
  { name: 'billing.manage', group: 'Billing', description: 'Initiate a tenant-driven billing checkout / plan upgrade' },
];

/** LLD §5.1: "`Member` (`is_system=1`: `exams.read`, `attempts.take`, `attempts.read_own`,
 * `curricula.manage_own`, `taxonomy.read`, `pdf.upload`, `pdf.review`)". */
const MEMBER_PERMISSIONS = [
  'exams.read',
  'attempts.take',
  'attempts.read_own',
  'curricula.manage_own',
  'taxonomy.read',
  'pdf.upload',
  'pdf.review',
];

/**
 * HLD §4.4 step 3: seeds the LLD §5.1 permission catalog and the two seeded system roles (`Tenant
 * Admin` — every permission — and `Member` — the subset above) into the freshly-migrated tenant
 * schema — ported verbatim (logic unchanged) from
 * `legacy/api/src/tenancy/provisioning/steps/seed-rbac.step.ts`. Every write is `INSERT IGNORE`-based
 * (natural-key upsert), so re-running this step after a later step fails never duplicates a
 * permission/role/grant.
 */
export class SeedRbacStep implements ProvisioningStep {
  readonly name: ProvisioningStepName = 'seed_rbac';

  async run(ctx: ProvisioningContext): Promise<void> {
    const dataSource = await createTenantDataSource(ctx.tenant.schemaName);
    try {
      for (const permission of PERMISSIONS) {
        await dataSource.query('INSERT IGNORE INTO permission (name, description, `group`) VALUES (?, ?, ?)', [
          permission.name,
          permission.description,
          permission.group,
        ]);
      }

      await dataSource.query('INSERT IGNORE INTO role (name, description, is_system) VALUES (?, ?, 1)', [
        'Tenant Admin',
        'Full administrative access to this tenant.',
      ]);
      await dataSource.query('INSERT IGNORE INTO role (name, description, is_system) VALUES (?, ?, 1)', [
        'Member',
        'Standard member access: take exams, manage own curricula, use the AI pipeline.',
      ]);

      // Tenant Admin: every permission that currently exists — a cross join rather than re-listing
      // PERMISSIONS a second time, so the two lists can never silently drift apart.
      await dataSource.query(
        `INSERT IGNORE INTO role_permission (role_id, permission_id)
         SELECT r.id, p.id FROM role r JOIN permission p ON 1 = 1 WHERE r.name = 'Tenant Admin'`,
      );

      if (MEMBER_PERMISSIONS.length > 0) {
        const placeholders = MEMBER_PERMISSIONS.map(() => '?').join(', ');
        await dataSource.query(
          `INSERT IGNORE INTO role_permission (role_id, permission_id)
           SELECT r.id, p.id FROM role r JOIN permission p ON p.name IN (${placeholders})
           WHERE r.name = 'Member'`,
          MEMBER_PERMISSIONS,
        );
      }
    } finally {
      await dataSource.destroy();
    }
  }
}
