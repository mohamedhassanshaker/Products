/**
 * The Neo4j/Qdrant half of a 4-store erasure — structural, not a live per-request query,
 * for a reason worth stating plainly rather than working around silently:
 *
 * 1. **ADR-0003's ownership table gives Neo4j and Qdrant to `shj3-ai` alone** — "the web
 *    tier never opens a graph or vector connection." `apps/web`'s own build gate
 *    (`no-unscoped-store-clients`) enforces this mechanically: a Neo4j driver or Qdrant
 *    client may only be constructed under `apps/ai/src/shj3_ai/adapters/outbound/{graph,vector}/`.
 *    A real, live Cypher/Qdrant query from this module would not merely be against
 *    convention, it would not connect.
 * 2. **`docs/data-model.md` §10.4's own erasure table documents both stores as structural
 *    no-ops for citizen data** — verbatim: "Neo4j: No-op (graph holds knowledge, not
 *    people)" and "Qdrant: No-op" — because ADR-0009's node-label allowlist
 *    (`Service|Provider|Fee|Document|Channel`) and Qdrant's payload schema
 *    (`chunk_id|collection_id|source_id|document_id|...`, confirmed by direct read of
 *    `qdrant_vector_store.py`) carry knowledge-base content only; neither store has ever
 *    had a citizen-scoped label, property, or payload field defined for it to query
 *    against in the first place.
 *
 * This verifier therefore reports the structural fact rather than a live count, which is
 * the honest answer available from `apps/web` today — and is named plainly, here and in
 * this module's final report, as a real, deliberate gap: a genuinely LIVE verification
 * (an actual Cypher/Qdrant query proving zero matches, not an inference from the schema)
 * would need a new `apps/ai` endpoint this wave does not own the file boundary to add.
 * `StructuralGraphVectorErasureVerifier` (the one real implementation) is not a fake —
 * it is correct for what it claims, and claims exactly this much and no more.
 */

export interface GraphVectorVerificationResult {
  readonly affectedCount: number;
  readonly verificationQuery: string;
}

export interface GraphVectorErasureVerifier {
  verify(store: "Neo4j" | "Qdrant"): Promise<GraphVectorVerificationResult>;
}
