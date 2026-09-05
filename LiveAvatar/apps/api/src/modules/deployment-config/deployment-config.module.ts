import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import { ProvidersModule } from '../providers';
import { ToolsModule } from '../tools';
import { KnowledgeModule } from '../knowledge';
import { SkillsModule } from '../skills';
import { HitlModule } from '../hitl';
import { DEPLOYMENT_CONFIG_REPOSITORY, CONFIG_VERSION_REPOSITORY } from './domain/ports';
import { GetConfigUseCase } from './application/get-config.use-case';
import { ValidateConfigUseCase } from './application/validate-config.use-case';
import { SaveConfigUseCase } from './application/save-config.use-case';
import { ListConfigVersionsUseCase } from './application/list-config-versions.use-case';
import { GetConfigVersionDiffUseCase } from './application/get-config-version-diff.use-case';
import { RollbackConfigVersionUseCase } from './application/rollback-config-version.use-case';
import { TestCallGraphUseCase } from './application/test-call-graph.use-case';
import { RunRetrievalPlaygroundUseCase } from './application/run-retrieval-playground.use-case';
import { GetSubAgentPersonaUseCase } from './application/get-subagent-persona.use-case';
import { PrismaDeploymentConfigRepository } from './infrastructure/prisma-deployment-config.repository';
import { PrismaConfigVersionRepository } from './infrastructure/prisma-config-version.repository';
import { DeploymentConfigController } from './interface/deployment-config.controller';
import { KnowledgePlaygroundController } from './interface/knowledge-playground.controller';

/**
 * Agent Builder / deployment-config bounded context (FR-CONFIG-1..5,
 * FR-PROVIDER-5). Depends on `TenantsModule` (access checks),
 * `ProvidersModule` (catalog + credential reads for Gate B), and
 * `ToolsModule` (tool-ref checks + Phase 9's Test-call harness Tool-node
 * calls, `TOOL_INVOKER`).
 *
 * Phase 9 (BL-035) folds `ConfigVersion` list/diff/rollback and the
 * Test-call harness into this module rather than a new bounded context —
 * both are config-lifecycle concerns, per `ARCHITECTURE_NOTES.md` §2.
 *
 * Phase 12b (BL-045/047) adds `KnowledgeModule` — `ValidateConfigUseCase`
 * needs `KNOWLEDGE_SOURCE_REPOSITORY` to populate V-9's live staleness
 * check. `KnowledgeModule` has no dependency back on this module, so this
 * stays a one-directional import (same shape as `ToolsModule`'s).
 *
 * Phase 13 (BL-049/050/051) adds `SkillsModule` — `ValidateConfigUseCase`
 * needs `SKILL_REPOSITORY` for V-11 (skill description token cost) and
 * V-12 (`skillRefsKnownAndEnabledRule`). `SkillsModule` never imports this
 * module back (its own "used by N agents" read goes straight to
 * `PrismaService`, not through `DEPLOYMENT_CONFIG_REPOSITORY` — see
 * `PrismaSkillRepository`'s doc comment for why), so this stays
 * one-directional too.
 *
 * Phase 14 (BL-052..057) adds `HitlModule` — `ValidateConfigUseCase` needs
 * `HITL_GATE_REPOSITORY` for V-6/V-7 (`combination-rules.ts`'s
 * `consequentialToolGatedOrAckedRule`/`blockingGateReviewerCoverageRule`/
 * `hitlGateRefsKnownRule`). Same one-directional shape as `SkillsModule`.
 *
 * Phase 15 (BL-058, V-3) — `ValidateConfigUseCase` reads *another* tenant's
 * `DeploymentConfig` directly via its own already-injected
 * `DEPLOYMENT_CONFIG_REPOSITORY` (no new module dependency: this codebase
 * has no separate "Agent" entity, so a Sub-agent's "target" is just another
 * row in the same table this module already owns). `GetSubAgentPersonaUseCase`
 * is exported (not its own controller) for `InternalModule`'s new
 * `SubAgentInternalController` to consume — the same "export the use-case,
 * not the controller" precedent `SkillsModule`/`HitlModule` already set.
 */
@Module({
  imports: [TenantsModule, ProvidersModule, ToolsModule, KnowledgeModule, SkillsModule, HitlModule],
  controllers: [DeploymentConfigController, KnowledgePlaygroundController],
  providers: [
    GetConfigUseCase,
    ValidateConfigUseCase,
    SaveConfigUseCase,
    ListConfigVersionsUseCase,
    GetConfigVersionDiffUseCase,
    RollbackConfigVersionUseCase,
    TestCallGraphUseCase,
    RunRetrievalPlaygroundUseCase,
    GetSubAgentPersonaUseCase,
    PrismaDeploymentConfigRepository,
    { provide: DEPLOYMENT_CONFIG_REPOSITORY, useExisting: PrismaDeploymentConfigRepository },
    PrismaConfigVersionRepository,
    { provide: CONFIG_VERSION_REPOSITORY, useExisting: PrismaConfigVersionRepository },
  ],
  exports: [DEPLOYMENT_CONFIG_REPOSITORY, GetSubAgentPersonaUseCase],
})
export class DeploymentConfigModule {}
