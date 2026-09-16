/**
 * "Detect duplicates" — B6 tab 2 (FR-KNOW-09). Calls the AI service's similarity detector
 * and upserts every candidate into the authoritative `GraphDuplicateCandidates` queue —
 * SQL is authoritative for the detected-candidate queue (data-model.md §6.4).
 *
 * A candidate naming a canonical key this tenant has no `GraphNodeRecord` for yet is
 * skipped with a logged warning rather than fabricating a node record for it — that would
 * silently invent an `Extracted` entity this tenant's own ingestion never actually produced.
 */

import type { GraphDuplicateCandidateRow, GraphRepository } from "../ports/graph-repository.js";
import type { DetectDuplicatesInput, KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import { isDuplicateDetectionMethod } from "../domain/knowledge-catalog.js";

export interface DetectDuplicatesDeps {
  readonly graph: GraphRepository;
  readonly ai: KnowledgeAiClient;
}

export interface DetectDuplicatesResult {
  readonly candidates: readonly GraphDuplicateCandidateRow[];
}

export class DetectDuplicates {
  constructor(private readonly deps: DetectDuplicatesDeps) {}

  async execute(
    input: DetectDuplicatesInput & { readonly now: Date },
  ): Promise<DetectDuplicatesResult> {
    const detected = await this.deps.ai.detectDuplicates({ label: input.label });

    const candidates: GraphDuplicateCandidateRow[] = [];
    for (const candidate of detected.candidates) {
      const left = await this.deps.graph.findNodeByCanonicalKey(
        input.label,
        candidate.leftCanonicalKey,
      );
      const right = await this.deps.graph.findNodeByCanonicalKey(
        input.label,
        candidate.rightCanonicalKey,
      );
      if (!left || !right) {
        console.warn(
          `[detect-duplicates] skipping a candidate pair referencing an unknown node ("${candidate.leftCanonicalKey}" / "${candidate.rightCanonicalKey}").`,
        );
        continue;
      }
      if (!isDuplicateDetectionMethod(candidate.detectionMethod)) {
        console.warn(
          `[detect-duplicates] skipping a candidate with an unrecognized detectionMethod "${candidate.detectionMethod}".`,
        );
        continue;
      }
      const upserted = await this.deps.graph.upsertDuplicateCandidate({
        leftNodeRecordId: left.id,
        rightNodeRecordId: right.id,
        similarity: candidate.similarity,
        detectionMethod: candidate.detectionMethod,
        now: input.now,
      });
      candidates.push(upserted);
    }

    return { candidates };
  }
}
