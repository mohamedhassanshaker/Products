import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../../modules/iam/domain/permissions.js";
import { proposeAgentCreationAction, applyAgentCreationPlanAction } from "../actions.js";
import { CreateWithAiForm } from "./create-with-ai-form.js";

type PageData =
  { readonly kind: "unauthenticated" } | { readonly kind: "forbidden" } | { readonly kind: "ok" };

/**
 * `/agents/new-with-ai` — the registry's "Create with AI" entry point, sibling to the plain
 * `/agents/new` form: describe the business need once, review a proposal covering every
 * wizard step that can be safely auto-filled (Identity, Instructions, Model, Tools, Knowledge,
 * Guardrails, Channels, and a plain-language flow instruction), then create the agent in one
 * go. See `agents/actions.ts`'s `proposeAgentCreationAction`/`applyAgentCreationPlanAction`
 * doc comments for the full "propose is read-only, apply writes through the exact same
 * per-field application classes a manual wizard edit already uses" design.
 */
export default async function NewAgentWithAiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("agents.newWithAi");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "agents:manage", "agents.newWithAi (visibility)");
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/agents/new-with-ai`)}`}
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
      <CreateWithAiForm
        actions={{
          proposeAgentCreation: proposeAgentCreationAction,
          applyAgentCreationPlan: applyAgentCreationPlanAction,
        }}
      />
    </div>
  );
}
