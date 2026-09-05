# Final Review — Frontend Re-verification (retry 1)

- **Date:** 2026-08-20
- **Agent:** `nexus-qa` (Final Review re-verification, frontend scope)
- **Scope:** Independent re-verification of the claimed fixes for **D-1** (shared `page-header` phone layout) and **D-2** (Provider Registry toggle accessible names) from `qa-results/final-review/frontend-golden-path/REPORT.md`; regression spot-check of **D-3 … D-9**; golden-path / cross-SPA / auth-boundary spot-check; full frontend regression re-run. Deployment and backend/Python-agent re-verification are a parallel agent's and are **not** in this verdict.
- **Verdict:** **PASS-WITH-CAVEATS** — **D-1 and D-2 are both genuinely fixed** (independently measured, not taken on trust). No blocking frontend defect. 7 previously-logged non-blocking caveats remain open, plus 3 newly-found low-severity findings.
- **Evidence directory:** `qa-results/final-review/frontend-golden-path/retry1/` (raw measurement JSON: `d1-sweep.json`, `measurements.json`, `measurements-run4.json`, `d2-aria-snapshot.txt`; 34 screenshots)

---

## 1. Environment

Everything below ran live. Nothing was mocked, and no assertion in this report is based on reading source alone unless explicitly labelled as such.

| Component | How it ran |
|---|---|
| Postgres 16 | disposable Docker container `la-fr2-pg`, `127.0.0.1:55434`; schema via real `prisma migrate deploy` (`20260819234327_init`) + `prisma/seed.ts` (10 provider definitions) |
| Redis 7 | disposable container `la-fr2-redis`, `127.0.0.1:56381` |
| LiveKit | disposable container `la-fr2-lk`, `127.0.0.1:7890` (`--dev`) |
| Control plane (public :8080 surface) | real `node dist/main.js`, `http://127.0.0.1:8295` |
| Control plane (internal :8081 surface) | real `node dist/main-internal.js`, `http://127.0.0.1:8296` |
| Both SPAs | the **real production `ng build` output** (`dist/admin/browser`, `dist/conversation/browser`) served at `/admin/` and `/c/` by a QA static host that mirrors the shipped `ServeStaticModule` topology (same-origin, SPA fallback, `/api` proxied to :8295) — `http://127.0.0.1:4500`. Deliberately production bundles rather than `ng serve`, so the SCSS/DOM under test is exactly what ships. |
| Browser | Playwright 1.62.1 / Chromium; 375x812 and 414x812 with `isMobile` + `deviceScaleFactor: 2`, and 767/768/820/900/1024/1279/1280 desktop |
| axe-core | 4.x, WCAG 2.0/2.1/2.2 A + AA tags |
| Python agent | **not run** (same disclosed limitation as the original pass; the agent path belongs to the parallel dispatch) |

**Seed data** was created through the real HTTP API and the real `/internal` agent surface only — never by direct DB writes: 4 tenants (`northwind-bank`, `acme-health`, `globex-retail` published with three genuinely different provider stacks; `initech-legal` paused/never configured), 5–6 provider credentials per configured tenant, 3 configs published through `PUT /tenants/:id/config` with a real `If-Match` header, 12 sessions with multi-turn transcripts and 5 latency hops per cycle (incl. a `used_fallback` turn and 3 deliberately `failed` sessions), 12 alerts across all 4 types, 4 GPU heartbeats.

---

## 2. Part 1 — Full frontend regression (independently re-run, all green)

| Check | Result | Matches dev claim? |
|---|---|---|
| `jest --coverage` (apps/web: admin + conversation + shared) | **61/61 suites, 424/424 tests passed**, exit 0 | yes |
| `eslint "projects/**/*.ts"` (apps/web) | **clean**, exit 0 | yes |
| `ng build admin` | **clean** — only the pre-existing "`@liveavatar/contracts` … is not ESM" CommonJS warning | yes |
| `ng build conversation` | **clean** — same single pre-existing warning; **initial total 487.84 kB / 113.98 kB transferred**, byte-identical to the original pass | yes |

No regression against any previously reported number. Note the corollary in §6 (N-3): the test count is unchanged *because neither fix shipped with an automated regression test*.

---

## 3. Part 2 — D-1: shared `page-header` phone layout — **GENUINELY FIXED**

### 3.1 What was verified

