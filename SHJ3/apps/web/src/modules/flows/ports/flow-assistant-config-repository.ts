/** `FlowAssistantConfigs` — the Flow Designer AI sidebar's tenant-wide model setting. */

export interface FlowAssistantConfigRow {
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly updatedByStaffUserId: string | null;
  readonly updatedAt: Date;
}

export interface UpdateFlowAssistantConfigInput {
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly updatedByStaffUserId: string;
  readonly now: Date;
}

export interface FlowAssistantConfigRepository {
  /** Creates the singleton row with `FLOW_ASSISTANT_CONFIG_DEFAULTS` on first use. */
  ensureTenantConfig(now: Date): Promise<FlowAssistantConfigRow>;

  updateTenantConfig(input: UpdateFlowAssistantConfigInput): Promise<FlowAssistantConfigRow>;
}
