import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage, NotificationPort } from './notification.port';

/**
 * `in_app` channel (Phase 14, BL-056). Deliberately **not** a persisted
 * notification inbox: the two surfaces an in-app HITL notification actually
 * needs to reach — the reviewer console's queue and the caller's own call
 * page — already derive their state directly from `HitlDecision`/the
 * `/hitl/queue` endpoint via polling (`UX_SCOPE.md`'s own "same short-poll
 * mechanism, no websocket needed" design). A separate notification-inbox
 * table would duplicate that state for no consumer this phase has. This
 * adapter's real job is the structured log line for observability/audit —
 * `markOutcomeNotified` (called by whoever invokes this port) is what
 * actually records "this outcome was delivered" on the `HitlDecision` row
 * itself. Revisit if product feedback wants a real notification center.
 */
@Injectable()
export class InAppNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(InAppNotificationAdapter.name);

  async send(message: NotificationMessage): Promise<void> {
    this.logger.log(`HITL_NOTIFICATION_IN_APP subject="${message.subject}"`);
  }
}
