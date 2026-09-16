/** The real `ConsentRepository` — `ConsentLedgerEntries`/`ConsentStates`, per-tenant
 *  (WhatsApp opt-in/opt-out, B10 tab 3/4). The ledger is append-only (`DENY UPDATE, DELETE`
 *  at the database) and `ConsentStates` is a projection maintained by the real
 *  `TR_ConsentLedgerEntries_project` trigger — this adapter never writes that projection
 *  directly, only reads it. */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  ConsentPurpose,
  ConsentState as ConsentStateValue,
} from "../../../domain/vocabulary.js";
import type {
  AppendConsentLedgerEntryInput,
  ConsentRepository,
  ConsentStateRow,
} from "../../../ports/consent-repository.js";

const OPERATION = "channels consent repository";

export class PrismaConsentRepository implements ConsentRepository {
  async currentState(
    subjectHash: string,
    channelKey: string,
    purpose: ConsentPurpose,
  ): Promise<ConsentStateRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.consentState.findUnique({
      where: { subjectHash_channelKey_purpose: { subjectHash, channelKey, purpose } },
    });
    if (!row) return null;
    return {
      subjectHash: row.subjectHash,
      channelKey: row.channelKey,
      purpose: row.purpose as ConsentPurpose,
      state: row.state as ConsentStateValue,
      effectiveAt: row.effectiveAt,
    };
  }

  async listOptedIn(
    channelKey: string,
    purpose: ConsentPurpose,
  ): Promise<
    readonly { readonly subjectHash: string; readonly citizenIdentityId: string | null }[]
  > {
    const db = getTenantDb(OPERATION);
    const rows = await db.consentState.findMany({
      where: { channelKey, purpose, state: "OptedIn" },
      include: { lastLedgerEntry: { select: { citizenIdentityId: true } } },
    });
    return rows.map((row) => ({
      subjectHash: row.subjectHash,
      citizenIdentityId: row.lastLedgerEntry.citizenIdentityId,
    }));
  }

  async appendLedgerEntry(input: AppendConsentLedgerEntryInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.consentLedgerEntry.create({
      data: {
        id: newUlid(input.now),
        subjectKind: input.subjectKind,
        citizenIdentityId: input.citizenIdentityId,
        subjectHash: input.subjectHash,
        channelKey: input.channelKey,
        purpose: input.purpose,
        action: input.action,
        evidenceKind: input.evidenceKind,
        evidenceRef: input.evidenceRef,
        occurredAt: input.occurredAt,
        sourceTurnId: input.sourceTurnId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  }
}
