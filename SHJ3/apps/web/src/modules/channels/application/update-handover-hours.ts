import { checkHandoverConsistency } from "../domain/handover-consistency.js";
import type { ChannelsReason } from "../domain/errors.js";
import type { HandoverConfigRepository } from "../ports/handover-config-repository.js";
import type { WorkingHoursRepository } from "../ports/working-hours-repository.js";

export interface UpdateHandoverHoursInput {
  readonly workingHoursProfileId: string;
  readonly handoverConfigId: string;
  readonly timezone: string;
  readonly publicHolidayAutoSync: boolean;
  readonly assistantAvailable247: boolean;
  readonly slots: readonly {
    readonly dayOfWeek: number;
    readonly opensAt: { readonly hour: number; readonly minute: number };
    readonly closesAt: { readonly hour: number; readonly minute: number };
  }[];
  readonly offerEscalationOutsideHours: boolean;
  readonly noAgentAvailableMessage: string;
  readonly now: Date;
}

export type UpdateHandoverHoursResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ChannelsReason };

/**
 * `PUT /channels/handover-hours` (B10 tab 1). Saves `WorkingHoursProfile` (assistant hours)
 * and `HandoverConfig` (human-agent escalation offer) **together**, because
 * `checkHandoverConsistency` is the one place both values are known at once — the cross-
 * entity invariant this wave's brief calls out by name. Neither write happens if the
 * combination is invalid; this is checked BEFORE either `update()` call, not after, so a
 * rejected save never leaves one entity ahead of the other.
 *
 * `noAgentAvailableMessage` exists as its own real column on BOTH `WorkingHoursProfile`
 * (shown when the assistant itself refuses a session outside hours,
 * `assistantAvailable247 = false`) and `HandoverConfig` (shown instead of the handover offer
 * when the assistant keeps answering, `assistantAvailable247 = true`) — FR-CHAN-05's own
 * acceptance criteria describe both situations sharing "the configured message" (singular),
 * so this screen offers ONE text field and writes it to both columns, keeping the two
 * *hours* toggles (`assistantAvailable247`/`offerEscalationOutsideHours`) on their own
 * separate controls — it is the toggles the brief warns against conflating, not this shared
 * message text.
 */
export class UpdateHandoverHours {
  constructor(
    private readonly deps: {
      readonly workingHours: WorkingHoursRepository;
      readonly handover: HandoverConfigRepository;
    },
  ) {}

  async execute(input: UpdateHandoverHoursInput): Promise<UpdateHandoverHoursResult> {
    const consistency = checkHandoverConsistency({
      assistantAvailable247: input.assistantAvailable247,
      offerEscalationOutsideHours: input.offerEscalationOutsideHours,
    });
    if (!consistency.ok) return consistency;

    await this.deps.workingHours.update({
      id: input.workingHoursProfileId,
      timezone: input.timezone,
      publicHolidayAutoSync: input.publicHolidayAutoSync,
      assistantAvailable247: input.assistantAvailable247,
      noAgentAvailableMessage: input.noAgentAvailableMessage,
      slots: input.slots,
      now: input.now,
    });

    await this.deps.handover.update({
      id: input.handoverConfigId,
      noAgentAvailableMessage: input.noAgentAvailableMessage,
      offerEscalationOutsideHours: input.offerEscalationOutsideHours,
      now: input.now,
    });

    return { ok: true };
  }
}
