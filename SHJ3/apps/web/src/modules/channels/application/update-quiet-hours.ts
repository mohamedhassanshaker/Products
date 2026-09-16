import type { TimeOfDay } from "../domain/quiet-hours.js";
import type { QuietHoursRepository } from "../ports/quiet-hours-repository.js";

export interface UpdateQuietHoursInput {
  readonly isEnabled: boolean;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly timezone: string;
  readonly now: Date;
}

/** `PUT /channels/quiet-hours` (B10 tab 4). `{start:"21:00", end:"07:00",
 *  timeZone:"Asia/Dubai", enabled:true}` per api.md's own shape. */
export class UpdateQuietHours {
  constructor(private readonly deps: { readonly quietHours: QuietHoursRepository }) {}

  async execute(input: UpdateQuietHoursInput): Promise<void> {
    await this.deps.quietHours.update(input);
  }
}
