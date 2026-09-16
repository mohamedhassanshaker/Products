import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../modules/iam/domain/permissions.js";
import { GetFlowAssistantConfig } from "../../../../modules/flows/application/get-flow-assistant-config.js";
import type { FlowAssistantConfigRow } from "../../../../modules/flows/ports/flow-assistant-config-repository.js";
import { flowAssistantConfigRepository, realClock } from "../agents/composition.js";
import { updateFlowAssistantConfigAction } from "../agents/actions.js";
import { AiSettingsScreen } from "./ai-settings-screen.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "ok"; readonly config: FlowAssistantConfigRow };

const PERMISSION = "agents:manage" as const;

/**
 * `/ai-settings` — a brand-new standalone nav item (product owner's own choice, not a tab on
 * an existing screen) letting an Agent Designer set the Flow Designer AI sidebar's model
 * without an env edit plus an `ai` container recreate (`propose_flow_edit.py`'s own doc
 * comment for why that was the only way to change it before this screen existed).
 *
 * Gated on `agents:manage` — the same permission Agent Designers already hold to author
 * flows and use the sidebar itself, not a new permission key.
 */
export default async function AiSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("aiSettings");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, PERMISSION)) return { kind: "forbidden" } as const;

      const config = await new GetFlowAssistantConfig({
        flowAssistantConfig: flowAssistantConfigRepository(),
      }).execute({ now: realClock().now() });

      return { kind: "ok", config } as const;
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/ai-settings`)}`}
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
      <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      <AiSettingsScreen
        config={pageData.config}
        actions={{ updateFlowAssistantConfig: updateFlowAssistantConfigAction }}
      />
    </div>
  );
}
