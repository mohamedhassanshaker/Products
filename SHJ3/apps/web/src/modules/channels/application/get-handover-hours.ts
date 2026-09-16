import type { HandoverConfigRepository } from "../ports/handover-config-repository.js";
import type {
  PublicHolidayRow,
  WorkingHoursProfileRow,
  WorkingHoursRepository,
} from "../ports/working-hours-repository.js";

export interface HandoverHoursSnapshot {
  readonly handoverConfigId: string;
  readonly workingHoursProfile: WorkingHoursProfileRow;
  readonly offerEscalationOutsideHours: boolean;
  readonly noAgentAvailableMessage: string;
  readonly publicHolidays: readonly PublicHolidayRow[];
}

/** `GET /channels/handover-hours` (B10 tab 1's out-of-hours behaviour). */
export class GetHandoverHours {
  constructor(
    private readonly deps: {
      readonly workingHours: WorkingHoursRepository;
      readonly handover: HandoverConfigRepository;
    },
  ) {}

  async execute(): Promise<HandoverHoursSnapshot | null> {
    const handover = await this.deps.handover.getSingleton();
    if (!handover) return null;
    const profile = await this.deps.workingHours.find(handover.workingHoursProfileId);
    if (!profile) return null;
    const publicHolidays = await this.deps.workingHours.listPublicHolidays();
    return {
      handoverConfigId: handover.id,
      workingHoursProfile: profile,
      offerEscalationOutsideHours: handover.offerEscalationOutsideHours,
      noAgentAvailableMessage: handover.noAgentAvailableMessage,
      publicHolidays,
    };
  }
}
