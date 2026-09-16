import { analyzePipelineGraph, hasBlockingFindings, type PipelineGraphFinding } from "../domain/pipeline-graph.js";
import type { PublishedAgentPort } from "../ports/published-agent-port.js";
import type { PipelineRepository } from "../ports/pipeline-repository.js";

export type PublishPipelineVersionResult =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.already_published" }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.graph_invalid"; readonly findings: readonly PipelineGraphFinding[] };

export interface PublishPipelineVersionDeps {
  readonly pipelines: PipelineRepository;
  readonly agents: PublishedAgentPort;
}

/**
 * Publish a pipeline version — B4's real "Save pipeline" gate. Mirrors `PublishFlowVersion`/
 * `PublishAgentVersion`'s "check `canPublish` before calling the repository" shape, but
 * collects EVERY blocking finding rather than returning on the first — `analyzePipelineGraph`
 * is built for exactly that ("collect every blocking finding, not just the first", this
 * module's own `PipelineFindingsPanel` UI depends on the full list, not one reason at a
 * time). The repository's own `TR_PipelineVersions_publishGraphValid` trigger is the real,
 * final backstop (defense in depth, mirroring `PublishFlowVersion`'s identical division of
 * labour) — this use case's job is turning that same rule set into a clean, actionable
 * `{ok:false, findings}` before the database is ever asked.
 */
export class PublishPipelineVersion {
  constructor(private readonly deps: PublishPipelineVersionDeps) {}

  async execute(input: {
    readonly pipelineVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<PublishPipelineVersionResult> {
    const canvas = await this.deps.pipelines.getCanvas(input.pipelineVersionId);
    if (canvas === null) {
      throw new Error(
        `Cannot publish pipeline version "${input.pipelineVersionId}": no such version. ` +
          "Publishing acts on a version the Pipeline Designer already loaded, never an arbitrary id.",
      );
    }
    if (canvas.version.status === "Published") {
      return { ok: false, reason: "orchestration.pipeline.already_published" };
    }

    const published = await this.deps.agents.listPublished();
    const publishedAgentIds = new Set(published.map((agent) => agent.id));

    const analysis = analyzePipelineGraph(
      canvas.nodes.map((n) => ({ id: n.id, kind: n.kind, agentId: n.agentId })),
      canvas.edges.map((e) => ({
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        kind: e.kind,
        maxIterations: e.maxIterations,
        conditionExpression: e.conditionExpression,
      })),
      publishedAgentIds,
    );
    if (hasBlockingFindings(analysis)) {
      return {
        ok: false,
        reason: "orchestration.pipeline.graph_invalid",
        findings: analysis.findings.filter((f) => f.severity === "blocking"),
      };
    }

    const result = await this.deps.pipelines.publishVersion(input);
    if (!result.ok) {
      if (result.reason === "orchestration.pipeline.already_published") {
        return { ok: false, reason: "orchestration.pipeline.already_published" };
      }
      // The repository's own trigger caught something this use case's own analyzer somehow
      // missed (a real race, or a graph mutated between the check above and this call) —
      // reported with no findings list, since the analyzer itself found nothing wrong.
      return { ok: false, reason: "orchestration.pipeline.graph_invalid", findings: [] };
    }
    return { ok: true, label: result.label };
  }
}
