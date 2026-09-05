import { Type, type Static } from "@sinclair/typebox";

/**
 * The ExtractEntities stage's structured-output contract (LLD §14.4.3 stage 4) —
 * passed to `@nextbot/model-gateway`'s `callModelGatewayStructuredPinned`, which
 * itself re-validates the model's JSON with `Value.Check` (never hand-parsed free
 * text, per this project's AI-feature architecture rule).
 */
export const EntityExtractionSchema = Type.Object({
  entities: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      /** Open vocabulary (Person, Product, Policy, Amount, ...) — LLD §14.4.2's
       *  `graph_entity.type` is deliberately not an enum. */
      type: Type.String({ minLength: 1 }),
    }),
  ),
  relations: Type.Array(
    Type.Object({
      srcName: Type.String({ minLength: 1 }),
      relation: Type.String({ minLength: 1 }),
      dstName: Type.String({ minLength: 1 }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
  ),
});
export type EntityExtractionResult = Static<typeof EntityExtractionSchema>;

export const ENTITY_EXTRACTION_SYSTEM_PROMPT =
  "Extract named entities and their relations from the given text. Return only entities and " +
  "relations that are explicitly stated or directly implied by the text — never invent facts. " +
  "Each relation's confidence must reflect how directly the text supports it.";
