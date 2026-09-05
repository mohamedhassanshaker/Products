# Final Review — Frontend Golden Path & Full Regression

- **Date:** 2026-08-20
- **Agent:** `nexus-qa` (Final Review, frontend scope)
- **Scope:** Full-regression re-confirmation of both Angular SPAs; whole-application golden-path walkthrough across all 11 screens with real seeded multi-tenant data; cross-cutting security/accessibility spot-check. Deployment smoke test and backend/Python-agent regression are covered by a parallel agent and are **not** in this verdict.
- **Verdict:** **PASS-WITH-CAVEATS** — no blocking defect; 2 defects should be fixed before production sign-off (D-1, D-2), 7 lower-severity findings logged.

---

## 1. Environment

Everything below was run live; nothing was mocked.

| Component | How it ran |
|---|---|
| Postgres 16 | disposable Docker container `la-fr-pg`, `127.0.0.1:55433`, schema via real `prisma migrate deploy` (the committed `20260819234327_init` migration) + `prisma/seed.ts` catalog seed |
| Redis 7 | disposable Docker container `la-fr-redis`, `127.0.0.1:56380` |
| LiveKit | dedicated disposable container `la-fr-lk`, `127.0.0.1:7890` |
| Control plane (public) | real `node dist/main.js`, `http://127.0.0.1:8195` |
| Control plane (internal :8081 surface) | real `node dist/main-internal.js`, `http://127.0.0.1:8196` |
| Admin SPA | real `ng serve admin`, `http://127.0.0.1:4400/admin/` (dev proxy `/api` to `:8195`) |
| Conversation SPA | real `ng serve conversation`, `http://127.0.0.1:4401/c/` (same proxy) |
| Browser | Playwright 1.62.1 / Chromium, desktop 1440x1000 and 1280x900, phone 375x812 (`isMobile`, `deviceScaleFactor: 2`) |
| Python agent | **not run** — no LiveKit agent worker was registered (see section 7) |

**Seeded data**, created through the real HTTP API and the real `/internal` agent surface, never by direct DB writes:

- 4 tenants: `northwind-bank` (active, published), `acme-health` (active, published, a deliberately different provider stack: faster-whisper / anthropic + google fallback / fish-speech / alibaba-liveavatar / pydantic-ai), `globex-retail` (active, published, no LLM fallback, `prompt_and_transcript` residency, recordings on), `initech-legal` (paused, never configured).
- 5-6 provider credentials per configured tenant; all 3 configs published through `PUT /tenants/:id/config` with a real `If-Match` optimistic-concurrency header.
- 7 seeded sessions across 3 tenants with realistic multi-turn transcripts and 5 latency hops per cycle (including a deliberate `used_fallback` turn), plus 3 live browser-created sessions; 4 GPU heartbeats (1 unhealthy); 5 alerts covering all 4 alert types; 1 invite.

---

## 2. Part 1 — Full regression (all green)

| Check | Result |
|---|---|
| `jest --coverage` (apps/web: admin + conversation + shared) | **61/61 suites, 424/424 tests passed** — identical to the Phase 7 retry-1 baseline |
| `eslint "projects/**/*.ts"` (apps/web) | **clean**, exit 0 |
| `ng build admin` | **clean** — only the pre-existing "`@liveavatar/contracts` is not ESM" CommonJS warning |
| `ng build conversation` | **clean** — same single pre-existing warning; initial total 487.84 kB / 113.98 kB transferred |
| `tsc -p tsconfig.json` (packages/contracts) | **clean**, exit 0 |
| `eslint "src/**/*.ts"` (packages/contracts) | **clean**, exit 0 |

No regression against any previously reported number.

---

## 3. Part 2 — Whole-app golden-path walkthrough (11 screens, one continuous session)

Every screen was reached the way a real operator or end user would (login form, shell nav clicks, row clicks, in-app links), never by calling internal services. Screenshots are in this directory.

