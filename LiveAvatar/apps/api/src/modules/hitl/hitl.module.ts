import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TenantsModule } from '../tenants';
import { ToolsModule } from '../tools';
import { NotificationsModule } from '../../common/notifications/notifications.module';
import {
  REVIEWER_GROUP_REPOSITORY,
  HITL_GATE_REPOSITORY,
  HITL_DECISION_REPOSITORY,
  HITL_DEFERRED_FOLLOWUP_QUEUE,
  HITL_DEFERRED_FOLLOWUP_QUEUE_PORT,
} from './domain/ports';
import { PrismaReviewerGroupRepository } from './infrastructure/prisma-reviewer-group.repository';
import { PrismaHitlGateRepository } from './infrastructure/prisma-hitl-gate.repository';
import { PrismaHitlDecisionRepository } from './infrastructure/prisma-hitl-decision.repository';
import { HitlDeferredFollowupQueueProducer } from './infrastructure/hitl-deferred-followup-queue.producer';
import { CreateReviewerGroupUseCase } from './application/create-reviewer-group.use-case';
import { ListReviewerGroupsUseCase } from './application/list-reviewer-groups.use-case';
import { UpdateReviewerGroupUseCase } from './application/update-reviewer-group.use-case';
import { DeleteReviewerGroupUseCase } from './application/delete-reviewer-group.use-case';
import { CreateHitlGateUseCase } from './application/create-hitl-gate.use-case';
import { ListHitlGatesUseCase } from './application/list-hitl-gates.use-case';
import { GetHitlGateUseCase } from './application/get-hitl-gate.use-case';
import { UpdateHitlGateUseCase } from './application/update-hitl-gate.use-case';
import { DeleteHitlGateUseCase } from './application/delete-hitl-gate.use-case';
import { ListHitlQueueUseCase } from './application/list-hitl-queue.use-case';
import { DecideHitlDecisionUseCase } from './application/decide-hitl-decision.use-case';
import { CreateHitlDecisionUseCase } from './application/create-hitl-decision.use-case';
import { GetHitlDecisionUseCase } from './application/get-hitl-decision.use-case';
import { HitlController } from './interface/hitl.controller';

/**
 * `ReviewerGroup`/`HitlGate`/`HitlDecision` bounded context (Phase 14,
 * BL-052/053/054/055/056/057), mirroring `SkillsModule`'s shape. Imports
 * `ToolsModule` for `TOOL_DEFINITION_REPOSITORY` (V-6/V-8's
 * consequential-tool lookups) — same one-directional precedent
 * `SkillsModule` already sets by importing `ToolsModule` for its own
 * tool-ref validation.
 *
 * `CreateHitlDecisionUseCase`/`GetHitlDecisionUseCase` are exported (not
 * their own controller) for `InternalModule`'s `HitlInternalController` to
 * consume directly — the exact "export the use-case, not the controller"
 * precedent `SkillsModule` already sets for `GetSkillBodyUseCase`, chosen
 * specifically so this module's own agent-facing route never accidentally
 * leaks onto the internal `:8081` listener via some other module's import
 * graph (the architecture debt flagged against `SessionsModule` — this
 * module is never imported by `SessionsModule` at all).
 */
@Module({
  imports: [TenantsModule, ToolsModule, NotificationsModule, BullModule.registerQueue({ name: HITL_DEFERRED_FOLLOWUP_QUEUE })],
  controllers: [HitlController],
  providers: [
    PrismaReviewerGroupRepository,
    { provide: REVIEWER_GROUP_REPOSITORY, useExisting: PrismaReviewerGroupRepository },
    PrismaHitlGateRepository,
    { provide: HITL_GATE_REPOSITORY, useExisting: PrismaHitlGateRepository },
    PrismaHitlDecisionRepository,
    { provide: HITL_DECISION_REPOSITORY, useExisting: PrismaHitlDecisionRepository },
    HitlDeferredFollowupQueueProducer,
    { provide: HITL_DEFERRED_FOLLOWUP_QUEUE_PORT, useExisting: HitlDeferredFollowupQueueProducer },
    CreateReviewerGroupUseCase,
    ListReviewerGroupsUseCase,
    UpdateReviewerGroupUseCase,
    DeleteReviewerGroupUseCase,
    CreateHitlGateUseCase,
    ListHitlGatesUseCase,
    GetHitlGateUseCase,
    UpdateHitlGateUseCase,
    DeleteHitlGateUseCase,
    ListHitlQueueUseCase,
    DecideHitlDecisionUseCase,
    CreateHitlDecisionUseCase,
    GetHitlDecisionUseCase,
  ],
  exports: [
    HITL_GATE_REPOSITORY,
    HITL_DECISION_REPOSITORY,
    REVIEWER_GROUP_REPOSITORY,
    HITL_DEFERRED_FOLLOWUP_QUEUE_PORT,
    CreateHitlDecisionUseCase,
    GetHitlDecisionUseCase,
  ],
})
export class HitlModule {}
