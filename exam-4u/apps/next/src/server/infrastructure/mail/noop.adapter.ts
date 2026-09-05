import type pino from 'pino';
import type { EmailPort } from '@/server/tenancy';

/**
 * The default {@link EmailPort} implementation until a real SMTP adapter lands (ported from
 * `legacy/api/src/infrastructure/mail/noop.adapter.ts` — that app's identical placeholder before
 * Dev-7/BL-07 added `smtp.adapter.ts`). Every `send()` is logged (so an invite is still observable
 * in the log file) and always resolves successfully, honoring the port's "never throws" contract by
 * construction rather than by a try/catch that could still leak a rejection.
 *
 * Used by this dispatch's `InviteAdminStep`: a freshly-provisioned tenant's admin invite is "sent"
 * through this adapter, not a real mailbox, until whichever later phase adds real SMTP delivery
 * (verified password-recovery email needs it too — deferred alongside `auth`, matching legacy's own
 * multi-phase gap between provisioning and real SMTP landing).
 */
export class NoopEmailAdapter implements EmailPort {
  constructor(private readonly logger: pino.Logger) {}

  async send(msg: { to: string; subject: string; html: string; text?: string }): Promise<void> {
    // Deliberately does not log `html`/`text` bodies (could contain a future password-reset token) —
    // only routing metadata, matching the "never log a secret" spirit even though this adapter sends
    // nothing real yet.
    this.logger.info({ to: msg.to, subject: msg.subject }, 'mail.noop_send');
  }
}
