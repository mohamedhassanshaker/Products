/**
 * The real `PolicyCatalogueRepository` — reads/writes `platform.Policies`/`platform.
 * OverridablePolicies` via `getPlatformDb()` (ADR-0011: `platform` is a single, real,
 * always-present schema, not per-tenant), matching `PrismaEnvironmentRepository`'s own
 * `getPlatformDb()` precedent (`modules/governance/adapters/outbound/sql/
 * prisma-environment-repository.ts`).
 */

import { getPlatformDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  GlobalPolicyRow,
  PolicyCatalogueRepository,
  UpdateGlobalPolicyValueResult,
} from "../../../ports/policy-catalogue-repository.js";

const OPERATION = "guardrails policy catalogue";

export class PrismaPolicyCatalogueRepository implements PolicyCatalogueRepository {
  async list(): Promise<readonly GlobalPolicyRow[]> {
    const db = getPlatformDb(OPERATION);
    const [policies, overridable] = await Promise.all([
      db.policy.findMany({ orderBy: { policyKey: "asc" } }),
      db.overridablePolicy.findMany(),
    ]);
    const overridableKeys = new Set(overridable.map((o) => o.policyKey));

    return policies.map((p): GlobalPolicyRow => ({
      policyKey: p.policyKey,
      title: p.title,
      detail: p.detail,
      kind: p.kind,
      defaultValueJson: p.defaultValueJson,
      floorValueJson: p.floorValueJson,
      // Real membership, not the bare `isLocked` column — see this repository's own
      // port doc comment for why (`TR_Policies_syncOverridable` is the ground truth).
      isLocked: !overridableKeys.has(p.policyKey),
      appliesTo: p.appliesTo,
      updatedAt: p.updatedAt,
    }));
  }

  async findByKey(policyKey: string): Promise<GlobalPolicyRow | null> {
    const all = await this.list();
    return all.find((row) => row.policyKey === policyKey) ?? null;
  }

  async updateDefaultValue(input: {
    readonly policyKey: string;
    readonly defaultValueJson: string;
    readonly now: Date;
  }): Promise<UpdateGlobalPolicyValueResult> {
    const db = getPlatformDb(OPERATION);

    const policy = await db.policy.findUnique({ where: { policyKey: input.policyKey } });
    if (!policy) return { ok: false, reason: "policy_not_found" };

    // The real, server-side refusal — re-checked here, at write time, against the live
    // `OverridablePolicies` table, never against `policy.isLocked` (which
    // `TR_Policies_syncOverridable` keeps in sync with this table, but this query is the
    // actual mechanism the trigger enforces, and the one this method re-derives directly
    // rather than trusting a column that could theoretically be read stale). A locked
    // policy has no row here — full stop, Super Admin included — so this call refuses
    // identically no matter who calls it or how.
    const overridable = await db.overridablePolicy.findUnique({
      where: { policyKey: input.policyKey },
    });
    if (!overridable) return { ok: false, reason: "policy_locked" };

    await db.policy.update({
      where: { policyKey: input.policyKey },
      data: { defaultValueJson: input.defaultValueJson, updatedAt: input.now },
    });
    return { ok: true };
  }
}