The fix is in the **shared** component (`apps/web/projects/shared/src/lib/ui/page-header/page-header.component.scss`), confirmed by reading it: `&__actions` now carries `flex-wrap: wrap`, `row-gap: 12px`, `> * { min-width: 0 }`, plus a `@media (max-width: 599px)` block that flips the header to `flex-direction: column; align-items: stretch` and gives `&__actions` `width: 100%` with `flex: 1 1 auto` children.

**Note on the dev's own framing:** the claim says "all 7 screens using this shared header." **12 templates** actually use `la-page-header`. I measured **11 of them live** at 4 viewport widths (44 measurements, `d1-sweep.json`); the 12th (Session detail) puts a single `<button>` in the slot and therefore cannot trip this bug class — verified by reading the template and by reaching the screen live at 1280 (`12-gp-session-detail.png`).

### 3.2 Measured result — 44/44 clean

Measured exactly the way the original defect was caught: `getBoundingClientRect` on `.la-page-header__actions` and every one of its children, plus `documentElement.scrollWidth`, `body.scrollWidth`, and the `mat-sidenav-content` shell pane's `clientWidth` vs `scrollWidth`, plus a full-document sweep for **any** element whose right edge exceeds the viewport.

| Screen | 375 px | 414 px | 768 px | 1280 px |
|---|---|---|---|---|
| Dashboard | actions 343 (right 359) | 382 (398) | 381 (752) | 381 (1256) |
| Deployments | 343 (359) | 382 (398) | 168 (752) | 168 (1256) |
| Provider catalog | 343 (359), 0 children | 382 (398) | 0 (752) | 0 (1256) |
| Provider credentials | 343 (359) | 382 (398) | 305 (752) | 305 (1256) |
| **Sessions list** | **343 (359)** | **382 (398)** | **680 (696)** | **680 (1256)** |
| GPU health | 343 (359) | 382 (398) | 292 (752) | 292 (1256) |
| Alerts picker | 343 (359) | 382 (398) | 0 (752) | 0 (1256) |
| Alerts (tenant) | 343 (359) | 382 (398) | 140 (752) | 140 (1256) |
| Residency picker | 343 (359) | 382 (398) | 0 (752) | 0 (1256) |
| Residency (tenant) | 343 (359) | 382 (398) | 140 (752) | 140 (1256) |
| Agent Builder | 343 (359) | 382 (398) | 370 (752) | 370 (1256) |

In **all 44 measurements**: `documentElement.scrollWidth == viewport`, `body.scrollWidth == viewport`, shell pane `scrollWidth == clientWidth`, and the whole-document overflow sweep returned **zero** elements — with the single exception noted as new finding **N-2** below, which is the Sessions *table* at exactly 768 px, not the header.

**The specific regression that defined D-1 is gone.** Sessions at 375 px: `.la-page-header__actions` measures **343 px** (right edge 359, inside the 375 px viewport) — down from the previously measured **680 px wide with its right edge at 696 px**. Its three children (`la-tenant-select` 212 px, Search transcript 240 px, Status 212 px) now each start at `x = 16` — i.e. genuinely stacked on their own rows — and the shell pane no longer pans (`clientWidth 375 / scrollWidth 375`, previously `375 / 696`). Identical result at 414 px (actions 382 px, right 398).

### 3.3 Interaction proof, not just geometry

Geometry alone would not prove the controls are *usable*, so on Sessions at 375 px (mobile emulation, touch) I drove the whole filter row as a user:

- Selected "Northwind Bank" through the Tenant typeahead → the list re-queried and rendered Northwind sessions (`01b-d1-sessions-375-tenant-selected.png`).
- Clicked the **Status** filter — the one that used to be painted entirely off-screen. Its box is at **x = 32, y = 309, 180x24**, fully on-screen; the panel opened and enumerated all five options `All / Active / Ended / Failed / Abandoned` (`02-d1-sessions-375-status-open.png`).
- Typed `duplicate charge` into **Search transcript** → the list filtered to **4 rows** (`03-d1-sessions-375-search-applied.png`).
- `isVisible()` true for both the search field and the status select.

`axe-core` on Sessions at 375 px after the change: **0 violations**. Same for Deployments at 375 px and Dashboard at 1280 px — so the flex/media-query change introduced no new accessibility defect on the screens it touches.

---

## 4. Part 3 — D-2: Provider Registry toggle accessible names — **GENUINELY FIXED**

