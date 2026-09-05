import { Injectable } from '@nestjs/common';

/** Liveness payload for GET /api/health. */
export interface HealthResult {
  status: 'ok';
}

/**
 * Platform liveness. Does not open a DB connection — process up is enough
 * for the Phase 1 probe; readiness can be added later.
 */
@Injectable()
export class HealthService {
  /** @returns Static ok payload */
  getHealth(): HealthResult {
    return { status: 'ok' };
  }
}
