/** The real `WhatsAppConfigRepository` — the `WhatsAppConfigs` row, per-tenant (B10 tab 3). */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { BspProvider } from "../../../domain/vocabulary.js";
import type {
  CreateWhatsAppConfigInput,
  UpdateWhatsAppConfigInput,
  WhatsAppConfigRepository,
  WhatsAppConfigRow,
} from "../../../ports/whatsapp-config-repository.js";

const OPERATION = "channels whatsapp-config repository";

function toRow(row: {
  id: string;
  channelId: string;
  phoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
  bspProvider: string;
  optInRequired: boolean;
  sessionWindowHours: number;
  credentialSecretRef: string;
  webhookVerifySecretRef: string;
}): WhatsAppConfigRow {
  return {
    id: row.id,
    channelId: row.channelId,
    phoneNumber: row.phoneNumber,
    phoneNumberId: row.phoneNumberId,
    wabaId: row.wabaId,
    bspProvider: row.bspProvider as BspProvider,
    optInRequired: row.optInRequired,
    sessionWindowHours: row.sessionWindowHours,
    credentialSecretRef: row.credentialSecretRef,
    webhookVerifySecretRef: row.webhookVerifySecretRef,
  };
}

export class PrismaWhatsAppConfigRepository implements WhatsAppConfigRepository {
  async findByChannelId(channelId: string): Promise<WhatsAppConfigRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.whatsAppConfig.findUnique({ where: { channelId } });
    return row ? toRow(row) : null;
  }

  async findByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppConfigRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.whatsAppConfig.findUnique({ where: { phoneNumberId } });
    return row ? toRow(row) : null;
  }

  async create(input: CreateWhatsAppConfigInput): Promise<WhatsAppConfigRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.whatsAppConfig.create({
      data: {
        id: newUlid(input.now),
        channelId: input.channelId,
        phoneNumber: input.phoneNumber,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        // The one real value `CK_WhatsAppConfigs_bspProvider`/`BSP_PROVIDERS` allow today —
        // never accepted from a caller (see `CreateWhatsAppConfigInput`'s own doc comment).
        bspProvider: "MetaCloudApi",
        optInRequired: input.optInRequired,
        // Pinned by Meta's own platform rule (`CK_WhatsAppConfigs_sessionWindow`), matching
        // `update()`'s own established precedent of never accepting this from a caller.
        sessionWindowHours: 24,
        credentialSecretRef: input.credentialSecretRef,
        webhookVerifySecretRef: input.webhookVerifySecretRef,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }

  async update(input: UpdateWhatsAppConfigInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.whatsAppConfig.update({
      where: { channelId: input.channelId },
      data: {
        phoneNumber: input.phoneNumber,
        wabaId: input.wabaId,
        optInRequired: input.optInRequired,
        updatedAt: input.now,
      },
    });
  }
}
