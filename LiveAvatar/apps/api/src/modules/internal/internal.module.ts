import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions';
import { TransportModule } from '../transport';
import { GpuModule } from '../gpu';
import { KnowledgeModule } from '../knowledge';
import { SkillsModule } from '../skills';
import { HitlModule } from '../hitl';
import { DeploymentConfigModule } from '../deployment-config';
import { InternalController } from './interface/internal.controller';
import { AgentInternalController } from './interface/agent-internal.controller';
import { KnowledgeInternalController } from './interface/knowledge-internal.controller';
import { SkillsInternalController } from './interface/skills-internal.controller';
import { HitlInternalController } from './interface/hitl-internal.controller';
import { SubAgentInternalController } from './interface/subagent-internal.controller';

/**
 * Interface-only module (LLD §3.1) mounted on the internal listener (`:8081`
 * via `InternalAppModule`/`main-internal.ts`). Composes `sessions` and
 * `transport` use cases/ports; owns no domain/application of its own.
 *
 * Two controllers, two auth mechanisms (LLD §5.9): `InternalController`'s
 * one route (the LiveKit webhook) authenticates via LiveKit's own HMAC
 * signature; `AgentInternalController`'s agent-facing routes (Phase 4,
 * BL-013..017, and Phase 7's `gpu-heartbeats` addition) are guarded by
 * `InternalTokenGuard` (`X-Internal-Token`). `GpuModule` is the
 * controller-free "core" half of the GPU bounded context (see its own
 * docstring) — importing it here cannot leak an admin-guarded route onto
 * this listener, unlike the pre-existing `ProvidersModule` finding.
 *
 * Phase 13 (BL-049/050/051) adds `SkillsModule`/`SkillsInternalController`
 * for the lazy skill-body fetch (`ARCHITECTURE_NOTES.md` §5.3) — same
 * `InternalTokenGuard` treatment as every other agent-facing route here.
 *
 * Phase 14 (BL-052/053) adds `HitlModule`/`HitlInternalController` for the
 * blocking-gate create/poll surface — deliberately wired here (not through
 * `SessionsModule`) so it never becomes another instance of the pre-existing
 * "every module in `SessionsModule`'s import graph leaks its controllers
 * onto this listener" architecture debt.
 *
 * Phase 15 (BL-058) adds `DeploymentConfigModule`/`SubAgentInternalController`
 * for the lazy sub-agent-persona fetch. `DeploymentConfigModule` is already
 * transitively reachable here via `SessionsModule` (for
 * `GetRuntimeConfigUseCase`'s own `DEPLOYMENT_CONFIG_REPOSITORY` need) —
 * pre-existing debt, not something this phase introduces — but Nest
 * requires the *exporting* use-case's module to be imported directly by
 * whatever module wires its controller, so it's imported again here
 * explicitly (a normal, supported pattern; Nest's DI treats a module
 * imported from two different parents as one singleton, not two).
 */
@Module({
  imports: [SessionsModule, TransportModule, GpuModule, KnowledgeModule, SkillsModule, HitlModule, DeploymentConfigModule],
  controllers: [
    InternalController,
    AgentInternalController,
    KnowledgeInternalController,
    SkillsInternalController,
    HitlInternalController,
    SubAgentInternalController,
  ],
})
export class InternalModule {}
