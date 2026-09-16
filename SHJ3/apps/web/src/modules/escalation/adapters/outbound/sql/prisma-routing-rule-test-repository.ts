import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  RecordRoutingRuleTestInput,
  RoutingRuleTestRepository,
} from "../../../ports/routing-rule-test-repository.js";

export class PrismaRoutingRuleTestRepository implements RoutingRuleTestRepository {
  async record(input: RecordRoutingRuleTestInput): Promise<{ readonly id: string }> {
    const row = await getTenantDb("routing rule test record").routingRuleTest.create({
      data: {
        id: newUlid(input.now),
        sampleJson: input.sampleJson,
        firedRoutingRuleId: input.firedRoutingRuleId,
        firedRuleOrdinal: input.firedRuleOrdinal,
        resolvedTarget: input.resolvedTarget,
        fellToDefaultQueue: input.fellToDefaultQueue,
        ruleSetHash: input.ruleSetHash,
        ranByStaffUserId: input.ranByStaffUserId,
        createdAt: input.now,
      },
    });
    return { id: row.id };
  }
}
