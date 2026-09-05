import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateProviderCredentialRequestSchema,
  ListProviderCredentialsQuerySchema,
  ListProviderDefinitionsQuerySchema,
  SetProviderDefinitionEnabledRequestSchema,
  UpdateProviderCredentialRequestSchema,
  type CreateProviderCredentialRequest,
  type ListProviderCredentialsQuery,
  type ListProviderDefinitionsQuery,
  type SetProviderDefinitionEnabledRequest,
  type UpdateProviderCredentialRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { IfMatch } from '../../../common/http/if-match.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { ListProviderDefinitionsUseCase } from '../application/list-provider-definitions.use-case';
import { SetProviderDefinitionEnabledUseCase } from '../application/set-provider-definition-enabled.use-case';
import { CreateProviderCredentialUseCase } from '../application/create-provider-credential.use-case';
import { ListProviderCredentialsUseCase } from '../application/list-provider-credentials.use-case';
import { UpdateProviderCredentialUseCase } from '../application/update-provider-credential.use-case';
import { DeleteProviderCredentialUseCase } from '../application/delete-provider-credential.use-case';
import { ProbeProviderCredentialUseCase } from '../application/probe-provider-credential.use-case';

/**
 * Global catalog surface (LLD §5.4). Read is open to any admin JWT; enabling
 * /disabling a built-in is operator-only (FR-PROVIDER-1).
 */
@Controller('provider-definitions')
@UseGuards(AdminJwtGuard, RolesGuard)
export class ProviderDefinitionsController {
  constructor(
    private readonly listDefinitions: ListProviderDefinitionsUseCase,
    private readonly setEnabled: SetProviderDefinitionEnabledUseCase,
  ) {}

  /** GET /api/provider-definitions */
  @Get()
  list(
    @Query(new TypeBoxValidationPipe(ListProviderDefinitionsQuerySchema, 'PROVIDER_UNKNOWN'))
    query: ListProviderDefinitionsQuery,
  ) {
    return this.listDefinitions.execute(query);
  }

  /** PATCH /api/provider-definitions/:key — operator only. */
  @Patch(':key')
  @Roles('operator')
  setEnabledRoute(
    @Param('key') key: string,
    @Body(new TypeBoxValidationPipe(SetProviderDefinitionEnabledRequestSchema, 'PROVIDER_UNKNOWN'))
    body: SetProviderDefinitionEnabledRequest,
  ) {
    return this.setEnabled.execute(key, body.enabled);
  }
}

/**
 * Per-tenant credential surface (LLD §5.4). Nested under `/tenants/:id` so
 * the global `TenantContextInterceptor` (reads `req.params.id`) scopes every
 * query automatically.
 */
@Controller('tenants/:id/provider-credentials')
@UseGuards(AdminJwtGuard, RolesGuard)
export class ProviderCredentialsController {
  constructor(
    private readonly createCredential: CreateProviderCredentialUseCase,
    private readonly listCredentials: ListProviderCredentialsUseCase,
    private readonly updateCredential: UpdateProviderCredentialUseCase,
    private readonly deleteCredential: DeleteProviderCredentialUseCase,
    private readonly probeCredential: ProbeProviderCredentialUseCase,
  ) {}

  /** GET /api/tenants/:id/provider-credentials */
  @Get()
  list(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Query(new TypeBoxValidationPipe(ListProviderCredentialsQuerySchema, 'PROVIDER_UNKNOWN'))
    query: ListProviderCredentialsQuery,
  ) {
    return this.listCredentials.execute(actor, tenantId, query);
  }

  /** POST /api/tenants/:id/provider-credentials */
  @Post()
  create(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(CreateProviderCredentialRequestSchema, 'PROVIDER_ENDPOINT_INVALID'))
    body: CreateProviderCredentialRequest,
  ) {
    return this.createCredential.execute(actor, tenantId, body);
  }

  /** PATCH /api/tenants/:id/provider-credentials/:credId */
  @Patch(':credId')
  update(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('credId') credId: string,
    @Body(new TypeBoxValidationPipe(UpdateProviderCredentialRequestSchema, 'PROVIDER_ENDPOINT_INVALID'))
    body: UpdateProviderCredentialRequest,
    @IfMatch() ifMatch: string,
  ) {
    return this.updateCredential.execute(actor, tenantId, credId, body, ifMatch);
  }

  /** DELETE /api/tenants/:id/provider-credentials/:credId */
  @Delete(':credId')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('credId') credId: string,
  ) {
    await this.deleteCredential.execute(actor, tenantId, credId);
  }

  /** POST /api/tenants/:id/provider-credentials/:credId/probe */
  @Post(':credId/probe')
  probe(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('credId') credId: string) {
    return this.probeCredential.execute(actor, tenantId, credId);
  }
}
