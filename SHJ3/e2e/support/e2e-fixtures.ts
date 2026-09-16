/**
 * Fixture constants shared between `scripts/seed-e2e-credentials.ts` and
 * `scripts/mint-e2e-sessions.ts` — split into its own side-effect-free module rather than
 * one script importing the other, because both of those scripts run a top-level `main()` on
 * import (the standard shape every `scripts/*.ts` CLI entry point in this repo uses); one
 * importing the other's constants would silently re-run the other's `main()` a second time
 * (and call `disconnectAllTenantDbs()`/`disconnectCache()` mid-flight of the importing
 * script's own work) as a side effect of an import statement — found and fixed during this
 * suite's own real, live-infrastructure smoke test, not assumed.
 *
 * These are test-fixture credential values for a throwaway local/CI database, never a
 * production secret — see `seed-e2e-credentials.ts`'s own module comment for the full
 * reasoning on why hardcoding them here is fine.
 */

/** The one password every E2E-active demo user shares. */
export const E2E_DEMO_PASSWORD = "E2e-Demo-Passw0rd!";

/** A syntactically valid RFC 4648 base32 TOTP seed (the published Google Authenticator example secret). */
export const E2E_TOTP_SECRET_BASE32 = "JBSWY3DPEHPK3PXP";
