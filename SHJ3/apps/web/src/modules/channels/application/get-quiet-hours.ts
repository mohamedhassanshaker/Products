import type { QuietHoursConfigRow, QuietHoursRepository } from "../ports/quiet-hours-repository.js";

/** `GET /channels/quiet-hours` (B10 tab 4). */
export class GetQuietHours {
  constructor(private readonly deps: { readonly quietHours: QuietHoursRepository }) {}

  async execute(): Promise<QuietHoursConfigRow | null> {
    return this.deps.quietHours.getSingleton();
  }
}
