import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import { TOOL_DEFINITION_REPOSITORY, TOOL_INVOKER } from './domain/ports';
import { PrismaToolDefinitionRepository } from './infrastructure/prisma-tool-definition.repository';
import { ToolInvokerService } from './infrastructure/tool-invoker.service';
import { CreateToolUseCase } from './application/create-tool.use-case';
import { GetToolUseCase } from './application/get-tool.use-case';
import { ListToolsUseCase } from './application/list-tools.use-case';
import { UpdateToolUseCase } from './application/update-tool.use-case';
import { DeleteToolUseCase } from './application/delete-tool.use-case';
import { TestInvokeToolUseCase } from './application/test-invoke-tool.use-case';
import { ToolsController } from './interface/tools.controller';

/**
 * `ToolDefinition` bounded context (FR-AGENT-2). Phase 8 (BL-033) upgrades
 * this from persistence-only providers (consumed by `deployment-config` and
 * `sessions`) to a full CRUD HTTP surface of its own — `TenantsModule` is now
 * imported directly (access-scoping checks) the same way `deployment-config`
 * and `providers` already depend on it.
 */
@Module({
  imports: [TenantsModule],
  controllers: [ToolsController],
  providers: [
    PrismaToolDefinitionRepository,
    { provide: TOOL_DEFINITION_REPOSITORY, useExisting: PrismaToolDefinitionRepository },
    ToolInvokerService,
    { provide: TOOL_INVOKER, useExisting: ToolInvokerService },
    CreateToolUseCase,
    GetToolUseCase,
    ListToolsUseCase,
    UpdateToolUseCase,
    DeleteToolUseCase,
    TestInvokeToolUseCase,
  ],
  // Phase 9 (BL-037): `TOOL_INVOKER` is also exported so the Test-call
  // harness (`deployment-config`'s `test-call-graph.use-case.ts`) can make
  // real Tool-node calls without re-implementing `ToolInvokerService`.
  exports: [TOOL_DEFINITION_REPOSITORY, TOOL_INVOKER],
})
export class ToolsModule {}
