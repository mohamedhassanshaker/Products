/** Reads one version's full canvas — the version row plus every node and edge — for the wizard's Flows step initial render. */

import type {
  FlowRepository,
  FlowEdgeRow,
  FlowNodeRow,
  FlowVersionRow,
} from "../ports/flow-repository.js";

export interface GetFlowCanvasDeps {
  readonly flows: FlowRepository;
}

export interface FlowCanvasResult {
  readonly version: FlowVersionRow;
  readonly nodes: readonly FlowNodeRow[];
  readonly edges: readonly FlowEdgeRow[];
}

export class GetFlowCanvas {
  constructor(private readonly deps: GetFlowCanvasDeps) {}

  async execute(input: { readonly flowVersionId: string }): Promise<FlowCanvasResult> {
    const version = await this.deps.flows.getFlowVersion(input.flowVersionId);
    if (!version) {
      throw new Error(`FlowVersion "${input.flowVersionId}" does not exist.`);
    }
    const [nodes, edges] = await Promise.all([
      this.deps.flows.listNodes(input.flowVersionId),
      this.deps.flows.listEdges(input.flowVersionId),
    ]);
    return { version, nodes, edges };
  }
}
