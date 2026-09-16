"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { OverviewMetricsResult } from "../../../../modules/analytics/application/get-overview-metrics.js";
import type { ConversationListRow } from "../../../../modules/analytics/ports/conversation-explorer-repository.js";
import type { FeedbackIssueRow } from "../../../../modules/analytics/ports/feedback-issue-repository.js";
import type { UnansweredQuestionRow } from "../../../../modules/analytics/ports/unanswered-question-repository.js";
import type { GoldenSetRow } from "../../../../modules/evaluation/ports/golden-set-repository.js";
import { OverviewTab } from "./overview-tab.js";
import { ConversationExplorerTab } from "./conversation-explorer-tab.js";
import { FeedbackGapsTab } from "./feedback-gaps-tab.js";
import type {
  addConversationToGoldenSetAction,
  exportConversationsAction,
  getConversationTranscriptAction,
  getOverviewMetricsAction,
  listConversationsAction,
  markFeedbackIssueFixedAction,
  reopenFeedbackIssueAction,
  resolveUnansweredQuestionAction,
} from "./actions.js";

export interface CommandCentreScreenActions {
  readonly getOverviewMetrics: typeof getOverviewMetricsAction;
  readonly listConversations: typeof listConversationsAction;
  readonly getConversationTranscript: typeof getConversationTranscriptAction;
  readonly exportConversations: typeof exportConversationsAction;
  readonly addConversationToGoldenSet: typeof addConversationToGoldenSetAction;
  readonly markFeedbackIssueFixed: typeof markFeedbackIssueFixedAction;
  readonly reopenFeedbackIssue: typeof reopenFeedbackIssueAction;
  readonly resolveUnansweredQuestion: typeof resolveUnansweredQuestionAction;
}

export interface CommandCentreScreenProps {
  readonly canViewAnalytics: boolean;
  readonly overview: OverviewMetricsResult | null;
  readonly conversations: readonly ConversationListRow[];
  readonly goldenSets: readonly GoldenSetRow[];
  readonly feedbackIssues: readonly FeedbackIssueRow[];
  readonly unansweredQuestions: readonly UnansweredQuestionRow[];
  readonly actions: CommandCentreScreenActions;
}

/** B1 in full — three tabs, all gated on `analytics:view` for their real data (the page
 *  itself only needs `dashboard:view` to be reached at all; see `page.tsx`'s own doc
 *  comment for that split). A principal who can land on the page but lacks
 *  `analytics:view` sees the page chrome with no tab content, matching the "never a
 *  visible-but-disabled tab" convention `escalations-screen.tsx` already established. */
export function CommandCentreScreen({
  canViewAnalytics,
  overview,
  conversations,
  goldenSets,
  feedbackIssues,
  unansweredQuestions,
  actions,
}: CommandCentreScreenProps): React.ReactElement {
  const t = useTranslations("commandCentre");

  if (!canViewAnalytics || !overview) {
    return <p className="text-sm text-muted-foreground">{t("noAnalyticsAccess")}</p>;
  }

  const tabs = [
    { value: "overview", label: t("tabs.overview") },
    { value: "explorer", label: t("tabs.explorer") },
    { value: "feedbackGaps", label: t("tabs.feedbackGaps") },
  ];

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="overview">
        <OverviewTab initialOverview={overview} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="explorer">
        <ConversationExplorerTab
          initialConversations={conversations}
          goldenSets={goldenSets}
          actions={actions}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="feedbackGaps">
        <FeedbackGapsTab
          initialFeedbackIssues={feedbackIssues}
          initialUnansweredQuestions={unansweredQuestions}
          actions={actions}
        />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
