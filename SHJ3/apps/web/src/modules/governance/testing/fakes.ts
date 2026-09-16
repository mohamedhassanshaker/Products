/** In-memory fakes for every `governance` port — same convention as `escalation/testing/
 *  fakes.ts`: constructor-free, `seed()` to prime state, deterministic fake ids, every real
 *  invariant the real Prisma/trigger stack enforces reachable without a database. */

import type { AuditEntry, AuditSink } from "../../platform/ports/provisioning.js";
import {
  assertDecidable,
  assertFollowsChain,
  assertNotSelfApproval,
  type PromotionStatus,
} from "../domain/promotion.js";
import { allStoresVerifiedComplete, type ErasureTaskOutcome } from "../domain/erasure.js";
import type {
  GateDecision,
  PublishGateChecker,
} from "../../evaluation/ports/publish-gate-checker.js";
import type { EnvironmentRepository, EnvironmentRow } from "../ports/environment-repository.js";
import type {
  DecidePromotionInput,
  NewPromotionRequestInput,
  PromotionRequestRepository,
  PromotionRequestRow,
} from "../ports/promotion-repository.js";
import type {
  AuditLogEntryRow,
  AuditLogFilter,
  AuditLogPage,
  AuditLogRepository,
} from "../ports/audit-log-repository.js";
import type {
  PrivacyConfigRepository,
  PrivacyConfigRow,
  UpdatePrivacyConfigInput,
} from "../ports/privacy-config-repository.js";
import type {
  ErasureRequestRepository,
  ErasureRequestRow,
  ErasureTaskRow,
  NewErasureRequestInput,
  RecordTaskResultInput,
} from "../ports/erasure-request-repository.js";
import type { CitizenDataEraser, CitizenSqlErasureResult } from "../ports/citizen-data-eraser.js";
import type {
  CitizenCacheEraser,
  CitizenCacheErasureResult,
} from "../ports/citizen-cache-eraser.js";
import type {
  GraphVectorErasureVerifier,
  GraphVectorVerificationResult,
} from "../ports/graph-vector-erasure-verifier.js";
import type {
  OrchestrationStepSampleRepository,
  ServiceHealthRepository,
  ServiceHealthSampleRow,
  TraceStepSample,
  UpsertServiceHealthSampleInput,
} from "../ports/service-health-repository.js";
import type {
  RetentionCandidateConversation,
  RetentionSweepDataRepository,
  RetentionSweepRunRepository,
  RetentionSweepRunRow,
  StartRetentionSweepRunInput,
  FinishRetentionSweepRunInput,
} from "../ports/retention-sweep-repository.js";

