# ExamLand Next.js Rewrite — Phase 0: Bootstrap & Shared Infra

Authoritative source for scope/sequencing: `C:\Users\m.hassan\.claude\plans\giggly-exploring-wombat.md`
("the migration plan"). This doc tracks only the phase-by-phase execution status against that plan;
it does not restate the plan's rationale. `docs/BACKLOG.md`'s Phase/Priority ordering is **not**
used to sequence this migration — the user is acting as orchestrator directly via the migration plan
file, per that plan's own framing ("tracked via the plan file and my own todo list, not the old
backlog-phase numbering").

## Phase 0 — Bootstrap & shared infra

**Goal**: `apps/next` exists as a working Next.js 15+/TypeScript-strict/Chakra-v3 skeleton that
boots, serves a real Chakra-rendered placeholder page, exposes `GET /api/health`, validates env at
boot, logs via pino, and has a genuinely-connecting (platform-only) TypeORM DataSource — with the
module-boundary ESLint rule proven to actually fail on a violation. No tenant/auth/business feature
work happens in this phase.

**Backlog item(s)**: none from `docs/BACKLOG.md` — this is infra scaffolding predating BL-01, done
under the migration plan's own Phase 0 rather than a backlog item.

**Scope**:
- In scope: `apps/next` app skeleton (App Router, TS strict), Chakra UI v3 wiring + one placeholder
  page, `src/server/config` (zod env schema), `src/server/logging` (pino), `src/server/infrastructure/
  database/platform` (platform `DataSource` only — connect-and-prove, no entities), `GET /api/health`
  (liveness only), `apps/next/Dockerfile` (written, not built/wired into any compose file),
  `apps/next/.eslintrc.cjs` module-boundary rules for the three modules that exist this phase
  (`config`, `logging`, `infrastructure/database`).
