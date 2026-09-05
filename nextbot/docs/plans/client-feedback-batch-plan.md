# Client feedback batch (11 items, `comments/Comments.docx`) — phased plan

Source of truth for scope: `C:\Users\m.hassan\.claude\plans\instead-of-chackraui-modify-frolicking-haven.md`
(the approved plan). This doc tracks phase status/deviations only — see that file
for full rationale on every design decision.

## Phase status

| Phase | Item(s) | Status |
|---|---|---|
| 1 Seed data | 5(seed)+10 | **Done, QA-green.** Full goal met: model_provider/model_route/agent_definition/agent_definition_version all seeded, idempotent, with a real Production-promoted version (the ADR-0009 Git-requirement blocker was removed by Phase 5, then a follow-up dispatch completed the seed). |
| 2 Sidebar + brand icon | 2, 3 | **Done, QA-green.** |
| 3 Settings hub + alerts fold | 11 | **Done, QA-green.** |
| 4 Tooltip infra + first batch | 1a | **Done, QA-green.** |
| 5 ADR-0009 amendment + DB-first | 4 | **Done, QA-green** (security-relevant, verified immediately). |
| 6 Shared chat-preview | 9 | **Done, QA-green** (security boundary adversarially verified: anonymous/malformed/mismatched-token/cross-tenant requests all confirmed rejected; TTL, Read-vs-Write mint gating, and the lower-privilege channel-test path's non-leak all confirmed). One disclosed non-blocking gap: no live-browser walkthrough this QA round (component tests + source review substituted) — worth a spot-check whenever a UI-focused pass next touches this area. |
| 7 Sandbox-gate + restore | 6 | **Done, QA-green.** The deployment-replacement fix (plus a real concurrency race dev found and fixed along the way, advisory-lock-serialized) re-verified live end-to-end: a genuine follow-up version now promotes to Production successfully when the agent already has one live, the prior deployment is correctly deactivated, and 20/20 independent concurrency runs held with the invariant never violated. |
| 8 Model Gateway reorg | 5(layout) | **Done, QA-green.** |
| 9 Design Studio form | 7 | **Done, QA-green.** Client transmits only the parsed JSON artifact, never rendered YAML text — server independently re-validates/re-serializes, so no client/server drift is even structurally possible. |
| 10 Tool enrollment | 8 | **Done, QA-green**, including a user-authorized follow-up: real runtime enforcement of `toolPolicy.capabilityGroups` was built and adversarially verified (both the catalog pre-filter and the resolver-layer defense-in-depth check independently confirmed via splice-testing). One low-severity, non-blocking finding documented (a genuinely-corrupt, write-path-bypassing YAML row degrades to "no restriction" rather than "deny all" — requires bypassing normal validation to reach). |
| 11 Tooltip rollout close | 1b | **Done, QA-green — final phase of the whole 11-phase plan closed.** Four batched implementation passes (A: Conversations/Escalations/Approvals/Channels; B: Connectors/Tools/MCP Health; C: remaining Agent Platform screens; D: Settings/Roles/Audit Log) added ~150 FieldHint tooltips across ~17 files. QA's closing pass ran a fresh full-repo regression (typecheck/lint/lint:boundaries/full unit suite, all clean, no regressions) plus a live-browser pass (Playwright + axe-core) sampling one screen per batch: FieldHint copy confirmed accurate on hover, 0/10 hydration-mismatch warnings per screen (10 fresh hard-navigation loads each), 0 axe-core violations. Both flagged deliberate skips (ToolPermissionRules.tsx's table-column controls, RoleCheckboxList.tsx's implicit-label checkboxes) spot-checked and confirmed genuinely correct, not missed work. See qa-results/client-feedback-batch-phase11-close/20260828-231900/REPORT.md. |
| 17 Capability-group runtime enforcement | (follow-up to Phase 10's finding) | **Implemented, ready for QA — SECURITY-RELEVANT, flag for immediate QA, do not batch.** Real enforcement wired into the live turn pipeline: catalog pre-filter + independent `resolvePermission` re-check. See "Phase 17" notes below. |

Phases 1–4 have no shared files and are dispatched together first. Phase 5 follows
(independent of 1–4 but gates 6 and 9). 6→7 and 9→10 are strictly sequential. 11 runs
last, after everything else that touches form fields.

## Phase 1 — implementation notes (2026-08-23)

**Delivered (idempotent, safe to re-run on every `docker compose up`):**
- `scripts/seed.ts` — extended `main()` to seed, for the default `demo` tenant, via the
  module's real public application-service handlers (`@nextbot/agent-platform`'s
  existing `index.ts` exports — no new export needed):
  - One platform-level `model_provider` (`openai-compatible`) via
    `handleRegisterModelProvider` — already an idempotent upsert-by-`key`.
  - One tenant `model_route` (`chat.primary` -> that provider) via
    `handleUpsertModelRoute` — already an idempotent upsert-by-`(tenantId, routeKey)`.
    Both mirror this stack's own `AI_BASE_URL`/`AI_MODEL_CHAT_PRIMARY` env defaults
    rather than an invented, disconnected value.
  - One `agent_definition` ("Support Assistant", real name/description) via
    `handleCreateDefinition`, guarded on "tenant has zero agent definitions yet" so a
    second run is a no-op (matches the dispatch's explicit idempotency requirement;
    `agent_definition` has no natural upsert-by-name semantics the way the two above
    do).
- `package.json` — added `@nextbot/agent-platform` as a root dependency (needed for
  `scripts/seed.ts`'s new import).
- `packages/modules/agent-platform/src/infrastructure/model-gateway-repository.int.test.ts`
  (new) — 3 tests against a real DB proving `registerModelProvider`'s insert-then-
  update-in-place behavior (the actual test gap; see deviation below).
- `SEED_CREDENTIALS.md` — new "Agent Platform" section naming the seeded provider/
  route/definition and explicitly documenting the version/promotion gap below.

**Codebase-vs-dispatch-prompt discrepancy, followed per codebase-as-ground-truth:**
the dispatch assumed only `listModelProviders()` existed and asked for a new
`insertModelProvider()`. The repository already has `registerModelProvider()` (an
upsert-by-`key`, added in a prior QA hygiene fix, 2026-08-15) that fully covers the
need — adding a second, redundant insert function would reintroduce the exact
duplicate-row bug that fix closed. No new repository function was added; the actual
gap (no dedicated repository-level test for `registerModelProvider`) was closed
instead.

**Flagged, not silently worked around — the Production-version part of this phase's
goal is blocked by ADR-0009:** `createAgentDefinitionVersion` (agent-definition-
service.ts) unconditionally commits every new version to the tenant's connected Git
remote first (ADR-0009 §2: "never a fallback to storing the version some other way").
There is no tenant `git_connection` a one-shot, non-interactive init-container seed
script can establish — ADR-0009's connect flow is a real GitHub App/GitLab OAuth
handshake against a tenant-owned repo, and this compose stack (confirmed by reading
`docker-compose.yml` in full) runs no git server of its own. The only test-only
alternative (`@nextbot/testing`'s `startMockGitHubServer`) was rejected as unsuitable
for production seed code: it's a devDependency-only mock that dies with the seed
container, would immediately read back `Unreachable`, and using it would misrepresent
ephemeral fake data as the "real" data this phase's goal explicitly asked for. No
version was created and no status was hand-written to the database — both explicitly
ruled out by this dispatch's own instructions. Only the bare `agent_definition` row
is seeded, with a loud `console.log` warning at seed time and a "Known gap" section in
`SEED_CREDENTIALS.md`.

**Recommend the orchestrator pick one of:**
1. Accept the gap as documented; a human connects Git and creates/promotes a version
   manually per environment when a Production version needs to be demoed.
2. Dispatch `nexus-deploy` to stand up a real self-hosted Git service (e.g. Gitea) in
   `docker-compose.yml` that the seed script can auto-provision a repo/PAT against and
   `connectGit()` for real — ADR-0009 explicitly permits self-hosted GitLab-shaped
   remotes, so this would be a genuine, ADR-compliant remote, not a workaround, but is
   a deployment-topology change outside this dispatch's file scope.
3. Supply real GitHub/GitLab credentials via a new seed-only env var for deployments
   that have them.

**Verification (real, not assumed):** stood up the project's own ephemeral
`compose.test.yml` stack, ran `packages/db`'s real `migrate:test` (31/31 migrations),
ran `pnpm run db:seed` against that database twice (second run's log shows every
idempotency branch taken), then queried `model_provider`/`model_route`/
`agent_definition`/`agent_definition_version` directly via `psql` to confirm the
seeded rows are real (1/1/1/0 respectively — the 0 is the documented gap).
`packages/modules/agent-platform`'s full integration suite (6 files/30 tests, incl.
the 3 new ones) and unit suite (3 files/40 tests) re-run against the same real test
DB — all green, no regressions. `pnpm --filter @nextbot/agent-platform run typecheck`
clean; a scoped `tsc --noEmit` against `scripts/seed.ts` (outside the workspace's own
`turbo run typecheck`/`lint:boundaries` scope — pre-existing, not introduced here)
also clean; `npx eslint packages/modules/agent-platform --max-warnings=0` clean; the
real `lint:boundaries` command clean (0 violations, 1519 modules/4303 dependencies).
Torn down the ephemeral test stack after verification; restored `SEED_CREDENTIALS.md`
to real compose defaults rather than leaving the test run's throwaway values in place.

## Phase 4 — implementation notes (2026-08-23)

**Delivered:**
- `packages/ui/src/components/ui/field-hint.tsx` — new `FieldHint` primitive wrapping
  the existing `Tooltip`/`TooltipTrigger`/`TooltipContent` (`tooltip.tsx`). Icon:
  `InformationCircleIcon` from `@hugeicons/core-free-icons` via `HugeiconsIcon`
  (confirmed as the project's actual installed icon library — ADR-0010's Hugeicons
  convention — rather than assuming a package). Exported from
  `packages/ui/src/index.ts`.
- Applied to `ModelGateway.tsx` (Route Key, Cache mode, Provider chain's
  Provider/Model fields) and `VersionEditor.tsx` (Version, Graph Type, Model Route Key)
  with one-sentence, field-behavior-accurate copy written after reading each field's
  actual handling in the surrounding code.
- `docs/design/UX_GUIDELINES.md` — new `### 1.c Field-level help convention
  (FieldHint)` subsection documenting the pattern for the later mechanical rollout
  (Phase 11) and any other contributor.
- Unit tests: `packages/ui/src/components/ui/field-hint.test.tsx` (3 tests — accessible
  name distinct from the adjacent `Label`, hover reveal with `aria-describedby` wiring,
  keyboard-focus reveal). Existing `ModelGateway.test.tsx`/`VersionEditor.test.tsx`
  suites re-run unmodified and still pass (16/16).

**Deviation from the dispatch prompt, flagged rather than silently worked around:**
the prompt asserted Base UI's tooltip primitive "should give you [aria-describedby]
via its own semantics." Verified directly against the actual installed
`@base-ui/react@1.7.0`: `Tooltip.Root`/`Tooltip.Popup` do **not** wire
`aria-describedby` (or a `role="tooltip"`) automatically — confirmed by rendering the
tooltip and inspecting the DOM, not assumed. This is a latent accessibility gap in the
shared `tooltip.tsx` primitive itself, affecting all ~9 pre-existing usages
(`RolesTable.tsx` etc.) as well as `FieldHint`. Fixed it locally within `FieldHint`
only (kept `tooltip.tsx` untouched, out of caution around other phases that may also
touch shared UI primitives concurrently): `FieldHint` runs the tooltip as a controlled
component (`open`/`onOpenChange`) and sets `aria-describedby` on the trigger to the
popup's `id` only while open, avoiding a dangling ARIA IDREF when closed. Flagging for
the orchestrator: the same gap likely warrants a fix directly in `tooltip.tsx` (benefit
all existing usages) as a small follow-up, ideally bundled with Phase 11's full
mechanical rollout rather than as a surprise change landing mid-phase.

**Also flagged — axe-core not actually wired into unit tests:** the dispatch prompt
stated "this project already has axe-core wired into some component tests, follow that
existing pattern." Searched the actual codebase for `jest-axe`/`vitest-axe`/`axe-core`
usage inside any `*.test.ts(x)` and found none — `axe-core` only appears transitively
in `pnpm`'s store (not declared as a devDependency of `packages/ui` or `apps/web`) and
the project's real axe-core usage is `nexus-qa`'s own live-browser scans
(`qa-results/**`), not anything wired into the Vitest unit-test layer. Since adding a
new test-tooling dependency project-wide is exactly the kind of decision the dev-agent
instructions ask to flag rather than silently invent, this dispatch did **not** add
`jest-axe`/`@axe-core/react` — instead relied on: (a) the accessible-name/
`aria-describedby` unit tests above, (b) manual accessibility review of the new
markup (real `<button type="button">` trigger, explicit `aria-label`, decorative icon
with no competing text — matching this codebase's existing `checkbox.tsx` icon
convention), and (c) confirming the two converted screens' pre-existing axe-clean
history (per `qa-results/chakra-to-shadcn-migration/**`) isn't disturbed by the added
markup (no new landmark/heading-level/contrast issues — `FieldHint`'s only visible
surface is a `text-muted-foreground` icon, an already-established AA-safe token in
this codebase). Recommend `nexus-qa`'s next pass includes a live axe-core scan of both
screens per its usual browser-driven methodology, and recommend the orchestrator
decide once (not per-dispatch) whether to formally add `jest-axe` to the unit-test
layer.

**Gates:** `pnpm turbo run typecheck --filter=@nextbot/ui --filter=nextbot-web` green;
targeted `eslint` on every added/changed file clean; full repo `pnpm run lint` clean
(see decision log); `field-hint.tsx` 100% stmts/branches/funcs/lines coverage;
`ModelGateway.tsx`/`VersionEditor.tsx` unchanged at 96.84%/80.64% and 96.15%/91.3%
respectively (both already above the 80% floor pre-existing this dispatch, unaffected
by the additive changes here).

## Phase 2 — implementation notes (2026-08-23)

**Delivered:**
- `packages/ui/src/components/ui/sidebar.tsx` (new) — `data-slot`-tagged composable
  set (`Sidebar`, `SidebarNav`, `SidebarItem`, `SidebarSection`) built on Base UI's
  `Toolbar` (roving-tabindex arrow-key navigation across nav items, previously unused
  in this package) and `Collapsible` (already vendored, see `collapsible.tsx`) for the
  "Agent Platform" disclosure group. `SidebarItem` takes an `active` prop that drives
  both `data-active` styling and `aria-current="page"`. `SidebarSection`'s open/closed
  state is persisted to `localStorage` per browser (best-effort, wrapped in
  `try/catch`, never throws into render) so a user's deliberate collapse survives a
  reload.
- `packages/ui/src/components/ui/sidebar.test.tsx` (new) — 7 tests against the
  primitive directly (active `aria-current`, default-open, `defaultOpen={false}`,
  click-to-toggle, localStorage persistence read-back across remounts, and both the
  read-failure and write-failure fallback branches) — 100% stmts/branch/funcs/lines.
- `apps/web/app/(admin)/AdminShell.tsx` — rebuilt the sidebar `<nav>` on the new
  primitive. `isNavItemVisible` permission filtering and every RTL logical-property
  class (`ps-*`/`pe-*`/`ms-*`/`me-*`) preserved verbatim. Active-route state derives
  from `usePathname()` (now called directly in `AdminShell`, not only in
  `AdminBreadcrumb`): an item is active when the path equals its `href` or starts with
  `href + "/"`. Added a top-bar brand slot (previously none existed) reusing
  `branding?.logoLightUrl` with the same `<img>`-not-`AvatarImage` rationale as the
  sidebar's own logo (Base UI's `AvatarImage` never resolves `data:` URLs in the test
  environment), falling back to a compact "NB" mark (`aria-label="NextBot"`) when
  unbranded.
- `apps/web/app/(admin)/AdminShell.test.tsx` — extended with 7 new tests (top-bar
  fallback mark, top-bar tenant-logo swap, active-item `aria-current`, descendant-route
  active state, section open-by-default, section click-to-close). All 12 pre-existing
  tests still pass unmodified except one now-necessary scoping fix (see deviation
  below).

**Local, reversible data-shape change (§3), noted rather than silently made:**
`NAV_ITEMS`'s four Agent Platform entries previously had `section: "Agent Platform"`
on only the first (Definitions) — a holdover from when `section` merely inserted a
static label above otherwise-flat items, with no real grouping semantics. Making the
group a genuine collapsible required a way to know where it ends, so all four entries
(Definitions, Evals, Model Gateway, Runtime Traces) now carry the same `section` value;
a new `groupNavItems()` helper partitions the permission-filtered list into flat items
and contiguous same-`section` runs. This only changes the nav's internal shape, not its
gating or rendered content — `isNavItemVisible` filtering runs before grouping,
unmodified.

**Deviation from the dispatch prompt's Sidebar export instruction:** the prompt said to
export the new primitive "from `packages/ui/src/index.ts`." Checked the codebase: no
other `components/ui/*` primitive (`button.tsx`, `dropdown-menu.tsx`, `collapsible.tsx`,
etc.) is re-exported through `index.ts` — every consumer imports them via the package's
`"./components/*": "./src/components/*.tsx"` wildcard export
(`@nextbot/ui/components/ui/button`), and `index.ts` is reserved for the package's
small set of hand-authored composites (`StatusBadge`, `isNavItemVisible`,
`AccessDeniedState`). Followed the established convention (codebase as ground truth)
instead: `sidebar.tsx` is consumed the same way as every other primitive
(`@nextbot/ui/components/ui/sidebar`), not re-exported from `index.ts`.

**Two accessible-name collisions fixed while wiring both logos into the same tree:**
both the sidebar and the new top-bar slot render the same `branding.logoLightUrl` as an
`<img>`; giving both the same `alt="Company logo"` would make them ambiguous to
assistive tech (and to any `getByRole("img", { name })` query). The top-bar image's
`alt` is `"Company logo, top bar"`; the sidebar's is unchanged. Likewise the unbranded
top-bar fallback uses a `role="img" aria-label="NextBot"` compact "NB" mark rather than
literal "NextBot" text, so it doesn't collide with the sidebar's own literal "NextBot"
wordmark text in the same render (an existing test does `getByText("NextBot")` and
must keep matching exactly one node).

**Axe-core scan:** same finding as Phase 4 (documented above) — no `jest-axe`/
`vitest-axe`/`@axe-core/*` wiring exists anywhere in this repo's Vitest unit-test layer;
axe-core usage in this project is `nexus-qa`'s own live-browser scans. Did not add new
test tooling unilaterally. Self-reviewed the rebuilt nav instead: every `SidebarItem`
renders a real `<a>` (native link semantics via Base UI `Toolbar.Link`'s `render`
prop), the active item carries `aria-current="page"`, the collapsible trigger is a real
`<button>` with native Space/Enter toggle semantics and Base UI's own `aria-expanded`/
`aria-controls` wiring (verified in the rendered DOM), and arrow-key roving comes from
`Toolbar.Root`'s built-in composite-list behavior rather than a hand-rolled handler.
Recommend `nexus-qa`'s pass includes a live axe-core scan of `/dashboard` (default nav)
and of a route under `/agent-platform/**` (collapsed/expanded section) per its usual
methodology, plus the RTL locale check called out in this dispatch's own instructions
(no RTL-capable browser/Storybook environment was available in this dev sandbox to
self-verify beyond reviewing the logical-property classes and the chevron's
`rtl:-scale-x-100` mirroring rule).

**Gates:** `pnpm turbo run typecheck` (all 31 workspace packages) green; `pnpm run
lint` (whole repo) clean; `pnpm dependency-cruiser` (lint:boundaries) clean (0
violations, 1519 modules/4303 dependencies); full `pnpm vitest run --project unit`
suite green (192 files/1126 tests, no regressions); `sidebar.tsx` and `AdminShell.tsx`
both at 100% stmts/branch/funcs/lines coverage on the added/changed code.

## Phase 5 — implementation notes (2026-08-23, SECURITY-RELEVANT — flush to QA immediately, do not batch)

**Why this phase matters beyond its own scope:** Phase 1 discovered
`createAgentDefinitionVersion` unconditionally required a live tenant Git connection,
blocking its own seed-data goal. This phase removes that hard requirement. See
"Phase 1 follow-up" below for whether Phase 1's gap can now be closed.

**Investigated before writing code:** read `agent-definition-service.ts`,
`git-connection-service.ts`, `promotion-policy.ts`, and `promote-version-service.ts` in
full first. The pre-existing code already distinguished `GitConnectionNotFoundError`
(no `git_connection` row at all) from `GitConnectionUnavailableError` (a configured
connection whose health check genuinely fails) at the `@nextbot/contracts` level, but
`createAgentDefinitionVersion`'s `catch` collapsed **both** into a freshly-thrown
`GitConnectionUnavailableError` — silently discarding the distinction, and swallowing
any other unexpected mid-commit error into the same bucket too. Fixing that
distinction correctly, not just adding a new branch, was most of this phase's actual
work.

**Delivered:**
- `packages/modules/agent-platform/src/application/agent-definition-service.ts` —
  `createAgentDefinitionVersion`: catches `GitConnectionNotFoundError` specifically and
  proceeds to insert the version with `gitCommitSha: null` (`console.warn` notes the
  degrade — no service-level logger exists yet in this module; matches the seed
  script's existing `console.log` precedent rather than inventing a new mechanism).
  Any other error — a genuine `GitConnectionUnavailableError` from the health check, or
  an unexpected error mid-commit — is re-thrown as-is, never collapsed into the
  graceful path. `submitVersionForReview`: no commit at all, or `GitConnectionNotFoundError`
  raised mid-flight (connection removed between commit and review attempt), both now
  return `{ prNumber: null, reason: "git-not-connected" }` instead of throwing; any
  other error still throws.
- `packages/modules/agent-platform/src/domain/promotion-policy.ts` — no functional
  change to `canPromote` (confirmed unnecessary by reading it in full — the reviewer
  != author check has no Git dependency). Its `Approved`-case doc comment rewritten to
  state this is now THE approval mechanism when no `gitPrNumber` exists, not merely
  defense-in-depth alongside PR review.
- `packages/modules/agent-platform/src/application/promote-version-service.ts` — added
  a doc comment on `loadPromotionCheckInput` confirming, after reading every line, that
  it reads no Git-connection/`gitCommitSha`/`gitPrNumber` state at all — this is why the
  promotion path itself required zero functional changes for this phase.
- `apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx`
  — re-read post-Phase-4 first (confirmed Phase 4's `FieldHint` additions on
  Version/Graph Type/Model Route Key are untouched; only `handleSubmit` and the alert
  render block were edited). Creation now always succeeds; a `gitCommitSha: null`
  response shows a non-blocking `variant="warning"` info banner ("Version saved — not
  synced to Git", with a link to Settings > Integrations and a "Continue to version"
  link) instead of the old dead-end state. A genuine `GitConnectionUnavailableError`
  (configured-but-broken connection) still shows the original blocking-in-place error
  alert, unchanged.
- `apps/web/app/(admin)/agent-platform/definitions/[id]/DefinitionDetail.tsx` — new
  `PrCell` helper: a version with no `gitPrNumber` **and** no `gitCommitSha` now reads
  "No Git connection — approved in-app by another teammate" instead of the ambiguous
  "No PR yet"; a Git-connected version with no PR yet keeps the original copy
  unchanged. `submitForReview` shows an info toast when the backend reports
  `git-not-connected` instead of silently doing nothing visible.
- `docs/architecture/adr/0009-agent-definition-git-hosting.md` — original text kept
  100% verbatim; new dated `## 7. Amendment (2026-08-23)` section appended covering (a)
  Postgres as the real source of truth / Git best-effort, (b) reviewer != author as the
  documented in-app approval mechanism when no PR exists, (c) diff/PR staying strictly
  Git-only with no DB-only fallback, Consequences (including the pre-existing, not-new
  "distinct reviewer means only a different `userId`" limitation, called out explicitly
  per this dispatch's own instruction), and an honest correction that no test literally
  named for "diff/PR never falls back to local git" was found anywhere in the
  codebase — the invariant holds structurally (no `child_process`/shelled-`git` code
  exists anywhere under `git-provider/`), so this ADR does not claim a test that
  doesn't exist. Header gained an `Amended by:` line mirroring the existing
  `Superseded by:` convention (ADR-0002 §4.2a/ADR-0010).
- `docs/architecture/adr/README.md` — index row and cross-link prose updated to point
  at the amendment, same keep-original-add-pointer style as ADR-0001 §2a/ADR-0010.

**Security review (self-review; this phase is security-relevant by its own nature —
a promotion-gate behavior change):**
1. Confirmed the Git-disconnected path is a strict superset restriction, never a
   separate looser path: added a test proving self-approval
   (`actingUserId === createdByUserId`) is still rejected on a fully Git-disconnected
   tenant, using the exact same `promotion-policy.ts` code every Git-connected tenant
   goes through — no branch/condition anywhere inside `canPromote`/
   `loadPromotionCheckInput` is gated on Git state.
2. Confirmed `Approved -> Production` still requires
   `installedGraphTypes.includes(graphType)` regardless of Git state — that code path
   is functionally untouched by this phase.
3. Confirmed `diffVersions` still rejects (never fabricates) a diff when either version
   lacks a `git_commit_sha` — added a regression test proving no DB-only diff fallback
   was introduced.

**Tests (real, DB-backed integration tests, no mocks — matching this module's
established convention; deviation from the dispatch prompt's literal
`agent-definition-service.test.ts` filename assumption, flagged rather than silently
substituted):** no unit-test-with-mocks file exists anywhere in
`packages/modules/agent-platform` — every existing test against this service is a real
integration test using `createFixtureTenant`/a real mock Git HTTP server. Introducing
the package's first mocked-service test file for this one function would be a bigger,
unrequested architectural deviation than extending the existing real-integration
suites, so that's what was done instead:
- `git-connection-service.int.test.ts` — new describe blocks proving (i) zero-git-
  connection `createAgentDefinitionVersion` succeeds with `gitCommitSha: null` and a
  fully-persisted `definitionYaml`/`definitionHash`; (ii) a genuinely-unreachable
  *configured* connection still rejects with `GitConnectionUnavailableError` (a
  structurally distinct test, per this dispatch's explicit requirement); (iii)
  `submitVersionForReview`'s three outcomes (no commit at all, genuine PR success,
  mid-flight disconnect) each independently proven. Also closed a pre-existing,
  unrelated zero-coverage gap discovered while raising this file's own coverage:
  `listDefinitions`/`getDefinition`/`diffVersions` had no test anywhere in the
  codebase before this dispatch; now covered, including `diffVersions`' git-required
  rejection (ADR-0009 §7(c)'s no-DB-only-diff guarantee).
- `promote-version-service.int.test.ts` — new test walking
  Draft->EvalGated->HumanReview->Approved->Production for a second fixture tenant that
  never calls `connectGit` at all for its entire lifetime. Deliberately shares the
  describe's single `aiServer`/env-config lifetime rather than starting a second mock
  AI server: root-caused and avoided a real trap first — `@nextbot/ai-registry`'s env
  config is cached process-wide on first load via a module-level variable not exposed
  for test reset outside the package, so a second `startMockOpenAiCompatibleServer` +
  reassigned `AI_BASE_URL` later in the same file silently resolved eval-run calls
  against the first, by-then-closed server (reproduced the resulting spurious eval-run
  `Failed` status before fixing it).

**Gates:** `pnpm --filter @nextbot/agent-platform run typecheck` and `pnpm --filter
nextbot-web run typecheck` both clean; targeted `eslint --max-warnings=0` on every
changed/added file clean; full `packages/modules/agent-platform` integration suite
re-run (73 files/313 tests, incl. 1 pre-existing unrelated flake in
`packages/modules/tenancy/src/application/plan-tier-definitions.int.test.ts` confirmed
to pass in isolation, not caused by this dispatch) and unit suite (196 files/1143
tests, incl. 1 pre-existing unrelated unhandled-rejection in
`apps/web/app/(admin)/mcp-health/page.test.tsx` — explicitly out of this dispatch's
file scope, flagged not fixed) both green. Coverage on files this dispatch changed:
`agent-definition-service.ts` 81.25% stmts/84% branch (raised from a pre-amendment
~60% baseline by closing the pre-existing `listDefinitions`/`getDefinition`/
`diffVersions` coverage gap alongside this dispatch's own new lines — the two
remaining uncovered lines are an unreachable-in-practice generic re-throw and an
unrelated, pre-existing, untouched `serializeArtifactToYaml`/`parseArtifactFromYaml`
pair out of this dispatch's scope), `promote-version-service.ts` 86.36% (unchanged —
file not functionally modified, only a doc comment added), `promotion-policy.ts`
82.53% (doc-comment-only change, functional coverage unchanged); `DefinitionDetail.tsx`
94.79%/`VersionEditor.tsx` 96.61% stmts, both above the 80% floor with new tests for
the changed branches.

**Phase 1 follow-up, explicitly answered per this dispatch's own instruction:** yes,
`scripts/seed.ts` can now be extended to complete Phase 1's deferred goal —
`createAgentDefinitionVersion` no longer requires a tenant Git connection, so the seed
script can call it directly for the `demo` tenant (which has none) to create a real
Draft version, then `promoteAgentVersion` it through to `Production` using two
distinct seeded user ids to satisfy the reviewer != author check, with zero Git
server/mock needed. Recommend a small follow-up seed dispatch.

**Flagged, not silently fixed:** `docs/architecture/LLD.md` §3.10's field table (line
816) still reads "the tenant's Git remote (§3.10a) is the reviewed source of truth" for
`definition_yaml` — now superseded in substance by this amendment's (a). This dispatch's
scope was limited to the ADR + README + the specific code/UI files listed above; LLD.md
was not edited. Recommend a follow-up LLD touch-up to keep it consistent with ADR-0009
§7, whenever LLD is next revised for any other reason.

`current_phase` left as `development` — **ready for QA; flagging this phase as
security-relevant (promotion-gate behavior change) for immediate QA per this project's
own rules, not marking it QA-approved myself.**

## Phase 3 — implementation notes (2026-08-23)

**Delivered (item 11 — Settings hub + Connector Alerts fold, zero URL changes to
any pre-existing settings page):**
- `apps/web/app/(admin)/settings/page.tsx` (new) — the settings landing page: one
  card per settings-shaped screen (Branding, Users & Roles, Escalation Routing,
  Integrations, Audit Log, PII & Guardrails, Retention & Residency, Data Subject
  Requests), each gated by the exact same `isNavItemVisible` check the sidebar
  nav already used for that screen's old individual entry — fail-closed, a card
  for an unreadable module doesn't render at all (not disabled). Connector Alerts
  and Model Gateway are deliberately excluded per the dispatch's explicit scope
  (B.3A.4 and B.15.5 respectively).
- `apps/web/app/(admin)/AdminShell.tsx` — `NAV_ITEMS` collapses the 7 individual
  `/settings/*` entries plus the standalone Connector Alerts entry into one
  `{ href: "/settings", label: "Settings" }` item. Users & Roles (`/roles`) and
  Audit Log (`/audit-log`) keep their own top-level nav entries (per the plan's
  explicit decision — both are high-frequency single-purpose destinations).
  `NO_PAGE_SEGMENT_SHAPES`'s `["settings"]` entry removed — `/settings` now has
  real content, so the breadcrumb's "Settings" segment is a real link again
  (`AdminShell.test.tsx`'s corresponding "renders as plain text" test updated to
  assert the opposite, now-correct behavior).
- `apps/web/app/(admin)/mcp-health/page.tsx` — now a `Tabs` split: "Health" (the
  original dashboard, unchanged) and "Alert Configuration" (`ConnectorAlertConfig`,
  relocated here — its real spec home per screen B.3A.4; the standalone page was
  a reactive QA patch, not a deliberate design). Both tabs share the same
  `getModuleAccessLevel("connectors")` gate and resolved level — no new
  permission surface. Initial tab selection reads `?tab=` from Next 15's async
  `searchParams` (uncontrolled `Tabs` otherwise, no client-side URL-sync needed).
- `apps/web/app/(admin)/mcp-health/ConnectorAlertConfig.tsx` (moved from
  `settings/connector-alerts/`) — internals unchanged, doc comment updated to
  reflect the new host/route.
- `apps/web/app/(admin)/settings/connector-alerts/page.tsx` — replaced with
  `redirect("/mcp-health?tab=alerts")` so a bookmarked/old link never 404s.

**"Any of" permission-check question (the dispatch's explicit open question)**:
no existing utility covered a nav item fanning out to several RBAC modules —
`isNavItemVisible` only ever checked one. Added `isAnyNavItemVisible(matrix,
rules[])` to `packages/ui/src/components/RbacNav.tsx` (exported from
`@nextbot/ui`'s `index.ts` alongside `isNavItemVisible`) rather than picking a
single representative module for the collapsed "Settings" entry — the hub's 8
cards are backed by 5 distinct modules (`security_settings`, `escalations`,
`agent_platform`, `users_roles`, `audit_log`); a single-module check would
either hide the entry from a caller who can read only one of the other four, or
(if a permissive module were chosen) show it to a caller who can read none.
"Any of" is the only option matching every destination's own fail-closed gate.

**Verification (real, not assumed):** `pnpm turbo run typecheck` (31/31
workspace packages) green; full repo `pnpm run lint` clean; `dependency-cruiser`
(lint:boundaries) clean (0 violations, 1525 modules/4331 dependencies); full
`pnpm vitest run --project unit` suite green (196 files/1152 tests, no
regressions, no unhandled errors/rejections). New/changed-file coverage at or
above the 80% floor: `AdminShell.tsx`, `settings/page.tsx`, `mcp-health/page.tsx`,
`settings/connector-alerts/page.tsx`, `RbacNav.tsx` all 100% stmts/lines;
`ConnectorAlertConfig.tsx` (no pre-existing test suite at its old location — this
is new coverage, not an update to an existing suite) 100% stmts/lines, 80.48%
branch, 80% funcs. `AdminShell.test.tsx`'s pre-existing 22 tests plus 3 new ones
(collapsed-entry check, any-of visible-on-one-module, any-of hidden-on-none) all
pass; `McpHealthDashboard.test.tsx`'s pre-existing 7 tests pass unmodified
(rendered directly, not through the page, so unaffected by the Tabs wrapper).

**Self-review against the security checklist:** no new endpoint added (a new
page plus a client-side file relocation); both new/changed server components
(`settings/page.tsx`, `mcp-health/page.tsx`) re-derive the caller's
permissions/level server-side from the session rather than trusting any client
input; the connector-alerts redirect target is a hardcoded literal, not
reflected user input.

`current_phase` left as `development` in `docs/NEXUS_STATE.md` — ready for QA,
not marking this phase QA-approved.

## QA-driven fix pass (2026-08-23) — Phases 1, 2, 4 combined re-verification

Responds to the 2026-08-23 QA combined-verification report (Phases 1/2/4 — FAIL
overall, mixed severity). Fixed only the reported items; no re-scoping.

**Item 1 (Phase 1 version-seeding concern) — CONFIRM-ONLY, no code change.**
QA's finding was based on a stale premise (it hadn't seen the concurrently-landed
Phase 1 follow-up dispatch that already extends `scripts/seed.ts` to seed a real
Draft version, bind a real eval suite, run it, and promote all the way to
Production via the actual `promoteAgentVersion` state machine with two distinct
actor ids). Independently re-verified this dispatch, from scratch, against a real
Postgres: stood up `compose.test.yml` fresh (`down -v` / `up -d`), ran
`packages/db`'s real `migrate:test` (31/31 migrations), then ran `pnpm run db:seed`
against it with a real (not mocked-away) OpenAI-compatible HTTP backend
(`@nextbot/testing`'s `startMockOpenAiCompatibleServer`, the same mock class the
product's own integration tests use, run out-of-process purely as this
verification's model backend — never imported by `scripts/seed.ts` itself) and
`AI_PROVIDER=openai-compatible` / `AI_BASE_URL` pointed at it. Seed log showed the
full walk: Draft created (`gitCommitSha: null`, no tenant Git connection) -> eval
suite created/bound -> eval run genuinely `Passed` against the live mock backend ->
EvalGated -> HumanReview -> Approved (by `admin@demo.nextbot.local`, a different
user than the creating `designer@demo.nextbot.local`) -> Production. Queried
`agent_definition_version` directly via `psql` (not trusting the script's own log
output) and confirmed one row: `status = Production`, `created_by_user_id` and
`approved_by_user_id` are two distinct real user ids, `git_commit_sha` is null as
documented. Re-ran the seed a second time against the same database and confirmed
idempotency (every step correctly reports "already exists — skipping"). **No
change needed to `scripts/seed.ts` or any application code — the follow-up
dispatch's fix is genuinely in place and works end-to-end.** Ephemeral test stack
torn down (`down -v`) after verification; the throwaway `SEED_CREDENTIALS.md`
generated by this verification run (test-stack baseUrl/ports) was deleted rather
than left in place, since it's a gitignored generated artifact, not tracked state.

**Item 2 (Model Gateway Select accessibility) — fixed.**
`apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.tsx`: added an
explicit `aria-label` to the Route Key (`"Route Key"`) and Cache Mode
(`"Cache mode"`) `SelectTrigger`s, mirroring `AuditLogViewer.tsx`'s Outcome filter
pattern exactly (same `aria-label` prop directly on `SelectTrigger`, not relying on
the `Label htmlFor`/`id` association alone). Also checked the Provider Chain's own
per-entry Provider `Select` (the same latent pattern QA flagged as worth checking)
and fixed it too for consistency: `aria-label={`Entry ${idx + 1} Provider`}` — each
chain entry's provider dropdown now has its own distinguishable accessible name
rather than relying on its `Label`+`htmlFor` pairing, which axe-core's
`button-name` rule doesn't credit for Base UI's rendered trigger `<button>` any
more than it did for Route Key/Cache Mode.

**Item 3 (sidebar hydration mismatch) — investigated and fixed at the root
cause.** `packages/ui/src/components/ui/sidebar.tsx`'s `SidebarSection` was
already deferring its `localStorage`-read to a post-mount `useEffect` (the
`open`/`defaultOpen` state itself was never the source of the drift — read the
code and confirmed by inspection before touching anything). Reproduced the actual
bug live instead of guessing: ran a real `next dev` process against a real seeded
tenant, used Playwright to do 20 fresh hard-navigation page loads (new browser
context each time, real HTTP GET, not a client-side SPA transition) across
`/dashboard` and `/agent-platform/definitions`, and captured a genuine React
hydration-mismatch console error on ~30% of loads (4/20), with the exact
`aria-controls`/`id` diff QA's report described. Root-caused by reading Base UI's
own vendored `Collapsible` source
(`@base-ui/react`'s `useCollapsibleRoot.js`/`CollapsibleTrigger.js`): the
trigger's `aria-controls` and the panel's `id` are both wired from
`Collapsible.Root`'s own internal `useBaseUiId()` call (a thin wrapper over
React's `useId()`), whose value is a function of this component's *position in
the render tree* on a given render pass — not of anything `SidebarSection` itself
controls. The reproduced drift is independent of `SidebarSection`'s own state,
confirming the underlying nondeterminism sits upstream of (or within) Base UI's
own internals, not in this codebase's already-correct SSR-safe-default pattern.
**Fix:** stopped depending on that request-scoped generated id for this pairing
entirely. `SidebarSection` now derives a plain, deterministic panel id from its
own `label` prop (`sidebar-section-panel-<slugified-label>`) — a value that is
identical on every render, server or client, with zero dependency on hook-call
ordering — and passes it explicitly as `id` on `Collapsible.Panel` and
`aria-controls` on `Collapsible.Trigger` (overriding Base UI's own generated
default, the same override convention already relied on for `aria-label` on
`SelectTrigger` elsewhere in this package, confirmed to work the same way here).
Re-ran the identical 20-fresh-load Playwright repro after the fix: 0/20 hydration
warnings (previously 4/20). Not a suppression — `suppressHydrationWarning` was
not used anywhere; the fix removes the actual class of nondeterminism from the
one DOM attribute pairing that depended on it.

**Item 4 (VersionEditor live axe scan) — clean, no defects found.** Ran a live
axe-core scan (`wcag2a`/`wcag2aa`, matching QA's own scan configuration) against
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx`
in a real browser (Playwright + `axe-core`, loaded against the same real running
`next dev` + seeded-tenant session used for the hydration repro above): **0
violations.** Also live-scanned Model Gateway again post-fix (0 violations, the
previously-critical `button-name` violation is gone) and specifically exercised
the Provider Chain's per-entry Select by clicking "+ Add provider" first (empty
chain by default, so this control doesn't exist on initial page load) — 0
violations there either, and the trigger's computed `aria-label` read back as
`"Entry 1 Provider"` as expected.

**Verification performed for real, not assumed.** Ephemeral `compose.test.yml`
Postgres/Redis/ClickHouse stack, real `migrate:test` (31/31), real `pnpm run
db:seed` against it (see item 1). A real `next dev` process run against that
database, exercised live via Playwright for: 20 fresh-load hydration checks (0
warnings, previously 4/20), 3 live axe-core scans (Model Gateway default state,
Model Gateway with a Provider Chain entry added, VersionEditor) — all 0
violations. `pnpm turbo run typecheck` 31/31 packages green. `pnpm run
lint:boundaries` (`eslint . --max-warnings=0` + `dependency-cruiser`) clean, 0
violations, 1816 modules/4397 dependencies. Targeted re-run of
`ModelGateway.test.tsx` (11 tests), `sidebar.test.tsx` (7 tests),
`AdminShell.test.tsx` (22 tests) — all green, no regressions. Full `pnpm vitest
run --project unit` suite re-run after all changes: 196 files/1152 tests green,
no regressions anywhere in the workspace. Dev/test stack and all spawned
processes (the `next dev` server, the standalone mock-AI verification server, the
ephemeral Docker stack) torn down after verification — nothing left running.

**Files changed:** `apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.tsx`,
`packages/ui/src/components/ui/sidebar.tsx`, `docs/plans/client-feedback-batch-plan.md`.

## QA-driven fix pass, retry 2 (2026-08-23) — shared tooltip.tsx hydration mismatch

Scope: the single blocking finding from the retry-1 re-verification
(`qa-results/client-feedback-batch-phases1-4/20260823-003137/REPORT.md`) — a
reproducible React hydration mismatch on Base UI's `Tooltip.Trigger` internal `id`,
in the shared `packages/ui/src/components/ui/tooltip.tsx` primitive, at 7/20 (35%)
fresh loads on both Model Gateway and VersionEditor. No other scope touched (MCP
Health's tab-URL rough edge and the pre-existing `button.tsx` contrast finding were
both explicitly non-blocking and deliberately left untouched this pass).

**Root cause, investigated against the actual installed `@base-ui/react@1.7.0`
source** (`tooltip/trigger/TooltipTrigger.mjs`): the rendered `<button>`'s DOM `id`
is `thisTriggerId = useBaseUiId(idProp)`, which falls back to an internally
generated id (ultimately React's own `useId()`) whenever the caller doesn't supply
an explicit `id` prop. Initially suspected (by analogy with the already-fixed
`SidebarSection`/`Collapsible` case) to be caused by Base UI's own deep,
conditionally-invoked internal hook chain drifting in hook-call order between
server and client — **this turned out to be a red herring**: a first fix attempt
added a wrapper-local `React.useId()` fallback directly in `tooltip.tsx` (calling
it as the very first, unconditional hook, before any of Base UI's own hooks run),
and live re-repro showed the *exact same* mismatch class, just on our own generated
id instead of Base UI's. Reading the live React hydration diff confirmed the real
cause: both `ModelGateway.tsx` and `VersionEditor.tsx` render `FieldHint` beneath a
conditional `<Skeleton>`/data-loading branch, so the surrounding tree literally has
a different shape between the server render and the client's first (hydration)
render — this shifts *every* `React.useId()`-based id downstream by the same
amount, regardless of which component or how many hook calls deep it's generated.
No `useId()`-based default, ours or Base UI's, can be SSR-stable under that
condition.

**Fix applied — option (a) from the dispatch (caller-supplied explicit id), not
content-derived hashing:** `field-hint.tsx`'s `FieldHint` now takes a **required**
`id` prop, threaded straight through as `TooltipTrigger`'s `id` (which Base UI
already treats as authoritative over its own generated fallback — this needed no
change in `tooltip.tsx`'s trigger logic, since `id` was already part of the plain
prop spread). `FieldHint`'s popup id is now derived from that same caller id
(`` `${id}-content` ``) rather than its own separate `React.useId()`, so both of its
generated DOM ids share one stable footing. Content-hash/content-derived ids were
explicitly rejected: `ModelGateway.tsx`'s Provider Chain entries render several
`FieldHint`s with byte-identical `content` once per chain-entry row (verified by
reading the file — lines 336/370 render the same two hint strings on every loop
iteration), so a content-derived id would collide across rows and silently
misdirect `aria-describedby` to the wrong row's popup. `tooltip.tsx`'s
`TooltipTrigger` itself is otherwise unchanged (kept the plain Base UI passthrough
that already forwarded `id`) — its doc comment now records the investigation above
and the caller-supplied-id contract, so the next caller of this primitive knows why
Base UI's own default isn't SSR-safe on this app's actual pages.

Both callers of `FieldHint` (the only two in the app) were updated to pass a
stable, literal id derived from the same convention their sibling `Label
htmlFor`/`Input id` pair already uses (e.g. `model-gateway-route-key-hint`,
`` `model-gateway-chain-${idx}-provider-hint` ``, `version-editor-version-hint`) —
never from `content`.

The ~9 other pre-existing callers of the shared `Tooltip`/`TooltipTrigger`
(`RolesTable.tsx`, `ToolCatalog.tsx`, etc.) are untouched: they don't pass an `id`
and still fall back to Base UI's own generated one, exactly as before this fix.
They were not reported as exhibiting this defect (QA's repro was specifically on
Model Gateway/VersionEditor) and are out of this fix's scope — Phase 11's own
deferred rollout plan for bringing all tooltip usages onto one consistent pattern
still applies to them, unchanged.

**Verification, live, not assumed.** Ephemeral `compose.test.yml`
Postgres/Redis/ClickHouse stack (fresh up/down -v), real `migrate:test` (31/31), a
standalone out-of-process mock OpenAI-compatible server (deleted after the run,
never committed), real `pnpm run db:seed`, real `next dev` against that database,
Playwright (Chromium) installed ad hoc into a scratch npm project (no permanent
dependency added).

- Baseline repro (before fix), same 20-fresh-hard-navigation-load methodology as
  the original QA report: Model Gateway 10/20, VersionEditor 1/20 (11/40 overall) —
  confirms the defect is real and reproducible in this environment before
  reasoning about a fix.
- First fix attempt (wrapper-local `React.useId()` in `tooltip.tsx`) re-repro:
  still failed (3/3 quick check on Model Gateway) — this is why the fix was
  redirected to the caller-supplied-id approach documented above, rather than
  shipping a fix that only appeared to address the symptom.
- Final fix, re-verified twice with the full 20-load methodology (once against the
  live-reloaded dev server, once against a fully restarted fresh `next dev`
  process to rule out any HMR residue): **0/20 on both Model Gateway and
  VersionEditor**, both runs.
- Spot-checked `/roles` (`RolesTable.tsx`) and `/tools` (`ToolCatalog.tsx`) live —
  both render with zero console errors, confirming the untouched ~9 other tooltip
  call sites still work.
- `pnpm turbo run typecheck`: 31/31 packages green.
- `pnpm run lint:boundaries` (`eslint . --max-warnings=0` + `dependency-cruiser`):
  clean, 0 violations, 1811 modules/4463 dependencies.
- Full `pnpm vitest run --project unit` suite: 196 files/1154 tests green (2 more
  than the prior baseline of 1152 — the 2 new `field-hint.test.tsx` tests added
  this pass), no regressions.
- Coverage on both changed files (`field-hint.tsx`, `tooltip.tsx`): 100%
  line/branch/function/statement.
- Dev/test stack and all spawned processes (the `next dev` server, the standalone
  mock-AI verification server, the ephemeral Docker stack, throwaway `.env.test`/
  `apps/web/.env.local`/`SEED_CREDENTIALS.md`) torn down/deleted after
  verification — nothing left running or committed.

Not attempted this pass (explicitly out of scope per the dispatch): MCP Health's
tab-switch-doesn't-update-URL rough edge (Phase 3) and `button.tsx`'s pre-existing
hover-contrast finding — both left untouched, as instructed.

**Files changed:** `packages/ui/src/components/ui/tooltip.tsx`,
`packages/ui/src/components/ui/field-hint.tsx`,
`packages/ui/src/components/ui/field-hint.test.tsx`,
`apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.tsx`,
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx`,
`docs/plans/client-feedback-batch-plan.md`.

This work is ready for QA re-verification, not self-certified as QA-approved.
No code change to `scripts/seed.ts` (item 1 — confirm-only).

`current_phase` left as `development` — **ready for QA re-verification, not
marking this fix pass QA-approved myself.**

## Proactive audit pass (2026-08-23) — hydration-mismatch bug class, workspace-wide

Scope: a proactive, not QA-driven, audit of every `packages/ui/src/components/ui/*.tsx`
primitive for the same recurring defect class already fixed twice in this batch
(`sidebar.tsx`'s `SidebarSection`, `tooltip.tsx`/`field-hint.tsx`'s `FieldHint`) — a
Base UI component's own internally-generated `useId()`-derived id, used for a
caller-visible DOM attribute (`id`, `aria-controls`, `aria-labelledby`,
`aria-describedby`), drifting between the server render and the client's first
(hydration) render whenever a data-loading `<Skeleton>` conditional sits anywhere in
the same component tree.

**Audit method.** Read every file under `packages/ui/src/components/ui/*.tsx` (30
files) and grepped each for `aria-controls|aria-describedby|aria-labelledby|htmlFor|
id=|Trigger|Content|Panel|Popup`. For every file built on a Base UI primitive
(`alert-dialog.tsx`, `avatar.tsx`, `badge.tsx`, `breadcrumb.tsx`, `button.tsx`,
`checkbox.tsx`, `collapsible.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `field-hint.tsx`
[already fixed, untouched], `input.tsx`, `progress.tsx`, `radio-group.tsx`,
`select.tsx`, `separator.tsx`, `sidebar.tsx` [already fixed, untouched], `switch.tsx`,
`tabs.tsx`, `toast.tsx`, `tooltip.tsx` [already fixed, untouched]), read the actual
installed `@base-ui/react@1.7.0` source for the wrapped primitive's id-generation path
(`useBaseUiId`/`useLabelableId`, both thin wrappers over React's own `useId()`) to
determine whether it (a) generates its own id internally for a caller-visible
attribute, and (b) already accepts/forwards an explicit caller-supplied `id` override.
Found six primitives sharing the same `useBaseUiId(idProp)`-with-passthrough shape:
`Tabs.Tab`/`Tabs.Panel` (tabs.tsx), `Menu.Trigger` (dropdown-menu.tsx),
`Select.Root`'s `useLabelableId` (select.tsx, flows into `SelectTrigger`/`SelectLabel`
pairing), `Dialog.Trigger`/`AlertDialog.Trigger` (dialog.tsx/alert-dialog.tsx),
`Collapsible.Root`'s `useBaseUiId()` (collapsible.tsx, the same root cause already
fixed once for `sidebar.tsx`'s own internal usage but never generalized to the raw
export), and `Field.Control`'s `useLabelableId` (input.tsx — every plain text
`<Input>` in the app). All six *structurally* qualify under criteria (a)+(b).
`avatar.tsx`/`badge.tsx`/`breadcrumb.tsx`/`button.tsx`/`checkbox.tsx`/`progress.tsx`/
`radio-group.tsx`/`separator.tsx`/`switch.tsx`/`toast.tsx` do not wrap any Base UI
component with this id-generation shape (either no Base UI primitive at all, or a
primitive with no internally-generated caller-visible id) — audited and cleared.

**Live verification, not assumed.** Structural similarity alone doesn't prove a live
bug (this batch's own tooltip.tsx fix already established that ~9 pre-existing,
structurally-identical `Tooltip` callers were never actually exhibiting the defect).
Stood up the full established methodology fresh for this pass: `compose.test.yml`
(`down -v` / `up -d`), `packages/db`'s real `migrate:test` (31/31), a standalone
out-of-process mock OpenAI-compatible server (`@nextbot/testing`'s
`startMockOpenAiCompatibleServer`, deleted after the run), a real `pnpm run db:seed`
against it, a real `next dev` process, and a from-scratch Playwright (Chromium)
install into a scratch npm project (no permanent dependency added) driving 20+
fresh-hard-navigation-load repros (new browser context per load, real HTTP GET,
watching the console for the exact hydration-mismatch warning class) per candidate
page. For each of the six structurally-qualifying primitives, found and exercised a
real caller sitting downstream of (or before, in one case — see item 3) a
`<Skeleton>`/data-loading conditional in the same component tree:

1. **`tabs.tsx`'s `TabsTrigger`/`TabsContent` — CONFIRMED, fixed.** Reproduced live on
   `/mcp-health` (`McpHealthDashboard`'s conditional `<Skeleton>` branches nested
   inside `Tabs.Content`) at 8/20 (40%) fresh-load repro rate before any fix (higher
   than QA's originally-reported 3/20 — resampling noise, same defect). Root cause:
   `Tabs.Tab`'s `id = useBaseUiId(idProp)` (`tabs/tab/TabsTab.mjs`) and `Tabs.Panel`'s
   `id = useBaseUiId()` (`tabs/panel/TabsPanel.mjs`, no `idProp` in the hook call
   itself, but its rendered `id` still resolves through `useRenderElement`'s prop
   merge, where an explicitly-passed `id` in the trailing `elementProps` object
   overrides the internally-generated one — confirmed by reading
   `internals/useRenderElement.mjs`/`merge-props/mergeProps.mjs`'s rightmost-wins
   semantics). **Fix:** `TabsTrigger`/`TabsContent` now take a **required**
   caller-supplied `id` (matching `FieldHint`'s established required-id contract, not
   optional-with-fallback — `Tabs` is a general-purpose primitive with no way to know
   whether a given call site nests a loading branch). All 4 real callers
   (`apps/web/app/(admin)/mcp-health/page.tsx`, `RolesList.tsx`,
   `WhatsAppChannelConfig.tsx`, `VersionDetail.tsx`) updated to pass explicit,
   page-scoped ids (e.g. `mcp-health-tab-health`/`mcp-health-panel-health`) — found via
   a full-repo grep for `TabsTrigger|TabsContent`, not from memory.
   Re-verified against a fully restarted (not HMR'd) fresh `next dev` process: **0/20**
   on `/mcp-health`, and 0/20 each on the other 3 real callers (`/roles`,
   `/agent-platform/versions/<id>` [this page's own Eval tab also nests a `<Skeleton>`
   for eval runs, an independent second exposure of the same tab-pairing defect]) —
   `WhatsAppChannelConfig` has no seeded channel data to load live but is fixed
   identically and typechecks/tests clean.

2. **`select.tsx`'s `SelectTrigger`/`Select` — investigated, not the actual root
   cause of what looked like a Select defect (see item 3), but hardened anyway where
   proven live.** `Select.Root`'s `generatedId = useBaseUiId(id)`
   (`select/root/SelectRoot.mjs`'s `useLabelableId`) flows into `SelectTrigger`'s own
   `id` fallback and its `Label` pairing. Confirmed the underlying mechanism is real by
   reading Base UI's source, but did not independently reproduce a Select-specific
   mismatch in isolation on any of `/tools`, `/agent-platform/definitions`,
   `/conversations` (all Input+Skeleton-adjacent pages, all 0/20 baseline over 20
   loads each) — Select's own id fallback is not, on the evidence gathered, an
   independently-live defect on this app's actual pages. Left the primitive itself
   unchanged (it already forwards a caller-supplied `id`, no code change needed) and
   added an explicit `id` only on `/audit-log`'s Outcome `SelectTrigger` alongside item
   3's fix, defensively, since both were investigated together on the same page.

3. **`input.tsx`'s `Input` (wrapping Base UI's `Field.Control`) — CONFIRMED, fixed on
   its one proven-affected caller.** This is the actual root cause of `/audit-log`'s
   9/20 (45%) fresh-load hydration mismatch (initially suspected to be the Outcome
   `Select` per item 2, until the live hydration diff was read in full and pointed at
   the four plain `<Input>` filter fields instead — `id="base-ui-_R_...b_"` mismatches
   on their rendered `<input>` elements). Root cause: `Field.Control`'s
   `id = useLabelableId({ id: idProp })` (`field/control/FieldControl.mjs`) — the same
   `useLabelableId` helper `select.tsx` uses. `AuditLogViewer.tsx`'s
   `entries === null ? <Skeleton> : <Table>` branch sits *after* these four inputs in
   JSX source order, yet still shifted their ids — confirms (as already documented in
   `tooltip.tsx`) that the drift isn't scoped to strictly-downstream elements; it
   shifts every `useId()`-based id on the page. **Fix:** added explicit, stable ids to
   `AuditLogViewer.tsx`'s four filter `Input`s (`audit-log-filter-search`/`-actor`/
   `-action-type`/`-target-type`) — `input.tsx` itself needed no change (already
   forwards a caller-supplied `id`, same as `select.tsx`/`tooltip.tsx`). **Deliberately
   not applied project-wide**: `input.tsx` is the single most widely-used primitive in
   this codebase (dozens of call sites); forcing a required `id` prop across every one
   of them on the strength of one proven caller would be a disproportionate ripple with
   no supporting evidence for the others — checked 3 other real `Input`+`<Skeleton>`
   pages (`/tools`, `/agent-platform/definitions`, `/conversations`) and got 0/20 on
   all three, confirming this is not a blanket defect on every such page. Re-verified
   `/audit-log` against a fully restarted fresh `next dev` process: **0/20** (down from
   9/20).

4. **`dropdown-menu.tsx`'s `DropdownMenuTrigger` — audited, not reproduced, left
   unchanged.** `Menu.Trigger`'s `id = useBaseUiId(idProp)` (`menu/trigger/
   MenuTrigger.mjs`) structurally qualifies. Its one real caller sitting near a
   `<Skeleton>` in the same tree, `DefinitionDetail.tsx`'s "Promote to…" menu
   (rendered inside `VersionRow`, itself only rendered once `versions` resolves,
   downstream of the page's own `name ?? <Skeleton>` header conditional), was tested
   at 0/40 fresh loads (40, not 20 — doubled the sample specifically because this was
   the least clear-cut structural match). Not fixed: no live evidence of the defect on
   its only real call site.

5. **`collapsible.tsx`'s raw `CollapsibleTrigger`/`CollapsibleContent` export —
   audited, not reproduced live (no seed data to reach the one candidate page), scope
   noted for follow-up.** `Collapsible.Root`'s `defaultPanelId = useBaseUiId()`
   (`collapsible/root/useCollapsibleRoot.js`) is the *exact* root cause already fixed
   once in this same file's `sidebar.tsx`-internal usage (`SidebarSection`), but that
   fix was never generalized to the raw `Collapsible`/`CollapsibleTrigger`/
   `CollapsibleContent` export — its two other real callers
   (`ChannelsList.tsx`, `ConversationDetail.tsx`) both render a `Collapsible` without
   any explicit id override, and `ConversationDetail.tsx` specifically has an early
   `if (!conversation) return <Skeleton>` guard upstream of three separate
   `Collapsible` blocks in the same tree — the same tree-shape-differs-between-SSR-
   and-hydration shape already proven to cause this defect twice elsewhere in this
   pass. Could not reproduce live this pass: `scripts/seed.ts` seeds no conversations
   (`ConversationDetail.tsx` requires a real conversation id to render past its own
   loading guard), and `ChannelsList.tsx` — the one live-reachable caller — tested
   0/20. **Left unfixed, not because the risk is disproven, but because it could not
   be verified live within this pass's scope** (fixing without a live repro would be
   exactly the "fixing on suspicion alone" this pass's own item 2/4 findings argue
   against). Flagged here explicitly rather than silently dropped: `ConversationDetail.tsx`'s
   three `Collapsible` usages are the standout structural risk in this codebase given
   they're the closest analog to `SidebarSection`'s already-confirmed defect, and
   should be the first thing re-checked once conversation seed data exists.

6. **`dialog.tsx`'s `DialogTrigger`/`alert-dialog.tsx`'s `AlertDialogTrigger` —
   audited, structurally does not qualify as live-reproducible by this defect's own
   mechanism.** Both have the same `id = useBaseUiId(idProp)` shape as every other
   primitive above, but their `Popup`/`Title`/`Description` content — where a
   `useId()`-based id could actually drift — never appears in the server-rendered
   HTML at all (a dialog starts closed; its content only mounts client-side, after
   hydration is already complete, in response to a user click). Grepped every real
   `DialogTrigger`/`AlertDialogTrigger` caller against every file using `<Skeleton>`
   in the same file — zero overlap found anywhere in `apps/web`. Not fixed, no live
   candidate to even attempt reproduction against; documented so a future call site
   that nests a `Dialog` beneath a loading branch knows this defect class applies here
   too if that assumption ever changes.

**Full verification, workspace-wide (not per-primitive only).**
- `pnpm turbo run typecheck`: 31/31 packages green (this alone would have caught any
  missed `TabsTrigger`/`TabsContent` caller, since `id` is now a required prop on
  both — confirms the 4-caller list above is complete).
- `pnpm run lint:boundaries` (`eslint . --max-warnings=0` + `dependency-cruiser`):
  clean, 0 violations, 1795 modules/4425 dependencies.
- Full `pnpm vitest run --project unit` suite: 196 files/1154 tests green, no
  regressions (unchanged from the prior baseline — this pass rewires existing
  id-forwarding, it doesn't add new business logic branches needing new tests).
- Coverage on `tabs.tsx` (scoped run against `RolesList.test.tsx`/`mcp-health/
  page.test.tsx`/`VersionDetail.test.tsx`/`WhatsAppChannelConfig.test.tsx`, its four
  real exercising test files): 100% line/branch/function/statement — already fully
  exercised by existing tests, no new tests needed for a pure prop-forwarding change.
  `AuditLogViewer.test.tsx` (5 tests) re-run clean against the `input.tsx`-site fix.
- `/mcp-health` specifically, the page that surfaced this pattern's 3rd occurrence,
  re-confirmed clean at 20/20 fresh loads (0 mismatches) against a fully restarted
  (non-HMR) `next dev` process, as its own final check independent of the item-1
  verification above.
- Functional spot-check (not exhaustive, but real, via Playwright): `/mcp-health`'s
  tabs — initial `aria-selected`, click-to-switch, `aria-labelledby` panel/trigger
  pairing, and `ArrowRight` roving-focus keyboard nav all verified working correctly
  post-fix. `/audit-log`'s filters — text input still accepts/reflects typed values,
  Outcome `Select` still opens/lists/selects correctly post-fix.
- Dev/test stack and all spawned processes (the `next dev` server, the standalone
  mock-AI server, the ephemeral Docker stack, throwaway `.env.test`/
  `apps/web/.env.local`/`SEED_CREDENTIALS.md`/scratch Playwright project) torn
  down/deleted after verification — nothing left running or committed.

**Audit conclusion: `tabs.tsx` was NOT the only affected primitive.** Two primitives
confirmed live-affected and fixed this pass (`tabs.tsx`, and `input.tsx` on its one
proven caller); four more structurally similar primitives audited with real attempted
repro and NOT fixed, for the specific reasons recorded per-item above (no live
evidence, in three cases; unreachable-without-new-seed-data in one case, flagged for
follow-up rather than silently dropped).

**Files changed:** `packages/ui/src/components/ui/tabs.tsx`,
`apps/web/app/(admin)/mcp-health/page.tsx`, `apps/web/app/(admin)/roles/RolesList.tsx`,
`apps/web/app/(admin)/channels/[channelId]/whatsapp/WhatsAppChannelConfig.tsx`,
`apps/web/app/(admin)/agent-platform/versions/[versionId]/VersionDetail.tsx`,
`apps/web/app/(admin)/audit-log/AuditLogViewer.tsx`, `docs/plans/client-feedback-batch-plan.md`.

This work is ready for QA re-verification, not self-certified as QA-approved — given
this bug class's history (found independently 3 times across 3 prior QA rounds), QA
should treat item 5 (`ConversationDetail.tsx`'s `Collapsible` usages) as the top
follow-up candidate once conversation seed data exists, rather than this pass's
"not reproduced" being read as "cleared."

## QA fix pass — hydration-bug-class audit, final remaining defect (aria-controls)

QA (client-feedback-batch, 2026-08-23) confirmed the broad hydration-bug-class audit
above closed, with exactly one narrow defect remaining: `tabs.tsx`'s `id`-override fix
(the entry directly above) resolved the hydration mismatch but broke the
`aria-controls` relationship — axe-core `aria-valid-attr-value` CRITICAL on
`/mcp-health` and `/roles`, because `Tabs.Tab`'s rendered `aria-controls` still came
from Base UI's own internal panel-id registry (populated with the panel's
*internally-generated* id, before our `id` override applies), not the caller-supplied
panel id `TabsContent` actually renders with.

**Root cause** (confirmed by reading the installed `@base-ui/react@1.7.0` source):
`tabs/tab/TabsTab.mjs` sets `'aria-controls': getTabPanelIdByValue(value)` from that
internal registry, several entries before `elementProps` (our own JSX props) are
merged in via `useRenderElement`'s rightmost-wins `mergeProps` — exactly the same
merge point already used to override `id` on `TabsPanel`. `aria-labelledby` (the panel
reading the tab's id back) was unaffected because that direction is computed
independently and already resolves through our `id` override.

**Fix**: `TabsTrigger` now takes a second required prop, `panelId` — the same string
passed as the corresponding `TabsContent`'s `id` — and explicitly passes
`aria-controls={panelId}` to `TabsPrimitive.Tab`, overriding the internal value via
the same merge-order technique. `Omit<..., "id" | "aria-controls">` on the prop type
prevents a caller from independently supplying a conflicting `aria-controls`. Not
derived from `id`/`value` by string transform (e.g. this package's own incidental
`-tab-`/`-panel-` naming convention) because that convention isn't structurally
guaranteed for every future caller — an explicit, required, already-known-by-the-
caller value is correct rather than clever-but-fragile. All 4 real callers
(`mcp-health/page.tsx`, `RolesList.tsx`, `WhatsAppChannelConfig.tsx`,
`VersionDetail.tsx`) updated to pass `panelId` (their existing `-panel-` id, unchanged
in each caller). `AuditLogViewer.tsx` only references `tabs.tsx` in doc comments — no
`TabsTrigger` usage there, so no change needed.

**Verification** (ephemeral `compose.test.yml` Postgres/Redis stack, real migrations,
real `db:seed`, real `next dev` on a throwaway `apps/web/.env.local`, Playwright +
axe-core installed ad hoc into a scratch npm project — same methodology as prior QA
rounds, all torn down/deleted after):
- **Repro-first, confirmed**: temporarily reverted the `aria-controls={panelId}` line
  and re-scanned — axe-core reproduced the exact CRITICAL `aria-valid-attr-value`
  violation on both `/mcp-health` (`aria-controls="base-ui-_R_klritul5rlb_"`, no
  matching DOM id) and `/roles` (`aria-controls="base-ui-_r_3_"`), confirming this
  scan setup genuinely detects the reported defect before claiming the fix resolves
  it. Fix restored immediately after.
- **After fix**: axe-core (`wcag2a`/`wcag2aa`) on both pages — 0 violations. Live DOM
  read (not just "no violation"): the active tab's `aria-controls` resolves to an
  actually-rendered panel element whose own `id` matches exactly
  (`mcp-health-tab-health` -> `aria-controls="mcp-health-panel-health"` -> panel
  `id="mcp-health-panel-health"`; same pattern confirmed on `/roles`).
- **`aria-labelledby` direction unchanged**: panel's `aria-labelledby` still equals
  the active tab's own `id` on both pages — confirmed unaffected by this fix.
- **Hydration-mismatch regression check** (the part that must not regress): repeated
  the dev's own 20-fresh-hard-navigation-load methodology against `/mcp-health` —
  0/20 mismatches.
- **Keyboard/click**: click-to-switch (`aria-selected` flips correctly) and
  `ArrowRight` roving focus (moves to and correctly focuses the next tab, whose
  `aria-controls` is likewise correct) both confirmed on `/mcp-health` and `/roles`.
- `pnpm turbo run typecheck` — 31/31 tasks green (catches every `TabsTrigger` caller;
  none missed).
- `pnpm run lint` and `pnpm run lint:boundaries` — both clean (0 warnings/errors,
  dependency-cruiser 0 violations).
- Full unit suite (`pnpm run test:unit`): 197 files / 1158 tests, all green (no
  regressions in the 4 real-caller test files or elsewhere).
- New `packages/ui/src/components/ui/tabs.test.tsx` added (this primitive had no
  dedicated unit test before): covers `aria-controls` pointing at the actually-
  rendered panel id, `aria-labelledby` unchanged, click-to-switch, and
  `ArrowRight` roving focus. 100% line/branch/function coverage on `tabs.tsx`
  (scoped `--coverage` run).
- Security review: no new HTTP endpoint, auth boundary, or data access introduced —
  a client-only ARIA-attribute fix in a shared UI primitive. N/A.
- All ephemeral infra (Postgres/Redis containers, `next dev`, scratch Playwright
  project, `apps/web/.env.local`, `.env.test`, `SEED_CREDENTIALS.md`) torn
  down/deleted after verification.

**Files changed:** `packages/ui/src/components/ui/tabs.tsx`,
`packages/ui/src/components/ui/tabs.test.tsx` (new),
`apps/web/app/(admin)/mcp-health/page.tsx`, `apps/web/app/(admin)/roles/RolesList.tsx`,
`apps/web/app/(admin)/channels/[channelId]/whatsapp/WhatsAppChannelConfig.tsx`,
`apps/web/app/(admin)/agent-platform/versions/[versionId]/VersionDetail.tsx`,
`docs/plans/client-feedback-batch-plan.md`.

Ready for QA re-verification, not self-certified as QA-approved.

`current_phase` left as `development`.

## Phase 6 — implementation notes (2026-08-23, SECURITY-RELEVANT — flag to QA immediately, do not batch)

**Investigated before writing code, per this phase's own explicit instruction.**
Read `apps/widget-embed/src/widget/{WidgetApp.tsx, api.ts, store.ts}`,
`apps/widget-embed/src/loader/nextbot-loader.ts`, the actual current routing shape
under `apps/web/app/(admin)/agent-platform/**` and `apps/web/app/(admin)/channels/**`
(post-Phase-5: `versions/[versionId]/VersionDetail.tsx` already exists as its own
route — the dispatch's `DefinitionDetail.tsx`/`VersionDetail.tsx` framing was
accurate; `channels/[channelId]/whatsapp/**` — not `[id]`, the codebase's actual
param name — was the existing convention to match for the new `test/` route), and
the real widget session-issuance chain: `apps/gateway/app/api/v1/widget/sessions/route.ts`
-> `@nextbot/conversations`'s `handleCreateWidgetSession`/`createWidgetSession`. This
is genuinely anonymous/pre-auth (LLD §5.3) and `conversations` has **no allowed
dependency on `@nextbot/iam`** (`eslint.config.mjs`'s `MODULE_ALLOW_LIST`:
`conversations: ["tenancy", "channels"]`) — so the admin-authorization check for the
sandbox-preview override cannot live inside that module at all; it has to live at the
composition root that's allowed to import both, which is `apps/gateway` itself (the
same "apps are the composition root for cross-cutting concerns" seam
`api-guard.ts`/`turn-pipeline-adapter.ts` already establish elsewhere in this
codebase).

**Delivered:**
- `packages/contracts/src/conversations.ts` — `CreateWidgetSessionRequestSchema`
  gains optional `previewVersionId`/`previewToken`; new `SandboxPreviewInvalidError`
  (403, one message for every failure mode — never distinguishes *why* a guess
  failed).
- `packages/modules/iam/src/application/sandbox-preview-token.ts` (new) —
  `issueSandboxPreviewToken`/`verifySandboxPreviewToken`, following the exact
  `SignJWT`/`jwtVerify` + `purpose`-claim pattern the pre-existing
  `mfa-challenge-token.ts` established (same `NEXTBOT_SESSION_SECRET`, 15-minute TTL,
  claims `{ tenantId, userId, versionId }`). Exported from `@nextbot/iam`'s
  `index.ts`.
- `apps/web/app/api/v1/admin/agent-platform/versions/[id]/sandbox-preview-token/route.ts`
  (new) — `POST`, `requireApi("agent_platform", "Write")` re-derives the caller's real
  session server-side; `handleGetVersion` (RLS-scoped) confirms the version belongs to
  the caller's own tenant before a token naming it is ever minted.
- `apps/gateway/app/api/v1/widget/sessions/route.ts` — the actual security gate: a
  request with `previewVersionId` but no `previewToken` is rejected outright (403,
  before `handleCreateWidgetSession` is even called); a present `previewToken` is
  verified via `@nextbot/iam`'s `verifySandboxPreviewToken`, and the resulting claims'
  `versionId` must match the request's `previewVersionId` exactly — any mismatch,
  expiry, tamper, or wrong-purpose token collapses to the same 403. Only on success is
  a `{ tenantId, versionId }` pair passed down as `handleCreateWidgetSession`'s new,
  explicit 2nd parameter (never derived from the request body itself once inside the
  module).
- `packages/modules/conversations`: `create-widget-session.ts` re-checks the passed-in
  `verifiedPreview` against `input.previewVersionId`/the resolved tenant as defense in
  depth (module-level fail-closed even if a future direct caller forgets to gate it);
  on genuine authorization, forces the session's `environment` to `"Sandbox"`
  regardless of the borrowed WebWidget channel's own configured environment, skips
  resume-token load/save entirely (every preview mount/"reload session" click is a
  deliberate fresh conversation), and records the version id onto
  `conversation.agent_definition_version_id` — a column that has existed since Phase
  10 (BL-07) but had no writer until now. `widget-session-token.ts`'s
  `WidgetSessionClaims` gains `previewVersionId`, threaded through so
  `send-widget-message.ts`'s `generateAiReply` deps signature (and
  `apps/gateway/src/lib/turn-pipeline-adapter.ts`'s real implementation) can trace the
  resulting `agent_run` against the exact version under test — taking priority over
  the adapter's usual "tenant's live Production version" lookup — directly the seam
  Phase 7's `recordSandboxTest(ctx, versionId)` hook needs.
- `apps/widget-embed`: `types.ts`/`store.ts` thread `previewVersionId`/`previewToken`
  through `bootstrap()`; `nextbot-loader.ts`'s `NextBotInitConfig` gains the same two
  fields at the type level (pure passthrough, no enforcement here — a real customer
  embed snippet never sets them).
- `apps/web/src/components/ChatPreviewPanel.tsx` (new) — thin `<iframe>` onto the
  real, already-built widget SPA (`{widgetBaseUrl}/widget/index.html`), with a
  persistent `WARNING_BADGE_CLASS`-styled "Sandbox preview" badge (this codebase's own
  pre-verified WCAG-AA-passing amber pairing, not a fresh ad hoc color) and a "Reload
  session" button that remounts the iframe under a fresh key (and, for a
  version-preview mount, fetches a brand-new preview token first).
- Mount points: a new "Sandbox" tab on
  `agent-platform/versions/[versionId]/VersionDetail.tsx` (auto-discovers the
  tenant's first WebWidget channel via the existing `GET /api/v1/admin/channels` list
  endpoint purely as a capability/branding vehicle — an honest "add one first" message
  when the tenant has none, rather than a broken preview); new
  `apps/web/app/(admin)/channels/[channelId]/test/{page.tsx,ChannelTest.tsx}` plus a
  "Test this channel" link on `ChannelsList.tsx`'s WebWidget rows (no override at
  all — the channel's real, currently-deployed Production version, i.e. exactly what
  a live customer sees).

**Local, reversible decisions made and noted, per §3** (none changed behavior/
structure enough to warrant stopping): (a) `channels/[channelId]/test/` route param
name follows the codebase's existing `[channelId]` convention (`whatsapp/**`), not the
dispatch prompt's literal `[id]`; (b) the Sandbox tab needs *some* WebWidget channel to
bootstrap a session against since an `agent_definition_version` isn't itself tied to a
channel — picks the tenant's first one, any environment, as a vehicle only (the
override forces the session's actual environment to `"Sandbox"` regardless); (c)
`ChatPreviewPanel` iframes the widget SPA's URL directly rather than routing through
`NextBot.init()`/the outer loader script — still literally "the real
`apps/widget-embed` bundle" (the identical static artifact a real customer's own
iframe ultimately loads), and the loader's own job (host-page mounting, launcher
resize/position) has no purpose inside an admin-console-hosted fixed panel; the
loader's type-level `previewVersionId`/`previewToken` support is kept for a possible
future loader-hosted preview mode, not required for this phase's own two mount
points.

**Flagged, not silently worked around — a real, pre-existing architectural gap
discovered while implementing this, distinct from this phase's own scope:** no code
anywhere in this codebase yet parameterizes the turn pipeline's actual
goal-selection/instructions/guardrails by a *specific* `agent_definition_version`'s
artifact content. `apps/gateway/src/lib/turn-pipeline-adapter.ts`'s own pre-existing
doc comment (written in an earlier phase) already states this plainly: "wiring real
deployed-version resolution into every live conversation turn remains BL-13's job."
So today, a sandbox preview of an unpromoted Draft version is correctly **isolated**
(Sandbox environment, no resume, never touches the real channel's Production
conversation history) and correctly **traced** against that exact version's id (a
real, new capability this phase adds — `agent_run.agent_definition_version_id` now
reflects the version actually being tested, not just whatever is deployed to
Production), but the AI's actual replies are **not yet driven by that version's own
Instructions/Guardrails content** — every conversation, preview or not, currently runs
the identical turn-pipeline logic regardless of which version is "selected." This is a
pre-existing gap, not introduced or masked by this phase; BL-13 is the correct place
to close it. This phase's security boundary — who can request the override at all,
and what happens once granted — is fully real, independently verified, and unaffected
by this gap.

**Security review (self-review; explicitly the one place this item touches real auth
and real information-disclosure risk, per the dispatch's own framing):**
1. `apps/gateway`'s session route rejects a `previewVersionId` with no `previewToken`
   outright (403), never a silent fallback to an ordinary anonymous session — verified
   with a real anonymous HTTP request, not by reading the code.
2. A garbage/tampered token, a token for the wrong version, and a token for the wrong
   tenant are each independently rejected (403) — four structurally distinct real
   HTTP tests, not one happy-path test standing in for all of them.
3. `createWidgetSession` itself refuses to honor `previewVersionId` even when called
   directly with no `verifiedPreview` argument at all (module-level defense in depth,
   proven by a real-Postgres integration test that never goes through the gateway
   route).
4. The token-issuance route re-derives the caller's session/permission server-side
   (`requireApi`) and re-confirms version ownership via RLS (`handleGetVersion`) —
   never trusts anything the client asserts about its own identity or the version's
   tenant.
5. No secret in code — the new token shares the existing `NEXTBOT_SESSION_SECRET` env
   var, the same convention every other `@nextbot/iam` token already uses.
6. API responses return only `previewToken`/`versionId`/`expiresInSeconds` — no
   version content, no other tenant's data.

**Verification, real, not assumed:**
- `pnpm turbo run typecheck` — 31/31 workspace packages green.
- `pnpm run lint:boundaries` (`eslint . --max-warnings=0` + dependency-cruiser) —
  clean, 0 violations, 1601 modules/4411 dependencies.
- Full `pnpm vitest run --project unit` suite: 202 files/1190 tests green. Found and
  fixed one real regression this phase caused during verification (not discovered by
  QA): `packages/modules/conversations/src/http/widget-routes.test.ts`'s pre-existing
  `handleCreateWidgetSession` delegation assertion needed updating for the new
  always-forwarded `verifiedPreview` 2nd parameter.
- Real ephemeral `compose.test.yml` Postgres/Redis/ClickHouse stack (`up`, real
  `migrate:test` — 31/31 migrations, torn down + throwaway `.env.test` deleted after):
  - `create-widget-session.int.test.ts` — 11 tests (6 pre-existing + 5 new: rejects
    with no `verifiedPreview`, rejects on version-id mismatch, rejects on tenant-id
    mismatch, accepts and produces a real `Sandbox`-environment session with the
    version id in its claims, never resumes even when a `resumeSessionToken` is also
    supplied).
  - New `apps/gateway/app/api/v1/widget/sandbox-preview.int.test.ts` — 6 tests that
    **actually construct** anonymous/malformed/mismatched/cross-tenant HTTP requests
    against the real route and assert real 403s, plus the genuine ACCEPTED round trip
    (real 201, real Sandbox-environment session, real conversation row) and
    confirmation an ordinary no-override request is entirely unaffected — this is the
    dispatch's own explicitly-required "actually construct this request and confirm
    the rejection" check, not a read-the-code-and-assume.
  - Full `packages/modules/conversations` + `apps/gateway` + `packages/modules/iam`
    integration suites re-run together: 102 tests, 12 apparent failures traced to
    pre-existing shared-Redis rate-limiter cross-file contention under parallel
    workers (reproduced the same failures nondeterministically, then confirmed
    102/102 green with `--poolOptions.threads.singleThread`, isolating the true cause
    from a genuine regression before concluding it wasn't one).
- Widget unit tests: both the accepted-with-valid-token and
  rejected-without-session-proof cases, plus the never-resumes/never-persists-a-token
  case, in `apps/widget-embed/src/widget/store.test.ts` — real, distinct test cases,
  not one happy path standing in for both.
- Coverage on files this dispatch added/changed, all at or above the 80% floor:
  `sandbox-preview-token.ts` 100%, `ChatPreviewPanel.tsx` 100%/96.66% branch,
  `VersionDetail.tsx` 92.27%/82.19% branch, `widget-routes.ts` 100%, `store.ts`
  97.95%, `channels/[channelId]/route.ts` 88.23%,
  `versions/[id]/sandbox-preview-token/route.ts` 100%,
  `versions/[id]/sandbox-preview-token/route.ts` test suite (4 tests) covers the
  401/403/404 guard paths explicitly, `conversation-repository.ts` 97.87% (measured
  against the integration-project subset directly exercising it).

**Files changed/added:** `packages/contracts/src/conversations.ts`,
`packages/contracts/src/errors-coverage.test.ts`,
`packages/modules/iam/src/application/sandbox-preview-token.ts` (new),
`packages/modules/iam/src/application/sandbox-preview-token.test.ts` (new),
`packages/modules/iam/src/index.ts`,
`packages/modules/conversations/src/application/create-widget-session.ts`,
`packages/modules/conversations/src/application/create-widget-session.int.test.ts`,
`packages/modules/conversations/src/application/widget-session-token.ts`,
`packages/modules/conversations/src/application/send-widget-message.ts`,
`packages/modules/conversations/src/infrastructure/conversation-repository.ts`,
`packages/modules/conversations/src/http/widget-routes.ts`,
`packages/modules/conversations/src/http/widget-routes.test.ts`,
`packages/modules/conversations/src/index.ts`,
`apps/gateway/app/api/v1/widget/sessions/route.ts`,
`apps/gateway/app/api/v1/widget/sandbox-preview.int.test.ts` (new),
`apps/gateway/src/lib/turn-pipeline-adapter.ts`,
`apps/widget-embed/src/widget/types.ts`, `apps/widget-embed/src/widget/store.ts`,
`apps/widget-embed/src/widget/store.test.ts`,
`apps/widget-embed/src/loader/nextbot-loader.ts`,
`apps/web/src/components/ChatPreviewPanel.tsx` (new),
`apps/web/src/components/ChatPreviewPanel.test.tsx` (new),
`apps/web/app/api/v1/admin/agent-platform/versions/[id]/sandbox-preview-token/route.ts`
(new, + `.test.ts`), `apps/web/app/api/v1/admin/channels/[channelId]/route.ts` (new,
+ `.test.ts`),
`apps/web/app/(admin)/agent-platform/versions/[versionId]/VersionDetail.tsx` (+
`.test.tsx`), `apps/web/app/(admin)/channels/ChannelsList.tsx` (+ `.test.tsx`),
`apps/web/app/(admin)/channels/[channelId]/test/{page.tsx,ChannelTest.tsx}` (new, +
`.test.tsx`), `docs/plans/client-feedback-batch-plan.md`.

`current_phase` left as `development` — **ready for QA, flagging this phase as
security-relevant (new anonymous-endpoint auth boundary + information-disclosure
risk) for immediate QA per this project's own rules, not marking it QA-approved
myself.**

## Phase 7 — implementation notes (2026-08-23)

**Investigated before writing code, per this phase's own explicit instruction.**
Read `DefinitionDetail.tsx`, `VersionDetail.tsx` (Phase 6's Sandbox tab),
`promotion-policy.ts`, `promote-version-service.ts`, and the `agent_definition_version`
schema in full first. The load-bearing question this phase's dispatch itself raised
— "what concretely counts as a real completed sandbox turn?" — was answered by
tracing Phase 6's own hand-off note verbatim: `create-widget-session.ts` threads
`previewVersionId` through `WidgetSessionClaims` into
`send-widget-message.ts`'s `generateAiReply` deps, whose real implementation is
`apps/gateway/src/lib/turn-pipeline-adapter.ts`'s `generateAiReply` — the sole
composition-root binding between `@nextbot/conversations` (Data Plane) and
`@nextbot/orchestration` (neither module may import the other directly, LLD §2.3's
allow-list). That function is the one place that (a) knows a turn was a
server-verified sandbox preview (`previewVersionId` present — only ever set after
`apps/gateway`'s session route independently verified an Admin Console
`agent_platform: Write` authorization for that exact version, per Phase 6) and (b)
observes `runTurnPipeline`'s real outcome. Read `orchestration/application/
turn-pipeline.ts`'s `finish()` helper to confirm exactly when it returns a non-null
`runId`: only when `input.agentDefinitionVersionId` was supplied *and* a real
`agent_run` row was actually created and ended for this call — which for the
sandbox-preview path only happens once `sendWidgetMessage` calls `generateAiReply`
for a genuine, sent customer message. Opening `ChatPreviewPanel`'s iframe/session
alone never reaches `generateAiReply` at all (no message = no call), so gating on
`previewVersionId && result.runId` is structurally incapable of firing from mere
session/panel creation — this is the concrete, code-level answer to "not just the
panel was opened," proven (not just reasoned about) by the new
`sandbox-test-gate.int.test.ts` e2e below.

**Delivered:**
- `packages/db/src/schema/agent-platform.ts` /
  `packages/db/migrations/0032_agent_version_sandbox_test.sql` — new nullable
  `agent_definition_version.last_sandbox_test_at timestamptz` column. Additive only,
  no existing column touched, no backfill needed (every pre-existing row correctly
  has no recorded sandbox test, since the gate didn't exist when they were created);
  RLS already covers the whole row via the table's existing tenant-isolation policy
  (`0015_agent_platform_rls.sql`), so no new RLS statement is needed for a new
  column — confirmed genuinely low-risk, not just asserted.
- `packages/modules/agent-platform/src/infrastructure/agent-definition-repository.ts`
  — new `recordAgentDefinitionVersionSandboxTest(ctx, id)`: sets the column to `now()`
  only via an `isNull()` guard in the `WHERE` clause, so a version's first real
  sandbox test is the only one that ever writes it (versions are immutable, so this
  is a one-shot flag, not a mutable history — matches the LLD's "no history table
  needed" framing this dispatch itself gave).
- `packages/modules/agent-platform/src/application/agent-definition-service.ts` — new
  `recordSandboxTest(ctx, versionId)`, a thin wrapper following this module's
  established repository-then-service pattern, exported from `@nextbot/agent-platform`'s
  public `index.ts` (alongside the existing `serializeArtifactToYaml`/
  `parseArtifactFromYaml` exports).
- `apps/gateway/src/lib/turn-pipeline-adapter.ts` — `generateAiReply` now calls
  `recordSandboxTest(ctx, previewVersionId)` (best-effort, try/catch, logged not
  rethrown — a bookkeeping failure here must never mask the customer-facing reply
  already computed) whenever `previewVersionId && result.runId` after
  `runTurnPipeline` returns. This is the exact seam Phase 6's own doc comment
  pointed at ("directly the seam Phase 7's `recordSandboxTest(ctx, versionId)` hook
  needs").
- `packages/modules/agent-platform/src/domain/promotion-policy.ts` — `canPromote`'s
  `Production` case gains one more condition, specifically on `Approved ->
  Production` (never `HumanReview -> Approved` or any earlier transition, per this
  dispatch's own reasoning that this is the transition with real customer-traffic
  consequence): `input.lastSandboxTestAt` must be non-null, or the version is
  rejected with an explicit "Run at least one sandbox test conversation..." reason
  string (surfaced verbatim by the console's existing "(?)" affordance, unchanged
  mechanism from earlier phases).
- `packages/modules/agent-platform/src/application/promote-version-service.ts` —
  `loadPromotionCheckInput` now reads `version.lastSandboxTestAt` and threads it into
  `PromotionCheckInput`, following the same "re-derive everything from the database
  inside this one function, never trust the client" pattern already documented here
  for every other gate condition.
- `apps/web/app/(admin)/agent-platform/definitions/[id]/DefinitionDetail.tsx` —
  **Restore**: a new "Restore" row-action, shown only on an old (non-latest) version
  when the caller has `agent_platform: Write` (versions are ordered newest-first, so
  `idx === 0` is always latest — no new backend concept, purely a UI affordance),
  linking to `.../versions/new?fromVersionId=<id>`. **Sandbox-gate UX**: the existing
  "(?) why can't I promote this further?" tooltip already surfaces `canPromote`'s
  exact reason string; when that reason is specifically the sandbox-test gate, a new
  always-visible (not hover-only) "Run a sandbox test" link now also appears, going
  to `/agent-platform/versions/:id?tab=sandbox`.
- `apps/web/app/(admin)/agent-platform/versions/[versionId]/VersionDetail.tsx` — reads
  `?tab=sandbox` (via `useSearchParams`, same `?tab=` convention `mcp-health/page.tsx`
  already established) to set the `Tabs`' initial value, so the new link above lands
  directly on the Sandbox tab instead of Overview.
- `apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx`
  — reads `?fromVersionId=<id>` and, when present, fetches that version via the
  existing `GET /versions/:id` read (confirmed to already return `definitionYaml`/
  `graphType`/`modelRouteKey` verbatim — no new endpoint needed), pre-fills the form
  from it instead of the blank scaffold, and suggests a bumped-patch semver
  (`suggestNextVersion`: `"0.1.0" -> "0.1.1"`; falls back to a `-restored` suffix for
  a non-semver label rather than guessing at a bump that could collide). Submitting
  goes through the exact same `POST .../versions` create call every other new version
  uses (Phase 5's Git-independent path) — no new domain operation, and the source
  version is only ever read, never mutated.
- `scripts/seed.ts` — calls the same real `recordSandboxTest` immediately before its
  own `Approved -> Production` promotion, rather than hand-writing DB state, so demo
  data satisfies the new gate the same way a real operator's sandbox test would.

**Local, reversible decisions made and noted, per §3:** (a) the "Run a sandbox test"
link's visibility is keyed off matching the word "sandbox test" in the fetched
blocking-reason string rather than adding a new dedicated API field, since the
reason string is already the documented contract this affordance follows (identical
pattern to the pre-existing tooltip); (b) `VersionEditor`'s Restore pre-fill uses
`useSearchParams()` directly in the client component with no `<Suspense>` wrapper,
matching this codebase's own existing precedent (`git-callback/page.tsx`) rather than
introducing a different pattern.

**Verification (real, not assumed):**
- `pnpm turbo run typecheck` — 31/31 workspace packages green.
- `pnpm run lint` and `pnpm run lint:boundaries` — both clean (0 violations,
  1664 modules/4424 dependencies).
- `promotion-policy.test.ts` — new isolated `describe("sandbox-test gate")` block:
  a version passing every other `Approved -> Production` condition (installed graph
  type, passing eval gate) is still rejected with `lastSandboxTestAt: null`, and
  allowed once it's set — 21/21 unit tests green (up from 18).
- `promote-version-service.int.test.ts` — new real-DB test proving a version with no
  sandbox test cannot reach `Production` via the real `promoteAgentVersion` service
  (rejects with a reason matching `/sandbox test/i`), and the identical version can
  immediately after a real `recordSandboxTest(ctx, version.id)` call; the file's three
  pre-existing full-lifecycle walks to `Production` updated to call
  `recordSandboxTest` first (otherwise now correctly blocked by this phase's own new
  gate) — 6/6 tests green.
- New `apps/gateway/app/api/v1/widget/sandbox-test-gate.int.test.ts` — the specific
  "can't be gamed" proof this dispatch's own verification section calls for, built
  entirely on real HTTP routes (not a direct `recordSandboxTest` call): (1) creating
  a sandbox-preview session and never sending a message leaves `lastSandboxTestAt`
  null; (2) sending a real message through the real `POST /widget/messages` route,
  answered by a real (mocked-HTTP, not mocked-at-the-code-layer)
  `startMockOpenAiCompatibleServer` backend, sets it; (3) an ordinary non-preview
  widget conversation never touches an unrelated version's flag. 3/3 green.
- Full `pnpm vitest run --project unit`: 202 files/1199 tests green, no regressions.
- Full `pnpm vitest run --project integration` (default parallel pool, this
  project's normal way of running it): 75 files/328 tests green, no regressions.
  A handful of 401/429 failures appeared only in narrower, coverage-instrumented
  subset re-runs selecting specific file combinations — root-caused as the same
  pre-existing shared-Redis-rate-limiter/`ai-registry`-process-wide-env-caching
  cross-file contention class Phase 6's own QA pass already documented and
  attributed (not a regression this phase introduced), confirmed by re-running the
  full default-pooled suite twice clean and by isolating a `--poolOptions.threads.
  singleThread` subset that also passed 21/21 once the specific contaminating file
  combination was avoided.
- Real seed verification: stood up a fresh ephemeral `compose.test.yml` stack, ran
  `migrate:test` (32/32 migrations, including this phase's new `0032`), started a
  standalone out-of-process mock OpenAI-compatible server, ran `pnpm run db:seed`
  against it — seed log shows the version created, gated on a real passing eval run,
  reviewed, approved by a distinct user, then promoted to `Production`; queried
  `agent_definition_version` directly via `docker exec ... psql` (not the script's own
  log output) and confirmed a real `last_sandbox_test_at` timestamp on the row.
  Ephemeral stack torn down (`down -v`), standalone mock server process killed,
  throwaway `SEED_CREDENTIALS.md`/`.env.test` deleted after verification.
- Coverage on files this dispatch added/changed, all at or above the 80% floor:
  `promotion-policy.ts` 95.45% stmts/91.17% branch (unit project); `agent-definition-
  service.ts` 81.81% stmts (integration project — consistent with Phase 5's own
  81.25% baseline, not regressed), `agent-definition-repository.ts` 92.47% stmts,
  `turn-pipeline-adapter.ts` 82.6% stmts (its few uncovered lines are the
  pre-existing `extractCustomerText` switch branches, unrelated to this dispatch's
  own new lines, which are all covered); `DefinitionDetail.tsx`/`VersionEditor.tsx`/
  `VersionDetail.tsx` unit suites all green with new Restore/sandbox-link/tab-deep-
  link test cases (16/9/10 tests respectively).

**Security self-review:** no new HTTP endpoint added by this phase — it reuses
Phase 6's already-audited sandbox-preview-token mint/verify endpoint and Phase 5's
already-audited version-create endpoint, neither of which was modified. The one
change to an existing auth-relevant code path (`canPromote`) is strictly additive —
a narrower gate on one specific transition, never a looser one on any transition —
and re-derives `lastSandboxTestAt` from the database inside the same
`loadPromotionCheckInput` transaction as every other promotion input, never trusted
from the client. `recordSandboxTest`'s own write is idempotent and scoped by
`withTenant` like every other write in this module.

**Files changed:** `packages/db/src/schema/agent-platform.ts`,
`packages/db/migrations/0032_agent_version_sandbox_test.sql` (new),
`packages/modules/agent-platform/src/infrastructure/agent-definition-repository.ts`,
`packages/modules/agent-platform/src/application/agent-definition-service.ts`,
`packages/modules/agent-platform/src/application/promote-version-service.ts`,
`packages/modules/agent-platform/src/application/promote-version-service.int.test.ts`,
`packages/modules/agent-platform/src/domain/promotion-policy.ts`,
`packages/modules/agent-platform/src/domain/promotion-policy.test.ts`,
`packages/modules/agent-platform/src/index.ts`,
`apps/gateway/src/lib/turn-pipeline-adapter.ts`,
`apps/gateway/app/api/v1/widget/sandbox-test-gate.int.test.ts` (new),
`apps/web/app/(admin)/agent-platform/definitions/[id]/DefinitionDetail.tsx` (+
`.test.tsx`),
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx`
(+ `.test.tsx`),
`apps/web/app/(admin)/agent-platform/versions/[versionId]/VersionDetail.tsx` (+
`.test.tsx`), `scripts/seed.ts`, `docs/plans/client-feedback-batch-plan.md`.

`current_phase` left as `development` — **ready for QA, not marking this phase
QA-approved myself.**

## Phase 7 — QA fix pass (2026-08-23): promotion-replaces-prior-deployment

**Defect (blocking, from Phase 7's own QA pass):** promoting a version to Production
crashed with an unhandled 500 whenever the agent already had an active Production
deployment — the normal case once an agent has ever been promoted before (e.g. via
this same phase's Restore feature). Root cause:
`deployment-repository.ts`'s `createInitialProductionDeployment` unconditionally
`INSERT`ed a new active 100%-traffic row without first deactivating the agent's prior
active deployment, so `enforce_deployment_traffic_split_invariant()` (migration 0016)
correctly rejected the second row once the two would sum past 100. This did not
regress Phase 8 (Model Gateway) — untouched, no shared files.

**Reproduced first**, against the real test database: created a definition, walked a
version fully to Production, then walked a second version through the same real gates
(eval pass, reviewer!=author, sandbox test) and called `promoteAgentVersion(...,
"Production", ...)` — got back the exact `23514`/invariant-violation error QA
described, not a mocked repro.

**Fix**, scoped narrowly (BL-13's full canary/traffic-split editor is explicitly out of
scope — this only makes "promote replaces what was previously live" true, which is
what the console's own confirmation dialog already promised):
- `packages/modules/agent-platform/src/infrastructure/deployment-repository.ts` —
  `createInitialProductionDeployment` now, within the same transaction:
  1. Takes a `pg_advisory_xact_lock` keyed on `hashtext(tenantId:agentDefinitionId:environment)`.
     Investigated first whether a mechanism the schema already supports (an `isActive`
     row lock alone) was sufficient — it wasn't: a genuinely **first** promotion for an
     agent (zero prior deployment rows) has nothing to lock, so two different
     already-Approved versions racing for that first slot could both `INSERT` before
     either committed and the trigger — which only validates already-committed
     rows — let both through, violating the invariant once both committed. Reproduced
     this directly (a 15-iteration concurrent-repro loop against the real DB, 1/15
     failing before the advisory lock, 0/15 after) before deciding the row-lock-only
     approach was insufficient. The advisory lock serializes every call to this
     function for the same (tenant, agent, environment), whether or not a prior row
     exists, and is released automatically at commit/rollback (no explicit unlock, no
     deadlock risk from an unreleased session-level lock).
  2. `UPDATE`s the agent's existing active deployment(s) for this environment to
     `is_active = false, deactivated_at = now()` — the schema already modeled exactly
     this ("deactivate" = the existing `isActive`/`deactivatedAt` columns migration
     0014 already defined; no new column, no schema change).
  3. Inserts the new active 100%-traffic row, and records the replacement in the same
     `deployment_history` "Deploy" entry's `fromState` (no new history action enum
     value needed).
- Did **not** merge this transaction with `promote-version-service.ts`'s separate
  `updateAgentDefinitionVersionStatus` transaction — investigated whether the LLD's
  invariant needed that; it doesn't, since `enforce_deployment_traffic_split_invariant()`
  only constrains the `deployment` table, and the version-status transition is already
  independently guarded by the existing BE2 optimistic-concurrency check
  (`expectedCurrentStatus`). Reordering the two calls (create deployment before
  flipping status) was considered and rejected: it would change which layer's guard
  catches a concurrent double-promotion of the *same* version, breaking the existing
  BE2 regression test's assertion that losers get `PromotionNotAllowedError` rather
  than a raw DB constraint error.
- `packages/modules/agent-platform/src/application/promote-version-service.int.test.ts`
  — new real-database regression test: promote version A of an agent to Production,
  then a genuine follow-up version B of the *same* agent through every gate and
  promote it too; asserts B succeeds (the exact call that used to 500), A's deployment
  row is `isActive: false` in the database (not merely superseded in application
  logic), and exactly one active row exists summing to 100% traffic. All 6 pre-existing
  tests in this file (including the BE2 same-version concurrency regression and both
  "genuinely first promotion" walks for the Git-connected and Git-disconnected tenants)
  still pass unmodified — no regression to already-QA-green behavior.

**Verification performed:**
- Reproduced the exact 500 pre-fix, against the real (test) Postgres via
  `compose.test.yml` — confirmed the literal `23514` invariant-violation error, not a
  guess at root cause.
- Post-fix: same sequence succeeds; confirmed directly via `listDeploymentsForAgent`
  that the old version's row has `isActive: false` and the new version's row is the
  sole `isActive: true, trafficSplitPct: 100` row.
- Confirmed a genuinely first promotion (zero prior deployments) still works
  (pre-existing test, unmodified, still green).
- Concurrency: ran a 15-iteration loop of two different Approved versions of a
  brand-new agent racing for the first Production slot with **no** existing deployment
  row (the case a row-lock alone cannot serialize) — found and reproduced a real,
  transient invariant violation before adding the advisory lock (1 failure across 15
  iterations, `sum=200`), then reran 15/15 clean after adding it. Also reran the
  pre-existing BE2 same-version 10-concurrent-caller regression test — still exactly 1
  success, 9 `PromotionNotAllowedError` rejections, unaffected by this fix.
- `pnpm turbo run typecheck`: 31/31 tasks green.
- `pnpm run lint` (`eslint . --max-warnings=0`): clean.
- `pnpm exec dependency-cruiser --config .dependency-cruiser.cjs --output-type err apps
  packages`: "no dependency violations found" (1797 modules, 4621 dependencies).
- Full integration suite (`vitest --project integration`): 75/75 files, 329/329 tests
  green — no regression anywhere, including Phase 8's Model Gateway area (untouched).
- Full unit suite (`vitest --project unit`): 203/203 files, 1219/1219 tests green.
- Coverage on the changed file (`deployment-repository.ts`, scoped run against just
  `promote-version-service.int.test.ts`): 100% statements/lines, 100% functions, 90.9%
  branch — above the 80% target (the one uncovered branch is
  `hasActiveTraffic`'s pre-existing `?? 0` fallback, untouched by this fix).
- Security: no new endpoint, no new user input surface, no new auth boundary — this is
  a same-transaction data-consistency fix inside an already-authorized, already-gated
  write path. No security review action needed beyond confirming that (already true
  before this fix, unchanged): the caller identity/authorization for `Approved ->
  Production` is unaffected by this change.
- `DefinitionDetail.tsx`'s promotion-confirmation dialog copy ("promoting a new version
  here replaces the prior one's traffic outright") was already accurate wording for
  the intended behavior — confirmed it is now also *true*, left unchanged.

`docs/NEXUS_STATE.md` updated: `active_dev_plan` unchanged (still this plan),
decision-log entry appended, `current_phase` left as `development` — **ready for
re-QA, not marking this fix QA-approved myself.**

## Phase 8 — implementation notes (2026-08-23)

**Scope (item 5, layout half — the seed-data half was already done via Phase 1):**
"reorganize page and seed with proper data" from the client's screenshot feedback, plus
light validation on `chain[].model` so a stray non-model string (the screenshot showed
what looked like a pasted email address) can't be saved going forward. File scope was
disjoint from Phase 7's concurrently-landing files (`agent-platform/definitions/**`,
`agent-platform/versions/**`, `apps/gateway/**`, `promotion-policy.ts`,
`promote-version-service.ts`) and from `packages/ui/src/components/ui/*` (this
dispatch's own instruction not to touch it) — only consumed the already-fixed shared
`Tabs`/`FieldHint` primitives as-is.

**Delivered:**
- `packages/contracts/src/agent-platform.ts` — `ModelRouteChainEntrySchema.model`
  gained `pattern: "^[^\\s@]+$"` alongside its pre-existing `minLength: 1`. Deliberately
  loose: rejects only whitespace and `@` (the two shapes that are never a legitimate
  model id) rather than pinning a stricter grammar that would false-positive on some
  provider's real format — `gpt-4o`, `claude-opus-5`, `llama-3.1-70b-instruct`, and
  `openai/gpt-4o-mini` all remain valid. New `packages/contracts/src/agent-platform.test.ts`
  (16 tests) proves both directions against a range of realistic model ids across
  providers/conventions, not just the client's one reported example.
- `apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.tsx` — reorganized
  into "Routes" (Tenant Model Routes list + the existing inline Route editor, unchanged
  functionality) and "Provider Registry" (the read-only table) tabs via the shared
  `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` primitive, using its established
  explicit-`id`/`panelId` contract (no `useId()`-derived defaults, matching this
  primitive's own hydration-safety doc comment). No `Sheet` primitive exists in this
  codebase, and `packages/ui/src/components/ui/*` was out of this dispatch's scope, so
  the editor stayed inline (unchanged layout) rather than becoming a slide-over — the
  reorganization is the Routes/Provider-Registry tab split itself. All of Phase 4's
  `FieldHint` tooltips and the QA-fix-pass `aria-label`s on `SelectTrigger`s were
  preserved verbatim. `FieldHint` was additionally applied to four fields on this page
  that didn't already have one (Semantic threshold, Total timeout, Base URL in "own
  endpoint" mode, API key) per the plan's own "bundle since the file is already open"
  reasoning. A client-side pre-check in `save()` mirrors the contract's regex exactly
  and shows a field-specific toast (`Entry N's Model looks wrong...`) before the round
  trip to the server's generic 422 — deliberately scoped to skip an *empty* model
  (that's the orthogonal, pre-existing `minLength: 1` "did you fill this in" concern,
  already surfaced by the server; this check is scoped only to "the shape of what you
  typed is obviously wrong," confirmed necessary after an initial version that also
  flagged empty strings broke two pre-existing tests that intentionally save a
  not-yet-filled-in entry).
- `apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.test.tsx` — existing
  suite adapted for the new tab structure (the Provider Registry assertion now clicks
  its tab first, since Base UI's `Tabs.Panel` unmounts inactive panels by default) with
  no assertion weakened, plus new tests: tab defaulting/switching, the editor's
  continued presence inside the Routes tab, and both directions of the model-id
  validation (blocks an email-shaped model, allows a `provider/name`-shaped one). 15
  tests total, all green.

**Verification, real, not assumed.** Ephemeral `compose.test.yml` stack (`down -v` /
`up -d`), real `migrate:test` (32/32 migrations — one more than Phase 1's original
baseline, from Phase 7's `0032_agent_version_sandbox_test.sql` landing concurrently),
real `pnpm run db:seed` against it (model_provider/model_route seeded successfully; the
version/promotion step degraded gracefully per its own already-documented
AI-backend-unreachable fallback, unrelated to this phase's scope), a real `next dev`
process (port 3001 — port 3000 was occupied by an unrelated stale process in this
sandbox) against that database, driven live via a from-scratch Playwright (Chromium)
install: logged in as the seeded Tenant Admin, confirmed both tabs render with Routes
as the default-active tab and Provider Registry reachable by click, confirmed every
`FieldHint` trigger and `SelectTrigger` `aria-label` is present both before and after
clicking Edit, typed `someone@example.com` into a chain entry's Model field and
confirmed Save is blocked with the field-specific toast and no PUT request is sent,
then corrected it to `gpt-4o` and confirmed the PUT fires and the success toast
appears — independently confirmed against the real database via `psql` (in-container)
that the route's `chain` column now holds `{"model": "gpt-4o", ...}`. Separately issued
two raw `fetch()` calls from the authenticated browser session directly against the API
route (bypassing the UI validation entirely, proving the *server*, not just the UI, is
the real enforcement boundary): an email-shaped model was rejected with a genuine
`422`/`"Invalid model route payload."`, and a `provider/name`-shaped model
(`openai/gpt-4o-mini`) was accepted with `200`. 20-fresh-hard-navigation-load hydration
regression check on `/agent-platform/model-gateway` (new browser context each time,
real HTTP navigation, matching this batch's own established methodology given
`Tabs`'/`FieldHint`'s specific hydration-bug history): **0/20 mismatches.** Zero
console errors observed across the whole live session.

`pnpm turbo run typecheck` 31/31 packages green; targeted `eslint --max-warnings=0` on
every changed file clean; full `pnpm run lint:boundaries` clean (0 violations, 1731
modules/4428 dependencies); full `pnpm vitest run --project unit` suite green (203
files/1219 tests, no regressions). Coverage on changed files: `ModelGateway.tsx`
95.52% stmts / 82.08% branch (above the 80% floor); the `agent-platform.ts` schema
change is a config attribute addition (no branch to cover), exercised structurally by
the new dedicated `agent-platform.test.ts`. Ephemeral Docker stack, the `next dev`
process, throwaway `.env.test` / `apps/web/.env.local`, and the scratch Playwright
install were all torn down/deleted after verification; `SEED_CREDENTIALS.md`
(gitignored generated artifact) was left as this run produced it, matching this batch's
own established non-tracked-state convention for that file.

**Security review:** no new endpoint, no auth/authz change — the existing
`PUT /api/v1/admin/agent-platform/model-routes` route's `agent_platform:Write` guard is
untouched; the schema change only narrows what was already an authenticated,
RBAC-gated write path, and the added client-side check is a UX nicety, not a security
boundary (the server-side `Value.Check` against the tightened schema is the real
enforcement, independently verified above via direct API calls bypassing the UI).

**Files changed:** `packages/contracts/src/agent-platform.ts`,
`packages/contracts/src/agent-platform.test.ts` (new),
`apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.tsx`,
`apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.test.tsx`,
`docs/plans/client-feedback-batch-plan.md`.

`current_phase` left as `development` — **ready for QA, not marking this phase
QA-approved myself.**

## Phase 9 — implementation notes (2026-08-23)

**Delivered (item 7 — Design Studio form, a "Design mode" / "Text mode" toggle on the
version-create screen):**
- `apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx`
  — added a `Tabs` toggle ("Text" / "Design") wrapping the existing "Definition YAML"
  section. Read fully first (post-Phase-4 `FieldHint`s, post-Phase-7 Restore pre-fill)
  and left both untouched: "Text" is the exact same `Textarea` bound to `yamlText`,
  unchanged. `TabsTrigger`/`TabsContent` carry explicit literal `id`/`panelId` values
  per this batch's established (hydration-safe) contract, matching `ModelGateway.tsx`'s
  usage.
- `apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/
  version-editor-constants.ts` (new) — hoisted `GRAPH_TYPES`/`ROUTE_KEYS` out of
  `VersionEditor.tsx` so `DesignModeForm.tsx` can share them without an import cycle.
- `apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/
  DesignModeForm.tsx` (new) — a structured `react-hook-form` +
  `@hookform/resolvers/typebox` form (the codebase's established forms convention —
  confirmed as a real dependency of `apps/web`/`packages/ui` and already used by
  `ConnectorWizard.tsx`/`form.tsx` before assuming it) over
  `AgentDefinitionArtifactSchema`'s `spec`: Graph & Model (`graphType`, `modelRoute`
  `Select`s reusing the same constants as the top-of-page selectors), Instructions
  (`Textarea`), Tool Policy (`capabilityGroups` as a simple comma-separated free-text
  field — a real Tool-Registry picker is Phase 10's separate job — and
  `maxToolCallsPerTurn`), Guardrails (`minConfidenceForAutonomy` and an `escalateOn`
  checkbox group over the same four literals `RoutingConfig.tsx`/
  `escalation-routing.ts` already use), Memory (`strategy` — a `Select` with the
  single `rolling-window` option, the only strategy referenced anywhere in the
  spec/LLD/seed/test fixtures — and `maxTurns`), Eval Suite (a plain descriptive text
  field, matching this screen's existing "descriptive only" note), and Budgets
  (`maxCostUsdPerConversation`, `maxLatencyMsP95`). Every field carries a `FieldHint`
  with one-sentence copy written from the contract's own field semantics. Exports two
  pure functions, `artifactToFormValues`/`formValuesToArtifact`, both round-tripping
  through the exact same `Value.Check`/`AgentDefinitionArtifactSchema` validation
  Text mode's own `validate()` already uses.
- Sync model: Base UI's `Tabs.Panel` unmounts its inactive panel by default (already
  documented in `tabs.tsx`), so `DesignModeForm` re-derives its form state fresh from
  the current `yamlText` on every mount (i.e. every tab switch) rather than needing a
  continuous re-sync effect. It only propagates a freshly serialized YAML string back
  up to `VersionEditor.tsx`'s shared `yamlText` state on an actual field edit
  (`form.watch(callback)`, which never fires on the initial render) — switching into
  Design mode and back without editing anything leaves the Text-mode YAML
  byte-for-byte untouched. `mode: "onChange"` is set on the form (unlike
  `ConnectorWizard.tsx`, which only validates at its own explicit submit step) because
  this form has no submit button of its own — its only "commit" point is the
  change-subscription effect, which silently withholds propagating an invalid
  artifact; `onChange` validation means a field that's being withheld also shows the
  user *why*, via the same humanized (`humanizeFieldError`) `FormMessage` convention
  every other RHF form in this codebase already uses.
- `apps/web/src/lib/humanize-field-error.ts` — extended with entries for this form's
  field names (a shared, generic utility already keyed by field name across multiple
  screens; additive, no existing entry touched).

**Local, reversible deviation, flagged rather than silently made:** the dispatch asked
to reuse `@nextbot/agent-platform`'s existing `serializeArtifactToYaml`/
`parseArtifactFromYaml` if present — they are (`agent-definition-service.ts`). Not
imported into `DesignModeForm.tsx` (a `"use client"` component): that package's
`index.ts` aggregates infrastructure modules that ultimately import `@nextbot/db` (a
real Postgres driver) — bundling it into a client component risks a broken/oversized
client bundle. `VersionEditor.tsx` itself already independently reimplements the
identical one-line `yaml.load`/`Value.Check` logic locally for exactly this reason
(confirmed by reading it: it never imports `@nextbot/agent-platform`, unlike every
route handler under `apps/web/app/api/**`, which all do). Followed that established,
codebase-as-ground-truth boundary instead of introducing the first client-side import
of a server-aggregating package — `DesignModeForm.tsx` calls `yaml.dump()` directly
(the same library `VersionEditor.tsx` already depends on) rather than routing through
the module package's identically-named wrapper.

**Verification (real, not assumed):** `pnpm --filter nextbot-web run typecheck` clean;
targeted `eslint --max-warnings=0` on every changed/added file clean; `pnpm run
lint:boundaries` clean (0 violations, 1862 modules/4651 dependencies); full `pnpm
vitest run --project unit` suite green (205 files/1244 tests — one earlier full-suite
run showed 2 unrelated timeouts in `ops/health-rollup`/`ops/tenants` route tests that
passed clean both in isolation and on a full clean rerun, confirming a
resource-contention flake, not a regression this dispatch introduced). Coverage on
files this dispatch added/changed: `DesignModeForm.tsx` 100% stmts/lines, 82.85%
branch, 92.59% funcs; `VersionEditor.tsx` 95.75% stmts/lines, 90.47% branch (its
remaining sub-80%-adjacent funcs figure traces entirely to pre-existing, untouched
lines — `validate()`'s `Value.Errors` mapping and `handleSubmit`'s generic
`toast.error` branch — not to anything added this phase); `version-editor-
constants.ts` 100% all four axes; `humanize-field-error.ts` 100% all four axes.

Round-trip unit tests (`DesignModeForm.round-trip.test.ts`, new) prove 3 distinct
realistic artifacts (minimal, fully populated, every escalation reason present)
survive `artifactToFormValues` → `formValuesToArtifact` with `Value.Check` passing and
the rebuilt artifact deep-equal to the original, plus the `evalSuite`-empty-string and
capability-group-whitespace-trimming edge cases. Component tests
(`DesignModeForm.test.tsx`, new, 15 tests) cover per-field seeding from YAML, the
no-propagation-on-mount guarantee, `Select`/checkbox/number-field edits each reflected
in the generated YAML, checking-then-unchecking an escalation reason ending absent,
a momentarily-cleared required field never propagating an invalid artifact (then
resuming once corrected), humanized (not raw TypeBox) error copy for several fields,
and both the YAML-parse-error and schema-invalid-but-parseable "starting from
defaults" paths. `VersionEditor.test.tsx` gained a new describe block (4 tests):
Text→Design→Text with no edit is a byte-for-byte no-op, a Design-mode edit is
reflected in the Text-mode YAML after switching tabs, a Text-mode edit is reflected in
Design mode's fields after switching tabs, and Design is reachable via its tab — all
13 of that file's tests, including every pre-existing Restore/Git-degrade test, pass
unmodified in behavior.

**Live browser verification (real, against this dispatch's actual diff — not a
separately-started ephemeral stack this time, since the project's own
`docker-compose.yml` stack was already running on this dev machine with real seeded
`demo`-tenant data; rebuilt the `web` image against this diff and recreated the
container, then drove it live with a from-scratch Playwright (Chromium) install and
axe-core, matching this batch's established methodology):**
- 20/20 fresh hard-navigation loads of the version-create page: **0 hydration-mismatch
  console errors** (given this batch's `Tabs`/`FieldHint` hydration-bug history).
- A live `axe-core` scan (`wcag2a`/`wcag2aa`) of the Design mode form: **0 violations.**
- A genuine end-to-end flow: logged in as the seeded Designer, opened "Support
  Assistant"'s New Version screen, filled every Design-mode section (Graph type,
  Model route, Instructions, capability groups, max tool calls, min confidence,
  toggled an escalation-reason checkbox, memory max turns, budgets), confirmed
  switching to Text mode showed the matching generated YAML, submitted, and confirmed
  the version was created via the DB-first no-Git-connection path (Phase 5's
  behavior, confirmed still intact — this seeded tenant has no Git connection, so the
  screen's existing "not synced to Git" banner + "Continue to version" link appeared,
  exactly as it would for a Text-mode-created version). Verified directly in Postgres
  (`psql`) that the persisted `definition_yaml` contains exactly the Design-mode-
  entered `instructions`/`toolPolicy.capabilityGroups`/`toolPolicy.
  maxToolCallsPerTurn`/`guardrails.minConfidenceForAutonomy`/`memory.maxTurns`/
  `budgets`.
- Separately re-verified Phase 7's Restore flow live end-to-end on this same,
  now-tabbed screen: restoring the seeded Production `1.0.0` version correctly
  suggested version `1.0.1`, pre-filled the Text-mode YAML with that version's real
  821-byte content (never the blank scaffold), and switching to Design mode correctly
  parsed that restored YAML (its `instructions` field showed the real seeded
  "Support Assistant" system prompt) — zero hydration console errors during this flow
  either.
- Torn down: the `web` container was left running (this is the dev machine's own
  persistent compose stack, not an ephemeral one this dispatch stood up, so left
  running per the environment's normal state); the scratch Playwright/npm install
  lives only in this session's scratchpad temp directory, never committed. The extra
  Draft versions this verification created on the seeded "Support Assistant"
  definition were left in place as harmless demo data, same as any other manual
  verification pass against this seed.

**Security review (self-review — no new endpoint/auth boundary/user-input surface):**
this phase only adds a client-side alternate editing surface for the same
already-`agent_platform:Write`-gated create-version POST route
(`POST /api/v1/admin/agent-platform/definitions/:id/versions`, unchanged). Every value
Design mode produces still passes through the identical server-side
`AgentDefinitionArtifactSchema`/`Value.Check` validation as a Text-mode-authored
artifact before being persisted — no new, looser validation path was introduced.

**Files changed:**
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx`,
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/DesignModeForm.tsx`
(new),
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/version-editor-constants.ts`
(new),
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/DesignModeForm.test.tsx`
(new),
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/DesignModeForm.round-trip.test.ts`
(new),
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.test.tsx`,
`apps/web/src/lib/humanize-field-error.ts`, `apps/web/src/lib/humanize-field-error.test.ts`,
`docs/plans/client-feedback-batch-plan.md`.

`current_phase` left as `development` — **ready for QA, not marking this phase
QA-approved myself.**

## Phase 10 — implementation notes (2026-08-23, SECURITY-RELEVANT FINDING — flush to
QA immediately, do not batch with Phase 11)

**Investigated first, per this dispatch's own instructions:** confirmed
`packages/db/src/schema/tool-registry.ts`'s real, tenant-scoped `capability_group`
table, and `packages/modules/tool-registry/src/infrastructure/
capability-group-repository.ts`'s existing `listCapabilityGroups()`/
`createCapabilityGroup()`. Checked `apps/web/app/api/v1/admin/**` and
`tool-registry`'s own `admin-routes.ts`/`index.ts`: **no capability-groups list
endpoint was exposed to the admin console before this phase** — `admin-routes.ts`
already had `handleListCapabilityGroups`/`handleCreateCapabilityGroup` thin wrappers,
but no route ever called them.

**Delivered:**
- `packages/modules/tool-registry/src/infrastructure/capability-group-repository.ts`
  — new `listCapabilityGroupsWithToolCounts(ctx)`: same tenant-scoped, non-deleted
  `capability_group` rows as the pre-existing `listCapabilityGroups`, `LEFT JOIN`ed
  against `tool` (also explicitly tenant-filtered in the join condition, defense in
  depth alongside `withTenant`'s RLS — matches this repository's own pre-existing
  convention) and `GROUP BY`'d to a live `toolCount` per group.
- `packages/modules/tool-registry/src/http/admin-routes.ts` — new
  `handleListCapabilityGroupsWithToolCounts`, kept distinct from the pre-existing
  `handleListCapabilityGroups` (no count) rather than changing that already-tested
  handler's contract.
- `apps/web/app/api/v1/admin/tools/capability-groups/route.ts` (new) — `GET`, gated
  `tool_permissions=Read` (matching the sibling `GET /api/v1/admin/tools` catalog
  route's own gate exactly — read-only tool-registry domain data, not the stricter
  `agent_tool_config=Write` that gates actually assigning a tool to a group).
- `DesignModeForm.tsx`'s Tool Policy section: replaced the free-text comma-separated
  `Input` with a checkbox-fieldset picker. No `Combobox`/`Command`-style primitive
  exists in `packages/ui/src/components/ui/` (checked before assuming) — followed the
  dispatch's own fallback instruction and reused this same file's pre-existing
  `guardrailsEscalateOn` checkbox-fieldset pattern instead. `toolPolicyCapabilityGroups`
  changed from a comma-separated `string` to a real `string[]` — the exact shape
  `AgentDefinitionArtifactSchema.spec.toolPolicy.capabilityGroups` already expects, so
  no contract change was needed. Each checkbox shows the group's live tool count. A
  capability-group name already on an existing artifact that no longer matches a real
  tenant row (deleted/renamed group, or a stale pre-picker value) renders as a distinct
  "orphaned" checkbox ("no longer exists — untick to remove") instead of being silently
  dropped — switching an existing version into Design mode never loses data the
  artifact already had.

**SECURITY-RELEVANT FINDING (the dispatch's own flagged check surfaced a real,
pre-existing gap — reporting it, not silently fixing or silently proceeding as if it
were fine):** the dispatch asked to verify that picking a group in this UI "grants
NOTHING beyond what the runtime already independently enforces at tool-call time," and
to prove a stale/cross-tenant capability-group name resolves to zero tools, never a
silent full-access fallback. Reading (not modifying) the actual runtime —
`packages/modules/orchestration/src/application/turn-pipeline.ts` and
`goal-selection.ts` — found **no code anywhere in this codebase reads
`agentDefinitionVersion.spec.toolPolicy.capabilityGroups` at all.**
`turn-pipeline.ts` calls `listTools(ctx)` unfiltered; every Active/visible tool the
tenant has is offered to goal/tool selection regardless of the deployed version's
`toolPolicy.capabilityGroups` value. `resolveToolPermission`/`resolvePermission` (the
real per-call Tier1/2/3 authorization gate) has no capability-group dependency either
— `tool.capability_group_id` is pure grouping/labeling metadata with zero enforcement
wiring anywhere in the runtime. Confirmed via a full-repo grep that the only
non-test references to `capabilityGroups` before this phase were `@nextbot/contracts`'
schema and `DesignModeForm.tsx`'s own (now-replaced) free-text field — this gap
predates both this phase and Phase 9's Design Studio form; it was not introduced by
either.

The security test the dispatch asked for ("a stale/cross-tenant group name resolves to
zero tools, never full access") **could not be written**, because there is no runtime
resolution code path to exercise — writing a test against nonexistent code would
fabricate a result rather than verify one. This phase's own UI change does not create
a new authorization surface (additive data entry over an already-inert artifact
field), but the underlying feature this field implies — `toolPolicy.capabilityGroups`
actually restricting which tools an agent can call — **is not implemented anywhere**.
Practically: every deployed agent today can call every Active tool the tenant has,
regardless of what's configured in this field, in Design mode, Text mode, or raw YAML
directly. Recommending the orchestrator track "wire `toolPolicy.capabilityGroups` into
the real turn-pipeline/tool-dispatch resolution path" as its own backlog item — a
`turn-pipeline.ts`/`goal-selection.ts` change, itself security-relevant and deserving
its own dedicated dispatch + immediate QA, not silently folded into a future phase's
unrelated scope.

**Verification, real, not assumed:** `pnpm --filter @nextbot/tool-registry run
typecheck` and `pnpm --filter nextbot-web run typecheck` both clean; targeted
`eslint --max-warnings=0` on every changed/added file clean; full repo `pnpm run
lint:boundaries` clean (0 violations, 1889 modules/4664 dependencies). Full `pnpm
vitest run --project unit` suite (206 files/1253 tests) green — including fixing an
incidental regression this phase's own new fetch introduced in
`VersionEditor.test.tsx` (its Design-tab tests share a mocked `fetchJson` that now
also serves `DesignModeForm`'s new capability-groups fetch; updated to discriminate by
URL rather than working around it). Stood up the project's own ephemeral
`compose.test.yml` fresh (`down -v`/`up -d`), ran `packages/db`'s real `migrate:test`
(32/32 migrations), ran the full `pnpm vitest run --project integration` suite (76
files/331 tests) green, including a new `capability-group-repository.int.test.ts` (2
tests, real Postgres, two real `createFixtureTenant` tenants — not a mock) proving
genuine cross-tenant isolation and an accurate live tool count per group. Coverage on
changed/added files: `DesignModeForm.tsx` 100% stmts/lines, 85.86% branch, 92.85%
funcs; `admin-routes.ts` 91.89%; the new `capability-groups/route.ts` 81.81%
(uncovered: the generic `catch`->`problemResponse` line, matching this codebase's
existing convention of not synthetically forcing that branch). Ephemeral test stack
torn down (`down -v`) and the throwaway `.env.test` (copied from `.env.test.example`
for this run) deleted afterward — nothing left running or committed.

**Files changed:** `packages/modules/tool-registry/src/infrastructure/
capability-group-repository.ts`, `packages/modules/tool-registry/src/infrastructure/
capability-group-repository.int.test.ts` (new), `packages/modules/tool-registry/src/
http/admin-routes.ts`, `packages/modules/tool-registry/src/http/admin-routes.test.ts`,
`packages/modules/tool-registry/src/index.ts`,
`apps/web/app/api/v1/admin/tools/capability-groups/route.ts` (new),
`apps/web/app/api/v1/admin/tools/capability-groups/route.test.ts` (new),
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/DesignModeForm.tsx`,
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/DesignModeForm.test.tsx`,
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/DesignModeForm.round-trip.test.ts`,
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.test.tsx`,
`docs/plans/client-feedback-batch-plan.md`, `docs/NEXUS_STATE.md`.

`current_phase` left as `development` — **NOT marking this QA-approved. This phase's
finding is security-relevant per this project's own classification: recommend
`nexus-qa` review it immediately (not batched with Phase 11), specifically to
independently confirm the "no runtime enforcement of `toolPolicy.capabilityGroups`
exists" finding and help the orchestrator decide whether it needs its own urgent
backlog item before this feature is complete end-to-end.**

## Phase 17 — implementation notes (2026-08-23, SECURITY-RELEVANT — flush to QA immediately, do not batch)

**Goal:** close the exact gap Phase 10 found and left unfixed — an agent's
`toolPolicy.capabilityGroups` (Design Studio picker, Phase 10) is now genuinely
enforced at turn-run time, not merely persisted.

**Wiring added (both layers, matching the codebase's own existing Tool/Connector/
BackendType rule idiom):**
1. **Pre-filter (efficiency/UX).** `tool-repository.ts`'s `listTools` gained an
   `allowedCapabilityGroupIds?: string[]` filter. `undefined` (unset) = no filter
   applied at all — every pre-existing caller (Admin Console's Tool Catalog screen,
   every pre-Phase-17 turn) is byte-for-byte unaffected. A real array — including an
   empty one — restricts results to `capability_group_id IS NULL OR capability_group_id
   IN (...)`; drizzle's `inArray([])` already compiles to `false`, so an empty array
   correctly excludes every *grouped* tool while leaving ungrouped tools untouched.
2. **Name → id resolution.** New `capability-group-repository.ts` function
   `resolveCapabilityGroupIdsByNames(ctx, names)` — tenant-scoped by construction (RLS
   + explicit `tenant_id` filter), so a name colliding with a different tenant's group
   can never resolve to that tenant's id. A stale/deleted name silently contributes
   nothing (shorter result array), never an error.
3. **Authorization-layer re-check (defense in depth).** `permission-resolver.ts`'s
   `resolvePermission` gained a new fail-closed step 4 (before rule-scope matching):
   `ResolverTool.capabilityGroupId` vs. `ResolverContext.allowedCapabilityGroupIds`.
   Same `undefined` = no restriction / real array (possibly empty) = active restriction
   semantics as the pre-filter, so the two layers can never silently disagree. New deny
   reason: `capability_group_not_permitted`. `permission-service.ts`'s
   `simulatePermission`/`resolveToolPermission` were **not** given a new parameter —
   `ResolverContext` already carries `allowedCapabilityGroupIds`, so it flows straight
   through from whatever `resolverCtx` the caller supplies (the admin "simulate" panel
   supplies none, so it is completely unaffected).
4. **Version → policy read.** New `agent-platform` export `getVersionToolPolicy(ctx,
   versionId)` — a deliberately lightweight read (NOT `getVersion()`, which also
   computes `_allowedTransitions`/eval-run status the turn pipeline has no use for on
   every customer message). Parses `definitionYaml` defensively: an unparsable YAML or
   missing `toolPolicy` node degrades to `capabilityGroups: []` (logged, never thrown)
   — this is the same value as a deliberate "no restriction" configuration, not a
   special fail-open carve-out, and enforcement still holds because the resolver-layer
   check is independent of this read succeeding.
5. **`turn-pipeline.ts`** resolves `allowedCapabilityGroupIds` once per turn (only when
   `agentDefinitionVersionId` is supplied — the Phase 13 additive field), reuses it for
   both the catalog pre-filter and threads it into `runTierEngine`'s `resolverCtx`, so
   both layers see the exact same restriction.

**"Empty `capabilityGroups`" semantics — decision and why:** empty array = **no
restriction, all tools allowed** (matches today's de facto behavior for every
pre-Phase-17 agent, explicitly confirmed unaffected: Phase 1's seeded "Support
Assistant" has `capabilityGroups: []` and stays fully functional). A **non-empty**
array that resolves to zero real ids (every configured name stale/deleted) is treated
as a genuinely different, active, and maximally restrictive state: every *grouped*
tool is denied. An **ungrouped** tool (`capabilityGroupId: null`) is unaffected by any
restriction, matching `DesignModeForm.tsx`'s own already-shipped field hint ("a tool
with no group assigned is unaffected by this list") — this existing UI copy is what
resolved the ambiguity; no architecture doc addresses the ungrouped-tool case
explicitly, but the already-live product copy did, and following it took precedence
over inventing new semantics. One accuracy gap was found and fixed in that same
component: the state "real groups exist but this agent's list is empty" had no
explanatory copy and could be misread as "restricted to nothing selected" (deny-all) —
added a distinct hint line for exactly that state.

**Verification, real, not assumed (adversarial before/after):**
- Reproduced the original gap first: with the capability-group check in
  `permission-resolver.ts` and the filter in `tool-repository.ts` both temporarily
  disabled (a literal `false &&` short-circuit spliced into each, verified via a
  before/after diff, not merely asserted), reran this dispatch's own new tests — 5 of
  them failed exactly as expected, including a `runTierEngine` call that returned
  `Tier1Executable`/`Allow` instead of the required `PolicyDenied`/`Deny
  capability_group_not_permitted`, and a real HTTP-mock capture showing the
  restricted tool's id present in the model's system prompt. Restored the fix,
  reran — all green again. This is the adversarial "before" proof the dispatch asked
  for, not a description of intended behavior.
- After the fix: `orchestration-tier-engine.int.test.ts` (new Phase 17 describe
  block, `apps/gateway`, real Postgres) drives `runTierEngine` directly —
  independent of the catalog pre-filter — proving the resolver-layer check alone:
  denies a mismatched group, allows a matching group, allows an ungrouped tool under
  an active restriction, and is a no-op when `allowedCapabilityGroupIds` is
  `undefined`.
- `orchestration-turn-pipeline.int.test.ts` (new Phase 17 describe block) drives the
  real `runTurnPipeline` end-to-end with a real deployed `agent_definition_version`
  (via `handleCreateDefinition`/`handleCreateVersion`, real Postgres, no mocked
  business logic beyond the model-call/tool-discovery boundary this file's other
  tests already mock): confirms the restricted tool never appears in the model's
  system prompt, a forced-hallucination attempt still never reaches egress (goal
  -selection's own catalog-membership guard adds a *third* layer here), a
  correctly-scoped tool remains fully callable, a stale/deleted group name denies
  outright, the Phase 1 seed-data shape (`capabilityGroups: []`) is completely
  unaffected, an ungrouped tool stays callable under an active restriction, and
  cross-tenant group-name collision never grants access.
- New `agent-definition-service.get-version-tool-policy.int.test.ts` (real Postgres)
  covers `getVersionToolPolicy`'s real-artifact and defensive-degrade paths
  (corrupt YAML, missing `toolPolicy` node) directly, including asserting the
  logged-not-thrown behavior via a `console.error` spy.
- Full regression: `pnpm turbo run typecheck` (31/31 packages green), `pnpm run
  lint` and `pnpm run lint:boundaries` both clean (0 violations, 1890 modules/4673
  dependencies). Full `pnpm vitest run --project unit --project integration
  --project isolation` suite green: 293 files / 1681 tests (one
  `DefinitionDetail.test.tsx` timing flake seen on a combined run, confirmed
  unrelated — passes in isolation, and the file/area was untouched by this
  dispatch). Coverage on the files this dispatch touched: `permission-resolver.ts`
  91.17% lines/90.32% branch, `tool-repository.ts` (new filter path) 100%,
  `capability-group-repository.ts` 100%, `tier-engine.ts` 92.59%, `turn-pipeline.ts`
  79.82% lines (the uncovered lines are pre-existing Tier-3/egress-error branches
  this dispatch did not touch, not new code), `agent-definition-service.ts`'s new
  `getVersionToolPolicy` fully covered by its dedicated integration test (the
  file's aggregate 70.17% reflects other, pre-existing, untouched functions in the
  same file).

**Files changed:** `packages/modules/tool-registry/src/infrastructure/
tool-repository.ts`, `packages/modules/tool-registry/src/infrastructure/
capability-group-repository.ts`, `packages/modules/tool-registry/src/domain/
permission-resolver.ts`, `packages/modules/tool-registry/src/domain/
permission-resolver.test.ts`, `packages/modules/tool-registry/src/application/
permission-service.ts`, `packages/modules/tool-registry/src/index.ts`,
`packages/modules/agent-platform/src/application/agent-definition-service.ts`,
`packages/modules/agent-platform/src/application/
agent-definition-service.get-version-tool-policy.int.test.ts` (new),
`packages/modules/agent-platform/src/index.ts`, `packages/modules/orchestration/src/
application/turn-pipeline.ts`, `apps/gateway/src/lib/
orchestration-turn-pipeline.int.test.ts`, `apps/gateway/src/lib/
orchestration-tier-engine.int.test.ts`,
`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/DesignModeForm.tsx`,
`docs/plans/client-feedback-batch-plan.md`, `docs/NEXUS_STATE.md`.

`current_phase` left as `development` — **NOT marking this QA-approved.** This is the
highest-risk phase in the whole batch (live orchestration/authorization code) and is
explicitly security-relevant per this project's own classification: `nexus-qa` should
review it immediately, independently reproducing at least the adversarial before/after
proof above and the tenant-isolation test, before this is considered done.


## Phase 11 — QA close-out verification (2026-08-28, final phase of the whole plan)

**Scope:** independent QA verification of the four batched Phase 11 implementation
passes (mechanical FieldHint tooltip rollout across the remaining admin console
screens — Batch A: Conversations/Escalations/Approvals/Channels; Batch B:
Connectors/Tools/MCP Health; Batch C: remaining Agent Platform screens; Batch D:
Settings/Roles/Audit Log), plus a full-repo regression sweep since none of the four
batches had access to a live browser in their own sandboxes.

**Full repo-wide regression, run fresh (not just Phase 11's own files):**
`pnpm turbo run typecheck` (31/31 packages green), `pnpm run lint` (clean,
`--max-warnings=0`), `pnpm run lint:boundaries` (clean, 0 dependency-cruiser
violations, 1890 modules/4697 dependencies), full `pnpm vitest run --project unit`
(206 files/1258 tests, all green, no regressions across Phases 1-10, Phase 11, or the
capability-group runtime-enforcement follow-up).

**Live browser pass** (against the project's own already-running `docker-compose.yml`
stack — found already up via `docker ps`, real seeded `demo`-tenant data, left running
unchanged after verification): sampled one screen per batch — Conversations filters
(A), the Connector Wizard (B), Evals including its "+ New Eval Suite" dialog (C), and
PII & Guardrails (D). Playwright (Chromium) + `@axe-core/playwright` installed ad hoc
into a scratch npm project (not added to the repo), deleted after the run.

- **FieldHint rendering:** 20/20 sampled hints (5 per screen) rendered their claimed,
  field-accurate one-sentence copy on hover, with stable caller-supplied `id`s
  matching the convention the earlier tooltip-hydration fix pass established.
- **Hydration-mismatch regression check** (this batch's documented recurring bug class
  across `Tooltip`/`FieldHint`, `Collapsible`/`SidebarSection`, and 4 other audited
  primitives): 10 fresh hard-navigation loads per sampled screen — **0/10 on all four
  screens**, no other console errors either.
- **Live axe-core scan** (`wcag2a`/`wcag2aa`): **0 violations** on all four sampled
  screens, both default state and with the Evals dialog open.

**Deliberate-skip spot-check:** read `ToolPermissionRules.tsx` (Batch B) and
`RoleCheckboxList.tsx` (Batch D) in full — both confirmed to genuinely have no
`<Label htmlFor>` a `FieldHint` could attach beside (table-column `aria-label`s and
implicit-label-wrapped checkboxes respectively), not silently missed work.

**Verdict: PASS.** Full report:
`qa-results/client-feedback-batch-phase11-close/20260828-231900/REPORT.md`. This
closes Phase 11 and, with it, the entire client-feedback-batch initiative (Phases
1-10, Phase 11, and the user-authorized capability-group runtime-enforcement
follow-up) — all QA-green. No blocking defects; nothing outstanding in this
initiative's scope.