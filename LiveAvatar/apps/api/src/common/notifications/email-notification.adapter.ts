import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage, NotificationPort } from './notification.port';

/**
 * `email` channel (Phase 14, BL-056). No email-sending library or SMTP
 * config exists anywhere in this codebase (checked before adding a new
 * dependency — see the plan doc). Rather than bake in one specific ESP's
 * SDK, this posts to an operator-configured transactional-email webhook
 * (`EMAIL_WEBHOOK_URL` + `EMAIL_WEBHOOK_TOKEN`) via plain `fetch` — the same
 * "plain HTTP call, no vendor SDK" style `ToolInvokerService` already uses
 * for its own outbound calls — letting ops wire whatever real provider
 * (SendGrid, Postmark, SES, ...) sits behind that webhook without this
 * codebase taking on a vendor-specific dependency. When unconfigured (local
 * dev, this phase's own tests), it logs and no-ops rather than throwing —
 * an unset notification channel must never break the HITL flow it's
 * reporting on.
 */
@Injectable()
export class EmailNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(EmailNotificationAdapter.name);

  async send(message: NotificationMessage): Promise<void> {
    if (!message.address) {
      this.logger.warn('HITL_NOTIFICATION_EMAIL_NO_ADDRESS');
      return;
    }
    const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
    if (!webhookUrl) {
      this.logger.warn('HITL_NOTIFICATION_EMAIL_UNCONFIGURED');
      return;
    }
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EMAIL_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: message.address, subject: message.subject, body: message.body }),
      });
    } catch {
      // Never let a notification-delivery failure surface as a HITL flow
      // failure — the decision itself is already durably recorded; a lost
      // notification is a delivery-quality concern, not a correctness one.
      this.logger.warn(`HITL_NOTIFICATION_EMAIL_FAILED address=${message.address}`);
    }
  }
}
