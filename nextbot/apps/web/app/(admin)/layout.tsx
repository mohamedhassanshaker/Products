import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTenantBranding } from "@nextbot/tenancy";
import { getSession } from "@/src/lib/session";
import { buildBrandStyleTag } from "@/src/lib/build-brand-style-tag";
import { AdminShell } from "./AdminShell";

/**
 * Admin Console shell (Phase 3, BL-01 slice C): route guard (redirect to /login when
 * no valid session — FR-ADM-01) wraps every screen under this route group with the
 * left-sidebar/top-bar/breadcrumb chrome from `docs/design/UX_GUIDELINES.md` §1.b/§2.
 *
 * FR-ADM-07: fetches the tenant's brand profile once per request here (server-side)
 * so `AdminShell` can replace its default NextBot chrome when white-labeling is
 * enabled, without every admin screen re-fetching it independently.
 *
 * Plan Phase 1 (post-QA scope-bug fix — see `build-brand-style-tag.ts`'s header
 * doc comment): also renders the tenant's overridable CSS custom properties
 * (`--brand-accent`/`--brand-accent-foreground`, `--brand-sidebar` — deliberately
 * never shadcn's own `--primary`/`--primary-foreground`) as a real server-rendered
 * `<style>` tag, computed once here and interpolated nowhere else in the app — SSR'd
 * so there is no FOUC and no client-side `useEffect` needed to apply branding.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const branding = await getTenantBranding(session.tenantId);
  const activeBranding = branding?.whiteLabelEnabled ? branding.brandingConfig : null;
  const brandStyleTag = buildBrandStyleTag(activeBranding);

  return (
    <>
      {brandStyleTag && <style dangerouslySetInnerHTML={{ __html: brandStyleTag }} />}
      <AdminShell permissions={session.permissions} branding={activeBranding}>
        {children}
      </AdminShell>
    </>
  );
}
