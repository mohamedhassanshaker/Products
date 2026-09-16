"use server";

/**
 * Server Actions for `/command-centre` (B1) — every read/write this screen needs beyond
 * its initial page load.
 *
 * ## Permission gating
 *
 * `dashboard:view` gates simply landing on the page (checked in `page.tsx`, the same
 * pattern `escalations/page.tsx` uses for its own two-permission split). `analytics:view`
 * gates every action here — the metrics/explorer/feedback-queue data these actions
 * expose is exactly the surface `analytics:view` was already granted for
 * (`iam/domain/permissions.ts`'s own doc comment: "`analytics:view` for its
 * metrics/explorer detail"). Checked here, in the caller, per api.md §12 invariant 2 —
 * the use cases in `modules/analytics/application` do not check permissions themselves.
 */
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import type { DateRangeKey } from "../../../../modules/analytics/domain/date-range.js";
import {
  GetOverviewMetrics,
  type OverviewMetricsResult,
} from "../../../../modules/analytics/application/get-overview-metrics.js";
import { ListConversations } from "../../../../modules/analytics/application/list-conversations.js";
import {
  ConversationNotFoundError,
  GetConversationTranscript,
} from "../../../../modules/analytics/application/get-conversation-transcript.js";
import { ExportConversations } from "../../../../modules/analytics/application/export-conversations.js";
import {
  AddConversationToGoldenSet,
  type AddConversationToGoldenSetInput,
} from "../../../../modules/analytics/application/add-conversation-to-golden-set.js";
import { ListFeedbackIssues } from "../../../../modules/analytics/application/list-feedback-issues.js";
import { MarkFeedbackIssueFixed } from "../../../../modules/analytics/application/mark-feedback-issue-fixed.js";
import { ReopenFeedbackIssue } from "../../../../modules/analytics/application/reopen-feedback-issue.js";
import { ListUnansweredQuestions } from "../../../../modules/analytics/application/list-unanswered-questions.js";
import {
  ResolveUnansweredQuestion,
  type ResolveUnansweredQuestionInput,
} from "../../../../modules/analytics/application/resolve-unanswered-question.js";
import type {
  ConversationListRow,
  ConversationOutcomeFilter,
  TranscriptTurnRow,
} from "../../../../modules/analytics/ports/conversation-explorer-repository.js";
import type { AddGoldenCaseFromTranscriptResult } from "../../../../modules/analytics/ports/golden-case-port.js";
import type {
  FeedbackIssueRow,
  FeedbackIssueStatus,
} from "../../../../modules/analytics/ports/feedback-issue-repository.js";
import type {
  TranscriptExportFormat,
  TranscriptExportRow,
} from "../../../../modules/analytics/ports/transcript-export-repository.js";
import type {
  UnansweredQuestionRow,
  UnansweredQuestionStatus,
} from "../../../../modules/analytics/ports/unanswered-question-repository.js";
import { ListGoldenSets } from "../../../../modules/evaluation/application/list-golden-sets.js";
import { PrismaGoldenSetRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-golden-set-repository.js";
import type { GoldenSetRow } from "../../../../modules/evaluation/ports/golden-set-repository.js";
import {
  computeDailyMetrics,
  conversationExplorerRepository,
  feedbackIssueRepository,
  goldenCasePort,
  metricsRepository,
  now,
  transcriptExportRepository,
  unansweredQuestionRepository,
} from "./composition.js";

const ANALYTICS_PERMISSION = "analytics:view" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getOverviewMetricsAction(
  dateRange: DateRangeKey,
): Promise<ActionResult<OverviewMetricsResult>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.getOverviewMetrics");
      const result = await new GetOverviewMetrics({
        metrics: metricsRepository(),
        computeDailyMetrics: computeDailyMetrics(),
      }).execute({ dateRange, now: now() });
      return { ok: true, value: result } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listConversationsAction(
  filter: ConversationOutcomeFilter,
): Promise<ActionResult<readonly ConversationListRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.listConversations");
      const result = await new ListConversations({
        explorer: conversationExplorerRepository(),
      }).execute(filter);
      return { ok: true, value: result } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function getConversationTranscriptAction(
  conversationId: string,
): Promise<ActionResult<readonly TranscriptTurnRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.getConversationTranscript");
      try {
        const result = await new GetConversationTranscript({
          explorer: conversationExplorerRepository(),
        }).execute(conversationId);
        return { ok: true, value: result } as const;
      } catch (error) {
        if (error instanceof ConversationNotFoundError) {
          return { ok: false, error: error.code } as const;
        }
        throw error;
      }
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function exportConversationsAction(
  filter: ConversationOutcomeFilter,
  format: TranscriptExportFormat,
): Promise<ActionResult<TranscriptExportRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.exportConversations");
        const result = await new ExportConversations({
          explorer: conversationExplorerRepository(),
          exports: transcriptExportRepository(),
        }).execute({ filter, format, requestedByStaffUserId: principal.id, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { filter, format } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** `evaluation.case_already_added`/`evaluation.golden_set_not_found` come back inside
 *  `value` (a structured result), not as the action-level `error` — this is a real,
 *  named business outcome the UI renders (the wireframe's "disable itself with
 *  confirmation text"), not a failure of the action call itself. */
export async function addConversationToGoldenSetAction(
  input: Omit<AddConversationToGoldenSetInput, "staffUserId" | "now">,
): Promise<ActionResult<AddGoldenCaseFromTranscriptResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(
          principal,
          ANALYTICS_PERMISSION,
          "commandCentre.addConversationToGoldenSet",
        );
        const result = await new AddConversationToGoldenSet({
          explorer: conversationExplorerRepository(),
          goldenCases: goldenCasePort(),
        }).execute({ ...input, staffUserId: principal.id, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listGoldenSetsAction(): Promise<ActionResult<readonly GoldenSetRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.listGoldenSets");
      const result = await new ListGoldenSets({ sets: new PrismaGoldenSetRepository() }).execute();
      return { ok: true, value: result } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listFeedbackIssuesAction(
  status?: FeedbackIssueStatus,
): Promise<ActionResult<readonly FeedbackIssueRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.listFeedbackIssues");
      const result = await new ListFeedbackIssues({ issues: feedbackIssueRepository() }).execute(
        status,
      );
      return { ok: true, value: result } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function markFeedbackIssueFixedAction(
  issueId: string,
): Promise<ActionResult<FeedbackIssueRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.markFeedbackIssueFixed");
        const result = await new MarkFeedbackIssueFixed({
          issues: feedbackIssueRepository(),
        }).execute({ issueId, staffUserId: principal.id, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { issueId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function reopenFeedbackIssueAction(
  issueId: string,
): Promise<ActionResult<FeedbackIssueRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.reopenFeedbackIssue");
        const result = await new ReopenFeedbackIssue({ issues: feedbackIssueRepository() }).execute(
          issueId,
        );
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { issueId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listUnansweredQuestionsAction(
  status?: UnansweredQuestionStatus,
): Promise<ActionResult<readonly UnansweredQuestionRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, ANALYTICS_PERMISSION, "commandCentre.listUnansweredQuestions");
      const result = await new ListUnansweredQuestions({
        questions: unansweredQuestionRepository(),
      }).execute(status);
      return { ok: true, value: result } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** `Omit<ResolveUnansweredQuestionInput, "staffUserId" | "now">` does not distribute
 *  cleanly over that port type's discriminated union (a well-known TypeScript `Omit`
 *  limitation — it computes `keyof` across the whole union rather than per-member), so
 *  this action declares its own equivalent three-branch union explicitly instead. */
export type ResolveUnansweredQuestionActionInput =
  | {
      readonly questionId: string;
      readonly resolution: "Knowledge";
      readonly knowledgeSourceId: string;
    }
  | { readonly questionId: string; readonly resolution: "Flow"; readonly flowId: string }
  | { readonly questionId: string; readonly resolution: "Dismiss" };

export async function resolveUnansweredQuestionAction(
  input: ResolveUnansweredQuestionActionInput,
): Promise<ActionResult<UnansweredQuestionRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(
          principal,
          ANALYTICS_PERMISSION,
          "commandCentre.resolveUnansweredQuestion",
        );
        const staffUserId = principal.id;
        const requestNow = now();
        const fullInput: ResolveUnansweredQuestionInput =
          input.resolution === "Knowledge"
            ? { ...input, staffUserId, now: requestNow }
            : input.resolution === "Flow"
              ? { ...input, staffUserId, now: requestNow }
              : { ...input, staffUserId, now: requestNow };
        const result = await new ResolveUnansweredQuestion({
          questions: unansweredQuestionRepository(),
        }).execute(fullInput);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
