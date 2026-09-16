import type { TimeOfDay } from "../domain/quiet-hours.js";

export interface QuietHoursConfigRow {
  readonly id: string;
  readonly isEnabled: boolean;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly timezone: string;
}

export interface UpdateQuietHoursInput {
  readonly isEnabled: boolean;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly timezone: string;
  readonly now: Date;
}

export interface QuietHoursRepository {
  getSingleton(): Promise<QuietHoursConfigRow | null>;
  update(input: UpdateQuietHoursInput): Promise<void>;
}
