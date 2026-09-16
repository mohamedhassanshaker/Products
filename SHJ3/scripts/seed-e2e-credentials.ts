/**
 * CLI entry point for E2E-only staff credentials — run once per environment, safe to
 * re-run (idempotent: an `upsert` keyed on `staffUserId`, matching `seed-iam-demo-data.ts`'s
 * own idempotency precedent).
 *
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *
 * (also wired as `pnpm db:seed:e2e-credentials`.)
 *
 * ## Why this script exists, distinct from `seed-iam-demo-data.ts`
 *
 * `seed-iam-demo-data.ts` seeds the B9 sample `StaffUsers` rows faithfully — which means
 * faithfully reproducing the fact that none of them carry a credential. That is correct
 * product behaviour (`FR-IAM-02`: an `Invited` user cannot authenticate; a real deployment
 * populates `StaffCredentials` only through the invite-acceptance flow, which this app does
 * not yet have a UI for — see `PrismaCredentialRepository`'s own module doc comment: "B-2
 * builds no sign-in page"). But Playwright cannot click through a login form that does not
 * exist yet (`e2e/support/mint-session.ts` mints sessions the same way that file's doc
 * comment says a "live-database proof script" already does — directly through
 * `LocalPasswordProvider.authenticate()`/`completeChallenge()`), and minting a session still
 * requires a real `StaffCredentials` row to authenticate against. This script is that one
 * additive step: known password + known TOTP secret for exactly the four seeded `Active`
 * demo users the E2E suite signs in as (Sara Al Mazrouei/AgentDesigner, Omar Khan/LiveAgent,
 * Ahmed Saeed/SuperAdmin, Khalid Al Marzouqi/LiveAgent-in-`sewa` — the last one an E2E-only
 * fixture appended to `seed-iam-demo-data.ts`'s own `USERS` array, not one of the wireframe's
 * original five rows; see that file's own comment for why). It does not touch `Invited`
 * (Priya Nair) or `Suspended` (Lina
 * Haddad) — both are deliberately left credential-less, which is itself the fixture: neither
 * can ever produce a session, proving those two states hold under a real sign-in attempt
 * rather than only in a unit test.
 *
 * ## Not idempotent the way `replacePassword`/`enrolTotp` alone would be
 *
 * `CredentialRepository.replacePassword()`/`.enrolTotp()` both `UPDATE` an existing row
 * (`prisma-credential-repository.ts`) — neither can create the first row, and neither
 * commits both halves (hash + TOTP secret) atomically. This script talks to
 * `platform.StaffCredentials` directly via `getPlatformDb()` (composition-root code, same
 * license `seed-iam-demo-data.ts`'s own module comment claims for constructing concrete
 * adapters directly) and `upsert`s the whole row in one write, using the exact same
 * `createArgon2idHasher()`/`encryptSecret()` the real adapter uses so a minted session is
 * indistinguishable from one a real sign-in would have produced.
 */

import { randomUUID } from "node:crypto";
import {
  getPlatformDb,
  disconnectAllTenantDbs,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { encryptSecret } from "../apps/web/src/modules/platform/adapters/outbound/crypto/envelope-encryption.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import {
  assertValidSlugShape,
  type TenantSlug,
} from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import {
  createArgon2idHasher,
  PASSWORD_ALGORITHM,
} from "../apps/web/src/modules/iam/adapters/outbound/local-password-provider.js";
import { E2E_DEMO_PASSWORD, E2E_TOTP_SECRET_BASE32 } from "../e2e/support/e2e-fixtures.js";

const SEWA: TenantSlug = assertValidSlugShape("sewa");

/** The four seeded `Active` demo users this suite signs in as. Tenant is needed only to bind *some* ambient context — `platform.StaffCredentials` itself is not tenant-scoped. */
const E2E_USERS: readonly { readonly email: string; readonly tenant: TenantSlug }[] = [
  { email: "sara.almazrouei@shj.ae", tenant: SEWA },
  { email: "omar.khan@shj.ae", tenant: SEWA },
  { email: "ahmed.saeed@shj.ae", tenant: SEWA },
  { email: "khalid.marzouqi@shj.ae", tenant: SEWA },
];

function runAsBootstrap<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    {
      tenant: SEWA,
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "provisioning",
    },
    fn,
  );
}

async function main(): Promise<void> {
  const hasher = createArgon2idHasher();
  const passwordHash = await hasher.hash(E2E_DEMO_PASSWORD);
  const totpSecretCipher = Uint8Array.from(encryptSecret(E2E_TOTP_SECRET_BASE32));

  await runAsBootstrap(async () => {
    const db = getPlatformDb("seed-e2e-credentials");

    for (const user of E2E_USERS) {
      // `findFirst`, not `findUnique`: `email` carries no Prisma-recognised unique
      // constraint (`UQ_StaffUsers_email` is a filtered index on `deletedAt IS NULL`,
      // which Prisma's schema-level `@unique` cannot express) — matching
      // `PrismaUserRepository.findByEmail()`'s own precedent and its identical filter.
      const staffUser = await db.staffUser.findFirst({
        where: { email: user.email.trim().toLowerCase(), deletedAt: null },
      });
      if (!staffUser) {
        throw new Error(
          `[seed-e2e-credentials] no StaffUser found for "${user.email}". ` +
            "Run `pnpm db:seed:iam` first — this script only adds credentials to already-seeded users.",
        );
      }

      const now = new Date();
      await db.staffCredential.upsert({
        where: { staffUserId: staffUser.id },
        create: {
          staffUserId: staffUser.id,
          passwordHash,
          passwordAlgorithm: PASSWORD_ALGORITHM,
          passwordUpdatedAt: now,
          mustChangePassword: false,
          totpSecretCipher,
          totpEnrolledAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
          createdAt: now,
        },
        update: {
          passwordHash,
          passwordAlgorithm: PASSWORD_ALGORITHM,
          passwordUpdatedAt: now,
          mustChangePassword: false,
          totpSecretCipher,
          totpEnrolledAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      console.info(`[seed-e2e-credentials] credential ready for "${user.email}".`);
    }
  });

  console.info("[seed-e2e-credentials] done.");
}

main()
  .catch((error: unknown) => {
    console.error("[seed-e2e-credentials] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectAllTenantDbs();
  });