let idCounter = 0;
function fakeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_fake_${idCounter}`;
}

/** No shared fake `AuditSink` existed anywhere in this codebase yet (grepped before
 *  writing this) — this module is the first to need one for a unit test; a real caller
 *  always uses `TenantAuditSink`/`PlatformAuditSink` (`modules/platform/adapters/outbound/
 *  sql/audit-sink.ts`). */
export class FakeAuditSink implements AuditSink {
  readonly recorded: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.recorded.push(entry);
  }
}

/** `evaluation`'s own port, faked here since `governance`'s `RequestPromotion` is the
 *  first consumer to need one in a unit test — a real caller uses `evaluation`'s own
 *  `PublishGateChecker` implementation. */
export class FakePublishGateChecker implements PublishGateChecker {
  decision: GateDecision = { passed: true };

  async evaluateForPublish(): Promise<GateDecision> {
    return this.decision;
  }

  async evaluateForPromotion(): Promise<GateDecision> {
    return this.decision;
  }

  async recordEvaluation(): Promise<{
    readonly gateEvaluationId: string;
    readonly decision: GateDecision;
  }> {
    return { gateEvaluationId: fakeId("gate_eval"), decision: this.decision };
  }
}

export class FakeEnvironmentRepository implements EnvironmentRepository {
  private readonly rows = new Map<string, EnvironmentRow>();

  seed(row: EnvironmentRow): void {
    this.rows.set(row.key, row);
  }

  async list(): Promise<readonly EnvironmentRow[]> {
    return [...this.rows.values()].sort((a, b) => a.ordinal - b.ordinal);
  }

  async findByKey(key: string): Promise<EnvironmentRow | null> {
    return this.rows.get(key) ?? null;
  }
}

/**
 * Reproduces the real trigger's three checks (`TR_PromotionRequests_decisionRules`) so
 * application-layer tests can exercise the same failure modes without a database — the
 * live DB is still the real proof (see the module's verification script); this fake is
 * what makes `RequestPromotion`/`ApprovePromotion`/`RejectPromotion`'s own unit tests
 * possible.
 */
export class FakePromotionRequestRepository implements PromotionRequestRepository {
  private readonly rows = new Map<string, PromotionRequestRow>();
  /** `key -> promotesToKey` — seeded alongside environments so `create()` can enforce the
   *  chain rule the same way the real trigger reads `platform.Environments`. */
  readonly environmentChain = new Map<string, string | null>();
  /** `agentVersionId -> passed` — seeded so `create()` can enforce the gate-must-pass
   *  rule for a promotion into whichever key is marked live. */
  readonly gateEvaluations = new Map<
    string,
    { readonly agentVersionId: string; readonly passed: boolean }
  >();
  liveEnvironmentKey: string | null = null;
  blockOnSuiteFailure = true;
  readonly versionSummaries = new Map<
    string,
    { readonly agentId: string; readonly agentName: string; readonly versionLabel: string }
  >();

  seed(row: PromotionRequestRow): void {
    this.rows.set(row.id, row);
  }

  seedVersionSummary(
    agentVersionId: string,
    summary: {
      readonly agentId: string;
      readonly agentName: string;
      readonly versionLabel: string;
    },
  ): void {
    this.versionSummaries.set(agentVersionId, summary);
  }

  async findById(id: string): Promise<PromotionRequestRow | null> {
    return this.rows.get(id) ?? null;
  }

  async listPending(): Promise<readonly PromotionRequestRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === "AwaitingApproval")
      .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  }

  async findVersionSummary(agentVersionId: string): Promise<{
    readonly agentId: string;
    readonly agentName: string;
    readonly versionLabel: string;
  } | null> {
    return this.versionSummaries.get(agentVersionId) ?? null;
  }

  async create(input: NewPromotionRequestInput): Promise<{ readonly id: string }> {
    assertFollowsChain(
      input.fromEnvironmentKey,
      input.toEnvironmentKey,
      this.environmentChain.get(input.fromEnvironmentKey) ?? null,
    );
    if (this.blockOnSuiteFailure && input.toEnvironmentKey === this.liveEnvironmentKey) {
      const evaluation = input.gateEvaluationId
        ? this.gateEvaluations.get(input.gateEvaluationId)
        : undefined;
      if (!evaluation || evaluation.agentVersionId !== input.agentVersionId || !evaluation.passed) {
        throw new Error(
          "Promotion to the live environment requires a passing gate evaluation for this version (B13 tab 3).",
        );
      }
    }

    const id = fakeId("promo");
    this.rows.set(id, {
      id,
      agentVersionId: input.agentVersionId,
      agentId: this.versionSummaries.get(input.agentVersionId)?.agentId ?? "unknown_agent",
      agentName: this.versionSummaries.get(input.agentVersionId)?.agentName ?? "Unknown agent",
      versionLabel: this.versionSummaries.get(input.agentVersionId)?.versionLabel ?? "v0.0",
      fromEnvironmentKey: input.fromEnvironmentKey,
      toEnvironmentKey: input.toEnvironmentKey,
      requestedByStaffUserId: input.requestedByStaffUserId,
      requestedAt: input.now,
      status: "AwaitingApproval",
      gateEvaluationId: input.gateEvaluationId,
      decidedByStaffUserId: null,
      decidedAt: null,
      decisionNote: null,
    });
    return { id };
  }

  async decide(id: string, input: DecidePromotionInput): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Unknown promotion request "${id}".`);
    assertDecidable(row.status as PromotionStatus);
    assertNotSelfApproval(row.requestedByStaffUserId, input.decidedByStaffUserId);
    this.rows.set(id, {
      ...row,
      status: input.status,
      decidedByStaffUserId: input.decidedByStaffUserId,
      decidedAt: input.now,
      decisionNote: input.decisionNote,
    });
  }
}

