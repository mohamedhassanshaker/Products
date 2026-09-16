import type {
  PipelineEdgeWriteResult,
  PipelineRepository,
  UpdatePipelineEdgeInput,
} from "../ports/pipeline-repository.js";
import type { CreatePipelineEdgeReason } from "./create-pipeline-edge.js";

export type UpdatePipelineEdgeResult =
  | PipelineEdgeWriteResult
  | { readonly ok: false; readonly reason: CreatePipelineEdgeReason };

export interface UpdatePipelineEdgeDeps {
  readonly pipelines: PipelineRepository;
}

const MAX_ITERATIONS_RANGE = { min: 1, max: 20 } as const;

/** Edits an edge's own fields (label, ordinal, loop bound/condition) — the same loop-field
 *  pairing check `CreatePipelineEdge` runs, applied here only against whichever fields this
 *  particular edit actually touches (an edge already `LoopBack` that only changes its
 *  `label` never needs to re-validate `maxIterations`). */
export class UpdatePipelineEdge {
  constructor(private readonly deps: UpdatePipelineEdgeDeps) {}

  async execute(input: UpdatePipelineEdgeInput): Promise<UpdatePipelineEdgeResult> {
    if (input.maxIterations !== undefined && input.maxIterations !== null) {
      if (
        input.maxIterations < MAX_ITERATIONS_RANGE.min ||
        input.maxIterations > MAX_ITERATIONS_RANGE.max
      ) {
        return { ok: false, reason: "orchestration.pipeline.max_iterations_out_of_range" };
      }
    }
    return this.deps.pipelines.updateEdge(input);
  }
}
