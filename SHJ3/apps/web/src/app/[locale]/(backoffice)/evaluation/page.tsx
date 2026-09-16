import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../modules/iam/domain/permissions.js";
import { GetGateStatusSummary } from "../../../../modules/evaluation/application/get-gate-status-summary.js";
import { GetPublishGate } from "../../../../modules/evaluation/application/get-publish-gate.js";
import { ListGoldenSets } from "../../../../modules/evaluation/application/list-golden-sets.js";
import { ListRegressionRuns } from "../../../../modules/evaluation/application/list-regression-runs.js";
import type { GoldenSetRow } from "../../../../modules/evaluation/ports/golden-set-repository.js";
import type { PublishGateRow } from "../../../../modules/evaluation/ports/publish-gate-repository.js";
import type { RegressionRunRow } from "../../../../modules/evaluation/ports/regression-run-repository.js";
import {
  agentRepository,
  gateEvaluationRepository,
  goldenSetRepository,
  now,
  publishGateRepository,
  regressionRunRepository,
} from "./composition.js";
import { EvaluationScreen } from "./evaluation-screen.js";
import {
  addCaseFromTranscriptAction,
  addGoldenCaseAction,
  createGoldenSetAction,
  getGateStatusSummaryAction,
  getGoldenSetAction,
  getRegressionRunAction,
  removeGoldenCaseAction,
  runAllSuitesAction,
  runGoldenSetNowAction,
  updateGoldenCaseAction,
  updatePublishGateAction,
  type GateStatusSummaryDisplay,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly goldenSets: readonly GoldenSetRow[];
      readonly regressionRuns: readonly RegressionRunRow[];
      readonly publishGate: PublishGateRow;
      readonly gateStatus: GateStatusSummaryDisplay;
    };

/**
 * `/evaluation` (B13: Evaluation & testing). One real permission, `evaluation:manage`
 * (granted to `SuperAdmin`/`EntityAdmin`), gates the whole page — every query runs inside
 * `withStaffAuth`'s handler, matching `escalations/page.tsx`'s own established precedent.
 */
export default async function EvaluationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("evaluation");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, "evaluation:manage")) {
        return { kind: "forbidden" } as const;
      }

      const requestNow = now();
      const [goldenSets, regressionRuns, publishGate] = await Promise.all([
        new ListGoldenSets({ sets: goldenSetRepository() }).execute(),
        new ListRegressionRuns({ runs: regressionRunRepository() }).execute(),
        new GetPublishGate({ gate: publishGateRepository() }).execute(principal.id, requestNow),
      ]);

      const summary = await new GetGateStatusSummary({
        gate: publishGateRepository(),
        evaluations: gateEvaluationRepository(),
      }).execute(principal.id, requestNow);
      const gateStatus: GateStatusSummaryDisplay = summary.blockedVersion
        ? {
            gateActive: summary.gateActive,
            blockedVersion: await (async () => {
              const version = await agentRepository().getVersion(
                summary.blockedVersion!.agentVersionId,
              );
              const agent = version
                ? await agentRepository().getAgentDetail(version.agentId)
                : null;
              return {
                agentName: agent?.name ?? "(unknown agent)",
                versionLabel: version?.label ?? "(unknown version)",
                reasons: summary.blockedVersion!.reasons,
              };
            })(),
          }
        : { gateActive: summary.gateActive, blockedVersion: null };

      return { kind: "ok", goldenSets, regressionRuns, publishGate, gateStatus } as const;
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/evaluation`)}`}
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
      <EvaluationScreen
        goldenSets={pageData.goldenSets}
        regressionRuns={pageData.regressionRuns}
        publishGate={pageData.publishGate}
        gateStatus={pageData.gateStatus}
        actions={{
          getGoldenSet: getGoldenSetAction,
          createGoldenSet: createGoldenSetAction,
          addGoldenCase: addGoldenCaseAction,
          addCaseFromTranscript: addCaseFromTranscriptAction,
          updateGoldenCase: updateGoldenCaseAction,
          removeGoldenCase: removeGoldenCaseAction,
          runGoldenSetNow: runGoldenSetNowAction,
          getRegressionRun: getRegressionRunAction,
          runAllSuites: runAllSuitesAction,
          updatePublishGate: updatePublishGateAction,
          getGateStatusSummary: getGateStatusSummaryAction,
        }}
      />
    </div>
  );
}
