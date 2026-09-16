/**
 * Composition helpers for `/evaluation` (B-9 Evaluation, governance & analytics) —
 * identical precedent to `escalations/composition.ts`: thin, stateless wrappers over
 * `getTenantDb()`/real adapters, constructed fresh per call, the one place in this route
 * allowed to name concrete adapters.
 */
import {
  PrismaGoldenSetRepository,
  PrismaGoldenCaseRepository,
} from "../../../../modules/evaluation/adapters/outbound/sql/prisma-golden-set-repository.js";
import { PrismaRegressionRunRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-regression-run-repository.js";
import { PrismaPublishGateRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-publish-gate-repository.js";
import { PrismaGateEvaluationRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-gate-evaluation-repository.js";
import { PrismaLocaleReadinessRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-locale-readiness-repository.js";
import { PrismaEvaluationConversationFactory } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-evaluation-conversation-factory.js";
import { AiServiceEvaluationClient } from "../../../../modules/evaluation/adapters/outbound/ai/ai-service-evaluation-client.js";
import { TenantAuditSink } from "../../../../modules/platform/adapters/outbound/sql/audit-sink.js";
import { PrismaAgentRepository } from "../../../../modules/agents/adapters/outbound/sql/prisma-agent-repository.js";

export function goldenSetRepository(): PrismaGoldenSetRepository {
  return new PrismaGoldenSetRepository();
}
export function goldenCaseRepository(): PrismaGoldenCaseRepository {
  return new PrismaGoldenCaseRepository();
}
export function regressionRunRepository(): PrismaRegressionRunRepository {
  return new PrismaRegressionRunRepository();
}
export function publishGateRepository(): PrismaPublishGateRepository {
  return new PrismaPublishGateRepository();
}
export function gateEvaluationRepository(): PrismaGateEvaluationRepository {
  return new PrismaGateEvaluationRepository();
}
export function localeReadinessRepository(): PrismaLocaleReadinessRepository {
  return new PrismaLocaleReadinessRepository();
}
export function evaluationConversationFactory(): PrismaEvaluationConversationFactory {
  return new PrismaEvaluationConversationFactory();
}
export function aiEvaluationClient(): AiServiceEvaluationClient {
  return new AiServiceEvaluationClient();
}
/** Writes `<tenant>.AuditLogEntries` — FR-EVAL-13's audited gate-config changes. */
export function auditSink(): TenantAuditSink {
  return new TenantAuditSink();
}
/** Read-only use here (agent/version display names for the gate summary strip and the
 *  gate-blocked publish message) — this route never writes through `agents`' own port. */
export function agentRepository(): PrismaAgentRepository {
  return new PrismaAgentRepository();
}

export function now(): Date {
  return new Date();
}
