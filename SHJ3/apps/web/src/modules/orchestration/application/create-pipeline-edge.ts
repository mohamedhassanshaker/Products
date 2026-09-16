import type {
  NewPipelineEdgeInput,
  PipelineEdgeWriteResult,
  PipelineRepository,
} from "../ports/pipeline-repository.js";

export type CreatePipelineEdgeReason =
  | "orchestration.pipeline.loop_edge_requires_max_iterations"
  | "orchestration.pipeline.max_iterations_out_of_range"
  | "orchestration.pipeline.condition_on_non_loop_edge";

export type CreatePipelineEdgeResult =
  | PipelineEdgeWriteResult
  | { readonly ok: false; readonly reason: CreatePipelineEdgeReason };

const MAX_ITERATIONS_RANGE = { min: 1, max: 20 } as const;

export interface CreatePipelineEdgeDeps {
  readonly pipelines: PipelineRepository;
}

/** Wires two nodes together — validates the loop-back field pairing BEFORE the repository's
 *  own INSERT, mirroring `CK_PipelineEdges_loopFields`/`_maxIterationsBounded`/
 *  `_conditionOnlyOnLoop` (`prisma/sql/001_constraints.sql`) exactly, so a designer sees a
 *  clean `{ok:false,reason}` instead of a raw SQL CHECK-violation error. The two rejections
 *  that only the database's own trigger can detect (`endpoint_wrong_version`,
 *  `non_homogeneous_fan_out`, both real cross-row facts this use case has no cheap way to
 *  pre-check without duplicating the trigger's own logic) pass through from
 *  `PipelineRepository.createEdge` unchanged. */
export class CreatePipelineEdge {
  constructor(private readonly deps: CreatePipelineEdgeDeps) {}

  async execute(
    input: Omit<NewPipelineEdgeInput, "now"> & { readonly now: Date },
  ): Promise<CreatePipelineEdgeResult> {
    if (input.kind === "LoopBack") {
      if (input.maxIterations === null) {
        return { ok: false, reason: "orchestration.pipeline.loop_edge_requires_max_iterations" };
      }
      if (
        input.maxIterations < MAX_ITERATIONS_RANGE.min ||
        input.maxIterations > MAX_ITERATIONS_RANGE.max
      ) {
        return { ok: false, reason: "orchestration.pipeline.max_iterations_out_of_range" };
      }
    } else if (input.conditionExpression !== null) {
      return { ok: false, reason: "orchestration.pipeline.condition_on_non_loop_edge" };
    }

    return this.deps.pipelines.createEdge(input);
  }
}