export class FakeAuditLogRepository implements AuditLogRepository {
  private readonly rows: AuditLogEntryRow[] = [];

  seed(row: AuditLogEntryRow): void {
    this.rows.push(row);
  }

  async list(filter: AuditLogFilter): Promise<AuditLogPage> {
    const limit = filter.limit ?? 50;
    let matching = this.rows.filter((row) => {
      if (filter.actorId && row.actorStaffUserId !== filter.actorId) return false;
      if (filter.action && row.action !== filter.action) return false;
      if (filter.environmentKey && row.environmentKey !== filter.environmentKey) return false;
      if (filter.targetKind && row.targetKind !== filter.targetKind) return false;
      if (filter.occurredAtFrom && row.occurredAt < filter.occurredAtFrom) return false;
      if (filter.occurredAtTo && row.occurredAt > filter.occurredAtTo) return false;
      if (
        filter.q &&
        !row.summary.includes(filter.q) &&
        !row.targetLabelSnapshot.includes(filter.q)
      )
        return false;
      return true;
    });
    matching = matching.sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : -1),
    );
    if (filter.cursor) {
      const cursorTime = new Date(filter.cursor.occurredAt).getTime();
      matching = matching.filter(
        (row) =>
          row.occurredAt.getTime() < cursorTime ||
          (row.occurredAt.getTime() === cursorTime && row.id < filter.cursor!.id),
      );
    }
    const page = matching.slice(0, limit);
    const hasMore = matching.length > limit;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last ? { occurredAt: last.occurredAt.toISOString(), id: last.id } : null,
    };
  }

  async get(id: string): Promise<AuditLogEntryRow | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }
}

export class FakePrivacyConfigRepository implements PrivacyConfigRepository {
  private row: PrivacyConfigRow | null = null;

  seed(row: PrivacyConfigRow): void {
    this.row = row;
  }

  async get(): Promise<PrivacyConfigRow | null> {
    return this.row;
  }

  async update(input: UpdatePrivacyConfigInput): Promise<PrivacyConfigRow> {
    this.row = {
      id: this.row?.id ?? fakeId("privacy"),
      consentLedgerEnabled: input.consentLedgerEnabled,
      honourErasureRequests: input.honourErasureRequests,
      transcriptRetention: input.transcriptRetention,
      dataResidency: input.dataResidency,
      updatedByStaffUserId: input.updatedByStaffUserId,
      updatedAt: input.now,
    };
    return this.row;
  }
}

export class FakeErasureRequestRepository implements ErasureRequestRepository {
  private readonly requests = new Map<string, ErasureRequestRow>();
  private readonly tasks = new Map<string, ErasureTaskRow[]>();

  async findById(id: string): Promise<ErasureRequestRow | null> {
    return this.requests.get(id) ?? null;
  }

  async list(): Promise<readonly ErasureRequestRow[]> {
    return [...this.requests.values()];
  }

  async create(input: NewErasureRequestInput): Promise<ErasureRequestRow> {
    const row: ErasureRequestRow = {
      id: fakeId("erasure"),
      subjectKind: input.subjectKind,
      subjectHash: input.subjectHash,
      citizenIdentityId: input.citizenIdentityId,
      receivedVia: input.receivedVia,
      requestedAt: input.now,
      status: "Received",
      rejectionReason: null,
      completedAt: null,
      verificationEvidenceJson: null,
    };
    this.requests.set(row.id, row);
    this.tasks.set(row.id, []);
    return row;
  }

