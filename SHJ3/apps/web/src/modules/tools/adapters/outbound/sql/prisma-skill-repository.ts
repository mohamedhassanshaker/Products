/** The real `SkillRepository` — `Skills`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isSkillInvocationKind } from "../../../domain/tool-catalog.js";
import type {
  DeleteSkillResult,
  NewNativeSkillInput,
  SkillRepository,
  SkillRow,
} from "../../../ports/skill-repository.js";

const OPERATION = "tools skill repository";

function slugifyKey(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "skill"
  );
}

function toSkillRow(row: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  invocationKind: string;
  apiConnectorId: string | null;
  mcpToolId: string | null;
  inputSchemaJson: string;
  outputSchemaJson: string | null;
  rateLimitPolicyId: string | null;
  isSystem: boolean;
  isAttachedByDefault: boolean;
}): SkillRow {
  if (!isSkillInvocationKind(row.invocationKind)) {
    throw new Error(`Skill ${row.id} has an unrecognized invocationKind "${row.invocationKind}".`);
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    invocationKind: row.invocationKind,
    apiConnectorId: row.apiConnectorId,
    mcpToolId: row.mcpToolId,
    inputSchemaJson: row.inputSchemaJson,
    outputSchemaJson: row.outputSchemaJson,
    rateLimitPolicyId: row.rateLimitPolicyId,
    isSystem: row.isSystem,
    isAttachedByDefault: row.isAttachedByDefault,
  };
}

export class PrismaSkillRepository implements SkillRepository {
  async list(): Promise<readonly SkillRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.skill.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
    return rows.map(toSkillRow);
  }

  async get(id: string): Promise<SkillRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.skill.findFirst({ where: { id, deletedAt: null } });
    return row ? toSkillRow(row) : null;
  }

  async createNative(input: NewNativeSkillInput): Promise<SkillRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.skill.findMany({ where: { deletedAt: null }, select: { key: true } });
    const taken = new Set(existing.map((r) => r.key));
    const base = slugifyKey(input.name);
    let key = base;
    for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}_${suffix}`;

    const row = await db.skill.create({
      data: {
        id: newUlid(input.now),
        key,
        name: input.name,
        description: input.description,
        category: input.category,
        invocationKind: "Native",
        apiConnectorId: null,
        mcpToolId: null,
        inputSchemaJson: input.inputSchemaJson,
        outputSchemaJson: input.outputSchemaJson,
        rateLimitPolicyId: null,
        isSystem: false,
        isAttachedByDefault: input.isAttachedByDefault,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toSkillRow(row);
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly description?: string | null;
      readonly category?: string | null;
    },
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.skill.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        updatedAt: now,
      },
    });
  }

  async softDelete(id: string, now: Date): Promise<DeleteSkillResult> {
    const db = getTenantDb(OPERATION);
    const activeBindings = await db.toolBinding.findMany({
      where: { skillId: id, isEnabled: true },
      select: { agentVersionId: true },
    });
    if (activeBindings.length > 0) {
      return {
        ok: false,
        reason: "tools.skill_in_use",
        boundAgentVersionIds: activeBindings.map((b) => b.agentVersionId),
      };
    }
    await db.skill.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
    return { ok: true };
  }
}
