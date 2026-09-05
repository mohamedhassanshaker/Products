import { DataSource } from 'typeorm';
import type { EnvVars } from '@/server/config';
import { TENANT_MIGRATIONS } from '../migrations/tenant';
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
} from './entities';

/** All tenant-schema entities, shared verbatim across every tenant `DataSource` (HLD §4.3: "One
 * shared `EntityMetadata` set... only `database` and pool size differ"). Empty through sub-slice 1a
 * (`seed_rbac`/`seed_admin_user` used raw SQL — no repository-based consumer existed yet). Phase 1
 * sub-slice 1b (`auth`/`rbac`) added `UserEntity`/`RoleEntity`/`PermissionEntity`; sub-slice 1c added
 * the three `reliability`-owned tables (`OutboxMessageEntity`/`ProcessedEventEntity`/
 * `FileCleanupQueueEntity`); Phase 3 added the taxonomy entities (`EducationLevelEntity`/`StageEntity`/
 * `SubjectEntity`) and `CurriculumEntity` (ownership/metadata only — no `CurriculumDocumentEntity`
 * yet, see `docs/plans/nextjs-rewrite-phase3-plan.md`); Phase 4 adds the manual-ZIP exam-authoring
 * entities (`ExamTypeEntity`/`ExamModuleEntity`/`ExamTypeQuestionEntity` — no `ExamTypeCurriculumEntity`
 * yet, see `docs/plans/nextjs-rewrite-phase4-plan.md`'s judgment-call section) — this array is
 * append-only from here, matching
 * `legacy/api/src/infrastructure/database/tenant/tenant-data-source-factory.ts`'s own "later phases
 * append their own tenant-schema entities" convention. Phase 5 adds `AiCallLogEntity` (`ai_call_log`
 * cost/usage accounting, `server/ai`'s sole consumer). Phase 6 sub-slice "6a" adds
 * `PdfProcessingSessionEntity`/`GeneratedQuestionEntity` (`server/pdf-processing`'s sole consumers).
 * Sub-slice "6b" adds `CurriculumDocumentEntity` (closing Phase 3's own deferral — its two real
 * writers, Curriculum document ingestion and the Reference-indexing branch, both land in that
 * sub-slice) and `StoredImageEntity`/`QuestionImageEntity` (`server/media`'s sole consumers). Phase 7
 * adds `AttemptEntity`/`AttemptQuestionEntity` (`server/attempts`'s sole consumer). */
export const TENANT_ENTITIES: (new (...args: never[]) => object)[] = [
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
];

/** Builds a `DataSource` scoped to one tenant schema — never accepts anything other than a schema
 * name, which is what keeps "acquire a handle for a schema" and "run a query" structurally separate
 * (HLD §6.2-style chokepoint pattern applied to tenant data access). Ported from
 * `legacy/api/src/infrastructure/database/tenant/tenant-data-source-factory.ts`'s
 * `TenantDataSourceFactory` interface. */
export interface TenantDataSourceFactory {
  create(schemaName: string): Promise<DataSource>;
}

/**
 * The only concrete implementation of {@link TenantDataSourceFactory} — ported from
 * `legacy/api/src/infrastructure/database/tenant/tenant-data-source-factory.ts`'s
 * `MysqlTenantDataSourceFactory`, adapted from NestJS `@Injectable()`/constructor-injected config to
 * a plain class taking already-validated {@link EnvVars} (this app has no DI container — every
 * composition happens in each module's own barrel, per the migration plan's "plain-TypeScript module
 * boundary + ESLint rule" replacement for Nest's DI-enforced boundaries).
 *
 * Assumes `schemaName` already exists as a real MySQL schema — creating it is
 * `CreateSchemaStep`'s job; a missing schema surfaces as a connection failure from
 * `DataSource.initialize()`, propagated to the caller rather than swallowed.
 */
export class MysqlTenantDataSourceFactory implements TenantDataSourceFactory {
  constructor(private readonly env: EnvVars) {}

  async create(schemaName: string): Promise<DataSource> {
    if (this.env.DB_SYNCHRONIZE) {
      // Same belt-and-braces guard as the platform DataSource — never let a tenant schema silently
      // diverge via `synchronize`.
      throw new Error('TypeORM synchronize must never be enabled — refusing to build a DataSource.');
    }
    const dataSource = new DataSource({
      type: 'mysql',
      host: this.env.DB_HOST,
      port: this.env.DB_PORT,
      username: this.env.DB_USER,
      password: this.env.DB_PASSWORD,
      database: schemaName,
      charset: 'utf8mb4',
      poolSize: this.env.TENANT_POOL_MAX,
      entities: TENANT_ENTITIES,
      migrations: TENANT_MIGRATIONS,
      synchronize: false,
      migrationsRun: false,
      logging: false,
      extra: {
        enableKeepAlive: true,
        connectTimeout: 10_000,
      },
    });
    await dataSource.initialize();
    return dataSource;
  }
}
