import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  CannedReplyRepository,
  CannedReplyRow,
} from "../../../ports/canned-reply-repository.js";

export class PrismaCannedReplyRepository implements CannedReplyRepository {
  async listForTopic(topicKey: string, localeCode: string): Promise<readonly CannedReplyRow[]> {
    const rows = await getTenantDb("canned replies for topic").cannedReply.findMany({
      where: {
        isEnabled: true,
        deletedAt: null,
        localeCode,
        OR: [{ topicKey }, { topicKey: null }],
      },
      orderBy: { ordinal: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      body: row.body,
      teamId: row.teamId,
      topicKey: row.topicKey,
      localeCode: row.localeCode,
      ordinal: row.ordinal,
      isEnabled: row.isEnabled,
    }));
  }
}
