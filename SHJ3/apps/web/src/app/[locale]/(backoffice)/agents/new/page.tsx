import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../../modules/iam/domain/permissions.js";
import { createAgentAction } from "../actions.js";
import { NewAgentForm } from "./new-agent-form.js";

type PageData =
  { readonly kind: "unauthenticated" } | { readonly kind: "forbidden" } | { readonly kind: "ok" };

/**
 * `/agents/new` — B3 wizard step 1 ("Identity"), standalone: an agent must exist (`CreateAgent`)
 * before `GetOrCreateWizardDraft` has anything to fork a draft from, so this route collects
 * just the step-1 fields, creates the agent + its v0.1 draft version, then hands off to
 * `/agents/[id]/edit` (step "instructions" onward) via a real client-side navigation —
 * matching how the rest of the 10-step wizard "freely navigable, state persists" contract
 * only makes sense once an `agentId` exists to persist state *against*.
 */
export default async function NewAgentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("agents.new");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "agents:manage", "agents.new (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }
      return { kind: "ok" } as const;
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
      <div className="flex flex-col gap-4">
        <SignInPrompt
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/agents/new`)}`}
          signInLabel={tCommon("signInCta")}
        />
      </div>
    );
  }

  if (pageData.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("permissionDeniedHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("permissionDeniedBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <NewAgentForm createAgent={createAgentAction} />
    </div>
  );
}
