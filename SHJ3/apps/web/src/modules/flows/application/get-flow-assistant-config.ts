/** Load the AI settings screen's current values, seeding the singleton row on first use. */

import type {
  FlowAssistantConfigRepository,
  FlowAssistantConfigRow,
} from "../ports/flow-assistant-config-repository.js";

export interface GetFlowAssistantConfigDeps {
  readonly flowAssistantConfig: FlowAssistantConfigRepository;
}

export class GetFlowAssistantConfig {
  constructor(private readonly deps: GetFlowAssistantConfigDeps) {}

  async execute(input: { readonly now: Date }): Promise<FlowAssistantConfigRow> {
    return this.deps.flowAssistantConfig.ensureTenantConfig(input.now);
  }
}
