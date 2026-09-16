/**
 * CLI entry point for B-8's real, permanent seed data: B11 tab 1's three
 * verification providers, the account-ownership-check singleton, B11 tab 2's
 * four step-up rules (respecting `TR_StepUpRules_paymentFloor`), B11 tab 5's
 * identity-stitching singleton, B11 tab 3's two payment gateways, and the
 * receipt-settings singleton — all previously-unseeded gaps, the same class
 * of gap `seed-agent-runtime-demo-data.ts` closed for B12's policy catalogue.
 *
 *   pnpm exec tsx scripts/seed-identity-payments-demo-data.ts
 *
 * (also wired as `pnpm db:seed:identity-payments`.) Idempotent throughout
 * (upsert/find-then-create by natural key), safe to re-run.
 */

import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import {
  disconnectAllTenantDbs,
  getTenantDb,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { disconnectCache } from "../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { newUlid } from "../apps/web/src/modules/platform/adapters/outbound/sql/ulid.js";

const VERIFICATION_PROVIDERS = [
  {
    key: "UaePass",
    name: "UAE PASS",
    providerType: "NationalDigitalIdentity",
    ordinal: 1,
    providesAssurance: "Verified",
  },
  {
    key: "OtpSms",
    name: "OTP to registered mobile",
    providerType: "PossessionFactor",
    ordinal: 2,
    providesAssurance: "VerifiedPlusOtp",
  },
  {
    key: "EmiratesIdScan",
    name: "Emirates ID scan",
    providerType: "DocumentCheck",
    ordinal: 3,
    providesAssurance: "VerifiedPlusDocument",
  },
] as const;

/** B11 tab 2's four actions (FR-PAY-06's payment floor is VerifiedPlusOtp). */
const STEP_UP_RULES = [
  { actionKey: "ViewBillBalance", requiredAssurance: "Anonymous", ordinal: 1 },
  { actionKey: "LinkUtilityAccount", requiredAssurance: "Verified", ordinal: 2 },
  { actionKey: "InitiatePayment", requiredAssurance: "VerifiedPlusOtp", ordinal: 3 },
  { actionKey: "ChangeRegisteredMobile", requiredAssurance: "VerifiedPlusOtp", ordinal: 4 },
] as const;

const PAYMENT_GATEWAYS = [
  {
    key: "sharjah-pay",
    name: "Sharjah Pay",
    methodsJson: JSON.stringify(["card", "apple_pay", "bank_transfer"]),
    mode: "Live",
    credentialSecretRef: "secret://sharjah-pay/api-key",
    isEnabled: true,
    supportsRefunds: true,
  },
  {
    key: "sewa-direct-debit",
    name: "SEWA Direct Debit",
    methodsJson: JSON.stringify(["direct_debit"]),
    mode: "Sandbox",
    credentialSecretRef: "secret://sewa-direct-debit/mandate-key",
    isEnabled: true,
    supportsRefunds: false,
  },
] as const;

async function seedVerificationProviders(): Promise<void> {
  const db = getTenantDb("seed verification providers");
  for (const provider of VERIFICATION_PROVIDERS) {
    const existing = await db.verificationProvider.findUnique({ where: { key: provider.key } });
    if (existing) continue;
    await db.verificationProvider.create({
      data: {
        id: newUlid(),
        key: provider.key,
        name: provider.name,
        providerType: provider.providerType,
        note: null,
        isEnabled: true,
        ordinal: provider.ordinal,
        configJson: null,
        credentialSecretRef: `secret://${provider.key}/config`,
        providesAssurance: provider.providesAssurance,
        createdAt: new Date(),
      },
    });
  }
  console.info(
    `[seed-identity-payments] ${VERIFICATION_PROVIDERS.length} verification providers ensured.`,
  );
}

async function seedVerificationConfig(): Promise<void> {
  const db = getTenantDb("seed verification config");
  const existing = await db.verificationConfig.findFirst({ where: { singletonKey: 1 } });
  if (existing) {
    console.info("[seed-identity-payments] VerificationConfig already present, skipping.");
    return;
  }
  await db.verificationConfig.create({
    data: {
      id: newUlid(),
      singletonKey: 1,
      accountOwnershipCheckEnabled: true,
      otpLengthDigits: 6,
      otpTtlSeconds: 300,
      otpMaxAttempts: 5,
      createdAt: new Date(),
    },
  });
  console.info(
    "[seed-identity-payments] VerificationConfig singleton created (ownership check ON).",
  );
}

async function seedStepUpRules(): Promise<void> {
  const db = getTenantDb("seed step-up rules");
  for (const rule of STEP_UP_RULES) {
    const existing = await db.stepUpRule.findUnique({ where: { actionKey: rule.actionKey } });
    if (existing) continue;
    await db.stepUpRule.create({
      data: {
        id: newUlid(),
        actionKey: rule.actionKey,
        requiredAssurance: rule.requiredAssurance,
        isEnabled: true,
        ordinal: rule.ordinal,
        createdAt: new Date(),
      },
    });
  }
  console.info(`[seed-identity-payments] ${STEP_UP_RULES.length} step-up rules ensured.`);
}

async function seedIdentityStitchingConfig(): Promise<void> {
  const db = getTenantDb("seed identity stitching config");
  const existing = await db.identityStitchingConfig.findFirst({ where: { singletonKey: 1 } });
  if (existing) {
    console.info("[seed-identity-payments] IdentityStitchingConfig already present, skipping.");
    return;
  }
  await db.identityStitchingConfig.create({
    data: {
      id: newUlid(),
      singletonKey: 1,
      stitchAcrossChannels: true,
      stitchingKey: "VerifiedEmiratesIdHash",
      conversationMemoryScope: "PerVerifiedIdentity",
      createdAt: new Date(),
    },
  });
  console.info("[seed-identity-payments] IdentityStitchingConfig singleton created.");
}

async function seedPaymentGateways(): Promise<Record<string, string>> {
  const db = getTenantDb("seed payment gateways");
  const ids: Record<string, string> = {};
  for (const gateway of PAYMENT_GATEWAYS) {
    const existing = await db.paymentGateway.findUnique({ where: { key: gateway.key } });
    if (existing) {
      ids[gateway.key] = existing.id;
      continue;
    }
    const created = await db.paymentGateway.create({
      data: { id: newUlid(), ...gateway, createdAt: new Date() },
    });
    ids[gateway.key] = created.id;
  }
  console.info(`[seed-identity-payments] ${PAYMENT_GATEWAYS.length} payment gateways ensured.`);
  return ids;
}

async function seedReceiptConfig(): Promise<void> {
  const db = getTenantDb("seed receipt config");
  const existing = await db.receiptConfig.findFirst({ where: { singletonKey: 1 } });
  if (existing) {
    console.info("[seed-identity-payments] ReceiptConfig already present, skipping.");
    return;
  }
  await db.receiptConfig.create({
    data: {
      id: newUlid(),
      singletonKey: 1,
      sendInConversation: true,
      emailPdfCopy: false,
      allowRefundRequestsFromAssistant: false,
      createdAt: new Date(),
    },
  });
  console.info("[seed-identity-payments] ReceiptConfig singleton created.");
}

async function main(): Promise<void> {
  await runWithTenant(
    {
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId: "seed-identity-payments",
      platformScope: "provisioning",
    },
    async () => {
      await seedVerificationProviders();
      await seedVerificationConfig();
      await seedStepUpRules();
      await seedIdentityStitchingConfig();
      const gatewayIds = await seedPaymentGateways();
      await seedReceiptConfig();
      console.info("[seed-identity-payments] gateway ids:", gatewayIds);
    },
  );
  await disconnectAllTenantDbs();
  await disconnectCache();
}

main().catch((error: unknown) => {
  console.error("[seed-identity-payments] failed:", error);
  process.exitCode = 1;
});