  async listTasks(erasureRequestId: string): Promise<readonly ErasureTaskRow[]> {
    return this.tasks.get(erasureRequestId) ?? [];
  }

  async recordTaskResult(input: RecordTaskResultInput): Promise<ErasureTaskRow> {
    const existing = this.tasks.get(input.erasureRequestId) ?? [];
    const withoutStore = existing.filter((task) => task.store !== input.store);
    const row: ErasureTaskRow = {
      id: existing.find((task) => task.store === input.store)?.id ?? fakeId("erasure_task"),
      erasureRequestId: input.erasureRequestId,
      store: input.store,
      scopeDescription: input.scopeDescription,
      state: input.state,
      affectedCount: input.affectedCount,
      verificationQuery: input.verificationQuery,
      verifiedAt: input.verifiedAt,
      error: input.error,
    };
    this.tasks.set(input.erasureRequestId, [...withoutStore, row]);
    return row;
  }

  async markInProgress(id: string, now: Date): Promise<void> {
    const row = this.requests.get(id);
    if (!row) throw new Error(`Unknown erasure request "${id}".`);
    this.requests.set(id, { ...row, status: "InProgress" });
    void now;
  }

  async markCompleted(
    id: string,
    completedAt: Date,
    verificationEvidenceJson: string,
  ): Promise<void> {
    const row = this.requests.get(id);
    if (!row) throw new Error(`Unknown erasure request "${id}".`);
    const tasks = this.tasks.get(id) ?? [];
    const outcomes: ErasureTaskOutcome[] = tasks.map((task) => ({
      store: task.store,
      state: task.state,
      verifiedAt: task.verifiedAt,
    }));
    if (!allStoresVerifiedComplete(outcomes)) {
      throw new Error(
        "An erasure request cannot complete until all four store tasks are verified " +
          "(TR_ErasureRequests_completionRequiresAllStores).",
      );
    }
    this.requests.set(id, { ...row, status: "Completed", completedAt, verificationEvidenceJson });
  }

  async markRejected(id: string, rejectionReason: string, now: Date): Promise<void> {
    const row = this.requests.get(id);
    if (!row) throw new Error(`Unknown erasure request "${id}".`);
    this.requests.set(id, { ...row, status: "Rejected", rejectionReason });
    void now;
  }
}

export class FakeCitizenDataEraser implements CitizenDataEraser {
  result: CitizenSqlErasureResult = {
    affectedCount: 0,
    verificationQuery: "fake",
    transactionsSkipped: 0,
    purgedConversationIds: [],
  };

  async erase(): Promise<CitizenSqlErasureResult> {
    return this.result;
  }
}

export class FakeCitizenCacheEraser implements CitizenCacheEraser {
  result: CitizenCacheErasureResult = { affectedCount: 0, verificationQuery: "fake" };

  async eraseConversationKeys(): Promise<CitizenCacheErasureResult> {
    return this.result;
  }
}

export class FakeGraphVectorErasureVerifier implements GraphVectorErasureVerifier {
  async verify(store: "Neo4j" | "Qdrant"): Promise<GraphVectorVerificationResult> {
    return { affectedCount: 0, verificationQuery: `fake structural check for ${store}` };
  }
}

export class FakeServiceHealthRepository implements ServiceHealthRepository {
  private readonly rows = new Map<string, ServiceHealthSampleRow>();

  seed(row: ServiceHealthSampleRow): void {
    this.rows.set(`${row.targetKind}:${row.targetId ?? ""}:${row.targetKey ?? ""}`, row);
  }

  async listLatest(): Promise<readonly ServiceHealthSampleRow[]> {
    return [...this.rows.values()];
  }

