import type { PipelineRepository, PipelineVersionHistoryEntryRow } from "../ports/pipeline-repository.js";

export interface GetPipelineVersionHistoryDeps {
  readonly pipelines: PipelineRepository;
}

/** The version bar's own audit trail — every `Created`/`Cloned`/`Published`/`RolledBack`/
 *  `Activated` entry for a design, newest first. */
export class GetPipelineVersionHistory {
  constructor(private readonly deps: GetPipelineVersionHistoryDeps) {}

  async execute(pipelineDesignId: string): Promise<readonly PipelineVersionHistoryEntryRow[]> {
    return this.deps.pipelines.listVersionHistory(pipelineDesignId);
  }
}
