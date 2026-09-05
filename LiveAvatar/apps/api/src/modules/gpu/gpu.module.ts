import { Module } from '@nestjs/common';
import { GPU_NODE_REPOSITORY } from './domain/ports';
import { PrismaGpuNodeRepository } from './infrastructure/prisma-gpu-node.repository';
import { RecordGpuHeartbeatUseCase } from './application/record-gpu-heartbeat.use-case';
import { ListGpuNodesUseCase } from './application/list-gpu-nodes.use-case';

/**
 * GPU/node health bounded context (FR-GPU-1/2/3). Deliberately has **no
 * controllers of its own** — this is the "core module" half of a
 * core/interface split (mirroring the fix recommended for `ProvidersModule`
 * in the Phase-6 F-1 decision-log finding): `InternalModule` imports this
 * module directly to reach `RecordGpuHeartbeatUseCase` from
 * `AgentInternalController` (an `X-Internal-Token`-guarded route, already
 * correctly scoped to the `:8081` listener only), while the admin-facing
 * `GET /gpu/nodes` route lives in the separate `GpuAdminModule`, imported
 * only by `AppModule`. Because this module has zero controllers, importing
 * it from either app can never leak a route onto the wrong origin.
 */
@Module({
  providers: [
    { provide: GPU_NODE_REPOSITORY, useClass: PrismaGpuNodeRepository },
    RecordGpuHeartbeatUseCase,
    ListGpuNodesUseCase,
  ],
  exports: [RecordGpuHeartbeatUseCase, ListGpuNodesUseCase],
})
export class GpuModule {}
