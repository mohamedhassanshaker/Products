/**
 * "Make authoritative" — B6 tab 4 (FR-KNOW-20). A human choosing a side is **always**
 * allowed, regardless of `RetrievalConfig.defaultConflictPolicy` — that policy only gates
 * *automatic* resolution (FR-KNOW-19/22), and this wave builds no automatic-resolution code
 * path to gate at all (per this wave's own scope note: conflict *detection* during
 * ingestion, and any future auto-apply mechanism, are separate, later concerns). So this
 * use case never reads the policy — refusing only the one structural case a human action
 * cannot make sense of: the conflict is no longer `Open`.
 */

import type { ConflictRepository, SourceConflictRow } from "../ports/conflict-repository.js";
import type { ConflictSide } from "../domain/knowledge-catalog.js";

export interface ResolveConflictInput {
  readonly conflictId: string;
  readonly authoritativeSide: ConflictSide;
  readonly resolvedByStaffUserId: string;
  readonly now: Date;
}

export type ResolveConflictResult =
  | { readonly ok: true; readonly conflict: SourceConflictRow }
  | { readonly ok: false; readonly reason: "knowledge.conflict_not_open" };

export interface ResolveConflictDeps {
  readonly conflicts: ConflictRepository;
}

export class ResolveConflict {
  constructor(private readonly deps: ResolveConflictDeps) {}

  async execute(input: ResolveConflictInput): Promise<ResolveConflictResult> {
    const result = await this.deps.conflicts.resolve({
      id: input.conflictId,
      authoritativeSide: input.authoritativeSide,
      resolvedByStaffUserId: input.resolvedByStaffUserId,
      now: input.now,
    });
    if (!result.ok) return result;

    const conflict = await this.deps.conflicts.get(input.conflictId);
    if (!conflict) return { ok: false, reason: "knowledge.conflict_not_open" };
    return { ok: true, conflict };
  }
}
