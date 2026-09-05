import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ListGpuNodesQuerySchema, type ListGpuNodesQuery } from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { ListGpuNodesUseCase } from '../application/list-gpu-nodes.use-case';

/**
 * Admin-facing GPU health surface (LLD §5.7, Screen 6). Lives in a separate
 * module from `GpuModule` (see that module's docstring) so this
 * `AdminJwtGuard`-guarded route is only ever mounted on the public `:8080`
 * app, never on the internal `:8081` listener.
 */
@Controller('gpu')
@UseGuards(AdminJwtGuard, RolesGuard)
export class GpuController {
  constructor(private readonly listGpuNodes: ListGpuNodesUseCase) {}

  /** GET /api/gpu/nodes */
  @Get('nodes')
  nodes(@Query(new TypeBoxValidationPipe(ListGpuNodesQuerySchema, 'PAGE_SIZE_INVALID')) query: ListGpuNodesQuery) {
    return this.listGpuNodes.execute(query);
  }
}
