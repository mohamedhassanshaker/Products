import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  CitizenDataEraser,
  CitizenSqlErasureResult,
} from "../../../ports/citizen-data-eraser.js";

const OPERATION = "governance citizen erasure (sql server)";

/**
 * The real SQL Server store of a 4-store erasure — see `ports/citizen-data-eraser.ts`'s
 * module comment for the full table-by-table rationale (9 tables link to
 * `CitizenIdentities`, found by grepping the real tenant schema; `Transactions` is
 * structurally skipped, never nulled/deleted, per FR-GOV-24/FR-PAY-08).
 */
export class PrismaCitizenDataEraser implements CitizenDataEraser {
  async erase(citizenIdentityId: string, now: Date): Promise<CitizenSqlErasureResult> {
    const db = getTenantDb(OPERATION);
    const queries: string[] = [];
    let affectedCount = 0;

    // Captured before nulling — the caller uses these ids to also erase the matching
    // Redis session keys, since this eraser has no reach into the cache store itself.
    const conversations = await db.conversation.findMany({
      where: { citizenIdentityId },
      select: { id: true },
    });
    const purgedConversationIds = conversations.map((row) => row.id);

    const conversationsResult = await db.conversation.updateMany({
      where: { citizenIdentityId },
      data: { citizenIdentityId: null },
    });
    affectedCount += conversationsResult.count;
    queries.push(
      `UPDATE Conversations SET citizenIdentityId = NULL WHERE citizenIdentityId = '${citizenIdentityId}' -- ${conversationsResult.count} row(s)`,
    );

    const escalationTicketsResult = await db.escalationTicket.updateMany({
      where: { citizenIdentityId },
      data: { citizenIdentityId: null },
    });
    affectedCount += escalationTicketsResult.count;
    queries.push(
      `UPDATE EscalationTickets SET citizenIdentityId = NULL WHERE citizenIdentityId = '${citizenIdentityId}' -- ${escalationTicketsResult.count} row(s)`,
    );

    const campaignSendsResult = await db.campaignSend.updateMany({
      where: { citizenIdentityId },
      data: { citizenIdentityId: null },
    });
    affectedCount += campaignSendsResult.count;
    queries.push(
      `UPDATE CampaignSends SET citizenIdentityId = NULL WHERE citizenIdentityId = '${citizenIdentityId}' -- ${campaignSendsResult.count} row(s)`,
    );

    const verificationAttemptsResult = await db.verificationAttempt.updateMany({
      where: { citizenIdentityId },
      data: { citizenIdentityId: null },
    });
    affectedCount += verificationAttemptsResult.count;
    queries.push(
      `UPDATE VerificationAttempts SET citizenIdentityId = NULL WHERE citizenIdentityId = '${citizenIdentityId}' -- ${verificationAttemptsResult.count} row(s)`,
    );

    const consentLedgerResult = await db.consentLedgerEntry.updateMany({
      where: { citizenIdentityId },
      data: { citizenIdentityId: null },
    });
    affectedCount += consentLedgerResult.count;
    queries.push(
      `UPDATE ConsentLedgerEntries SET citizenIdentityId = NULL WHERE citizenIdentityId = '${citizenIdentityId}' -- ${consentLedgerResult.count} row(s), ledger itself kept (evidence of lawful consent/withdrawal)`,
    );

    // Required (non-nullable) FKs — the row itself is deleted rather than orphaned.
    const identityLinksResult = await db.identityLink.deleteMany({ where: { citizenIdentityId } });
    affectedCount += identityLinksResult.count;
    queries.push(
      `DELETE FROM IdentityLinks WHERE citizenIdentityId = '${citizenIdentityId}' -- ${identityLinksResult.count} row(s)`,
    );

    const linkedServiceAccountsResult = await db.linkedServiceAccount.deleteMany({
      where: { citizenIdentityId },
    });
    affectedCount += linkedServiceAccountsResult.count;
    queries.push(
      `DELETE FROM LinkedServiceAccounts WHERE citizenIdentityId = '${citizenIdentityId}' -- ${linkedServiceAccountsResult.count} row(s)`,
    );

    // FR-GOV-24 / FR-PAY-08: Transactions are NEVER nulled/deleted here — only counted,
    // exactly as the module brief requires ("confirm-and-record via a COUNT(*)").
    const transactionsSkipped = await db.transaction.count({ where: { citizenIdentityId } });
    queries.push(
      `SELECT COUNT(*) FROM Transactions WHERE citizenIdentityId = '${citizenIdentityId}' -- ${transactionsSkipped} row(s) deliberately retained (FR-GOV-24, 7-year statutory carve-out; TR_Transactions_blockDelete)`,
    );

    // The tombstone itself — hashes/masks nulled, erasedAt set (the real schema's own
    // documented shape for a "removed" CitizenIdentity, since the row's id is still the
    // FK target of `Transactions.citizenIdentityId` for up to 7 more years).
    await db.citizenIdentity.update({
      where: { id: citizenIdentityId },
      data: {
        emiratesIdHash: null,
        mobileHash: null,
        displayNameMasked: null,
        verifiedByProviderKey: null,
        erasedAt: now,
        updatedAt: now,
      },
    });
    affectedCount += 1;
    queries.push(
      `UPDATE CitizenIdentities SET emiratesIdHash = NULL, mobileHash = NULL, displayNameMasked = NULL, verifiedByProviderKey = NULL, erasedAt = '${now.toISOString()}' WHERE id = '${citizenIdentityId}'`,
    );

    return {
      affectedCount,
      verificationQuery: queries.join("\n"),
      transactionsSkipped,
      purgedConversationIds,
    };
  }
}
