import { Body, Controller, Get, HttpCode, Param, Put, Post, Query, UseGuards } from '@nestjs/common';
import {
  SaveConfigRequestSchema,
  ValidateConfigRequestSchema,
  TestCallRequestSchema,
  type SaveConfigRequest,
  type ValidateConfigRequest,
  type TestCallRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AppError } from '../../../common/errors/app-error';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { IfMatch } from '../../../common/http/if-match.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { GetConfigUseCase } from '../application/get-config.use-case';
import { ValidateConfigUseCase } from '../application/validate-config.use-case';
import { SaveConfigUseCase } from '../application/save-config.use-case';
import { ListConfigVersionsUseCase } from '../application/list-config-versions.use-case';
import { GetConfigVersionDiffUseCase } from '../application/get-config-version-diff.use-case';
import { RollbackConfigVersionUseCase } from '../application/rollback-config-version.use-case';
import { TestCallGraphUseCase } from '../application/test-call-graph.use-case';

/**
 * Agent Builder HTTP surface (LLD §5.5). Nested under `/tenants/:id` so the
 * global `TenantContextInterceptor` scopes every query to this tenant.
 *
 * Phase 9 (BL-035, BL-037) adds the `ConfigVersion` read/rollback routes
 * and the Test-call harness route — same `AdminJwtGuard`/`RolesGuard`/
 * tenant-scoping pattern as every route above them.
 */
@Controller('tenants/:id/config')
@UseGuards(AdminJwtGuard, RolesGuard)
export class DeploymentConfigController {
  constructor(
    private readonly getConfig: GetConfigUseCase,
    private readonly validateConfig: ValidateConfigUseCase,
    private readonly saveConfig: SaveConfigUseCase,
    private readonly listVersions: ListConfigVersionsUseCase,
    private readonly getVersionDiff: GetConfigVersionDiffUseCase,
    private readonly rollbackVersion: RollbackConfigVersionUseCase,
    private readonly testCall: TestCallGraphUseCase,
  ) {}

  /** GET /api/tenants/:id/config */
  @Get()
  get(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.getConfig.execute(actor, tenantId);
  }

  /**
   * POST /api/tenants/:id/config/validate — always 200; validity is in the
   * body (FR-CONFIG-4). Explicit `@HttpCode(200)` needed — Nest defaults an
   * unannotated `@Post` to 201, which contradicts this documented contract
   * (same latent bug class Phase 8 found and fixed on `tools/test-invoke`;
   * caught here by this phase's own e2e run, not by any prior unit test —
   * those exercise the use-case directly and never see the real decorator-
   * driven status code).
   */
  @Post('validate')
  @HttpCode(200)
  validate(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(ValidateConfigRequestSchema, 'CONFIG_YAML_PARSE'))
    body: ValidateConfigRequest,
  ) {
    return this.validateConfig.execute(actor, tenantId, body);
  }

  /** PUT /api/tenants/:id/config — draft or published (FR-CONFIG-3). */
  @Put()
  save(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(SaveConfigRequestSchema, 'CONFIG_YAML_PARSE'))
    body: SaveConfigRequest,
    @IfMatch() ifMatch: string,
  ) {
    return this.saveConfig.execute(actor, tenantId, body, ifMatch);
  }

  /** GET /api/tenants/:id/config/versions (Phase 9, BL-035). */
  @Get('versions')
  listConfigVersions(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.listVersions.execute(actor, tenantId);
  }

  /** GET /api/tenants/:id/config/versions/diff?from=N&to=M (Phase 9, BL-035). */
  @Get('versions/diff')
  getConfigVersionDiff(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const fromNum = Number(from);
    const toNum = Number(to);
    if (!Number.isInteger(fromNum) || !Number.isInteger(toNum) || fromNum < 1 || toNum < 1) {
      throw AppError.notFound('CONFIG_VERSION_NOT_FOUND');
    }
    return this.getVersionDiff.execute(actor, tenantId, fromNum, toNum);
  }

  /**
   * POST /api/tenants/:id/config/versions/:versionNumber/rollback (Phase 9,
   * BL-035) — creates a new draft, never auto-publishes.
   */
  @Post('versions/:versionNumber/rollback')
  rollbackConfigVersion(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('versionNumber') versionNumber: string) {
    const version = Number(versionNumber);
    if (!Number.isInteger(version) || version < 1) {
      throw AppError.notFound('CONFIG_VERSION_NOT_FOUND');
    }
    return this.rollbackVersion.execute(actor, tenantId, version);
  }

  /**
   * POST /api/tenants/:id/config/test-call (Phase 9, BL-037 shared
   * Test-call harness) — always 200, `ok:false` on failure, same
   * `@HttpCode(200)` fix and rationale as `validate` above.
   */
  @Post('test-call')
  @HttpCode(200)
  runTestCall(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(TestCallRequestSchema, 'CONFIG_YAML_PARSE'))
    body: TestCallRequest,
  ) {
    return this.testCall.execute(actor, tenantId, body);
  }
}
