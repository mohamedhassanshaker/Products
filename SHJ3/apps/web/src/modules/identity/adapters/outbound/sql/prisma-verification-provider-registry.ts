/**
 * The real `VerificationProviderRegistry` — `VerificationProviders`, per-tenant.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { isRequiredAssuranceLevel } from "../../../../tools/domain/tool-catalog.js";
import type {
  ToggleProviderResult,
  VerificationProviderKey,
  VerificationProviderRegistry,
  VerificationProviderRow,
} from "../../../ports/verification-provider-registry.js";

const OPERATION = "identity verification-provider registry";
const PROVIDER_TYPES = ["NationalDigitalIdentity", "PossessionFactor", "DocumentCheck"] as const;
const PROVIDER_KEYS = ["UaePass", "OtpSms", "EmiratesIdScan"] as const;

function toRow(row: {
  id: string;
  key: string;
  name: string;
  providerType: string;
  note: string | null;
  isEnabled: boolean;
  ordinal: number;
  providesAssurance: string;
}): VerificationProviderRow {
  if (
    !(PROVIDER_KEYS as readonly string[]).includes(row.key) ||
    !(PROVIDER_TYPES as readonly string[]).includes(row.providerType) ||
    !isRequiredAssuranceLevel(row.providesAssurance)
  ) {
    throw new Error(
      `VerificationProvider ${row.id} has an unrecognized key/providerType/providesAssurance.`,
    );
  }
  return {
    id: row.id,
    key: row.key as VerificationProviderKey,
    name: row.name,
    providerType: row.providerType as VerificationProviderRow["providerType"],
    note: row.note,
    isEnabled: row.isEnabled,
    ordinal: row.ordinal,
    providesAssurance: row.providesAssurance,
  };
}

export class PrismaVerificationProviderRegistry implements VerificationProviderRegistry {
  async list(): Promise<readonly VerificationProviderRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.verificationProvider.findMany({ orderBy: { ordinal: "asc" } });
    return rows.map(toRow);
  }

  async setEnabled(input: {
    readonly key: VerificationProviderKey;
    readonly isEnabled: boolean;
    readonly now: Date;
  }): Promise<ToggleProviderResult> {
    const db = getTenantDb(OPERATION);

    // Refuse to disable the last enabled provider a live, enabled step-up rule
    // still needs — a rule that can never be satisfied silently blocks every
    // payment (api.md §6.10). Checked against StepUpRules directly rather than
    // through the identity module's own StepUpRuleRepository, since this
    // adapter already holds a tenant-scoped Prisma client and a second port
    // dependency here would be a cross-adapter coupling for one read.
    if (!input.isEnabled) {
      const [provider, enabledProviders, enabledRules] = await Promise.all([
        db.verificationProvider.findUnique({ where: { key: input.key } }),
        db.verificationProvider.findMany({ where: { isEnabled: true } }),
        db.stepUpRule.findMany({ where: { isEnabled: true } }),
      ]);
      const wouldBeLastForRequiredLevel =
        enabledRules.length > 0 &&
        enabledProviders.length === 1 &&
        provider !== null &&
        enabledProviders[0]?.key === input.key;
      if (wouldBeLastForRequiredLevel) {
        return { ok: false, reason: "identity.provider_still_required" };
      }
    }

    const row = await db.verificationProvider.update({
      where: { key: input.key },
      data: { isEnabled: input.isEnabled, updatedAt: input.now },
    });
    return { ok: true, provider: toRow(row) };
  }
}