| # | Screen | Result | Evidence |
|---|---|---|---|
| — | Login | **PASS** — renders unauthenticated; wrong password shows "Email or password is incorrect." and stays on `/login`; golden path lands in the shell at `/deployments` | `01-login-desktop.png`, `02-login-invalid-credentials.png`, `03-after-login-landing.png` |
| — | Invite accept | **PASS** — a real `POST /auth/invites` token renders the Set-your-password form at both 375px and 1280px; accepting genuinely provisions and signs in the new scoped admin | `01-invite-accept-375.png`, `02-invite-accept-1280.png`, `03-invite-accepted-landing.png` |
| — | Admin shell nav | **PASS** — all 7 nav items are real `<a routerLink>` with resolvable hrefs and `aria-disabled="false"`; **zero disabled coming-soon items remain** (see section 6) | `03-after-login-landing.png` |
| 1 | Dashboard | **PASS** — real aggregation: 3 active deployments, 10 started / 8 ended / 1 failed / 0 abandoned, 10% error rate, matching `GET /dashboard/summary` exactly. Provider-health labels read LiveKit / STT / LLM / TTS / Avatar (Phase 7 D-1 fix holds) | `04-dashboard-desktop.png` |
| 2 | Agent Builder | **PASS** — loads the published Northwind config with real values; a live edit plus Publish genuinely wrote and survived a reload (marker string round-tripped); YAML preview renders the redacted config | `06-agent-builder-desktop.png`, `01-x-builder-globex-before.png`, `02-x-builder-globex-published.png` |
| 3 | Deployments | **PASS** — all 4 tenants listed with correct status chips and provider summaries ("Published — openai, elevenlabs, bithuman"; "Not configured" for the paused tenant) | `05-deployments-desktop.png` |
| 4 | Provider Registry (catalog) | **PASS** functionally — all 5 categories, 10 seeded rows, hosting badges, interface names. See **D-2** for the accessibility failure | `07-provider-catalog-desktop.png` |
| 4 | Provider Registry (credentials) | **PASS** — 6 seeded credentials per tenant, Configured secret indicator, real probe results; **no raw secret value appears anywhere in the DOM** (a DOM search for the LiveKit secret returns nothing) | `08-provider-credentials-desktop.png` |
| 5 | Session logs (list) | **PASS** functionally — 10 real sessions; Provider stack column renders all 5 categories ("livekit · deepgram · openai · elevenlabs · bithuman", Phase 7 D-7 fix holds); em dash for absent error codes. See **D-1**, **D-4** | `09-sessions-list-desktop.png` |
| 5 | Session logs (detail) | **PASS** — real header metadata, participant identities (`user_...` / `agent_...`, never tokens), full multi-turn transcript with You-said / Assistant-said captions, latency breakdown | `10-session-detail-desktop.png`, `01-p-session-detail-with-hops-375.png` |
| 6 | GPU monitor | **PASS** — all 4 seeded nodes with correct Avatar / STT / TTS role labels (Phase 7 D-5 fix holds), utilization percentages, health chip, "Autoscaler: Not configured" | `11-gpu-desktop.png` |
| 7 | Alerts | **PASS** — picker plus tenant screen; **Fallback LLM "anthropic / claude-3-5-sonnet-latest" and the Edit-in-Agent-Builder link are present** (Phase 7 D-4 fix confirmed, previously claimed-but-absent); retry policy, degraded-mode message with 85/500 counter, and failover stats (Primary failures 3 / Fallback successes 3) all real | `12-alerts-picker-desktop.png`, `13-alerts-desktop.png` |
| 8 | Data residency / privacy | **PASS** — picker plus tenant screen, all 3 residency modes with correct explanatory copy, retention days, recordings flag | `14-residency-picker-desktop.png`, `15-residency-desktop.png` |
| 9 | Pre-call / permissions | **PASS** functionally — card renders, mic explanatory line present, name input plus camera toggle plus Join. Unknown slug shows "This assistant is not available right now." with Join correctly **disabled** (no false retry affordance, matching UX_GUIDELINES 11.3). A paused tenant gets identical treatment, correctly indistinguishable. See **D-3**, **D-5**, **D-8** | `01-c-precall-375.png`, `02-c-precall-unknown-slug.png`, `03-c-precall-paused-unconfigured.png` |
| 10 | Live conversation | **PASS** within the agent limitation (section 7) — a real `POST /public/sessions` minted a LiveKit token and the browser genuinely joined the real LiveKit room; Mute / Captions / End-call controls render in the specified order; `aria-live="polite"` status and caption regions present; the "Captions unavailable." fallback renders correctly (Phase 4 D-2/D-3 fixes hold); mic-level meter present. See **D-5**, **D-8** | `05-c-call-375.png`, `04-x-enduser-call-globex.png` |
| 11 | Post-call summary / feedback | **PASS** — real summary text and full transcript render from seeded data; 5-star APG radio group (roving tabindex, ArrowRight moves focus and sets exactly one `aria-checked="true"`, labels "1 star".."5 stars" — Phase 7 D-3 fix confirmed); feedback submit shows "Thanks for your feedback."; **a reload keeps the confirmation and does not re-show the form** (Phase 7 D-2 fix confirmed); a forged summary token yields "This summary link has expired." with no data leak (FR-CALL-5) | `01-c-summary-with-real-data-375.png`, `07-x-summary-feedback-submitted.png`, `08-x-summary-after-reload.png`, `09-x-summary-forged-token.png` |

