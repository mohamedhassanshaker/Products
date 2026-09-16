/** The entity graph explorer's live search/browse — B6 tab 2 (FR-KNOW-06/07/08). Thin passthrough to the AI service's graph store, the sole owner of graph traversal. */

import type {
  GraphBrowseInput,
  GraphBrowseResult,
  KnowledgeAiClient,
} from "../ports/knowledge-ai-client.js";

export interface BrowseGraphDeps {
  readonly ai: KnowledgeAiClient;
}

export class BrowseGraph {
  constructor(private readonly deps: BrowseGraphDeps) {}

  async execute(input: GraphBrowseInput): Promise<GraphBrowseResult> {
    return this.deps.ai.browseGraph(input);
  }
}
