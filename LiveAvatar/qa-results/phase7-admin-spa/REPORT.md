# QA Report - Phase 7 Admin SPA (BL-020 to BL-024)

Date: 2026-08-19/20
Scope: Five new Angular admin screens - Dashboard, Session logs (list+detail), GPU monitor,
Alerts and failover, Data residency settings - plus the shared tenant-select component and the
removal of the "coming soon" placeholder. Backend and conversation-SPA summary screen were covered
by parallel QA dispatches and are out of this report's scope except where they intersect (e.g.
alert-policy llm_fallback field, GPU heartbeat ingest).

Verdict: PASS-WITH-CAVEATS - no defect blocks the core golden paths, but there are real,
independently-reproduced defects (one on Alerts is a genuine gap against both the UX spec and the
dev's own decision-log claim) that should be fixed before Final Review.

## Environment

- Disposable Docker Postgres 16 (qa-phase7-postgres-1, port 25532), Redis 7 (port 26479), LiveKit
  --dev (port 27880) - all created fresh for this pass, all torn down afterward.
- apps/api built with tsc -p tsconfig.build.json (note: nest build silently produced no dist/
  output in this sandbox for unknown reasons; tsc direct was used instead and works correctly)
  and run as two real Node processes (main.js on :8090, main-internal.js on :8091), env vars
  passed inline on the command line (not via .env, see caveat below).
- apps/web admin SPA served via ng serve admin --proxy-config qa-proxy.conf.json --port 4200,
  proxying /api to the live backend on :8090.
- Seeded via real HTTP calls (/api/auth/seed, /api/tenants, /api/tenants/:id/provider-credentials
  plus real /probe calls) and one direct-Prisma seed script (qa-seed-tmp.ts, run then deleted) for
  volume data (5 sessions across all statuses, transcript utterances, latency hops with one
  deliberately-omitted TTS hop, GPU heartbeats, alert events) - chosen over hand-crafted fixtures
  per this project's documented history of mocked-only tests hiding real bugs. Real GPU heartbeats
  were also ingested through the actual POST /internal/gpu-heartbeats endpoint (not just seeded
  directly) to verify FR-GPU-3's live ingest path, including its 400/GPU_HEARTBEAT_INVALID and
  401 (missing X-Internal-Token) cases.
- Browser: Playwright/Chromium (one-off scratchpad install), driving the real ng serve dev server
  end-to-end (login, then each screen), never calling internal Angular services directly.
- Real degraded-mode-message edit + Save on Alerts, and a Recordings-toggle-warning + radio change +
  Save on Residency, were driven end-to-end and independently reloaded to confirm persistence.

Environment caveat (not a product defect): this sandbox proved unable to keep a plain background
node dist/main.js process alive for more than roughly 10-15 minutes at a time - it was silently
terminated by the harness multiple times during this pass with no application-level error, and on
at least two occasions the live process ended up connected to an unrelated, stale Postgres
container left over from an earlier, unrelated QA session (liveavatar-postgres-1 on port 55433)
rather than this pass's own disposable container, because the calling shell's .env file was found
reverted to that session's port numbers between commands. Root cause was not conclusively
identified (no other agent process was found running on this machine at the time); worked around
by passing all env vars inline on the node command rather than relying on .env sourcing, and by
verifying the live tenant list via psql/curl before every screenshot batch. Flagging this since it
cost significant verification time and could recur for the next QA/dev pass in this same sandbox -
recommend the orchestrator note it, not something to fix in application code.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-DASH-1 (cross-tenant snapshot) | Real seeded data (2 tenants, 5 sessions: 3 ended/1 failed/1 abandoned) renders as real numbers, not placeholders; error rate = 20% (1/5) | PASS | 02-dashboard-default.png |
| FR-DASH-1 (range control) | 24h default confirmed; 1h/24h/7d button-toggle-group present | PASS (see D-3 for phone variant) | 02, 03 |
| FR-DASH-1 (zero-tenant empty state) | Not exercised (2 tenants existed for the whole pass) | UNTESTED | - |
| FR-DASH-2 (provider health grid) | Real probes against fake credentials produced genuine "unreachable" (red) cells for LLM/STT; unconfigured categories show gray/Unknown | PASS (labels - see D-1) | 02-dashboard-default.png |
| FR-SESS-1 (searchable list, filters) | Tenant-scoped list via tenant-select typeahead renders 5 real rows with correct status chips/duration/error code | PASS | 24-sessions-list-filtered.png |
| FR-SESS-1 (admin-required-tenant prompt) | Not exercised - test admin user has operator role (assigned to no single tenant), so the admin-required-tenant path never triggers | UNTESTED | - |
| FR-SESS-2 (transcript + A/V metadata) | Room name, participant identities (not tokens), "No recording" chip, ordered transcript with "You said"/"Assistant said" text labels all render correctly from real data | PASS | 25-session-detail.png |
| FR-SESS-3 (latency breakdown, missing hop omitted) | Cycle 1's deliberately-omitted TTS hop renders as an em dash, not 0ms; e2e column (never seeded) also correctly an em dash | PASS | 25-session-detail.png |
| FR-GPU-1 (read-only monitoring cards) | Real heartbeats ingested via the real POST /internal/gpu-heartbeats render correctly; stale (>60s) heartbeats correctly flip to Unhealthy server-side even though the raw stored healthy flag was true (confirms FR-GPU-3's staleness rule is computed server-side, not trusted from storage) | PASS (labels - see D-2) | 21-gpu-fresh.png |
| FR-GPU-1/2 (no scale controls) | Confirmed no scale-up/down control anywhere on the screen; "Read-only" supporting copy present; "Autoscaler: Not configured" rendered as plain text, not a toggle | PASS | 21-gpu-fresh.png |
| FR-GPU-3 (heartbeat ingest validation) | Valid payload gives 204; malformed payload gives 400/GPU_HEARTBEAT_INVALID; missing X-Internal-Token gives 401 | PASS | curl transcript in session log |
| FR-ALERT-1 (retry policy + degraded message form) | Edited degraded-mode message, saved, reloaded page - change persisted | PASS | 26, 27, 28 |
| FR-ALERT-1 (fallback LLM read-only display) | UX_GUIDELINES section 16.2 step 4 requires a read-only "Fallback LLM" display plus an "Edit in Agent Builder" link. Not rendered anywhere in the shipped component (grep-confirmed zero references to fallback/llm_fallback in alerts-page.component.html/.ts), even though the backend's GET .../alert-policy correctly returns an llm_fallback field | FAIL - D-4 (see below) | 26-alerts-real-initial.png, grep evidence |
| FR-ALERT-2 (failover stats display) | Real GET /tenants/:id/failover-stats numbers render (0/0/0, correctly shown as real zeros not an empty-state, per section 16.3) | PASS | 26-alerts-real-initial.png |
| FR-ALERT-4 (alert event list) | 4 real seeded AlertEvent rows of all 4 types render with correct message/timestamp text | PASS (icon/label - see D-5) | 11-alerts-real-alerts-tab.png |
| FR-ALERT-4 (no email/PagerDuty config UI) | Confirmed absent anywhere on the screen | PASS | 26, 11 |
| FR-PRIV-1 (residency policy editor) | All three fields (radio group, retention days, recordings toggle) render with real per-tenant data and correct helper text | PASS | 29-residency-initial.png |
| FR-PRIV-1 (recordings-not-implemented warning) | Toggling Recordings on immediately (pre-save) shows the exact spec sentence; toggling off removes it | PASS | 30-residency-recordings-toggled-warning.png |
| FR-PRIV-1 (publish-gate: none + remote LLM blocked) | Tenant used for this test had no published remote-LLM config, so CONFIG_RESIDENCY_BLOCKS_LLM was never actually triggered - save with none succeeded, which is correct given no remote LLM is configured, but the blocking path itself was not exercised | UNTESTED (needs a tenant with a published remote-LLM Agent Builder config to trigger) | 31-residency-blocked-save-attempt.png |
| Cross-cutting: all 5 screens behind AdminJwtGuard | Unauthenticated GET to /dashboard/summary, /gpu/nodes, /tenants/:id/alert-policy, /tenants/:id/residency, /sessions all correctly 401 | PASS | curl transcript |
| Cross-cutting: tenant-select shared component reused | Grep-confirmed genuine reuse (not 3 separate implementations) across Dashboard/Sessions/GPU/Alerts-picker/Residency-picker | PASS | grep evidence |
| Cross-cutting: "coming soon" placeholder unreachable | Nav config confirms all 7 items live:true; no coming-soon component file exists anywhere in apps/web/projects; wildcard route (**) redirects to /login, not a stub page | PASS | grep evidence |
| Phone layout (375px), Dashboard | Range toggle still renders as the 3-button toggle group, not converted to a mat-select as UX_GUIDELINES section 13.6 explicitly requires for phone width; header controls crowd tightly against the viewport edge | FAIL - D-3 (see below) | 05-dashboard-375px.png, DOM query evidence |
| Phone layout (375px), Sessions list | List does not convert to the stacked-card layout section 14.7 explicitly requires; still a raw mat-table measured at 721px wide inside a 375px viewport - Status/Provider stack/Error code columns are pushed off-screen and inaccessible (document itself does not scroll, so this content is genuinely unreachable, not just requiring a swipe) | FAIL - D-6 (see below, most severe finding) | 07-sessions-list-375px.png, DOM measurement evidence |
| Phone layout (375px), GPU | Cards stack correctly to one column, full width, no overlap | PASS | 22-gpu-375px.png |
| Frontend regression | jest --coverage | PASS - 61/61 suites, 403/403 tests, matches dev's claim exactly | terminal output |
| Static analysis | eslint "projects/**/*.ts" | PASS - clean | terminal output |
| Build | ng build admin, ng build conversation | PASS - both clean (pre-existing, unrelated CommonJS warning for @liveavatar/contracts) | terminal output |
| Console/network errors during all browser flows | Zero console errors/page errors captured across both Playwright passes | PASS | console-errors.txt, console-errors-2.txt (both empty) |

## Defects (ordered by severity)

### D-6 (Blocking-ish / High) - Sessions list has no phone stacked-card layout; data is inaccessible at 375px
Originating phase: Phase 7 (session-logs feature).
Expected: UX_GUIDELINES section 14.7: Phone list becomes stacked cards, same Deployments phone
convention (section 5.6): session id and status chip as the card header, started, duration and
tenant as meta lines.
Actual: The Sessions list still renders as a plain mat-table at 375px. Measured via Playwright: the
table rendered width is 721px inside a 375px viewport (document.documentElement.scrollWidth stays
375, i.e. the page itself does not scroll, so the overflow content is simply clipped and not
reachable by any swipe or scroll gesture found). The Status, Provider stack, and Error code columns
are entirely invisible and inaccessible at this width.
Repro: ng serve admin, log in, resize to 375x800, navigate to admin sessions route.
Evidence: qa-results/phase7-admin-spa/20260819T214702Z/07-sessions-list-375px.png; DOM measurement
(table bounding box width 721.23px at x=16, document.documentElement.scrollWidth 375px, confirmed
via a dedicated Playwright script).
Note: this is exactly the defect class the dispatch specifically warned about (repeated
phone-layout regressions in Phases 1 and 2) - it recurred here on the one Phase 7 screen with the
most complex table (7 columns), and did not get the same conversion Deployments/GPU received.

### D-4 (Blocking for FR-ALERT-1 fallback-LLM sub-requirement) - Alerts screen never renders the fallback-LLM read-only display
Originating phase: Phase 7 (alerts feature).
Expected: UX_GUIDELINES section 16.2 step 4: Fallback LLM read-only display showing
llm_fallback.provider and llm_fallback.model (or "No fallback configured" if null), with a link
"Edit in Agent Builder". The dev own decision log for this phase states it deliberately kept
fallback-LLM identity read-only per the pre-existing Agent-Builder-owns-it decision.
Actual: alerts-page.component.html and .ts contain zero references to fallback or llm_fallback
anywhere, not a hidden or conditional block, simply not present. The backend GET
/tenants/:id/alert-policy correctly returns llm_fallback (confirmed null for an unconfigured
tenant via direct curl), so the data is available; the frontend never consumes or renders it. This
is not a coherent conservative resolution of the flagged product conflict, it is an outright gap
between what both the guidelines and the dev own stated implementation claim exists and what is
actually shipped.
Repro: log in, navigate to the tenant Alerts and failover screen, Fallback and retry tab, no
fallback section and no Edit in Agent Builder link anywhere on the page.
Evidence: qa-results/phase7-admin-spa/20260819T214702Z/26-alerts-real-initial.png; grep for
fallback in alerts-page.component.html returns no matches.
Note on the flagged product conflict: independent of this bug, the underlying product question of
whether this screen should ever edit fallback identity, per section 16.9, is for the
orchestrator/architect, not for me to resolve, but whatever the eventual decision, the read-only
display that both this phase own guidelines and its own decision log say already exists needs to
actually exist.

### D-3 (Moderate) - Dashboard range toggle not converted to mat-select at phone width
Originating phase: Phase 7 (dashboard feature).
Expected: UX_GUIDELINES section 13.6: Phone range toggle becomes a mat-select, same phone
convention as Deployments status filter (section 1.4), to avoid five cramped segmented buttons on
a narrow screen.
Actual: At 375px the range control still renders as the 3-button button-toggle-group (confirmed
via DOM query: button-toggle-group count 1, mat-select count 0 on this screen at 375px). Not as
severe as D-6 since 3 buttons (not 5) still fit without literal overflow
(document.documentElement.scrollWidth equals clientWidth equals 375, no page-level horizontal
overflow), but it directly contradicts an explicit, specific responsive requirement in the
guidelines and crowds the header row Tenant field tightly against the viewport edge.
Repro: dashboard route at 375x800.
Evidence: 05-dashboard-375px.png; DOM query evidence (script output: button-toggle-group count 1,
mat-select count 0).

### D-1 (Low) - Dashboard provider-health category labels render as Stt, Llm, Tts instead of the spec acronyms
Originating phase: Phase 7 (dashboard feature).
Expected: UX_GUIDELINES section 13.1: Grid should read LiveKit, STT, TTS, avatar, LLM - acronym
categories should read as acronyms.
Actual: dashboard-page.component.html interpolates the raw lowercase category key
(category.category, e.g. stt) and applies text-transform: capitalize in SCSS, producing Stt, Llm,
Tts (only the first letter capitalized) rather than the correct all-caps acronym form. Transport
and Avatar happen to look fine since they are real words, masking the bug for those two categories.
Repro: dashboard route, look at the provider-health row.
Evidence: 02-dashboard-default.png; dashboard-page.component.scss line 51
(text-transform: capitalize).
Severity note: cosmetic, but directly undercuts section 13.5 own cited recognition-over-recall
heuristic for exactly this grid - an operator scanning for STT health sees Stt instead.

### D-2 (Low) - GPU node role labels render as raw lowercase enum values, not the spec display text
Originating phase: Phase 7 (GPU feature).
Expected: UX_GUIDELINES section 15.2: role rendered as icon plus text using STT, TTS, Avatar as the
visible label.
Actual: gpu-page.component.html binds the label attribute directly to node.role - the raw
lowercase enum value (stt, tts, avatar) with no display-name mapping (unlike roleIcon, which does
correctly map to an icon). Same root-cause pattern as D-1, a missing category or role display-name
lookup, on a different screen.
Repro: GPU health route.
Evidence: 21-gpu-fresh.png; gpu-page.component.html line 43; gpu-page.component.ts has no
corresponding roleLabel method, only roleIcon.

### D-5 (Low) - Alerts event-type rows show the raw enum key with no icon
Originating phase: Phase 7 (alerts feature).
Expected: UX_GUIDELINES section 16.2 step 5: a type icon plus label (llm_failover maps to
sync_problem, provider_unreachable maps to cloud_off, session_failed maps to report, gpu_unhealthy
maps to dns - icon plus text per baseline).
Actual: alerts-page.component.html renders the raw event.type verbatim (e.g. llm_failover as bold
snake_case text) with no icon and no human-readable label mapping.
Repro: tenant Alerts and failover screen, Alerts tab.
Evidence: 11-alerts-real-alerts-tab.png; alerts-page.component.html line 87.

### D-7 (Low) - Sessions list Provider stack column shows only the LLM, dropping the other 4 categories
Originating phase: Phase 7 (session-logs feature).
Expected: UX_GUIDELINES section 14.1 step 5: Provider stack shown as compact chips or an em dash if
the provider_stack snapshot is empty - implies the full snapshot (transport, stt, llm, tts, avatar),
not one field.
Actual: sessions-list-page.component.html line 74 reads only row.provider_stack.llm, falling back
to an em dash - transport, stt, tts, and avatar are silently discarded even though the seeded
provider_stack snapshot for every test session contained all five.
Repro: Sessions route with a tenant selected - Provider stack column shows openai only for every
row, never the full stack.
Evidence: 24-sessions-list-filtered.png; sessions-list-page.component.html line 74.

## Untested / gaps for a follow-up pass

- FR-DASH-1 zero-tenant empty state (both operator and admin copy variants) - not exercised since
  test tenants existed for the whole pass.
- FR-SESS-1 admin-required-tenant prompt state - the test admin account has the operator role; a
  real admin-role user assigned to 0/1/2+ tenants was not created or tested.
- FR-PRIV-1 actual CONFIG_RESIDENCY_BLOCKS_LLM block - the test tenant never had a published
  remote-LLM Agent Builder config, so none plus remote-LLM was never actually rejected by the
  server in this pass (the UI behavior when it is rejected - banner text, radio staying selected -
  was not independently observed against a real 422 response, only against a real success).
- SESSION_NOT_FOUND and TRANSCRIPT_PURGED detail-page states, and the empty-list/error states for
  all 5 screens, were not driven to their actual server-error/404 responses (only their happy-path
  and a couple of documented client-side-only states were observed).
- A full WCAG 2.2 AA pass (contrast measurement, full keyboard-only traversal, screen-reader
  announcement testing) was not performed at Final-Review depth for these 5 screens - spot checks
  only (aria-labels present per grep, icon-plus-text conventions checked visually).

## Overall verdict

PASS-WITH-CAVEATS. None of the defects blocks the phase core golden paths (every screen loads,
shows real data, and its primary write action works and persists), so this is not a hard FAIL - but
D-6 (Sessions list phone layout) and D-4 (Alerts fallback-LLM display entirely missing) are both
concrete, spec-contradicting, independently-reproduced gaps that should be fixed by a nexus-dev
retry before Final Review, not carried forward silently. D-1, D-2, D-5, and D-7 are low-severity
polish items that can be batched into the same retry cheaply (all are one-line template or casing
fixes). No blocking backend, security, or data-integrity issue was found in this phase own new code
during this pass.
