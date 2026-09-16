"use client";

/**
 * B1 tab 3 — Feedback & knowledge gaps. The thumbs-down review queue (Mark fixed/Reopen)
 * and the unanswered-questions queue (two resolution actions, both of which remove the
 * item from the queue).
 *
 * The two resolution actions take a knowledge-source id / flow id typed by the staff
 * member — a real, named simplification: neither `modules/knowledge` nor a flow picker
 * is wired into this screen (both are separate modules with their own listing UIs this
 * wave does not duplicate), so linking a resolution to a real source means knowing that
 * source's id today rather than searching for it inline here.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import type { FeedbackIssueRow } from "../../../../modules/analytics/ports/feedback-issue-repository.js";
import type { UnansweredQuestionRow } from "../../../../modules/analytics/ports/unanswered-question-repository.js";
import type { CommandCentreScreenActions } from "./command-centre-screen.js";

export interface FeedbackGapsTabProps {
  readonly initialFeedbackIssues: readonly FeedbackIssueRow[];
  readonly initialUnansweredQuestions: readonly UnansweredQuestionRow[];
  readonly actions: CommandCentreScreenActions;
}

export function FeedbackGapsTab({
  initialFeedbackIssues,
  initialUnansweredQuestions,
  actions,
}: FeedbackGapsTabProps): React.ReactElement {
  const t = useTranslations("commandCentre.feedbackGaps");

  const [issues, setIssues] = React.useState(initialFeedbackIssues);
  const [questions, setQuestions] = React.useState(initialUnansweredQuestions);
  const [knowledgeIdByQuestion, setKnowledgeIdByQuestion] = React.useState<Record<string, string>>(
    {},
  );
  const [flowIdByQuestion, setFlowIdByQuestion] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleMarkFixed(issueId: string): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await actions.markFeedbackIssueFixed(issueId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIssues((prev) => prev.map((issue) => (issue.id === issueId ? result.value : issue)));
  }

  async function handleReopen(issueId: string): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await actions.reopenFeedbackIssue(issueId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIssues((prev) => prev.map((issue) => (issue.id === issueId ? result.value : issue)));
  }

  async function handleResolve(
    questionId: string,
    resolution: "Knowledge" | "Flow" | "Dismiss",
  ): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await actions.resolveUnansweredQuestion(
      resolution === "Knowledge"
        ? { questionId, resolution, knowledgeSourceId: knowledgeIdByQuestion[questionId] ?? "" }
        : resolution === "Flow"
          ? { questionId, resolution, flowId: flowIdByQuestion[questionId] ?? "" }
          : { questionId, resolution },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuestions((prev) => prev.filter((question) => question.id !== questionId));
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("issuesHeading")}</h2>
        {issues.length === 0 ? (
          <EmptyState headline={t("issuesEmptyHeadline")} cause={t("issuesEmptyCause")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {issues.map((issue) => (
              <Card
                key={issue.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-foreground">{issue.questionText}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t("volume", { count: issue.volume })}</span>
                    <Badge
                      variant="outline"
                      label={t(`rootCauses.${issue.rootCause}` as "rootCauses.Other")}
                    />
                    <Badge
                      variant="outline"
                      label={t(`issueStatuses.${issue.status}` as "issueStatuses.Open")}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  {issue.status === "Fixed" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void handleReopen(issue.id)}
                    >
                      {t("reopenAction")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleMarkFixed(issue.id)}
                    >
                      {t("markFixedAction")}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("questionsHeading")}</h2>
        {questions.length === 0 ? (
          <EmptyState headline={t("questionsEmptyHeadline")} cause={t("questionsEmptyCause")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {questions.map((question) => (
              <Card key={question.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-foreground">{question.questionText}</p>
                  <span className="text-xs text-muted-foreground">
                    {t("askedCount", { count: question.askCount })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    variant="mono"
                    placeholder={t("knowledgeSourceIdPlaceholder")}
                    value={knowledgeIdByQuestion[question.id] ?? ""}
                    onChange={(event) =>
                      setKnowledgeIdByQuestion((prev) => ({
                        ...prev,
                        [question.id]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !knowledgeIdByQuestion[question.id]?.trim()}
                    onClick={() => void handleResolve(question.id, "Knowledge")}
                  >
                    {t("resolveAsKnowledgeAction")}
                  </Button>
                  <Input
                    variant="mono"
                    placeholder={t("flowIdPlaceholder")}
                    value={flowIdByQuestion[question.id] ?? ""}
                    onChange={(event) =>
                      setFlowIdByQuestion((prev) => ({
                        ...prev,
                        [question.id]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !flowIdByQuestion[question.id]?.trim()}
                    onClick={() => void handleResolve(question.id, "Flow")}
                  >
                    {t("resolveAsFlowAction")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void handleResolve(question.id, "Dismiss")}
                  >
                    {t("dismissAction")}
                  </Button>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
