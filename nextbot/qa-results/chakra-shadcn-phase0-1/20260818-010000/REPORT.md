# QA Report -- Chakra to shadcn Migration, Plan Phases 0-1 (apps/web only)

## Scope
Verify Phase 0 (Tailwind v4/shadcn CLI setup) + Phase 1 (per-tenant branding CSS-var
mechanism, AdminShell rebuild + temporary ChakraProvider shim, LoginForm conversion,
BrandingSettings conversion, forgot-password page) per the migration plan file.
Immediate verification (not deferred) because this touches authentication and the
branding/theming mechanism. Scope is apps/web only -- apps/widget-embed (Phase 5)
and the rest of the screen sweep (Phase 2-4) are explicitly out of scope.

## Environment
- apps/web run as a standalone "next dev" process (port 3400) against the real
  running dev Postgres/Redis (docker-compose.yml's nextbot-postgres-1/host port
  5432, nextbot-redis-1/host port 6379) -- the existing nextbot-web-1 docker image
  was 14h stale and a rebuild failed on an unrelated, pre-existing sqlite3
  node-gyp/Python build issue in the Dockerfile (out of scope for this dispatch,
  reported informationally).
- Tenant "demo" (seeded, SEED_CREDENTIALS.md), admin@demo.nextbot.local.
- Browser automation: a real Chromium via Playwright 1.62 + axe-core/playwright
  (already present in the pnpm store from a prior QA pass; installed into a scratch
  folder outside the workspace to drive it, removed afterward).
- Full automated suite/typecheck/lint run from the repo root against
  compose.test.yml's already-running ephemeral Postgres/Redis/ClickHouse
  (55432/56379/58123).
- All test-induced DB state (tenant primaryColor overrides, failed_login_count)
  restored to original values afterward; apps/web/.env.local and all scratch
  scripts removed; dev server process killed.

## Full suite / typecheck / lint (independent re-run)
- vitest unit: 845/845 passed -- matches dev's claim exactly.
- vitest integration: 283/283 passed -- matches.
- vitest isolation: 76/76 passed -- matches.
- pnpm run typecheck: 31/31 packages clean (turbo) -- matches.
- pnpm run lint (eslint . --max-warnings=0): clean, exit 0 -- matches.
- pnpm run lint:boundaries (eslint + dependency-cruiser): clean, 0 violations
  across 1746 modules / 3757 dependencies -- matches.
- Net: all of dev's claimed counts independently confirmed. No test-suite defects.

