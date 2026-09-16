/** The real `ReceiptConfigRepository` — the `ReceiptConfigs` singleton, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  ReceiptConfigRepository,
  ReceiptConfigRow,
} from "../../../ports/receipt-config-repository.js";

const OPERATION = "transactions receipt-config repository";
const SINGLETON_KEY = 1;

function toRow(row: {
  sendInConversation: boolean;
  emailPdfCopy: boolean;
  allowRefundRequestsFromAssistant: boolean;
}): ReceiptConfigRow {
  return { ...row };
}

export class PrismaReceiptConfigRepository implements ReceiptConfigRepository {
  async get(): Promise<ReceiptConfigRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.receiptConfig.findUnique({ where: { singletonKey: SINGLETON_KEY } });
    if (existing) return toRow(existing);

    const now = new Date();
    const created = await db.receiptConfig.create({
      data: {
        id: newUlid(now),
        singletonKey: SINGLETON_KEY,
        sendInConversation: true,
        emailPdfCopy: false,
        allowRefundRequestsFromAssistant: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    return toRow(created);
  }

  async set(input: {
    readonly sendInConversation: boolean;
    readonly emailPdfCopy: boolean;
    readonly allowRefundRequestsFromAssistant: boolean;
    readonly now: Date;
  }): Promise<ReceiptConfigRow> {
    await this.get();
    const db = getTenantDb(OPERATION);
    const row = await db.receiptConfig.update({
      where: { singletonKey: SINGLETON_KEY },
      data: {
        sendInConversation: input.sendInConversation,
        emailPdfCopy: input.emailPdfCopy,
        allowRefundRequestsFromAssistant: input.allowRefundRequestsFromAssistant,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }
}
