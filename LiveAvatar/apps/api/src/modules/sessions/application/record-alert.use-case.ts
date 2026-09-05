import { Inject, Injectable } from '@nestjs/common';
import type { AlertRequest } from '@liveavatar/contracts';
import { ALERT_REPOSITORY, type AlertRepositoryPort } from '../domain/telemetry-ports';

/**
 * `POST /internal/alerts` (FR-ALERT-1..3). No session context — alerts are
 * tenant-scoped, not session-scoped (e.g. `provider_unreachable` can fire
 * outside any single call).
 */
@Injectable()
export class RecordAlertUseCase {
  constructor(@Inject(ALERT_REPOSITORY) private readonly alerts: AlertRepositoryPort) {}

  /** @param request - `{tenant_id, type, message}` */
  async execute(request: AlertRequest): Promise<void> {
    await this.alerts.create({ tenantId: request.tenant_id, type: request.type, message: request.message });
  }
}
