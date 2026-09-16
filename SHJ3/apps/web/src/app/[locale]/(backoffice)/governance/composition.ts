/**
 * Composition helpers for `/governance` (B14) — identical precedent to `escalations/
 * composition.ts`: thin, stateless wrappers over `getTenantDb()`/`getTenantCache()`,
 * constructed fresh per call, the one place in this route allowed to name concrete
 * adapters.
 */
import { PrismaEnvironmentRepository } from "../../../../modules/governance/adapters/outbound/sql/prisma-environment-repository.js";
import { PrismaPromotionRequestRepository } from "../../../../modules/governance/adapters/outbound/sql/prisma-promotion-repository.js";
import { PrismaAuditLogRepository } from "../../../../modules/governance/adapters/outbound/sql/prisma-audit-log-repository.js";
import { PrismaPrivacyConfigRepository } from "../../../../modules/governance/adapters/outbound/sql/prisma-privacy-config-repository.js";
import { PrismaErasureRequestRepository } from "../../../../modules/governance/adapters/outbound/sql/prisma-erasure-request-repository.js";
import { PrismaCitizenDataEraser } from "../../../../modules/governance/adapters/outbound/sql/prisma-citizen-data-eraser.js";
import { RedisCitizenCacheEraser } from "../../../../modules/governance/adapters/outbound/cache/redis-citizen-cache-eraser.js";
import { StructuralGraphVectorErasureVerifier } from "../../../../modules/governance/adapters/outbound/structural-graph-vector-erasure-verifier.js";
import {
  PrismaOrchestrationStepSampleRepository,
  PrismaServiceHealthRepository,
} from "../../../../modules/governance/adapters/outbound/sql/prisma-service-health-repository.js";
import { PrismaRetentionSweepDataRepository } from "../../../../modules/governance/adapters/outbound/sql/prisma-retention-sweep-data-repository.js";
import { PrismaRetentionSweepRunRepository } from "../../../../modules/governance/adapters/outbound/sql/prisma-retention-sweep-run-repository.js";
import { TenantAuditSink } from "../../../../modules/platform/adapters/outbound/sql/audit-sink.js";
import { EvaluateGateForVersion } from "../../../../modules/evaluation/application/evaluate-gate-for-version.js";
import { PrismaPublishGateRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-publish-gate-repository.js";
import { PrismaRegressionRunRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-regression-run-repository.js";
import { PrismaLocaleReadinessRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-locale-readiness-repository.js";
import { PrismaGateEvaluationRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-gate-evaluation-repository.js";

export function environmentRepository(): PrismaEnvironmentRepository {
  return new PrismaEnvironmentRepository();
}
export function promotionRequestRepository(): PrismaPromotionRequestRepository {
  return new PrismaPromotionRequestRepository();
}
export function auditLogRepository(): PrismaAuditLogRepository {
  return new PrismaAuditLogRepository();
}
export function privacyConfigRepository(): PrismaPrivacyConfigRepository {
  return new PrismaPrivacyConfigRepository();
}
export function erasureRequestRepository(): PrismaErasureRequestRepository {
  return new PrismaErasureRequestRepository();
}
export function citizenDataEraser(): PrismaCitizenDataEraser {
  return new PrismaCitizenDataEraser();
}
export function citizenCacheEraser(): RedisCitizenCacheEraser {
  return new RedisCitizenCacheEraser();
}
export function graphVectorErasureVerifier(): StructuralGraphVectorErasureVerifier {
  return new StructuralGraphVectorErasureVerifier();
}
export function serviceHealthRepository(): PrismaServiceHealthRepository {
  return new PrismaServiceHealthRepository();
}
export function orchestrationStepSampleRepository(): PrismaOrchestrationStepSampleRepository {
  return new PrismaOrchestrationStepSampleRepository();
}
export function retentionSweepDataRepository(): PrismaRetentionSweepDataRepository {
  return new PrismaRetentionSweepDataRepository();
}
export function retentionSweepRunRepository(): PrismaRetentionSweepRunRepository {
  return new PrismaRetentionSweepRunRepository();
}
/** Reused directly rather than duplicated — see `application/UpdatePrivacyConfig.ts`'s
 *  own doc comment. */
export function auditSink(): TenantAuditSink {
  return new TenantAuditSink();
}
/**
 * FR-GOV-13/14's real publish-gate check ahead of a promotion targeting the live
 * environment (`TR_PromotionRequests_decisionRules`'s own DB-level check is the backstop;
 * this is the proactive, informative front end — FR-EVAL-08's "name the blocking set, its
 * score and the threshold" applies here too). Wired identically to `agents/composition.ts`'s
 * own `publishGateChecker()` — the same real `EvaluateGateForVersion` instance shape, since
 * both routes are `app`-classified composition roots, not feature modules, so naming the
 * concrete cross-module class here is sanctioned the same way. Replaces a placeholder
 * (always `passed:true`) this route briefly shipped with, built while `modules/evaluation`
 * was still landing in a parallel wave — see `git log` on this file for that history.
 */
export function publishGateChecker(): EvaluateGateForVersion {
  return new EvaluateGateForVersion({
    gate: new PrismaPublishGateRepository(),
    runs: new PrismaRegressionRunRepository(),
    locales: new PrismaLocaleReadinessRepository(),
    evaluations: new PrismaGateEvaluationRepository(),
  });
}

export function now(): Date {
  return new Date();
}
