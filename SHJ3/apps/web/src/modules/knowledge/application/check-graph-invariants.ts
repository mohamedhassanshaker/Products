/** The G11/G12 standing-invariant sweep (data-model.md §6.3/§9.3) — a small "graph health" indicator on B6 tab 2. All three counts must be zero; a non-zero result is an alert-worthy finding, surfaced plainly rather than hidden. */

import type { GraphInvariantsResult, KnowledgeAiClient } from "../ports/knowledge-ai-client.js";

export interface CheckGraphInvariantsDeps {
  readonly ai: KnowledgeAiClient;
}

export class CheckGraphInvariants {
  constructor(private readonly deps: CheckGraphInvariantsDeps) {}

  async execute(): Promise<GraphInvariantsResult> {
    return this.deps.ai.graphInvariants();
  }
}
