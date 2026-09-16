/** In-memory fakes for every `evaluation` port — same convention as `escalation/testing/
 *  fakes.ts`: constructor-free (or factory-built where two ports share state), `seed()` to
 *  prime state, deterministic fake ids, every real invariant this module's real Prisma
 *  adapters enforce (the `TR_GoldenCases_recount` trigger, `UQ_GoldenCases_
 *  sourceConversation`, `UQ_RegressionRuns_active`) reachable without a database — surfaced
 *  as the identical `{code:"P2002"}`-shaped error a real Prisma unique-constraint violation
 *  throws, so application-layer error translation is tested against the same shape either
 *  way. */

import type {
  AiEvaluationClient,
  EvaluationTurnResult,
  ExecuteEvaluationTurnInput,
} from "../ports/ai-evaluation-client.js";
import type {
  EvaluationConversationFactory,
  NewEvaluationConversationInput,
} from "../ports/evaluation-conversation-factory.js";
import type {
  GateEvaluationRepository,
  GateEvaluationRow,
  RecordGateEvaluationInput,
} from "../ports/gate-evaluation-repository.js";
import type {
  GoldenCaseRepository,
  GoldenCaseRow,
  GoldenSetRepository,
  GoldenSetRow,
  NewGoldenCaseInput,
  NewGoldenSetInput,
  UpdateGoldenCaseInput,
} from "../ports/golden-set-repository.js";
import type {
  BoundLocaleReadinessRow,
  LocaleReadinessRepository,
} from "../ports/locale-readiness-repository.js";
import type {
  PublishGateRepository,
  PublishGateRow,
  UpdatePublishGateInput,
} from "../ports/publish-gate-repository.js";
import type { AuditEntry, AuditSink } from "../../platform/ports/provisioning.js";
import type {
  FinishRegressionRunInput,
  LatestSetRunRow,
  NewRegressionCaseResultInput,
  RegressionCaseResultRow,
  RegressionRunRepository,
  RegressionRunRow,
  StartRegressionRunInput,
} from "../ports/regression-run-repository.js";