**Browser console and network across the entire walkthrough: zero unexpected errors.** The only captured 4xx responses were the ones QA deliberately provoked (bad password 401, unknown-slug preflight 404, paused-tenant preflight 403, forged summary token 401).

### 3.1 Phone-width (375px) sweep

Measured with `getBoundingClientRect` / `scrollWidth`, not eyeballed. Priority was the screens whose phone layout had **never** been verified in a prior phase QA pass (Login, Invite accept, Agent Builder, Provider catalog, Provider credentials, Alerts picker, Residency picker, Pre-call).

| Screen | Document overflow | Table state | Result |
|---|---|---|---|
| Login | 0 px | — | PASS |
| Invite accept | 0 px | — | PASS |
| 1 Dashboard | 0 px | cards | PASS |
| 2 Agent Builder | 0 px | YAML `<pre>` 343 px, `pre-wrap`, no h-scroll | PASS |
| 3 Deployments | 0 px | stacked cards, 343 px | PASS |
| 4 Provider catalog | 0 px | 5 stacked-card tables, 343 px, all 4 columns visible with `data-label` prefixes | PASS (`07-p-provider-catalog-375.png`) |
| 4 Provider credentials | 0 px | stacked cards, 343 px, all 6 columns visible | PASS (`08-p-provider-credentials-375.png`) |
| 5 Sessions **list** | 0 px (document) | table stacked cards OK, **but the filter toolbar is 680 px wide** | **FAIL, see D-1** (`09-p-sessions-375.png`, `D1-sessions-filters-clipped-375.png`) |
| 5 Session **detail** | 0 px | latency table 343 px; shell pane 375/375 | PASS |
| 6 GPU monitor | 0 px | cards | PASS |
| 7 Alerts picker / Alerts | 0 px | — | PASS |
| 8 Residency picker / Residency | 0 px | — | PASS |
| 9 Pre-call | 0 px | — | PASS |
| 10 Live conversation | 0 px | — | PASS |
| 11 Post-call summary | 0 px | — | PASS |

---

## 4. Part 3 — Cross-cutting spot-checks

### 4.1 Cross-SPA end-to-end (admin to end user, one session)

Driven as one continuous browser session: the operator opened Globex Retail in **Agent Builder**, edited the system prompt to a unique marker string, clicked **Publish**, reloaded, and confirmed the write persisted server-side; a second tab then opened `/c/globex-retail`, joined, and reached the live call on **that exact republished config**, ended the call, and landed on a token-bound summary. **The two SPAs genuinely connect end to end — PASS.** Evidence chain: `01-x-builder-globex-before.png`, `02-x-builder-globex-published.png`, `03-x-enduser-precall-globex.png`, `04-x-enduser-call-globex.png`, `05-x-enduser-summary-globex.png`.

### 4.2 Security / tenant isolation

