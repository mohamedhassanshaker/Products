export interface WorkingHoursSlotRow {
  readonly id: string;
  /** 0 = Sunday, per `WorkingHoursSlots.dayOfWeek`'s own doc comment. */
  readonly dayOfWeek: number;
  readonly opensAt: { readonly hour: number; readonly minute: number };
  readonly closesAt: { readonly hour: number; readonly minute: number };
}

export interface WorkingHoursProfileRow {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly publicHolidayAutoSync: boolean;
  readonly assistantAvailable247: boolean;
  readonly noAgentAvailableMessage: string;
  readonly slots: readonly WorkingHoursSlotRow[];
}

export interface UpdateWorkingHoursProfileInput {
  readonly id: string;
  readonly timezone: string;
  readonly publicHolidayAutoSync: boolean;
  readonly assistantAvailable247: boolean;
  readonly noAgentAvailableMessage: string;
  /** The complete replacement set — `WorkingHoursSlots` are hard-deleted and re-created
   *  together (§1.4), matching how the screen edits a whole weekly schedule at once. */
  readonly slots: readonly {
    readonly dayOfWeek: number;
    readonly opensAt: { readonly hour: number; readonly minute: number };
    readonly closesAt: { readonly hour: number; readonly minute: number };
  }[];
  readonly now: Date;
}

export interface PublicHolidayRow {
  readonly id: string;
  readonly holidayDate: string; // ISO date, YYYY-MM-DD
  readonly name: string;
  readonly origin: "AutoSync" | "Manual";
  readonly isObserved: boolean;
}

export interface WorkingHoursRepository {
  find(id: string): Promise<WorkingHoursProfileRow | null>;
  update(input: UpdateWorkingHoursProfileInput): Promise<void>;
  listPublicHolidays(): Promise<readonly PublicHolidayRow[]>;
}
