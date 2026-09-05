import { platformFetch } from './http-client';

/** Local mirror of `WorkHintDashboardRow` (server: `@/server/platform/reliability`). */
export interface WorkHintDashboardRow {
  kind: 'pdf_session' | 'outbox' | 'attempt_timeout';
  pendingCount: number;
}

/** Local mirror of `ReliabilityDashboardSnapshot` (server: `@/server/platform/reliability`'s
 * `getReliabilityDashboardSnapshot`). */
export interface ReliabilityDashboardSnapshot {
  outbox: { pending: number; delivered: number; deadLetter: number };
  fileCleanup: { due: number };
  workHints: WorkHintDashboardRow[];
  tenantsScanned: number;
}

/** `GET /api/platform/reliability`. */
export function getReliabilityDashboard(): Promise<ReliabilityDashboardSnapshot> {
  return platformFetch<ReliabilityDashboardSnapshot>('/api/platform/reliability', { method: 'GET' });
}
