/** `GpuNodeHeartbeat.role` (FR-GPU-1). */
export type GpuRole = 'stt' | 'tts' | 'avatar';

/** One GPU node's latest known heartbeat (FR-GPU-1). */
export interface GpuNodeRow {
  hostname: string;
  role: GpuRole;
  gpuUtilPct: number;
  memUtilPct: number;
  /** As reported by the node — `ListGpuNodesUseCase` overrides this to `false` when stale (FR-GPU-3). */
  healthy: boolean;
  autoscalerNote: string;
  reportedAt: Date;
}

/** `GpuNodeHeartbeat` persistence (FR-GPU-1/3). Not tenant-scoped — `tenantId` is nullable (shared pool). */
export interface GpuNodeRepositoryPort {
  recordHeartbeat(input: {
    hostname: string;
    role: GpuRole;
    gpuUtilPct: number;
    memUtilPct: number;
    healthy: boolean;
    tenantId: string | null;
    reportedAt: Date;
  }): Promise<void>;

  /** One row per hostname — the most recent heartbeat (FR-GPU-1's "per node" card). */
  listLatestPerHost(filter: { role?: GpuRole; tenantId?: string }): Promise<GpuNodeRow[]>;
}

export const GPU_NODE_REPOSITORY = Symbol('GPU_NODE_REPOSITORY');