| Check | Result |
|---|---|
| Unauthenticated `GET /sessions`, `/dashboard/summary`, `/gpu/nodes`, `/provider-definitions` | **401** on all four |
| Scoped admin (invited with `tenant_ids: [globex]`) opening the Northwind Agent Builder | **404 TENANT_NOT_FOUND** on all 3 underlying fetches; **no Northwind data rendered** (`04-isolation-scoped-admin-foreign-tenant.png`) |
| Same admin, Deployments list | shows **only** Globex Retail; Northwind / Acme / Initech absent (`05-isolation-scoped-admin-deployments.png`) |
| Non-existent tenant id | **404 TENANT_NOT_FOUND** — same code as the cross-tenant case, so no existence oracle |
| Forged `summary_token` | **401**, generic "This summary link has expired.", form suppressed (FR-CALL-5) |
| Raw secrets in the DOM | none — provider secrets never appear; only Configured indicators and `credential_ref` labels |

### 4.3 Accessibility (axe-core, WCAG 2.0/2.1/2.2 A+AA) on screens not previously deep-tested

| Screen | axe violations |
|---|---|
| 9 Pre-call | 1 — `color-contrast` (serious), see **D-3** |
| 11 Post-call summary | **0** |
| 4 Provider catalog | 1 — `button-name` (**critical**, 6 nodes), see **D-2** |
| 2 Agent Builder | 2 — `color-contrast` (serious) see **D-6**; `scrollable-region-focusable` (serious) see **D-7** |
| 4 Provider credentials | **0** |
| 8 Residency | **0** |

Manual keyboard checks: Screen 10 tab order is Mute, Captions, End call (matching UX_GUIDELINES 12.4 ordering); Screen 11 star rating is a correct APG radio group; the admin shell "Skip to main content" is the first focusable control; all form fields carry a visible `<label>` or `mat-label` (a DOM audit found zero unlabelled inputs on any screen).

---

## 5. Defects (none blocking; ordered by severity)

### D-1 — Sessions list filter toolbar has no phone layout (**High**; 6th recurrence of this project phone-layout bug class)

- **Originating phase:** Phase 7 / BL-020 (screen author). Shared-component root cause dates to **Phase 1** (`page-header`).
- **Expected:** UX_GUIDELINES 1.4 (phone under 768 px: "Full-width with 16 px inset"), 14.7 ("Phone: list becomes stacked cards"), and 5.6 precedent for this exact control pair ("Search + status stack vertically"). FR-SESS-1 names `q` and `status` as primary filters.
- **Actual:** at 375 px and 414 px, `.la-page-header__actions` renders **680 px wide inside a 375 px viewport** (right edge at 696 px). The Search-transcript field is clipped mid-word at the viewport edge and the **Status filter is painted entirely off-screen**. The document itself does not scroll (`documentElement.scrollWidth === 375`); the off-screen controls are reachable only by horizontally panning the whole `mat-sidenav-content` shell pane (`clientWidth 375` vs `scrollWidth 696`), which drags the toolbar and the entire table sideways — precisely the pattern 1.4 rules out for phone.
- **Root cause (read, not guessed):** `page-header.component.scss` declares `&__actions { display: flex; ... }` with **no `flex-wrap: wrap`** — the parent `.la-page-header` has it, the actions slot does not. Sessions is the only screen putting three controls in that slot (`la-tenant-select` + a `min-width: 240px` search + a status `mat-select`), so it is the only screen that trips it. The Phase 7 retry-1 D-6 fix correctly converted the *table* to stacked cards but never touched the filter row above it.
- **Repro:** sign in, open `/admin/sessions` at 375x812. The Status dropdown is not on screen.
- **Evidence:** `D1-sessions-filters-clipped-375.png`, `D1-sessions-status-filter-focused-375.png`, `09-p-sessions-375.png`.
- **Measured as not affected:** Dashboard (2 children, 320 px), Deployments (1 child; its filters live in their own `flex-wrap: wrap` container), Providers, GPU (2 children, 292 px), Agent Builder, Credentials, Alerts, Residency — all fit at 375 px.

### D-2 — Provider Registry catalog enable-toggles have no accessible name (**High**; WCAG 2.2 level A, 4.1.2; axe *critical*)

