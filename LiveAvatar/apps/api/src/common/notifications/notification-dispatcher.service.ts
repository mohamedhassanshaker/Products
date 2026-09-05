import { Injectable } from '@nestjs/common';
import type { NotificationMessage, NotificationPort } from './notification.port';
import { InAppNotificationAdapter } from './in-app-notification.adapter';
import { EmailNotificationAdapter } from './email-notification.adapter';

/** Routes a `NotificationMessage` to the adapter for its `channel` — the single thing bound to `NOTIFICATION_PORT`. */
@Injectable()
export class NotificationDispatcherService implements NotificationPort {
  constructor(
    private readonly inApp: InAppNotificationAdapter,
    private readonly email: EmailNotificationAdapter,
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    const adapter = message.channel === 'email' ? this.email : this.inApp;
    await adapter.send(message);
  }
}
