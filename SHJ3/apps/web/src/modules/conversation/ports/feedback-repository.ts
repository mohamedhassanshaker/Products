import type { FeedbackRating } from "../domain/feedback.js";

export interface FeedbackRow {
  readonly turnId: string;
  readonly rating: FeedbackRating;
  readonly submittedByCitizen: boolean;
  readonly updatedAt: Date;
}

export interface FeedbackRepository {
  find(turnId: string): Promise<FeedbackRow | null>;
  /** Create or replace — api.md §4.2: "`PUT` because it is idempotent and re-settable." */
  upsert(turnId: string, rating: FeedbackRating, now: Date): Promise<FeedbackRow>;
  remove(turnId: string): Promise<void>;
}
