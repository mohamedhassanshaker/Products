/**
 * CLI entry point that mints real staff sessions for the E2E suite's three seeded, `Active`
 * demo users and writes each one out as a Playwright `storageState` JSON file.
 *
 *   pnpm exec tsx scripts/mint-e2e-sessions.ts
 *
 * (also wired as `pnpm db:seed:e2e-sessions`, and called by `e2e/global-setup.ts` before
 * every Playwright run.)
 *
 * ## Why this is a separate `tsx`-run script rather than logic inside `playwright.config.ts`
 *
 * `e2e/support/mint-session.ts` imports deep into `apps/web/src/modules/...` — real Prisma
 * clients, `@node-rs/argon2` native bindings, envelope encryption. Every other place in this
 * repo that runs TypeScript with that shape of import graph does it through `tsx`
 * (`scripts/*.ts`, wired as `pnpm db:seed:*`) precisely because it has full Node module
 * resolution and native-addon support; Playwright's own config/`globalSetup` loader uses a
 * separate, esbuild-based TypeScript transform that has never been exercised against this
 * import graph. Rather than assume it would work, this keeps `playwright.config.ts`'s
 * `globalSetup` a thin process-spawning wrapper (`e2e/global-setup.ts`, mirroring
 * `scripts/verify.mjs`'s own `spawnSync`-based orchestration) that shells out to `tsx` for
 * every step that touches real infrastructure — seeding included. One definition of "how
 * TypeScript scripts run against real infrastructure in this repo", not two.
 *
 * ## Output
 *
 * `e2e/.auth/<role>.json` per minted user — a full Playwright `storageState` document
 * (cookies + empty `origins`) that a spec or project config loads via `storageState:
 * "e2e/.auth/<role>.json"`. Regenerated on every run (sessions have a 12-hour absolute TTL,
 * `STAFF_SESSION_TTL`, so a stale file from an earlier day would silently fail every test
 * with a 401 instead of a clear seeding error) — `e2e/.auth/` is therefore git-ignored, the
 * same way `.env` itself is: generated, environment-specific, never a build artifact to
 * commit.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mintStaffSession, type MintedSession } from "../e2e/support/mint-session.js";
import { disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { disconnectCache } from "../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { E2E_DEMO_PASSWORD, E2E_TOTP_SECRET_BASE32 } from "../e2e/support/e2e-fixtures.js";

const ROOT = resolve(import.meta.dirname, "..");
const AUTH_DIR = resolve(ROOT, "e2e/.auth");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const COOKIE_DOMAIN = new URL(BASE_URL).hostname;

interface E2eSessionSpec {
  /** Output file stem — `e2e/.auth/<file>.json`. Named by role, not by person, so a spec reads intent (`agentDesigner.json`) rather than trivia. */
  readonly file: string;
  readonly email: string;
  readonly ambientTenant: string;
  readonly totpSecretBase32?: string;
}

/** Sara Al Mazrouei / AgentDesigner / `sewa`, Omar Khan / LiveAgent / `customs`, Ahmed Saeed / SuperAdmin / `sharjah` — see `scripts/seed-iam-demo-data.ts` for the seed these depend on. Only Ahmed's role holds `agents:publish`/`users:manage`, so only he needs a TOTP secret (ADR-0006 rule 4). Khalid Al Marzouqi / LiveAgent / `sewa` is the one E2E-only fixture appended to that file's `USERS` array (2026-09-10) — the only seeded principal that combines `sewa` tenant membership with `escalations:handle`, needed so a citizen-widget E2E spec can prove a real handover is reflected in the real escalation queue through the real staff UI, not just a database row. */
const SESSIONS: readonly E2eSessionSpec[] = [
  { file: "agent-designer", email: "sara.almazrouei@shj.ae", ambientTenant: "sewa" },
  { file: "live-agent", email: "omar.khan@shj.ae", ambientTenant: "customs" },
  {
    file: "super-admin",
    email: "ahmed.saeed@shj.ae",
    ambientTenant: "sharjah",
    totpSecretBase32: E2E_TOTP_SECRET_BASE32,
  },
  { file: "live-agent-sewa", email: "khalid.marzouqi@shj.ae", ambientTenant: "sewa" },
];

function toStorageState(session: MintedSession): object {
  return {
    cookies: [
      {
        name: session.cookieName,
        value: session.cookieValue,
        domain: COOKIE_DOMAIN,
        path: "/",
        expires: Math.floor(session.expiresAt.getTime() / 1000),
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
}

async function main(): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });

  for (const spec of SESSIONS) {
    const session = await mintStaffSession({
      email: spec.email,
      password: E2E_DEMO_PASSWORD,
      totpSecretBase32: spec.totpSecretBase32,
      ambientTenant: assertValidSlugShape(spec.ambientTenant),
    });

    const outPath = resolve(AUTH_DIR, `${spec.file}.json`);
    await writeFile(outPath, JSON.stringify(toStorageState(session), null, 2), "utf8");
    console.info(
      `[mint-e2e-sessions] ${spec.email} -> ${outPath} (tenant "${session.principal.tenant}", ` +
        `expires ${session.expiresAt.toISOString()})`,
    );
  }

  console.info("[mint-e2e-sessions] done.");
}

main()
  .catch((error: unknown) => {
    console.error("[mint-e2e-sessions] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAllTenantDbs();
    await disconnectCache();
  });
