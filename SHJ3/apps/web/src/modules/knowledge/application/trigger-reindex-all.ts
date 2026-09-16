/** "Re-index all sources now" — B6 tab 3 (FR-KNOW-16). Refuses a second concurrent tenant-wide job (mirrors `UQ_ReindexJobs_activeTenantScope`'s real backstop) rather than let the database reject it as an opaque constraint violation. Only *creates* the `Queued` job — `RunReindexJob` executes it; the Server Action runs both, in that order, for the same "immediate backoffice feedback, no separate worker" reason the outbox is processed inline after `add-source`. */

import type {
  NewReindexJobInput,
  ReindexJobRepository,
  ReindexJobRow,
} from "../ports/reindex-job-repository.js";

export type TriggerReindexAllResult =
  | { readonly ok: true; readonly job: ReindexJobRow }
  | { readonly ok: false; readonly reason: "knowledge.reindex_already_running" };

export interface TriggerReindexAllDeps {
  readonly reindexJobs: ReindexJobRepository;
}

export class TriggerReindexAll {
  constructor(private readonly deps: TriggerReindexAllDeps) {}

  async execute(input: {
    readonly ranByStaffUserId: string;
    readonly now: Date;
  }): Promise<TriggerReindexAllResult> {
    const active = await this.deps.reindexJobs.findActiveTenantScopeJob();
    if (active) return { ok: false, reason: "knowledge.reindex_already_running" };

    const jobInput: NewReindexJobInput = {
      scope: "Tenant",
      knowledgeSourceId: null,
      knowledgeCollectionId: null,
      reason: "Manual",
      targetEmbeddingModel: null,
      ranByStaffUserId: input.ranByStaffUserId,
      now: input.now,
    };
    const job = await this.deps.reindexJobs.create(jobInput);
    return { ok: true, job };
  }
}
