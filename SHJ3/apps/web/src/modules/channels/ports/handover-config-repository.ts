/** The singleton `HandoverConfig` row, narrowed to the fields B10 tab 1 actually edits —
 *  `defaultQueueTeamId`/`supervisorAlertTeamId`/`maxWaitSecondsBeforeRequeue` are B7/B8's
 *  escalation-queue concern and are read here (so a save never clobbers them) but never
 *  written by this module. */
export interface HandoverConfigRow {
  readonly id: string;
  readonly workingHoursProfileId: string;
  readonly noAgentAvailableMessage: string;
  readonly offerEscalationOutsideHours: boolean;
}

export interface UpdateHandoverConfigInput {
  readonly id: string;
  readonly noAgentAvailableMessage: string;
  readonly offerEscalationOutsideHours: boolean;
  readonly now: Date;
}

export interface HandoverConfigRepository {
  getSingleton(): Promise<HandoverConfigRow | null>;
  update(input: UpdateHandoverConfigInput): Promise<void>;
}
