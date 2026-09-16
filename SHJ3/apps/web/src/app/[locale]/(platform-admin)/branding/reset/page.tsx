import { getTranslations } from "next-intl/server";
import { UnauthenticatedError } from "../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { PlatformOperatorDeniedError } from "../../../../../modules/platform/application/require-platform-operator.js";
import { platformOperatorGate } from "../composition.js";
import { resetOperatorPreferenceAction, resetTenantBrandingAction } from "./actions.js";

/**
 * `/branding/reset?tenant=<slug>` — see `actions.ts`'s own module comment for why
 * this is an ordinary gated action, not §9.2 rule 5's degenerate escape hatch.
 */
export default async function PlatformBrandingResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { locale } = await params;
  const { tenant } = await searchParams;
  const t = await getTranslations("platformAdmin.branding.reset");

  let allowed = false;
  try {
    allowed = await withStaffAuth(async ({ principal }) => {
      try {
        await platformOperatorGate().execute(principal, "platform.branding.reset (visibility)");
        return true;
      } catch (error) {
        if (error instanceof PlatformOperatorDeniedError) return false;
        throw error;
      }
    });
  } catch (error) {
    if (!(error instanceof UnauthenticatedError)) throw error;
  }

  if (!allowed) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("forbiddenBody")}</p>
      </div>
    );
  }

  const boundResetTenant = tenant ? resetTenantBrandingAction.bind(null, tenant) : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>

      <section className="flex flex-col gap-2 rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("personalHeading")}</h2>
        <p className="text-sm text-muted-foreground">{t("personalDescription")}</p>
        <form action={resetOperatorPreferenceAction}>
          <button
            type="submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            {t("personalButton")}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("tenantHeading")}</h2>
        {boundResetTenant ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("tenantDescription", { slug: tenant! })}
            </p>
            <form action={boundResetTenant}>
              <button
                type="submit"
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground"
              >
                {t("tenantButton")}
              </button>
            </form>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("noTenantSelected")}{" "}
            <a href={`/${locale}/branding`} className="underline">
              {t("backToBranding")}
            </a>
          </p>
        )}
      </section>
    </div>
  );
}
