# QA Re-verification Report -- client-feedback-batch, Phases 1/2/3/4

Date: 2026-08-23
QA agent: nexus-qa

## Scope

- Retry verification of Phases 1, 2, 4's QA-driven fix pass (4 items) following the
  prior FAIL verdict (docs/NEXUS_STATE.md, 2026-08-23 qa entry, "Phases 1, 2, 4
  combined -- FAIL overall, mixed severity").
- First-ever QA pass on Phase 3 (settings hub + Connector Alerts fold into MCP
  Health).
- Full-batch regression: typecheck, lint, lint:boundaries, unit suite, and a live
  browser walkthrough tying all four phases together.

## Environment

- Ephemeral compose.test.yml Postgres/Redis/ClickHouse stack (fresh up/down -v,
  no reuse of any prior state).
- Real migrations: packages/db's migrate:test, 31/31 applied.
- Real seed: pnpm run db:seed (scripts/seed.ts) run directly (not through a
  container), with AI_PROVIDER=openai-compatible / AI_BASE_URL pointed at a
  standalone, out-of-process startMockOpenAiCompatibleServer instance
  (@nextbot/testing), never the application's own imported test double.
- Real next dev (apps/web, port 3400) against that same test Postgres, with a
  throwaway apps/web/.env.local (deleted after the run).
- Playwright (Chromium) + axe-core, installed ad hoc into a scratch npm project
  (no permanent dependency added to the repo).
- All infrastructure (Postgres/Redis/ClickHouse containers, next dev, mock AI
  server, apps/web/.env.local, SEED_CREDENTIALS.md, scripts/_qa_mock_ai.mjs)
  torn down/deleted after verification. Nothing left running.

## Retry item 1 -- Phase 1 version seeding -- PASS

Ran pnpm run db:seed against a fresh real Postgres, twice.

- Run 1: walked the full state machine live -- Draft (gitCommitSha: null, no
  tenant Git connection) -> real eval suite bound and run (genuinely Passed against
  the mock AI backend) -> EvalGated -> HumanReview -> Approved by
  admin@demo.nextbot.local (distinct from creator designer@demo.nextbot.local) ->
  Production.
- Direct psql query of agent_definition_version: exactly one row,
  status = Production, git_commit_sha empty/null,
  created_by_user_id = designer's id, approved_by_user_id = admin's id (two
  genuinely distinct users, confirmed by joining back to app_user.email).
- Run 2 (idempotency): every step logged "already exists -- skipping"; row count
  unchanged at 1.
- Live confirmation in the Admin Console: the Definitions list shows "Support
  Assistant" with Production version 1.0.0 (screenshot 14b-definitions-loaded.png).

Note for the record (not a defect): my first attempt at this re-verification omitted
AI_PROVIDER from the environment and left a stuck Draft-only version behind on a
throwaway DB (the eval run failed with ai-registry's own fail-fast config-validation
error, and the version-creation step is guarded on "zero versions exist," so a failed
attempt is not automatically retried on the next db:seed run). This was my own
environment-setup mistake, not a code defect -- the reported PASS above is from a
clean down -v/fresh-DB run with the environment set correctly from the start.

## Retry item 2 -- Model Gateway accessibility -- PASS on the specific ask, with one new incidental finding

- Live axe-core scan (wcag2a/wcag2aa) against a real rendered Model Gateway page,
  with the seeded chat.primary route's Provider Chain entry actually loaded (via
  "Edit", not just the always-visible fields): 0 violations. The previously
  CRITICAL button-name violation is confirmed gone.
- Confirmed the aria-labels read back correctly in the live DOM: Route Key ->
  "Route Key", Cache mode -> "Cache mode", Provider Chain entry 1 ->
  "Entry 1 Provider".
- Screenshots: 01-model-gateway-chain.png, 02-model-gateway-initial.png,
  03-model-gateway-edit.png.

Incidental finding (new, not previously reported, not blocking retry item 2's own
ask): clicking a small size="sm"-class primary-variant button (e.g. the route
table's "Edit" button, h-6/text-xs) and leaving the mouse over it triggers
button.tsx's shared hover:bg-primary/80 state, which axe measured at a 3.67:1
contrast ratio against the 4.5:1 AA text-contrast bar (color-contrast, serious).
This is a real, reachable state (any user who clicks and doesn't move the mouse away
sees it) and is pre-existing in the shared button.tsx primitive, not introduced
by any of Phases 1-4 -- it is not in this batch's scope to fix, but is recorded here
since it was found live during this required scan. Recommend a follow-up ticket
against packages/ui/src/components/ui/button.tsx's default-variant hover state.

## Retry item 3 -- Sidebar collapsible hydration mismatch -- PASS

- Repeated the dev's exact methodology: 20 fresh hard-navigation page loads (new
  browser context per load, real HTTP GET, no hot reload) across /dashboard and
  /agent-platform/definitions, watching the console for any hydration-mismatch
  warning. Result: 0/20 mismatches (script + raw output captured; sensitivity of
  the detector separately confirmed by inspecting full console output on a live page
  -- noise level is a single React DevTools info line, so a real warning would not be
  missed by the filter).
