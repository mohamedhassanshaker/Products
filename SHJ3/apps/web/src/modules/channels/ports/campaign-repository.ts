import type {
  CampaignDisplayState,
  CampaignSendState,
  CampaignTrigger,
  SuppressionReason,
  TemplateApprovalStatus,
} from "../domain/vocabulary.js";

export interface CampaignRow {
  readonly id: string;
  readonly name: string;
  readonly messageTemplateId: string;
  readonly messageTemplateName: string;
  readonly messageTemplateChannelKey: string;
  readonly templateApprovalStatus: TemplateApprovalStatus;
  readonly trigger: CampaignTrigger;
  readonly triggerOffsetHours: number | null;
  readonly audienceLabel: string;
  readonly isEnabled: boolean;
  readonly respectQuietHours: boolean;
  readonly sentThisMonth: number;
  readonly lastSentAt: Date | null;
  /** Derived — see `deriveCampaignDisplayState`. Computed by the repository from the joined
   *  read, never stored. */
  readonly state: CampaignDisplayState;
}

export interface NewCampaignInput {
  readonly name: string;
  readonly messageTemplateId: string;
  readonly trigger: CampaignTrigger;
  readonly triggerOffsetHours: number | null;
  readonly audienceDefinitionJson: string;
  readonly audienceLabel: string;
  readonly respectQuietHours: boolean;
  readonly now: Date;
}

export interface UpdateCampaignInput {
  readonly id: string;
  readonly trigger: CampaignTrigger;
  readonly triggerOffsetHours: number | null;
  readonly audienceDefinitionJson: string;
  readonly audienceLabel: string;
  readonly respectQuietHours: boolean;
  readonly now: Date;
}

/** Raised when the real `TR_Campaigns_templateMustBeApproved` database trigger refuses an
 *  `isEnabled = 1` write — the adapter is the one place that recognises the trigger's own
 *  raised error and translates it, so every caller sees one clean, typed refusal rather than
 *  a raw SQL exception. */
export class CampaignTemplateNotApprovedError extends Error {
  constructor(
    readonly campaignId: string,
    readonly templateName: string,
    readonly templateStatus: TemplateApprovalStatus,
  ) {
    super(
      `Campaign cannot be enabled: its template "${templateName}" is ${templateStatus}, not Approved.`,
    );
    this.name = "CampaignTemplateNotApprovedError";
  }
}

export interface CampaignSendRow {
  readonly id: string;
  readonly campaignId: string;
  readonly recipientHash: string;
  readonly state: CampaignSendState;
  readonly suppressionReason: SuppressionReason | null;
  readonly queuedAt: Date;
  readonly sentAt: Date | null;
}

export interface NewCampaignSendInput {
  readonly campaignId: string;
  readonly messageTemplateId: string;
  readonly recipientHash: string;
  readonly citizenIdentityId: string | null;
  readonly state: CampaignSendState;
  readonly suppressionReason: SuppressionReason | null;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export interface CampaignRepository {
  list(): Promise<readonly CampaignRow[]>;
  findById(id: string): Promise<CampaignRow | null>;
  create(input: NewCampaignInput): Promise<CampaignRow>;
  update(input: UpdateCampaignInput): Promise<void>;
  /** Throws `CampaignTemplateNotApprovedError` if the real database trigger refuses the
   *  write — never pre-checked away in application code, per the wave's own hard
   *  requirement that the trigger is the actual, structural backstop. */
  setEnabled(id: string, isEnabled: boolean, now: Date): Promise<void>;
  listSends(campaignId: string): Promise<readonly CampaignSendRow[]>;
  /** Idempotent: a duplicate `idempotencyKey` (the real `UQ_CampaignSends_idempotencyKey`
   *  unique constraint) resolves to `{ inserted: false }` rather than throwing — "duplicate
   *  skipped silently" per api.md §10.3 check 7. */
  recordSend(input: NewCampaignSendInput): Promise<{ readonly inserted: boolean }>;
  incrementSentThisMonth(campaignId: string, now: Date): Promise<void>;
}
