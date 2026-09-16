import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../../../modules/iam/domain/permissions.js";
import { ListAgents } from "../../../../../../modules/agents/application/list-agents.js";
import { GetOrCreateDraftPipelineVersion } from "../../../../../../modules/orchestration/application/get-or-create-draft-pipeline-version.js";
import { GetPipelineCanvas } from "../../../../../../modules/orchestration/application/get-pipeline-canvas.js";
import { GetPipelineVersionHistory } from "../../../../../../modules/orchestration/application/get-pipeline-version-history.js";
import { GetRouterConfig } from "../../../../../../modules/orchestration/application/get-router-config.js";
import type {
  PipelineCanvas,
  PipelineDesignRow,
  PipelineVersionHistoryEntryRow,
} from "../../../../../../modules/orchestration/ports/pipeline-repository.js";
import { agentRepository, pipelineRepository, routerConfigRepository } from "../../composition.js";
import { PipelineEditor } from "./pipeline-editor.js";
import type { PipelineAgentOption } from "./pipeline-node-dialog.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "ok";
      readonly design: PipelineDesignRow;
      readonly canvas: PipelineCanvas;
      readonly activePipelineVersionId: string | null;
      readonly agents: readonly PipelineAgentOption[];
      readonly publishedAgentIds: readonly string[];
      readonly versionHistory: readonly PipelineVersionHistoryEntryRow[];
      readonly canPublish: boolean;
    };

const PERMISSION = "orchestration:manage" as const;

/**
 * `/orchestrator/pipelines/[pipelineId]` — the Pipeline Designer's real, interactive editor.
 * `pipelineId` is a `PipelineDesign.id`; the version actually rendered is always the
 * design's own already-Draft version, or a freshly-forked one off the current Published
 * version (`GetOrCreateDraftPipelineVersion`, mirroring the agent wizard's own
 * `GetOrCreateWizardDraft` precedent) — a Published version is immutable, so opening the
 * editor always lands on something editable.
 */
export default async function PipelineEditorPage({
  params,
}: {
  params: Promise<{ locale: string; pipelineId: string }>;
}) {
  const { locale, pipelineId } = await params;
  const t = await getTranslations("orchestrator.pipeline");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, PERMISSION)) return { kind: "forbidden" } as const;

      const pipelines = pipelineRepository();
      const design = await pipelines.getDesign(pipelineId);
      if (!design) return { kind: "not-found" } as const;

      const { pipelineVersionId } = await new GetOrCreateDraftPipelineVersion({ pipelines }).execute({
        pipelineDesignId: pipelineId,
        actorStaffUserId: principal.id,
        now: new Date(),
      });

      const [canvas, routerConfig, { rows: publishedAgents }, versionHistory] = await Promise.all([
        new GetPipelineCanvas({ pipelines }).execute(pipelineVersionId),
        new GetRouterConfig({ routerConfig: routerConfigRepository() }).execute(),
        new ListAgents({ agents: agentRepository() }).execute({ status: "Published" }),
        new GetPipelineVersionHistory({ pipelines }).execute(pipelineId),
      ]);
      if (!canvas) {
        throw new Error(
          `GetOrCreateDraftPipelineVersion resolved version "${pipelineVersionId}" for design "${pipelineId}", but its canvas could not be loaded.`,
        );
      }

      return {
        kind: "ok",
        design,
        canvas,
        activePipelineVersionId: routerConfig?.activePipelineVersionId ?? null,
        agents: publishedAgents.map((agent) => ({ agentId: agent.id, name: agent.name })),
        publishedAgentIds: publishedAgents.map((agent) => agent.id),
        versionHistory,
        canPublish: principal.permissions.has("agents:publish"),
      } as const;
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
          heading={t("editorPageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/orchestrator/pipelines/${pipelineId}`)}`}
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
  if (pageData.kind === "not-found") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("notFoundHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("notFoundBody")}</p>
      </div>
    );
  }

  return (
    <PipelineEditor
      design={pageData.design}
      canvas={pageData.canvas}
      activePipelineVersionId={pageData.activePipelineVersionId}
      agents={pageData.agents}
      publishedAgentIds={pageData.publishedAgentIds}
      versionHistory={pageData.versionHistory}
      canPublish={pageData.canPublish}
    />
  );
}
