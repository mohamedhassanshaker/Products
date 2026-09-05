import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import {
  PROBE_RATE_LIMITER,
  PROBE_STRATEGY,
  PROVIDER_CREDENTIAL_REPOSITORY,
  PROVIDER_DEFINITION_REPOSITORY,
  PUBLISHED_CONFIG_LOOKUP,
} from './domain/ports';
import { ListProviderDefinitionsUseCase } from './application/list-provider-definitions.use-case';
import { SetProviderDefinitionEnabledUseCase } from './application/set-provider-definition-enabled.use-case';
import { CreateProviderCredentialUseCase } from './application/create-provider-credential.use-case';
import { ListProviderCredentialsUseCase } from './application/list-provider-credentials.use-case';
import { UpdateProviderCredentialUseCase } from './application/update-provider-credential.use-case';
import { DeleteProviderCredentialUseCase } from './application/delete-provider-credential.use-case';
import { ProbeProviderCredentialUseCase } from './application/probe-provider-credential.use-case';
import { PrismaProviderDefinitionRepository } from './infrastructure/prisma-provider-definition.repository';
import { PrismaProviderCredentialRepository } from './infrastructure/prisma-provider-credential.repository';
import { PrismaPublishedConfigLookup } from './infrastructure/prisma-published-config-lookup';
import { HttpProbeStrategy } from './infrastructure/http-probe-strategy';
import { RedisProbeRateLimiter } from './infrastructure/redis-probe-rate-limiter';
import {
  ProviderCredentialsController,
  ProviderDefinitionsController,
} from './interface/providers.controller';

/**
 * Provider catalog + per-tenant registry bounded context (FR-PROVIDER-1..7).
 * `TenantsModule` is imported for the tenant-assignment access checks every
 * credential use case performs.
 */
@Module({
  imports: [TenantsModule],
  controllers: [ProviderDefinitionsController, ProviderCredentialsController],
  providers: [
    ListProviderDefinitionsUseCase,
    SetProviderDefinitionEnabledUseCase,
    CreateProviderCredentialUseCase,
    ListProviderCredentialsUseCase,
    UpdateProviderCredentialUseCase,
    DeleteProviderCredentialUseCase,
    ProbeProviderCredentialUseCase,
    PrismaProviderDefinitionRepository,
    PrismaProviderCredentialRepository,
    PrismaPublishedConfigLookup,
    HttpProbeStrategy,
    RedisProbeRateLimiter,
    { provide: PROVIDER_DEFINITION_REPOSITORY, useExisting: PrismaProviderDefinitionRepository },
    { provide: PROVIDER_CREDENTIAL_REPOSITORY, useExisting: PrismaProviderCredentialRepository },
    { provide: PUBLISHED_CONFIG_LOOKUP, useExisting: PrismaPublishedConfigLookup },
    { provide: PROBE_STRATEGY, useExisting: HttpProbeStrategy },
    { provide: PROBE_RATE_LIMITER, useExisting: RedisProbeRateLimiter },
  ],
  exports: [PROVIDER_DEFINITION_REPOSITORY, PROVIDER_CREDENTIAL_REPOSITORY, PROBE_STRATEGY],
})
export class ProvidersModule {}
