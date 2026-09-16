/** The real `MessageTemplateRepository` — `MessageTemplates`, per-tenant (B10 tab 3). */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { TemplateApprovalStatus } from "../../../domain/vocabulary.js";
import type {
  MessageTemplateRepository,
  MessageTemplateRow,
  NewMessageTemplateInput,
} from "../../../ports/message-template-repository.js";

const OPERATION = "channels message-template repository";

function toRow(row: {
  id: string;
  name: string;
  channelKey: string;
  category: string;
  bodySample: string;
  variablesJson: string | null;
  localeCode: string;
  approvalStatus: string;
  bspTemplateId: string | null;
  rejectionReason: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
}): MessageTemplateRow {
  return {
    id: row.id,
    name: row.name,
    channelKey: row.channelKey,
    category: row.category,
    bodySample: row.bodySample,
    variablesJson: row.variablesJson,
    localeCode: row.localeCode,
    approvalStatus: row.approvalStatus as TemplateApprovalStatus,
    bspTemplateId: row.bspTemplateId,
    rejectionReason: row.rejectionReason,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
  };
}

export class PrismaMessageTemplateRepository implements MessageTemplateRepository {
  async list(): Promise<readonly MessageTemplateRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.messageTemplate.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(toRow);
  }

  async findById(id: string): Promise<MessageTemplateRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.messageTemplate.findFirst({ where: { id, deletedAt: null } });
    return row ? toRow(row) : null;
  }

  async findByNameAndLocale(name: string, localeCode: string): Promise<MessageTemplateRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.messageTemplate.findFirst({
      where: { name, localeCode, deletedAt: null },
    });
    return row ? toRow(row) : null;
  }

  async create(input: NewMessageTemplateInput): Promise<MessageTemplateRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.messageTemplate.create({
      data: {
        id: newUlid(input.now),
        name: input.name,
        channelKey: input.channelKey,
        category: input.category,
        bodySample: input.bodySample,
        variablesJson: JSON.stringify(input.variables),
        localeCode: input.localeCode,
        approvalStatus: "Pending",
        submittedByStaffUserId: input.submittedByStaffUserId,
        submittedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }

  async approve(input: {
    readonly id: string;
    readonly bspTemplateId: string;
    readonly now: Date;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    // `TR_MessageTemplates_blockDependentCampaigns` only fires for the OUT-of-Approved
    // direction; this INTO-Approved write needs no application-level fan-out to unblock
    // dependent campaigns — `CampaignStates`/`deriveCampaignDisplayState` read the joined
    // status on every subsequent read, so there is nothing to synchronise (§4.10).
    await db.messageTemplate.update({
      where: { id: input.id },
      data: {
        approvalStatus: "Approved",
        bspTemplateId: input.bspTemplateId,
        rejectionReason: null,
        reviewedAt: input.now,
        updatedAt: input.now,
      },
    });
  }

  async reject(input: {
    readonly id: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.messageTemplate.update({
      where: { id: input.id },
      data: {
        approvalStatus: "Rejected",
        rejectionReason: input.reason,
        reviewedAt: input.now,
        updatedAt: input.now,
      },
    });
  }
}
