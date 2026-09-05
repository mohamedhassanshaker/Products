# QA Retry #1 Report - Phase 7 Admin SPA (BL-020 to BL-024)

Date: 2026-08-20
Scope: Re-verification of the dev fix pass against `qa-results/phase7-admin-spa/REPORT.md`'s
defects (D-1..D-7), covering Dashboard, Session logs (list + detail), GPU monitor, Alerts and
failover, Data residency - the same five admin screens as the prior pass. Backend and the
conversation-SPA summary screen were covered by parallel QA retry dispatches and are out of this
report's scope.

Verdict: **PASS** - every previously reported defect (D-1 through D-7) is genuinely fixed,
independently re-verified against a live app, not just re-reading the dev's own claim. No new
defects found. Full regression independently reproduced and matches the dev's claims exactly.

## Environment

- Disposable Docker Postgres 16 (`qa-retry1-pg`, port 25732) and Redis 7 (`qa-retry1-redis`, port
  26379), created fresh for this pass and torn down afterward. Reused the pre-existing
  `liveavatar-livekit-1` dev-mode LiveKit container (read-only use, no writes needed by these
  screens) rather than starting a second one.
- Did NOT touch `apps/api/.env` (it belongs to a parallel QA agent own in-flight session, per
  this project documented history of `.env`-clobbering incidents) - all env vars for `apps/api`
  were passed inline on the `node` command line instead, per the prior pass own documented
  workaround.
- `apps/api` built with `tsc -p tsconfig.build.json` (same `nest build` silent-no-output quirk as
  the prior pass; `tsc` direct works) and run as a single real Node process (`main.js` on `:28090`)
  - internal-only routes (GPU heartbeat ingest) were not re-exercised this pass since they are
    backend-owned and already independently re-verified by the parallel backend QA retry.
- `apps/web` admin SPA served via `ng serve admin --proxy-config <tmp>.json --port 24200`, proxying
  `/api` to the live backend on `:28090`. Note: the admin app base href is `/admin/` (`ng serve`
  logs `http://localhost:24200/admin/`), not the root - confirmed this explicitly since it was not
  obvious from the app own routes file.
- Seeded via a real HTTP call (`/api/auth/seed`, `/api/tenants`) plus one direct-Prisma seed script
  (`qa-seed-tmp.ts`, run then deleted) for volume data: 5 sessions across ended/failed/abandoned
  statuses, transcript utterances, latency hops with one deliberately-omitted TTS hop (to
  re-confirm FR-SESS-3 em-dash-not-zero behavior survived the D-6 layout change), 3 GPU
  heartbeats (one per role), and all 4 AlertEvent types - chosen over hand-crafted fixtures per
  this project own documented history of mocked tests hiding real bugs.
- Browser: Playwright/Chromium (one-off scratchpad install, already present from a prior session),
  driving the real `ng serve` dev server end-to-end (login, then each screen at both desktop
  1280x900 and phone 375x800 viewports), never calling internal Angular services directly.
- Console/page-error listeners attached for the whole pass; `console-errors.txt` is empty (zero
  errors captured).
- All QA-created tenant/session/GPU/alert data and both disposable Docker containers were torn
  down after the run; the two locally-started Node processes (`main.js`, `ng serve`) were killed by
  PID/port at the end.

## Traceability matrix (defect re-verification)

