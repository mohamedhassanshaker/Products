/**
 * Playwright configuration — `docs/testing.md` §2.4's "Playwright against the real running
 * stack" layer. `pnpm test:e2e` (already wired in `package.json`) and `scripts/verify.mjs`'s
 * `test:e2e` stage both resolve to this file.
 *
 * ## Scope of this pass
 *
 * One project (`chromium`), covering `e2e/backoffice/**` and `e2e/roles/**` — the four
 * screens that are genuinely shipped today (IAM, Settings → Appearance, Agents, Tools).
 * `docs/testing.md` §2.4 also names `e2e/journeys/**` (the citizen widget, Chromium **and**
 * Firefox) as part of the E2E layer's eventual shape — deliberately not wired here because
 * the citizen widget itself has no shipped route yet (`docs/requirements-traceability.md`
 * lists it explicitly as not-yet-testable). Adding that project is a one-block addition once
 * the widget exists; the shape here does not need to change to accommodate it.
 *
 * ## `webServer`: host `next dev`, not a Docker Compose `web` service
 *
 * Two ways to bring up the app under test were considered:
 *
 *  - **`docker compose up web`** — the containerised dev target. Rejected for this pass: it
 *    depends on the `ai` service being healthy too (`docker-compose.yml`'s own
 *    `depends_on: ai: condition: service_healthy`), which is unnecessary weight for screens
 *    that do not call it on their golden path (the one action that does,
 *    "Connect & discover" on the MCP servers tab, is asserted as a documented, deterministic
 *    failure in `e2e/backoffice/tools.spec.ts` — see that file's own comment), and it is
 *    slower to (re)start for a local edit-test loop than a server Playwright can reuse.
 *  - **Host `next dev`** — chosen. `tasks/lessons.md` records that every previous wave's
 *    real, live-infrastructure verification already runs `apps/web` this way against the
 *    same already-running store containers this repo's `docker-compose.yml` exposes on
 *    `localhost` (`.env`'s `SHJ3_SQL_URL`/`SHJ3_REDIS_URL`/etc. all point at `localhost:
 *    <mapped-port>`, not at Compose service hostnames), and `next.config.ts`'s
 *    `process.loadEnvFile()` fix (also in `tasks/lessons.md`) already makes the root `.env`
 *    reach `next dev` regardless of Next's own cwd-relative `.env` auto-loading. This is
 *    the path this project's own history has already exercised and fixed, not an untested
 *    shortcut.
 *
 * Either way, the four store containers (`sqlserver`, `redis`, `neo4j`, `qdrant`) must
 * already be running (`docker compose up -d sqlserver redis neo4j qdrant`) — `webServer`
 * intentionally does not start them: they are long-lived, slow to boot, and shared with
 * every other test layer (`vitest --project integration`, `--project isolation`), so owning
 * their lifecycle here would fight whichever of those a developer already has running.
 *
 * `reuseExistingServer: true` locally (a developer's own `next dev` on :3000 is reused
 * rather than fought over) and `false` in CI (a stray server from a previous run must never
 * silently serve a CI run's requests).
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${String(PORT)}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["backoffice/**/*.spec.ts", "roles/**/*.spec.ts", "journeys/**/*.spec.ts"],
  globalSetup: "./e2e/global-setup.ts",

  // docs/testing.md §17: "sharded Playwright with retries disabled by default" — a flaky
  // pass must be investigated, not quietly re-run into green.
  retries: 0,
  // One worker locally by default: several specs mutate shared, Redis-backed state (circuit
  // breaker resets/trips) or shared per-tenant fixtures (agent registry rows), and this
  // pass does not yet shard mutating specs into their own isolated tenant the way
  // `docs/testing.md` §4.3 describes as the long-term answer. CI gets the same treatment
  // pending that sharding work — safety over speed until it lands.
  workers: 1,
  fullyParallel: false,

  timeout: 30_000,
  expect: { timeout: 5_000 },

  // docs/testing.md's own coverage rule (§1) wants machine-readable output; `list` for a
  // human running it locally, `html` for post-run inspection, `json` as the file a future
  // `scripts/requirement-coverage.ts` (docs/requirements-traceability.md §"Open") would read.
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "reports/e2e-results.json" }],
  ],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    // Above the DataTable's 560px card-layout breakpoint and the PermissionMatrix's 820px
    // grid-to-cards breakpoint (`e2e` selector research, both confirmed against the real
    // components) — every spec in this pass relies on the desktop table/grid semantics.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    // Pinned to match `e2e/support/mint-session.ts`'s `PLAYWRIGHT_CLIENT_IP` exactly.
    // `tasks/lessons.md` documents this as a recurring, twice-already-hit gotcha (now a
    // third time, found again while building this suite): `AuthMiddleware`'s coarse session-
    // binding check (`bindingFor()`, `auth-middleware.ts`) reads `X-Forwarded-For` before
    // falling back to the transport's own address, and this host's `next dev` was empirically
    // found (a real, live probe — not assumed from source reading alone) to supply a real,
    // non-"unknown" `x-forwarded-for` value on a bare local request. Forcing this header
    // explicitly on every request this suite makes — matched by the identical value used when
    // minting each session — is what makes the binding check pass for the right reason
    // (a real, matched fingerprint) rather than by accident.
    extraHTTPHeaders: { "x-forwarded-for": "127.0.0.1" },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm --filter @shj3/web run dev",
    url: `${BASE_URL}/api/healthz`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
