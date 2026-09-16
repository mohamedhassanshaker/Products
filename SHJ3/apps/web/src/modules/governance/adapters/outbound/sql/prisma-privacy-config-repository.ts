import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { DataResidency, TranscriptRetention } from "../../../domain/privacy.js";
import type {
  PrivacyConfigRepository,
  PrivacyConfigRow,
  UpdatePrivacyConfigInput,
} from "../../../ports/privacy-config-repository.js";

const OPERATION = "governance privacy config";
const SINGLETON_KEY = 1;

export class PrismaPrivacyConfigRepository implements PrivacyConfigRepository {
  async get(): Promise<PrivacyConfigRow | null> {
    const row = await getTenantDb(OPERATION).privacyConfig.findUnique({
      where: { singletonKey: SINGLETON_KEY },
    });
    return row ? toRow(row) : null;
  }

  /** Upserts on the singleton key — a tenant that has never had its privacy config
   *  touched still gets a real, persisted row on first save rather than a silent no-op,
   *  while an existing row is updated in place (`singletonKey` never changes). */
  async update(input: UpdatePrivacyConfigInput): Promise<PrivacyConfigRow> {
    const row = await getTenantDb(OPERATION).privacyConfig.upsert({
      where: { singletonKey: SINGLETON_KEY },
      create: {
        id: newUlid(),
        singletonKey: SINGLETON_KEY,
        consentLedgerEnabled: input.consentLedgerEnabled,
        honourErasureRequests: input.honourErasureRequests,
        transcriptRetention: input.transcriptRetention,
        dataResidency: input.dataResidency,
        updatedByStaffUserId: input.updatedByStaffUserId,
        createdAt: input.now,
        updatedAt: input.now,
      },
      update: {
        consentLedgerEnabled: input.consentLedgerEnabled,
        honourErasureRequests: input.honourErasureRequests,
        transcriptRetention: input.transcriptRetention,
        dataResidency: input.dataResidency,
        updatedByStaffUserId: input.updatedByStaffUserId,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }
}

type PrivacyConfigPrismaRow = {
  id: string;
  consentLedgerEnabled: boolean;
  honourErasureRequests: boolean;
  transcriptRetention: string;
  dataResidency: string;
  updatedByStaffUserId: string;
  updatedAt: Date;
};

function toRow(row: PrivacyConfigPrismaRow): PrivacyConfigRow {
  return {
    id: row.id,
    consentLedgerEnabled: row.consentLedgerEnabled,
    honourErasureRequests: row.honourErasureRequests,
    transcriptRetention: row.transcriptRetention as TranscriptRetention,
    dataResidency: row.dataResidency as DataResidency,
    updatedByStaffUserId: row.updatedByStaffUserId,
    updatedAt: row.updatedAt,
  };
}