| Defect | Re-verification method | Result | Evidence |
|---|---|---|---|
| D-6 (Sessions list, phone 375px) | Real 5-row seeded data, Playwright at 375x800: `getBoundingClientRect` on `.la-sessions__table` and every row/cell | **FIXED** - table width 343px (fits inside 375px viewport with the deployments-list 16px side padding), `document.documentElement.scrollWidth` equals `clientWidth` equals 375 (no page-level overflow), 5 stacked cards render with zero row-to-row overlap (bottom of row N is less than or equal to top of row N+1 for all 5 rows), all 7 fields (Session ID/Tenant/Started/Duration/Status/Provider stack/Error code) visible with `data-label` prefixes on every card | `04-sessions-list-375px.png`; SESSIONS_TABLE_MEASURE/SESSIONS_ROW_OVERLAP/SESSIONS_CELL_VISIBILITY script output |
| D-6 (session-detail latency table, proactive fix) | Same method on `.la-session-detail__hops-table` at 375px, using the one seeded session with a deliberately-omitted TTS hop | **FIXED** - table width 343px, no page overflow, all 6 columns (Cycle/STT/LLM/TTS/Avatar/e2e) stacked and visible; the omitted TTS hop correctly renders as an em dash, not 0ms or blank - confirms the stacked-card conversion did not regress FR-SESS-3 missing-hop semantics | `05-session-detail-375px.png`; HOPS_TABLE_MEASURE/HOPS_CELL_VISIBILITY script output |
| D-6 (independent sweep of the other 4 screens) | Same getBoundingClientRect/scrollWidth method applied to Dashboard, GPU, Alerts (both tabs), Residency at 375px | **PASS, nothing else missed** - Dashboard/GPU/Alerts/Residency all report scrollWidth equals clientWidth equals 375; GPU cards were already correct in the original pass (unchanged); Alerts and Residency were never raw tables to begin with (card/form layouts), so no clipping risk existed there | `06-dashboard-375px.png`, `07-gpu-375px.png`, `08/09-alerts-*-375px.png`, `12-residency-375px.png`; DASHBOARD_MEASURE/GPU_MEASURE/ALERTS_MEASURE/RESIDENCY_MEASURE script output |
| D-4 (Alerts fallback-LLM display + Edit link) | Real GET of an unconfigured tenant alert-policy through the real UI; DOM query for the link href; clicked the link and followed real navigation | **FIXED** - "Fallback LLM" row renders "No fallback configured" (llm_fallback is genuinely null for this tenant); "Edit in Agent Builder" link href is /admin/tenants/id/builder, matching the real registered route (agent-builder.routes.ts tenants/:id/builder); clicking it navigated to that exact URL and rendered the real Agent Builder page for the correct tenant ("QA Retry1 Tenant - Agent Builder" title, llm_fallback: Not configured yet in its own error panel - same underlying field, consistent) | `10-alerts-desktop.png`, `11-agent-builder-after-click.png`; ALERTS_MEASURE/EDIT_LINK_HREF/NAVIGATED_URL script output |
| D-1 (Dashboard provider-health labels) | Real provider-health grid render, both desktop and phone | **FIXED** - all 5 categories read LiveKit, STT, LLM, TTS, Avatar (categoryLabel mapping, no more text-transform:capitalize mangling) | `02-dashboard-desktop.png`, `06-dashboard-375px.png`; DASHBOARD_MEASURE.healthCategoryLabels |
| D-2 (GPU role labels) | Real GPU cards for all 3 seeded roles | **FIXED** - status chips read Avatar/STT/TTS (roleLabel mapping), not raw avatar/stt/tts | `07-gpu-375px.png` |
| D-5 (Alerts event icon+label) | Real 4-type seeded AlertEvent list, both tabs | **FIXED** - sync_problem/LLM failover, cloud_off/Provider unreachable, report/Session failed, dns/GPU unhealthy all render exactly per the spec mapping, not raw snake_case | `09-alerts-events-tab-375px.png`; ALERT_EVENTS_MEASURE |
| D-7 (Sessions Provider stack column) | Real session rows with a provider_stack snapshot containing all 5 categories | **FIXED** - column reads "livekit deepgram openai elevenlabs bithuman" (dot-separated) for every row (confirmed via a dedicated un-truncated DOM query after the main script own 40-char slice in its console log initially looked like it was missing the 5th category - that was a QA-script measurement artifact, not a product defect, and was independently re-verified) | verify-stack.js output: all 5 rows show all 5 categories present |
| New D-3 claim (Dashboard mat-select at phone width) | BreakpointObserver-driven control at both under-599px and desktop widths | **FIXED, no regression** - phone (375px) renders a mat-select labelled "Time range" showing "24h"; desktop (1280px) still renders the original 3-button mat-button-toggle-group unchanged (confirmed via screenshot: 1h/24h/7d buttons, 24h checked) - the isPhone/else template branch is mutually exclusive so there is no possibility of both existing simultaneously; the mat-select uses a real mat-label for its accessible name (standard Angular Material pattern, already used elsewhere in this app, e.g. Sessions Status filter) - no new accessibility regression found | `06-dashboard-375px.png`, `02-dashboard-desktop.png`; DASHBOARD_MEASURE.matSelectCount is 1, toggleGroupCount is 0 at 375px |
| Regression: frontend jest --coverage | Independently re-run | **PASS** - 61/61 suites, 424/424 tests (matches dev claim of plus 21 over the prior pass 403 exactly) | terminal output |
| Regression: frontend ESLint | eslint "projects/**/*.ts" | **PASS** - clean | terminal output |
| Regression: ng build admin / ng build conversation | Independently re-run | **PASS** - both clean; same pre-existing, unrelated CommonJS/@liveavatar/contracts warning as every prior pass, no new warnings | terminal output |
| Regression: backend jest --runInBand | Independently re-run (backend untouched this phase, sanity check only) | **PASS** - 128/128 suites, 715/715 tests, unchanged | terminal output |
| Regression: backend ESLint / tsc --noEmit | Independently re-run | **PASS** - both clean | terminal output |
| Spot-check: Alerts degraded-message save + reload persistence | Real edit then Save then full page reload then re-read the textarea live value | **PASS** - persisted exactly as saved | script output: DEGRADED_MSG_AFTER_RELOAD "QA retry1 spot-check message persisted." |
| Spot-check: Sessions transcript search | Real search-box query against seeded transcript text | **PASS** - filters from 5 rows down to the 1 matching row | script output: SEARCH_ROW_COUNT 1 |
| Spot-check: Dashboard aggregation | Real seeded 5-session tenant (3 ended/1 failed/1 abandoned) | **PASS** - "5 started, 3 ended, 1 failed, 1 abandoned", error rate 20% (1/5), both desktop and phone | `02-dashboard-desktop.png`, `06-dashboard-375px.png` |
| Spot-check: GPU staleness recompute | Heartbeats seeded fresh, screenshotted about 4 minutes later after other test steps elapsed | **PASS, confirms FR-GPU-3 still server-computed** - all 3 nodes correctly flipped from the seeded healthy:true to a rendered "Unhealthy" chip once the real elapsed time exceeded the 60s staleness threshold - not a regression, a reconfirmation the D-6/D-2 template edits did not disturb this server-side rule | `07-gpu-375px.png` |
| Console/network errors across the whole pass | Playwright console/pageerror listeners on every page | **PASS** - zero captured | console-errors.txt (empty) |

