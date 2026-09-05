import type { DataSource } from 'typeorm';
import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { createPlatformDataSource } from './platform/platform-data-source';
import { ensureSchemaExists as ensureSchemaExistsInternal } from './ensure-schema-exists';
import { MysqlTenantDataSourceFactory, type TenantDataSourceFactory } from './tenant/tenant-data-source-factory';
import { TenantDataSourceRegistry, type TenantDataSourceRegistryStats } from './tenant/tenant-data-source-registry';
import {
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
} from './platform/entities';
import {
  UserEntity,
  RoleEntity,
  PermissionEntity,
  OutboxMessageEntity,
  ProcessedEventEntity,
  FileCleanupQueueEntity,
  EducationLevelEntity,
  StageEntity,
  SubjectEntity,
  CurriculumEntity,
  ExamTypeEntity,
  ExamModuleEntity,
  ExamTypeQuestionEntity,
  AiCallLogEntity,
  PdfProcessingSessionEntity,
  GeneratedQuestionEntity,
  CurriculumDocumentEntity,
  StoredImageEntity,
  QuestionImageEntity,
  ExamTypeCurriculumEntity,
  IdempotencyKeyEntity,
  AttemptEntity,
  AttemptQuestionEntity,
  PracticeSessionEntity,
  PracticeQuestionEntity,
} from './tenant/entities';
export type { PracticeQuestionSource, PracticeSessionKind, PracticeSessionStatus } from './tenant/entities';

/** Platform-schema entity classes, re-exported so a repository outside this module can call
 * `dataSource.getRepository(SomeEntity)` without deep-importing `./platform/entities/*` directly
 * (module-boundary rule) — the entity *classes* themselves are metadata/shape, not the kind of
 * internal implementation detail the barrel-only rule exists to hide (unlike, say,
 * `platform-data-source.ts`'s connection-construction logic). `ApprovedAiModelEntity` added Phase 2
 * sub-slice 2b. `AuditLogEntity`/`TenantWorkHintEntity` added Phase 2 sub-slice "2d".
 * `VectorCollectionMetaEntity` added Phase 5 (`server/vector`'s drift guard). */
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
};
/** Tenant-schema entity classes (Phase 1 sub-slice 1b), re-exported for the identical reason —
 * `auth`/`rbac`'s repositories call `dataSource.getRepository(UserEntity)` etc. without
 * deep-importing `./tenant/entities/*` directly. */
export { UserEntity, RoleEntity, PermissionEntity };
/** Reliability tenant-schema entities (Phase 1 sub-slice 1c), re-exported for the identical reason —
 * `server/reliability`'s repositories need these classes only as `Repository<T>` *type* parameters
 * (every runtime lookup uses the literal table-name string, per the cross-webpack-bundle fix). */
export { OutboxMessageEntity, ProcessedEventEntity, FileCleanupQueueEntity };
/** Taxonomy/curriculum tenant-schema entities (Phase 3), re-exported for the identical reason —
 * `server/taxonomy`/`server/curricula`'s repositories need these classes only as `Repository<T>` type
 * parameters (every runtime lookup uses the literal table-name string, per the cross-webpack-bundle
 * fix). */
export { EducationLevelEntity, StageEntity, SubjectEntity, CurriculumEntity };
/** Exam-authoring tenant-schema entities (Phase 4), re-exported for the identical reason —
 * `server/exam-authoring`'s repository needs these classes only as `Repository<T>` type parameters
 * (every runtime lookup uses the literal table-name string, per the cross-webpack-bundle fix). */
export { ExamTypeEntity, ExamModuleEntity, ExamTypeQuestionEntity };
/** AI cost/usage accounting tenant-schema entity (Phase 5), re-exported for the identical reason —
 * `server/ai`'s `AiCallLogRepository` needs this class only as a `Repository<T>` type parameter
 * (every runtime lookup uses the literal table-name string, per the cross-webpack-bundle fix). */
export { AiCallLogEntity };
/** PDF-processing tenant-schema entities (Phase 6, sub-slice "6a"), re-exported for the identical
 * reason — `server/pdf-processing`'s repositories/domain types need these classes only as
 * `Repository<T>` type parameters or type-only signature references (every runtime lookup uses the
 * literal table-name string, per the cross-webpack-bundle fix). */
export { PdfProcessingSessionEntity, GeneratedQuestionEntity };
/** Curriculum-document + media tenant-schema entities (Phase 6, sub-slice "6b"), re-exported for the
 * identical reason — `server/curricula`'s document ingestion, `server/pdf-processing`'s
 * Reference-indexing branch, and `server/media`'s image repositories need these classes only as
 * `Repository<T>` type parameters or `new`-able row shapes (every runtime lookup uses the literal
 * table-name string, per the cross-webpack-bundle fix). */
export { CurriculumDocumentEntity, StoredImageEntity, QuestionImageEntity };
/** `exam_type_curriculum`/`idempotency_key` tenant-schema entities (Phase 6, sub-slice "6c"),
 * re-exported for the identical reason — `server/pdf-processing`'s finalize/append repositories need
 * these classes only as `Repository<T>` type parameters or `new`-able row shapes (every runtime lookup
 * uses the literal table-name string, per the cross-webpack-bundle fix). */
