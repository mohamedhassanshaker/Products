import type { RouterConfigRepository, RouterConfigRow } from "../ports/router-config-repository.js";
import type { PipelineRepository } from "../ports/pipeline-repository.js";

export type SetActivePipelineVersionResult =
  | { readonly ok: true; readonly config: RouterConfigRow }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.not_found" }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.not_published" };

export interface SetActivePipelineVersionDeps {
  readonly routerConfig: RouterConfigRepository;
  readonly pipelines: PipelineRepository;
}

/**
 * Flips `RouterConfigs.activePipelineVersionId` — the tenant-visible act that supersedes
 * `executionMode`/`agentSelectionScope`/`agentScopeListJson` (`execution-mode-panel.tsx`'s
 * own coexistence rule). Passing `null` clears the pointer, returning the tenant to the
 * legacy flat dispatcher — a normal, reversible operation, not a destructive one.
 *
 * Only a `Published` version may be activated — `TR_RouterConfigs_activePipelinePublished`
 * is the real, final backstop; this check exists so activating a Draft (impossible to
 * execute — `ExecutePipeline` has no defined behaviour for an unpublished graph) fails with
 * a clean reason instead of a raw trigger error.
 */
export class SetActivePipelineVersion {
  constructor(private readonly deps: SetActivePipelineVersionDeps) {}

  async execute(input: {
    readonly pipelineVersionId: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<SetActivePipelineVersionResult> {
    if (input.pipelineVersionId !== null) {
      const version = await this.deps.pipelines.getPipelineVersion(input.pipelineVersionId);
      if (version === null) {
        return { ok: false, reason: "orchestration.pipeline.not_found" };
      }
      if (version.status !== "Published") {
        return { ok: false, reason: "orchestration.pipeline.not_published" };
      }
    }
    const config = await this.deps.routerConfig.setActivePipelineVersion({
      pipelineVersionId: input.pipelineVersionId,
      now: input.now,
    });
    if (input.pipelineVersionId !== null) {
      await this.deps.pipelines.recordVersionActivation({
        pipelineVersionId: input.pipelineVersionId,
        actorStaffUserId: input.actorStaffUserId,
        now: input.now,
      });
    }
    return { ok: true, config };
  }
}
