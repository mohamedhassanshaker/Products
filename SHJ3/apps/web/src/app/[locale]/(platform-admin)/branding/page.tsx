import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { PlatformOperatorDeniedError } from "../../../../modules/platform/application/require-platform-operator.js";
import { platformOperatorGate, tenantRegistry } from "./composition.js";
import { loadTenantBrandingAction, type TenantBrandingData } from "./actions.js";
import { BrandingScreen, type BrandingTenantOption } from "./branding-screen.js";

/** Statuses a platform operator can meaningfully view/edit branding for — a tenant mid-
 *  provisioning or already torn down has no stable schema to read/write. */
const BRANDABLE_STATUSES = new Set(["Active", "Suspended"]);

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "no-tenants" }
  | {
      readonly kind: "ok";
      readonly tenants: readonly BrandingTenantOption[];
      readonly initialSlug: string;
      readonly initialData: TenantBrandingData;
    };

/**
 * `/branding` — the platform operator's cross-tenant branding screen (Part D + E).
 * Mirrors `/tenants`' own real, server-side gating shape exactly.
 */
export default async function BrandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("platformAdmin.branding");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        await platformOperatorGate().execute(principal, "platform.branding (visibility)");
      } catch (error) {
        if (error instanceof PlatformOperatorDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const allTenants = await tenantRegistry().listAll();
      const tenants: BrandingTenantOption[] = allTenants
        .filter((t2) => BRANDABLE_STATUSES.has(t2.status))
        .map((t2) => ({ slug: t2.slug, displayName: t2.displayName, status: t2.status }));

      if (tenants.length === 0) return { kind: "no-tenants" } as const;

      const initialSlug = tenants[0]!.slug;
      const initial = await loadTenantBrandingAction(initialSlug);
      if (!initial.ok) throw new Error(initial.error);

      return { kind: "ok", tenants, initialSlug, initialData: initial.value } as const;
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
        signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/branding`)}`}
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

  if (pageData.kind === "no-tenants") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("noTenantsBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <BrandingScreen
        locale={locale}
        tenants={pageData.tenants}
        initialSlug={pageData.initialSlug}
        initialData={pageData.initialData}
      />
    </div>
  );
}
