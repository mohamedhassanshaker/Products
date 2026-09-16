"use server";

/**
 * Server Actions for `/branding/reset` — the platform operator's cross-tenant
 * counterpart to `/settings/appearance/reset`. Unlike that route, this one is not
 * §9.2 rule 5's "everything is broken, get me somewhere legible" escape hatch — the
 * `(platform-admin)` layout already renders fixed, neutral, tenant-independent
 * chrome (Part E), so there is no degenerate "the tenant theme broke this very
 * page" case to design around here. This is an ordinary, gated admin action.
 */

import { randomUUID } from "node:crypto";
import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { runWithTenant } from "../../../../../modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../../../../../modules/platform/tenancy/tenant-slug.js";
import { ResetAppearance } from "../../../../../modules/theming/application/reset-appearance.js";
import {
  auditSink,
  environment,
  platformOperatorGate,
  tenantRegistry,
  themeRepository,
} from "../composition.js";

export async function resetOperatorPreferenceAction(): Promise<void> {
  await withStaffAuth(async ({ principal }) => {
    await platformOperatorGate().execute(principal, "platform.branding.resetPersonal");
    await new ResetAppearance(themeRepository()).resetOwnPreference(principal.id);
  });
}

export async function resetTenantBrandingAction(targetSlug: string): Promise<void> {
  await withStaffAuth(async ({ principal }) => {
    await platformOperatorGate().execute(principal, "platform.branding.resetTenant");
    const slug = assertValidSlugShape(targetSlug);

    await runWithTenant(
      {
        tenant: slug,
        principal,
        traceId: randomUUID().replace(/-/g, ""),
        platformScope: "branding-override",
      },
      async () => {
        const target = await tenantRegistry().findBySlug(slug);
        if (!target) throw new Error(`No such tenant: "${targetSlug}".`);

        await new ResetAppearance(themeRepository()).resetTenantBranding("light", principal.id);

        await auditSink().record({
          actor: { kind: "Principal", principal },
          action: "tenant.branding.override",
          target: { kind: "Tenant", labelSnapshot: slug },
          summary: `Platform operator reset tenant "${targetSlug}"'s branding to the system default.`,
          environmentKey: environment(),
          tenant: { slugSnapshot: slug },
        });
      },
    );
  });
}
