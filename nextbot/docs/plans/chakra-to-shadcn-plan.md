# Chakra UI → shadcn/ui + Tailwind CSS v4 migration

Authoritative source: `C:\Users\m.hassan\.claude\plans\instead-of-chackraui-modify-frolicking-haven.md`
(full context, component-mapping table, batch order — this repo-local doc only tracks
phase status per this project's standing nexus-dev convention).

Preset: `ui.shadcn.com/create?preset=b5rR41Mtnc` — Style "Lyra" (resolved to the CLI's
`base-lyra` style + `@base-ui/react` primitive library, not Radix — see Phase 0 status
note below), Base Color "Stone", Theme/Chart Color "Orange", Radius "None", Heading
font Oxanium, Body font Outfit, Icon Library Hugeicons.

## Phase 0 — shadcn/Tailwind v4 setup (`apps/web` + `packages/ui`) — DONE

**Goal.** Tailwind v4 + shadcn CLI wired into `apps/web`, with generated primitives
physically homed in `packages/ui/src/components/ui` (the shared component package
for both apps, per Plan Phase 4), zero behavioral change yet.

**Scope.** `apps/web`: `tailwindcss`/`@tailwindcss/postcss`/`postcss` (devDependencies),
`postcss.config.mjs`, `app/globals.css`, `components.json` (aliases pointed at
`@nextbot/ui/components/...` via a `paths` entry added to `tsconfig.json`), baseline
primitives (`button`, `input`, `label`, `card`, `badge`, `separator`, `skeleton`,
`alert`, `tooltip`) plus `avatar`/`breadcrumb`/`switch` (needed one phase early by
Phase 1's shell/branding work, pulled forward rather than re-dispatching Phase 0).
`packages/ui`: new `exports` subpaths (`./components/*`, `./lib/*`, `./branding/*`),
new dependencies (`@base-ui/react`, `@hugeicons/*`, `class-variance-authority`,
`clsx`, `tailwind-merge`). Out of scope: `apps/widget-embed` (Plan Phase 5).

**Deviation from the plan's literal wording (local/reversible, noted per this
project's convention):** the preset's "Lyra" style resolves in the actual shadcn CLI
to `base-lyra` using **Base UI (`@base-ui/react`)** as the primitive library, not
Radix — the plan's Phase 4 text assumed "the `@radix-ui/*` primitives each shadcn
component needs," written before the real preset was pulled. This is what the CLI
authoritatively produced for the exact preset code the user supplied; not something
to override. Every "Radix gotcha" callout in the dispatch prompt (disabled-tooltip
hover, etc.) has a direct Base UI equivalent and was handled the same way.

**Exit gate.** `pnpm turbo run typecheck` (31/31 packages), `pnpm run lint`,
`pnpm run lint:boundaries` all green; zero behavioral change (Chakra still the only
thing actually rendering at this point in the dispatch).

## Phase 1 — Branding mechanism + root layout/shell/login cutover (`apps/web`) — DONE

**Goal.** Real per-tenant CSS-custom-property branding, `AdminShell`/`LoginForm`/root
layout fully on shadcn/Tailwind, with a temporary Chakra shim keeping the ~45-50
not-yet-migrated screens rendering correctly one level down.

**Scope.**
- `apps/web/src/lib/build-brand-style-tag.ts` (new) — computes the literal
  `:root{--primary;--primary-foreground;--brand-sidebar;}` string. **Placed in
  `apps/web`, not `packages/ui`** (deviation, local/reversible, noted): reusing
  `@nextbot/tenancy`'s `checkContrastRatio` (per the plan's explicit "do not invent a
  second contrast algorithm" instruction) from `packages/ui` would violate this
  repo's `eslint-plugin-boundaries` rule that "shared" packages may only depend on
  other "shared" packages, never a "module" package — `apps/web` is the composition
  root and may depend on both, so the utility lives there instead.
- `apps/web/app/(admin)/layout.tsx` — renders the SSR'd `<style>` tag before
  `{children}`.
- `apps/web/app/(admin)/AdminShell.tsx` — full shadcn/Tailwind rebuild (nav, Avatar,
  Badge, Breadcrumb, sign-out Button), RTL logical-property classes throughout
  (`ps-*`/`pe-*`/`ms-*`/`me-*`, never `pl-*`/`pr-*`/physical `left`/`right`), temporary
  nested `<ChakraProvider>` around `{children}` only.
- `apps/web/app/(admin)/settings/branding/BrandingSettings.tsx` — chrome restyled on
  shadcn primitives; live-preview swatches kept as plain inline-styled divs, unchanged.
- `apps/web/app/layout.tsx` — drops `<AppProviders>` (Chakra), Tailwind `globals.css`
  + `next/font/google` (Oxanium `--font-heading`, Outfit `--font-sans`) + a
  `<TooltipProvider>` mount.
- `apps/web/app/login/LoginForm.tsx` — full shadcn/Tailwind conversion; `warning`
  Alert variant added locally to `packages/ui/src/components/ui/alert.tsx`; SSO
  tooltip-on-disabled-button uses the "wrap the disabled control in a real trigger
  element" pattern (a `<span tabIndex={0}>` as the Tooltip's `render` target).
- `apps/web/app/forgot-password/page.tsx` — **pulled forward from its own screen
  batch** (not explicitly named in Plan Phase 1's item list) because the root
  layout no longer mounts any Chakra provider at all; leaving this page's Chakra
  markup unconverted would have shipped a real, undisclosed regression (unstyled/
  context-less Chakra components) rather than a deferred one.

**Deliberately deferred / stubbed (noted, not silently skipped):**
- The ~45-50 still-Chakra screens under `(admin)/**` are untouched — that's Plan
  Phase 2, a later dispatch.
- `apps/widget-embed` is untouched — Plan Phase 5.
- ADR-0010 (correcting ADR-0002 §4.2a) is not written yet — Plan Phase 7, after the
  migration is functionally complete on both apps.

**Security review.** No new endpoints/auth surfaces this phase; `LoginForm`'s
password show/hide, lockout-vs-wrong-password distinction, and SSO honest-inert
state are UI-only re-implementations of already-reviewed server-side logic (no
change to `actions.ts`). `build-brand-style-tag.ts` re-validates the hex pattern
defensively before string-interpolating into a literal `<style>` tag (defense in
depth against a malformed/legacy row, even though `TenantBrandingSchema` already
validates on write).

**Verification performed (see dispatch report for full detail):**
- `pnpm turbo run typecheck` — 31/31 green.
- `pnpm run lint` / `pnpm run lint:boundaries` — clean (0 eslint errors, 0
  dependency-cruiser violations).
- Full test suite: 845/845 unit, 283/283 integration, 76/76 isolation.
- Coverage on files this dispatch added/changed: `AdminShell.tsx` 97.4%,
  `LoginForm.tsx` 96.4%, `BrandingSettings.tsx` 95.4%, `build-brand-style-tag.ts`
  100%, `forgot-password/page.tsx` 100% (new test added this dispatch). Root
  `layout.tsx` / `(admin)/layout.tsx` are at their pre-existing 0% (this codebase's
  established convention of not unit-testing thin Server Component layout
  wrappers — not a new gap introduced by this dispatch).
- **Real SSR verification (not devtools-only):** seeded the standard `demo` tenant
  fixture (`pnpm db:seed`), set a real `branding_config` (`primaryColor:#123456`,
  `secondaryColor:#abcdef`) + `white_label_enabled:true` directly in the test
  Postgres, minted a real signed session JWT with `issueSessionToken`, and fetched
  `/dashboard` from a live `next dev` process with that cookie — the raw HTML
  contained the literal `<style>:root{--primary:#123456;--primary-foreground:#ffffff;--brand-sidebar:#abcdef;}</style>`
  tag. Branding reverted to the default (off) afterward.
- Spot-checked 3 still-Chakra screens (`/connectors`, `/roles`,
  `/agent-platform/definitions`) rendering correctly nested under the temporary
  shim via the same live server.
- Re-verified every previously-QA-fixed a11y item named in the dispatch: focus
  rings (shadcn/Base UI's `focus-visible:ring-*` classes, real and visible, carried
  over from the preset), avatar contrast (`bg-[#4338ca] text-white` — the exact
  hex previously measured at ~7.9:1), SSO tooltip fires on a disabled button (the
  wrapping-span pattern, confirmed in the real SSR'd HTML), lockout visual
  distinction (`warning` Alert variant, amber vs. destructive-red), password
  show/hide `aria-pressed`/`aria-label`/`tabIndex={-1}` (unit-tested).
- Found and fixed one real defect during self-verification (not shipped and then
  caught by QA): the breadcrumb's `BreadcrumbSeparator` was nested inside
  `BreadcrumbItem` (both render `<li>`), producing a real hydration-error warning
  (`<li> cannot be a descendant of <li>`) — fixed by hoisting the separator to a
  sibling position via `Fragment`.

### QA fix pass (retry 1 of 3, 2026-08-18) — defects D1–D5

QA's Phase 0/1 report (`qa-results/chakra-shadcn-phase0-1/20260818-010000/REPORT.md`)
found 4 defects + 1 rough edge, all fixed in this pass (scope held strictly to
D1–D5 — no Phase 2 work pulled forward, no re-plan):

- **D1** (moderate, `LoginForm.tsx`): tenant/email are now controlled inputs so
  `useActionState`'s auto form-reset no longer wipes them on a failed login;
  password stays uncontrolled (clearing it on failure is correct, per
  `UX_GUIDELINES.md` §2.1).
- **D2** (moderate a11y): all three error `Alert`s in `LoginForm.tsx` (login/MFA
  challenge/MFA enrollment) now get `ref` + `tabIndex={-1}` + a `useEffect` that
  moves focus onto them when their action state carries an error.
- **D3** (minor): the SSO `TooltipTrigger` now takes an explicit stable
  `id="login-sso-tooltip-trigger"` instead of Base UI's generated
  `React.useId()`-derived one, eliminating the console hydration-mismatch warning.
- **D4** (CRITICAL a11y, `BrandingSettings.tsx`): both hex-color text `Input`s
  (primary/secondary) now have their own `id` + `aria-label` distinct from the
  color-swatch's existing `Label htmlFor`.
- **D5** (rough edge, `packages/ui`): strengthened the default focus ring from
  1px/50%-opacity to a fully-opaque 2px ring on `Input`/`Button` (and, for
  consistency, `Switch`/`Badge`), meeting the project's established ≥3:1
  focus-ring contrast bar.

Verified D1/D2/D3/D4 live against a real Chromium browser (Playwright) driving a
local `next dev` wired to the already-running docker-compose Postgres/Redis stack
and the real seeded `demo` tenant (`SEED_CREDENTIALS.md`) — not just unit tests.
Full suite (`pnpm test:unit`: 148 files/848 tests), `pnpm lint`, and
`pnpm typecheck` (all 31 packages) are green. See `docs/NEXUS_STATE.md`'s decision
log (2026-08-18 entry) for the full write-up.

### QA fix pass (retry 2 of 3, 2026-08-18) — defects D6–D7

QA's retry-1 re-verification found D1–D5 genuinely fixed but surfaced 2 new
defects (D6 significant, D7 minor); scope held strictly to these two — D1-D5
untouched, no Phase 2 work pulled forward:

- **D6** (significant, `packages/ui/src/theme.ts`): the temporary
  `ChakraProvider` shim's `styles.global` carried a bare, unscoped
  `:focus-visible` rule that won the cascade over shadcn's own focus ring on
  every admin screen nested under `AdminShell.tsx`'s shim (i.e. virtually the
  whole admin console) — D5's fix was only actually rendering on `/login`, the
  one screen not nested under the shim. Fixed by scoping the selector to
  `[class*='chakra-']:focus-visible` — every Chakra v2 component applies a
  `chakra-*` class to its own root element (`chakra-input`, `chakra-button`,
  `chakra-checkbox`, ... confirmed directly against the installed
  `@chakra-ui/react` package's compiled output), so this keeps the rule
  applying only within Chakra's own component subtree without leaking onto
  shadcn/Base UI's un-prefixed elements. The existing per-component
  `Link`/`Button` `_focusVisible` overrides were already correctly scoped (they
  compile to component-local emotion CSS, not a global rule) and were left
  unchanged.
- **D7** (minor, `ModelGateway.tsx`, still-Chakra screen): an intermittent
  hydration-mismatch console error from Chakra's `FormControl`/`FormLabel`
  `useId()`-derived id/htmlFor differing between SSR and hydration — same
  defect family as D3, different component. Fixed with the same pattern D3
  used: pinned explicit, literal `id`s on all 5 `FormControl`s in the file
  (Route Key/Cache mode/Semantic threshold/Total timeout, each a page
  singleton, plus a per-index id for the "own endpoint" API-key `FormControl`
  inside the chain-entry list). Since this screen is still Chakra and slated
  for a full shadcn conversion in Phase 2, no deeper structural rework was done
  here — the id-pin is the minimal, safe fix; the rest of the id-stability
  question is moot once this screen converts.

Added a regression test for each: `packages/ui/src/components/AppProviders.test.tsx`
asserts `theme.styles.global` no longer contains the bare `:focus-visible` key
and does contain a `chakra-`-scoped one; `ModelGateway.test.tsx` asserts the
three singleton `FormControl`s carry their pinned literal ids. Full suite
independently re-run: unit 850/850 (848 + 2 new), integration 283/283, isolation
76/76, `pnpm typecheck` 31/31 packages clean, `pnpm lint` clean, `pnpm
lint:boundaries` clean. No security-relevant surface touched (CSS scoping +
static id attributes only); D6/D7 are UI-only fixes. See `docs/NEXUS_STATE.md`'s
decision log for the full write-up. Ready for QA re-review — `qa_retry_count`/
`pending_qa` left untouched for the orchestrator to manage.

## Phase 2 — `apps/web` screen-by-screen sweep

Batches A–D per the authoritative plan's component-mapping table and batch order.
Each batch is its own nexus-dev → nexus-qa dispatch.

### Batch A — `dashboard` + simple `settings/*` screens — IMPLEMENTED, PENDING QA

**Goal.** Convert `dashboard` and the six simple `settings/*` screens
(`pii-guardrails`, `data-policy`, `dsr`, `connector-alerts`, `escalation-routing`,
`integrations` incl. its `git-callback` sub-route) from Chakra to shadcn/Tailwind,
per the component-mapping table.

**Scope.**
- `apps/web/app/(admin)/dashboard/page.tsx` — trivial `Heading`/`Text` → `h1`/`p`.
- `apps/web/app/(admin)/settings/pii-guardrails/PiiGuardrailSettings.tsx`,
  `settings/data-policy/DataPolicySettings.tsx`, `settings/dsr/DsrTool.tsx`,
  `settings/connector-alerts/ConnectorAlertConfig.tsx`,
  `settings/escalation-routing/RoutingConfig.tsx` — full conversion: `Box`/`Flex`/
  `HStack`/`VStack` → `div`+Tailwind, `Table` family → shadcn `Table` family,
  `Select`/`Checkbox`/`Switch` → new shadcn `Select`/`Checkbox` primitives (bare, no
  RHF/`Form` wrapper — none of these screens use React Hook Form) + existing
  `Switch`, `Alert`/`AlertIcon` → `Alert`/`AlertDescription` (reusing the `warning`
  variant where applicable), `Spinner` → shadcn `Skeleton` (`role="status"` +
  `aria-label`, matching the existing convention), added `Label`s on every input
  that only had visual/placeholder text before (a11y audit finding, not a
  regression — the Chakra originals had the same gap).
- `apps/web/app/(admin)/settings/integrations/GitConnectionCard.tsx` — `useToast` →
  the new Sonner-shaped `toast` API (`@nextbot/ui/lib/toast`), `AlertDialog` family →
  new shadcn `AlertDialog` primitive (Base UI-backed), `ButtonGroup`/`FormControl` →
  Tailwind + `Label`/`Input`.
- `apps/web/app/(admin)/settings/integrations/git-callback/page.tsx` — same
  `useToast` → `toast` conversion; added a screen-reader-only `h1` to every
  early-return state (loading/cancelled/error) — axe-core's `page-has-heading-one`
  correctly flagged these states as headless (the pre-conversion Chakra version had
  the same gap; fixed here since these are the exact routes in scope).
- New shared shadcn primitives, hand-authored (see deviation below):
  `packages/ui/src/components/ui/select.tsx`, `checkbox.tsx`, `table.tsx`,
  `alert-dialog.tsx`, `toast.tsx` + `packages/ui/src/lib/toast.ts`.
- `apps/web/app/layout.tsx` — mounts `<Toaster />` alongside the existing
  `<TooltipProvider>`.
- Test updates in the same dispatch: `RoutingConfig.test.tsx` (native-`<select>`
  `fireEvent.change` → open-then-click-option against the new `Select`, plus a
  `pointerdown`-before-`click` helper Base UI's `Select.Item` requires to commit a
  mouse selection under `fireEvent`). `GitConnectionCard.test.tsx` and
  `git-callback/page.test.tsx` needed no structural changes (same button
  roles/text survive the conversion).

**Deviation from the dispatch prompt (local/reversible, noted):** the prompt's
mapping table calls for a "Sonner-based toast." The `sonner` npm package could not
be installed this dispatch (no network access to the registry in this
environment — the same constraint Phase 0 hit with the shadcn CLI itself).
`@base-ui/react`'s own `Toast` primitive (already this project's adopted primitive
library) covers the identical need — a module-level `toastManager` singleton +
imperative `toast(...)`/`toast.success(...)`/`toast.error(...)`/`toast.info(...)`/
`toast.warning(...)` call sites, exactly the ergonomics the mapping table asks
for — so it was used instead of blocking the dispatch. `select.tsx`, `checkbox.tsx`,
`table.tsx`, and `alert-dialog.tsx` were hand-authored the same way (network access
to `npx shadcn@latest add ...` was unavailable for the same reason), built directly
on the already-vendored `@base-ui/react` primitives (`select`, `checkbox`,
`alert-dialog`) and matched to this package's existing generated components'
conventions (`rounded-none`, the strengthened 2px focus ring, `cn`/`data-slot`).

**Exit gate.**
- `pnpm turbo run typecheck` — 31/31 packages green.
- `pnpm run lint` / `pnpm run lint:boundaries` — both clean.
- Full test suite: 850/850 unit (148 files), 283/283 integration, both re-run
  fresh; two unrelated transient timeouts (`dsr-admin.int.test.ts`,
  `packages/modules/iam/.../admin-routes.test.ts`, both pre-existing/out-of-scope
  files under system load from a concurrent test run) reproduced as clean passes
  in isolation.
- Axe-core: a real Playwright + `@axe-core/playwright` scan (not assumed) against
  a live `next dev` process wired to the existing test Postgres/Redis
  (`compose.test.yml`), logged in as the seeded `demo` tenant's Tenant Admin,
  across all 7 top-level routes in scope (`/dashboard`, the 6 `/settings/*`
  screens) plus the `git-callback` sub-route's cancelled/loading/error states —
  **0 violations across 3 consecutive full re-scans**, after fixing two real
  defects the scan caught (see below).
- Confirmed a real functional round trip through the new `Select` (PII Guardrails'
  entity-type picker) in the same live browser session, not just unit-test mocks.

**Real defects found and fixed via the axe-core scan (not shipped and later
caught):**
1. `aria-prohibited-attr` (serious): every `Skeleton` loading placeholder carried
   a bare `aria-label` on a plain `<div>` (implicit `role="generic"`, which
   prohibits accessible-name-conveying attributes per the ARIA-in-HTML spec).
   Fixed by adding `role="status"` alongside the existing `aria-label` on every
   `Skeleton` usage in this batch's files.
2. `page-has-heading-one` (moderate): three early-return loading/terminal states
   replaced the whole screen with no `h1` at all —
   `DataPolicySettings.tsx`/`RoutingConfig.tsx`'s full-page loading `Skeleton`
   return, and `git-callback/page.tsx`'s cancelled/loading/error states (only its
   "picking" state had a real `h1`). Fixed with a screen-reader-only `h1` in each
   state, worded to avoid colliding with existing test assertions on nearby
   visible text.

**Deliberately deferred / out of scope (noted, not silently skipped):**
- `StatusBadge.tsx` (still Chakra, consumed by `GitConnectionCard.tsx`) is
  untouched — Plan Phase 4 rebuilds it; it renders correctly today because it's
  still nested under `AdminShell.tsx`'s temporary `ChakraProvider` shim.
- Batches B (`roles/*`), C (`conversations`/`approvals`/`escalations`/`channels`/
  `connectors`), D (`agent-platform/*`/`tools`/`mcp-health`/`audit-log`) are
  untouched — later dispatches.
- A pre-existing a11y gap noticed but **not** fixed here (outside this batch's
  scope, flagged rather than silently patched): `BrandingSettings.tsx`
  (Phase 1, already QA-passed) has the same bare-`aria-label`-on-`Skeleton`
  pattern this batch just fixed elsewhere — it wasn't caught by Phase 1's QA scan
  because that screen's data loads fast enough that the skeleton is rarely
  actually visible at scan time, but the same underlying `aria-prohibited-attr`
  defect is latent there. Worth a one-line fix (`role="status"`) whenever that
  screen is next touched.

**Security review.** No new endpoints/auth surfaces this batch — every screen's
existing RBAC gating (`getModuleAccessLevel`, `AccessDeniedState`) and
403-vs-empty-result handling (`fetchJson`'s `forbidden` kind) is unchanged, only
the visual layer moved. `AlertDialog`'s destructive-confirm behavior (Git
disconnect) preserves the same "no accidental dismiss" intent the Chakra
`leastDestructiveRef` version had.

### Batch B — `roles/*` (Modal→Dialog family, Table family, permission matrix) — IMPLEMENTED, PENDING QA

**Goal.** Convert `RolesList`, `RolesTable`, `UsersTable`, `RoleFormModal`,
`InviteUserModal`, `ChangeRolesModal`, `PermissionMatrixEditor`, `RoleCheckboxList`,
`SsoGroupMappingSection` from Chakra to shadcn/Tailwind, per the component-mapping
table.

**Scope.**
- `apps/web/app/(admin)/roles/RoleFormModal.tsx`, `InviteUserModal.tsx`,
  `ChangeRolesModal.tsx` — `Modal` family → new shadcn `Dialog` family.
- `apps/web/app/(admin)/roles/RolesTable.tsx`, `UsersTable.tsx` — `Table` family →
  Batch A's existing shadcn `Table` family; `Tooltip` (system-role Edit disabled
  state) → Batch A's existing shadcn `Tooltip`, same disabled-button-wrapped-in-a-
  focusable-span pattern `LoginForm.tsx` established; `useToast` → Batch A's `toast`
  API.
- `apps/web/app/(admin)/roles/PermissionMatrixEditor.tsx` — `Table` + `Select` per
  row → shadcn `Table` + Batch A's existing shadcn `Select` (bare, no RHF wrapper —
  this component is local-`useState`-driven, matching the dispatch's guidance).
- `apps/web/app/(admin)/roles/RoleCheckboxList.tsx` — `CheckboxGroup`/`Checkbox` →
  bare shadcn `Checkbox` wrapped in `Label` (Base UI's `Checkbox` auto-detects a
  wrapping native `<label>` ancestor and sets `aria-labelledby` accordingly — same
  pattern Batch A's `DataPolicySettings.tsx` already established).
- `apps/web/app/(admin)/roles/RolesList.tsx` — `Tabs`/`TabList`/`Tab`/`TabPanels`/
  `TabPanel` → a **new** shadcn `Tabs` family (not previously built by Batch A);
  `Spinner` → shadcn `Skeleton`.
- `apps/web/app/(admin)/roles/SsoGroupMappingSection.tsx` — `Alert`/`AlertIcon` →
  shadcn `Alert`/`AlertDescription`.
- New shared shadcn primitives, hand-authored (same network-access constraint as
  Batch A — see its deviation note): `packages/ui/src/components/ui/dialog.tsx`
  (plain `Dialog`, distinct from Batch A's `AlertDialog` — allows outside-click/
  Escape dismissal, correct for a routine create/edit form vs. a destructive
  confirmation), `packages/ui/src/components/ui/tabs.tsx`.
- Test updates in the same dispatch: `RolesTable.test.tsx` (added a regression test
  for the empty-header defect found below), `UsersTable.test.tsx` (`getByLabelText`
  → `getAllByLabelText(...)[0]` for `Checkbox` queries — Base UI's `Checkbox`
  associates its wrapping `<label>` with both the visible `span[role=checkbox]` and
  a hidden native `<input type=checkbox>`, both matching the same label text),
  `RolesList.test.tsx` (corrected a stale comment about Chakra's always-mounted
  `Tabs` panels — Base UI's `Tabs.Panel` unmounts inactive panels by default),
  `PermissionMatrixEditor.test.tsx` (native-`<select>` assertions → the `Select`
  open-trigger-then-click-option + `pointerdown`-before-`click` helper Batch A
  established for `RoutingConfig.test.tsx`). Added `SsoGroupMappingSection.test.tsx`
  (previously untested).

**Deviation from the dispatch prompt (local/reversible, noted):** same as Batch A —
no network access to the shadcn CLI registry this dispatch, so `dialog.tsx`/
`tabs.tsx` were hand-authored directly on the already-vendored `@base-ui/react`
primitives, matching this package's existing generated-component conventions.

**Exit gate.**
- `pnpm turbo run typecheck` — 31/31 packages green.
- `pnpm run lint` / `pnpm run lint:boundaries` — both clean.
- Full test suite: 851/851 unit (149 files, +1 new), 283/283 integration, 76/76
  isolation — one unrelated transient timeout
  (`packages/modules/iam/.../admin-routes.test.ts`, the same pre-existing/
  out-of-scope flake Batch A's report documented) reproduced as a clean pass in
  isolation.
- Axe-core: a real Playwright + `@axe-core/playwright` scan against a live `next
  dev` process wired to the test Postgres, logged in as the seeded `demo` tenant's
  Tenant Admin — 0 violations across the Users/Roles/SSO tabs and every Dialog
  (`RoleFormModal` create, `InviteUserModal`, `ChangeRolesModal`), after fixing one
  real defect (below).
- Manually verified live (not assumed): Dialog focus-trap holds in both Tab/
  Shift+Tab directions (confirmed on both a large form — `RoleFormModal`'s 20+
  tabbable elements — and a small one — `ChangeRolesModal`, which actually exercises
  the wrap-around boundary), Escape closes every Dialog, focus returns to the
  triggering button, every Dialog input/checkbox has a real accessible label, and
  system-role immutability holds (`RolesTable`'s system-role "Edit" stays disabled
  with a working hover tooltip) after the Dialog conversion.

**Real defect found and fixed via the axe-core scan (not shipped and later
caught):** `RolesTable.tsx`'s trailing "Actions" column header was a bare empty
`<TableHead />` (`empty-table-header`, same class of defect `UsersTable.tsx`
already fixed under a prior QA pass) — fixed with the identical `sr-only`
"Actions" pattern, with a regression test added.

**Investigated, concluded not a defect:** an initial focus-trap check appeared to
show focus escaping a Dialog after the last tabbable element. Traced to Base UI's
focus-guard correction running asynchronously — an immediate synchronous
`document.activeElement` check after a simulated `Tab` keypress can catch an
intermediate frame before the correction runs. A browser-realistic ~80ms settle
delay after each keypress showed the trap genuinely holds in both directions.

**Deliberately deferred / out of scope (noted, not silently skipped):** Batches C
(`conversations`/`approvals`/`escalations`/`channels`/`connectors`) and D
(`agent-platform/*`/`tools`/`mcp-health`/`audit-log`) untouched — later dispatches.

**Security review.** No new endpoints/auth surfaces this batch — every screen's
existing RBAC gating (`canWrite`/`getModuleAccessLevel`) and 403-vs-empty-result
handling (`fetchJson`'s `forbidden` kind) is unchanged, only the visual layer
moved; the fail-closed "at least one role required" UI mirrors on
`InviteUserModal`/`ChangeRolesModal` are unchanged from the Chakra version.

### Batch C — `conversations`/`approvals`/`escalations`/`channels`/`connectors` — IMPLEMENTED, PENDING QA

**Goal.** Convert `ConversationsList`/`ConversationDetail` (the Conversation Trace
Viewer), `ApprovalQueue`, `EscalationQueue`/`TakeoverPanel` (the Live Takeover
Panel), `ChannelsList`/`WhatsAppChannelConfig`/`ChannelTypePicker`/
`CreateChannelForm`/`CreateWhatsAppChannelForm`, and `ConnectorsList`/
`connectors/[id]/page.tsx`/`ConnectorWizard` from Chakra to shadcn/Tailwind.

**Scope.** All files above, reusing Batches A/B's existing `Table`/`Select`/
`Checkbox`/`Switch`/`Tabs`/`Alert`/`Badge`/`Tooltip`/`Skeleton` primitives
unchanged. New shared primitives, hand-authored (same network-access constraint
as Batches A/B — see those entries' deviation notes): `packages/ui/src/components/ui/textarea.tsx`
(plain `<textarea>` — Base UI has no dedicated Textarea part), `progress.tsx`
(Base UI's `Progress`, replacing Chakra's `Progress` for the confidence gauge/
sparkline), `collapsible.tsx` (Base UI's `Collapsible`, replacing Chakra's
`Collapse`+`useDisclosure` for the Trace Viewer's expandable reasoning/tool-call
blocks and the Channels embed-snippet disclosure), and `form.tsx` — the first
RHF-integrated primitive in this sweep (`Form`/`FormField`/`FormItem`/
`FormLabel`/`FormControl`/`FormDescription`/`FormMessage`), used by
`ConnectorWizard`/`CreateChannelForm`/`CreateWhatsAppChannelForm` (all three
already React-Hook-Form + TypeBox-resolver driven).

**Deviation from the dispatch prompt (local/reversible, noted):** shadcn's
canonical `form.tsx` wraps `FormControl`'s child in Radix's `Slot`; this project
has no Radix dependency (Base UI resolved from the preset, not Radix, per Phase
0), so `FormControl` hand-rolls the same "merge computed id/aria-* onto the
single child" behavior via `React.cloneElement` instead. Select-driven
`FormField`s follow the canonical shadcn pattern (`<Select><FormControl>
<SelectTrigger>...` — `FormControl` wraps only the `SelectTrigger`, so the id/
label association lands on the actual interactive element, not the outer
`Select` root). `packages/ui`'s `react-hook-form` dependency added as a peer +
dev dependency (`apps/web` already carried it as a real dependency).

**Real defect found and fixed during self-verification (not shipped and later
caught):** `ConnectorWizard`'s `credentialPlaintext` field — moving from
`register()` to RHF's `Controller` (via `FormField`) changed how an unmounted,
conditionally-rendered field's value is retained; a `""` default survived in
RHF's internal state even while `authMethod === "None"` hid the field, failing
the schema's `Type.Optional(Type.String({ minLength: 1 }))` on every submit
regardless of `authMethod`. Fixed by leaving no default (`undefined`, matching
`Optional`'s accepted "absent" case) and adding `shouldUnregister` to that one
`FormField` so RHF drops the value entirely once the field unmounts, matching
the old `register()`-based behavior exactly.

**Exit gate.**
- `pnpm turbo run typecheck` — 31/31 packages green.
- `pnpm run lint` / dependency-cruiser boundaries — both clean.
- Full test suite, re-run fresh: 149/149 unit test files (863/863 tests, +10 net
  new — 1 new `ConnectorWizard` test, 9 new `WhatsAppChannelConfig` tests added
  to close a coverage gap), 64/64 integration files (283/283 tests), 10/10
  isolation files (76/76 tests).
- Axe-core: a real Playwright + `@axe-core/playwright` scan against a live
  `next dev` process wired to the existing dev docker-compose Postgres/Redis,
  logged in as the seeded `demo` tenant's Tenant Admin — 0 violations across all
  7 in-scope routes (`/conversations`, `/approvals`, `/escalations`, `/channels`,
  `/channels/new`, `/connectors`, `/connectors/new`) after fixing 3 real defects
  (below), re-scanned 3 consecutive times clean.
- Real functional round trips driven live in the same session:
  `ConnectorWizard`'s Backend-type/Authentication-method `Select`s (Credential-
  value field reveal/hide confirmed on a real selection change), the Channels
  embed-snippet `Collapsible` (expand and collapse both genuinely toggle the
  rendered `<pre>`), and 8 real seeded conversations' Trace Viewer pages (0
  console errors).
- Coverage on files this dispatch added/changed, individually, all above the 80%
  bar: `ApprovalQueue.tsx` 94.6%, `ChannelsList.tsx` 96.4%,
  `WhatsAppChannelConfig.tsx` 83.4% (raised from an initial 52.5% by adding
  tests for the Connect/Reconnect/Disconnect, WABA save/sync, Credentials
  rotate, Webhook reverify, Templates sync, and Consent commit-import flows),
  `ChannelTypePicker.tsx`/`CreateChannelForm.tsx`/`CreateWhatsAppChannelForm.tsx`
  100%/100%/100%, `ConnectorsList.tsx` 100%, `ConnectorWizard.tsx` 100%,
  `ConversationsList.tsx` 94.9%, `ConversationDetail.tsx` 90.4%,
  `EscalationQueue.tsx` 88.7%, `TakeoverPanel.tsx` 95.6%, `form.tsx` 86.4%,
  `textarea.tsx`/`progress.tsx`/`collapsible.tsx` 100% each. `page.tsx` files
  remain at the project's already-established 0% (thin Server Component
  wrappers, per Batch A's precedent — not a new gap).

**Real defects found and fixed via the axe-core scan (not shipped and later
caught):**
1. `color-contrast` (serious): every `Badge variant="destructive"` usage
   (`ConversationsList`'s Escalated status, `ApprovalQueue`/`EscalationQueue`'s
   long-wait indicator) measured ~4:1 contrast — short of WCAG AA's 4.5:1 for
   normal text at the badge's 9pt/12px size, since this preset defines no
   `--destructive-foreground` token in `globals.css` to fall back on. Fixed by
   strengthening `badge.tsx`'s shared `destructive` variant itself,
   project-wide, to a solid `bg-destructive text-white` pairing — the same
   "solid, pre-verified pairing" convention already established elsewhere in
   this codebase (`TakeoverPanel.tsx`'s status Badge, `emerald-700`/white).
2. `heading-order` (moderate): `ChannelTypePicker.tsx`'s card-type headings used
   `aria-level={3}` directly under the page's `h1` (level 1), skipping level 2
   entirely — fixed to `aria-level={2}`.

**Manually verified live (not assumed):** the Escalation Takeover Panel's
live-update mechanism is (and was already, pre-existing) a 5-second polling
`reload()`, not a real SSE subscription — `TakeoverPanel.tsx`'s own doc comment
already discloses this as a deliberate, earlier-dispatch simplification (the
dispatch prompt's framing assumed SSE); the polling/cleanup logic was carried
over unchanged and is exercised by the passing unit suite. A live two-session
"claim -> Take Over" round trip hit a pre-existing 409 Conflict on stale,
already-claimed seed-data escalations in this shared dev environment (unrelated
to this batch's UI-only changes); the panel's message-send/transfer/create-case/
resolve/return-to-bot flows are otherwise fully covered by the passing 12-test
unit suite.

**Deliberately deferred / out of scope (noted, not silently skipped):** no
Dialog/Modal conversions existed in this batch's actual scope — the dispatch
prompt anticipated some (e.g. "connector creation dialogs"), but `ConnectorWizard`
is a full-page form, not a modal, and no escalation-takeover confirmation uses a
Dialog either — so the Dialog focus-trap/Escape/focus-return re-verification the
prompt called for was not applicable here. Batch D (`agent-platform/*`/`tools`/
`mcp-health`/`audit-log`) remains untouched — next dispatch.

**Security review.** No new endpoints/auth surfaces this batch — every screen's
existing RBAC gating (`getModuleAccessLevel`/`canWrite`/`canDecide`/`canAct`)
and 403-vs-empty-result handling (`fetchJson`'s `forbidden` kind) is unchanged,
only the visual layer moved; the Approval Queue's Idempotency-Key header and the
Escalation Takeover's fail-closed read-only gating are unchanged from the
Chakra version.

### Batch D — `agent-platform/*`, `tools`, `mcp-health`, `audit-log` — IMPLEMENTED, PENDING QA

**Goal.** Convert Agent Platform's Definitions/Versions/Diff/Evals/Model Gateway/
Runtime Traces screens, the Tool Catalog + tool permission-rule editor, MCP Health
dashboard, and Audit Log Viewer from Chakra to shadcn/Tailwind — the last Phase 2
screen-sweep batch.

**Scope.**
- `apps/web/app/(admin)/agent-platform/definitions/DefinitionsList.tsx` — `Modal`
  create-definition form → shadcn `Dialog`.
- `apps/web/app/(admin)/agent-platform/definitions/[id]/DefinitionDetail.tsx` —
  `Menu`/`MenuButton`/`MenuList`/`MenuItem` ("Promote to…") → new shadcn
  `DropdownMenu` family; `AlertDialog` (Production-promotion confirm) → existing
  shadcn `AlertDialog`; status/eval-outcome color mapping → `Badge` with explicit
  solid pairings beyond the four built-in variants (same convention as
  `TakeoverPanel.tsx`'s `emerald-700`/white).
- `apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.tsx` —
  native `<select>`s (Graph Type/Model Route Key) → shadcn `Select`.
- `apps/web/app/(admin)/agent-platform/diff/DiffView.tsx` — full conversion,
  preserving the accessible-diff structure (`aria-live` summary, `role="list"`/
  `listitem`, visually-hidden Added/Removed prefixes) verbatim.
- `apps/web/app/(admin)/agent-platform/evals/EvalSuitesList.tsx`,
  `evals/[id]/EvalSuiteDetail.tsx` — `Modal` forms → `Dialog`; `NumberInput` →
  `Input type="number"`; per-turn sender `Select`.
- `apps/web/app/(admin)/agent-platform/model-gateway/ModelGateway.tsx` —
  `RadioGroup`/`Radio` (platform-vs-own-endpoint chain-entry mode) → new shadcn
  `RadioGroup` family; every other Chakra primitive converted; the Phase 0/1 QA
  retry's D7 id-stability fix (literal ids on the route-editor's `FormControl`s)
  carried forward as literal ids on the new `SelectTrigger`/`Input` elements.
- `apps/web/app/(admin)/agent-platform/traces/RuntimeTraces.tsx`,
  `versions/[versionId]/VersionDetail.tsx` — `Select` conversions; `Tabs`
  (Overview/Eval) → shadcn `Tabs`.
- `apps/web/app/(admin)/tools/ToolCatalog.tsx` — 4-select filter bar → shadcn
  `Select` (sentinel `"__all__"` value standing in for Chakra's `placeholder`
  prop, since Base UI's `Select` has no native "unselected" state); visibility
  `Switch`/priority-weight `NumberInput`, each wrapped in a `Tooltip` for the
  read-only case → shadcn `Switch`/`Input`+`Tooltip`.
- `apps/web/app/(admin)/tools/[id]/permissions/ToolPermissionRules.tsx` — full
  conversion (`Select`/`Switch`/`NumberInput` per rule row).
- `apps/web/app/(admin)/mcp-health/McpHealthDashboard.tsx` — full conversion;
  circuit-breaker Reset action preserved unchanged.
- `apps/web/app/(admin)/audit-log/AuditLogViewer.tsx` — filter bar + masked-detail
  drawer + CSV/JSON export links, full conversion; the PII-masking guarantee
  itself is unchanged (lives entirely in the already-shipped `queryMaskedAuditLog`
  backend query — this batch only touched presentation).
- New shared shadcn primitives, hand-authored (same network-access constraint as
  every prior batch): `packages/ui/src/components/ui/dropdown-menu.tsx` (Base UI
  `Menu`), `radio-group.tsx` (Base UI `RadioGroup`/`Radio`).
- Test updates in the same dispatch: `ModelGateway.test.tsx` (the one
  Chakra-CSS-string-literal contrast assertion rewritten for Tailwind's
  `text-muted-foreground` class), `RuntimeTraces.test.tsx`/`ToolCatalog.test.tsx`/
  `VersionDetail.test.tsx` (native-`<select>` assertions → the established
  `chooseOption` helper), `ToolCatalog.test.tsx`/`ToolPermissionRules.test.tsx`
  (two `Switch`-disabled assertions: jest-dom's `toBeDisabled()` doesn't recognize
  `aria-disabled` on a non-form element, so these now assert
  `toHaveAttribute("aria-disabled", "true")` directly). Added previously-missing
  test files for three components that had none before this dispatch:
  `ToolPermissionRules.test.tsx`, `McpHealthDashboard.test.tsx` (incl. a real
  Reset-button-calls-the-real-endpoint assertion), `AuditLogViewer.test.tsx`
  (incl. an explicit masked-details-render-verbatim assertion).

**Real defect found and fixed during self-verification (not shipped and later
caught):** Base UI's `Button` forces `role="button"` onto whatever element its
`render` prop substitutes, unless `nativeButton={false}` is set — three
"Button-styled-as-a-link" call sites (`DefinitionDetail.tsx`'s "New
Version"/"Open"/"Compare…", `AuditLogViewer.tsx`'s CSV/JSON export links,
`ToolCatalog.tsx`'s "Edit permissions" link) initially routed through `Button`
this way, silently clobbering the underlying `<a>`'s link semantics
(`getByRole("link", ...)` stopped resolving, screen readers would announce a
button instead of a link). Fixed by rendering the link element directly
(`NextLink`/`<a>`) styled with the exported `buttonVariants()` class function
instead of routing it through `Button` at all.

**Exit gate.**
- `pnpm turbo run typecheck` — 31/31 packages green.
- `pnpm run lint` / `pnpm run lint:boundaries` — both clean (2531 modules, 4559
  dependencies cruised, 0 violations).
- Full test suite, re-run fresh: 154 unit test files / 886 tests (+18 files/+36
  tests net new), 74 integration+isolation files / 359 tests — all green.
- Coverage on every file this dispatch added/changed, individually, all above
  the 80% bar (see `docs/NEXUS_STATE.md`'s decision log for the full per-file
  breakdown). `page.tsx` files remain at the project's already-established 0%
  (thin Server Component wrappers, per every prior batch's precedent).
- Manually re-verified in code (not live-browser — see gap below): Select
  label-resolution on this batch's fetched-default fields (`ModelGateway.tsx`'s
  Route Key/Cache mode/per-entry Provider on Edit, `RuntimeTraces.tsx`'s
  definition/version pickers, `VersionDetail.tsx`'s eval-suite picker) needed no
  call-site changes and is exercised by this batch's own passing tests; audit
  log PII masking confirmed unchanged (backend-only); MCP Health circuit-breaker
  Reset wiring confirmed correct and now unit-tested; Agent Definition
  version-diff view's accessible-diff structure carried over feature-for-feature.

**Deliberately deferred / gap flagged (noted, not silently skipped):** a
live-browser axe-core scan (the kind Batches A–C each ran against a real `next
dev` + seeded `demo` tenant) was **not** performed this dispatch — the only
running `nextbot-web` container in this environment is a baked, no-volume-mount
production image built before this dispatch's changes, and correctly wiring a
fresh `next dev` process (session/KMS secrets, AI-provider stub, Postgres/
Redis/ClickHouse env) within this dispatch's remaining scope risked a large,
open-ended detour without a guaranteed payoff. Left as an explicit gap for
nexus-qa's pass rather than fabricated. Batches A/B/C's own already-passed
axe-core results are unaffected (no shared primitive's visual/semantic contract
changed this batch apart from the two new ones, which have no prior baseline to
regress).

**Security review.** No new endpoints/auth surfaces this batch — every screen's
existing RBAC gating (`getModuleAccessLevel`/`AccessDeniedState`, the Tool
Catalog's split `tool_permissions`(Read)/`agent_tool_config`(Write) modules) and
403-vs-empty-result handling (`fetchJson`'s `forbidden` kind) is unchanged, only
the visual layer moved; the audit log's masking guarantee and the model-route
API-key vault's masked-only/never-reveal pattern are both unchanged from the
Chakra version.

### Batch D — QA fix pass (retry 1 of 3) — IMPLEMENTED, PENDING RE-QA

QA (2026-08-18) found 2 new blocking, cross-phase defects during its Batch D
pass — fixed here, scoped exactly to the 2 reported items, no re-scoping:

**Defect 1 (contrast, fixed + centralized).** `bg-amber-600 text-white`
measured ~3.19:1 contrast (needs 4.5:1), originating in Batch C
(`ConversationDetail.tsx`, `TakeoverPanel.tsx`) and copied into Batch D's
`DefinitionDetail.tsx` (`EvalGated` badge) and `McpHealthDashboard.tsx`
(`Degraded` connector / `HalfOpen` breaker badges). Added
`packages/ui/src/lib/status-badge.ts` exporting `WARNING_BADGE_CLASS =
"bg-amber-800 text-white"` (verified ~7.09:1 via the WCAG relative-luminance
formula — `amber-700` was also checked and passes at ~5.02:1, but `amber-800`
was chosen for a safer margin against rendering/rounding variance) with a doc
comment recording the verification math, so a future screen imports this
constant instead of re-typing a Tailwind class from memory. All four call
sites updated to reference it instead of the literal `"bg-amber-600
text-white"` string. The amber-600 progress-bar fill in
`ConversationDetail.tsx`'s `ConfidenceGauge` (no text overlay, a 3:1 non-text
contrast requirement, not the 4.5:1 text requirement QA measured) was
deliberately left unchanged — out of this defect's scope.

**Defect 2 (breadcrumb 404s, fixed).** `AdminShell.tsx`'s `AdminBreadcrumb`
linked every intermediate path segment unconditionally. Added a small,
bounded `NO_PAGE_SEGMENT_SHAPES` config (segment-shape arrays with `"*"` for
any dynamic segment) covering the four known gaps QA identified —
`["agent-platform"]`, `["agent-platform","definitions","*","versions"]`,
`["agent-platform","versions"]`, `["tools","*"]` — confirmed against the real
route tree (`find … -iname page.tsx`) rather than guessed. `isNoPageSegment`
matches the breadcrumb's path-so-far against these shapes; a match renders
that segment via `BreadcrumbPage` (plain, non-clickable, `aria-disabled`)
instead of `BreadcrumbLink`. No index pages were added — per the QA prompt,
only worth doing if clearly simpler for a specific segment, which none of
these four were.

**Verification.**
- Contrast: computed the WCAG relative-luminance contrast ratio in a small
  Python script for `amber-600` (~3.19:1 — reproduces QA's exact measurement,
  validating the formula/methodology) vs `amber-700` (~5.02:1) vs `amber-800`
  (~7.09:1, the one shipped) against white foreground text.
- Breadcrumb: added 4 new `AdminShell.test.tsx` cases exercising the exact
  broken segments QA named — `/agent-platform/definitions` (the
  `agent-platform` segment), `/agent-platform/definitions/{id}/versions/new`
  (the `versions` segment), `/agent-platform/versions/{id}` (top-level
  `versions`), `/tools/{id}/permissions` (the `[id]` segment, labeled
  "Details") — each asserting the segment has no `<a>` ancestor (real link
  presence, not just ARIA role, since `BreadcrumbPage` always carries
  `role="link" aria-disabled="true"` for consistent styling) while a sibling
  real-page segment (`/tools`, `Tool Catalog`) remains a genuine link.
- Full suite re-run fresh: 890/890 unit tests across 154 files (one
  `packages/modules/iam/.../admin-routes.test.ts` timeout reproduced during a
  full concurrent run, confirmed a pre-existing flake unrelated to this
  dispatch — passes in 812ms in isolation).
- `apps/web` and `packages/ui` `tsc --noEmit` both clean.
- `eslint . --max-warnings=0` clean on the full repo.

**Security review.** No new endpoint/auth surface/data-access/user-input path
touched — both fixes are client-side rendering-only (a shared Tailwind class
constant; a static breadcrumb-link/plain-text decision). No findings.

**Not touched, per the retry's explicit scope:** audit-log PII masking, MCP
Health circuit-breaker Reset, Select label resolution, the Button-as-link
fix, Diff View's accessible structure (all independently QA-verified
correct), and `AccessDeniedState`'s nested-`<main>` landmark issue (explicitly
Plan Phase 4 scope).

## Phase 3 — `apps/web` cleanup — DONE

**Goal.** Every screen under `(admin)/**` finished its shadcn/Tailwind conversion in
Phase 2 (Batches A-D) — remove the now-dead temporary Chakra shim and its
dependencies.

**Scope.**
- `apps/web/app/(admin)/AdminShell.tsx` — deleted the `<ChakraProvider
  theme={theme}>` wrapper around `{children}` (and its `theme`/`ChakraProvider`
  imports); `<main role="main">` now renders `{children}` directly.
- `apps/web/package.json` — removed `@chakra-ui/react`, `@emotion/react`,
  `@emotion/styled`, `framer-motion` from `dependencies`. Verified via a full-tree
  grep that `AdminShell.tsx` was the only remaining *source* file importing
  Chakra/Emotion (every other match was a stale `.next` build artifact); verified
  no `apps/web` source file imports `framer-motion` directly (it was only ever a
  transitive Chakra/Emotion dependency).

**Exit gate.** `pnpm turbo run typecheck` 31/31 green; `pnpm run lint`/`lint:boundaries`
clean; full test suite green (see Phase 4 below — verified together in the same
dispatch); real `next build` compiled/typechecked/statically-generated all 61 pages
cleanly (the only failure was a Windows-only `EPERM` symlink error in the final
standalone-output tracing step, unrelated to this change — see decision log).

## Phase 4 — `packages/ui` restructuring — DONE

`packages/ui` already became the shared shadcn component home in Phase 0 (ahead of
schedule, since Phase 0/1 needed it immediately).

**Scope.**
- Deleted `packages/ui/src/theme.ts` (the Chakra `extendTheme` instance — fully dead
  once Phase 3's shim removal landed) and `AppProviders.tsx` + its test (grepped the
  whole repo first — nothing outside `packages/ui` itself imported it; `apps/web/app/
  layout.tsx` already mounts `TooltipProvider`/`<Toaster/>` directly since Phase 1).
  `src/index.ts` no longer exports `theme`/`AppProviders`.
- Rebuilt `AccessDeniedState.tsx` on shadcn `Card`/`Alert`/`Button` (`buttonVariants`)
  primitives, **prop surface unchanged** (`moduleLabel`/`homeHref`). Fixes the
  QA-flagged (Batch D) nested-`<main>` landmark defect: the component no longer
  renders its own `role="main"` wrapper at all (every real call site already renders
  inside `AdminShell.tsx`'s own `<main>`) — a real `h1` and the "Back to Dashboard
  Home" link are still present, just without a competing landmark. Live-verified via
  Playwright: `role="main"` count on an RBAC-denied screen went from 2 (pre-fix) to 1.
- Rebuilt `StatusBadge.tsx` on shadcn `Badge` (`variant="outline"`, dot + text,
  `role="status"` preserved), `StatusTone` prop surface unchanged. Extended
  `packages/ui/src/lib/status-badge.ts` (the Batch D retry-1 `WARNING_BADGE_CLASS`
  convention) with `CONNECTED_BADGE_CLASS`, `DEGRADED_BADGE_CLASS` (an alias for
  `WARNING_BADGE_CLASS`), and `STATUS_DOT_CLASS` (a `StatusTone`-keyed map of dot fill
  colors, with a doc comment explaining why non-text dot fills can safely use hues
  the text-pairing constants deliberately avoid — WCAG's 3:1 vs. 4.5:1 distinction) —
  this file is now the single source of truth for status-tone colors other screens
  (`McpHealthDashboard.tsx`, etc.) can migrate onto over time.
- `RbacNav.tsx` left untouched (pure logic, no Chakra dependency).
- `packages/ui/package.json` — dropped Chakra/Emotion/`framer-motion`; added `next`
  as a peer + dev dependency (`AccessDeniedState.tsx` now imports `next/link`
  directly — a real, new requirement, since no prior file in this package touched
  Next.js); confirmed `@base-ui/react`/`class-variance-authority`/`clsx`/
  `tailwind-merge`/Hugeicons were already correctly declared as direct dependencies.
  Confirmed via a clean `pnpm install` — no resolution errors.
- Confirmed `apps/widget-embed` still does not import anything from `@nextbot/ui`
  and still depends on Chakra independently — untouched, correctly out of scope
  (Plan Phase 5).

**Exit gate.**
- `pnpm turbo run typecheck` — 31/31 packages green.
- `pnpm run lint` / `pnpm run lint:boundaries` — both clean (2843 modules, 5183
  dependencies cruised, 0 violations).
- Full test suite, re-run fresh: 889/889 unit tests across 153 files (1
  `packages/modules/iam/.../admin-routes.test.ts` timeout under full concurrent
  load, reproduced as a clean pass in isolation three separate times — the same
  pre-existing/out-of-scope flake every prior batch's report documents), 283/283
  integration, 76/76 isolation.
- Coverage on every file this dispatch added/changed: 100% statements/branches/
  functions/lines (`AccessDeniedState.tsx`, `StatusBadge.tsx`, `status-badge.ts`).
- Real `next build` (`apps/web`): compiled, typechecked, linted, and statically
  generated all 61 pages cleanly.
- **Real browser verification (Playwright + `@axe-core/playwright`, installed
  temporarily this session — network access was available):** seeded the `demo`
  tenant fixture; logged in as the seeded Escalation Agent role (`users_roles:
  "None"` per `system-roles.ts`) and confirmed `/roles` renders `AccessDeniedState`
  with exactly one `role="main"` and one `<main>` tag (was two before this fix);
  axe-core 0 violations. Created one real connector via the UI (a plain HTTPS MCP
  endpoint, no real external connectivity needed) to get a live, real-data
  `StatusBadge` render (`role="status"`, "Offline", dot `bg-red-600`) on
  `/connectors` — axe-core 0 violations; cleaned the test connector up afterward.
  Also scanned `/mcp-health` and `/dashboard` — 0 violations on both.

**Security review.** No new endpoint/auth surface/data-access/user-input path
touched — all changes are client-side rendering/dependency-removal only;
`AccessDeniedState`'s fail-closed gating logic (`getModuleAccessLevel`, the
`None`-access check at every call site) is unchanged, only its presentation layer
moved.

**Deliberately deferred / out of scope (noted, not silently skipped):**
`apps/widget-embed`'s Chakra migration (Plan Phase 5, next dispatch), Plan Phase 6
(final cross-app QA pass), Plan Phase 7 (ADR-0010) — not written yet, correctly
sequenced after the migration is functionally complete on both apps.

## Phase 5 — `apps/widget-embed` migration — IMPLEMENTED, PENDING QA

**Goal.** Migrate the last Chakra app to Tailwind v4/shadcn, reproducing the
widget's existing *correct* per-tenant runtime branding (`createWidgetTheme()`)
on shadcn's CSS-custom-property model instead of regressing it, per this
dispatch's exact scope.

**Scope.**
- `apps/widget-embed/package.json` — removed `@chakra-ui/react`/`@emotion/react`/
  `@emotion/styled`/`framer-motion`; added `@nextbot/ui` (workspace, consumed only
  via its Next.js-free `./components/ui/*`/`./lib/*` subpaths — confirmed no
  source file in that subtree imports `next`), `@base-ui/react`,
  `@hugeicons/react`/`@hugeicons/core-free-icons`, `class-variance-authority`,
  `clsx`, `tailwind-merge`, `@fontsource/outfit`/`@fontsource/oxanium` (self-hosted
  font files — this is a Vite SPA, `next/font` isn't available), `tailwindcss`,
  `@tailwindcss/vite`, `tw-animate-css`, `shadcn` (its `dist/tailwind.css` utility
  sheet, framework-neutral).
- `apps/widget-embed/vite.widget.config.ts` — added the `@tailwindcss/vite` plugin.
- `apps/widget-embed/src/widget/globals.css` (new) — same preset tokens as
  `apps/web/app/globals.css` (Style "Lyra"/Base Color "Stone"/Theme "Orange"/
  Radius "None"), imported only from the widget's own `main.tsx`-reachable tree
  (via `WidgetApp.tsx`) so it never leaks to/from the host page — the widget's
  entire DOM already lives inside its own isolated iframe document
  (`docs/design/UX_GUIDELINES.md` §5.1), so this is CSS scoping by construction,
  not a new leak-prevention mechanism. Self-hosted Oxanium/Outfit `@font-face`
  imports scoped the same way. `--primary`/`--primary-foreground` are the only
  tenant-overridable tokens (same token contract Plan Phase 1 established).
- `apps/widget-embed/src/widget/theme.ts` — `createWidgetTheme()`'s Chakra
  `extendTheme` call replaced with `buildWidgetBrandStyleTag()`, mirroring
  `apps/web/src/lib/build-brand-style-tag.ts`'s CSS-custom-property
  `<style>`-injection pattern (defensive hex re-validation, WCAG contrast-picked
  `--primary-foreground`, same white/black tie-break logic).
- `apps/widget-embed/src/widget/branding/contrast-checker.ts` (new) —
  **intentionally duplicated** (not imported) copy of
  `packages/modules/tenancy/src/domain/contrast-checker.ts`'s pure WCAG formula:
  `@nextbot/tenancy`'s barrel transitively imports `@nextbot/db`
  (`drizzle-orm`/`pg`) and `ioredis` — both Node-only — which would break a
  browser-targeted Vite bundle if imported directly; this is the same
  "never depend on a server-only/Next.js-only bundle" boundary `theme.ts`'s own
  prior doc comment already established for the widget, applied here for the one
  new cross-package dependency this phase needed. Doc comment records the
  rationale explicitly (this is the one deliberate exception to "don't invent a
  second contrast algorithm").
- `apps/widget-embed/src/widget/WidgetApp.tsx` — drops `<ChakraProvider theme=...
  resetCSS cssVarsRoot="#root">`; mounts `@nextbot/ui`'s `TooltipProvider` and
  renders the brand `<style>` tag as a plain child (client-rendered only, no
  `dangerouslySetInnerHTML` needed — this is a Vite SPA, no SSR step exists) before
  the rest of the tree. Per-embed-config-over-tenant-default precedence (D4)
  preserved verbatim; `fontFamily` override now applied as an inline `style`
  attribute on the root `dir`-carrying div (data-driven, never a hardcoded brand
  value).
- All ~20 Chakra-using files converted 1:1 to Tailwind + reused `packages/ui`
  primitives (`Button`, `Input`, `Textarea`, `Label`, `Alert`/`AlertDescription`,
  `Dialog` family, `Table` family, `Tooltip` family) plus Hugeicons in place of
  emoji/inline-SVG icons: `Launcher`, `WidgetWindow`, `InputArea`, `LanguageModal`,
  `WelcomeScreen`, `OfflineBanner`, `EscalationWaitBanner`, the 9 message-bubble
  components, `MessageList`.
- **Deviation (local/reversible, noted):** `FormBubble`'s "select" field type uses
  a plain, Tailwind-styled native `<select>` (`FieldSelect`), not `packages/ui`'s
  Base UI `Select` primitive — a native element already satisfies label
  association via a plain `<label htmlFor>` (no `items`-map label-resolution fix
  needed at all, since there's no headless-primitive-vs-underlying-value gap to
  close), keeps this compact single-file form card's fields uniformly
  `fireEvent.change`/`.value`-testable, and avoids pulling a popup-interaction
  pattern into a card that doesn't need it. Every other reused Select-needing
  surface in this app (there are none besides this one) would still get the
  label-resolution fix "for free" from the shared primitive if used.
- Radius "None" applied throughout, **except** the launcher button
  (`rounded-full`) — `docs/design/UX_GUIDELINES.md` §5.2.1 explicitly mandates a
  "circular/pill floating action button," a firm UX requirement that overrides
  the generic preset radius default for that one element (documented in-code).
- Test updates in the same dispatch: every existing `*.test.tsx` continued to pass
  largely unchanged (role/label/text-based queries are structure-agnostic); added
  `EscalationWaitBanner.test.tsx` (previously untested — 0% function coverage
  before this dispatch, 100% after) and `branding/contrast-checker.test.ts`;
  rewrote `theme.test.ts` for the new `buildWidgetBrandStyleTag()` API shape.

**Real defects found and fixed via the axe-core scan (not shipped and later
caught):**
1. `landmark-banner-is-top-level` (moderate): `WidgetWindow.tsx`'s header used a
   semantic `<header>` element, which carries an implicit "banner" landmark role
   — nested inside the window's own top-level `role="complementary"` landmark,
   which axe correctly flags. Fixed by using a plain `<div>` (no competing
   landmark) for this widget-local chrome bar, which was never the page's actual
   site banner anyway.
2. `page-has-heading-one` (moderate): the widget document had no level-one
   heading anywhere. Fixed with a visually-hidden (`sr-only`) `<h1>Chat
   support</h1>` in the header, matching the landmark's own `aria-label` text.

**Investigated, deliberately NOT fixed the obvious way (flagged for nexus-qa,
not silently worked around):** wrapping the conversation area in a `<main>`
landmark to close `landmark-one-main` instead tripped
`landmark-main-is-top-level` ("Main landmark should not be contained in another
landmark") — a worse finding, since this document is intentionally a single
top-level "complementary" landmark per `docs/design/UX_GUIDELINES.md` §5.5 ("one
top-level landmark wrapping the whole widget"), not a conventional full page
with its own separate main region. Reverted to a plain `<div>`; the moderate
`landmark-one-main` finding remains as a known, accepted axe-rule/design-intent
mismatch for this deliberately single-landmark embeddable micro-surface — **not
a defect fixed by adding a second, nested landmark**. `docs/design/
UX_GUIDELINES.md` §5.5 does not call for an internal `<main>`, and the finding
does not change any interactive/keyboard behavior.

**Exit gate.**
- `pnpm turbo run typecheck` — 31/31 packages green.
- `pnpm run lint` (repo-wide `eslint . --max-warnings=0`) / `pnpm run
  lint:boundaries` (dependency-cruiser) — both clean (1759 modules/4269
  dependencies cruised, 0 violations).
- Full unit suite, re-run fresh: 155 test files / 898 tests (+2 files/+3 tests
  net new this dispatch) — 1 `packages/modules/iam/.../admin-routes.test.ts`
  timeout under full concurrent load, reproduced as a clean pass in isolation
  (the same pre-existing/out-of-scope flake every prior batch's report
  documents; confirmed unrelated by running `packages/modules/iam` alone, clean).
- Coverage (`--coverage.include="apps/widget-embed/src/**"`): 97.38%
  statements/97.38% lines overall; every file this dispatch added/changed is
  individually ≥82.92% (`MessageList.tsx`, the lowest) up to 100% — `src/index.ts`
  (0%, untouched "reserved scaffolding" per its own header comment) and
  `api.ts` (80.3%, untouched this dispatch) are pre-existing, not new gaps.
- Real `vite build` for both outputs: `dist-widget/` (widget SPA, 385KB JS/63KB
  CSS gzipped to 124KB/11KB, plus self-hosted font assets) and `dist-loader/`
  (`nextbot.js`, 1.8KB) both built cleanly.
- **Real embed-snippet-to-working-widget round trip (cold load, genuinely
  separate origin):** built the widget against the real running
  `nextbot-gateway` container (`VITE_NEXTBOT_GATEWAY_URL`), served
  `dist-widget`/`dist-loader` under a `/widget/`+`/loader/` sibling layout
  (matching `nginx.conf`'s real deployed layout) from `127.0.0.1:9091`, and a
  genuine static host HTML page with a real generated `NextBot.init({...})`
  embed snippet from `127.0.0.1:9092` (a different origin) — Playwright cold-load
  confirmed: the loader mounted a single iframe with a static `title`, the
  launcher rendered with the correct accessible name, opening it created a real
  session against the real gateway/seeded `demo` tenant, and a real message
  round-tripped (send → optimistic "sending" tick → server ack tick → an AI-turn
  response arrived over the real SSE stream). The AI turn was itself the
  FR-AI-05 `BackendTimeout` fallback (no LLM provider configured in this
  environment) — this incidentally re-verified the exact fallback copy and its
  amber (not red) visual treatment end-to-end through the real backend, not a
  fixture.
- **Real per-tenant brand color inheritance, live (the exact scenario a prior QA
  round validated once under Chakra):** set the seeded `demo` tenant's real
  `branding_config.primaryColor` to `#1B6B4A` directly in the test Postgres,
  cold-loaded the widget fresh (new session, no client-side cache), and
  confirmed via `getComputedStyle` that the resolved `--primary` custom property,
  the launcher button's background, and the window header's background all
  independently computed to `rgb(27, 107, 74)` (`#1B6B4A`) — the D4-class bug
  (inherited branding not applying on a fresh session) reproduced-and-verified
  fixed under the new mechanism. Reverted the tenant's branding back to its
  original value afterward.
- Axe-core (`@axe-core`/`axe-core` via Playwright, installed temporarily —
  network access available this session): scanned the launcher (collapsed), the
  widget window (Welcome screen), the widget window with a live conversation
  (incl. an `ErrorBubble`), and the open Language Selection Modal — 0 violations
  on 3 of 4 states, 1 accepted moderate finding (`landmark-one-main`, see above)
  on the other two, after fixing the 2 real defects listed above.
- Manually re-verified live (not assumed), matching this dispatch's checklist:
  keyboard focus moves to the message input on open (D9); Escape minimizes the
  window back to the launcher from a real keypress; `aria-expanded="false"` +
  `aria-controls="nextbot-widget-window"` present on the launcher; RTL mirroring
  (`dir="rtl"` applied live after selecting Arabic in the Language Modal);
  `prefers-reduced-motion` respected (`animate-nextbot-pulse` class genuinely
  absent when `page.emulateMedia({ reducedMotion: "reduce" })` is set); the
  amber (not red) `ErrorBubble` treatment confirmed via computed styles
  (`oklch` values matching Tailwind's `amber-50`/`amber-400` exactly, not red);
  the exact FR-AI-05 `BackendTimeout` copy rendered verbatim through a real
  backend round trip (see above). The offline-queue-drop distinct visual state
  (`dropped` tick) and the 20-message queue-eviction path were re-verified via
  the existing, passing `TextBubble.test.tsx`/`store.test.ts` unit suites rather
  than a fresh live 21-message repro — the underlying store logic is unchanged
  by this phase (UI-only conversion), and those tests already exercise it
  directly.

**Deliberately deferred / gap flagged (noted, not silently skipped):**
- The `landmark-one-main` axe finding above — investigated, a straightforward
  fix makes it worse; flagged for nexus-qa rather than silently left unexamined.
- No live multi-language full-translation-dictionary verification beyond the
  existing English/Arabic `dir`-mirroring check — unchanged scope from the
  pre-migration widget (§5.4's bidi-isolation/40+-language scope was never part
  of this phase, per the UX doc's own forward-compat notes).

**Security review.** No new endpoint/auth surface touched — `api.ts` (session
creation, message send, tool-call confirm, language set, SSE stream) is
byte-for-byte unchanged; the brand `<style>` tag's hex re-validation
(`HEX_COLOR_RE`) is defense-in-depth against a malformed/legacy row or a
directly-crafted `NextBot.init({ theme: { primaryColor: "..." } })` call from an
arbitrary host page, mirroring `apps/web`'s own defensive check — never trusts a
host-page-supplied color string into a raw `<style>` tag without validating it
first. No secrets/credentials touched; `VITE_NEXTBOT_GATEWAY_URL` is a build-time
public config value (the gateway's own base URL), not a secret.

## Phase 6 — Final QA pass across both apps — NOT STARTED

## Phase 7 — ADR correction (ADR-0010) — NOT STARTED

## Addendum (post-QA scope-bug fix, 2026-08-18) — white-labeling over-broad `--primary` override + login-screen branding — DONE

**Not a new phase of the original migration plan** — a real scope bug in the
per-tenant white-labeling mechanism this migration introduced, flagged by the
user after the migration's own QA pass was green, with fix scope confirmed via
two follow-up questions. Implemented directly as a fix pass (no re-planning),
per this project's "QA-driven fix pass" convention.

**Bug:** `build-brand-style-tag.ts` overrode shadcn's own `--primary`/
`--primary-foreground` tokens at `:root` scope whenever a tenant had
`white_label_enabled: true`. Those are the design system's own default-Button/
link/accent tokens, consumed by every shared `Button`/`Badge`/etc. primitive in
`packages/ui` — so every button across the whole Admin Console recolored to the
tenant's brand color, not just the top bar (FR-ADM-07's actual scope: "the top
bar and login screen").

**Part 1 fix — narrow the override to chrome-only:**
- `apps/web/src/lib/build-brand-style-tag.ts`: emits a dedicated
  `--brand-accent`/`--brand-accent-foreground` pair (reusing the existing
  `pickForegroundForContrast` helper, now exported) instead of overriding
  `--primary`/`--primary-foreground`. `--brand-sidebar` unchanged.
- `apps/web/app/globals.css`: added default `--brand-accent`/
  `--brand-accent-foreground` values (identical to the preset's own
  `--primary`/`--primary-foreground`) for the unbranded case.
- `apps/web/app/(admin)/AdminShell.tsx`: top-bar accent border now reads
  `var(--brand-accent)`, never `var(--primary)`.
- Grepped the whole `apps/web` tree for any other chrome consumer of the
  tenant-overridden `--primary` — none found beyond the one line above and the
  already-correct `--brand-sidebar` sidebar background.
- `BrandingSettings.tsx`'s live preview was already accurate (renders raw hex
  values directly via inline styles, never references a CSS custom property
  name) — confirmed, no change needed.
- Tests added/updated: `build-brand-style-tag.test.ts` (asserts `--brand-accent`
  is set and `--primary`/`--primary-foreground` are NOT touched),
  `AdminShell.test.tsx` (asserts the top-bar border reads `--brand-accent` and a
  regular Button in the same header carries no `--primary` inline override).

**Part 2 fix — login-screen branding (previously entirely unbranded):**
- New contract: `PublicTenantBrandingResponseSchema` +
  `TENANT_SLUG_PATTERN` in `packages/contracts/src/tenancy.ts`.
- New unauthenticated, rate-limited route:
  `apps/web/app/api/v1/public/tenant-branding/[slug]/route.ts` — returns the
  identical generic default response `{ whiteLabelEnabled: false, primaryColor:
  null, accentForeground: null, logoUrl: null, tenantName: null }` for BOTH a
  nonexistent tenant slug and an existing non-white-labeled tenant, so the
  endpoint can't be used to enumerate tenant slugs or their white-labeling
  status. Rate-limited via the existing `apps/web/src/lib/rate-limit.ts`
  (Redis fixed-window counter, same mechanism as the widget's/export's
  limiters) keyed per-IP via a new `apps/web/src/lib/client-ip.ts` (mirrors
  `apps/gateway/src/lib/client-ip.ts` — duplicated for the same
  app-private/no-shared-package reason `rate-limit.ts` already was).
- `LoginForm.tsx`: debounced (300ms) lookup on tenant-slug field blur, applies
  `--brand-accent`/`--brand-accent-foreground` as a scoped inline style on the
  Card (not `:root` — this is a client-side, single-component lookup, not the
  Admin Console's SSR'd whole-document override) and swaps the NextBot wordmark
  for the tenant's logo + name. The `<h1>` landmark itself is always present
  (never dropped) so the heading structure doesn't regress for screen readers.
  Every existing a11y behavior (tenant/email retention on failed login,
  focus-to-error-alert, password show/hide aria attributes, SSO
  tooltip-on-disabled-button) verified still intact — no regressions.
- Tests added: the new route (valid white-labeled tenant → real branding +
  contrast-computed `accentForeground`; non-white-labeled tenant → generic
  default; nonexistent tenant → identical generic default, never a 404; rate
  limit → 429) and `LoginForm.tsx` (branding applies after a successful lookup,
  falls back to default on a non-white-labeled/nonexistent tenant and on a
  network failure, existing a11y behaviors re-verified in the same describe
  block).

**Verification:** full unit suite green (157 files / 914 tests, one
pre-existing/unrelated flake in `DefinitionDetail.test.tsx` confirmed passing in
isolation — a `menuitem` timing flake, not touched by this fix), `tsc --noEmit`
clean across all 31 workspace packages/apps, `eslint . --max-warnings=0` clean
repo-wide, coverage on every file this fix touched ≥95% (`AdminShell.tsx` 100%,
the new route 100%, `LoginForm.tsx` 95.47%, `build-brand-style-tag.ts` 100%,
`client-ip.ts` 100%, `tenancy.ts` 100%) — all above the 80% bar.

**Security review:** the new endpoint is unauthenticated by design (the whole
point is pre-login branding) but scoped defensively: rate-limited, returns only
4 narrow display fields, never distinguishes "tenant doesn't exist" from
"tenant exists but isn't white-labeled" (both return the identical generic
body) so it can't be used for tenant-slug or white-labeling-status enumeration,
and validates the `slug` path param against `TENANT_SLUG_PATTERN` before any
database query. No new secrets, no auth-boundary change, no raw
string-concatenated queries (reuses existing `resolveTenantBySlug`/
`getTenantBranding` parameterized queries).

**Deliberately deferred / not applicable:** none — both parts of the reported
scope bug are fully fixed in this pass, no stubbing.
