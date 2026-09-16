import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isFeedbackRating, type FeedbackRating } from "../../../domain/feedback.js";
import type { FeedbackRepository, FeedbackRow } from "../../../ports/feedback-repository.js";

export class PrismaFeedbackRepository implements FeedbackRepository {
  async find(turnId: string): Promise<FeedbackRow | null> {
    const row = await getTenantDb().messageFeedback.findUnique({ where: { turnId } });
    if (!row || !isFeedbackRating(row.rating)) return null;
    return {
      turnId: row.turnId,
      rating: row.rating,
      submittedByCitizen: row.submittedByCitizen,
      updatedAt: row.updatedAt,
    };
  }

  async upsert(turnId: string, rating: FeedbackRating, now: Date): Promise<FeedbackRow> {
    const row = await getTenantDb().messageFeedback.upsert({
      where: { turnId },
      create: {
        id: newUlid(now),
        turnId,
        rating,
        submittedByCitizen: true,
        createdAt: now,
      },
      update: { rating, updatedAt: now },
    });
    return {
      turnId: row.turnId,
      rating: rating,
      submittedByCitizen: row.submittedByCitizen,
      updatedAt: row.updatedAt,
    };
  }

  async remove(turnId: string): Promise<void> {
    await getTenantDb().messageFeedback.deleteMany({ where: { turnId } });
  }
}
