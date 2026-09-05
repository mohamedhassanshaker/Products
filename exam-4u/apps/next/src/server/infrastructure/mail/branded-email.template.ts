/**
 * FR-MT-7: "Transactional email... reflects the sending tenant's branding (tenant name, and logo if
 * configured) in both the subject and the HTML body, with tenant-controlled values HTML-escaped
 * before interpolation (to prevent stored-XSS via a tenant name/logo URL)." Ported verbatim from
 * `legacy/api/src/infrastructure/mail/branded-email.template.ts`.
 *
 * `tenant.name`/`tenant.logoUrl` are both **tenant-controlled** values — if either were interpolated
 * into the HTML body unescaped, a malicious tenant name like `<img src=x onerror=alert(1)>` would
 * execute in the *recipient's* mail client (a stored-XSS vector, since the value is persisted and
 * later rendered to a different party than whoever set it) — this module is the one place that
 * guarantees every tenant-controlled value passes through {@link escapeHtml} before ever reaching an
 * HTML string.
 */

/** Escapes the five HTML-significant characters. Deliberately minimal (not a full sanitizer) — this
 * is *escaping for safe interpolation into a text/attribute context*, not sanitizing already-trusted
 * markup, since every caller treats its input as plain text, never as markup to render as-is. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BrandedEmailInput {
  /** Tenant-controlled — always escaped before interpolation. */
  tenantName: string;
  /** Tenant-controlled — always escaped before interpolation (used only as an `<img src>` attribute
   * value, never as raw markup). `null`/empty renders no logo. */
  tenantLogoUrl: string | null;
  /** The resolved accent hex, no leading `#` (FR-MT-10). This dispatch always passes
   * `getEnv().THEME_DEFAULT_ACCENT_COLOR` (no per-tenant override read path exists yet — Phase 9). */
  accentColor: string;
  /** Not tenant-controlled (a fixed string chosen by application code per call site). */
  subject: string;
  /** Caller-supplied HTML fragment for the message body. Callers are responsible for escaping any
   * *further* tenant-controlled value they interpolate into this fragment — this function only
   * guarantees the tenant name/logo it directly interpolates are escaped. */
  bodyHtml: string;
}

/**
 * Renders one tenant-branded transactional email. Every call site should go through this so the
 * escaping guarantee lives in exactly one place rather than being re-derived per call site.
 */
export function renderBrandedEmail(input: BrandedEmailInput): { subject: string; html: string } {
  const safeName = escapeHtml(input.tenantName);
  const safeLogoUrl = input.tenantLogoUrl ? escapeHtml(input.tenantLogoUrl) : null;
  const safeAccent = /^[0-9A-Fa-f]{6}$/.test(input.accentColor) ? input.accentColor : '5C6BC0';

  const logoBlock = safeLogoUrl
    ? `<img src="${safeLogoUrl}" alt="${safeName} logo" style="max-height:48px;margin-bottom:16px;" />`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
      ${logoBlock}
      <h2 style="color:#${safeAccent};margin:0 0 16px;">${safeName}</h2>
      ${input.bodyHtml}
    </div>
  `.trim();

  return { subject: `${input.subject} — ${safeName}`, html };
}
