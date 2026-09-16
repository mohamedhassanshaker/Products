import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../../modules/iam/domain/permissions.js";
import { ListPipelines } from "../../../../../modules/orchestration/application/list-pipelines.js";
import type { PipelineDesignRow } from "../../../../../modules/orchestration/ports/pipeline-repository.js";
import { pipelineRepository } from "../composition.js";
import { PipelinesScreen } from "./pipelines-screen.js";
import { createPipelineAction } from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "ok"; readonly designs: readonly PipelineDesignRow[] };

const PERMISSION = "orchestration:manage" as const;

/**
 * `/orchestrator/pipelines` — the Pipeline Designer's own landing list, one level under the
 * `/orchestrator` screen it supersedes for any tenant that activates a pipeline
 * (`RouterConfigs.activePipelineVersionId`). Gated on the identical `orchestration:manage`
 * permission that screen already uses — see this feature's own design decision on why no
 * narrower permission is seeded.
 */
export default async function PipelinesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("orchestrator.pipeline");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, PERMISSION)) return { kind: "forbidden" } as const;
      const designs = await new ListPipelines({ pipelines: pipelineRepository() }).execute();
      return { kind: "ok", designs } as const;
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
          heading={t("listPageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/orchestrator/pipelines`)}`}
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
      <h1 className="text-lg font-semibold text-foreground">{t("listPageTitle")}</h1>
      <PipelinesScreen
        locale={locale}
        designs={pageData.designs}
        actions={{ createPipeline: createPipelineAction }}
      />
    </div>
  );
}
