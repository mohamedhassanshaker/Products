import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../modules/iam/domain/permissions.js";
import { GetRouterConfig } from "../../../../modules/orchestration/application/get-router-config.js";
import { ListRecentTraces } from "../../../../modules/orchestration/application/list-recent-traces.js";
import { ListAgents } from "../../../../modules/agents/application/list-agents.js";
import type { RouterConfigRow } from "../../../../modules/orchestration/ports/router-config-repository.js";
import type { OrchestrationTraceSummaryRow } from "../../../../modules/orchestration/ports/orchestration-trace-repository.js";
import type { PublishedAgentOption } from "./agent-scope-multi-select.js";
import { agentRepository, orchestrationTraceRepository, routerConfigRepository } from "./composition.js";
import { OrchestratorScreen } from "./orchestrator-screen.js";
import { getTraceDetailAction, previewTraceAction, updateRouterConfigAction } from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly routerConfig: RouterConfigRow | null;
      readonly recentTraces: readonly OrchestrationTraceSummaryRow[];
      readonly publishedAgents: readonly PublishedAgentOption[];
    };

const PERMISSION = "orchestration:manage" as const;

/**
 * `/orchestrator` — the wireframe's B4 "Orchestrator / router" screen
 * (`docs/SHJ3-wireframes-guide.md` §B4, `docs/shj3-wireframes.html#screen-orchestrator`).
 *
 * This screen used to be a pure read-only observability surface over the real
 * `RouterConfigs` singleton and `OrchestrationTraces`/`OrchestrationTraceSteps`/
 * `GroundingCitations` rows `apps/ai`'s `ProcessTurn` already writes every turn, gated on
 * `analytics:view` — the same permission `command-centre`'s conversation explorer uses to
 * read already-masked conversation content. It is no longer that: the execution mode,
 * agent-combination scope, ceilings, and merge/conflict policy are now real, editable
 * config (`OrchestratorScreen`'s execution-mode panel → `updateRouterConfigAction`), and the
 * screen also runs a live, no-cost, no-persistence trace-preview simulator against that
 * saved config (`previewTraceAction`). That moved this screen into the same
 * release-governance permission class as `evaluation:manage`/`governance:manage`/
 * `security:manage` — see `modules/iam/domain/permissions.ts`'s doc comment on the new
 * `orchestration:manage` permission this screen is gated on instead. The disclosed
 * consequence: `Reviewer`/`Analyst`, who held `analytics:view`, can no longer see this
 * screen at all, since only `SuperAdmin`/`EntityAdmin` hold `orchestration:manage`.
 */
export default async function OrchestratorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("orchestrator");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, PERMISSION)) return { kind: "forbidden" } as const;

      const [routerConfig, recentTraces, { rows: agents }] = await Promise.all([
        new GetRouterConfig({ routerConfig: routerConfigRepository() }).execute(),
        new ListRecentTraces({ traces: orchestrationTraceRepository() }).execute(),
        new ListAgents({ agents: agentRepository() }).execute({ status: "Published" }),
      ]);
      const publishedAgents = agents.map((agent) => ({ id: agent.id, name: agent.name }));

      return { kind: "ok", routerConfig, recentTraces, publishedAgents } as const;
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/orchestrator`)}`}
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
      <OrchestratorScreen
        locale={locale}
        routerConfig={pageData.routerConfig}
        recentTraces={pageData.recentTraces}
        publishedAgents={pageData.publishedAgents}
        actions={{
          getTraceDetail: getTraceDetailAction,
          updateRouterConfig: updateRouterConfigAction,
          previewTrace: previewTraceAction,
        }}
      />
    </div>
  );
}
