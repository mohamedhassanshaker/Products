import NextLink from "next/link";
import { redirect } from "next/navigation";
import { isNavItemVisible, type NavRule } from "@nextbot/ui";
import { Card, CardHeader, CardTitle, CardDescription } from "@nextbot/ui/components/ui/card";
import { getSession } from "@/src/lib/session";

/**
 * Plan Phase 3 (client-feedback-batch item 11) — Settings hub. Previously there
 * was no `/settings` landing page at all: the sidebar carried 7 individual
 * settings-shaped entries plus a standalone Connector Alerts entry, all folded
 * into a single "Settings" nav item by `AdminShell.tsx` (see its `NAV_ITEMS`
 * comment for the full rationale). This page is that item's destination — a
 * card per settings-shaped screen, each gated by the exact same
 * `isNavItemVisible` check the old individual nav entries used, so a caller who
 * couldn't see e.g. "Branding" in the old flat nav still can't see its card
 * here (fail-closed, not disabled — matching `docs/design/UX_GUIDELINES.md` §2).
 *
 * Explicitly out of scope for this hub (per the dispatch): Connector Alerts
 * (moved to MCP Health as a tab — its real spec home per screen B.3A.4, see
 * `mcp-health/page.tsx`) and Model Gateway (stays grouped under the "Agent
 * Platform" sidebar section per spec grouping B.15.5).
 *
 * Zero URL changes: every card below links to the same route its screen
 * already lived at before this phase — this page only adds a new entry point,
 * it never moves an existing one (the sole exception, Connector Alerts, is a
 * deliberate relocation handled by its own redirect, not a card here).
 */
const SETTINGS_CARDS: Array<{ href: string; title: string; description: string } & NavRule> = [
  {
    href: "/settings/branding",
    title: "Branding",
    description: "White-label the Admin Console and customer-facing chrome with your own logo and colors.",
    module: "security_settings",
    required: "Read",
  },
  {
    href: "/roles",
    title: "Users & Roles",
    description: "Manage Admin Console users, their role assignments, and per-role permission matrices.",
    module: "users_roles",
    required: "Read",
  },
  {
    href: "/settings/escalation-routing",
    title: "Escalation Routing",
    description: "Configure how escalated conversations are routed to human agents and teams.",
    module: "escalations",
    required: "Read",
  },
  {
    href: "/settings/integrations",
    title: "Integrations",
    description: "Connect the tenant's Git repository used to version and promote agent definitions.",
    module: "agent_platform",
    required: "Read",
  },
  {
    href: "/audit-log",
    title: "Audit Log",
    description: "Review a chronological record of administrative actions taken across the tenant.",
    module: "audit_log",
    required: "Read",
  },
  {
    href: "/settings/pii-guardrails",
    title: "PII & Guardrails",
    description: "Configure PII detection/masking rules and author content-safety guardrails.",
    module: "security_settings",
    required: "Read",
  },
  {
    href: "/settings/data-policy",
    title: "Retention & Residency",
    description: "Set data retention windows and regional residency requirements for the tenant.",
    module: "security_settings",
    required: "Read",
  },
  {
    href: "/settings/dsr",
    title: "Data Subject Requests",
    description: "Process GDPR data subject access/erasure requests for the tenant's customers.",
    module: "security_settings",
    required: "Read",
  },
  // Phase 4 (BL-36, FR-SEC-10) — SSO/SCIM, sessions, service accounts.
  {
    href: "/settings/sso",
    title: "Single Sign-On & SCIM",
    description: "Configure SAML/OIDC single sign-on, group-to-role mapping, and SCIM provisioning.",
    module: "security_settings",
    required: "Read",
  },
  {
    href: "/settings/sessions",
    title: "Sessions",
    description: "Review and revoke your active Admin Console sessions (plus the whole tenant's, if you administer users).",
    // Placeholder rule — this card is special-cased to always render below
    // (self-service session management needs no module grant at all, unlike
    // every other card here), never actually evaluated by `isNavItemVisible`.
    module: "users_roles",
    required: "None",
  },
  {
    href: "/settings/service-accounts",
    title: "Service Accounts",
    description: "Manage non-human, programmatic-access identities and their scoped API keys.",
    module: "users_roles",
    required: "Read",
  },
  // Target Architecture Blueprint Phase 18 (BL-49, FR-API-02/FR-ADM-10).
  {
    href: "/settings/webhooks",
    title: "Webhooks",
    description: "Subscribe an endpoint to escalation, approval, guardrail, deployment, and drift-detection events.",
    module: "security_settings",
    required: "Read",
  },
  {
    href: "/settings/telemetry-export",
    title: "Telemetry Export",
    description: "Opt in to forward trace/metric telemetry and the audit log to your own OpenTelemetry/SIEM endpoint.",
    module: "security_settings",
    required: "Read",
  },
  // Target Architecture Blueprint Phase 19 (BL-50/BL-51).
  {
    href: "/settings/identity-resolution",
    title: "Cross-Channel Identity Linking",
    description: "Opt in to treat matching-identifier conversations across channels as the same customer for context continuity.",
    module: "security_settings",
    required: "Read",
  },
  {
    href: "/settings/config-portability",
    title: "Configuration Export & Restore",
    description: "Export the tenant's agent/skill/workflow/team/model-route/connector configuration and restore from a prior export.",
    module: "security_settings",
    required: "Read",
  },
  // Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the final phase of
  // the Blueprint's 21-phase plan.
  {
    href: "/settings/breakglass-access",
    title: "Break-Glass Access",
    description: "Grant a NextBot Platform Operator time-boxed, read-only access to this tenant's data for incident diagnosis.",
    module: "security_settings",
    required: "Read",
  },
];

export default async function SettingsPage() {
  // Defensive, not load-bearing: `(admin)/layout.tsx` already redirects to
  // /login before any child of this route group renders, so `session` is
  // always non-null in practice — mirrored here anyway (same as every other
  // settings screen's own page.tsx) rather than assuming the caller can only
  // ever be reached through that layout.
  const session = await getSession();
  if (!session) redirect("/login");

  // Phase 4 (BL-36): "Sessions" is special-cased to always show — self-service
  // session listing/revocation needs no RBAC module grant at all, unlike every
  // other card here.
  const visibleCards = SETTINGS_CARDS.filter(
    (card) => card.href === "/settings/sessions" || isNavItemVisible(session.permissions, card),
  );

  return (
    <div className="p-6">
      <h1 className="mb-1 font-heading text-lg font-semibold">Settings</h1>
      <p className="mb-6 text-muted-foreground">Tenant-wide configuration for the Admin Console.</p>
      {visibleCards.length === 0 ? (
        <p className="text-muted-foreground">You don&apos;t have access to any settings screens.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCards.map((card) => (
            <Card key={card.href} className="transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardTitle>
                  <NextLink href={card.href} className="text-primary underline-offset-4 hover:underline">
                    {card.title}
                  </NextLink>
                </CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
