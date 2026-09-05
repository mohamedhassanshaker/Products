import type { ProvisioningStepName } from '@examland/contracts';
import { getEnv } from '@/server/config';
import { escapeHtml, renderBrandedEmail } from '@/server/infrastructure/mail';
import type { EmailPort, ProvisioningContext, ProvisioningStep } from '@/server/tenancy';

/**
 * HLD §4.4 step 6 (final): sends the "set your password" invitation to the freshly-seeded Tenant
 * Admin — ported verbatim (logic unchanged) from
 * `legacy/api/src/tenancy/provisioning/steps/invite-admin.step.ts`. `EmailPort.send()` never throws
 * (its own documented contract), so this step can never fail — the one step in the sequence that is
 * unconditionally idempotent-and-safe to re-run, since "send another copy of an informational invite"
 * has no harmful duplicate-side-effect the way a duplicate DB row would.
 *
 * Goes through `renderBrandedEmail` (tenant name HTML-escaped before interpolation — a raw
 * concatenation here would be a stored-XSS vector via a malicious tenant name) and whatever
 * {@link EmailPort} the composition root supplies (this dispatch: always
 * {@link import('@/server/infrastructure/mail').NoopEmailAdapter} — no real SMTP adapter exists yet).
 */
export class InviteAdminStep implements ProvisioningStep {
  readonly name: ProvisioningStepName = 'invite_admin';

  constructor(private readonly emailPort: EmailPort) {}

  async run(ctx: ProvisioningContext): Promise<void> {
    const env = getEnv();
    const loginUrl = `https://${ctx.tenant.subdomainSlug}.${env.PUBLIC_APEX_DOMAIN}`;
    const safeLoginUrl = escapeHtml(loginUrl);
    const { subject, html } = renderBrandedEmail({
      tenantName: ctx.tenant.name,
      tenantLogoUrl: null, // Not yet set at provisioning time (branding is configured post-provisioning, Phase 9).
      accentColor: env.THEME_DEFAULT_ACCENT_COLOR,
      subject: "You're invited to administer this organization on ExamLand",
      bodyHtml:
        `<p>You've been set up as the Tenant Admin.</p>` +
        `<p>Visit <a href="${safeLoginUrl}">${safeLoginUrl}</a> to set your password once account recovery is available.</p>`,
    });
    await this.emailPort.send({
      to: ctx.adminEmail,
      subject,
      html,
      text: `You've been set up as the Tenant Admin. Visit ${loginUrl} to get started.`,
    });
  }
}