## Base UI vs Radix deviation -- verified legitimate
- packages/ui/package.json and every generated primitive (button/input/avatar/
  badge/breadcrumb/separator/switch/tooltip) import from @base-ui/react, not any
  @radix-ui/* package -- confirmed by direct grep, not just dev's claim.
- components.json's "style" field is literally "base-lyra" -- internally
  consistent with the preset resolving the "Lyra" style onto the Base UI primitive
  library, not a hand-substitution.
- @base-ui/react@1.7.0's own installed package.json: MUI Team, MIT license,
  github.com/mui/base-ui, real published/adopted headless a11y-focused component
  library -- passes the dependency maturity bar (maintained, permissive license,
  real adoption).
- Spot-checked accessibility parity directly (not assumed):
  - Tooltip: popup renders and is reachable via both hover and genuine keyboard
    Tab-focus (data-popup-open state, visible popup).
  - Switch: real role="switch" with aria-checked toggling true to false on a
    Space keypress via keyboard only -- full native-equivalent semantics.
- Verdict: legitimate, not a fabricated workaround. No defect here.

## Branding SSR mechanism -- verified for real, not just claimed
- curl'd the raw HTML of /dashboard (not devtools/hydrated DOM) with a real
  session cookie for tenant demo (primaryColor #4f46e5, secondaryColor #0e3b28):
  raw response body contains
  <style>:root{--primary:#4f46e5;--primary-foreground:#ffffff;--brand-sidebar:#0e3b28;}</style>
  verbatim in the initial SSR payload. Confirmed real, SSR'd, no FOUC.
- Contrast-fallback correctness, tested live by temporarily mutating demo's
  primaryColor in the DB and re-curling:
  - #ffff00 (bright yellow) gives --primary-foreground:#000000 (black) -- correct.
  - #808080 (mid-gray) gives --primary-foreground:#000000 -- correct by manual
    verification of the WCAG ratios (black/gray about 5.32:1 passes AA, white/gray
    about 3.95:1 fails). The shared checkContrastRatio utility from @nextbot/tenancy
    is genuinely reused (confirmed via import), not a second divergent algorithm.
  - Tenant color reverted to the original value afterward (verified via DB query).
- Screenshot 09-admin-shell-dashboard.png shows the live rendered result: dark
  green sidebar (--brand-sidebar), indigo top accent/avatar (--primary).
- Verdict: PASS, exactly as dev claimed.

## Temporary ChakraProvider shim -- verified for real
- Logged in via a real browser, navigated to 5 still-Chakra screens (/audit-log,
  /agent-platform/model-gateway, /settings/pii-guardrails, /roles, /channels). All
  rendered correctly, nested inside the new shadcn shell, with tenant branding
  colors (indigo/dark-green) visibly and consistently applied to Chakra-rendered
  controls too (e.g. "Save Route", "+ Invite User" buttons) -- no double-theming
  visual conflicts, no broken layout. Screenshots:
  10_agent-platform_model-gateway.png, 10_roles.png, 12-roles-chakra-nested.png.
- Console/network: zero new console errors on any of these 5 screens (one
  pre-existing 404 was my own test-harness mistake -- wrong route path, not a
  product defect; the real route is /audit-log, not /settings/audit-log).
- axe-core scan on /roles (Chakra content nested inside the new shell): zero
  violations.
- Raw SSR HTML of /dashboard also confirms the Chakra Emotion global CSS reset
  (--chakra-* custom properties, global :focus-visible override) is present and
  correctly scoped as a nested provider -- did not detect any actual style
  collision with the new shadcn/Tailwind classes in practice.
- Verdict: PASS, the shim works as designed.

## Defects found

### D1 -- Failed login clears the email/tenant fields; spec requires email retained (Moderate)
docs/design/UX_GUIDELINES.md section 2.1 explicitly states: "password field is
cleared, email is retained" on an incorrect-credentials error. Live-tested: after
one failed submission (tenant=demo, email=admin@demo.nextbot.local, wrong
password), all three fields (tenantSlug, email, password) are empty -- confirmed
via inputValue() on all three fields immediately after the error alert renders.
apps/web/app/login/LoginForm.tsx and actions.ts never round-trip the submitted
email/tenant back into LoginFormState to repopulate the fields (no
defaultValue/state wiring at all), and React 19's useActionState-bound
form-action resets all native form fields to empty after every action call unless
the component explicitly repopulates them -- this reset was not compensated for.
- Repro: submit the login form once with a wrong password, then check the tenant
  and email inputs -- both are empty in the re-rendered form, not just password.
- Impact: user must retype tenant+email on every retry, directly contradicting the
  written requirement; not auth-bypassing or blocking (login still works with
  correct credentials).
- Phase: Phase 1 (LoginForm.tsx conversion).

### D2 -- Focus does not move to the error alert after a failed login (Moderate, a11y)
Same section 2.1 explicitly requires: "Focus moves to the alert (role=alert...) so
screen readers announce it immediately." Live-tested: after a failed submission,
document.activeElement is <body> -- focus is never programmatically moved to the
Alert. A screen-reader user gets no immediate announcement of the failure via
focus movement (the aria-live=assertive region may still eventually announce via
the live-region mechanism in most screen readers, but the explicit focus-move
requirement is not met).
- Phase: Phase 1 (LoginForm.tsx conversion).

### D3 -- Hydration mismatch console error on every /login page load (Minor, console hygiene)
Every load of /login logs a React hydration-mismatch error to the console: the
Base UI Tooltip trigger's server-rendered id (base-ui-_R_fh9bn5rlb_) differs from
the client-rendered id (base-ui-_R_3s9bn5rlb_) for the SSO tooltip-trigger span.
Reproduced consistently across multiple fresh page loads. Does not visibly break
functionality (tooltip still works both by hover and keyboard focus, confirmed
live), but is a real console error present on the auth screen the task explicitly
asked to check, and un-investigated id-generation non-determinism is the kind of
thing that can silently break under React strict/concurrent features later.
- Phase: Phase 1 (LoginForm.tsx's Tooltip/TooltipTrigger usage, or possibly
  @base-ui/react's own SSR useId behavior under Next.js 15 -- root cause not
  isolated further per QA's report-don't-fix mandate).

### D4 -- Two unlabeled text inputs on Branding Settings (Critical a11y, axe critical impact)
axe-core flags (rule id "label", impact critical) the primary-color and
secondary-color hex text Input fields on /settings/branding -- confirmed by source
read: BrandingSettings.tsx's Label htmlFor="branding-primary-color" is wired only
to the adjacent native input type=color swatch (which does carry that id); the
actual shadcn Input text field showing/editing the hex value right next to it has
no id at all, so it has no accessible name whatsoever. Same pattern repeats for
secondary color. Visually invisible (sighted users see the labeled swatch right
next to it) but a screen-reader user tabbing to the hex text field hears nothing
identifying it.
- Repro: axe-core scan of /settings/branding, rule "label", critical, 2 nodes
  (the two hex-value Input elements, ids auto-generated by Base UI since none was
  supplied).
- Phase: Phase 1 (BrandingSettings.tsx conversion, explicitly named in the plan's
  Phase 1 step 5).

### D5 -- Focus ring on shadcn Input is very faint (Rough edge, a11y)
docs/design/UX_GUIDELINES.md explicitly requires "a visible focus indicator... on
every focusable element" (carried over from a previously QA-fixed Chakra
:focus-visible override). The generated shadcn Input's focus style
(focus-visible:ring-1 focus-visible:ring-ring/50) renders as a 1px, 50%-opacity
muted-gray ring -- confirmed via computed style (a color-mix box-shadow at 50
percent opacity) and a cropped screenshot showing the focused tenant field is
barely distinguishable from its own unfocused border. This is the shadcn CLI
preset's stock default (not a custom regression dev introduced), but it is
materially weaker than the explicit "visible focus ring" bar this project has
enforced before.
- Phase: Phase 0 (preset-generated Input primitive, packages/ui/src/components/ui/input.tsx).
- Severity: rough edge, not blocking -- the ring does exist and does satisfy
  :focus-visible programmatically; it is a visual-prominence concern.

## Forgot-password page
apps/web/app/forgot-password/page.tsx is a real, working page (curl confirms 200
OK), not a dead link -- an honest placeholder ("Self-service password reset isn't
available yet. Contact your tenant administrator...") rather than a faked working
reset flow, exactly as the code comment states. Per the plan/dev's own note, the
"Forgot password?" link was already required by docs/design/UX_GUIDELINES.md
section 2.1 but had no destination page before this dispatch -- this migration
genuinely fixed a pre-existing gap (the link would otherwise have 404'd) rather
than being unrelated scope creep, since the login screen it lives on was already
being converted in this same phase.

## RTL / logical-property convention (NFR-8)
Grepped LoginForm.tsx, AdminShell.tsx, and every generated packages/ui primitive
for physical-direction utilities (pl-/pr-/left-/right-) -- zero matches.
AdminShell.tsx correctly uses ps-/pe-/ms-/me- throughout. dir="ltr" is hardcoded in
apps/web/app/layout.tsx with an explicit comment scoping this as an English-only
decision for this dispatch (not a silent regression). Pass.

## Architecture/dependency compliance
- dependency-cruiser clean, 0 boundary violations.
- build-brand-style-tag.ts deliberately lives in apps/web (not packages/ui, as the
  plan's prose suggested) with an explicit code-comment rationale: packages/ui is
  a "shared" package under eslint-plugin-boundaries and cannot depend on the
  "module" package @nextbot/tenancy, but apps/web (the composition root) can --
  avoids a second, divergent contrast algorithm. This is a reasonable, documented
  deviation, not a defect.
- ADR-0010 (correcting ADR-0002 section 4.2a and recording the Chakra-to-shadcn/
  Base-UI decision) does not exist yet -- this is explicitly Plan Phase 7, out of
  scope for this Phase 0-1 dispatch. Not a defect against this dispatch; flagging
  so it isn't forgotten by Final Review.

## Traceability matrix

| Item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Phase 0 exit: build/typecheck/lint green | full suite re-run | PASS | test-suite output above |
| Phase 0: Base UI vs Radix deviation | grep imports, package.json, live a11y spot-check (Tooltip/Switch) | PASS | see section above |
| Phase 1: branding SSR style tag | curl raw HTML, demo tenant real hex | PASS | grep output, 09-admin-shell-dashboard.png |
| Phase 1: contrast-fallback sensibility | #ffff00, #808080 live DB mutation + curl | PASS | curl output above |
| Phase 1: temporary ChakraProvider shim | 5 nested Chakra screens, console+axe | PASS | screenshots, chakra-screens-console-errors.json, axe-roles-chakra-nested.json |
| LoginForm: SSO tooltip hover+keyboard | live browser | PASS | 03-sso-tooltip-hover.png |
| LoginForm: password show/hide aria | live browser, attribute checks | PASS | report2.json |
| LoginForm: lockout vs wrong-password visual distinction | 6x live failed attempts | PASS | 08-lockout-state.png |
| LoginForm: email retained on failure | live browser, inputValue() | FAIL (D1) | reproduced live |
| LoginForm: focus moves to alert | live browser, activeElement check | FAIL (D2) | reproduced live |
| LoginForm: no console errors | live browser | FAIL (D3, hydration mismatch) | reproduced live |
| LoginForm: focus ring visible | live browser, computed style + screenshot | FAIL (D5, rough edge) | 02-login-first-focus.png |
| BrandingSettings: shadcn conversion, functional | live browser | PASS (visually) | 11-branding-settings.png |
| BrandingSettings: a11y (axe) | axe-core scan | FAIL (D4, critical) | axe-branding-settings.json |
| forgot-password: real working page | curl 200, code read | PASS | -- |
| RTL logical-property convention (NFR-8) | grep | PASS | -- |
| ADR-0010 | file existence check | untested/N-A -- Phase 7, out of scope | -- |

## Overall verdict: NOT READY -- retry required

Two real, previously-unverified defects against explicit written requirements (D1
email-not-retained, D2 focus-not-moved-to-alert), one critical accessibility
defect (D4, two completely unlabeled form inputs on Branding Settings), plus a
console-hygiene defect (D3, hydration mismatch on every login load). None of these
are auth-bypassing or data-corrupting, but D1/D2/D4 are explicit, named
requirements in docs/design/UX_GUIDELINES.md that this exact dispatch's own
LoginForm/BrandingSettings conversion work was responsible for carrying forward
correctly, and D4 in particular is an axe "critical" impact finding on a screen
this dispatch explicitly converted. Recommend routing D1/D2/D3 back to nexus-dev
for Phase 1's LoginForm.tsx/actions.ts, and D4 for BrandingSettings.tsx; D5 is a
rough-edge, non-blocking note that can be addressed opportunistically. Everything
else in Phase 0-1 (Base UI/Radix legitimacy, branding SSR mechanism, temporary
ChakraProvider shim, RTL convention, architecture/dependency compliance, full
automated suite) is genuinely solid and independently re-verified -- this is a
narrow, fixable retry, not a wholesale rework.
