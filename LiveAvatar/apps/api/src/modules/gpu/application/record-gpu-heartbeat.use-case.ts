import { Inject, Injectable } from '@nestjs/common';
import type { GpuHeartbeatRequest } from '@liveavatar/contracts';
import { GPU_NODE_REPOSITORY, type GpuNodeRepositoryPort } from '../domain/ports';

/**
 * `POST /internal/gpu-heartbeats` (FR-GPU-3). Payload shape is already
 * TypeBox-validated by the controller pipe (`400 GPU_HEARTBEAT_INVALID`) —
 * this use case only persists.
 */
@Injectable()
export class RecordGpuHeartbeatUseCase {
  constructor(@Inject(GPU_NODE_REPOSITORY) private readonly nodes: GpuNodeRepositoryPort) {}

  /** @param request - `{hostname, role, gpu_util_pct, mem_util_pct, healthy, tenant_id?, reported_at}` */
  async execute(request: GpuHeartbeatRequest): Promise<void> {
    await this.nodes.recordHeartbeat({
      hostname: request.hostname,
      role: request.role,
      gpuUtilPct: request.gpu_util_pct,
      memUtilPct: request.mem_util_pct,
      healthy: request.healthy,
      tenantId: request.tenant_id ?? null,
      reportedAt: new Date(request.reported_at),
    });
  }
}
