import { defineConfig } from '@playwright/test';

/**
 * Playwright Test config for Phase 10's consolidated black-box e2e suite (sub-slices "10b1"/"10b2").
 *
 * **Decision (documented per this dispatch's brief): upgrading from the ad-hoc `playwright` scripts
 * (`scripts/playwright-smoke*.ts`, run via `tsx` + manual `chromium.launch()`) to real
 * `@playwright/test` `describe`/`test` blocks for THIS suite specifically.** The migration plan's own
 * wording for Phase 10 is "one consolidated black-box Playwright e2e suite... organized by these
 * functional clusters" (not "a script") — a suite meant to be re-run repeatably by QA/CI needs
 * per-test pass/fail reporting, isolated failures (one assertion failing must not abort every other
 * cluster's tests the way a single top-to-bottom script would), parallelization control, and retry/
 * trace tooling — all things `@playwright/test` gives for free and the ad-hoc scripts deliberately
 * never needed (each one is a single linear happy-path smoke narrative, correctly scoped for its own
 * per-phase verification purpose, not a QA regression suite). The prior scripts are left in place
 * untouched (this project's own "never delete a prior phase's own verification artifact" convention) —
 * this is a new, additive suite, not a replacement.
 *
 * `baseURL`/`fullyParallel: false`: this suite runs against ONE already-up, already-seeded stack
 * (brought up once per verification run, not spawned per-test) — the canonical root
 * `docker-compose.yml` post-legacy-decommission (originally the transition-era
 * `docker-compose.next.yml`, which no longer exists) — `webServer` is deliberately NOT configured here
 * (unlike Playwright's own
 * single-app-under-test default), since the "server" here is a whole 5-service Docker Compose stack
 * this suite's own runner brings up out-of-band (see the Phase 10 plan doc's "Verification evidence").
 * `fullyParallel: false` + `workers: 1`: several cluster-2/cluster-4 tests deliberately mutate
 * shared, real seeded-tenant state (packages, users, curricula) — running specs in parallel workers
 * against the SAME live tenant schemas would risk cross-test interference that has nothing to do with
 * this suite's own real concurrency proofs (which spin up their own explicit `Promise.all` races
 * inside a single test, not via the runner's parallelism). Every test that creates state uses a
 * `Date.now()`-based unique suffix (matching `scripts/playwright-smoke-tenant.ts`'s own established
 * convention) so re-running the suite twice (this dispatch's own flakiness-proof requirement) never
 * collides with the previous run's leftover rows.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3010',
    extraHTTPHeaders: {},
    trace: 'retain-on-failure',
  },
});
