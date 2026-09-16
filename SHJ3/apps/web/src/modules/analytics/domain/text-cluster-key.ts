/**
 * `FeedbackIssues.clusterKey` / `UnansweredQuestions.clusterKey` — both `@db.Char(64)`,
 * both unique. `ClusterFeedbackAndGaps`'s own doc comment names the honest first cut this
 * implements: **exact-match clustering on normalized question text**, not semantic/
 * embedding-based clustering this wave does not build. Two citizens asking
 * "Do you accept Apple Pay?" and "do you accept apple pay??" collapse to the same
 * cluster; two genuinely different questions never do. A later wave can replace
 * `normalizedTextClusterKey`'s call sites with a real embedding-similarity clusterer
 * without touching the schema, because the column is already a generic 64-char key, not
 * "the sha256 of normalized text" by contract.
 *
 * sha256 hex digest is exactly 64 hex characters, matching the column width precisely —
 * same reasoning `escalation/domain/routing-rule-hash.ts` already uses for
 * `RoutingRuleTests.ruleSetHash`, reused here rather than inventing a second hashing
 * convention.
 */

import { createHash } from "node:crypto";

/** Lowercase, collapse runs of whitespace, drop leading/trailing whitespace — the
 *  "near-exact match" half of the clustering rule. */
export function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizedTextClusterKey(text: string): string {
  return createHash("sha256").update(normalizeQuestionText(text)).digest("hex");
}
