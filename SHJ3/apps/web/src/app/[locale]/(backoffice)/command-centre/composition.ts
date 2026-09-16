/**
 * Composition helpers for `/command-centre` (B1) — identical precedent to
 * `escalations/composition.ts`: thin, stateless wrappers over `getTenantDb()`,
 * constructed fresh per call, the one place in this route allowed to name concrete
 * adapters.
 *
 * `goldenCasePort()` is the one adapter here that crosses a feature boundary on
 * purpose: `modules/analytics/ports/golden-case-port.ts`'s own doc comment explains why
 * `modules/analytics` cannot import `modules/evaluation` directly (`eslint.config.mjs`'s
 * `boundaries/element-types` — both are listed `FEATURE_MODULES`). This file is the "app"
 * boundary type, which is allowed to compose both, so the real cross-module wiring lives
 * here: a thin pass-through from `GoldenCasePort` to `evaluation`'s real
 * `AddCaseFromTranscript` use case.
 */
import { PrismaMetricsRepository } from "../../../../modules/analytics/adapters/outbound/sql/prisma-metrics-repository.js";
import { PrismaConversationExplorerRepository } from "../../../../modules/analytics/adapters/outbound/sql/prisma-conversation-explorer-repository.js";
import { PrismaFeedbackIssueRepository } from "../../../../modules/analytics/adapters/outbound/sql/prisma-feedback-issue-repository.js";
import { PrismaUnansweredQuestionRepository } from "../../../../modules/analytics/adapters/outbound/sql/prisma-unanswered-question-repository.js";
import { PrismaFeedbackSignalRepository } from "../../../../modules/analytics/adapters/outbound/sql/prisma-feedback-signal-repository.js";
import { PrismaTranscriptExportRepository } from "../../../../modules/analytics/adapters/outbound/sql/prisma-transcript-export-repository.js";
import { ComputeDailyMetrics } from "../../../../modules/analytics/application/compute-daily-metrics.js";
import type {
  AddGoldenCaseFromTranscriptInput,
  AddGoldenCaseFromTranscriptResult,
  GoldenCasePort,
} from "../../../../modules/analytics/ports/golden-case-port.js";
import {
  PrismaGoldenCaseRepository,
  PrismaGoldenSetRepository,
} from "../../../../modules/evaluation/adapters/outbound/sql/prisma-golden-set-repository.js";
import { AddCaseFromTranscript } from "../../../../modules/evaluation/application/add-case-from-transcript.js";

export function metricsRepository(): PrismaMetricsRepository {
  return new PrismaMetricsRepository();
}
export function conversationExplorerRepository(): PrismaConversationExplorerRepository {
  return new PrismaConversationExplorerRepository();
}
export function feedbackIssueRepository(): PrismaFeedbackIssueRepository {
  return new PrismaFeedbackIssueRepository();
}
export function unansweredQuestionRepository(): PrismaUnansweredQuestionRepository {
  return new PrismaUnansweredQuestionRepository();
}
export function feedbackSignalRepository(): PrismaFeedbackSignalRepository {
  return new PrismaFeedbackSignalRepository();
}
export function transcriptExportRepository(): PrismaTranscriptExportRepository {
  return new PrismaTranscriptExportRepository();
}
export function computeDailyMetrics(): ComputeDailyMetrics {
  return new ComputeDailyMetrics({ metrics: metricsRepository() });
}

class EvaluationGoldenCaseAdapter implements GoldenCasePort {
  async addFromTranscript(
    input: AddGoldenCaseFromTranscriptInput,
  ): Promise<AddGoldenCaseFromTranscriptResult> {
    return new AddCaseFromTranscript({
      cases: new PrismaGoldenCaseRepository(),
      sets: new PrismaGoldenSetRepository(),
    }).execute(input);
  }
}

export function goldenCasePort(): GoldenCasePort {
  return new EvaluationGoldenCaseAdapter();
}

export function now(): Date {
  return new Date();
}
