import { Type, type Static } from "@sinclair/typebox";

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, LLD §14.4.4) — the two
 * TypeBox structured-output contracts the bounded retrieval agent's cheap planner
 * route calls use. Pure schema declarations (no I/O — `no-db-inside-domain`); the
 * actual model calls live in `application/retrieval/query-classifier.ts`/
 * `sufficiency-check.ts`, each passing one of these to
 * `callModelGatewayStructuredPinned` — never a hand-parsed free-text completion.
 */

/**
 * Query-classification output (Blueprint §7.5: "narrow entity questions -> local,
 * broad thematic -> global, no graph anchor found -> vector fallback"). This schema
 * only ever governs the choice between `GraphLocal`/`GraphGlobal` — the deterministic
 * anchor-entity check (`graph-repository.ts#findAnchorEntitiesByQueryMention`, reused
 * verbatim from Phase 9) decides the `Vector` fallback BEFORE this model call is ever
 * made (no anchor -> no point asking a model to classify narrow-vs-broad over a graph
 * that has nothing to anchor on — a real, disclosed cost-saving short-circuit, not an
 * approximation of the classifier).
 */
export const QueryClassificationSchema = Type.Object({
  scope: Type.Union([Type.Literal("narrow"), Type.Literal("broad")]),
  rationale: Type.String(),
});
export type QueryClassification = Static<typeof QueryClassificationSchema>;

/** LLD §14.4.4 step 4's `SufficiencySchema {sufficient, missingConcepts[]}` verbatim. */
export const SufficiencySchema = Type.Object({
  sufficient: Type.Boolean(),
  missingConcepts: Type.Array(Type.String()),
});
export type Sufficiency = Static<typeof SufficiencySchema>;

/** The bounded retrieval agent's final "answer from evidence" completion — a single
 *  synthesized paragraph, never hand-parsed JSON. */
export const RetrievalAnswerSchema = Type.Object({
  answer: Type.String({ minLength: 1 }),
});
export type RetrievalAnswer = Static<typeof RetrievalAnswerSchema>;
