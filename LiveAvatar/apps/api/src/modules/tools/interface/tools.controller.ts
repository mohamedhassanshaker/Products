import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateToolRequestSchema,
  TestInvokeToolRequestSchema,
  UpdateToolRequestSchema,
  type CreateToolRequest,
  type TestInvokeToolRequest,
  type UpdateToolRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { IfMatch } from '../../../common/http/if-match.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { CreateToolUseCase } from '../application/create-tool.use-case';
import { GetToolUseCase } from '../application/get-tool.use-case';
import { ListToolsUseCase } from '../application/list-tools.use-case';
import { UpdateToolUseCase } from '../application/update-tool.use-case';
import { DeleteToolUseCase } from '../application/delete-tool.use-case';
import { TestInvokeToolUseCase } from '../application/test-invoke-tool.use-case';

/**
 * Tool registry HTTP surface (BL-033, `docs/v2/BACKLOG.md`). Nested under
 * `/tenants/:id` exactly like `deployment-config`/`provider-credentials` so
 * the global `TenantContextInterceptor` scopes every query correctly.
 */
@Controller('tenants/:id/tools')
@UseGuards(AdminJwtGuard, RolesGuard)
export class ToolsController {
  constructor(
    private readonly createTool: CreateToolUseCase,
    private readonly getTool: GetToolUseCase,
    private readonly listTools: ListToolsUseCase,
    private readonly updateTool: UpdateToolUseCase,
    private readonly deleteTool: DeleteToolUseCase,
    private readonly testInvokeTool: TestInvokeToolUseCase,
  ) {}

  /** GET /api/tenants/:id/tools */
  @Get()
  list(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.listTools.execute(actor, tenantId);
  }

  /** POST /api/tenants/:id/tools */
  @Post()
  create(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(CreateToolRequestSchema, 'TOOL_NAME_REQUIRED'))
    body: CreateToolRequest,
  ) {
    return this.createTool.execute(actor, tenantId, body);
  }

  /** GET /api/tenants/:id/tools/:toolId */
  @Get(':toolId')
  get(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('toolId') toolId: string) {
    return this.getTool.execute(actor, tenantId, toolId);
  }

  /** PATCH /api/tenants/:id/tools/:toolId */
  @Patch(':toolId')
  update(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('toolId') toolId: string,
    @Body(new TypeBoxValidationPipe(UpdateToolRequestSchema, 'TOOL_NAME_REQUIRED'))
    body: UpdateToolRequest,
    @IfMatch() ifMatch: string,
  ) {
    return this.updateTool.execute(actor, tenantId, toolId, body, ifMatch);
  }

  /** DELETE /api/tenants/:id/tools/:toolId */
  @Delete(':toolId')
  @HttpCode(204)
  async remove(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('toolId') toolId: string) {
    await this.deleteTool.execute(actor, tenantId, toolId);
  }

  /** POST /api/tenants/:id/tools/:toolId/test-invoke — always 200, ok:false on a tool-side failure. */
  @Post(':toolId/test-invoke')
  @HttpCode(200)
  testInvoke(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('toolId') toolId: string,
    @Body(new TypeBoxValidationPipe(TestInvokeToolRequestSchema, 'TOOL_NOT_FOUND'))
    body: TestInvokeToolRequest,
  ) {
    return this.testInvokeTool.execute(actor, tenantId, toolId, body);
  }
}
