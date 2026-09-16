/** `EscalationTickets` — created here (api.md §4.2 `POST .../handover`); read-only everywhere else (B8 owns the queue/assignment side). */

export interface NewEscalationTicketInput {
  /** No `id`: the adapter mints it — see `ConversationRepository`'s port doc comment on this same convention. */
  readonly conversationId: string;
  readonly topic: string;
  /** `Billing` | `Customs` | `Library` | `General`. */
  readonly topicKey: string;
  /** Channel *kind* — see `conversation-repository.ts`'s own note on why this is not the full `channelKey` composite. */
  readonly channelKey: string;
  /** `Normal` | `High`. */
  readonly priority: string;
  /** `ToolFailure` | `UserRequest` | `LowConfidence`. */
  readonly reason: string;
  readonly reasonDetail: string;
  readonly verificationState: string;
  readonly pendingSlotName: string | null;
  /** Already-masked JSON snapshot of the transcript/slots — a citation, not a re-derivation (api.md §4.2: "PII-masked since it's already-masked data being copied"). */
  readonly contextSnapshotJson: string;
  readonly queuedAt: Date;
}

export interface EscalationTicketRow {
  readonly id: string;
  readonly conversationId: string;
  /** `Queued` | `Assigned` | `Active` | `Resolved` | `Abandoned`. */
  readonly status: string;
  readonly queuedAt: Date;
}

export interface HandoverConfigRow {
  readonly noAgentAvailableMessage: string;
  readonly workingHoursProfileId: string;
  readonly offerEscalationOutsideHours: boolean;
}

export interface WorkingHoursProfileRow {
  readonly timezone: string;
  readonly assistantAvailable247: boolean;
  readonly noAgentAvailableMessage: string;
}

export interface WorkingHoursSlotRow {
  /** 0 = Sunday. */
  readonly dayOfWeek: number;
  /** `"HH:mm:ss"` wall-clock, in the profile's own timezone. */
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface EscalationRepository {
  create(input: NewEscalationTicketInput): Promise<EscalationTicketRow>;
  findOpenForConversation(conversationId: string): Promise<EscalationTicketRow | null>;
  /** Count of `Queued` tickets strictly ahead of `beforeQueuedAt` — the real, simple `queuePosition` (api.md §4.2). */
  countQueuedAhead(beforeQueuedAt: Date): Promise<number>;

  findHandoverConfig(): Promise<HandoverConfigRow | null>;
  findWorkingHoursProfile(profileId: string): Promise<WorkingHoursProfileRow | null>;
  listWorkingHoursSlots(profileId: string): Promise<readonly WorkingHoursSlotRow[]>;
  isHoliday(dateIso: string): Promise<boolean>;
}
