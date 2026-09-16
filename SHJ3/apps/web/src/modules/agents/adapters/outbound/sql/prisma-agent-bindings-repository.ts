/**
 * The real `AgentBindingsRepository` — `AgentKnowledgeBindings`/`AgentFlowBindings`/
 * `AgentChannelBindings`/`AgentLocaleBindings`, per-tenant.
 *
 * Every `replace*` method is delete-then-recreate inside one transaction, matching
 * `docs/api.md`'s "Body is the full set... so the toggles cannot drift" contract exactly —
 * a partial merge would let a client's stale view silently resurrect a binding it meant to
 * remove.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isChannelKey, type ChannelKey } from "../../../domain/agent.js";
import type {
  AgentBindingsRepository,
  ChannelBindingRow,
  FlowBindingRow,
  KnowledgeBindingRow,
  LocaleBindingRow,
} from "../../../ports/agent-bindings-repository.js";

const OPERATION = "agents bindings repository";

export class PrismaAgentBindingsRepository implements AgentBindingsRepository {
  async listKnowledgeBindings(agentVersionId: string): Promise<readonly KnowledgeBindingRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.agentKnowledgeBinding.findMany({ where: { agentVersionId } });
    return rows.map((r) => ({
      knowledgeCollectionId: r.knowledgeCollectionId,
      isEnabled: r.isEnabled,
    }));
  }

  async replaceKnowledgeBindings(
    agentVersionId: string,
    bindings: readonly KnowledgeBindingRow[],
    boundByStaffUserId: string,
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    let tick = 0;
    await db.$transaction([
      db.agentKnowledgeBinding.deleteMany({ where: { agentVersionId } }),
      ...bindings.map((b) =>
        db.agentKnowledgeBinding.create({
          data: {
            id: newUlid(new Date(now.getTime() + tick++)),
            agentVersionId,
            knowledgeCollectionId: b.knowledgeCollectionId,
            isEnabled: b.isEnabled,
            boundByStaffUserId,
            boundAt: now,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ]);
  }

  async listFlowBindings(agentVersionId: string): Promise<readonly FlowBindingRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.agentFlowBinding.findMany({
      where: { agentVersionId },
      orderBy: { ordinal: "asc" },
    });
    return rows.map((r) => ({
      flowId: r.flowId,
      flowVersionId: r.flowVersionId,
      isEnabled: r.isEnabled,
      ordinal: r.ordinal,
    }));
  }

  async replaceFlowBindings(
    agentVersionId: string,
    bindings: readonly FlowBindingRow[],
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    let tick = 0;
    await db.$transaction([
      db.agentFlowBinding.deleteMany({ where: { agentVersionId } }),
      ...bindings.map((b) =>
        db.agentFlowBinding.create({
          data: {
            id: newUlid(new Date(now.getTime() + tick++)),
            agentVersionId,
            flowId: b.flowId,
            flowVersionId: b.flowVersionId,
            isEnabled: b.isEnabled,
            ordinal: b.ordinal,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ]);
  }

  async listChannelBindings(agentVersionId: string): Promise<readonly ChannelBindingRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.agentChannelBinding.findMany({ where: { agentVersionId } });
    return rows
      .filter((r): r is typeof r & { channelKey: ChannelKey } => isChannelKey(r.channelKey))
      .map((r) => ({ channelKey: r.channelKey, isEnabled: r.isEnabled }));
  }

  async replaceChannelBindings(
    agentVersionId: string,
    bindings: readonly ChannelBindingRow[],
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    let tick = 0;
    await db.$transaction([
      db.agentChannelBinding.deleteMany({ where: { agentVersionId } }),
      ...bindings.map((b) =>
        db.agentChannelBinding.create({
          data: {
            id: newUlid(new Date(now.getTime() + tick++)),
            agentVersionId,
            channelKey: b.channelKey,
            isEnabled: b.isEnabled,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ]);
  }

  async listLocaleBindings(agentVersionId: string): Promise<readonly LocaleBindingRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.agentLocaleBinding.findMany({ where: { agentVersionId } });
    return rows.map((r) => ({ localeCode: r.localeCode, isPrimary: r.isPrimary }));
  }

  async replaceLocaleBindings(
    agentVersionId: string,
    bindings: readonly LocaleBindingRow[],
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    let tick = 0;
    await db.$transaction([
      db.agentLocaleBinding.deleteMany({ where: { agentVersionId } }),
      ...bindings.map((b) =>
        db.agentLocaleBinding.create({
          data: {
            id: newUlid(new Date(now.getTime() + tick++)),
            agentVersionId,
            localeCode: b.localeCode,
            isPrimary: b.isPrimary,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ]);
  }
}