export { ExamTypeCurriculumEntity, IdempotencyKeyEntity };
/** Attempt tenant-schema entities (Phase 7), re-exported for the identical reason —
 * `server/attempts`'s repository (and `server/exam-authoring`'s `hasActiveAttempts` cross-module read)
 * need these classes only as `Repository<T>` type parameters or `new`-able row shapes (every runtime
 * lookup uses the literal table-name string, per the cross-webpack-bundle fix). */
export { AttemptEntity, AttemptQuestionEntity };
export { PracticeSessionEntity, PracticeQuestionEntity };
export type { TenantDataSourceRegistryStats };
/** Platform-schema entity-adjacent type aliases (Phase 2 sub-slice "2d"), re-exported for the
 * identical "entity metadata/shape, not internal implementation detail" reason as the entity classes
 * above — `server/platform/audit`/`server/platform/reliability` need these as plain type imports. */
export type { AuditActorType } from './platform/entities/audit-log.entity';
export type { TenantWorkHintKind } from './platform/entities/tenant-work-hint.entity';

/**
 * `server/infrastructure/database`'s public barrel. Every consumer gets the platform `DataSource`
 * through {@link getPlatformDataSource} — nothing outside this module may import
 * `./platform/platform-data-source` (or any other internal file under this module) directly (enforced
 * by `apps/next/.eslintrc.cjs`'s `database` module-boundary rule, widened this dispatch to a
 * recursive glob so it also protects the new `tenant/`/`migrations/`/`platform/entities` subfolders —
 * see `docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made" for why the single-segment
 * pattern Phase 0 shipped needed fixing once this module gained nested subfolders).
 *
 * Cached on `globalThis`, not a plain module-level variable — see this file's own history (Phase 0)
 * for the Next.js dev-mode hot-reload rationale, which applies identically to every singleton below.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandPlatformDataSource: Promise<DataSource> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandTenantDataSourceRegistry: TenantDataSourceRegistry | undefined;
}

/**
 * Returns the initialized, process-wide platform `DataSource`, creating (and `initialize()`-ing) it
 * on first call. Concurrent first-callers all await the same in-flight promise (no duplicate
 * `DataSource`/connection-pool construction race).
 *
 * @throws Whatever `DataSource.initialize()` throws (e.g. connection refused, auth failure) —
 *   callers decide how to handle a platform DB that is genuinely unreachable; this function does not
 *   swallow or retry.
 */
export function getPlatformDataSource(): Promise<DataSource> {
  if (!globalThis.__examlandPlatformDataSource) {
    const env = getEnv();
    globalThis.__examlandPlatformDataSource = createPlatformDataSource(env)
      .initialize()
      .then((ds) => {
        logger.info({ schema: env.DB_PLATFORM_SCHEMA }, 'platform_datasource.connected');
        return ds;
      })
      .catch((err: unknown) => {
        // Do not leave a rejected promise cached — the next caller should get a fresh attempt
        // rather than a permanently-poisoned singleton (e.g. MySQL was briefly down at boot).
        globalThis.__examlandPlatformDataSource = undefined;
        throw err;
      });
  }
  return globalThis.__examlandPlatformDataSource;
}

/** Idempotently ensures a MySQL schema exists (`CREATE DATABASE IF NOT EXISTS`) — the sole consumer
 * this dispatch is `CreateSchemaStep` (HLD §4.4 step 1). Re-exported from the barrel rather than
 * letting callers import `./ensure-schema-exists` directly (module-boundary rule). */
export function ensureSchemaExists(opts: {
  host: string;
  port: number;
  user: string;
  password?: string;
  schema: string;
}): Promise<void> {
  return ensureSchemaExistsInternal(opts);
}

/**
 * Builds a brand-new, **short-lived** tenant `DataSource` (LLD §8.2: "`run_migrations` uses a
 * short-lived `DataSource`, not the request registry, so provisioning never consumes a resident
 * slot") — the caller is responsible for calling `.destroy()` when done. Used by
 * `RunMigrationsStep`/`SeedRbacStep`/`SeedAdminUserStep`, exactly as legacy's identically-scoped
 * steps use `TENANT_DATASOURCE_FACTORY` directly rather than the pooled registry.
 *
 * @throws Whatever `DataSource.initialize()` throws (e.g. the schema doesn't exist yet, connection
 *   refused) — never swallowed.
 */
export function createTenantDataSource(schemaName: string): Promise<DataSource> {
  const factory: TenantDataSourceFactory = new MysqlTenantDataSourceFactory(getEnv());
  return factory.create(schemaName);
}

/**
 * Returns the process-wide, pooled {@link TenantDataSourceRegistry} singleton (HLD §4.3, LLD §9.1) —
 * ported from `legacy/api/src/infrastructure/database/tenant/tenant-data-source-registry.ts`, this
 * app's replacement for that class's NestJS `@Injectable()` lifecycle. No request-scoped consumer
 * exists yet (tenant-resolution middleware is a later Phase 1 sub-dispatch); this dispatch's only
 * caller is `TenantsService` (`destroyFor` on suspend/reactivate/soft-delete).
 */
export function getTenantDataSourceRegistry(): TenantDataSourceRegistry {
  if (!globalThis.__examlandTenantDataSourceRegistry) {
    const env = getEnv();
    const factory: TenantDataSourceFactory = new MysqlTenantDataSourceFactory(env);
    globalThis.__examlandTenantDataSourceRegistry = new TenantDataSourceRegistry(factory, env, logger);
  }
  return globalThis.__examlandTenantDataSourceRegistry;
}
