import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { ListTenants } from "../../../../modules/platform/application/list-tenants.js";
import { PlatformOperatorDeniedError } from "../../../../modules/platform/application/require-platform-operator.js";
import type { Tenant } from "../../../../modules/platform/domain/tenant.js";
import { platformOperatorGate, tenantRegistry } from "./composition.js";
import { TenantsScreen } from "./tenants-screen.js";
import { createTenantAction, deprovisionTenantAction, suspendTenantAction } from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "ok"; readonly tenants: readonly Tenant[] };

/**
 * `/tenants` — the platform operator's tenant lifecycle screen (Part C + E).
 *
 * `requirePlatformOperator` runs here, inside `withStaffAuth`'s bound tenant
 * context, before any of this route's own data is read — mirrors `(backoffice)/
 * iam/page.tsx`'s own real, server-side gating convention exactly. An ordinary
 * tenant's own SuperAdmin (even one who has self-granted `platform:operate` in
 * their own tenant's matrix) is refused here: the compound gate also requires
 * their own tenant to BE the real Platform tenant.
 */
export default async function TenantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("platformAdmin.tenants");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        await platformOperatorGate().execute(principal, "platform.tenants (visibility)");
      } catch (error) {
        if (error instanceof PlatformOperatorDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const tenants = await new ListTenants({ registry: tenantRegistry() }).execute();
      return { kind: "ok", tenants } as const;
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      pageData = { kind: "unauthenticated" };
    } else {
      throw error;
    }
  }

  if (pageData.kind === "unauthenticated") {
    const tCommon = await getTranslations("common");
    return (
      <SignInPrompt
        heading={t("pageTitle")}
        message={t("signInPrompt")}
        signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/tenants`)}`}
        signInLabel={tCommon("signInCta")}
      />
    );
  }

  if (pageData.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("forbiddenBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <TenantsScreen
        tenants={pageData.tenants}
        actions={{
          createTenant: createTenantAction,
          suspendTenant: suspendTenantAction,
          deprovisionTenant: deprovisionTenantAction,
        }}
      />
    </div>
  );
}
