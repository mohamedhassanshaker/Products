import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { GoldenSetKind } from "../../../domain/vocabulary.js";
import type {
  GoldenCaseRepository,
  GoldenCaseRow,
  GoldenSetRepository,
  GoldenSetRow,
  NewGoldenCaseInput,
  NewGoldenSetInput,
  UpdateGoldenCaseInput,
} from "../../../ports/golden-set-repository.js";

function toSetRow(row: {
  id: string;
  name: string;
  ownerTenantId: string;
  description: string | null;
  kind: string;
  localeCode: string | null;
  caseCount: number;
  lastScore: unknown;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): GoldenSetRow {
  return {
    id: row.id,
    name: row.name,
    ownerTenantId: row.ownerTenantId,
    description: row.description,
    kind: row.kind as GoldenSetKind,
    localeCode: row.localeCode,
    caseCount: row.caseCount,
    lastScore: row.lastScore === null ? null : Number(row.lastScore),
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCaseRow(row: {
  id: string;
  goldenSetId: string;
  ordinal: number;
  prompt: string;
  expectedBehaviour: string;
  expectedToolCallsJson: string | null;
  expectedCitationSourceIdsJson: string | null;
  mustRefuse: boolean;
  localeCode: string;
  sourceConversationId: string | null;
  addedByStaffUserId: string;
  addedAt: Date;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): GoldenCaseRow {
  return { ...row };
}

export class PrismaGoldenSetRepository implements GoldenSetRepository {
  async list(): Promise<readonly GoldenSetRow[]> {
    const rows = await getTenantDb("evaluation golden set list").goldenSet.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(toSetRow);
  }

  async findById(goldenSetId: string): Promise<GoldenSetRow | null> {
    const row = await getTenantDb("evaluation golden set detail").goldenSet.findFirst({
      where: { id: goldenSetId, deletedAt: null },
    });
    return row ? toSetRow(row) : null;
  }

  async create(input: NewGoldenSetInput): Promise<GoldenSetRow> {
    const row = await getTenantDb("evaluation golden set create").goldenSet.create({
      data: {
        id: newUlid(),
        name: input.name,
        ownerTenantId: input.ownerTenantId,
        description: input.description,
        kind: input.kind,
        localeCode: input.localeCode,
        // Trigger-maintained from here on (`TR_GoldenCases_recount`) — a brand-new set
        // starts at 0 cases, which is the one value this repository is ever allowed to
        // set directly, precisely because no case exists yet for the trigger to count.
        caseCount: 0,
        lastScore: null,
        lastRunAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toSetRow(row);
  }

  async updateScore(goldenSetId: string, score: number | null, at: Date): Promise<void> {
    await getTenantDb("evaluation golden set score update").goldenSet.update({
      where: { id: goldenSetId },
      data: { lastScore: score, lastRunAt: at, updatedAt: at },
    });
  }
}

export class PrismaGoldenCaseRepository implements GoldenCaseRepository {
  async listForSet(goldenSetId: string): Promise<readonly GoldenCaseRow[]> {
    const rows = await getTenantDb("evaluation golden case list").goldenCase.findMany({
      where: { goldenSetId, deletedAt: null, isEnabled: true },
      orderBy: { ordinal: "asc" },
    });
    return rows.map(toCaseRow);
  }

  async findById(goldenCaseId: string): Promise<GoldenCaseRow | null> {
    const row = await getTenantDb("evaluation golden case detail").goldenCase.findFirst({
      where: { id: goldenCaseId, deletedAt: null },
    });
    return row ? toCaseRow(row) : null;
  }

  async nextOrdinal(goldenSetId: string): Promise<number> {
    const last = await getTenantDb("evaluation golden case next ordinal").goldenCase.findFirst({
      where: { goldenSetId },
      orderBy: { ordinal: "desc" },
      select: { ordinal: true },
    });
    return (last?.ordinal ?? 0) + 1;
  }

  async add(input: NewGoldenCaseInput): Promise<GoldenCaseRow> {
    const ordinal = await this.nextOrdinal(input.goldenSetId);
    // `UQ_GoldenCases_sourceConversation`/`CK_GoldenCases_refusalHasNoTools` are real,
    // and NOT caught here — the raw Prisma error (`P2002`) propagates to
    // `application/add-case-from-transcript.ts`, which is the one place that translates
    // it, matching this port's own doc comment.
    const row = await getTenantDb("evaluation golden case add").goldenCase.create({
      data: {
        id: newUlid(),
        goldenSetId: input.goldenSetId,
        ordinal,
        prompt: input.prompt,
        expectedBehaviour: input.expectedBehaviour,
        expectedToolCallsJson: input.expectedToolCallsJson,
        expectedCitationSourceIdsJson: input.expectedCitationSourceIdsJson,
        mustRefuse: input.mustRefuse,
        localeCode: input.localeCode,
        sourceConversationId: input.sourceConversationId,
        addedByStaffUserId: input.addedByStaffUserId,
        addedAt: input.now,
        isEnabled: true,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toCaseRow(row);
  }

  async update(goldenCaseId: string, patch: UpdateGoldenCaseInput): Promise<GoldenCaseRow> {
    // Conditional spread per field, not a plain object literal — `exactOptionalPropertyTypes`
    // rejects an explicit `undefined` against Prisma's own optional-but-not-nullable update
    // fields (e.g. `prompt?: string`, no `| undefined` in its own type), matching this
    // codebase's established fix for the identical shape (`checkbox.tsx`'s own note).
    const row = await getTenantDb("evaluation golden case update").goldenCase.update({
      where: { id: goldenCaseId },
      data: {
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...(patch.expectedBehaviour !== undefined
          ? { expectedBehaviour: patch.expectedBehaviour }
          : {}),
        ...(patch.expectedToolCallsJson !== undefined
          ? { expectedToolCallsJson: patch.expectedToolCallsJson }
          : {}),
        ...(patch.expectedCitationSourceIdsJson !== undefined
          ? { expectedCitationSourceIdsJson: patch.expectedCitationSourceIdsJson }
          : {}),
        ...(patch.mustRefuse !== undefined ? { mustRefuse: patch.mustRefuse } : {}),
        ...(patch.localeCode !== undefined ? { localeCode: patch.localeCode } : {}),
        ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled } : {}),
        updatedAt: patch.now,
      },
    });
    return toCaseRow(row);
  }

  async remove(goldenCaseId: string, now: Date): Promise<void> {
    await getTenantDb("evaluation golden case remove").goldenCase.update({
      where: { id: goldenCaseId },
      data: { deletedAt: now, updatedAt: now },
    });
  }
}
