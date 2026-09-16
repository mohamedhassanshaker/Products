/** In-memory fakes for every `analytics` port — same convention as `escalation/testing/
 *  fakes.ts`: constructor-free, `seed()` to prime state, deterministic fake ids. */

import type {
  AddGoldenCaseFromTranscriptInput,
  AddGoldenCaseFromTranscriptResult,
  GoldenCasePort,
} from "../ports/golden-case-port.js";
import type {
  ConversationExplorerRepository,
  ConversationListRow,
  ConversationOutcomeFilter,
  GoldenCaseSeed,
  TranscriptTurnRow,
} from "../ports/conversation-explorer-repository.js";
import type {
  ConversationMetricsDailyRow,
  IntentMetricsDailyRow,
  MetricsRepository,
  RawChannelDayAggregate,
  RawIntentDayAggregate,
} from "../ports/metrics-repository.js";
import type {
  FeedbackIssueRepository,
  FeedbackIssueRow,
  FeedbackIssueStatus,
} from "../ports/feedback-issue-repository.js";
import type {
  DownvotedTurnSignal,
  FeedbackSignalRepository,
  RefusedTurnSignal,
} from "../ports/feedback-signal-repository.js";
import type {
  NewTranscriptExportInput,
  TranscriptExportRepository,
  TranscriptExportRow,
} from "../ports/transcript-export-repository.js";
import type {
  UnansweredQuestionRepository,
  UnansweredQuestionRow,
  UnansweredQuestionStatus,
} from "../ports/unanswered-question-repository.js";

