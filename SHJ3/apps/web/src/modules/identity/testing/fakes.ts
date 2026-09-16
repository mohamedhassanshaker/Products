/**
 * In-memory fakes for every `identity` port — mirrors `iam/testing/fakes.ts`'s
 * convention: constructor records state, ids are generated deterministically,
 * every unhappy path (the payment floor, the disable-needs-reason check, the
 * verified-only stitching rule) is reachable so a unit test can drive it
 * without touching SQL Server.
 */

import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";
import type { StepUpAction } from "../domain/step-up.js";
import type {
  CitizenIdentityRepository,
  CitizenIdentityRow,
} from "../ports/citizen-identity-repository.js";
import type {
  ConversationMemoryScope,
  IdentityStitchingConfigRepository,
  IdentityStitchingConfigRow,
  SetStitchingConfigResult,
  StitchingKey,
} from "../ports/identity-stitching-config-repository.js";
import type {
  CreateIdentityLinkResult,
  IdentityLinkRepository,
  IdentityLinkRow,
} from "../ports/identity-link-repository.js";
import type {
  LinkedServiceAccountRepository,
  LinkedServiceAccountRow,
} from "../ports/linked-service-account-repository.js";
import type {
  SetStepUpRuleResult,
  StepUpRuleRepository,
  StepUpRuleRow,
} from "../ports/step-up-rule-repository.js";
import type {
  VerificationAttemptRepository,
  VerificationAttemptResult,
  VerificationAttemptRow,
} from "../ports/verification-attempt-repository.js";
import type {
  VerificationConfigRepository,
  VerificationConfigRow,
} from "../ports/verification-config-repository.js";
import type {
  ToggleProviderResult,
  VerificationProviderKey,
  VerificationProviderRegistry,
  VerificationProviderRow,
} from "../ports/verification-provider-registry.js";