- **Originating phase:** Phase 2 / BL-008.
- **Expected:** NFR-4 and UX_GUIDELINES 1.2 — every control has a screen-reader name; the toggle is the primary operator control on this screen (9.4).
- **Actual:** all 10 catalog toggles expose **no accessible name at all**. `provider-catalog-page.component.html:42` sets `[attr.aria-label]="'Enable ' + row.display_name"` on the `<mat-slide-toggle>` **host**, but Angular Material renders the real control as an inner `<button role="switch">` and only forwards its own `aria-label` **input** (`[aria-label]="..."`). Measured at runtime: host `aria-label` is `null`, inner button `aria-label` is `null`, and its `aria-labelledby="mat-mdc-slide-toggle-0-label"` points at an **empty** element. A screen-reader user hears "switch, on" ten times with no way to tell which provider they are about to disable. The intent is visible in the source but never reaches the rendered control — the same "built but not actually wired" failure mode this project has hit repeatedly, here in accessibility form.
- **Repro:** open `/admin/providers`, inspect any `button[role=switch]`, or run axe.
- **Evidence:** `07-provider-catalog-desktop.png`; axe node dump in section 4.3.

### D-3 — Pre-call primary button fails colour contrast (**Moderate**; WCAG 2.2 AA 1.4.3 / NFR-4)

- **Originating phase:** Phase 3 / BL-011.
- **Expected:** UX_GUIDELINES 1.2 — body text at least 4.5:1.
- **Actual:** measured **3.2:1** (`#ffffff` on `#4c8dff`, 16 px normal weight) on the only primary action of the screen, on the SPA whose declared primary target is a phone.
- **Evidence:** `01-c-precall-375.png`; axe `color-contrast` node.

### D-4 — Sessions list has no date-range filter although FR-SESS-1 names one (**Moderate**; spec gap)

- **Originating phase:** Phase 7 / BL-020.
- **Expected:** FR-SESS-1 lists `from` / `to` ISO timestamps among the inputs of the screen; UX_GUIDELINES 14.5 specifies a control "labelled From / To"; 14.3 defines a `SESS_RANGE_INVALID` inline-error state for it.
- **Actual:** `sessions-list-page.component.html` renders only Tenant, Search transcript, and Status. The contract (`ListSessionsQuery.from/to`), the API service (`session-logs-api.service.ts:50`) and the backend (`list-sessions.use-case.ts:39`, which raises `SESS_RANGE_INVALID`) all support the range — only the UI control is missing, so both the filter and its whole error state are unreachable from the product.

### D-5 — Screens 9 and 10 render no `<h1>` (**Low-Moderate**; document structure, UX_GUIDELINES 1.2)

- **Originating phase:** Phase 3 / BL-011 and BL-012.
- **Expected:** UX_GUIDELINES 1.2 — "one `h1` per page", stated as project-wide.
- **Actual:** measured `h1` count is **0** on the pre-call card and **0** on the live call screen in their normal states. Both templates declare an `h1` only inside their dead-end branches (browser-unsupported, reconnect-failed). Screen 11 is correct ("Call summary").

### D-6 — Agent Builder Published chip contrast 4.48:1 (**Low**; WCAG 1.4.3, marginal)

- **Originating phase:** Phase 2 / BL-009. `#1b7f4e` on `#f2f2f6` at 12 px — 0.02 short of the 4.5:1 threshold.

### D-7 — Agent Builder YAML preview is a scrollable region with no keyboard access (**Low**; WCAG 2.1.1)

- **Originating phase:** Phase 2 / BL-009. `<pre class="la-yaml-viewer" aria-label="Redacted configuration YAML">` scrolls but is not focusable, so a keyboard-only user cannot scroll it (axe `scrollable-region-focusable`, serious).

### D-8 — Conversation SPA browser title is a single static string (**Low**; spec deviation)

- **Originating phase:** Phase 3 / BL-011-012 and Phase 7 / BL-025.
- All three conversation screens report `document.title === "Conversation · Avatar Platform"`. UX_GUIDELINES 11.4 specifies "Join call · Avatar Platform" for Screen 9 and 18.4 specifies "Call summary · Avatar Platform" for Screen 11.

### D-9 — Agent Builder renders a never-succeeding Retry for a 404 (**Low**; observation)