let idCounter = 0;
function fakeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_fake_${idCounter}`;
}

export class FakeMetricsRepository implements MetricsRepository {
  /** Seeded raw source data, keyed by `dateKey` — what
   *  `aggregateConversationsForDate`/`aggregateIntentsForDate` return, standing in for a
   *  real `Conversations`/`ConversationTurns`/... scan. */
  private readonly rawChannelByDate = new Map<string, RawChannelDayAggregate[]>();
  private readonly rawIntentByDate = new Map<string, RawIntentDayAggregate[]>();
  private readonly conversationMetrics = new Map<string, ConversationMetricsDailyRow>();
  private readonly intentMetrics = new Map<string, IntentMetricsDailyRow>();

  seedRawChannelDay(dateKey: string, rows: readonly RawChannelDayAggregate[]): void {
    this.rawChannelByDate.set(dateKey, [...rows]);
  }

  seedRawIntentDay(dateKey: string, rows: readonly RawIntentDayAggregate[]): void {
    this.rawIntentByDate.set(dateKey, [...rows]);
  }

  async aggregateConversationsForDate(dateKey: string): Promise<readonly RawChannelDayAggregate[]> {
    return this.rawChannelByDate.get(dateKey) ?? [];
  }

  async aggregateIntentsForDate(dateKey: string): Promise<readonly RawIntentDayAggregate[]> {
    return this.rawIntentByDate.get(dateKey) ?? [];
  }

  async upsertConversationMetrics(row: ConversationMetricsDailyRow, now: Date): Promise<void> {
    void now; // the fake has no createdAt bookkeeping to stamp
    this.conversationMetrics.set(`${row.metricDate}::${row.channelKey}`, row);
  }

  async upsertIntentMetrics(row: IntentMetricsDailyRow, now: Date): Promise<void> {
    void now;
    this.intentMetrics.set(`${row.metricDate}::${row.intentKey}`, row);
  }

  async listRolledUpDates(dateKeys: readonly string[]): Promise<ReadonlySet<string>> {
    const rolledUp = new Set([...this.conversationMetrics.values()].map((row) => row.metricDate));
    return new Set(dateKeys.filter((key) => rolledUp.has(key)));
  }

  async listConversationMetrics(
    dateKeys: readonly string[],
  ): Promise<readonly ConversationMetricsDailyRow[]> {
    const keySet = new Set(dateKeys);
    return [...this.conversationMetrics.values()].filter((row) => keySet.has(row.metricDate));
  }

  async listIntentMetrics(dateKeys: readonly string[]): Promise<readonly IntentMetricsDailyRow[]> {
    const keySet = new Set(dateKeys);
    return [...this.intentMetrics.values()].filter((row) => keySet.has(row.metricDate));
  }
}

export class FakeConversationExplorerRepository implements ConversationExplorerRepository {
  private readonly conversations = new Map<string, ConversationListRow>();
  private readonly transcripts = new Map<string, TranscriptTurnRow[]>();
  private readonly goldenCaseSeeds = new Map<string, GoldenCaseSeed>();

  seedConversation(row: ConversationListRow): void {
    this.conversations.set(row.id, row);
  }

  seedTranscript(conversationId: string, turns: readonly TranscriptTurnRow[]): void {
    this.transcripts.set(conversationId, [...turns]);
  }

  seedGoldenCaseSeed(conversationId: string, seed: GoldenCaseSeed): void {
    this.goldenCaseSeeds.set(conversationId, seed);
  }

  async list(
    filter: ConversationOutcomeFilter,
    limit: number,
  ): Promise<readonly ConversationListRow[]> {
    const all = [...this.conversations.values()].sort(
      (a, b) => b.lastTurnAt.getTime() - a.lastTurnAt.getTime(),
    );
    const filtered = filter === "All" ? all : all.filter((row) => row.outcome === filter);
    return filtered.slice(0, limit);
  }

  async getTranscript(conversationId: string): Promise<readonly TranscriptTurnRow[] | null> {
    if (!this.conversations.has(conversationId)) return null;
    return this.transcripts.get(conversationId) ?? [];
  }

  async findGoldenCaseSeed(conversationId: string): Promise<GoldenCaseSeed | null> {
    return this.goldenCaseSeeds.get(conversationId) ?? null;
  }
}

export class FakeGoldenCasePort implements GoldenCasePort {
  readonly calls: AddGoldenCaseFromTranscriptInput[] = [];
  private readonly addedConversationIds = new Set<string>();
  private caseCount = 0;
  knownGoldenSetIds = new Set<string>(["golden_set_1"]);

  async addFromTranscript(
    input: AddGoldenCaseFromTranscriptInput,
  ): Promise<AddGoldenCaseFromTranscriptResult> {
    this.calls.push(input);
    if (!this.knownGoldenSetIds.has(input.goldenSetId)) {
      return { ok: false, error: "evaluation.golden_set_not_found" };
    }
    if (this.addedConversationIds.has(input.sourceConversationId)) {
      return { ok: false, error: "evaluation.case_already_added" };
    }
    this.addedConversationIds.add(input.sourceConversationId);
    this.caseCount += 1;
    return { ok: true, value: { caseId: fakeId("case"), caseCount: this.caseCount } };
  }
}

export class FakeFeedbackIssueRepository implements FeedbackIssueRepository {
  private readonly rows = new Map<string, FeedbackIssueRow>();

  seed(row: FeedbackIssueRow): void {
    this.rows.set(row.id, row);
  }

  async list(status?: FeedbackIssueStatus): Promise<readonly FeedbackIssueRow[]> {
    const all = [...this.rows.values()].sort((a, b) => b.volume - a.volume);
    return status ? all.filter((row) => row.status === status) : all;
  }

  async findById(id: string): Promise<FeedbackIssueRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findByClusterKey(clusterKey: string): Promise<FeedbackIssueRow | null> {
    return [...this.rows.values()].find((row) => row.clusterKey === clusterKey) ?? null;
  }

  async upsertSeen(input: {
    readonly questionText: string;
    readonly clusterKey: string;
    readonly rootCause: FeedbackIssueRow["rootCause"];
    readonly seenAt: Date;
  }): Promise<FeedbackIssueRow> {
    const existing = await this.findByClusterKey(input.clusterKey);
    if (!existing) {
      const row: FeedbackIssueRow = {
        id: fakeId("issue"),
        questionText: input.questionText,
        clusterKey: input.clusterKey,
        volume: 1,
        rootCause: input.rootCause,
        status: "Open",
        linkedKnowledgeSourceId: null,
        linkedFlowId: null,
        linkedGoldenCaseId: null,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        fixedByStaffUserId: null,
        fixedAt: null,
      };
      this.rows.set(row.id, row);
      return row;
    }
    const updated: FeedbackIssueRow = {
      ...existing,
      volume: existing.volume + 1,
      rootCause: input.rootCause,
      lastSeenAt: input.seenAt,
    };
    this.rows.set(updated.id, updated);
    return updated;
  }

  async setStatus(
    id: string,
    input:
      | { readonly status: "Fixed"; readonly fixedByStaffUserId: string; readonly now: Date }
      | { readonly status: "Reopened" },
  ): Promise<FeedbackIssueRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Unknown feedback issue "${id}".`);
    const updated: FeedbackIssueRow =
      input.status === "Fixed"
        ? {
            ...existing,
            status: "Fixed",
            fixedByStaffUserId: input.fixedByStaffUserId,
            fixedAt: input.now,
          }
        : { ...existing, status: "Reopened", fixedByStaffUserId: null, fixedAt: null };
    this.rows.set(id, updated);
    return updated;
  }
}

export class FakeUnansweredQuestionRepository implements UnansweredQuestionRepository {
  private readonly rows = new Map<string, UnansweredQuestionRow>();