- Out of scope (explicitly deferred): tenant `DataSourceRegistry`/tenant entities (Phase 1),
  `middleware.ts`/tenant resolution (Phase 1), auth/RBAC, `/api/health/ready` (needs real deps to
  check — Phase 1+, per legacy's own `HealthController` doc comment this mirrors), the
  `docs/PRODUCT_SPECIFICATION.md`/HLD/LLD spec-amendment pass for FR-AI-1/NFR-10 (owned by
  Phase 0/5 per the migration plan's own "Spec amendment" section, but not part of my dispatch's
  8-item task list — flagged here rather than silently done or silently skipped), wiring `apps/next`
  into any docker-compose file (Phase 10's job per the plan).

**Deliverables**: see "Files created" in the final handoff summary.

**Exit gate** (this phase's lightweight recipe, per the migration plan's "Per-phase verification"):
1. `next build` succeeds cleanly.
2. `eslint --max-warnings=0` clean on `apps/next`.
3. Env-schema check fails fast with a clear, enumerated error message when a required var is
   missing (tested by deliberately unsetting one).
4. Dev server boots; placeholder page renders real, visibly-styled Chakra components (verified via
   a real HTTP GET + structural check for Chakra's emitted class/style attributes, not just HTTP 200).
5. `GET /api/health` returns 200 with the `HealthLivenessResponse` shape from `@examland/contracts`.
6. Platform `DataSource` genuinely connects to the already-running `exam-4u-mysql-1` container (see
   "Deviation" note below) and round-trips a real `SELECT 1`.
7. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`)
   completely undisturbed (`docker ps` before/after diffed).
8. Deliberate module-boundary lint violation added, confirmed to fail lint, then removed and
   confirmed clean again.

### Decisions made (LLD silent / not-yet-amended for the new stack, smallest-reasonable-choice judgment calls)

1. **TypeORM/zod pinned to the legacy app's exact major versions** (`typeorm@^0.3.31`,
   `zod@^3.23.8`) rather than the newer majors available on npm today (`typeorm@1.1.0`,
   `zod@4.x`) — the migration plan explicitly says "port the existing... pattern... largely as-is";
   pinning avoids absorbing an unrelated major-version migration (breaking API changes in both) into
   a phase whose entire point is a mechanical, low-risk port. Revisit in a dedicated dependency-bump
   phase later if desired.
2. **`pino`/`pino-roll` taken at current latest majors** (not pinned to legacy's `nestjs-pino`-wrapped
   versions) — this app calls `pino` directly (no NestJS, so no `nestjs-pino` equivalent exists), and
   the porting risk that justifies pinning TypeORM/zod above doesn't apply here since the pattern
   (dual stdout + daily-rolling-file transport, redaction paths, fail-safe directory creation) is
   being re-implemented in plain pino either way.
3. **`next@16.3.1`/`react@19.2.8`** (latest, satisfies the dispatch's "Next.js 15+" floor).
4. **Own `.eslintrc.cjs` per app, not folded into the root config**: the root `.eslintrc.cjs` is
   `root: true` and its `overrides` are all scoped to `apps/api/src/**`; it also has no JSX-aware
   parser options, which `apps/next`'s `.tsx` files need. `apps/next/.eslintrc.cjs` is therefore its
   own `root: true` config (ESLint 8 legacy cascade stops at the nearest `root: true`, so this
   correctly shadows the repo-root config for every file under `apps/next`) — same pattern the repo
   already uses for `legacy/api` vs `legacy/web` (each app owns its own lint surface).
5. **Module-boundary rule expressed as explicit per-module `no-restricted-imports` overrides**,
   mirroring the repo-root `.eslintrc.cjs`'s own documented judgment call ("verbose but necessary for
   correctness... a `dependency-cruiser` config would compose more cleanly if this list grows much
   further") rather than one generic recursive glob — same rationale applies here at even smaller
   scale (3 modules this phase: `config`, `logging`, `infrastructure/database`). Each existing/future
   `src/server/<module>/` gets its own override block as it's added, denying `**/<module>/*` except
   `**/<module>/index*`, which matches on the import specifier text (alias or relative) without
   requiring a `server/` prefix literal — verified in the exit-gate step above.
6. **`infrastructure/{storage,mail,payments}` not scaffolded this phase** — the dispatch's item 3
   only asks for the platform `DataSource` to "exist and successfully connect"; empty placeholder
   modules with no behavior would need their own lint boundary + tests for no reason yet. Left for
   the phase that actually needs each one (files/storage in Phase 1 per the migration plan).
7. **`middleware.ts` not created this phase** — multi-tenancy (the only consumer) is explicitly
   Phase 1's job per the migration plan; an empty/no-op middleware file would be dead code.

### Deviation from the dispatch's literal verification instructions

The dispatch says to verify the platform `DataSource` against "`docker/docker-compose.dev.yml`'s
`mysql` service, already running or start it". `docker/docker-compose.dev.yml`'s `mysql` service
publishes host port `3306` with credentials `examland`/`examland_dev`/`examland_platform` — **byte
-for-byte the same host port and credentials** the root `docker-compose.yml`'s `mysql` service uses
(confirmed via that file's own comment: "Matches `docker/docker-compose.dev.yml`'s hardcoded mysql
credentials exactly"). The root compose's `mysql` (container `exam-4u-mysql-1`) is already running
live (part of the legacy stack this dispatch requires undisturbed) and occupies host port 3306, so
starting `docker/docker-compose.dev.yml`'s own `mysql` service would collide on that port. Since the
two are drop-in equivalents from the host's point of view, the connectivity test in this phase was
run against the already-running `exam-4u-mysql-1` instead of spinning up a second, port-colliding
MySQL — satisfying "already running" in spirit without a wasted/failed second container. Documented
here rather than silently substituted.

### Additional decisions/findings made during implementation (beyond the pre-implementation list above)

8. **`next@15.5.23` pinned instead of the newest `16.3.1`** — `16.3.1` (React 19 + Turbopack default)
   produced a real, reproducible hydration mismatch on the placeholder page (`<style
   data-emotion="css-global …">` vs. a client-rendered `<main>` swapping position — verified via a
   real Playwright browser check, not a lint/type issue). `15.5.23` (latest stable 15.x) renders the
   identical page with zero console errors. Still satisfies the dispatch's "Next.js 15+" floor;
   documented as a version-compatibility finding rather than silently pinning without explanation.
   Revisit once a newer Chakra v3 patch explicitly tests against Next 16.
9. **`next-themes` not used** — Chakra v3's own documented Next.js setup pairs `ChakraProvider` with
   `next-themes`' `ThemeProvider` for color-mode toggling. Reproduced (via Playwright) a genuine
   hydration mismatch caused by `next-themes`' no-flash boot `<script>` racing Chakra's Emotion SSR
   style tag. Nothing in Phase 0 reads or toggles color mode, so this has no behavior cost now;
   dropped entirely rather than shipped broken. Re-add and re-verify when a real light/dark toggle is
   first built.
10. **`colorPalette="brand"` requires explicit semantic tokens** — Chakra v3 only auto-generates the
    `solid`/`contrast`/`fg`/`muted`/`subtle`/`emphasized`/`focusRing` semantic tokens for its own
    built-in palette names; a custom palette (`brand`) needs them declared explicitly in
    `defineConfig`'s `theme.semanticTokens.colors.brand` or `colorPalette="brand"` silently renders a
    default near-black fallback instead of the custom color (caught via the Playwright computed-style
    assertion in `verify-render.js`, not visually skimming a screenshot). Added the semantic token
    block to `src/components/theme/system.ts`; this also front-loads the exact primitive Phase 9
    (tenant branding, FR-MT-10) will need for its runtime-derived accent-color ramp.
11. **Dockerfile required three additional real fixes**, all found only by actually building and
    running the image (not just writing it from the legacy Dockerfile's pattern) — documented inline
    in `apps/next/Dockerfile`/`next.config.ts`'s own comments, summarized here:
    - `pino`/`pino-roll` must be listed in `serverExternalPackages` (webpack bundling breaks
      `pino`'s own internal worker-thread bootstrap path resolution).
    - `pino-roll` and its own transitive dependency `date-fns` must be force-included via
      `outputFileTracingIncludes` (the file-tracer that powers `output: 'standalone'` can't see the
      dynamic, IPC-message-passed transport `require()` pino performs internally).
    - `ENV HOSTNAME=0.0.0.0` must be set explicitly in the runtime stage — Docker auto-sets
      `HOSTNAME` to the container ID, which Next's standalone `server.js` binds to literally
      (`process.env.HOSTNAME || '0.0.0.0'`), breaking any `localhost`-targeted healthcheck run
      *inside* the container even though host-mapped access still works by coincidence (Docker's
      port-publish routes to the container's real bridge IP either way).
    All three verified fixed by a real `docker build` + `docker run` against the already-running
    `exam-4u-mysql-1` container on `exam-4u_default`'s Docker network, confirmed `healthy` via the
    Dockerfile's own `HEALTHCHECK`, then removed (`docker rm`/`docker rmi`) — no dangling test
    containers/images left behind, and `docker ps` reconfirmed the legacy stack untouched throughout.
12. **`instrumentation.ts` added** (not in the original 8-item list, but necessary to satisfy item 4's
    literal "validates on boot, fails fast" — without it, `getEnv()`'s first call is whichever
    request handler happens to run first, which doesn't reliably fail the *process* before it starts
    accepting traffic). Verified two ways: (a) `next start` with `DB_HOST`/`DB_USER` unset and
    `NODE_ENV=production` now exits with code 1 and prints every violation to stderr before any
    request can be served; (b) the same scenario inside the built Docker image.

### Status: Phase 0 complete — all 8 dispatch items implemented and verified; see the handoff
message for the full per-item evidence log. `apps/next` builds, lints (incl. a proven-failing then
reverted module-boundary violation), boots (dev server and the standalone Docker image), renders a
real Chakra UI v3 page with correct custom theme tokens, exposes a working `GET /api/health`,
fails fast on invalid/missing env, and connects for real to the already-running platform MySQL.
`current_phase` in `docs/NEXUS_STATE.md` intentionally left as-is per this dispatch's own instruction
(this migration is tracked here and in the plan file, not the old backlog-phase numbering).
