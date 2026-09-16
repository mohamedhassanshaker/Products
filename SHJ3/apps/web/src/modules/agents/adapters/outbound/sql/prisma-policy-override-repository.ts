/**
 * The real `PolicyOverrideRepository` — B3 step 7 (Guardrails). Reads the platform
 * catalogue (`platform.Policies`/`platform.OverridablePolicies`) via `getPlatformDb()` and
 * writes the tenant-scoped `PolicyOverrides` via `getTenantDb()` — a real cross-schema
 * reference with no Prisma `@relation` (`PolicyOverride`'s own doc comment, ADR-0011): "a
 * caller needing the `OverridablePolicy` row reads it separately."
 */

import {
  getPlatformDb,
  getTenantDb,
} from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  AgentPolicyOverrideRow,
  GuardrailPolicyRow,
  PolicyOverrideRepository,
} from "../../../ports/policy-override-repository.js";

const OPERATION = "agents policy override repository";

export class PrismaPolicyOverrideRepository implements PolicyOverrideRepository {
  async listGuardrailPolicies(
    policyKeys: readonly string[],
  ): Promise<readonly GuardrailPolicyRow[]> {
    const platformDb = getPlatformDb(OPERATION);
    const [policies, overridable] = await Promise.all([
      platformDb.policy.findMany({ where: { policyKey: { in: [...policyKeys] } } }),
      platformDb.overridablePolicy.findMany({ where: { policyKey: { in: [...policyKeys] } } }),
    ]);
    const overridableKeys = new Set(overridable.map((o) => o.policyKey));

    return policies.map((p) => ({
      policyKey: p.policyKey,
      title: p.title,
      detail: p.detail,
      kind: p.kind,
      defaultValueJson: p.defaultValueJson,
      // "Existence in OverridablePolicies IS the permission to override" — a locked policy
      // is never in that table, so this is the one, unambiguous source for the flag rather
      // than trusting `Policies.isLocked` alone (which `TR_Policies_syncOverridable` keeps
      // in sync with this table anyway, but the join is the ground truth this repository
      // actually queried).
      isLocked: !overridableKeys.has(p.policyKey),
    }));
  }

  async listOverridesForAgent(agentId: string): Promise<readonly AgentPolicyOverrideRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.policyOverride.findMany({ where: { agentId, removedAt: null } });
    return rows.map((r) => ({
      id: r.id,
      policyKey: r.policyKey,
      mode: r.mode,
      valueJson: r.valueJson,
      reason: r.reason,
    }));
  }

  async setOverride(input: {
    readonly agentId: string;
    readonly policyKey: string;
    readonly mode: "Value" | "Disabled";
    readonly valueJson: string | null;
    readonly reason: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    const existing = await db.policyOverride.findFirst({
      where: { agentId: input.agentId, policyKey: input.policyKey, removedAt: null },
    });

    if (existing) {
      await db.policyOverride.update({
        where: { id: existing.id },
        data: {
          mode: input.mode,
          valueJson: input.valueJson,
          reason: input.reason,
          updatedAt: input.now,
        },
      });
      return;
    }

    await db.policyOverride.create({
      data: {
        id: newUlid(input.now),
        agentId: input.agentId,
        policyKey: input.policyKey,
        mode: input.mode,
        valueJson: input.valueJson,
        reason: input.reason,
        createdByStaffUserId: input.actorStaffUserId,
        removedByStaffUserId: null,
        removedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  }

  async clearOverride(
    agentId: string,
    policyKey: string,
    actorStaffUserId: string,
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.policyOverride.updateMany({
      where: { agentId, policyKey, removedAt: null },
      data: { removedByStaffUserId: actorStaffUserId, removedAt: now, updatedAt: now },
    });
  }
}
