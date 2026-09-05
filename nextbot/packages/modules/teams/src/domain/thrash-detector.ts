/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-07, LLD §14.7.3 step 2) —
 * the routing-thrash guard: "a team's routing-thrash pattern (repeated delegation to
 * the same member with a materially similar payload) is detected and capped,
 * escalating rather than looping."
 *
 * Pure (`domain/`, no I/O). The executor supplies the prior payloads it has already
 * read from `delegation_event`; this file only decides.
 *
 * **Disclosed, deliberate narrowing.** LLD §14.7.3 writes the similarity test as
 * `cosine(payload embedding)`. This implementation computes a genuine cosine
 * similarity, but over a normalised **term-frequency vector** rather than a learned
 * embedding. Rationale, recorded rather than left implicit:
 *
 *  - An embedding call on every delegation hop puts a paid, network-dependent,
 *    latency-adding provider round trip on the hot path of a loop-BREAKING safety
 *    check — a check whose entire job is to fire reliably when the system is
 *    already misbehaving. A guard that can itself time out is not a guard.
 *  - Thrash is, by construction, *near-repetition*: a supervisor re-routing the same
 *    task to the same member produces payloads that are literally the same words,
 *    not merely semantically related ones. Lexical cosine detects exactly that case,
 *    which is the one FR-ORC-07 names.
 *  - `thrashWindow.similarityThreshold` keeps precisely its documented meaning (a
 *    cosine in `[0,1]`), so swapping in a real embedding later is a change of
 *    `similarityOf`'s body alone, with no schema, contract or config change.
 *
 * The trade-off this accepts: a supervisor that re-routes with a *paraphrased*
 * payload will not trip the similarity check. It is still capped — by
 * `maxDelegations`, which the Phase 6 evaluator enforces independently — so the
 * "never left to loop" guarantee does not rest on this heuristic alone.
 */

/** Lower-cased alphanumeric word tokens. Deliberately simple and deterministic: no
 * stemming or stop-word list, because both would make two runs of the same code
 * disagree across locales for no benefit to a near-repetition test. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function termFrequency(text: string): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokenize(text)) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

/**
 * Cosine similarity of two texts' term-frequency vectors, in `[0, 1]`.
 * Two empty texts are treated as identical (1) — an empty payload repeated is
 * still a repeat; one empty and one not are treated as unrelated (0).
 */
export function similarityOf(a: string, b: string): number {
  const va = termFrequency(a);
  const vb = termFrequency(b);
  if (va.size === 0 && vb.size === 0) return 1;
  if (va.size === 0 || vb.size === 0) return 0;

  let dot = 0;
  for (const [token, count] of va) dot += count * (vb.get(token) ?? 0);
  if (dot === 0) return 0;

  let normA = 0;
  for (const count of va.values()) normA += count * count;
  let normB = 0;
  for (const count of vb.values()) normB += count * count;

  // Clamped: floating-point accumulation over the dot product and the two norms can
  // land a mathematically-exact 1.0 at 1.0000000000000002, and a similarity above 1
  // is meaningless (and would make a `similarityThreshold: 1` config behave
  // non-deterministically depending on token count).
  return Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

export interface ThrashWindow {
  /** How many of the most recent prior hops TO THE SAME MEMBER are inspected. */
  repeats: number;
  /** Cosine at or above which two payloads count as "materially similar". */
  similarityThreshold: number;
}

export interface ThrashVerdict {
  thrashing: boolean;
  /** The highest similarity found within the window — surfaced into
   * `delegation_event.outcome_detail` so an operator can see how close the call was. */
  maxSimilarity: number;
  /** How many of the inspected hops were at or above the threshold. */
  similarCount: number;
}

/**
 * Decides whether delegating `candidatePayload` to a member would be routing thrash.
 *
 * @param candidatePayload the payload about to be handed to the member.
 * @param priorPayloadsToSameMember every prior payload already delegated to this
 *   SAME member in this run, oldest first. The executor supplies these from
 *   `delegation_event`; passing an empty array (a first delegation to this member)
 *   can never be thrash.
 * @param window the team version's own `limits.thrashWindow`.
 * @returns `thrashing: true` once the number of materially-similar prior hops within
 *   the inspected window reaches `repeats` — i.e. the candidate would be the
 *   `repeats + 1`-th materially identical delegation to the same member. The
 *   executor routes that to `failureMode` (escalate), never to another attempt.
 */
export function detectThrash(
  candidatePayload: string,
  priorPayloadsToSameMember: string[],
  window: ThrashWindow,
): ThrashVerdict {
  const inspected = priorPayloadsToSameMember.slice(-window.repeats);
  let maxSimilarity = 0;
  let similarCount = 0;
  for (const prior of inspected) {
    const similarity = similarityOf(candidatePayload, prior);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
    if (similarity >= window.similarityThreshold) similarCount += 1;
  }
  return { thrashing: similarCount >= window.repeats, maxSimilarity, similarCount };
}