let idCounter = 0;
function fakeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_fake_${idCounter}`;
}

/** Mirrors a real Prisma `P2002` unique-constraint violation's shape exactly — the one
 *  property (`error as {code?:string}).code`) every real translation call site reads. */
class FakeUniqueConstraintViolation extends Error {
  readonly code = "P2002";
  constructor(constraint: string) {
    super(`Unique constraint violation: ${constraint}`);
    this.name = "FakeUniqueConstraintViolation";
  }
}

const ACTIVE_STATES = new Set(["Queued", "Running"]);

/**
 * `GoldenSet`/`GoldenCase` share one internal store, because
 * `TR_GoldenCases_recount` is a real, load-bearing side effect this module's own tests
 * (`add-case-from-transcript.test.ts`) assert on — a case insert/soft-delete must be
 * visible as the parent set's own `caseCount` without the test ever computing it itself.
 */
export function createGoldenSetFakes(): {
  readonly sets: FakeFacadeGoldenSetRepository;
  readonly cases: FakeFacadeGoldenCaseRepository;
} {
  const setRows = new Map<string, GoldenSetRow>();
  const caseRows = new Map<string, GoldenCaseRow>();

  function recount(goldenSetId: string): void {
    const set = setRows.get(goldenSetId);
    if (!set) return;
    const count = [...caseRows.values()].filter((c) => c.goldenSetId === goldenSetId).length;
    setRows.set(goldenSetId, { ...set, caseCount: count });
  }

  const sets: FakeFacadeGoldenSetRepository = {
    seed(row: GoldenSetRow) {
      setRows.set(row.id, row);
    },
    async list() {
      return [...setRows.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async findById(id) {
      return setRows.get(id) ?? null;
    },
    async create(input: NewGoldenSetInput) {
      const row: GoldenSetRow = {
        id: fakeId("gs"),
        name: input.name,
        ownerTenantId: input.ownerTenantId,
        description: input.description,
        kind: input.kind,
        localeCode: input.localeCode,
        caseCount: 0,
        lastScore: null,
        lastRunAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      setRows.set(row.id, row);
      return row;
    },
    async updateScore(id, score, at) {
      const row = setRows.get(id);
      if (!row) return;
      setRows.set(id, { ...row, lastScore: score, lastRunAt: at, updatedAt: at });
    },
  };

  const cases: FakeFacadeGoldenCaseRepository = {
    seed(row: GoldenCaseRow) {
      caseRows.set(row.id, row);
      recount(row.goldenSetId);
    },
    async listForSet(goldenSetId) {
      return [...caseRows.values()]
        .filter((c) => c.goldenSetId === goldenSetId && c.isEnabled)
        .sort((a, b) => a.ordinal - b.ordinal);
    },
    async findById(id) {
      return caseRows.get(id) ?? null;
    },
    async nextOrdinal(goldenSetId) {
      const max = Math.max(
        0,
        ...[...caseRows.values()]
          .filter((c) => c.goldenSetId === goldenSetId)
          .map((c) => c.ordinal),
      );
      return max + 1;
    },
    async add(input: NewGoldenCaseInput) {
      if (input.sourceConversationId !== null) {
        const collision = [...caseRows.values()].some(
          (c) =>
            c.goldenSetId === input.goldenSetId &&
            c.sourceConversationId === input.sourceConversationId,
        );
        if (collision) throw new FakeUniqueConstraintViolation("UQ_GoldenCases_sourceConversation");
      }
      const ordinal = await cases.nextOrdinal(input.goldenSetId);
      const row: GoldenCaseRow = {
        id: fakeId("gc"),
        goldenSetId: input.goldenSetId,
        ordinal,
        prompt: input.prompt,
        expectedBehaviour: input.expectedBehaviour,
        expectedToolCallsJson: input.expectedToolCallsJson,
        expectedCitationSourceIdsJson: input.expectedCitationSourceIdsJson,
        mustRefuse: input.mustRefuse,
        localeCode: input.localeCode,
        sourceConversationId: input.sourceConversationId,
        addedByStaffUserId: input.addedByStaffUserId,
        addedAt: input.now,
        isEnabled: true,
        createdAt: input.now,
        updatedAt: input.now,
      };
      caseRows.set(row.id, row);
      recount(row.goldenSetId);
      return row;
    },
    async update(id, patch: UpdateGoldenCaseInput) {
      const row = caseRows.get(id);
      if (!row) throw new Error(`Unknown golden case "${id}".`);
      const updated: GoldenCaseRow = {
        ...row,
        prompt: patch.prompt ?? row.prompt,
        expectedBehaviour: patch.expectedBehaviour ?? row.expectedBehaviour,
        expectedToolCallsJson: patch.expectedToolCallsJson ?? row.expectedToolCallsJson,
        expectedCitationSourceIdsJson:
          patch.expectedCitationSourceIdsJson ?? row.expectedCitationSourceIdsJson,
        mustRefuse: patch.mustRefuse ?? row.mustRefuse,
        localeCode: patch.localeCode ?? row.localeCode,
        isEnabled: patch.isEnabled ?? row.isEnabled,
        updatedAt: patch.now,
      };
      caseRows.set(id, updated);
      return updated;
    },
    async remove(id, now) {
      const row = caseRows.get(id);
      if (!row) return;
      caseRows.delete(id);
      recount(row.goldenSetId);
      void now;
    },
  };

  return { sets, cases };
}

interface FakeFacadeGoldenSetRepository extends GoldenSetRepository {
  seed(row: GoldenSetRow): void;
}
interface FakeFacadeGoldenCaseRepository extends GoldenCaseRepository {
  seed(row: GoldenCaseRow): void;
}

export class FakeRegressionRunRepository implements RegressionRunRepository {
  private readonly runs = new Map<string, RegressionRunRow>();
  private readonly results = new Map<string, RegressionCaseResultRow[]>();

  seedRun(row: RegressionRunRow): void {
    this.runs.set(row.id, row);
  }

  async start(input: StartRegressionRunInput): Promise<RegressionRunRow> {
    const collision = [...this.runs.values()].find(
      (r) =>
        r.goldenSetId === input.goldenSetId &&
        r.agentVersionId === input.agentVersionId &&
        ACTIVE_STATES.has(r.state),
    );
    if (collision) throw new FakeUniqueConstraintViolation("UQ_RegressionRuns_active");

    const row: RegressionRunRow = {
      id: fakeId("run"),
      goldenSetId: input.goldenSetId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      triggeredBy: input.triggeredBy,
      state: "Running",
      accuracy: null,
      groundedness: null,
      toolAccuracy: null,
      localeParity: null,
      result: null,
      casesTotal: input.casesTotal,
      casesPassed: 0,
      startedAt: input.now,
      finishedAt: null,
      ranByStaffUserId: input.ranByStaffUserId,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.runs.set(row.id, row);
    return row;
  }

  async finish(input: FinishRegressionRunInput): Promise<void> {
    const row = this.runs.get(input.regressionRunId);
    if (!row) return;
    this.runs.set(input.regressionRunId, {
      ...row,
      state: "Completed",
      result: input.result,
      accuracy: input.accuracy,
      groundedness: input.groundedness,
      toolAccuracy: input.toolAccuracy,
      localeParity: input.localeParity,
      casesPassed: input.casesPassed,
      finishedAt: input.finishedAt,
      updatedAt: input.finishedAt,
    });
  }

  async markFailed(regressionRunId: string, finishedAt: Date): Promise<void> {
    const row = this.runs.get(regressionRunId);
    if (!row) return;
    this.runs.set(regressionRunId, { ...row, state: "Failed", finishedAt, updatedAt: finishedAt });
  }

  async addCaseResult(input: NewRegressionCaseResultInput): Promise<RegressionCaseResultRow> {
    const row: RegressionCaseResultRow = {
      id: fakeId("caseresult"),
      regressionRunId: input.regressionRunId,
      goldenCaseId: input.goldenCaseId,
      passed: input.passed,
      accuracyScore: input.accuracyScore,
      groundednessScore: input.groundednessScore,
      toolAccuracyScore: input.toolAccuracyScore,
      actualResponse: input.actualResponse,
      actualToolCallsJson: input.actualToolCallsJson,
      failureReason: input.failureReason,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const existing = this.results.get(input.regressionRunId) ?? [];
    this.results.set(input.regressionRunId, [...existing, row]);
    return row;
  }

  async listRecent(limit = 100): Promise<readonly RegressionRunRow[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async findById(id: string): Promise<RegressionRunRow | null> {
    return this.runs.get(id) ?? null;
  }

  async listCaseResults(regressionRunId: string): Promise<readonly RegressionCaseResultRow[]> {
    return this.results.get(regressionRunId) ?? [];
  }

  async hasAnyCompletedRunForVersion(agentVersionId: string): Promise<boolean> {
    return [...this.runs.values()].some(
      (r) => r.agentVersionId === agentVersionId && r.state === "Completed",
    );
  }

  async listLatestCompletedRunsForVersion(
    agentVersionId: string,
  ): Promise<readonly LatestSetRunRow[]> {
    const completed = [...this.runs.values()]
      .filter((r) => r.agentVersionId === agentVersionId && r.state === "Completed")
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const seen = new Set<string>();
    const result: LatestSetRunRow[] = [];
    for (const run of completed) {
      if (seen.has(run.goldenSetId)) continue;
      seen.add(run.goldenSetId);
      const kind = this.setKindByGoldenSetId.get(run.goldenSetId) ?? "Journey";
      const name = this.setNameByGoldenSetId.get(run.goldenSetId) ?? run.goldenSetId;
      result.push({
        goldenSetId: run.goldenSetId,
        goldenSetName: name,
        kind,
        accuracy: run.accuracy,
        groundedness: run.groundedness,
      });
    }
    return result;
  }

  async findActive(goldenSetId: string, agentVersionId: string): Promise<RegressionRunRow | null> {
    return (
      [...this.runs.values()].find(
        (r) =>
          r.goldenSetId === goldenSetId &&
          r.agentVersionId === agentVersionId &&
          ACTIVE_STATES.has(r.state),
      ) ?? null
    );
  }

  /** Test-only wiring so `listLatestCompletedRunsForVersion` can report a real set
   *  name/kind without this fake depending on `FakeGoldenSetRepository` directly. */
  readonly setKindByGoldenSetId = new Map<string, LatestSetRunRow["kind"]>();
  readonly setNameByGoldenSetId = new Map<string, string>();
  seedSetMeta(goldenSetId: string, name: string, kind: LatestSetRunRow["kind"]): void {
    this.setNameByGoldenSetId.set(goldenSetId, name);
    this.setKindByGoldenSetId.set(goldenSetId, kind);
  }
}

export class FakePublishGateRepository implements PublishGateRepository {
  private row: PublishGateRow | null = null;

  seed(row: PublishGateRow): void {
    this.row = row;
  }

  async getOrCreateDefault(seedStaffUserId: string, now: Date): Promise<PublishGateRow> {
    if (this.row) return this.row;
    this.row = {
      id: fakeId("gate"),
      blockOnSuiteFailure: true,
      minAccuracy: 0.85,
      minGroundedness: 0.8,
      redTeamMustScore100: true,
      blockOnBoundLocaleBelow100: true,
      updatedByStaffUserId: seedStaffUserId,
      createdAt: now,
      updatedAt: now,
    };
    return this.row;
  }

  async update(input: UpdatePublishGateInput): Promise<PublishGateRow> {
    const current =
      this.row ?? (await this.getOrCreateDefault(input.updatedByStaffUserId, input.now));
    this.row = {
      ...current,
      blockOnSuiteFailure: input.blockOnSuiteFailure,
      minAccuracy: input.minAccuracy,
      minGroundedness: input.minGroundedness,
      redTeamMustScore100: input.redTeamMustScore100,
      blockOnBoundLocaleBelow100: input.blockOnBoundLocaleBelow100,
      updatedByStaffUserId: input.updatedByStaffUserId,
      updatedAt: input.now,
    };
    return this.row;
  }
}

export class FakeGateEvaluationRepository implements GateEvaluationRepository {
  private readonly rows: GateEvaluationRow[] = [];

  async record(input: RecordGateEvaluationInput): Promise<GateEvaluationRow> {
    const row: GateEvaluationRow = {
      id: fakeId("gateeval"),
      agentVersionId: input.agentVersionId,
      evaluatedAt: input.evaluatedAt,
      passed: input.passed,
      gateSnapshotJson: JSON.stringify(input.gateSnapshot),
      blockingReasonsJson:
        input.blockingReasons === null ? null : JSON.stringify(input.blockingReasons),
      evaluatedForKind: input.evaluatedForKind,
      promotionRequestId: null,
      createdAt: input.evaluatedAt,
      updatedAt: input.evaluatedAt,
    };
    this.rows.push(row);
    return row;
  }

  async findMostRecentForVersion(agentVersionId: string): Promise<GateEvaluationRow | null> {
    const matches = this.rows
      .filter((r) => r.agentVersionId === agentVersionId)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
    return matches[0] ?? null;
  }

  async findMostRecentlyBlockedPublish(): Promise<GateEvaluationRow | null> {
    const matches = this.rows
      .filter((r) => !r.passed && r.evaluatedForKind === "Publish")
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
    return matches[0] ?? null;
  }
}

export class FakeLocaleReadinessRepository implements LocaleReadinessRepository {
  private readonly rows = new Map<string, BoundLocaleReadinessRow[]>();

  seed(agentVersionId: string, readiness: readonly BoundLocaleReadinessRow[]): void {
    this.rows.set(agentVersionId, [...readiness]);
  }

  async listForVersion(agentVersionId: string): Promise<readonly BoundLocaleReadinessRow[]> {
    return this.rows.get(agentVersionId) ?? [];
  }
}

export class FakeAuditSink implements AuditSink {
  readonly recorded: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.recorded.push(entry);
  }
}

export class FakeEvaluationConversationFactory implements EvaluationConversationFactory {
  readonly created: NewEvaluationConversationInput[] = [];

  async create(input: NewEvaluationConversationInput): Promise<string> {
    this.created.push(input);
    return fakeId("conv");
  }
}

/**
 * `seedTurn`/`seedSimilarity` are consumed FIFO per matching key so a test can script a
 * whole golden set's worth of cases deterministically; `defaultSimilarity` covers any
 * call a test didn't bother scripting explicitly (kept high, so an un-scripted case reads
 * as "passing" unless a test deliberately arranges otherwise).
 */
export class FakeAiEvaluationClient implements AiEvaluationClient {
  private readonly turnQueueByPrompt = new Map<string, EvaluationTurnResult[]>();
  private readonly similarityByPair = new Map<string, number>();
  defaultSimilarity = 0.95;
  readonly executedTurns: ExecuteEvaluationTurnInput[] = [];

  seedTurn(prompt: string, result: EvaluationTurnResult): void {
    const queue = this.turnQueueByPrompt.get(prompt) ?? [];
    queue.push(result);
    this.turnQueueByPrompt.set(prompt, queue);
  }

  seedSimilarity(actual: string, expected: string, similarity: number): void {
    this.similarityByPair.set(`${actual} ${expected}`, similarity);
  }

  async executeTurn(input: ExecuteEvaluationTurnInput): Promise<EvaluationTurnResult> {
    this.executedTurns.push(input);
    const queue = this.turnQueueByPrompt.get(input.prompt);
    const next = queue?.shift();
    if (next) return next;
    return {
      status: "completed",
      messageText: `(unscripted fake response to: ${input.prompt})`,
      wasRefused: false,
      groundingConfidence: 0.9,
      toolCalls: [],
    };
  }

  async scoreSimilarity(actual: string, expected: string): Promise<number> {
    return this.similarityByPair.get(`${actual} ${expected}`) ?? this.defaultSimilarity;
  }
}
