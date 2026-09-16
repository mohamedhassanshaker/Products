/**
 * Save the AI settings screen's form (the Flow Designer AI sidebar's tenant-wide model).
 *
 * `primaryModel` non-empty is the only real rule — no format/allowlist check, matching
 * `AgentVersion.primaryModel`'s own free-text convention (`domain/flow-assistant-config.ts`'s
 * doc comment: no model catalogue exists anywhere in this codebase to validate against).
 */

import type {
  FlowAssistantConfigRepository,
  FlowAssistantConfigRow,
} from "../ports/flow-assistant-config-repository.js";

export interface UpdateFlowAssistantConfigInput {
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly updatedByStaffUserId: string;
  readonly now: Date;
}

export type UpdateFlowAssistantConfigResult =
  | { readonly ok: true; readonly config: FlowAssistantConfigRow }
  | { readonly ok: false; readonly reason: "flows.primary_model_required" };

export interface UpdateFlowAssistantConfigDeps {
  readonly flowAssistantConfig: FlowAssistantConfigRepository;
}

export class UpdateFlowAssistantConfig {
  constructor(private readonly deps: UpdateFlowAssistantConfigDeps) {}

  async execute(input: UpdateFlowAssistantConfigInput): Promise<UpdateFlowAssistantConfigResult> {
    const primaryModel = input.primaryModel.trim();
    if (primaryModel.length === 0) {
      return { ok: false, reason: "flows.primary_model_required" };
    }
    const fallbackModel = input.fallbackModel?.trim() || null;

    await this.deps.flowAssistantConfig.ensureTenantConfig(input.now);
    const config = await this.deps.flowAssistantConfig.updateTenantConfig({
      primaryModel,
      fallbackModel,
      updatedByStaffUserId: input.updatedByStaffUserId,
      now: input.now,
    });
    return { ok: true, config };
  }
}
