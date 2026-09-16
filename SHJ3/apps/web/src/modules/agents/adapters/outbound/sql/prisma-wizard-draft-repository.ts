/** The real `WizardDraftRepository` — `AgentWizardDrafts`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { WizardDraft, WizardDraftRepository } from "../../../ports/wizard-draft-repository.js";

const OPERATION = "agents wizard draft repository";

export class PrismaWizardDraftRepository implements WizardDraftRepository {
  async findByOwnerAndAgent(
    ownerStaffUserId: string,
    agentId: string,
  ): Promise<WizardDraft | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.agentWizardDraft.findFirst({ where: { ownerStaffUserId, agentId } });
    if (!row || !row.agentVersionId) return null;
    return {
      id: row.id,
      agentId: row.agentId ?? agentId,
      agentVersionId: row.agentVersionId,
      ownerStaffUserId: row.ownerStaffUserId,
      lastStep: row.lastStep,
      stepStateJson: row.stepStateJson,
      updatedAt: row.updatedAt,
    };
  }

  async create(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly ownerStaffUserId: string;
    readonly now: Date;
  }): Promise<WizardDraft> {
    const db = getTenantDb(OPERATION);
    const id = newUlid(input.now);
    const row = await db.agentWizardDraft.create({
      data: {
        id,
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        ownerStaffUserId: input.ownerStaffUserId,
        lastStep: 1,
        stepStateJson: "{}",
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return {
      id: row.id,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      ownerStaffUserId: row.ownerStaffUserId,
      lastStep: row.lastStep,
      stepStateJson: row.stepStateJson,
      updatedAt: row.updatedAt,
    };
  }

  async saveStep(input: {
    readonly draftId: string;
    readonly lastStep: number;
    readonly stepStateJson: string;
    readonly now: Date;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.agentWizardDraft.update({
      where: { id: input.draftId },
      data: { lastStep: input.lastStep, stepStateJson: input.stepStateJson, updatedAt: input.now },
    });
  }

  async deleteForAgent(agentId: string): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.agentWizardDraft.deleteMany({ where: { agentId } });
  }
}
