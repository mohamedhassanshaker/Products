import { TenantEntity } from './tenant.entity';
import { TenantProvisioningStepEntity } from './tenant-provisioning-step.entity';
import { PackageEntity } from './package.entity';
import { FeatureEntity } from './feature.entity';
import { PackageFeatureEntity } from './package-feature.entity';
import { TenantSubscriptionEntity } from './tenant-subscription.entity';
import { PlatformAdminEntity } from './platform-admin.entity';
import { ApprovedAiModelEntity } from './approved-ai-model.entity';
import { AuditLogEntity } from './audit-log.entity';
import { TenantWorkHintEntity } from './tenant-work-hint.entity';
import { VectorCollectionMetaEntity } from './vector-collection-meta.entity';
import { TenantFeatureUsageEntity } from './tenant-feature-usage.entity';

export {
  TenantEntity,
  TenantProvisioningStepEntity,
  PackageEntity,
  FeatureEntity,
  PackageFeatureEntity,
  TenantSubscriptionEntity,
  PlatformAdminEntity,
  ApprovedAiModelEntity,
  AuditLogEntity,
  TenantWorkHintEntity,
  VectorCollectionMetaEntity,
  TenantFeatureUsageEntity,
};

/**
 * Every platform-schema entity, in no particular order (unlike `PLATFORM_MIGRATIONS`, TypeORM's
 * `entities` array has no ordering requirement). Mirrors
 * `legacy/api/src/infrastructure/database/tenant/tenant-data-source-factory.ts`'s `TENANT_ENTITIES`
 * append-only-list convention, applied here to the platform `DataSource`. `PlatformAdminEntity` added
 * Phase 1 sub-slice 1b. `ApprovedAiModelEntity` added Phase 2 sub-slice 2b (FR-AI-2 allowlist).
 * `AuditLogEntity`/`TenantWorkHintEntity` added Phase 2 sub-slice "2d" (`platform/audit`,
 * `platform/reliability`). `VectorCollectionMetaEntity` added Phase 5 (`server/vector`'s embedding
 * model/dims drift guard). `TenantFeatureUsageEntity` added by the post-Phase-10-e2e closure dispatch
 * that ported `platform/usage` (FR-PKG-5's feature-usage-limit enforcement engine, confirmed absent by
 * Phase 10's own e2e validation pass — see `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Post-e2e
 * closure" section).
 */
export const PLATFORM_ENTITIES: (new (...args: never[]) => object)[] = [
  TenantEntity,
  TenantProvisioningStepEntity,
  PackageEntity,
  FeatureEntity,
  PackageFeatureEntity,
  TenantSubscriptionEntity,
  PlatformAdminEntity,
  ApprovedAiModelEntity,
  AuditLogEntity,
  TenantWorkHintEntity,
  VectorCollectionMetaEntity,
  TenantFeatureUsageEntity,
];
