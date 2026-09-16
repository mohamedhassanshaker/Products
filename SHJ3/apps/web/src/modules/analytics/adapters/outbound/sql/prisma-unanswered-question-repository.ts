import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  UnansweredQuestionRepository,
  UnansweredQuestionRow,
  UnansweredQuestionStatus,
} from "../../../ports/unanswered-question-repository.js";

function toRow(row: {
  id: string;
  questionText: string;
  clusterKey: string;
  askCount: number;
  firstAskedAt: Date;
  lastAskedAt: Date;
  status: string;
  resolutionKnowledgeSourceId: string | null;
  resolutionFlowId: string | null;
  resolvedByStaffUserId: string | null;
  resolvedAt: Date | null;
}): UnansweredQuestionRow {
  return {
    id: row.id,
    questionText: row.questionText,
    clusterKey: row.clusterKey,
    askCount: row.askCount,
    firstAskedAt: row.firstAskedAt,
    lastAskedAt: row.lastAskedAt,
    status: row.status as UnansweredQuestionStatus,
    resolutionKnowledgeSourceId: row.resolutionKnowledgeSourceId,
    resolutionFlowId: row.resolutionFlowId,
    resolvedByStaffUserId: row.resolvedByStaffUserId,
    resolvedAt: row.resolvedAt,
  };
}

export class PrismaUnansweredQuestionRepository implements UnansweredQuestionRepository {
  async list(status?: UnansweredQuestionStatus): Promise<readonly UnansweredQuestionRow[]> {
    const rows = await getTenantDb("unanswered questions list").unansweredQuestion.findMany({
      // `exactOptionalPropertyTypes` forbids `where: undefined` — omit the key entirely.
      ...(status ? { where: { status } } : {}),
      orderBy: { askCount: "desc" },
    });
    return rows.map(toRow);
  }

  async findById(id: string): Promise<UnansweredQuestionRow | null> {
    const row = await getTenantDb("unanswered question read").unansweredQuestion.findUnique({
      where: { id },
    });
    return row ? toRow(row) : null;
  }

  async findByClusterKey(clusterKey: string): Promise<UnansweredQuestionRow | null> {
    const row = await getTenantDb(
      "unanswered question read by cluster",
    ).unansweredQuestion.findUnique({ where: { clusterKey } });
    return row ? toRow(row) : null;
  }

  async upsertSeen(input: {
    readonly questionText: string;
    readonly clusterKey: string;
    readonly askedAt: Date;
  }): Promise<UnansweredQuestionRow> {
    const row = await getTenantDb("unanswered question upsert seen").unansweredQuestion.upsert({
      where: { clusterKey: input.clusterKey },
      create: {
        id: newUlid(input.askedAt),
        questionText: input.questionText,
        clusterKey: input.clusterKey,
        askCount: 1,
        firstAskedAt: input.askedAt,
        lastAskedAt: input.askedAt,
        status: "Open",
        createdAt: input.askedAt,
      },
      // Never touches status/resolution* here — same "don't silently un-resolve" rule
      // as `FeedbackIssueRepository.upsertSeen`.
      update: { askCount: { increment: 1 }, lastAskedAt: input.askedAt },
    });
    return toRow(row);
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
    // CK_UnansweredQuestions_resolutionPaired: whichever resolution field does not apply
    // to this status is explicitly nulled in the same write, never left at a stale value
    // from a previous resolution attempt.
    const data =
      input.status === "ResolvedAsKnowledge"
        ? {
            status: "ResolvedAsKnowledge",
            resolutionKnowledgeSourceId: input.resolutionKnowledgeSourceId,
            resolutionFlowId: null,
            resolvedByStaffUserId: input.resolvedByStaffUserId,
            resolvedAt: input.now,
            updatedAt: input.now,
          }
        : input.status === "ResolvedAsFlow"
          ? {
              status: "ResolvedAsFlow",
              resolutionFlowId: input.resolutionFlowId,
              resolutionKnowledgeSourceId: null,
              resolvedByStaffUserId: input.resolvedByStaffUserId,
              resolvedAt: input.now,
              updatedAt: input.now,
            }
          : {
              status: "Dismissed",
              resolutionKnowledgeSourceId: null,
              resolutionFlowId: null,
              resolvedByStaffUserId: input.resolvedByStaffUserId,
              resolvedAt: input.now,
              updatedAt: input.now,
            };
    const row = await getTenantDb("unanswered question resolve").unansweredQuestion.update({
      where: { id },
      data,
    });
    return toRow(row);
  }
}