- Keyboard/functional check: the "Agent Platform" trigger's aria-controls now
  reads the deterministic sidebar-section-panel-agent-platform id and the matching
  panel exists at that id before any interaction; click-to-toggle and
  keyboard-Enter-to-toggle both correctly flip aria-expanded
  (true -> false -> true); the open/closed state survives a reload (localStorage
  persistence still works).
- Documentation-gap finding (rough edge, non-blocking, Phase 2-originated): the
  fix derives the panel id purely from label.toLowerCase().replace(...) with no
  uniqueness guard. Confirmed by reading sidebar.tsx's SidebarSectionProps JSDoc
  that there is still no comment documenting "sibling SidebarSections must have
  distinct labels" as a now-real constraint. Not reachable today (AdminShell.tsx
  only ever renders one SidebarSection, "Agent Platform"), so this does not block,
  but should be documented before a second collapsible section is ever added,
  otherwise two sections could silently render duplicate DOM ids.

## Retry item 4 -- VersionEditor live axe scan -- PASS on the specific ask, but see cross-cutting finding below

- Live axe-core scan (wcag2a/wcag2aa) against a real rendered
  VersionEditor.tsx (/agent-platform/definitions/<id>/versions/new, real seeded
  definition, real form pre-populated with a working YAML draft): 0 violations.
  Screenshot 06-version-editor.png.

## Cross-cutting finding, NEW, not caught by the axe scans above -- defect, attributable to Phase 4 (root cause pre-existing in the shared tooltip.tsx primitive)

A live Next.js dev-overlay "1 Issue" console error was visible on Model Gateway
during manual walkthrough. Investigated it directly rather than dismissing it as a
dev-only artifact: it is a genuine React hydration-mismatch warning:

"A tree hydrated but some attributes of the server rendered HTML didn't match the
client properties... id=base-ui-_R_3u9a9bn5ritu15r1b_ vs
id=base-ui-_R_fp595esnebnqknd1b_ on an element carrying
data-base-ui-tooltip-trigger."

