/**
 * FR-TAKE-2/FR-TAKE-3's adaptive selection algorithm (LLD §8.6) — ported verbatim (logic unchanged)
 * from `legacy/api/src/modules/attempts/domain/adaptive-selection.ts`. Kept as pure, side-effect-free
 * functions — no TypeORM/module import at all — so the three-tier bucketing/shuffling logic is
 * directly unit-testable with an injectable RNG, matching this app's established `domain/**` convention
 * (e.g. `server/pdf-processing/domain/lesson-batch-planner.ts`).
 */

/** The minimal shape `selectAdaptiveQuestions` needs from one `exam_type_question` row — deliberately
 * a subset (not the full TypeORM entity) so this file never imports `infrastructure/**`. */
export interface AdaptiveCandidate {
  questionKey: string;
}

/** `questionKey -> most recent answer's correctness`, built from the member's full attempt history for
 * this Exam Type (LLD §8.6: "history: latest answer per question_key... keep first per key"). A key
 * absent from this map means "never attempted" (FR-TAKE-2's first, highest-priority tier). */
export type AnswerHistory = ReadonlyMap<string, boolean>;

/**
 * Thrown by {@link selectAdaptiveQuestions} when a module's bank cannot supply `requiredCount`
 * questions at all, regardless of history-tier. Deliberately does not know the module's *name* — that
 * context only exists in the caller (`AttemptsService`), which is what turns this into the
 * client-facing `InsufficientQuestionBankError('module', available, required)` (FR-TAKE-3).
 */
export class QuestionBankShortfallError extends Error {
  constructor(
    public readonly available: number,
    public readonly required: number,
  ) {
    super(`Only ${available} question(s) available, ${required} required.`);
  }
}

/**
 * FR-TAKE-2's per-module selection: "questions the Member has never attempted are prioritized first,
 * then questions previously answered incorrectly, then questions previously answered correctly — each
 * group independently shuffled — until the module's required count is filled."
 *
 * @throws {QuestionBankShortfallError} if `candidates.length < requiredCount` — a shortfall is checked
 *   against the *total* bank size up front (LLD §8.6's shortfall branch is unconditional on tier
 *   composition: even if every candidate happened to be "never attempted," a bank smaller than
 *   `requiredCount` can still never fill the module, so there is no tier-dependent case where this
 *   check should be skipped).
 */
export function selectAdaptiveQuestions<T extends AdaptiveCandidate>(
  candidates: readonly T[],
  history: AnswerHistory,
  requiredCount: number,
  rng: () => number = Math.random,
): T[] {
  if (candidates.length < requiredCount) {
    throw new QuestionBankShortfallError(candidates.length, requiredCount);
  }

  const neverAttempted: T[] = [];
  const previouslyWrong: T[] = [];
  const previouslyCorrect: T[] = [];

  for (const candidate of candidates) {
    const lastResult = history.get(candidate.questionKey);
    if (lastResult === undefined) {
      neverAttempted.push(candidate);
    } else if (lastResult === false) {
      previouslyWrong.push(candidate);
    } else {
      previouslyCorrect.push(candidate);
    }
  }

  // Each tier is shuffled *independently* (FR-TAKE-2) — shuffling only after bucketing, never
  // shuffling the flat candidate list first, is what keeps the priority ordering between tiers intact
  // while still randomizing within each one.
  shuffleInPlace(neverAttempted, rng);
  shuffleInPlace(previouslyWrong, rng);
  shuffleInPlace(previouslyCorrect, rng);

  return [...neverAttempted, ...previouslyWrong, ...previouslyCorrect].slice(0, requiredCount);
}

/** Fisher-Yates shuffle, in place, with an injectable RNG (defaults to `Math.random`) purely so unit
 * tests can supply a seeded/deterministic generator and assert exact orderings — every production call
 * site uses the default. Returns the same array reference for convenient chaining. */
export function shuffleInPlace<T>(items: T[], rng: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
