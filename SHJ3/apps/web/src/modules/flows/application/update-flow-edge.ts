import type {
  FlowEdgeRow,
  FlowRepository,
  UpdateFlowEdgeInput as RepoUpdateFlowEdgeInput,
} from "../ports/flow-repository.js";

export type UpdateFlowEdgeInput = RepoUpdateFlowEdgeInput;

export interface UpdateFlowEdgeDeps {
  readonly flows: FlowRepository;
}

export type UpdateFlowEdgeResult =
  | { readonly ok: true; readonly edge: FlowEdgeRow }
  | { readonly ok: false; readonly reason: "flows.endpoint_wrong_version" };

export class UpdateFlowEdge {
  constructor(private readonly deps: UpdateFlowEdgeDeps) {}

  async execute(input: UpdateFlowEdgeInput): Promise<UpdateFlowEdgeResult> {
    return this.deps.flows.updateEdge(input);
  }
}