The template change is real (`provider-catalog-page.component.html:42` now binds `[aria-label]="'Enable ' + row.display_name"` as an input, not `[attr.aria-label]` on the host).

Verified against the **real rendered accessibility semantics**, three independent ways, on all 10 catalog rows:

1. **Role query** — `page.getByRole('switch')` resolves **10** elements.
2. **Rendered attribute on the actual control** — every one of the 10 `button[role="switch"]` elements carries a non-null, non-empty, provider-specific `aria-label`, and **none** falls back to a dangling `aria-labelledby`:

   `Enable LiveKit`, `Enable Deepgram`, `Enable faster-whisper`, `Enable Anthropic`, `Enable Google`, `Enable OpenAI`, `Enable ElevenLabs`, `Enable Fish Speech`, `Enable Alibaba LiveAvatar`, `Enable bitHuman`

   **distinct count = 10 / 10**; `anyNullOrEmpty = false`; `aria-labelledby = null` on all 10 (previously it pointed at an empty element). Each label matches its own row's Provider cell — these are genuinely per-provider, not one generic string repeated.
3. **Accessibility snapshot** — Playwright's `ariaSnapshot()` for the catalog region renders each control as `- switch "Enable <Provider>" [checked]` (full snapshot: `retry1/d2-aria-snapshot.txt`). This is the assistive-technology view, not the DOM.

**axe-core (WCAG 2.0/2.1/2.2 A+AA) on `/admin/providers`: 0 violations.** The previously reported `button-name` **critical** violation with 6 nodes is gone. Evidence: `04-d2-provider-catalog-1280.png`, `d2-aria-snapshot.txt`.

---

## 5. Part 4 — D-3 … D-9 re-checked (not re-trusted), and golden-path spot-check

### 5.1 D-3 … D-9: all still open exactly as reported, none worsened, no side effects from the D-1/D-2 fixes

| ID | Status now | Evidence measured this pass |
|---|---|---|
| **D-3** pre-call primary button contrast | **still open, unchanged.** axe `color-contrast` serious, 1 node; computed `#ffffff` on `rgb(76,141,255)` = `#4c8dff`, 16 px → **3.2:1**. The surrounding layout is untouched by the D-1 fix (the conversation SPA does not use `la-page-header` at all — confirmed by grep: all 12 users are admin screens), and the pre-call card measures `documentElement.scrollWidth 375 == viewport 375`. | `20-c-precall-375.png` |
| **D-4** no from/to date-range filter | **still open.** The Sessions header actions expose exactly three labels: `["Tenant", "Search transcript", "Status"]`. No date control at any width. | `measurements-run4.json` (`D4-sessions-filters`) |
| **D-5** Screens 9/10 render no `<h1>` | **still open.** Pre-call measured `h1 count = 0` in its normal state. (For contrast: all 11 admin screens measured `h1 = 1` at every one of the 4 widths — 44/44.) | `d1-sweep.json`, `measurements.json` |
| **D-6** Agent Builder Published chip contrast | **still open, same number.** axe: `color-contrast` serious on `.la-builder-chip`, `#1b7f4e` on `#f2f2f6`, 12 px → **4.48:1**. | `13-gp-agent-builder.png` |
| **D-7** YAML preview scrollable, not focusable | **still open.** `.la-yaml-viewer` measured `tabindex: null`, `role: null`, `aria-label: "Redacted configuration YAML"`, `scrollable: true`; axe `scrollable-region-focusable` serious on `pre`. | same |
| **D-8** conversation SPA static title | **still open.** All conversation screens report `document.title === "Conversation · Avatar Platform"`. | `measurements.json` |
| **D-9** never-succeeding Retry on a 404 | **still open.** A bogus tenant id renders "Could not load this deployment / Try again." with **1** Retry button over a `404 TENANT_NOT_FOUND`. | `14-d9-builder-404.png` |

### 5.2 Golden path / cross-cutting spot-check — no regression

