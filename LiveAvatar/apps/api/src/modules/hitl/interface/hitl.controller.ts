import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateHitlGateRequestSchema,
  CreateReviewerGroupRequestSchema,
  DecideHitlDecisionRequestSchema,
  UpdateHitlGateRequestSchema,
  UpdateReviewerGroupRequestSchema,
  type CreateHitlGateRequest,
  type CreateReviewerGroupRequest,
  type DecideHitlDecisionRequest,
  type UpdateHitlGateRequest,
  type UpdateReviewerGroupRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { CreateReviewerGroupUseCase } from '../application/create-reviewer-group.use-case';
import { ListReviewerGroupsUseCase } from '../application/list-reviewer-groups.use-case';
import { UpdateReviewerGroupUseCase } from '../application/update-reviewer-group.use-case';
import { DeleteReviewerGroupUseCase } from '../application/delete-reviewer-group.use-case';
import { CreateHitlGateUseCase } from '../application/create-hitl-gate.use-case';
import { ListHitlGatesUseCase } from '../application/list-hitl-gates.use-case';
import { GetHitlGateUseCase } from '../application/get-hitl-gate.use-case';
import { UpdateHitlGateUseCase } from '../application/update-hitl-gate.use-case';
import { DeleteHitlGateUseCase } from '../application/delete-hitl-gate.use-case';
import { ListHitlQueueUseCase } from '../application/list-hitl-queue.use-case';
import { DecideHitlDecisionUseCase } from '../application/decide-hitl-decision.use-case';

/**
 * HITL config + reviewer-queue HTTP surface (Phase 14, BL-052/054/055).
 * Nested under `/tenants/:id` exactly like `skills`/`tools` so the global
 * `TenantContextInterceptor` scopes every query correctly. The reviewer
 * console (admin frontend) is its own top-level route/nav entry
 * (`UX_SCOPE.md`) but still calls these same tenant-scoped endpoints — v1
 * has no separate "reviewer" auth role, only tenant-membership + reviewer-
 * group-membership checks (see `DecideHitlDecisionUseCase`).
 */
@Controller('tenants/:id/hitl')
@UseGuards(AdminJwtGuard, RolesGuard)
export class HitlController {
  constructor(
    private readonly createReviewerGroup: CreateReviewerGroupUseCase,
    private readonly listReviewerGroups: ListReviewerGroupsUseCase,
    private readonly updateReviewerGroup: UpdateReviewerGroupUseCase,
    private readonly deleteReviewerGroup: DeleteReviewerGroupUseCase,
    private readonly createGate: CreateHitlGateUseCase,
    private readonly listGates: ListHitlGatesUseCase,
    private readonly getGate: GetHitlGateUseCase,
    private readonly updateGate: UpdateHitlGateUseCase,
    private readonly deleteGate: DeleteHitlGateUseCase,
    private readonly listQueue: ListHitlQueueUseCase,
    private readonly decideDecision: DecideHitlDecisionUseCase,
  ) {}

  @Get('reviewer-groups')
  listGroups(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.listReviewerGroups.execute(actor, tenantId);
  }

  @Post('reviewer-groups')
  createGroup(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(CreateReviewerGroupRequestSchema, 'HITL_REVIEWER_GROUP_NAME_REQUIRED'))
    body: CreateReviewerGroupRequest,
  ) {
    return this.createReviewerGroup.execute(actor, tenantId, body);
  }

  @Patch('reviewer-groups/:groupId')
  updateGroup(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('groupId') groupId: string,
    @Body(new TypeBoxValidationPipe(UpdateReviewerGroupRequestSchema, 'HITL_REVIEWER_GROUP_NAME_REQUIRED'))
    body: UpdateReviewerGroupRequest,
  ) {
    return this.updateReviewerGroup.execute(actor, tenantId, groupId, body);
  }

  @Delete('reviewer-groups/:groupId')
  @HttpCode(204)
  async removeGroup(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('groupId') groupId: string) {
    await this.deleteReviewerGroup.execute(actor, tenantId, groupId);
  }

  @Get('gates')
  listGatesRoute(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.listGates.execute(actor, tenantId);
  }

  @Post('gates')
  createGateRoute(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(CreateHitlGateRequestSchema, 'HITL_GATE_INCOMPLETE'))
    body: CreateHitlGateRequest,
  ) {
    return this.createGate.execute(actor, tenantId, body);
  }

  @Get('gates/:gateId')
  getGateRoute(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('gateId') gateId: string) {
    return this.getGate.execute(actor, tenantId, gateId);
  }

  @Patch('gates/:gateId')
  updateGateRoute(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('gateId') gateId: string,
    @Body(new TypeBoxValidationPipe(UpdateHitlGateRequestSchema, 'HITL_GATE_INCOMPLETE'))
    body: UpdateHitlGateRequest,
  ) {
    return this.updateGate.execute(actor, tenantId, gateId, body);
  }

  @Delete('gates/:gateId')
  @HttpCode(204)
  async removeGate(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('gateId') gateId: string) {
    await this.deleteGate.execute(actor, tenantId, gateId);
  }

  /** `GET /tenants/:id/hitl/queue` — the reviewer console's pending queue (BL-055). */
  @Get('queue')
  queue(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.listQueue.execute(actor, tenantId);
  }

  /** `POST /tenants/:id/hitl/decisions/:decisionId/decide` — approve, deny, or edit-and-approve (R-H6). */
  @Post('decisions/:decisionId/decide')
  decide(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('decisionId') decisionId: string,
    @Body(new TypeBoxValidationPipe(DecideHitlDecisionRequestSchema, 'INTERNAL_PAYLOAD_INVALID'))
    body: DecideHitlDecisionRequest,
  ) {
    return this.decideDecision.execute(actor, tenantId, decisionId, body);
  }
}
