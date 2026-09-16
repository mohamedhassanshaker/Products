import type {
  GraphVectorErasureVerifier,
  GraphVectorVerificationResult,
} from "../../ports/graph-vector-erasure-verifier.js";

/**
 * The one real implementation of `GraphVectorErasureVerifier` — see the port's own module
 * comment for the full reasoning (ADR-0003's web/ai store-ownership split, and
 * `docs/data-model.md` §10.4's own "No-op" rows for Neo4j/Qdrant). Deliberately contains
 * no Neo4j driver or Qdrant client import — this file lives outside
 * `apps/ai/src/shj3_ai/adapters/outbound/{graph,vector}/`, so the `no-unscoped-store-clients`
 * gate would refuse the build if it tried.
 */
export class StructuralGraphVectorErasureVerifier implements GraphVectorErasureVerifier {
  async verify(store: "Neo4j" | "Qdrant"): Promise<GraphVectorVerificationResult> {
    if (store === "Neo4j") {
      return {
        affectedCount: 0,
        verificationQuery:
          "structural: ADR-0009's node-label allowlist (Service|Provider|Fee|Document|Channel) " +
          "carries knowledge-base content only — no citizen-scoped label or property has ever " +
          "been defined for this store (docs/data-model.md §10.4: 'graph holds knowledge, not " +
          "people'). No live Cypher query was run — apps/web cannot open a Neo4j connection " +
          "(ADR-0003); a genuinely live count requires a new apps/ai endpoint this wave does " +
          "not own.",
      };
    }
    return {
      affectedCount: 0,
      verificationQuery:
        "structural: the real Qdrant payload schema (chunk_id, collection_id, source_id, " +
        "document_id, locale, embedding_model, ..., source_owner_tenant) carries knowledge-" +
        "chunk content only — no citizen-scoped payload field exists to filter on. No live " +
        "Qdrant query was run — apps/web cannot open a Qdrant connection (ADR-0003); a " +
        "genuinely live count requires a new apps/ai endpoint this wave does not own.",
    };
  }
}
