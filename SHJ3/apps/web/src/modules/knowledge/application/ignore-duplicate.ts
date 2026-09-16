/**
 * "Ignore" — B6 tab 2's duplicate queue (FR-KNOW-09): suppresses the candidate from future
 * detection until its supporting data changes. Mirrors `merge-duplicate.ts` exactly, minus
 * the survivor/absorbed pairing (`CK_GraphMergeDecisions_mergePaired` only requires those
 * two columns together for `decision = 'Merge'`).
 */

import type { GraphRepository } from "../ports/graph-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";

export interface IgnoreDuplicateInput {
  readonly candidateId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type IgnoreDuplicateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "knowledge.candidate_not_found" }
  | { readonly ok: false; readonly reason: "knowledge.candidate_not_open" };

export interface IgnoreDuplicateDeps {
  readonly graph: GraphRepository;
  readonly ai: KnowledgeAiClient;
}

export class IgnoreDuplicate {
  constructor(private readonly deps: IgnoreDuplicateDeps) {}

  async execute(input: IgnoreDuplicateInput): Promise<IgnoreDuplicateResult> {
    const candidate = await this.deps.graph.getDuplicateCandidate(input.candidateId);
    if (!candidate) return { ok: false, reason: "knowledge.candidate_not_found" };
    if (candidate.state !== "Open") return { ok: false, reason: "knowledge.candidate_not_open" };

    const [left, right] = await Promise.all([
      this.deps.graph.getNode(candidate.leftNodeRecordId),
      this.deps.graph.getNode(candidate.rightNodeRecordId),
    ]);
    if (!left || !right) return { ok: false, reason: "knowledge.candidate_not_found" };

    await this.deps.graph.recordMergeDecision({
      graphDuplicateCandidateId: candidate.id,
      decision: "Ignore",
      survivingNodeRecordId: null,
      absorbedNodeRecordId: null,
      decidedByStaffUserId: input.actorStaffUserId,
      now: input.now,
    });
    await this.deps.graph.setDuplicateCandidateState(candidate.id, "Ignored", input.now);
    await this.deps.ai.ignoreDuplicate({
      keepCanonicalKey: left.canonicalKey,
      absorbCanonicalKey: right.canonicalKey,
    });

    return { ok: true };
  }
}
