import { Type, type Static } from "@sinclair/typebox";

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18, LLD §14.9.3) — the
 * judge model's own structured-output contract. Passed to `@nextbot/model-
 * gateway`'s `callModelGatewayStructuredPinned` (TypeBox + the framework's
 * structured-output facility, validated again on the way back) — never
 * hand-parsed JSON from a free-text completion (the AI-features architecture
 * rule this whole codebase follows).
 */
export const JudgeVerdictSchema = Type.Object(
  {
    /** Per-criterion score (0-1) + a short rationale, keyed by `EvalRubricCriterion.id`. */
    criteria: Type.Record(Type.String(), Type.Object({ score: Type.Number({ minimum: 0, maximum: 1 }), rationale: Type.String() })),
    /** Weighted average across `criteria`, computed by the judge itself so the
     * weighting the rubric author declared is applied consistently. */
    overallScore: Type.Number({ minimum: 0, maximum: 1 }),
    /** Present only when the case is retrieval-scoped and citations were
     * supplied in the prompt — never fabricated when no citations exist. */
    citationPrecision: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    /** The judge's own pass/fail call against a reasonable bar for the rubric —
     * distinct from `overallScore` so a rubric author isn't forced to also
     * configure a numeric cutoff for the common case. */
    passed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type JudgeVerdict = Static<typeof JudgeVerdictSchema>;