| Check | Result |
|---|---|
| Login (negative) | wrong password → stays on `/login`, renders "Email or password is incorrect.", real `401` on `/api/auth/login`. `30-login-invalid.png` |
| Login (golden) | lands in the shell; `31-after-login.png` |
| Admin shell nav | all 7 items are real `<a routerLink>` with resolvable hrefs and `aria-disabled="false"`; zero coming-soon placeholders. |
| 1 Dashboard | real aggregation matching the seed: 3 active deployments, 12 started / 9 ended / 3 failed / 0 abandoned, 25% error rate; provider-health labels read LiveKit / STT / LLM / TTS / Avatar. `10-gp-dashboard.png` |
| 2 Agent Builder | loads the published Northwind config; YAML preview renders redacted config. `13-gp-agent-builder.png` |
| 3 Deployments | all 4 tenants with correct chips and provider summaries ("Published — anthropic, fish-speech, alibaba-liveavatar" for Acme; "Not configured" + Paused for Initech). `11-gp-deployments.png` |
| 4 Provider catalog / credentials | 10 catalog rows across 5 categories; 6 credentials for Northwind with Configured indicators. **DOM search for the raw LiveKit secret returns nothing** (`containsDevSecret: false`). `18-gp-credentials.png` |
| 5 Sessions list → detail | row click navigates to the real session; detail renders room name, `user_…`/`agent_…` participants (never tokens), the full multi-turn transcript with You-said / Assistant-said captions, provider stack "livekit · deepgram · openai · elevenlabs · bithuman", `PROVIDER_UNREACHABLE` error code. `12-gp-session-detail.png` |
| 6 GPU monitor | Avatar/STT/TTS role labels, utilisation, "Autoscaler: Not configured". **A fresh heartbeat renders "Healthy"; heartbeats older than 60 s correctly render "Unhealthy" regardless of the reported value** — I confirmed this is the intended FR-GPU-3 staleness rule (`list-gpu-nodes.use-case.ts`) and *not* a defect, by posting a new heartbeat and watching the chip flip. `17-gp-gpu.png`, `32-gpu-fresh.png` |
| 7 Alerts | Fallback LLM "anthropic / claude-3-5-sonnet-latest" present, Edit-in-Agent-Builder link present (1 link), retry policy, degraded-mode message with 85/500 counter, failover stats. `15-gp-alerts.png` |
| 8 Data residency | all 3 residency modes with correct copy, retention days, recordings flag, for the `prompt_and_transcript` tenant. `16-gp-residency.png` |
| 9 Pre-call | published tenant → "We'll ask for microphone access to start the call.", Join **enabled**; unknown slug → "This assistant is not available right now." with Join correctly **disabled**; paused/unconfigured tenant → identical treatment (correctly indistinguishable, backed by a real 404 vs 403 preflight the UI does not differentiate). `33-c-precall-northwind-375.png`, `21-c-precall-unknown-slug.png`, `22-c-precall-paused.png` |
| Auth boundary | unauthenticated `GET /api/{sessions, dashboard/summary, gpu/nodes, provider-definitions, tenants}` → **401 on all five** |
| Tenant existence oracle (admin side) | a non-existent tenant id returns `404 TENANT_NOT_FOUND` on all three Agent Builder fetches and renders no data |
| Browser console / network | across the whole pass, the **only** console errors and 4xx responses were the ones QA deliberately provoked (401 bad password, 404 bogus tenant, 404 unknown slug, 403 paused tenant). Zero unexpected errors. |

Screens 10 (live conversation) and 11 (post-call summary) were **not** re-driven this pass — they were confirmed PASS in the original walkthrough, the D-1/D-2 fixes cannot reach them (neither uses `la-page-header` nor `mat-slide-toggle`), and no Python agent worker was available. Their original findings stand unchanged.

---

## 6. Newly found (all low, none blocking, none caused by the D-1/D-2 fixes)

### N-1 — Sessions filter controls stack at ragged widths on phone (**Low**, cosmetic)

- **Originating phase:** cross-phase — Phase 1 (shared `page-header`) + Phase 7 / BL-020 (screen author).
- UX_GUIDELINES 1.4 specifies phone form controls as "Full-width with 16 px inset". After the fix the three Sessions filters correctly stack, but at 375 px they render at **212 / 240 / 212 px** inside a 343 px slot rather than a uniform full width (`flex: 1 1 auto` distributes only leftover free space, so each control keeps its intrinsic width). Visible in `01b-d1-sessions-375-tenant-selected.png`. Purely visual — no clipping, no overflow, every control reachable. Mentioned only because it is the same guideline clause D-1 cited.

### N-2 — Sessions table overflows the content pane at exactly 768 px (**Low-Moderate**, newly measured, pre-existing)

