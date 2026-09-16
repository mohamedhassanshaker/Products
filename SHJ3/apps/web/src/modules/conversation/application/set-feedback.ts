/** `PUT`/`DELETE /api/public/v1/turns/{turnId}/feedback` (api.md §4.2). */

import { exceedsFeedbackSubmissionBudget, isFeedbackRating } from "../domain/feedback.js";
import type { FeedbackRepository, FeedbackRow } from "../ports/feedback-repository.js";
import type { TurnCoordination } from "../ports/turn-coordination.js";

export class InvalidFeedbackRatingError extends Error {
  readonly code = "validation.failed";
  readonly status = 422;
  constructor() {
    super('rating must be "up" or "down".');
    this.name = "InvalidFeedbackRatingError";
  }
}

export class FeedbackAlreadyRecordedError extends Error {
  readonly code = "feedback.already_recorded";
  readonly status = 409;
  constructor() {
    super("A third distinct submission within one second was refused (double-click guard).");
    this.name = "FeedbackAlreadyRecordedError";
  }
}

/** Wire vocabulary is lowercase (`"up"`/`"down"`, api.md §4.2's own example) even though the stored column is `Up`/`Down` — this is the one, explicit translation point. */
const WIRE_TO_STORED: Readonly<Record<string, "Up" | "Down">> = { up: "Up", down: "Down" };

export class SetFeedback {
  constructor(
    private readonly deps: {
      readonly feedback: FeedbackRepository;
      readonly coordination: TurnCoordination;
    },
  ) {}

  async execute(input: {
    readonly turnId: string;
    readonly rating: string;
    readonly now: Date;
  }): Promise<FeedbackRow> {
    const stored = WIRE_TO_STORED[input.rating];
    if (!stored || !isFeedbackRating(stored)) throw new InvalidFeedbackRatingError();

    const count = await this.deps.coordination.incrementFeedbackSubmissionCount(input.turnId);
    if (exceedsFeedbackSubmissionBudget(count)) throw new FeedbackAlreadyRecordedError();

    return this.deps.feedback.upsert(input.turnId, stored, input.now);
  }

  async remove(turnId: string): Promise<void> {
    await this.deps.feedback.remove(turnId);
  }
}
