/**
 * `Conversations.wasContained` — whether a conversation was resolved without human
 * involvement (`docs/requirements.md`'s own containment-rate definition, `[ASSUMPTION]`
 * per RISK-008, but unambiguous on the one point that matters here: human involvement is
 * exactly what an `Escalated` outcome records).
 *
 * A real bug found live (B-9, 2026-09-10): `PrismaConversationRepository.create()` seeds
 * every new conversation `wasContained: true` (correct — nothing has escalated yet), but
 * neither `close()` nor `markEscalated()` ever cleared it back to `false` when the outcome
 * later became `Escalated` — so a real conversation could carry `outcome: "Escalated"`
 * *and* `wasContained: true` at once, an internal contradiction `modules/analytics`'s
 * `PrismaMetricsRepository.aggregateConversationsForDate()` counts independently into
 * `escalatedCount` and `containedCount` respectively, which is exactly the double-count
 * `CK_ConversationMetricsDaily_coherent` (`containedCount + escalatedCount + abandonedCount
 * <= conversationCount`) exists to catch — and did, the first time `ComputeDailyMetrics`
 * ran against a real conversation that had actually been escalated.
 *
 * **Deliberately monotonic, one direction only.** This function answers "does reaching
 * `outcome` force `wasContained` to `false`", never the reverse — a conversation later
 * closed `Resolved` (its open ticket already resolved/released by the time the citizen's
 * own `close` call lands) still had real human involvement earlier in its life, so `close()`
 * must never use this to flip `wasContained` back to `true`. Both real write paths
 * (`close`, `markEscalated`) only ever *set* `wasContained: false` when this returns `true`
 * for the outcome they are writing, and otherwise leave the column untouched — never write
 * `true` here, only omit the field.
 */
export function containmentClearedBy(outcome: string): boolean {
  return outcome === "Escalated";
}