let idCounter = 0;
function fakeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_fake_${idCounter}`;
}

export class FakeStepUpRuleRepository implements StepUpRuleRepository {
  private readonly rows = new Map<StepUpAction, StepUpRuleRow>();

  seed(rule: StepUpRuleRow): void {
    this.rows.set(rule.actionKey, rule);
  }

  async list(): Promise<readonly StepUpRuleRow[]> {
    return [...this.rows.values()].sort((a, b) => a.ordinal - b.ordinal);
  }

  async findByAction(actionKey: StepUpAction): Promise<StepUpRuleRow | null> {
    return this.rows.get(actionKey) ?? null;
  }

  async setRequiredAssurance(input: {
    readonly actionKey: StepUpAction;
    readonly requiredAssurance: RequiredAssuranceLevel;
    readonly now: Date;
  }): Promise<SetStepUpRuleResult> {
    const existing = this.rows.get(input.actionKey);
    const rule: StepUpRuleRow = {
      id: existing?.id ?? fakeId("stepup"),
      actionKey: input.actionKey,
      requiredAssurance: input.requiredAssurance,
      isEnabled: existing?.isEnabled ?? true,
      ordinal: existing?.ordinal ?? this.rows.size + 1,
    };
    this.rows.set(input.actionKey, rule);
    return { ok: true, rule };
  }
}

export class FakeVerificationConfigRepository implements VerificationConfigRepository {
  private row: VerificationConfigRow = {
    accountOwnershipCheckEnabled: true,
    ownershipCheckDisabledReason: null,
    ownershipCheckLastChangedByStaffUserId: null,
    ownershipCheckLastChangedAt: null,
    otpLengthDigits: 6,
    otpTtlSeconds: 300,
    otpMaxAttempts: 5,
  };

  async get(): Promise<VerificationConfigRow> {
    return this.row;
  }

  async setAccountOwnershipCheck(input: {
    readonly enabled: boolean;
    readonly reason: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<VerificationConfigRow> {
    this.row = {
      ...this.row,
      accountOwnershipCheckEnabled: input.enabled,
      ownershipCheckDisabledReason: input.enabled ? null : input.reason,
      ownershipCheckLastChangedByStaffUserId: input.enabled ? null : input.actorStaffUserId,
      ownershipCheckLastChangedAt: input.enabled ? null : input.now,
    };
    return this.row;
  }
}

export class FakeVerificationProviderRegistry implements VerificationProviderRegistry {
  private readonly rows = new Map<VerificationProviderKey, VerificationProviderRow>([
    [
      "UaePass",
      {
        id: fakeId("vprov"),
        key: "UaePass",
        name: "UAE PASS",
        providerType: "NationalDigitalIdentity",
        note: null,
        isEnabled: true,
        ordinal: 1,
        providesAssurance: "Verified",
      },
    ],
    [
      "OtpSms",
      {
        id: fakeId("vprov"),
        key: "OtpSms",
        name: "OTP to registered mobile",
        providerType: "PossessionFactor",
        note: null,
        isEnabled: true,
        ordinal: 2,
        providesAssurance: "VerifiedPlusOtp",
      },
    ],
    [
      "EmiratesIdScan",
      {
        id: fakeId("vprov"),
        key: "EmiratesIdScan",
        name: "Emirates ID scan",
        providerType: "DocumentCheck",
        note: null,
        isEnabled: true,
        ordinal: 3,
        providesAssurance: "VerifiedPlusDocument",
      },
    ],
  ]);

  async list(): Promise<readonly VerificationProviderRow[]> {
    return [...this.rows.values()].sort((a, b) => a.ordinal - b.ordinal);
  }

  async setEnabled(input: {
    readonly key: VerificationProviderKey;
    readonly isEnabled: boolean;
    readonly now: Date;
  }): Promise<ToggleProviderResult> {
    const existing = this.rows.get(input.key);
    if (!existing) throw new Error(`Unknown verification provider "${input.key}".`);
    const provider = { ...existing, isEnabled: input.isEnabled };
    this.rows.set(input.key, provider);
    return { ok: true, provider };
  }
}

export class FakeIdentityStitchingConfigRepository implements IdentityStitchingConfigRepository {
  private row: IdentityStitchingConfigRow = {
    stitchAcrossChannels: true,
    stitchingKey: "VerifiedEmiratesIdHash",
    conversationMemoryScope: "PerVerifiedIdentity",
  };

  async get(): Promise<IdentityStitchingConfigRow> {
    return this.row;
  }

  async set(input: {
    readonly stitchAcrossChannels: boolean;
    readonly stitchingKey: StitchingKey;
    readonly conversationMemoryScope: ConversationMemoryScope;
    readonly now: Date;
  }): Promise<SetStitchingConfigResult> {
    // Mirrors `CK_IdentityStitchingConfigs_neverStitchCoherent`: "stitch on, key = never" is incoherent.
    const incoherent = (input.stitchingKey === "NeverStitch") !== !input.stitchAcrossChannels;
    if (incoherent) return { ok: false, reason: "identity.stitching_config_incoherent" };
    this.row = {
      stitchAcrossChannels: input.stitchAcrossChannels,
      stitchingKey: input.stitchingKey,
      conversationMemoryScope: input.conversationMemoryScope,
    };
    return { ok: true, config: this.row };
  }
}

export class FakeCitizenIdentityRepository implements CitizenIdentityRepository {
  readonly rows = new Map<string, CitizenIdentityRow>();

  seed(row: CitizenIdentityRow): void {
    this.rows.set(row.id, row);
  }

  async findById(id: string): Promise<CitizenIdentityRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findByEmiratesIdHash(emiratesIdHash: string): Promise<CitizenIdentityRow | null> {
    return (
      [...this.rows.values()].find(
        (row) => row.emiratesIdHash === emiratesIdHash && row.erasedAt === null,
      ) ?? null
    );
  }

  async recordVerification(input: {
    readonly citizenIdentityId: string | null;
    readonly assuranceLevel: RequiredAssuranceLevel;
    readonly emiratesIdHash: string | null;
    readonly mobileHash: string | null;
    readonly displayNameMasked: string | null;
    readonly verifiedByProviderKey: string | null;
    readonly verifiedAt: Date | null;
    readonly verificationExpiresAt: Date | null;
    readonly now: Date;
  }): Promise<CitizenIdentityRow> {
    const id = input.citizenIdentityId ?? fakeId("cid");
    const row: CitizenIdentityRow = {
      id,
      assuranceLevel: input.assuranceLevel,
      emiratesIdHash: input.emiratesIdHash,
      mobileHash: input.mobileHash,
      displayNameMasked: input.displayNameMasked,
      verifiedByProviderKey: input.verifiedByProviderKey,
      verifiedAt: input.verifiedAt,
      verificationExpiresAt: input.verificationExpiresAt,
      erasedAt: null,
    };
    this.rows.set(id, row);
    return row;
  }
}

export class FakeIdentityLinkRepository implements IdentityLinkRepository {
  readonly rows: IdentityLinkRow[] = [];

  async findActiveByChannelSubject(
    channelKey: string,
    channelSubjectHash: string,
  ): Promise<IdentityLinkRow | null> {
    return (
      this.rows.find(
        (row) =>
          row.channelKey === channelKey &&
          row.channelSubjectHash === channelSubjectHash &&
          row.unlinkedAt === null,
      ) ?? null
    );
  }

  async listActiveForIdentity(citizenIdentityId: string): Promise<readonly IdentityLinkRow[]> {
    return this.rows.filter(
      (r) => r.citizenIdentityId === citizenIdentityId && r.unlinkedAt === null,
    );
  }

  async create(input: {
    readonly citizenIdentityId: string;
    readonly channelKey: string;
    readonly channelSubjectHash: string;
    readonly assuranceLevelAtLink: RequiredAssuranceLevel;
    readonly stitchingKeyUsed: string | null;
    readonly now: Date;
  }): Promise<CreateIdentityLinkResult> {
    // Mirrors `CK_IdentityLinks_verifiedOnly` — the real adapter's belt-and-braces layer.
    if (input.assuranceLevelAtLink === "Anonymous") {
      return { ok: false, reason: "identity.stitching_requires_verified" };
    }
    const link: IdentityLinkRow = {
      id: fakeId("ilink"),
      citizenIdentityId: input.citizenIdentityId,
      channelKey: input.channelKey,
      channelSubjectHash: input.channelSubjectHash,
      assuranceLevelAtLink: input.assuranceLevelAtLink,
      stitchingKeyUsed: input.stitchingKeyUsed,
      linkedAt: input.now,
      unlinkedAt: null,
    };
    this.rows.push(link);
    return { ok: true, link };
  }

  async unlink(id: string, now: Date): Promise<void> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index === -1) return;
    this.rows[index] = { ...this.rows[index]!, unlinkedAt: now };
  }
}

export class FakeVerificationAttemptRepository implements VerificationAttemptRepository {
  readonly rows: VerificationAttemptRow[] = [];

  async record(input: {
    readonly conversationId: string | null;
    readonly citizenIdentityId: string | null;
    readonly providerKey: string;
    readonly actionKey: StepUpAction | null;
    readonly requiredAssurance: RequiredAssuranceLevel | null;
    readonly result: VerificationAttemptResult;
    readonly failureReason: string | null;
    readonly now: Date;
  }): Promise<VerificationAttemptRow> {
    const row: VerificationAttemptRow = {
      id: fakeId("vattempt"),
      conversationId: input.conversationId,
      citizenIdentityId: input.citizenIdentityId,
      providerKey: input.providerKey,
      actionKey: input.actionKey,
      requiredAssurance: input.requiredAssurance,
      result: input.result,
      failureReason: input.failureReason,
      attemptedAt: input.now,
    };
    this.rows.push(row);
    return row;
  }

  async countRecentFailures(conversationId: string, sinceInclusive: Date): Promise<number> {
    return this.rows.filter(
      (r) =>
        r.conversationId === conversationId &&
        r.result !== "Success" &&
        r.attemptedAt.getTime() >= sinceInclusive.getTime(),
    ).length;
  }
}

export class FakeLinkedServiceAccountRepository implements LinkedServiceAccountRepository {
  readonly rows: LinkedServiceAccountRow[] = [];

  async findActive(
    citizenIdentityId: string,
    providerKey: string,
    accountNumberHash: string,
  ): Promise<LinkedServiceAccountRow | null> {
    return (
      this.rows.find(
        (r) =>
          r.citizenIdentityId === citizenIdentityId &&
          r.providerKey === providerKey &&
          r.accountNumberHash === accountNumberHash &&
          r.unlinkedAt === null,
      ) ?? null
    );
  }

  async link(input: {
    readonly citizenIdentityId: string;
    readonly providerKey: string;
    readonly accountNumberMasked: string;
    readonly accountNumberHash: string;
    readonly ownershipVerified: boolean;
    readonly ownershipVerifiedVia: string | null;
    readonly now: Date;
  }): Promise<LinkedServiceAccountRow> {
    const row: LinkedServiceAccountRow = {
      id: fakeId("lsa"),
      citizenIdentityId: input.citizenIdentityId,
      providerKey: input.providerKey,
      accountNumberMasked: input.accountNumberMasked,
      accountNumberHash: input.accountNumberHash,
      ownershipVerified: input.ownershipVerified,
      ownershipVerifiedAt: input.ownershipVerified ? input.now : null,
      ownershipVerifiedVia: input.ownershipVerifiedVia,
      linkedAt: input.now,
      unlinkedAt: null,
    };
    this.rows.push(row);
    return row;
  }
}
