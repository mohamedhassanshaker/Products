import { Module } from '@nestjs/common';
import { TENANT_REPOSITORY } from './domain/ports';
import { CreateTenantUseCase } from './application/create-tenant.use-case';
import { GetTenantUseCase } from './application/get-tenant.use-case';
import { ListTenantsUseCase } from './application/list-tenants.use-case';
import { UpdateTenantUseCase } from './application/update-tenant.use-case';
import { ChangeTenantStatusUseCase } from './application/change-tenant-status.use-case';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';
import { TenantsController } from './interface/tenants.controller';

/**
 * Tenant bounded context (FR-TENANT-1..5). Every tenant-scoped record created
 * on the platform hangs off a row here; `room_namespace` seeds the LiveKit
 * room prefix used from Phase 3 onward.
 */
@Module({
  controllers: [TenantsController],
  providers: [
    CreateTenantUseCase,
    GetTenantUseCase,
    ListTenantsUseCase,
    UpdateTenantUseCase,
    ChangeTenantStatusUseCase,
    PrismaTenantRepository,
    { provide: TENANT_REPOSITORY, useExisting: PrismaTenantRepository },
  ],
  exports: [TENANT_REPOSITORY],
})
export class TenantsModule {}