- **Originating phase:** Phase 7 / BL-020. **Not** a regression from the D-1 fix — the fix only touches `.la-page-header__actions`, and the header measures clean at 768 px (actions 680 px, right edge 696, inside 768).
- **Expected:** UX_GUIDELINES 133–134 (Tablet `768–1279`: "Table with optional hidden column") and §14 ("**Tablet:** list hides the Tenant column when a specific tenant is selected and hides 'Provider stack' if space is tight, same convention as Deployments hiding 'Last modified'").
- **Actual, measured:** the stacked-card conversion is scoped `@media (max-width: 767px)`, so at **768 px** the raw 7-column `mat-table` renders **787 px** wide inside a **768 px** pane — `mat-sidenav-content clientWidth 768 / scrollWidth 803`, a 35 px horizontal pan, with the "Error code" column clipped. No tablet column-shedding is implemented at any width. Bounded by measurement: clean at 767 (stacked, table 735 px), **overflowing at 768**, clean again from 820 px up. A narrow band — but 768 px is iPad-portrait, the single most common tablet width. `N1-sessions-table-768-overflow.png`, `d1-sweep.json`.
- Every other table screen is clean at 768 px (Deployments, Provider catalog and Provider credentials all render stacked cards below 1280 px per their own specs).

### N-3 — Both fixes shipped with no automated regression test (**process finding**, not a product defect)

The suite count is **unchanged at 424**, which is itself the evidence: `page-header.component.spec.ts` still has 3 tests and asserts nothing about `flex-wrap`/wrapping/the 599 px block, and `provider-catalog-page.component.spec.ts` still has 5 tests and contains no `aria-label` assertion at all. The phone-layout bug class has now recurred **six** times and the accessible-name bug went undetected through every prior phase; both fixes are currently guarded only by manual QA. A single unit assertion on each (rendered `aria-label` on the switch; the presence of `flex-wrap` on the actions slot) would convert both into permanent guards. Recommend the orchestrator route this to `nexus-dev` as a small hardening item rather than a defect fix.

---

## 7. Traceability matrix (re-verification scope)

| Requirement / defect in scope | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| D-1 / UX_GUIDELINES 1.4, 5.6, 14.7; FR-SESS-1 (`q`, `status`) | 44 geometry measurements (11 screens x 375/414/768/1280) + live interaction of all 3 Sessions filters at 375 px + axe at 375 px | **FIXED** | `d1-sweep.json`, `01…03-d1-*.png` |
| D-2 / NFR-4, WCAG 2.2 4.1.2 | role query, rendered `aria-label`/`aria-labelledby` on all 10 `button[role=switch]`, `ariaSnapshot()`, axe A+AA | **FIXED** | `d2-aria-snapshot.txt`, `04-d2-*.png` |
| D-3 pre-call contrast | axe + computed style | still open (Moderate) | `20-c-precall-375.png` |
| D-4 date-range filter | header-actions label enumeration | still open (Moderate, spec gap) | `measurements-run4.json` |
| D-5 missing `<h1>` | `h1` count on screen 9 vs all admin screens | still open (Low-Moderate) | `measurements.json` |
| D-6 chip contrast | axe on Agent Builder | still open (Low) | `13-gp-agent-builder.png` |
| D-7 YAML focusability | DOM attributes + axe | still open (Low) | `13-gp-agent-builder.png` |
| D-8 conversation title | `document.title` on 3 conversation routes | still open (Low) | `measurements.json` |
| D-9 misleading Retry | bogus tenant id, button count | still open (Low) | `14-d9-builder-404.png` |
| Frontend regression (jest / eslint / 2 builds) | re-run independently | **PASS**, unchanged | §2 |
| Golden path, 9 admin screens + pre-call, cross-SPA config→end-user, auth boundary, secret leakage | live walkthrough spot-check | **PASS** | §5.2 |
| Screens 10, 11 | not re-driven (out of blast radius; no agent worker) | carried forward from original pass | — |

---

## 8. Final set of non-blocking caveats for the project completion report

