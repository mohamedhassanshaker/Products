import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../modules/iam/domain/permissions.js";
import {
  GetOverviewMetrics,
  type OverviewMetricsResult,
} from "../../../../modules/analytics/application/get-overview-metrics.js";
import { ListConversations } from "../../../../modules/analytics/application/list-conversations.js";
import { ListFeedbackIssues } from "../../../../modules/analytics/application/list-feedback-issues.js";
import { ListUnansweredQuestions } from "../../../../modules/analytics/application/list-unanswered-questions.js";
import type { ConversationListRow } from "../../../../modules/analytics/ports/conversation-explorer-repository.js";
import type { FeedbackIssueRow } from "../../../../modules/analytics/ports/feedback-issue-repository.js";
import type { UnansweredQuestionRow } from "../../../../modules/analytics/ports/unanswered-question-repository.js";
import { ListGoldenSets } from "../../../../modules/evaluation/application/list-golden-sets.js";
import { PrismaGoldenSetRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-golden-set-repository.js";
import type { GoldenSetRow } from "../../../../modules/evaluation/ports/golden-set-repository.js";
import {
  computeDailyMetrics,
  conversationExplorerRepository,
  feedbackIssueRepository,
  metricsRepository,
  now,
  unansweredQuestionRepository,
} from "./composition.js";
import { CommandCentreScreen } from "./command-centre-screen.js";
import {
  addConversationToGoldenSetAction,
  exportConversationsAction,
  getConversationTranscriptAction,
  getOverviewMetricsAction,
  listConversationsAction,
  markFeedbackIssueFixedAction,
  reopenFeedbackIssueAction,
  resolveUnansweredQuestionAction,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly canViewAnalytics: boolean;
      readonly overview: OverviewMetricsResult | null;
      readonly conversations: readonly ConversationListRow[];
      readonly goldenSets: readonly GoldenSetRow[];
      readonly feedbackIssues: readonly FeedbackIssueRow[];
      readonly unansweredQuestions: readonly UnansweredQuestionRow[];
    };

/**
 * `/command-centre` (B1: Command centre — the admin landing screen).
 *
 * Two permissions, one already-established split (mirrors `escalations/page.tsx`):
 * `dashboard:view` gates simply landing on the page at all (checked here — every seeded
 * role but `LiveAgent` holds it); `analytics:view` gates the real, metrics-heavy data
 * this screen shows (`Analyst`/`Reviewer`/`SuperAdmin`/`EntityAdmin` hold both). A
 * principal with `dashboard:view` but not `analytics:view` still lands on the page (it
 * is, after all, the landing screen every admin role reaches) but sees no tab content —
 * `CommandCentreScreen`'s own doc comment explains that split further.
 */
export default async function CommandCentrePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("commandCentre");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, "dashboard:view"))
        return { kind: "forbidden" } as const;

      const canViewAnalytics = isAllowed(principal.permissions, "analytics:view");
      if (!canViewAnalytics) {
        return {
          kind: "ok",
          canViewAnalytics: false,
          overview: null,
          conversations: [],
          goldenSets: [],
          feedbackIssues: [],
          unansweredQuestions: [],
        } as const;
      }

      const requestNow = now();
      const [overview, conversations, goldenSets, feedbackIssues, unansweredQuestions] =
        await Promise.all([
          new GetOverviewMetrics({
            metrics: metricsRepository(),
            computeDailyMetrics: computeDailyMetrics(),
          }).execute({ dateRange: "Today", now: requestNow }),
          new ListConversations({ explorer: conversationExplorerRepository() }).execute("All"),
          new ListGoldenSets({ sets: new PrismaGoldenSetRepository() }).execute(),
          new ListFeedbackIssues({ issues: feedbackIssueRepository() }).execute(),
          new ListUnansweredQuestions({ questions: unansweredQuestionRepository() }).execute(),
        ]);

      return {
        kind: "ok",
        canViewAnalytics: true,
        overview,
        conversations,
        goldenSets,
        feedbackIssues,
        unansweredQuestions,
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
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/command-centre`)}`}
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
      <CommandCentreScreen
        canViewAnalytics={pageData.canViewAnalytics}
        overview={pageData.overview}
        conversations={pageData.conversations}
        goldenSets={pageData.goldenSets}
        feedbackIssues={pageData.feedbackIssues}
        unansweredQuestions={pageData.unansweredQuestions}
        actions={{
          getOverviewMetrics: getOverviewMetricsAction,
          listConversations: listConversationsAction,
          getConversationTranscript: getConversationTranscriptAction,
          exportConversations: exportConversationsAction,
          addConversationToGoldenSet: addConversationToGoldenSetAction,
          markFeedbackIssueFixed: markFeedbackIssueFixedAction,
          reopenFeedbackIssue: reopenFeedbackIssueAction,
          resolveUnansweredQuestion: resolveUnansweredQuestionAction,
        }}
      />
    </div>
  );
}
