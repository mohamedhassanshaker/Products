/** The real `CampaignRepository` — `Campaigns`/`CampaignSends`, per-tenant (B10 tab 4).
 *
 * This is the one adapter in the module carrying the wave's hard structural requirement:
 * `setEnabled(id, true, ...)` lets the real `TR_Campaigns_templateMustBeApproved` database
 * trigger fire on the `UPDATE` and translates its refusal into a typed
 * `CampaignTemplateNotApprovedError` — never pre-checked away in application code. See
 * `tests/integration/channels-campaign-enable-trigger.spec.ts` for the live proof against a
 * real SQL Server that the trigger, not this adapter, is what actually refuses the write.
 */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { deriveCampaignDisplayState } from "../../../domain/campaign-state.js";
import type {
  CampaignSendState,
  CampaignTrigger,
  SuppressionReason,
  TemplateApprovalStatus,
} from "../../../domain/vocabulary.js";
import {
  CampaignTemplateNotApprovedError,
  type CampaignRepository,
  type CampaignRow,
  type CampaignSendRow,
  type NewCampaignInput,
  type NewCampaignSendInput,
  type UpdateCampaignInput,
} from "../../../ports/campaign-repository.js";

const OPERATION = "channels campaign repository";

/** The trigger's own hard-coded message text (`prisma/sql/001_constraints.sql`) — matched
 *  the same way `prisma-theme-repository.ts`'s `blockingTriggerReason` matches
 *  `TR_Skins_blockActiveDeletion`, because a database `THROW` is not a constraint Prisma
 *  maps to a stable error code the way it does a unique/FK violation. Confirmed live
 *  against the real running SQL Server container while building this adapter (this project
 *  DOES have live infra available, unlike the theming wave's own note on that precedent) —
 *  see the review notes for the exact error text/shape observed. */
const TRIGGER_REFUSAL_TEXT = "cannot be enabled while its message template is not Approved";

function isTriggerRefusal(error: unknown): boolean {
  return error instanceof Error && error.message.includes(TRIGGER_REFUSAL_TEXT);
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

type CampaignJoinRow = {
  id: string;
  name: string;
  messageTemplateId: string;
  trigger: string;
  triggerOffsetHours: number | null;
  audienceLabel: string;
  isEnabled: boolean;
  respectQuietHours: boolean;
  sentThisMonth: number;
  lastSentAt: Date | null;
  messageTemplate: { name: string; approvalStatus: string; channelKey: string };
};

function toCampaignRow(row: CampaignJoinRow): CampaignRow {
  const templateApprovalStatus = row.messageTemplate.approvalStatus as TemplateApprovalStatus;
  return {
    id: row.id,
    name: row.name,
    messageTemplateId: row.messageTemplateId,
    messageTemplateName: row.messageTemplate.name,
    messageTemplateChannelKey: row.messageTemplate.channelKey,
    templateApprovalStatus,
    trigger: row.trigger as CampaignTrigger,
    triggerOffsetHours: row.triggerOffsetHours,
    audienceLabel: row.audienceLabel,
    isEnabled: row.isEnabled,
    respectQuietHours: row.respectQuietHours,
    sentThisMonth: row.sentThisMonth,
    lastSentAt: row.lastSentAt,
    state: deriveCampaignDisplayState({ isEnabled: row.isEnabled, templateApprovalStatus }),
  };
}

const CAMPAIGN_INCLUDE = {
  messageTemplate: { select: { name: true, approvalStatus: true, channelKey: true } },
} as const;

export class PrismaCampaignRepository implements CampaignRepository {
  async list(): Promise<readonly CampaignRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.campaign.findMany({
      include: CAMPAIGN_INCLUDE,
      orderBy: { name: "asc" },
    });
    return rows.map(toCampaignRow);
  }

  async findById(id: string): Promise<CampaignRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.campaign.findUnique({ where: { id }, include: CAMPAIGN_INCLUDE });
    return row ? toCampaignRow(row) : null;
  }

  async create(input: NewCampaignInput): Promise<CampaignRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.campaign.create({
      data: {
        id: newUlid(input.now),
        name: input.name,
        messageTemplateId: input.messageTemplateId,
        trigger: input.trigger,
        triggerOffsetHours: input.triggerOffsetHours,
        audienceDefinitionJson: input.audienceDefinitionJson,
        audienceLabel: input.audienceLabel,
        isEnabled: false,
        respectQuietHours: input.respectQuietHours,
        sentThisMonth: 0,
        createdAt: input.now,
        updatedAt: input.now,
      },
      include: CAMPAIGN_INCLUDE,
    });
    return toCampaignRow(row);
  }

  async update(input: UpdateCampaignInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.campaign.update({
      where: { id: input.id },
      data: {
        trigger: input.trigger,
        triggerOffsetHours: input.triggerOffsetHours,
        audienceDefinitionJson: input.audienceDefinitionJson,
        audienceLabel: input.audienceLabel,
        respectQuietHours: input.respectQuietHours,
        updatedAt: input.now,
      },
    });
  }

  async setEnabled(id: string, isEnabled: boolean, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    try {
      await db.campaign.update({ where: { id }, data: { isEnabled, updatedAt: now } });
    } catch (error) {
      if (isEnabled && isTriggerRefusal(error)) {
        const campaign = await db.campaign.findUnique({ where: { id }, include: CAMPAIGN_INCLUDE });
        throw new CampaignTemplateNotApprovedError(
          id,
          campaign?.messageTemplate.name ?? "unknown template",
          (campaign?.messageTemplate.approvalStatus as TemplateApprovalStatus) ?? "Draft",
        );
      }
      throw error;
    }
  }

  async listSends(campaignId: string): Promise<readonly CampaignSendRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.campaignSend.findMany({
      where: { campaignId },
      orderBy: { queuedAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      campaignId: row.campaignId,
      recipientHash: row.recipientHash,
      state: row.state as CampaignSendState,
      suppressionReason: row.suppressionReason as SuppressionReason | null,
      queuedAt: row.queuedAt,
      sentAt: row.sentAt,
    }));
  }

  async recordSend(input: NewCampaignSendInput): Promise<{ readonly inserted: boolean }> {
    const db = getTenantDb(OPERATION);
    try {
      await db.campaignSend.create({
        data: {
          id: newUlid(input.now),
          campaignId: input.campaignId,
          messageTemplateId: input.messageTemplateId,
          recipientHash: input.recipientHash,
          citizenIdentityId: input.citizenIdentityId,
          state: input.state,
          suppressionReason: input.suppressionReason,
          idempotencyKey: input.idempotencyKey,
          queuedAt: input.now,
          ...(input.state === "Sent" ? { sentAt: input.now } : {}),
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { inserted: true };
    } catch (error) {
      // UQ_CampaignSends_idempotencyKey — "duplicate skipped silently" (api.md §10.3 check 7),
      // the real backstop a Redis queue redelivery relies on, not merely an in-memory guard.
      if (isUniqueConstraintViolation(error)) return { inserted: false };
      throw error;
    }
  }

  async incrementSentThisMonth(campaignId: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.campaign.update({
      where: { id: campaignId },
      data: { sentThisMonth: { increment: 1 }, lastSentAt: now, updatedAt: now },
    });
  }
}
