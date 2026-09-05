/** A single outcome notification (BL-056: "in-app/email outcome notification" — v1 ships these two channels only; SMS is BL-077, permanently deferred). */
export interface NotificationMessage {
  channel: 'in_app' | 'email';
  /** Required for `channel: 'email'`; ignored for `in_app`. */
  address?: string;
  subject: string;
  body: string;
}

/**
 * Genuinely new infrastructure (Phase 14, BL-052/056) — no notification
 * channel of any kind existed anywhere in this codebase before this phase
 * (`ARCHITECTURE_NOTES.md` §6.3). Two adapters implement this: `in_app`
 * (`InAppNotificationAdapter`) and `email` (`EmailNotificationAdapter`).
 */
export interface NotificationPort {
  send(message: NotificationMessage): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
