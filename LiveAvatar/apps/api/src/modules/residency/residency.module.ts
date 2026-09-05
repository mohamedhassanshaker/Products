import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import { DeploymentConfigModule } from '../deployment-config';
import { ProvidersModule } from '../providers';
import { RESIDENCY_POLICY_REPOSITORY } from './domain/ports';
import { PrismaResidencyPolicyRepository } from './infrastructure/prisma-residency-policy.repository';
import { GetResidencyUseCase } from './application/get-residency.use-case';
import { UpdateResidencyUseCase } from './application/update-residency.use-case';
import { ResidencyController } from './interface/residency.controller';

/**
 * Data residency / privacy bounded context (FR-PRIV-1/2, Screen 8). Depends
 * one-directionally on `TenantsModule` (access checks), `DeploymentConfigModule`
 * (publish-gate: does the published config use a remote LLM), and
 * `ProvidersModule` (catalog `hosting` lookup for that same gate). Never
 * re-implements the runtime enforcement Phase 4's agent already does
 * (`residency/filter.py`) — this module only owns the policy record and the
 * publish-time gate.
 */
@Module({
  imports: [TenantsModule, DeploymentConfigModule, ProvidersModule],
  controllers: [ResidencyController],
  providers: [
    { provide: RESIDENCY_POLICY_REPOSITORY, useClass: PrismaResidencyPolicyRepository },
    GetResidencyUseCase,
    UpdateResidencyUseCase,
  ],
})
export class ResidencyModule {}