  async upsert(input: UpsertServiceHealthSampleInput): Promise<ServiceHealthSampleRow> {
    const row: ServiceHealthSampleRow = {
      id: fakeId("health"),
      targetKind: input.targetKind,
      targetId: input.targetId,
      targetKey: input.targetKey,
      displayName: input.displayName,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      requestCount: input.requestCount,
      p95LatencyMs: input.p95LatencyMs,
      errorRate: input.errorRate,
      status: input.status,
    };
    this.rows.set(`${input.targetKind}:${input.targetId ?? ""}:${input.targetKey ?? ""}`, row);
    return row;
  }
}

export class FakeOrchestrationStepSampleRepository implements OrchestrationStepSampleRepository {
  private readonly steps: {
    kind: "ToolCall" | "Retrieval";
    startedAt: Date;
    sample: TraceStepSample;
  }[] = [];

  seed(kind: "ToolCall" | "Retrieval", startedAt: Date, sample: TraceStepSample): void {
    this.steps.push({ kind, startedAt, sample });
  }

  async listSteps(
    kind: "ToolCall" | "Retrieval",
    windowStart: Date,
    windowEnd: Date,
  ): Promise<readonly TraceStepSample[]> {
    return this.steps
      .filter(
        (row) => row.kind === kind && row.startedAt >= windowStart && row.startedAt < windowEnd,
      )
      .map((row) => row.sample);
  }
}

export class FakeRetentionSweepDataRepository implements RetentionSweepDataRepository {
  readonly conversations = new Map<
    string,
    RetentionCandidateConversation & { retentionExpiresAt: Date; erasedAt: Date | null }
  >();
  readonly turnCounts = new Map<string, number>();
  readonly traceCounts = new Map<string, number>();
  readonly transactionLinkCounts = new Map<string, number>();

  seed(
    row: RetentionCandidateConversation & { retentionExpiresAt: Date; erasedAt: Date | null },
  ): void {
    this.conversations.set(row.id, row);
  }

  async findConversationsPastRetention(
    now: Date,
    limit: number,
  ): Promise<readonly RetentionCandidateConversation[]> {
    return [...this.conversations.values()]
      .filter((row) => row.retentionExpiresAt.getTime() <= now.getTime() && row.erasedAt === null)
      .slice(0, limit)
      .map(({ id, redisSessionKey }) => ({ id, redisSessionKey }));
  }

  async deleteTurns(conversationId: string): Promise<number> {
    return this.turnCounts.get(conversationId) ?? 0;
  }

  async deleteTraces(conversationId: string): Promise<number> {
    return this.traceCounts.get(conversationId) ?? 0;
  }

  async nullTransactionLinks(conversationId: string): Promise<number> {
    return this.transactionLinkCounts.get(conversationId) ?? 0;
  }

  async markConversationErased(conversationId: string, now: Date): Promise<void> {
    const row = this.conversations.get(conversationId);
    if (row) this.conversations.set(conversationId, { ...row, erasedAt: now });
  }
}

export class FakeRetentionSweepRunRepository implements RetentionSweepRunRepository {
  private readonly rows = new Map<string, RetentionSweepRunRow>();

  async start(input: StartRetentionSweepRunInput): Promise<RetentionSweepRunRow> {
    const row: RetentionSweepRunRow = {
      id: fakeId("sweep"),
      scope: input.scope,
      retentionSetting: input.retentionSetting,
      cutoffAt: input.cutoffAt,
      conversationsPurged: 0,
      turnsPurged: 0,
      tracesPurged: 0,
      derivedMemoryPurged: 0,
      vectorsPurged: 0,
      graphNodesPurged: 0,
      redisKeysPurged: 0,
      transactionsSkipped: 0,
      state: "Running",
      startedAt: input.now,
      finishedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async finish(id: string, input: FinishRetentionSweepRunInput): Promise<RetentionSweepRunRow> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Unknown retention sweep run "${id}".`);
    const updated: RetentionSweepRunRow = { ...row, ...input };
    this.rows.set(id, updated);
    return updated;
  }

  async list(limit: number): Promise<readonly RetentionSweepRunRow[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }
}
