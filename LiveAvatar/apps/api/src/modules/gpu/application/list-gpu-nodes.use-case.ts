import { Inject, Injectable } from '@nestjs/common';
import type { ListGpuNodesQuery, ListGpuNodesResponse } from '@liveavatar/contracts';
import { GPU_NODE_REPOSITORY, type GpuNodeRepositoryPort } from '../domain/ports';

/** A heartbeat older than this is treated as unhealthy regardless of its own payload (FR-GPU-3). */
const STALE_AFTER_MS = 60 * 1000;

/**
 * `GET /gpu/nodes` (FR-GPU-1/2, Screen 6). Read-only, monitoring-only — no
 * endpoint anywhere exposes a scale action (FR-GPU-2); this use case has
 * nothing to do with the autoscaler beyond echoing back its display note.
 */
@Injectable()
export class ListGpuNodesUseCase {
  constructor(@Inject(GPU_NODE_REPOSITORY) private readonly nodes: GpuNodeRepositoryPort) {}

  /** @param query - `{role?, tenant_id?}` */
  async execute(query: ListGpuNodesQuery): Promise<ListGpuNodesResponse> {
    const rows = await this.nodes.listLatestPerHost({ role: query.role, tenantId: query.tenant_id });
    const items = rows.map((row) => {
      const stale = Date.now() - row.reportedAt.getTime() > STALE_AFTER_MS;
      return {
        hostname: row.hostname,
        role: row.role,
        gpu_util_pct: row.gpuUtilPct,
        mem_util_pct: row.memUtilPct,
        healthy: stale ? false : row.healthy,
        last_heartbeat_at: row.reportedAt.toISOString(),
        autoscaler: (row.autoscalerNote === 'external' ? 'external' : 'not_configured') as 'external' | 'not_configured',
      };
    });
    return { items, total: items.length };
  }
}
