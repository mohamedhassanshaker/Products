/**
 * "Merge" — B6 tab 2's duplicate queue (FR-KNOW-09). Keeps the candidate's `leftNode` as
 * survivor and absorbs `rightNode`, a fixed, deterministic choice matching this wave's
 * single-button UI (no side-chooser is in scope — the wireframe offers Merge/Ignore only).
 * Writes the durable `GraphMergeDecision` first, then applies the merge onto Neo4j.
 */

import type { GraphRepository } from "../ports/graph-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";

export interface MergeDuplicateInput {
  readonly candidateId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type MergeDuplicateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "knowledge.candidate_not_found" }
  | { readonly ok: false; readonly reason: "knowledge.candidate_not_open" };

export interface MergeDuplicateDeps {
  readonly graph: GraphRepository;
  readonly ai: KnowledgeAiClient;
}

export class MergeDuplicate {
  constructor(private readonly deps: MergeDuplicateDeps) {}

  async execute(input: MergeDuplicateInput): Promise<MergeDuplicateResult> {
    const candidate = await this.deps.graph.getDuplicateCandidate(input.candidateId);
    if (!candidate) return { ok: false, reason: "knowledge.candidate_not_found" };
    if (candidate.state !== "Open") return { ok: false, reason: "knowledge.candidate_not_open" };

    const [survivor, absorbed] = await Promise.all([
      this.deps.graph.getNode(candidate.leftNodeRecordId),
      this.deps.graph.getNode(candidate.rightNodeRecordId),
    ]);
    if (!survivor || !absorbed) return { ok: false, reason: "knowledge.candidate_not_found" };

    await this.deps.graph.recordMergeDecision({
      graphDuplicateCandidateId: candidate.id,
      decision: "Merge",
      survivingNodeRecordId: survivor.id,
      absorbedNodeRecordId: absorbed.id,
      decidedByStaffUserId: input.actorStaffUserId,
      now: input.now,
    });
    await this.deps.graph.setDuplicateCandidateState(candidate.id, "Merged", input.now);
    await this.deps.ai.mergeDuplicate({
      keepCanonicalKey: survivor.canonicalKey,
      absorbCanonicalKey: absorbed.canonicalKey,
    });

    return { ok: true };
  }
}
