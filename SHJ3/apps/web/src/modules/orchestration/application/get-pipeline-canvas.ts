import type { PipelineCanvas, PipelineRepository } from "../ports/pipeline-repository.js";

export interface GetPipelineCanvasDeps {
  readonly pipelines: PipelineRepository;
}

/** The pipeline editor's own read — the whole version's canvas (version row + every node +
 *  every edge) in one call, mirroring `modules/flows/application/get-flow-canvas.ts`'s
 *  identical shape for the Flow Designer. `null` when the version does not exist (a stale
 *  route param, a deleted design) — the caller renders a not-found state, never a crash. */
export class GetPipelineCanvas {
  constructor(private readonly deps: GetPipelineCanvasDeps) {}

  async execute(pipelineVersionId: string): Promise<PipelineCanvas | null> {
    return this.deps.pipelines.getCanvas(pipelineVersionId);
  }
}