## Findings

No defects found in this pass. All 8 items from the prior report decision log (D-1, D-2, D-3,
D-4, D-5, D-6 x2 - sessions list + session-detail, D-7) are genuinely fixed as claimed, with live,
independently-reproduced evidence for each, not a re-reading of the dev own decision-log text.

One non-defect observation worth recording for whoever reads this report next: my own first
Playwright pass truncated DOM text at 40 characters for logging convenience, which made D-7 fix
look incomplete in the raw console output ("livekit deepgram openai elevenlabs" with the 5th
category cut off) until a dedicated un-truncated follow-up query showed all 5 categories are
genuinely present. Flagging this so it is not mistaken for evidence of a regression by a future
reader skimming truncated log output rather than the actual screenshots/full-string evidence.

## Overall verdict

**PASS.** Every defect from the initial pass (D-1 through D-7, both D-6 sub-findings, plus the
proactively-disclosed D-3 fix) is independently confirmed fixed against a live running app with
real seeded data, not mocks. No new defects surfaced in an independent 375px sweep of all five
screens, the Alerts fallback-LLM navigation, or the regression suite (jest/ESLint/build, frontend
and backend). Phase 7 admin-SPA scope (BL-020 through BL-024) is ready to close from this QA
angle - the orchestrator should confirm the parallel conversation-summary and backend retry
verdicts before closing the phase as a whole, since this report only covers the admin-SPA slice.