- **Originating phase:** Phase 2 / BL-009. Opening a tenant the actor cannot see yields "Could not load this deployment / Try again." with a **Retry** button; the underlying `404 TENANT_NOT_FOUND` will never resolve, so the affordance is misleading (contrast with 11.3, which deliberately withholds retry for non-self-resolving errors). UX_GUIDELINES 10.9 prescribes no copy for this code, so this is a UX judgement call rather than a verbatim-copy violation.

---

## 6. Previously-disclosed caveats touched by this pass

| Caveat | Status now |
|---|---|
| Phase 7 D-6 — Sessions list phone stacked cards (5th recurrence) | **CONFIRMED FIXED** for the table (343 px, all 7 columns, no overlap). The same screen filter row was never covered — see D-1. |
| Phase 7 D-4 (admin) — Alerts Fallback-LLM display and Edit-in-Agent-Builder link, previously claimed-built-but-absent | **CONFIRMED PRESENT** and correct |
| Phase 7 D-2 — summary page re-showing the feedback form after reload | **CONFIRMED FIXED** live |
| Phase 7 D-3 (conversation) — star rating APG radio pattern | **CONFIRMED FIXED** (roving tabindex, arrow keys, single `aria-checked`) |
| Phase 7 D-1 / D-5 / D-7 — Dashboard provider-health labels, GPU role labels, Sessions provider-stack column | **CONFIRMED FIXED**, all three |
| Phase 4 captions D-2 / D-3 — `captionsAvailable` default and empty caption box | **CONFIRMED FIXED** — "Captions unavailable." renders, no empty shell |
| Phase 7 — "all remaining coming-soon nav placeholders replaced" | **CONFIRMED** — all 7 nav items are live links. Note: the disabled `@else` branch and its Coming-soon tooltip still exist in `shell.component.html` as now-unreachable dead template code (every `NavItem.live` is `true`). Not a defect; flagged for cleanup. |
| Dependency / ADR compliance | No new frontend dependency was introduced. `apps/web/package.json` matches the LLD-named stack (Angular 20, Material/CDK, `@ngrx/signals`, `livekit-client`, `@sinclair/typebox`, `yaml`). No AI-provider SDK or agent-framework import exists anywhere in `apps/web`. |

---

## 7. Limitations of this pass (disclosed, not worked around)

1. **No Python agent worker was running.** LiveKit accepted the room and the browser genuinely joined it, but no agent registered, so Screen 10 stayed in its "Still connecting you to your avatar..." / "Captions unavailable." state, and no avatar video track, live captions, or agent-generated summary were exercised through the real WebRTC path. Screen 11 summary and transcript rendering was instead verified against **real** summary and transcript rows written through the real `/internal` agent API. The agent-side path belongs to the parallel dispatch.
2. **`docker exec` was unavailable** in this sandbox (Docker Desktop returned HTTP 500 for the exec API), and both containers were killed once mid-run by a Docker Desktop hiccup (exit 255). Both were restarted and the database rebuilt from scratch; database assertions were therefore made through the API rather than `psql`. Host-environment artifact, not a product defect.
3. **Node `fetch` cannot reach `localhost`** in this sandbox (it resolves `::1` first and hangs); all QA tooling was pointed at `127.0.0.1`. Environment note only.
4. `apps/web/qa-proxy.json` was created so the `ng serve` dev proxy could reach the QA API port. **QA scaffolding, not a product change — delete before commit.**

---

## 8. Verdict

**PASS-WITH-CAVEATS.**

All 11 screens load and function correctly against real multi-tenant data in a single continuous session; both SPAs genuinely connect end to end; tenant isolation, auth guards, and summary-token isolation all hold; the full frontend regression is green; and every previously-disclosed Phase 4 and Phase 7 frontend caveat re-verified as genuinely fixed.

Not ready for production sign-off without addressing:

- **D-1** — the 6th recurrence of this project phone-layout defect class, on the same screen whose table was fixed one round earlier. Adding `flex-wrap: wrap` to the shared `page-header__actions` is a one-line fix that also removes the recurrence risk for every future screen.
- **D-2** — a WCAG 2.2 level-A failure (axe *critical*) that makes the primary control of the Provider Registry unusable with a screen reader, while NFR-4 claims AA conformance.

D-3 through D-9 are genuine but non-gating; D-4 in particular is a spec-completeness gap rather than a bug.