This is the exact same defect class the Phase 2 fix pass root-caused and fixed
for Collapsible (Base UI's internal useId()-derived id drifting between the
server render and the client's first hydration pass) -- but the fix was scoped only
to sidebar.tsx's SidebarSection. packages/ui/src/components/ui/tooltip.tsx's
TooltipTrigger still wraps Base UI's Tooltip.Trigger directly with no id
override, and FieldHint (Phase 4, packages/ui/src/components/ui/field-hint.tsx)
is the first caller to put multiple instances of it on a page with data-dependent,
timing-sensitive tree shape (Model Gateway's Provider Chain entries, VersionEditor's
fields) -- exactly the condition that makes Base UI's tree-position-dependent
useId() drift between server and client.

Reproduced with the same 20-fresh-load methodology used for retry item 3, on the
two pages retry items 2 and 4 specifically re-verified:

- /agent-platform/model-gateway: hit on loads 0 and 14 of 20 (2 of the 10 loads
  that landed on this specific route).
- /agent-platform/definitions/<id>/versions/new: hit on loads 1, 3, 7, 9, 13 (5 of
  the 10 loads that landed on this specific route).
- Overall: 7/20 (35%) fresh loads reproduced the hydration-mismatch console
  error, interleaved across both routes.

This is a real, user-visible console error (not merely a dev-overlay cosmetic
badge -- a console.error-level "won't be patched up" React warning) on both pages
this QA pass was specifically asked to re-verify, at a rate higher than the original
sidebar bug (4/20, ~20%) that was treated as blocking last round. Axe-core does not
detect this class of issue (it only inspects the settled DOM, not the
hydration/console channel), which is why neither this round's nor the dev's own
axe-only re-scans caught it.

Severity: blocks retry items 2 and 4 (the pages just re-verified are the exact
pages exhibiting it) even though the specific, narrowly-scoped ask of those two retry
items (0 axe violations) is independently true. Originating phase: Phase 4
triggered the reproducible condition by adding the first multi-instance,
data-dependent usage of the shared Tooltip/TooltipTrigger primitive to a real
page; root cause lives in tooltip.tsx (pre-existing, shared by ~9 other
tooltip usages per Phase 4's own dev report, e.g. RolesTable.tsx), not something
Phase 4 introduced into the primitive itself. Recommend the same fix pattern already
proven for Collapsible: give TooltipTrigger/the popup a deterministic,
caller-supplied (or content-hash-derived) id/aria-describedby pair instead of
relying on Base UI's internal useId(), applied to the shared primitive once so
every caller benefits (not just FieldHint).

## Phase 3 -- Settings hub + Connector Alerts fold -- first QA pass -- PASS

| Claim | Verification | Result |
|---|---|---|
| /settings hub renders 8 cards (Branding, Users & Roles, Escalation Routing, Integrations, Audit Log, PII & Guardrails, Retention & Residency, DSR), no Connector Alerts/Model Gateway card | Live render as Read-Only (all-Read role): all 8 cards present, correct titles/hrefs, no Connector Alerts or Model Gateway card | PASS (08-settings-hub-readonly.png) |
| Fail-closed gating via isAnyNavItemVisible | Live render as Escalation Agent (escalations=Write, all 4 other backing modules=None): only the "Escalation Routing" card renders -- the other 7 genuinely do not render (not disabled/greyed, confirmed by screenshot, no residual DOM) | PASS (07-settings-hub-escalation-agent.png) |
| AdminShell.tsx collapses 7 settings entries + Connector Alerts into one "Settings" nav item; Users & Roles and Audit Log keep separate top-level entries | Confirmed live for both Escalation Agent (Settings visible, Users & Roles/Audit Log absent -- correctly gated) and Read-Only (Settings + separate Users & Roles + separate Audit Log all visible) | PASS |
| MCP Health Tabs split, Health tab unchanged, Alert Configuration tab shows relocated ConnectorAlertConfig | Both tabs render real content live: Health shows "MCP Server Health" (Server status grid / Tool-level health / Circuit breaker status, all pre-existing sections); Alert Configuration shows "Connector Alert Configuration" heading and its data region (empty because no connectors are seeded in this fresh tenant -- expected, not a defect) | PASS (09-mcp-health-tab.png, 10-mcp-health-alerts-clicked.png) |
| Tab state restorable from URL (?tab=alerts) | GET /mcp-health?tab=alerts (fresh load) correctly selects the Alert Configuration tab (aria-selected=true) | PASS |
| Tab state reflected into the URL when switching client-side | FAIL -- clicking the Alert Configuration tab does not update the URL (stays /mcp-health, no ?tab=alerts); a subsequent page refresh silently reverts to the Health tab. Confirmed by reading mcp-health/page.tsx: tab is read server-side only as the Tabs primitive's initial defaultValue -- the client-side Tabs is uncontrolled, no onValueChange pushes/replaces the URL. | Defect -- rough edge, Phase 3-originated, non-blocking (bookmarking/sharing/refreshing after a client-side tab switch loses the selection; the one-way "restorable from a direct link" case that Connector Alerts' redirect actually needs does work) |
| /settings/connector-alerts redirects to /mcp-health?tab=alerts, lands on Alert Configuration specifically | GET /settings/connector-alerts -> final URL /mcp-health?tab=alerts, status 200, Alert Configuration tab selected (aria-selected=true), heading "Connector Alert Configuration" rendered -- not a 404, not a loop, not just the Health tab | PASS |
| NO_PAGE_SEGMENT_SHAPES's settings entry removed -- real Settings breadcrumb link | /settings (single segment) correctly renders no breadcrumb at all (consistent with every other single-segment top-level page, e.g. /connectors); /settings/branding breadcrumb is a real link to /settings labelled Settings followed by plain-text terminal segment Branding | PASS |
| Regression: all 9 pre-existing settings-like URLs still resolve unchanged, only connector-alerts redirects | All 9 checked live: /settings/branding (h1 Branding), /roles (Users & Roles), /settings/escalation-routing (Escalation Routing), /settings/integrations (Integrations), /audit-log (Audit Log), /settings/pii-guardrails (PII Detection, Masking & Guardrails), /settings/data-policy (Retention & Residency), /settings/dsr (Data Subject Requests) all 200/unchanged; /settings/connector-alerts redirects as above | PASS |

## Full-batch regression

- pnpm turbo run typecheck: 31/31 packages green.
- pnpm run lint:boundaries (eslint . --max-warnings=0 + dependency-cruiser):
  clean, 0 violations (1926 modules / 5249 dependencies). First attempt raced
  against a concurrently-running unit-test file that creates/deletes a temp fixture;
  re-ran sequentially and it passed clean -- not a real defect, an artifact of my own
  parallel test execution.
- pnpm vitest run --project unit: 196 files / 1152 tests, all green -- matches
  dev's last claimed count exactly, no regressions observed.
- Live browser walkthrough (real next dev, real seeded demo tenant, Tenant Admin
  login): login -> dashboard -> sidebar navigates to Agent Platform, Definitions
  (shows Support Assistant, Production version 1.0.0, confirming Phase 1's seed
  reaches the real UI) -> Model Gateway (real seeded route/provider data, working
  tooltips, accessible selects) -> Settings hub (correct permission-gated cards) ->
  MCP Health's Alert Configuration tab (relocated Connector Alerts UI) -> sign out
  (returns cleanly to /login). Zero console.errors captured during this specific
  walkthrough run (the hydration-mismatch cross-cutting finding above was captured
  separately via the dedicated 20-load repro, since it is intermittent).

## Traceability matrix

| Item | Scenario(s) | Result | Evidence |
|---|---|---|---|
| Retry 1 (Phase 1 seed) | db:seed x2 against fresh Postgres, direct psql query | PASS | terminal output, psql query above |
| Retry 2 (Model Gateway a11y) | Live axe scan, chain populated | PASS (+ 1 incidental pre-existing finding) | 01-03 screenshots |
| Retry 3 (sidebar hydration) | 20x fresh load repro, keyboard/persistence check | PASS (+ 1 doc-gap note) | script output above |
| Retry 4 (VersionEditor a11y) | Live axe scan | PASS (see cross-cutting finding) | 06-version-editor.png |
| Cross-cutting (tooltip hydration) | 20x fresh load repro on Model Gateway + VersionEditor | FAIL | script output above |
| Phase 3 settings hub | Full-access + restricted-role render | PASS | 07, 08 |
| Phase 3 nav collapse | Both roles' nav state | PASS | 07, 08 |
| Phase 3 MCP Health tabs | Both tabs' content, URL restore | PASS (URL-reflect-on-switch is a defect, see above) | 09, 10 |
| Phase 3 redirect | Old URL to new tab | PASS | terminal output |
| Phase 3 breadcrumb | /settings, /settings/branding | PASS | breadcrumb script output |
| Phase 3 regression | 9 URLs | PASS | terminal output |
| Full regression | typecheck/lint/lint:boundaries/unit | PASS | terminal output |

## Defects (ordered by severity)

1. HIGH, cross-cutting, root cause Phase 4 / shared tooltip.tsx primitive:
   Hydration mismatch on Base UI Tooltip.Trigger's internally-generated id,
   reproduced at 7/20 (35%) fresh loads on both Model Gateway and VersionEditor --
   the exact two pages this QA round was dispatched to re-verify. Same root-cause
   class as the already-fixed Collapsible bug; fix not yet applied to tooltip.tsx.
   Recommend applying the same deterministic-id override pattern to the shared
   TooltipTrigger/TooltipContent pair.
2. LOW/rough edge, Phase 3: MCP Health's Tabs only reflects the initial tab
   from the URL on first load; switching tabs client-side does not update the URL,
   so a refresh after switching to Alert Configuration silently reverts to
   Health. Recommend wiring onValueChange to router.replace with the tab
   query param.
3. LOW/rough edge, pre-existing, out of this batch's scope: button.tsx's
   shared hover:bg-primary/80 state fails AA text contrast (3.67:1 vs 4.5:1) on
   small (h-6/text-xs) primary buttons, found incidentally on Model Gateway's
   Edit button. Not introduced by Phases 1-4.
4. LOW/documentation gap, Phase 2: SidebarSection's new deterministic
   label-derived panel id has no documented uniqueness constraint on the label
   prop. Not reachable today (only one section exists), but should be documented
   before a second collapsible section is added.

## Verdict

Retry items 1 and 3: PASS, fully closed.
Retry items 2 and 4: the specific axe-core ask is genuinely fixed (PASS), but both
pages carry a newly-found, real, reproducible (35%) hydration-mismatch console
error that blocks calling either page fully clean.
Phase 3: PASS -- first QA pass, all dev claims independently verified, one
non-blocking rough edge (tab-state URL reflection) and no fail-open permission
gating found.
Full regression: PASS (typecheck/lint/lint:boundaries/unit suite all green,
live walkthrough clean).

Overall: NOT READY. Recommend dispatching nexus-dev once more, scoped to:
(a) fix the shared tooltip.tsx TooltipTrigger/TooltipContent hydration
mismatch (same pattern as the already-fixed Collapsible/SidebarSection case) --
this is the only blocking item; (b) optionally, in the same pass, wire MCP Health's
tab switch to update the URL, document the SidebarSection label-uniqueness
constraint, and log a follow-up ticket for button.tsx's hover-contrast issue (not
blocking, can also be deferred to a separate ticket). Phase 3 itself needs no
further dev work; Phase 1's version-seeding and Phase 2's sidebar-hydration retry
items are both genuinely closed and should not need further QA attention on those
specific points next round.
