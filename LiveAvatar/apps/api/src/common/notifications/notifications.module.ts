import { Module } from '@nestjs/common';
import { NOTIFICATION_PORT } from './notification.port';
import { InAppNotificationAdapter } from './in-app-notification.adapter';
import { EmailNotificationAdapter } from './email-notification.adapter';
import { NotificationDispatcherService } from './notification-dispatcher.service';

/** Genuinely new infra (Phase 14, BL-056) — see `notification.port.ts`'s doc comment. Imported by `HitlModule` and `JobsModule`'s deferred-followup processor. */
@Module({
  providers: [
    InAppNotificationAdapter,
    EmailNotificationAdapter,
    NotificationDispatcherService,
    { provide: NOTIFICATION_PORT, useExisting: NotificationDispatcherService },
  ],
  exports: [NOTIFICATION_PORT],
})
export class NotificationsModule {}
