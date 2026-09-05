import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { FeedbackRepositoryPort } from '../domain/telemetry-ports';

/**
 * `Feedback` persistence (FR-CALL-4). One row per session — the unique
 * `session_id` index on the `Feedback` table is the actual duplicate-submit
 * guard (FR-CALL-4's `409 FEEDBACK_ALREADY_SUBMITTED`); the `existsForSession`
 * pre-check exists only so `SubmitFeedbackUseCase` can return the documented
 * error instead of surfacing a raw Prisma unique-constraint exception.
 */
@Injectable()
export class PrismaFeedbackRepository implements FeedbackRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async create(input: {
    sessionId: string;
    tenantId: string;
    rating: number;
    comment: string | null;
  }): Promise<'created' | 'duplicate'> {
    try {
      await this.prisma.withBypass(() =>
        this.prisma.db.feedback.create({
          data: {
            sessionId: input.sessionId,
            tenantId: input.tenantId,
            rating: input.rating,
            comment: input.comment,
          },
        }),
      );
      return 'created';
    } catch {
      // Unique-constraint violation on `session_id` — a race between the
      // pre-check and this write, or a client retry. Either way, the caller
      // treats this identically to the pre-check finding an existing row.
      return 'duplicate';
    }
  }

  /** @inheritdoc */
  async existsForSession(sessionId: string): Promise<boolean> {
    const row = await this.prisma.withBypass(() =>
      this.prisma.db.feedback.findUnique({ where: { sessionId } }),
    );
    return row !== null;
  }
}