  seed(row: UnansweredQuestionRow): void {
    this.rows.set(row.id, row);
  }

  async list(status?: UnansweredQuestionStatus): Promise<readonly UnansweredQuestionRow[]> {
    const all = [...this.rows.values()].sort((a, b) => b.askCount - a.askCount);
    return status ? all.filter((row) => row.status === status) : all;
  }

  async findById(id: string): Promise<UnansweredQuestionRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findByClusterKey(clusterKey: string): Promise<UnansweredQuestionRow | null> {
    return [...this.rows.values()].find((row) => row.clusterKey === clusterKey) ?? null;
  }

  async upsertSeen(input: {
    readonly questionText: string;
    readonly clusterKey: string;
    readonly askedAt: Date;
  }): Promise<UnansweredQuestionRow> {
    const existing = await this.findByClusterKey(input.clusterKey);
    if (!existing) {
      const row: UnansweredQuestionRow = {
        id: fakeId("gap"),
        questionText: input.questionText,
        clusterKey: input.clusterKey,
        askCount: 1,
        firstAskedAt: input.askedAt,
        lastAskedAt: input.askedAt,
        status: "Open",
        resolutionKnowledgeSourceId: null,
        resolutionFlowId: null,
        resolvedByStaffUserId: null,
        resolvedAt: null,
      };
      this.rows.set(row.id, row);
      return row;
    }
    const updated: UnansweredQuestionRow = {
      ...existing,
      askCount: existing.askCount + 1,
      lastAskedAt: input.askedAt,
    };
    this.rows.set(updated.id, updated);
    return updated;
  }

  async resolve(
    id: string,
    input:
      | {
          readonly status: "ResolvedAsKnowledge";
          readonly resolutionKnowledgeSourceId: string;
          readonly resolvedByStaffUserId: string;
          readonly now: Date;
        }
      | {
          readonly status: "ResolvedAsFlow";
          readonly resolutionFlowId: string;
          readonly resolvedByStaffUserId: string;
          readonly now: Date;
        }
      | {
          readonly status: "Dismissed";
          readonly resolvedByStaffUserId: string;
          readonly now: Date;
        },
  ): Promise<UnansweredQuestionRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Unknown unanswered question "${id}".`);
    const updated: UnansweredQuestionRow =
      input.status === "ResolvedAsKnowledge"
        ? {
            ...existing,
            status: "ResolvedAsKnowledge",
            resolutionKnowledgeSourceId: input.resolutionKnowledgeSourceId,
            resolutionFlowId: null,
            resolvedByStaffUserId: input.resolvedByStaffUserId,
            resolvedAt: input.now,
          }
        : input.status === "ResolvedAsFlow"
          ? {
              ...existing,
              status: "ResolvedAsFlow",
              resolutionFlowId: input.resolutionFlowId,
              resolutionKnowledgeSourceId: null,
              resolvedByStaffUserId: input.resolvedByStaffUserId,
              resolvedAt: input.now,
            }
          : {
              ...existing,
              status: "Dismissed",
              resolutionKnowledgeSourceId: null,
              resolutionFlowId: null,
              resolvedByStaffUserId: input.resolvedByStaffUserId,
              resolvedAt: input.now,
            };
    this.rows.set(id, updated);
    return updated;
  }
}

export class FakeTranscriptExportRepository implements TranscriptExportRepository {
  readonly created: TranscriptExportRow[] = [];

  async create(input: NewTranscriptExportInput): Promise<TranscriptExportRow> {
    const row: TranscriptExportRow = {
      id: fakeId("export"),
      requestedByStaffUserId: input.requestedByStaffUserId,
      filterJson: input.filterJson,
      exportedRowCount: input.exportedRowCount,
      format: input.format,
      redactionApplied: true,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    };
    this.created.push(row);
    return row;
  }
}

export class FakeFeedbackSignalRepository implements FeedbackSignalRepository {
  private downvoted: DownvotedTurnSignal[] = [];
  private refused: RefusedTurnSignal[] = [];

  seedDownvotedTurns(rows: readonly DownvotedTurnSignal[]): void {
    this.downvoted = [...rows];
  }

  seedRefusedTurns(rows: readonly RefusedTurnSignal[]): void {
    this.refused = [...rows];
  }

  async listDownvotedTurns(since: Date): Promise<readonly DownvotedTurnSignal[]> {
    return this.downvoted.filter((row) => row.feedbackUpdatedAt >= since);
  }

  async listRefusedTurns(since: Date): Promise<readonly RefusedTurnSignal[]> {
    return this.refused.filter((row) => row.refusedAt >= since);
  }
}
