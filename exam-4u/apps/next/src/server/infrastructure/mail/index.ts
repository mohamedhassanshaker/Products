import type pino from 'pino';
import type { EmailPort } from '@/server/tenancy';
import { NoopEmailAdapter } from './noop.adapter';
import { escapeHtml, renderBrandedEmail, type BrandedEmailInput } from './branded-email.template';

export { escapeHtml, renderBrandedEmail };
export type { BrandedEmailInput };

/**
 * `server/infrastructure/mail`'s public barrel. Nothing outside this module may import
 * `./noop.adapter`/`./branded-email.template` directly (enforced by `apps/next/.eslintrc.cjs`'s
 * `mail` module-boundary rule).
 *
 * {@link createEmailPort} is the composition point that decides *which* concrete {@link EmailPort}
 * implementation the rest of the app gets — today always {@link NoopEmailAdapter} (no real SMTP
 * config/adapter exists yet this dispatch; see `noop.adapter.ts`'s own doc comment). Swapping in a
 * real SMTP adapter later only changes this one function's body.
 */
export function createEmailPort(logger: pino.Logger): EmailPort {
  return new NoopEmailAdapter(logger);
}
