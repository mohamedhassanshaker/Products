/**
 * Pure rules for `PUT/DELETE .../turns/{turnId}/feedback` (api.md §4.2).
 *
 * `Up`/`Down` is `MessageFeedback.rating`'s real closed vocabulary
 * (`prisma/tenant/schema.prisma`'s own comment: `CK_MessageFeedback_rating
 * CHECK (rating IN ('Up','Down'))`) — used verbatim rather than an
 * OpenAI-shaped guess (lessons.md's own recorded gotcha for this exact class
 * of mistake).
 */

export const FEEDBACK_RATINGS = ["Up", "Down"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export function isFeedbackRating(value: string): value is FeedbackRating {
  return (FEEDBACK_RATINGS as readonly string[]).includes(value);
}

/** api.md §4.2: "a third distinct submission within 1s is `409 feedback.already_recorded`". */
export const FEEDBACK_DOUBLE_CLICK_WINDOW_SECONDS = 1;

/**
 * Real, simple implementation of the double-click guard: the adapter keeps a
 * short-lived per-turn submission counter (`INCR` + `EXPIRE
 * FEEDBACK_DOUBLE_CLICK_WINDOW_SECONDS` on the first increment of a window —
 * i.e. a fixed, not sliding, 1-second window) and passes the count *after*
 * incrementing here. The first two submissions inside one window are allowed
 * (create, then one re-rate); the third is refused. This is a documented
 * simplification of "double-click guard" as a fixed-window counter rather
 * than a true sliding-window/distinct-value comparison — proportionate to
 * what the acceptance criterion asks for, and easy to tighten later without
 * changing this function's signature.
 */
export function exceedsFeedbackSubmissionBudget(countWithinWindow: number): boolean {
  return countWithinWindow > 2;
}
