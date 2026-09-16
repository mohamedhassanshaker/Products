import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { FeedbackRootCause } from "../../../domain/feedback-root-cause.js";
import type {
  FeedbackIssueRepository,
  FeedbackIssueRow,
  FeedbackIssueStatus,
} from "../../../ports/feedback-issue-repository.js";

function toRow(row: {
  id: string;
  questionText: string;
  clusterKey: string;
  volume: number;
  rootCause: string;
  status: string;
  linkedKnowledgeSourceId: string | null;
  linkedFlowId: string | null;
  linkedGoldenCaseId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  fixedByStaffUserId: string | null;
  fixedAt: Date | null;
}): FeedbackIssueRow {
  return {
    id: row.id,
    questionText: row.questionText,
    clusterKey: row.clusterKey,
    volume: row.volume,
    rootCause: row.rootCause as FeedbackRootCause,
    status: row.status as FeedbackIssueStatus,
    linkedKnowledgeSourceId: row.linkedKnowledgeSourceId,
    linkedFlowId: row.linkedFlowId,
    linkedGoldenCaseId: row.linkedGoldenCaseId,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    fixedByStaffUserId: row.fixedByStaffUserId,
    fixedAt: row.fixedAt,
  };
}

export class PrismaFeedbackIssueRepository implements FeedbackIssueRepository {
  async list(status?: FeedbackIssueStatus): Promise<readonly FeedbackIssueRow[]> {
    // `exactOptionalPropertyTypes` forbids `where: undefined` outright — omitting the
    // key entirely (rather than setting it to `undefined`) is what that flag requires.
    const rows = await getTenantDb("feedback issues list").feedbackIssue.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { volume: "desc" },
    });
    return rows.map(toRow);
  }

  async findById(id: string): Promise<FeedbackIssueRow | null> {
    const row = await getTenantDb("feedback issue read").feedbackIssue.findUnique({
      where: { id },
    });
    return row ? toRow(row) : null;
  }

  async findByClusterKey(clusterKey: string): Promise<FeedbackIssueRow | null> {
    const row = await getTenantDb("feedback issue read by cluster").feedbackIssue.findUnique({
      where: { clusterKey },
    });
    return row ? toRow(row) : null;
  }

  async upsertSeen(input: {
    readonly questionText: string;
    readonly clusterKey: string;
    readonly rootCause: FeedbackRootCause;
    readonly seenAt: Date;
  }): Promise<FeedbackIssueRow> {
    const row = await getTenantDb("feedback issue upsert seen").feedbackIssue.upsert({
      where: { clusterKey: input.clusterKey },
      create: {
        id: newUlid(input.seenAt),
        questionText: input.questionText,
        clusterKey: input.clusterKey,
        volume: 1,
        rootCause: input.rootCause,
        status: "Open",
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        createdAt: input.seenAt,
      },
      // Status/fixedAt/fixedByStaffUserId are never touched here — a re-seen issue does
      // not silently un-resolve a fix a staff member already recorded.
      update: { volume: { increment: 1 }, rootCause: input.rootCause, lastSeenAt: input.seenAt },
    });
    return toRow(row);
  }

  async setStatus(
    id: string,
    input:
      | { readonly status: "Fixed"; readonly fixedByStaffUserId: string; readonly now: Date }
      | { readonly status: "Reopened" },
  ): Promise<FeedbackIssueRow> {
    const db = getTenantDb("feedback issue set status");
    const row =
      input.status === "Fixed"
        ? await db.feedbackIssue.update({
            where: { id },
            data: {
              status: "Fixed",
              fixedByStaffUserId: input.fixedByStaffUserId,
              fixedAt: input.now,
              updatedAt: input.now,
            },
          })
        : await db.feedbackIssue.update({
            where: { id },
            data: { status: "Reopened", fixedByStaffUserId: null, fixedAt: null },
          });
    return toRow(row);
  }
}
