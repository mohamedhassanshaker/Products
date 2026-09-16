/** B6 tab 3's playground — runs a query against the tenant's live retrieval configuration and persists a `RetrievalPlaygroundRun` so a tuning decision stays reviewable (FR-KNOW-15). */

import type { KnowledgeAiClient, RetrievalQueryResult } from "../ports/knowledge-ai-client.js";
import type { RetrievalConfigRepository } from "../ports/retrieval-config-repository.js";

export interface RunRetrievalPlaygroundInput {
  readonly query: string;
  readonly knowledgeCollectionIds: readonly string[] | null;
  readonly ranByStaffUserId: string;
  readonly now: Date;
}

export interface RunRetrievalPlaygroundResult {
  readonly runId: string;
  readonly result: RetrievalQueryResult;
}

export interface RunRetrievalPlaygroundDeps {
  readonly retrievalConfig: RetrievalConfigRepository;
  readonly ai: KnowledgeAiClient;
}

export class RunRetrievalPlayground {
  constructor(private readonly deps: RunRetrievalPlaygroundDeps) {}

  async execute(input: RunRetrievalPlaygroundInput): Promise<RunRetrievalPlaygroundResult> {
    const config = await this.deps.retrievalConfig.ensureTenantConfig(input.now);
    const result = await this.deps.ai.retrievalQuery({
      query: input.query,
      knowledgeCollectionIds: input.knowledgeCollectionIds,
    });

    const { id: runId } = await this.deps.retrievalConfig.recordPlaygroundRun({
      query: input.query,
      configSnapshotJson: JSON.stringify(config),
      resultsJson: JSON.stringify(result.results),
      matchedSubgraph: result.matchedSubgraph.renderedPath,
      topScore: result.results[0]?.score ?? null,
      ranByStaffUserId: input.ranByStaffUserId,
      durationMs: result.durationMs,
      now: input.now,
    });

    return { runId, result };
  }
}
