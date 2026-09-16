import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  PublishGateRepository,
  PublishGateRow,
  UpdatePublishGateInput,
} from "../../../ports/publish-gate-repository.js";

/** `CK_PublishGates_thresholds`'s own bounds — the seeded defaults B13 tab 3 wireframes. */
const DEFAULT_MIN_ACCURACY = 0.85;
const DEFAULT_MIN_GROUNDEDNESS = 0.8;

function toRow(row: {
  id: string;
  blockOnSuiteFailure: boolean;
  minAccuracy: unknown;
  minGroundedness: unknown;
  redTeamMustScore100: boolean;
  blockOnBoundLocaleBelow100: boolean;
  updatedByStaffUserId: string;
  createdAt: Date;
  updatedAt: Date;
}): PublishGateRow {
  return {
    id: row.id,
    blockOnSuiteFailure: row.blockOnSuiteFailure,
    minAccuracy: Number(row.minAccuracy),
    minGroundedness: Number(row.minGroundedness),
    redTeamMustScore100: row.redTeamMustScore100,
    blockOnBoundLocaleBelow100: row.blockOnBoundLocaleBelow100,
    updatedByStaffUserId: row.updatedByStaffUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaPublishGateRepository implements PublishGateRepository {
  async getOrCreateDefault(seedStaffUserId: string, now: Date): Promise<PublishGateRow> {
    const existing = await getTenantDb("evaluation publish gate get").publishGate.findFirst({
      where: { singletonKey: 1 },
    });
    if (existing) return toRow(existing);

    // `UQ_PublishGates_singleton` makes a second concurrent seed attempt fail loudly
    // (`P2002`) rather than silently duplicate — re-read on that race instead of
    // propagating, since "the gate already exists" is exactly the state this method
    // promises to return, whichever caller happened to create it.
    try {
      const created = await getTenantDb("evaluation publish gate seed").publishGate.create({
        data: {
          id: newUlid(),
          singletonKey: 1,
          blockOnSuiteFailure: true,
          minAccuracy: DEFAULT_MIN_ACCURACY,
          minGroundedness: DEFAULT_MIN_GROUNDEDNESS,
          redTeamMustScore100: true,
          blockOnBoundLocaleBelow100: true,
          updatedByStaffUserId: seedStaffUserId,
          createdAt: now,
          updatedAt: now,
        },
      });
      return toRow(created);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        const raced = await getTenantDb(
          "evaluation publish gate get after race",
        ).publishGate.findFirst({
          where: { singletonKey: 1 },
        });
        if (raced) return toRow(raced);
      }
      throw error;
    }
  }

  async update(input: UpdatePublishGateInput): Promise<PublishGateRow> {
    const row = await getTenantDb("evaluation publish gate update").publishGate.update({
      where: { singletonKey: 1 },
      data: {
        blockOnSuiteFailure: input.blockOnSuiteFailure,
        minAccuracy: input.minAccuracy,
        minGroundedness: input.minGroundedness,
        redTeamMustScore100: input.redTeamMustScore100,
        blockOnBoundLocaleBelow100: input.blockOnBoundLocaleBelow100,
        updatedByStaffUserId: input.updatedByStaffUserId,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }
}
