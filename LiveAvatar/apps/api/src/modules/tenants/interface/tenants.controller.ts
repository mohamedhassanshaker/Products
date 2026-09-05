import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ChangeTenantStatusRequestSchema,
  CreateTenantRequestSchema,
  ListTenantsQuerySchema,
  UpdateTenantRequestSchema,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { IfMatch } from '../../../common/http/if-match.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { CreateTenantUseCase } from '../application/create-tenant.use-case';
import { GetTenantUseCase } from '../application/get-tenant.use-case';
import { ListTenantsUseCase } from '../application/list-tenants.use-case';
import { UpdateTenantUseCase } from '../application/update-tenant.use-case';
import { ChangeTenantStatusUseCase } from '../application/change-tenant-status.use-case';

/**
 * Tenant HTTP surface (LLD §5.3). All routes require an admin JWT;
 * `AdminJwtGuard` + `RolesGuard` are applied per-route to keep the create
 * route operator-only while list/get/patch/status are open to any assigned
 * admin (the use cases themselves enforce assignment scoping).
 */
@Controller('tenants')
@UseGuards(AdminJwtGuard, RolesGuard)
export class TenantsController {
  constructor(
    private readonly createTenant: CreateTenantUseCase,
    private readonly getTenant: GetTenantUseCase,
    private readonly listTenants: ListTenantsUseCase,
    private readonly updateTenant: UpdateTenantUseCase,
    private readonly changeStatus: ChangeTenantStatusUseCase,
  ) {}

  /** POST /api/tenants — operator only (FR-TENANT-1). */
  @Post()
  @Roles('operator')
  create(
    @Body(new TypeBoxValidationPipe(CreateTenantRequestSchema, 'TENANT_NAME_INVALID'))
    body: { name: string; slug: string; status?: 'active' | 'paused' },
  ) {
    return this.createTenant.execute(body);
  }

  /** GET /api/tenants — Screen 3 list (FR-TENANT-2). */
  @Get()
  list(
    @CurrentUser() actor: AdminActor,
    @Query(new TypeBoxValidationPipe(ListTenantsQuerySchema, 'PAGE_SIZE_INVALID'))
    query: { q?: string; status?: 'active' | 'paused'; page?: number; page_size?: number },
  ) {
    return this.listTenants.execute(actor, query);
  }

  /** GET /api/tenants/:id */
  @Get(':id')
  get(@CurrentUser() actor: AdminActor, @Param('id') id: string) {
    return this.getTenant.execute(actor, id);
  }

  /** PATCH /api/tenants/:id — name only; slug is immutable. */
  @Patch(':id')
  update(
    @CurrentUser() actor: AdminActor,
    @Param('id') id: string,
    @Body(new TypeBoxValidationPipe(UpdateTenantRequestSchema, 'TENANT_NAME_INVALID'))
    body: { name?: string; slug?: string },
    @IfMatch() ifMatch: string,
  ) {
    return this.updateTenant.execute(actor, id, body, ifMatch);
  }

  /** POST /api/tenants/:id/status — pause/activate (FR-TENANT-4). */
  @Post(':id/status')
  changeTenantStatus(
    @CurrentUser() actor: AdminActor,
    @Param('id') id: string,
    @Body(new TypeBoxValidationPipe(ChangeTenantStatusRequestSchema, 'TENANT_STATUS_INVALID'))
    body: { status: 'active' | 'paused' },
  ) {
    return this.changeStatus.execute(actor, id, body);
  }
}
