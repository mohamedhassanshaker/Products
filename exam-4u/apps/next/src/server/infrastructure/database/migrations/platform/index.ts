import { CreateTenantTable20260815000001 } from './20260815000001-create-tenant-table';
import { CreateTenantProvisioningStepTable20260815000002 } from './20260815000002-create-tenant-provisioning-step-table';
import { CreatePackageTable20260815000003 } from './20260815000003-create-package-table';
import { CreateTenantSubscriptionTable20260815000004 } from './20260815000004-create-tenant-subscription-table';
import { CreateFeatureTable20260815000005 } from './20260815000005-create-feature-table';
import { CreatePackageFeatureTable20260815000006 } from './20260815000006-create-package-feature-table';
import { SeedFeaturePackageCatalog20260815000007 } from './20260815000007-seed-feature-package-catalog';
import { CreatePlatformAdminTable20260815000008 } from './20260815000008-create-platform-admin-table';
import { CreateApprovedAiModelTable20260815000009 } from './20260815000009-create-approved-ai-model-table';
import { SeedApprovedAiModelDefault20260815000010 } from './20260815000010-seed-approved-ai-model-default';
import { AddFkTenantAssignedAiModel20260815000011 } from './20260815000011-add-fk-tenant-assigned-ai-model';
import { CreateAuditLogTable20260815000012 } from './20260815000012-create-audit-log-table';
import { CreateTenantWorkHintTable20260815000013 } from './20260815000013-create-tenant-work-hint-table';
import { CreateVectorCollectionMetaTable20260815000014 } from './20260815000014-create-vector-collection-meta-table';
import { CreateTenantFeatureUsageTable20260815000015 } from './20260815000015-create-tenant-feature-usage-table';

/**
 * The platform migration set (migration plan Phase 1 + Phase 2 + Phase 5 + the post-Phase-10-e2e
 * closure dispatch). Order matters (TypeORM runs migrations in array order, and FK dependencies
 * require it): `tenant` before `tenant_provisioning_step` (FK) and before `tenant_subscription` (FK);
 * `package` before `tenant_subscription` (FK) and before `package_feature` (FK); `feature` before
 * `package_feature` (FK); the catalog seed after those; `platform_admin` (sub-slice 1b) has no FK
 * dependency on anything above. `approved_ai_model` (Phase 2 sub-slice 2b, FR-AI-2) must run before its
 * own seed and before the FK migration that references it — `tenant`'s `assigned_ai_model_id` column/
 * index already exist from `CreateTenantTable` (a documented forward reference), so only the FK
 * constraint itself is added here, once the target table exists. `audit_log`/`tenant_work_hint` (Phase
 * 2 sub-slice "2d") have no FK dependency on anything above (see each entity's own doc comment for why
 * both are deliberately unconstrained), so they're appended at the end. `vector_collection_meta`
 * (Phase 5) has no FK dependency on anything above either (a natural-keyed, standalone bookkeeping
 * table), so it's appended next-to-last. `tenant_feature_usage` (the post-Phase-10-e2e closure
 * dispatch that ports `platform/usage` — FR-PKG-5) references both `tenant` and `feature`, both of
 * which already exist by this point in the array, so it's appended last.
 *
 * Deliberately does **not** include `tenant_migration_run(_item)`/`worker_heartbeat` — those belong to
 * a later phase per the migration plan's own phase sequence, not this dispatch's scope.
 */
export const PLATFORM_MIGRATIONS = [
  CreateTenantTable20260815000001,
  CreateTenantProvisioningStepTable20260815000002,
  CreatePackageTable20260815000003,
  CreateTenantSubscriptionTable20260815000004,
  CreateFeatureTable20260815000005,
  CreatePackageFeatureTable20260815000006,
  SeedFeaturePackageCatalog20260815000007,
  CreatePlatformAdminTable20260815000008,
  CreateApprovedAiModelTable20260815000009,
  SeedApprovedAiModelDefault20260815000010,
  AddFkTenantAssignedAiModel20260815000011,
  CreateAuditLogTable20260815000012,
  CreateTenantWorkHintTable20260815000013,
  CreateVectorCollectionMetaTable20260815000014,
  CreateTenantFeatureUsageTable20260815000015,
];
