/** `SourceConflicts` — B6 tab 4. This wave's scope is CRUD/resolution over already-detected rows; conflict *detection* during ingestion is a separate, later concern (see the knowledge route's own module comment). */

import type { ConflictPolicy, ConflictSide, ConflictStatus } from "../domain/knowledge-catalog.js";

export interface SourceConflictRow {
  readonly id: string;
  readonly topic: string;
  readonly graphEntityKey: string;
  readonly sideAChunkId: string;
  readonly sideAKnowledgeSourceId: string;
  readonly sideAKnowledgeSourceName: string;
  readonly sideAValue: string;
  readonly sideASourceUpdatedAt: Date;
  readonly sideBChunkId: string;
  readonly sideBKnowledgeSourceId: string;
  readonly sideBKnowledgeSourceName: string;
  readonly sideBValue: string;
  readonly sideBSourceUpdatedAt: Date;
  readonly detectedAt: Date;
  readonly status: ConflictStatus;
  readonly policyAtDetection: ConflictPolicy;
  readonly authoritativeSide: ConflictSide | null;
  readonly resolvedByStaffUserId: string | null;
  readonly resolvedAt: Date | null;
  readonly groundingPenalty: number;
}

export interface ConflictRepository {
  list(): Promise<readonly SourceConflictRow[]>;
  get(id: string): Promise<SourceConflictRow | null>;

  /**
   * FR-KNOW-20: a human choosing a side is **always** allowed, regardless of the tenant's
   * `defaultConflictPolicy` — that policy only gates *automatic* resolution, which this
   * wave does not build (no automatic-resolution code path exists to gate at all). Refuses
   * only the structural case: the conflict is not `Open`.
   */
  resolve(input: {
    readonly id: string;
    readonly authoritativeSide: ConflictSide;
    readonly resolvedByStaffUserId: string;
    readonly now: Date;
  }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: "knowledge.conflict_not_open" }
  >;
}
