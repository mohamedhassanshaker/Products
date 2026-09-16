import type {
  ConsentAction,
  ConsentPurpose,
  ConsentState as ConsentStateValue,
} from "../domain/vocabulary.js";

/** A `subjectHash` is a one-way hash of the citizen's contact identifier (phone number for
 *  WhatsApp) — never the raw number, matching PII-handling elsewhere in this codebase. */
export interface ConsentStateRow {
  readonly subjectHash: string;
  readonly channelKey: string;
  readonly purpose: ConsentPurpose;
  readonly state: ConsentStateValue;
  readonly effectiveAt: Date;
}

export interface AppendConsentLedgerEntryInput {
  readonly subjectKind: "CitizenIdentity" | "ContactHash";
  readonly citizenIdentityId: string | null;
  readonly subjectHash: string;
  readonly channelKey: string;
  readonly purpose: ConsentPurpose;
  readonly action: ConsentAction;
  readonly evidenceKind: string;
  readonly evidenceRef: string | null;
  readonly occurredAt: Date;
  readonly sourceTurnId: string | null;
  readonly now: Date;
}

export interface ConsentRepository {
  /** Reads the projected `ConsentStates` row — maintained by the real
   *  `TR_ConsentLedgerEntries_project` trigger, never written directly here. */
  currentState(
    subjectHash: string,
    channelKey: string,
    purpose: ConsentPurpose,
  ): Promise<ConsentStateRow | null>;
  /** Every currently `OptedIn` subject for a channel/purpose — the real, working (if
   *  necessarily coarse) audience source `sendCampaignNowAction` uses in place of a real
   *  segment-query engine over `Campaign.audienceDefinitionJson` (see that action's own
   *  doc comment). Every recipient returned here still passes through `SendCampaignNow`'s
   *  own real per-recipient re-check — this is candidacy, not a bypass of it. */
  listOptedIn(
    channelKey: string,
    purpose: ConsentPurpose,
  ): Promise<
    readonly { readonly subjectHash: string; readonly citizenIdentityId: string | null }[]
  >;
  /** Appends to the append-only ledger (`DENY UPDATE, DELETE` at the database). The trigger
   *  above projects this into `ConsentStates` — this method never writes that projection
   *  itself. */
  appendLedgerEntry(input: AppendConsentLedgerEntryInput): Promise<void>;
}