1. **D-3** — pre-call "Join call" button contrast 3.2:1 (needs 4.5:1), on the only primary action of the phone-first SPA. *Moderate.*
2. **D-4** — Sessions list has no `from`/`to` date-range control although FR-SESS-1 names it and the contract, API service and backend (incl. `SESS_RANGE_INVALID`) all support it; the filter and its whole error state are unreachable from the product. *Moderate, spec-completeness gap.*
3. **D-5** — Screens 9 and 10 render zero `<h1>` in their normal states (UX_GUIDELINES 1.2 "one h1 per page"). *Low-Moderate.*
4. **D-6** — Agent Builder Published chip contrast 4.48:1 (0.02 short). *Low.*
5. **D-7** — Agent Builder YAML preview is a scrollable region with no keyboard access (WCAG 2.1.1). *Low.*
6. **D-8** — both conversation SPA titles are one static string instead of the two UX_GUIDELINES 11.4 / 18.4 name. *Low.*
7. **D-9** — Agent Builder offers a never-succeeding Retry on a `404 TENANT_NOT_FOUND`. *Low, UX judgement.*
8. **N-2 (new)** — Sessions table overflows its content pane by 35 px at exactly 768 px (iPad portrait); the spec'd tablet column-shedding is not implemented. *Low-Moderate.*
9. **N-1 (new)** — Sessions phone filters stack at ragged widths rather than full-width. *Low, cosmetic.*
10. **N-3 (new)** — neither the D-1 nor the D-2 fix ships with an automated regression test, so a 6-times-recurring layout bug class and a WCAG A failure remain guarded only by manual QA. *Process.*
11. Carried forward, unchanged: the disabled `@else` "Coming soon" branch in `shell.component.html` is now-unreachable dead template code; no new frontend dependency was introduced (`apps/web/package.json` still matches the LLD-named stack, and no AI-provider SDK or agent-framework import exists anywhere in `apps/web`).

---

## 9. Limitations of this pass (disclosed, not worked around)

1. **No Python agent worker was running**, so Screen 10's avatar-video / live-caption WebRTC path was again not exercised; Screens 10 and 11 were not re-driven at all this pass (see §5.2 rationale).
2. Both SPAs were served from their **production `ng build` output** through a QA static host rather than `ng serve`. This is closer to production than the original pass, but it means HMR-only dev behaviours were not exercised.
3. A **parallel agent deleted `apps/web/dist/` mid-run** (between measurement batches); I rebuilt both SPAs and re-ran the affected batch from scratch, so no measurement in this report mixes pre- and post-rebuild output. `apps/api/dist` was also built by me, and the stale `apps/api/tsconfig.build.tsbuildinfo` had to be deleted first (the parallel agent's D-4 silent-no-op-build bug, reproduced incidentally here).
4. Session **detail**'s page-header was verified structurally (single `<button>` child) plus reached live at 1280 px, not geometry-measured at 375/414 — it cannot trip this bug class with one child, and the original pass measured it clean at 375.
5. `docker exec` was again unavailable in this sandbox, so database assertions were made through the API rather than `psql`. Node `fetch` cannot reach `localhost` here (resolves `::1` and hangs); all tooling used `127.0.0.1`.

**Cleanup performed:** all three disposable Docker containers (`la-fr2-pg`, `la-fr2-redis`, `la-fr2-lk`) removed, both Node control-plane processes and the QA static host killed, all QA-created tenants/sessions/alerts/heartbeats destroyed with the database container. **No product file was modified by this pass** — the QA proxy/static host and the axe-core install live entirely in the session scratchpad, not in the repo. Only `qa-results/final-review/frontend-golden-path/retry1/` and this report were added.

---

## 10. Verdict

**PASS-WITH-CAVEATS.**

- **D-1 is genuinely fixed.** Independently re-measured, not eyeballed: 44 `getBoundingClientRect`/`scrollWidth` measurements across 11 shared-header screens at 375/414/768/1280 px, all clean, with the specific failure signature gone (Sessions header actions 680 px → **343 px** in a 375 px viewport; shell pane pan 375/696 → **375/375**), and the previously off-screen Status filter now driven successfully by a real click at 375 px. Because the fix is in the shared component, the recurrence risk is genuinely removed for future screens too.
- **D-2 is genuinely fixed.** All 10 `button[role="switch"]` elements expose a real, distinct, provider-specific accessible name in the actual accessibility tree (10/10 distinct, none null or empty, no dangling `aria-labelledby`), and axe reports **0** violations on the screen that previously carried a *critical* `button-name` failure.
- Full frontend regression is green and byte-for-byte unchanged; the golden path, cross-SPA data flow, auth boundary and secret-leakage checks all still hold; no D-3…D-9 finding regressed and none of them was affected by the two fixes.

Nothing here blocks the frontend. The remaining items in §8 are the final non-blocking caveat set for the user-facing completion report. The deployment blockers reported by the parallel agent are outside this verdict.
