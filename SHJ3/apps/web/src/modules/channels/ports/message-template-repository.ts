import type { TemplateApprovalStatus } from "../domain/vocabulary.js";

export interface MessageTemplateRow {
  readonly id: string;
  readonly name: string;
  readonly channelKey: string;
  readonly category: string;
  readonly bodySample: string;
  readonly variablesJson: string | null;
  readonly localeCode: string;
  readonly approvalStatus: TemplateApprovalStatus;
  readonly bspTemplateId: string | null;
  readonly rejectionReason: string | null;
  readonly submittedAt: Date | null;
  readonly reviewedAt: Date | null;
}

export interface NewMessageTemplateInput {
  readonly name: string;
  readonly channelKey: string;
  readonly category: string;
  readonly bodySample: string;
  readonly variables: readonly string[];
  readonly localeCode: string;
  readonly submittedByStaffUserId: string;
  readonly now: Date;
}

export interface MessageTemplateRepository {
  list(): Promise<readonly MessageTemplateRow[]>;
  findById(id: string): Promise<MessageTemplateRow | null>;
  findByNameAndLocale(name: string, localeCode: string): Promise<MessageTemplateRow | null>;
  create(input: NewMessageTemplateInput): Promise<MessageTemplateRow>;
  /** Records approval. A real BSP id is required — `CK_MessageTemplates_approvedHasBspId`.
   *  `TR_MessageTemplates_blockDependentCampaigns`'s *sibling* trigger direction (moving
   *  OUT of Approved) is not exercised here; this is the "into Approved" direction, which
   *  is what unblocks a campaign — `CampaignStates`/`deriveCampaignDisplayState` reflect it
   *  on the very next read, with nothing to synchronise. */
  approve(input: {
    readonly id: string;
    readonly bspTemplateId: string;
    readonly now: Date;
  }): Promise<void>;
  reject(input: {
    readonly id: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<void>;
}
