/**
 * The port every module depends on to send an email — ported verbatim from
 * `legacy/api/src/tenancy/domain/ports/email.port.ts` (LLD §3 "EMAIL / PAYMENTS / CLOCK").
 * Framework- and vendor-free by construction — concrete implementations live under
 * `server/infrastructure/mail/**` (third-party SDKs confined to `infrastructure/`, per LLD §1.4's
 * boundary rule).
 *
 * **Never throws** (documented in the interface signature itself): a transient mail-provider outage
 * must never fail the business operation that triggered the email (e.g. provisioning's
 * `invite_admin` step) — the adapter is responsible for catching and logging its own failures
 * internally.
 */
export interface EmailPort {
  send(msg: { to: string; subject: string; html: string; text?: string }): Promise<void>;
}
