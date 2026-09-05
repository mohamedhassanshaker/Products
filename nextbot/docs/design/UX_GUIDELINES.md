# NextBot — UX Guidelines

**Status:** Living document. Section 1 is the project-wide design-system baseline —
written once, extended never (only clarified). Every later section covers a specific
feature/phase and cites the baseline instead of restating it.

---

## 1. Design System Baseline

### 1.a UI surface classification

NextBot is SaaS, multi-tenant, with a five-portal Control Plane (`docs/architecture/HLD.md`
§3.1) plus the embeddable Widget. Every screen belongs to exactly one of these buckets.
Any future screen that doesn't obviously fit must be classified explicitly here before
being built, not defaulted silently.

| Surface | Portals / examples | Who uses it | Design language |
|---|---|---|---|
| **Admin console (tenant application)** | Portal B (Admin Console incl. B.15 Agent Platform), Portal C (Designer Studio), Portal D (Human Agent Bridge) | Platform Admin, Backend System Owner, Conversation Designer, Platform Engineer, Human Escalation Agent — all tenant-scoped roles | Admin dashboard template: left sidebar nav, top bar, breadcrumb, data tables, side-panel/detail views, standard CRUD/list/detail/wizard patterns. Gated by RBAC (role/module), not a different skin per role. |
| **Developer portal** | Portal E | Developer/Integrator | Same admin shell chrome (nav/top bar) but content-area patterns lean toward docs/reference: code blocks, "Try it" interactive forms, OpenAPI-style endpoint reference, sandbox console. Not a marketing site — still authenticated, still tenant-scoped. |
| **Embeddable widget** | Portal A (Web Widget + channel equivalents) | End Customer / Employee (anonymous, no account) | Not admin-template — a compact conversational UI (launcher + message window) that inherits the *tenant's* brand profile (FR-ADM-07), not NextBot's. Must work embedded in an arbitrary host page (scoped styles, no leakage) and inside channel-native surfaces (WhatsApp, Slack, Teams, voice/IVR) via `render-fallback` degradation. |
| **Public/marketing site** | Not in MVP scope (no `nextbot.com`-style site defined in the spec/screen inventory) | Anonymous prospects | Not classified — do not build without an explicit design pass first if it's later added to scope. |
| **Platform admin console (NextBot operator, cross-tenant)** | "Internal ops tooling" (NFR-11), not a numbered portal | NextBot Platform Operator (internal staff) | Deferred to Architecture phase per NFR-11 — not part of MVP screen scope. When built, classify explicitly; default assumption is the same admin dashboard template, cross-tenant instead of tenant-scoped. |

Because this is SaaS, the public-marketing/platform-admin split from the general
Nexus template *would* normally apply — it collapses here because neither is in
current scope. Do not assume the Tenant Application default applies to a future
public site or operator console without re-classifying.

### 1.b Standards baseline (applies project-wide; reference, don't restate)

**Accessibility — WCAG 2.2 AA (NFR-7), operationalized concretely:**
- Contrast: ≥4.5:1 body text, ≥3:1 large text (≥24px or ≥19px bold) and meaningful
  UI components (icons-as-controls, focus rings, chart data-ink). FR-ADM-07's branding
  screen already runs a contrast checker on tenant primary/secondary colors against
  light/dark surfaces at save time — treat that as the canonical enforcement point for
  brand colors; anything NextBot's own chrome renders (status dots, badges, error text)
  must independently pass against Chakra's default theme tokens, not rely on
  tenant-supplied colors passing.
- Keyboard: every interactive element reachable via Tab/Shift+Tab in visual reading
  order (logical order in RTL too — see i18n below); a visible focus indicator
  (Chakra's default focus ring, not suppressed) on every focusable element; no
  keyboard traps in modals/dialogs (focus is trapped *inside* an open modal only,
  returned to the trigger element on close).
- Semantic structure / ARIA: follow WAI-ARIA APG patterns for every custom composite
  component — menu (sidebar nav, overflow menus), dialog (confirm modals, wizards),
  tabs (connector detail tabs), combobox (search/filter), grid/table (sortable
  columns), tree (schema inspector). Chakra/Ark UI primitives already implement most
  of these correctly out of the box — do not override their ARIA wiring by hand
  unless composing a genuinely new pattern (e.g., the rule builder, §4).
- Screen readers: label every icon-only control (`aria-label`), announce async state
  changes via `aria-live` regions (see feature sections for exactly where), and never
  convey status by color alone (status dots/badges always pair a color with text or
  an icon+text, e.g., "● Connected" not just a green dot).
- Motion: respect `prefers-reduced-motion` — explicitly required for the widget
  launcher animation (FR-OC-01/NFR-7) and applies equally to any admin-console
  transition (drawer slide-ins, skeleton shimmer) — provide a reduced/no-motion
  fallback (opacity fade or instant) rather than skipping animation-state design
  entirely.
- **Enforcement mechanism:** axe-core is the standing gate — run `@axe-core/react`
  in dev and `@axe-core/playwright` (or `jest-axe` for component tests) in CI for
  every new screen/component; a screen does not ship with unresolved axe violations
  at the "serious"/"critical" impact level. Where axe cannot catch something (focus
  order, reduced-motion behavior, meaningful-vs-decorative alt text), that's a manual
  review item called out per-feature below.

**Interaction heuristics (Nielsen's 10)** — judge every flow against these; only the
non-obvious ones are called out per-feature, not all ten every time:
1. Visibility of system status — connector/tool status dots, health checks, "Discover
   Tools" progress, approval-queue counts, SSE-driven live updates all need an
   explicit loading/pending state, never a silent wait.
2. Match between system and real world — use the product's own vocabulary (Tier 1/2/3,
   Connected/Degraded/Offline, Sandbox/Staging/Production) exactly as the spec defines
   it; never invent parallel terminology.
3. User control & freedom — undo/cancel on destructive or hard-to-reverse actions
   (disable connector, revoke trust, reject approval, circuit-breaker reset).
4. Consistency & standards — one wizard shell pattern, one table/filter pattern, one
   badge/status-dot pattern reused everywhere rather than one-off variants per screen.
5. Error prevention — confirm modals before destructive actions state the concrete
   consequence (e.g., "3 active conversations will continue to completion" per
   FR-OC-02), not a generic "Are you sure?".
6. Recognition over recall — breadcrumbs, persistent tenant/environment context,
   inline schema/field hints rather than requiring the admin to remember them.
7. Flexibility & efficiency — bulk actions (Tool Catalog, Agent Tool Registry),
   keyboard shortcuts where natural, saved filters.
8. Aesthetic & minimalist design — admin tables show the columns the spec names, not
   speculative extras; side panels over full-page navigation for drill-down where the
   list context still matters.
9. Help recognize/diagnose/recover from errors — verbatim transport errors where the
   spec requires it (FR-MCP-02), field-targeted validation messages (FR-AI-01), never
   a bare "Error" or "Something went wrong" where the spec specifies exact copy.
10. Help & documentation — Developer Portal's docs/API reference; inline field-level
    help text/tooltips on non-obvious admin-console config (schema constraints,
    approval-tier defaults).

**Chakra UI conventions:**
- Theme tokens only — colors, spacing, radii, shadows come from the theme
  (`theme.tokens.ts` incl. per-tenant brand-profile token overrides for FR-ADM-07),
  never hard-coded hex/px values in component code. Status semantics (Connected/green,
  Degraded/amber, Offline/red; Success/Failed/Pending) map to fixed semantic tokens
  (`status.success`, `status.warning`, `status.danger`, `status.pending`) so a
  white-labeled tenant's brand color never collides with or overrides status meaning.
- Composition over configuration — build composite patterns (wizard step shell,
  status badge, rule-builder row) as small composed components over Chakra primitives
  (`Stack`, `HStack`, `Tabs`, `Table`, `Dialog`/`Modal`, `Menu`, `Tag`, `Skeleton`,
  `Alert`), not new one-off primitives.
- **Logical CSS properties throughout, no physical ones.** Use `ps`/`pe`/`ms`/`me`
  (padding/margin-inline-start/end), `insetInlineStart`/`insetInlineEnd`,
  `borderStartRadius`/`borderEndRadius`, `textAlign="start"/"end"` — never `left`/
  `right`/`marginLeft`/`marginRight`/`pl`/`pr`. This is how RTL mirroring (NFR-8) is
  achieved without per-locale conditional styling. Lint for this (see i18n below).
- Dark mode is **not required for MVP** — build components against the light theme
  only; don't invest in a dark palette until it's explicitly scoped. (If a tenant's
  brand profile happens to produce very dark theme tokens via white-labeling, the
  FR-ADM-07 contrast checker is the actual guardrail, not a dark-mode design pass.)
- Platform design language: Chakra/Ark UI is its own convention set (not Material,
  not a second system layered on top). Reach for Material's published spacing/
  elevation/motion guidance only if Chakra's own docs don't answer a specific
  question — don't import Material patterns wholesale.

**RTL / i18n (NFR-8):**
- `next-intl` is the scaffold; every tenant-authored or NextBot-authored string
  (nav labels, button text, table headers, error/empty-state copy, tooltips) is a
  translation key, never inline literal text in a component, even in English-only
  screens — English is just the default locale's translation file.
- `dir` (`ltr`/`rtl`) is derived from the active locale's script and set at the
  document/root level — RTL is full layout mirroring (nav sidebar moves to the
  visual right, breadcrumb chevrons flip, form field order flips, chart/table
  reading order flips), not just `text-align: right`.
- Enforcement: a lint rule (`eslint-plugin-tailwindcss`-style custom rule or a
  simple regex-based CI check) flags any physical-direction Chakra prop (`left`,
  `right`, `pl`, `pr`, `ml`, `mr`, `marginLeft`, etc.) in `packages/ui` and any
  portal/app code — same mechanism class as the module-boundary lint already in
  place per LLD §2.3, applied to this new axis.
- Numerals, dates, and bidi content (e.g., a Latin-script tracking number inside an
  Arabic RTL sentence) need explicit bidi isolation (`unicode-bidi: isolate` /
  `<bdi>`-equivalent) wherever user-facing generated tokens (tracking numbers, tool
  names, connector names) are interpolated into translated strings — don't let a
  Latin-script ID visually reverse inside RTL text.
- This applies to both the Widget (customer-facing, 40+ languages, NFR-8) and the
  Admin Console (tenant admins may also operate in Arabic) — build every admin-console
  screen RTL-safe by default, not just the widget.

**Responsive breakpoints:**
- Widget: mobile-first, must work down to ~320px viewport width (embedded in a
  narrow mobile WebView) up through desktop host pages; `mobile behavior` config
  (full-screen vs. bottom-sheet, per B.2.2) is itself a tenant setting — the two
  widget layouts are first-class states, not just a CSS breakpoint afterthought.
- Admin Console / Designer Studio / Human Agent Bridge / Developer Portal: primarily
  a desktop tool (data tables, multi-column detail views, visual workflow/canvas
  editors) — optimize for ≥1280px. Tablet (~768–1279px) collapses the sidebar to an
  icon rail (expandable on demand) and stacks side-panel detail views to full-width
  overlays instead of split-pane. Sub-tablet/mobile admin use is not a target for
  MVP (canvas editors, rule builders, and matrices genuinely need width) — do not
  block on mobile-optimizing them, but never let the layout become unusable/broken
  at tablet width; a "best viewed on a larger screen" notice is acceptable below
  ~768px rather than a broken layout.

**Multi-portal admin shell navigation pattern (Portal B/C/D shared chrome, per HLD
§3.1's "share auth, tenant context, RBAC, design system, i18n" note and screen
inventory B.1.1):**
- **Left sidebar**, collapsible to icon rail: top-level sections — Dashboard,
  Channels, Connectors, Tool Catalog, Agent Tool Config, Agent Platform (nested:
  Definitions, Deployments, Evals, Model Gateway, Runtime Traces), Conversations,
  Escalations, Approvals, Reports, A2A, Settings. Portal C (Designer Studio) and
  Portal D (Human Agent Bridge) surfaces are reached from within this same shell
  (not a separate app shell) per role — a Conversation Designer sees Designer Studio
  sections: Capability Catalog, Playbooks, Guardrails, KB; a Human Escalation Agent
  primarily sees Conversations/Escalations. RBAC-driven nav visibility is detailed
  in §2 below.
- **Top bar**: tenant name/logo (left in LTR, right in RTL — logical props), a
  visually distinct environment badge (Sandbox/Staging/Production — color-coded but
  always paired with text, never color-only per accessibility baseline), global
  search, notifications bell (with an unread-count badge), user avatar + role label
  + account menu (profile, MFA management, logout).
- **Breadcrumb**: a context trail directly below the top bar on every screen deeper
  than a top-level list, e.g. "Connectors > Zendesk Support > Tools > create_ticket".
  Every breadcrumb segment except the last is a link back to that level.
- This shell (sidebar + top bar + breadcrumb) is the single reusable layout
  component for all of Portals B/C/D/E — build once in `packages/ui`, do not
  reimplement per portal.

---

### 1.c Field-level help convention (`FieldHint`)

Ties into Nielsen heuristic 10 (§1.b) — every non-trivial form field gets inline
field-level help, not just the screens explicitly called out per-feature below.

- **Primitive:** `packages/ui/src/components/ui/field-hint.tsx` (`FieldHint`) is the
  one, reusable way to attach this help — a small info icon rendered right next to the
  field's `Label`, wrapping the existing `Tooltip`/`TooltipTrigger`/`TooltipContent`
  primitives (`packages/ui/src/components/ui/tooltip.tsx`). Don't hand-roll a
  one-off tooltip-on-a-`Label` pattern per screen; use `FieldHint`.
- **Usage is distinct from this codebase's other tooltip usage.** Existing tooltips
  (e.g. `RolesTable.tsx`'s disabled-row explanation) explain a state; `FieldHint`
  explains a *field* and always sits beside a `<Label htmlFor="...">`, never inside a
  table row or on a disabled control.
- **Copy rule:** one sentence, states what the field *does* — its effect, constraint,
  or where it's consumed elsewhere in the system — never a restatement of its label.
  "Route Key: the key for the route" is wrong; "The identifier other parts of the
  platform use to reference this model route (e.g. in an agent's YAML config)" is
  right. Write the sentence after reading the field's actual handling in code, not
  from the label text alone.
- **Rollout status:** proven on two screens (Model Gateway's route editor, Version
  Editor's top fields) as of the phase that introduced this convention. The full
  mechanical sweep across every remaining admin-console form field is separate,
  later work — new fields added in the meantime should still get a `FieldHint` from
  day one rather than waiting for that sweep.

---

## 2. Feature: Admin Console Shell + Auth Screens

**Covers:** FR-ADM-01 (Global Navigation & Tenant Context), FR-ADM-02 (RBAC),
FR-SEC-03 (Authentication/SSO/MFA). Surface: **Admin console (tenant application)**
per §1.a. Screen-inventory refs: B.1.1 (Global Navigation Shell), B.14.1 (Admin
Login), B.14.2 (MFA Enrollment).

### 2.1 Login flow

**User flow:**
1. Unauthenticated user lands on the Admin Login page (tenant-branded if
   white-labeling is enabled, per FR-ADM-07 — else default NextBot chrome).
2. Chooses email+password **or** "Sign in with SSO."
   - Email+password: enters credentials → submit.
   - SSO: click "Sign in with SSO" → if the tenant is recognized (subdomain/tenant
     slug already resolved), redirect directly to the IdP; otherwise prompt for a
     tenant identifier first, then redirect.
3. If the account has MFA enrolled (or the role requires it per FR-SEC-03's
   per-role enforcement config), an MFA challenge screen follows successful
   password/SSO auth.
4. On success, land on Dashboard Home (B.1.2) inside the shell described in §1.
5. Exit: logout via the top-bar account menu returns to this login screen; session
   timeout (configurable per role) also returns here with a "Your session expired —
   please sign in again" notice (distinct from a failed-login message).

**States (Chakra components in parens):**
- **Default:** `Field` (email), `Field` (password, with a show/hide toggle icon
  button, `aria-label="Show password"`/`"Hide password"`), primary `Button` "Sign
  in", secondary `Button`/link "Forgot password?", divider, `Button` "Sign in with
  SSO" (outline variant, IdP logo if tenant recognized).
- **Loading (submit in flight):** primary button shows a `Spinner` + disabled state,
  both fields disabled, no layout shift (reserve the spinner's space in the button
  already).
- **Error — incorrect credentials:** inline `Alert` (status="error") above the form:
  "Incorrect email or password." — deliberately generic (do not reveal which field
  was wrong or whether the email exists) but distinct in wording from the lockout
  message below. Focus moves to the alert (`role="alert"`, or an `aria-live="polite"`
  region) so screen readers announce it immediately; password field is cleared,
  email is retained.
- **Error — lockout (FR-SEC-03):** after the configured failed-attempt threshold
  (default 5), the *same* alert region instead reads: "Too many failed attempts —
  try again in a few minutes." This must be visibly and textually distinct from the
  incorrect-credentials message (different copy, ideally a `warning`-tier visual
  treatment vs. `error`-tier) so a user can tell "wrong password" from "temporarily
  locked out" apart — but neither message says whether the account exists, per the
  spec's account-existence-non-leakage intent. Sign-in controls become disabled for
  the cooldown window; do not show a live countdown timer (avoids implying an exact
  unlock time you might not guarantee) — re-enable the form on next page load/retry
  attempt after the cooldown elapses server-side.
- **Error — zero-role account (FR-ADM-02):** distinct alert: "Your account has no
  assigned role — contact your administrator." This fires *after* successful
  password/SSO/MFA verification (the credentials were correct) — do not conflate
  with the incorrect-credentials or lockout messages. No further action is offered
  besides a "Contact support" or admin-email mailto link if configured; the user is
  not returned to a retry state since retrying won't help.
- **Empty state:** N/A (this is a form, not a list).
- **Success:** brief transition (respecting `prefers-reduced-motion`) into the
  Dashboard Home; no separate "success" screen.
- **Focus/hover:** visible focus ring on every field/button; Enter submits the
  form from either field.

**Accessibility beyond baseline:** the three distinct error messages (incorrect
password / lockout / zero-role) must each be programmatically associated with the
form via `aria-live="assertive"` on the alert container (errors are important enough
to interrupt) — but only one is shown at a time, never stacked. Password visibility
toggle is a real button (not a bare icon div) with `aria-pressed` state.

**Relevant heuristics:** error prevention + recognize/diagnose/recover from errors
(three distinct, specific messages rather than one generic failure) is the crux of
this screen; help & documentation via the "Forgot password?" and SSO paths.

### 2.2 MFA challenge (TOTP)

**User flow:** after credential verification, if MFA is required: show a 6-digit
code entry screen → submit → verified → proceed to app. User can instead click
"Use backup code" to switch input mode, or (if SMS/email MFA configured for this
account) "Resend code."

**States:**
- **Default:** a `PinInput`-style 6-box numeric entry (or a single masked `Input`
  with `inputMode="numeric"` if a segmented control isn't available), autofocused,
  primary `Button` "Verify". Secondary links: "Use backup code," "Resend code"
  (only shown for SMS/email methods, disabled with a visible cooldown label e.g.
  "Resend available in 0:45" while the resend cooldown is active — this is one case
  where a live countdown *is* appropriate since it's a user-initiated action with a
  known server-enforced window, unlike the lockout case above).
- **Loading:** button spinner + disabled input during verification.
- **Error — invalid code:** inline alert "That code isn't valid — please try again."
  Input is cleared and refocused; does not lock the account on a single miss (only
  the same failed-attempt/lockout counter as password failures applies, per
  FR-SEC-03's single threshold — confirm this is one shared counter, not a
  separate one, when implementing FR-SEC-03's data model).
- **Error — expired/backup-code-exhausted:** "This code has expired — request a
  new one" (TOTP-window) or "No backup codes remain — contact your administrator"
  distinctly worded per cause.
- **Success:** proceeds to Dashboard Home.
- **Backup-code mode:** input switches to a plain text field (backup codes are
  typically alphanumeric, not 6-digit), label updates to "Backup code," a "Use
  authenticator app instead" link switches back.

**Accessibility:** the 6-digit entry must remain keyboard/screen-reader operable
(each box or the single input labeled "Verification code, 6 digits"); paste of a
full code into the first box should distribute across all boxes if a segmented
`PinInput` is used (Chakra's `PinInput` does this natively).

### 2.3 RBAC-gated navigation

**Pattern:** the left sidebar (§1) renders a fixed list of sections, but each
section/item is filtered per the logged-in user's effective permission matrix
(FR-ADM-02: per-module Read/Write/None across channel config, connector config,
tool permissions, agent tool config, approval queue, reporting, A2A config).

- A module the user has **None** access to: the nav item is **hidden entirely**,
  not shown-disabled — do not reveal the existence of modules a role can't see
  (e.g., a Conversation Designer shouldn't see "Approvals" in their sidebar at all).
- A module the user has **Read** access to: nav item shown and navigable; the
  destination screen renders in a read-only state — all mutating controls (Save,
  Add, Delete, Approve/Reject, toggles) are rendered `disabled` with a tooltip
  "You have read-only access to this module" on hover/focus (not simply removed,
  so the user understands the capability exists but isn't theirs — recognition
  over recall).
- A module the user has **Write** access to: fully interactive, no restriction.
- **Approval Queue** is its own permissioned module (FR-ADM-04) — a user who can
  view a connector but lacks Approval Queue access sees the queue's existence
  (e.g., a "3 pending" badge on the dashboard, if their role can see connectors)
  but the Approve/Reject actions themselves are gated the same disabled+tooltip
  way, or the Approvals nav section is hidden entirely if they have no visibility
  into approvals at all — implementers should default to full hide, not a
  half-visible teaser, when in doubt (fail-closed default per FR-ADM-02/FR-SEC-06's
  fail-closed philosophy).
- Attempting to deep-link (URL) directly to a module with None access renders a
  full-page "You don't have access to this section" state (not a 404, not a
  silent redirect) with a link back to Dashboard Home.

**Accessibility:** disabled controls still need an accessible name and the reason
communicated (tooltip content should also be reachable via `aria-describedby`, not
hover-only, since keyboard/screen-reader users need the same explanation).

**Relevant heuristics:** error prevention (can't attempt an action you don't have
rights for) + recognition over recall (tooltip explains *why*, not just *that* it's
disabled).

### 2.4 Tenant context header + environment badge

Per §1's top-bar spec: tenant name/logo always visible (falls back to text
wordmark per FR-ADM-07 if no logo, never a broken image icon), environment badge
(Sandbox/Staging/Production) always visible and color-coded *with* text label —
this is the single most important guardrail against a Sandbox/Production mistake,
so treat it as a persistent, unmissable element, not a subtle chip: use a solid
background badge, not just colored text. User avatar + role label (e.g., "Priya
Nair · Platform Admin") + logout in the account menu (`Menu` component, keyboard
operable per APG menu pattern).

### 2.5 Breadcrumb

Rendered as a `Breadcrumb` component directly under the top bar on every screen
below the top level. Truncate long segments (e.g., long connector names) with an
ellipsis + full text in a tooltip/`title`, never silently cut off with no way to
see the full value.

---

## 3. Feature: Add Connector Wizard + Credential Entry + Tool Discovery

**Covers:** FR-MCP-01 (Connector Registration), FR-MCP-02 (Tool Discovery),
FR-MCP-10/11 (Templates & Custom Servers). Surface: **Admin console**. Screen-
inventory refs: B.3.3 (Add Connector Wizard), B.3A.2 (MCP Server Enrollment — the
generalized agent-facing version; use the same wizard shell/state patterns for
both, they differ only in step content per the inventory, not in interaction
pattern).

### 3.1 Wizard shell & steps

Use a horizontal step indicator (numbered, with the current step highlighted and
completed steps checkmarked) at the top of a modal or full-page wizard container
(full-page is preferable here — schema trees and diff views need width; a modal
would force scrolling within scrolling). Steps:

1. **Choose Type** — card grid of pre-built templates (logo, name, backend type,
   "X tools available", short description) plus a "Custom MCP Server" card.
   `Card` components in a responsive grid, each fully clickable (not just a small
   "Select" button inside it), with a visible selected state (border + check icon,
   not color alone).
2. **Connection Details** — name, description, backend type (`Select`), environment
   (`RadioGroup` or `SegmentedControl`: Sandbox/Production), transport
   (`RadioGroup`: Streamable HTTP vs. stdio-via-Gateway-Agent — selecting the
   latter reveals a Gateway Agent picker `Select`, sourced from already-registered
   Gateway Agents per B.12), auth method (`Select`: OAuth2/API Key/Bearer
   Token/Custom Header — each choice reveals its own credential sub-form).
3. **Credential entry** — see §3.2 below.
4. **Discover Tools** — see §3.3 below.
5. **Set Permissions** — per-tool default approval tier (pre-set by read/write
   classification, editable) — a compact table, full detail deferred to the Tool
   Permission Editor (§4) rather than duplicated here.
6. **Test** (sandbox tool-call panel) and **Activate** (confirmation + explicit
   production-activation toggle, per FR-ADM-05's "promotion between environments
   is explicit, never implicit on save").

**Navigation controls:** "Back"/"Next" (or "Continue") at the bottom, right-aligned
in LTR (start-aligned logically, so it flips in RTL); "Next" is disabled until the
current step's required fields validate — never let the admin advance into a step
that will just fail. A "Save as draft and exit" (secondary, lower-emphasis) lets the
admin leave mid-wizard; re-entering resumes at the last completed step, not step 1.

**States per step:** each step needs its own default/loading/error/success as
listed below — a wizard is incomplete if only the happy path per step is designed.

### 3.2 Credential entry (masked-only)

- **Default:** credential fields render as password-masked `Input`s (`type="password"`
  equivalent) with a show/hide toggle — same as the login password field pattern
  (§2.1) for consistency. For OAuth2, instead of a raw field, show a "Connect to
  [Provider]" button that opens the OAuth consent flow in a popup/redirect; on
  return, show a connected-state summary (masked token reference + "Rotate"/
  "Disconnect" — never the actual token, per FR-SEC-02).
- **Loading (Test Connection):** a "Test Connection" button shows a spinner and
  disables itself while checking; do not let the admin proceed to Discover Tools
  without either a successful test or an explicit acknowledgment they're skipping
  it (skipping should require a deliberate secondary action, not be the default).
- **Success:** green check + "Connection verified" inline confirmation next to the
  Test Connection button.
- **Error:** the raw connection error surfaces inline near the credential fields
  (e.g., "401 Unauthorized" style detail — align with FR-MCP-02's verbatim-error
  philosophy even at this pre-discovery stage: don't paraphrase a transport error
  into a vague "connection failed").
- Once saved, revisiting this step in Connector Detail/Edit (B.3.2) shows
  credentials as **masked only** — there is no "reveal" action anywhere in the UI,
  ever, per FR-SEC-02; only "Rotate"/"Replace" (which requires re-entering a new
  value, never displays the old one) and a "Last rotated: <date>" timestamp.

### 3.3 Discover Tools

- **Default (pre-discovery):** a single "Discover Tools" `Button`, primary, with
  explanatory text ("This calls the MCP server's `list_tools` and lists everything
  it can offer the AI agent").
- **Loading:** button → spinner + disabled; below it, a `Skeleton` list (3–5 rows)
  suggesting tools are being fetched, not a blank screen. Use an `aria-live="polite"`
  region to announce "Discovering tools…" then the result count once loaded, since
  this can take a few seconds against a real backend.
- **Error (transport failure, FR-MCP-02):** the wizard **halts at this step** — do
  not silently advance or offer a generic message. Render the *verbatim* transport-
  level error text in an `Alert` (status="error"), e.g. "Tool discovery failed: 401
  Unauthorized from MCP server," plus a "Retry" button and a "Back" affordance to
  fix credentials/connection details. Do not soften this into "Something went
  wrong" — the exact string from the server is the point (aids the admin's own
  debugging against their backend).
- **Success (first-time enrollment):** a checklist/table of discovered tools —
  columns: tool name, description, input/output schema summary (expandable to the
  full schema tree, reusing the Tool Schema Inspector pattern), auto-classified
  Read/Write badge (editable — a small toggle/`Select` next to the badge, since
  FR-MCP-02 says this is overridable by the admin). Checkbox per row (default:
  all checked) — unchecked tools are excluded from enrollment (spec: "hidden from
  the AI agent"). A header checkbox toggles all. A count summary ("14 of 16 tools
  selected") stays visible while scrolling a long list.
- **Empty result:** if `list_tools` succeeds but returns zero tools, this is a
  distinct empty state, not an error: "This MCP server reported no available
  tools." with guidance to check the server's configuration — do not treat an
  empty successful response the same as a failed one.

### 3.4 Re-discovery diff view (already-enrolled connector)

Re-running discovery on an existing connector must visually distinguish three
change classes against the previously enrolled tool list (FR-MCP-02):

- **Added tools:** rendered with a green-accented left border/badge "New" and
  appended at the top or clearly grouped in an "Added" section of the diff view.
- **Removed tools:** rendered with a muted/struck-through treatment and a red-
  accented "Removed" badge, grouped in a "Removed" section — these were previously
  enrolled and are no longer offered by the server; the admin must explicitly
  confirm removal (checkbox defaults to "confirm removal," but is a distinct,
  reviewable action, not silently dropped).
- **Schema-changed tools (incl. breaking changes):** rendered inline in an
  "Unchanged tools with schema changes" section with an amber "Schema changed"
  badge; clicking expands a **version-diff view** (old schema vs. new schema,
  field-level added/removed/type-changed highlighting — reuse the Tool Schema
  Inspector's version-diff capability, FR-MCP-15). A **breaking** schema change
  (removed required field, incompatible type change) gets a stronger visual
  treatment — red "Breaking change" badge instead of amber "Schema changed" — and
  should nudge the admin toward re-testing (link to the sandbox Test step) before
  re-confirming, though it does not hard-block re-confirmation (the spec doesn't
  require blocking, only flagging "before the admin re-confirms").
- The diff view requires an explicit "Confirm changes" action before it takes
  effect — re-discovery never silently overwrites the prior enrollment; this
  satisfies error prevention + user control/freedom for what is otherwise an
  easy-to-miss background change.

**Accessibility for the diff view:** don't rely on color alone for
added/removed/changed — pair each with a text badge ("New"/"Removed"/"Schema
changed"/"Breaking change") and, ideally, a leading icon (+/−/△) so the
distinction survives grayscale/colorblind viewing and screen-reader traversal
(the badge text is what a screen reader announces).

---

## 4. Feature: Tool Catalog + Permission Matrix + Rule Builder

**Covers:** FR-MCP-03 (Tool Catalog), FR-MCP-13 (Agent Tool Registry), FR-AI-02
(Autonomous Tool Selection — priority weight UI). Surface: **Admin console**.
Screen-inventory refs: B.3.4 (Tool Catalog), B.3A.1 (Agent Tool Registry), B.3.5
(Tool Permission Editor). Also references FR-MCP-04's permission scope matrix and
rule builder directly.

### 4.1 Tool Catalog list/filter

- **Layout:** filter bar above a `Table`: filters for connector (`Select`,
  multi-select), type (Read/Write), approval tier (Tier 1/2/3), status
  (Enabled/Disabled/Error) — each a `Select` or `CheckboxGroup` in a filter
  popover; active filters render as removable `Tag`s below the bar so the admin
  can see/clear what's applied at a glance (recognition over recall).
- **Columns:** name, connector, description (truncated with tooltip for full
  text), type badge, approval-tier badge, 7-day call count, avg latency, error
  rate — sortable columns (ARIA: `aria-sort` on `<th>`, per APG table pattern).
- **The "—" vs "0%" distinction (FR-MCP-03):** a tool with `last_called_at IS
  NULL` (never called) renders literal `—` (em dash, styled as muted/secondary
  text) in the call-count/success-rate/latency columns — not "0", not "0%", not
  "N/A". A tool that *has* been called but has a genuine 0% success rate (all
  calls failed) renders "0%" in normal (not muted) text, with a red/error-tone
  accent since a 0% success rate on a called tool is itself a notable, actionable
  signal. These must be visually distinguishable at a glance (muted "—" reads as
  "no data," the number "0%" in alert styling reads as "data exists and it's
  bad") — do not implement both as plain "0%"/"—" with identical styling, since
  the whole point of this requirement is the distinction being legible, not just
  technically present in markup.
- **Empty state (zero tools cataloged, e.g., no connectors enrolled yet):** an
  empty-state illustration/message "No tools yet — connect a backend to get
  started" with a primary CTA "Add Connector" linking to §3's wizard, not a bare
  empty table.
- **Loading:** `Skeleton` rows matching the table's column structure while the
  catalog loads or a filter is applied (avoid a full-page spinner replacing the
  whole table on every filter change — keep the filter bar interactive/visible
  and skeleton just the row area, so the admin doesn't lose their place).
- **Error:** if the catalog fails to load, an inline `Alert` in the table area
  with a "Retry" action — never an unstyled crash/blank page.
- **Tool detail (side panel, preferred over full navigation for this drill-down):**
  full JSON schema (reuse Schema Inspector), description, permission scope
  summary (links to §4.2/4.3 for the full editor), call-history log (last 50
  calls, each row: timestamp, status, latency, link to the originating
  conversation trace), latency chart (respecting reduced-motion for any chart
  entrance animation).
- **Bulk actions:** row `Checkbox`es + a bulk-action bar that appears once ≥1 row
  is selected (enable/disable, change approval tier, export as JSON) — the bar
  should show the selection count ("3 tools selected") and a "Clear selection"
  action.

### 4.2 Agent Tool Registry — visibility, priority, capability groups

This is the agent-facing counterpart to the catalog (same list, different control
surface) — reuse the catalog's table/filter shell, add:

- **Agent-visibility toggle:** a `Switch` per row, labeled clearly ("Visible to
  AI Agent" as a column header, not just an unlabeled switch) — off state is
  visually distinct (muted row background or a "Hidden from agent" tag on that
  row) so a scan of the table immediately shows which tools are currently
  invisible to the agent, since this is easy to forget about (FR-MCP-13 notes
  toggling mid-conversation doesn't abort an in-flight call but does block future
  turns — surface this as inline help text near the switch, e.g. a tooltip: "In-
  progress tool calls for this turn will complete; the agent won't select this
  tool on any later turn.").
- **Priority weight control:** a numeric stepper/slider (1–100) per row, with the
  numeric value always visible (not slider-only, since exact value matters for
  tie-breaking per FR-AI-02) — inline-editable in the table (click to edit,
  Enter/blur to commit) rather than requiring a separate modal, since this is a
  frequently-adjusted value. Drag-to-reorder within a capability group (per the
  inventory) is a nice-to-have secondary interaction; the numeric field is the
  primary, keyboard-accessible one — don't make drag-reorder the *only* way to
  set priority, since drag interactions are not reliably keyboard-operable
  without a lot of extra ARIA work, and the numeric field alone already satisfies
  the requirement.
- **Capability group assignment:** a `Select` (existing groups) or "+ New group"
  inline-creatable option per row/per bulk-selection; group membership also
  visible as a filter facet on this table.
- **Health summary column:** last-24h success rate, avg latency, error count —
  same "—" vs "0%"/"0" distinction as §4.1 applies here too. Rows with >5% error
  rate get a red-accented highlight (per the inventory's own spec) — again paired
  with text/icon, not color alone.

### 4.3 Permission rule builder (FR-MCP-04)

Two complementary views, per the spec's "both a matrix UI and a rule-builder":

**a) Scope matrix view** — rows = tools (or a single tool's detail context),
columns = dimensions (Channel, Role, Recognized Task, Customer Segment); each
cell is a tri-state control (`Allow`/`Deny`/`Require Approval`) rendered as a
small `Menu`/`Select` per cell (not raw radio buttons in every cell — too much
visual noise at matrix scale) with color+text-coded values (green Allow, red
Deny, amber Require Approval — text label always present in the cell, not a bare
color chip, per the color-is-never-the-only-signal baseline rule). An
"Inherited from backend-type default" indicator (subtle icon + tooltip) marks
cells that haven't been explicitly overridden, distinguishing "explicitly set to
Allow" from "defaulted to Allow" — this matters because FR-MCP-04's fail-closed
default (no rule + no backend-type default = Deny) should be visible, not a trap
the admin only discovers at runtime.

**b) Ordered rule-builder list** — the "WHEN [channel = X] AND [recognized task =
Y] AND [condition] → [action]" pattern:
- Rules render as an **ordered, numbered list** (drag-to-reorder handle + explicit
  up/down icon-button alternative for keyboard/screen-reader users, since ordering
  is semantically meaningful here — first match wins — and drag-only reordering
  would be an accessibility gap).
- Each rule row is a **condition builder**: a sequence of `WHEN`/`AND` scope
  selectors (`Select` for channel, role, task, customer segment — each optional/
  addable via an "+ Add condition" control) followed by an effect/tier picker
  (`Select`: Allow / Deny / Require Approval, and if Require Approval, which tier
  — Tier 2 Customer Confirmation vs. Tier 3 Human Approval).
- An explicit **"Default action"** row pinned at the bottom of the list,
  visually separated (divider + label "If no rule above matches…") — this is the
  required fallback the spec mandates (fail-closed to Deny unless a backend-type
  default applies) and must never be omittable or hideable, since an admin
  scanning only the numbered rules must still see what happens when none match.
- **Add rule** button appends a new blank rule row at the end (before the pinned
  default), pre-populated with sensible blanks, not error states, until the admin
  fills it in.
- **Validation:** a rule with an incomplete condition (e.g., a dangling `AND`
  with no selector) is blocked from saving with an inline, field-targeted message
  ("Choose a value for this condition, or remove it") — never a generic "invalid
  rule" banner.

**c) Simulate-permission preview state:** a "Test a scenario" panel (consistent
with the same pattern already used for Channel Routing Rules, B.2.4, and Tool
Composition workflows) — inputs: tool, channel, role, recognized task, customer
segment (whichever the admin wants to test); output: which rule fired (highlighted
in the ordered list itself, not just stated separately — scroll/highlight the
matching row) and the resulting effect. States:
- **Default:** empty form, "Run simulation" disabled until at least the tool
  field is chosen.
- **Loading:** brief inline spinner on the "Run simulation" button (this should be
  a fast, synchronous-feeling client-side evaluation against the already-loaded
  rule set, not a network round-trip in most cases — treat network latency as the
  loading case).
- **Result:** an inline result banner ("Rule #2 matched → Require Approval (Tier
  3)" or "No rule matched → Default action: Deny") plus the matching rule row
  highlighted with a distinct outline/background in the list above, scrolled into
  view if needed.
- **No-match result is not an error** — it's a valid, informative outcome (falls
  through to the default action) and should be styled neutrally/informationally,
  not as a failure state.

**Accessibility for the rule builder:** this is a genuinely new composite
interaction NextBot's base kit doesn't ship natively — flag this explicitly per
the harness's "flag genuine spec/pattern conflicts" instruction: Chakra/Ark UI has
no first-party "ordered condition-rule builder" component. Build it compositionally
from `Reorder`/drag-and-drop primitives (or a listbox + move-up/move-down buttons
for the accessible baseline) plus existing `Select`/`Menu` primitives; do not
attempt a custom drag-and-drop implementation without an equally-functional
keyboard path, since APG has no single canonical pattern for "reorderable
condition rule list" — the up/down icon-button fallback is the pragmatic
accessible baseline here, not a nice-to-have.

**Relevant heuristics:** error prevention (validation blocks incomplete rules
before save) + visibility of system status (the always-visible inherited/default
indicators and the pinned default-action row) + match between system and real
world (reusing the exact "WHEN...AND...THEN" language and Allow/Deny/Require
Approval vocabulary the spec itself uses, not a paraphrase).

---

## 5. Feature: Embeddable Web Widget — Shell, Lifecycle & Core Message Types

**Covers:** FR-OC-01 (Embeddable Web Widget), FR-OC-06 (Channel-Specific Rendering
Fallback — forward-compat note only, see §5.3.4), FR-OC-07 (Language Selection &
i18n), NFR-7 (Accessibility), NFR-8 (i18n/RTL). Surface: **Embeddable widget**
(Portal A) per §1.a — explicitly *not* the admin-dashboard template; this is its own
compact, host-page-agnostic conversational visual system. Screen-inventory refs:
A.1.1–A.1.5 (Widget Shell & Lifecycle), A.2.1/A.2.2/A.2.3/A.2.8/A.2.15 (the 5
message types implemented this phase — A.2.4–A.2.7, A.2.9–A.2.14, A.2.16–A.2.17 are
explicitly deferred; do not build states for them yet), A.3.1 (`NextBot.init({...})`
embed config). Architecture refs: LLD §5.3 (SSE channel contract, offline queue) and
§1 (`apps/widget-embed` — Vite library build, loader script + iframe bootstrap,
scoped Chakra theme so host-page styles never leak in either direction).

No Figma input was supplied for this feature — this section is the full source of
UX judgment for it.

### 5.1 Visual system — distinct from the Admin Console baseline

The widget is **not** an instance of the admin dashboard template (§1.a) and does
not reuse the admin shell's sidebar/top-bar/breadcrumb chrome at all. It is a
small, self-contained conversational surface with its own footprint and its own
scoped theme:

- **Footprint:** launcher ≈56–64px circular/pill floating action button; expanded
  window ≈400×600px on desktop, full-screen overlay or bottom-sheet on mobile
  (tenant-configurable per A.1.2 — both mobile layouts are first-class states per
  the baseline's responsive-breakpoints note, not a CSS-breakpoint afterthought).
- **Theming source of truth:** per FR-ADM-07, the tenant's brand profile
  (primary/secondary color, logo, font) supplies the widget's *default* theme
  tokens; a host page's embed config (`theme.*`) can override per-embed for
  multi-brand tenants. Either way, these become a **separate, widget-scoped Chakra
  theme instance** (`ChakraProvider` mounted fresh inside the widget's own
  document) — never the same theme instance/CSS bundle as the Admin Console.
  Never hard-code a NextBot-brand color into a widget component; every color is a
  theme token resolved from the active tenant/embed theme, same "tokens not hex
  values" rule as the baseline, applied here to a runtime-swappable theme instead
  of a build-time one.
- **Iframe boundary — what "never leaks" actually means and implies:** per LLD
  §1/§5.3, the widget ships as a loader `<script>` that bootstraps a **single
  iframe** housing the *entire* widget (both the collapsed launcher and the
  expanded window are states within that one iframe document, not two separate
  mount points). This gives complete, structural CSS isolation for free in both
  directions (the browser guarantees a host page's stylesheet cannot reach into
  an iframe's document and vice versa) — the "scoped theme/CSS build" requirement
  is therefore about correctly instancing Chakra *inside* that already-isolated
  document (fresh theme provider, no shared CSS custom properties assumed from
  an outer scope), not an additional leak-prevention mechanism layered on top.
  This has three concrete consequences nexus-dev must design around, detailed in
  §5.5: (1) collapsed-state click-through — the iframe's interactive hit region
  must track only the visually-drawn launcher, not a larger invisible box; (2)
  keyboard/tab order — the iframe is a single stop in the host page's native tab
  order, wherever the loader inserted it in the DOM; (3) screen-reader
  announcement — the iframe needs a static, descriptive `title`, and everything
  else (state changes, focus movement) is handled *inside* the iframe document
  with standard ARIA, not via the host page.

### 5.2 Widget shell lifecycle — flows & states

#### 5.2.1 Launcher (A.1.1)

**Flow:** renders on host-page load (from cached static assets even if the
network/API is unreachable — FR-OC-01's fail-open-visually/fail-closed-functionally
split) → user clicks/taps → expands to the widget window (§5.2.2) at whatever
screen (Welcome/Home if no active conversation, else the resumed conversation).

**States:**
- **Default (collapsed):** brand icon or animated AI avatar on a primary-color
  circular/pill button, host-configurable `position` (bottom-right default).
  Tooltip on hover/focus shows the configured label (e.g., "Chat with us"),
  implemented as a real accessible tooltip (`aria-describedby`, not title-attribute
  only), reachable on keyboard focus, not just mouse hover.
- **Unread badge:** small numeric badge (unresolved message or proactive-nudge
  present) — pair the numeric badge with an `aria-label` on the button itself
  (e.g., "Open chat, 2 unread messages") so the count isn't visual-only.
- **First-load pulse/bounce animation:** subtle, one-time (not looping
  indefinitely — a permanently animating floating button is a persistent
  distraction and fails the aesthetic/minimalist heuristic), fires once per
  session on first render. **Must respect `prefers-reduced-motion`:** the
  reduced-motion fallback is a single static, non-animated appearance change
  (e.g., a brief opacity/scale-in over ~150ms, or nothing at all) rather than
  skipping the "draw attention" affordance entirely — if reduced motion is
  requested, prefer swapping the pulse for a static, slightly more prominent
  resting state (e.g., the unread badge alone) instead of a moving ring/bounce.
- **Disabled (unknown/deactivated `tenantId`/`channelId`):** launcher renders
  visually but non-interactive, tooltip reads exactly "Chat is temporarily
  unavailable." per FR-OC-01 — do not omit the launcher entirely in this case
  (a vanished button is more confusing than a disabled one with an explanation).
- **Init failure (missing `tenantId`):** per FR-OC-01, no UI renders at all (not
  even a disabled launcher) — this is the one case where "nothing" is the correct
  state, since the spec explicitly fails closed before any DOM mounts.
- **Focus/hover:** visible focus ring (widget-theme-scoped, still meets ≥3:1
  against the button's own background per baseline contrast rule).
- Persists across SPA route changes (host-page navigation does not remount/reset
  it); respects mobile safe-area insets.

**Relevant heuristics:** aesthetic & minimalist design (one-time animation, not
looping) + visibility of system status (unread badge, disabled tooltip explains
*why* rather than just not working).

#### 5.2.2 Widget window open / minimize / close

**Flow:** launcher click → window expands (from Welcome/Home if no active
conversation, or resumes the existing conversation) → user minimizes (→ back to
launcher, conversation state preserved) or closes/ends chat (→ conversation is
marked resolved server-side per the spec's "after a conversation is resolved"
condition for A.1.3, next open returns to Welcome/Home) → user can reopen anytime.

**States:**
- **Opening (transition):** respects `prefers-reduced-motion` (slide/scale-in
  vs. an instant/opacity-only fallback), matching the baseline's motion rule.
- **Header bar (persistent across all conversation states):** brand logo/AI
  assistant name, language toggle, minimize button, close/end-chat button — all
  real icon buttons with `aria-label`s ("Minimize chat", "End conversation"),
  never bare `<div>`s with click handlers.
- **Ending a conversation is a confirmable action, not a silent one-click:**
  clicking close/end-chat while a conversation is in progress (any AI/customer
  messages exchanged this session) shows a lightweight inline confirm ("End this
  conversation?" / "End" / "Cancel") — error prevention + user control/freedom,
  consistent with the baseline's destructive-action-confirms-with-consequence
  pattern, scaled down for a compact surface (an inline two-button row inside the
  header, not a full modal). Minimizing never needs confirmation (it's fully
  reversible, conversation persists).
- **Powered-by footer:** present by default, removable via white-label config
  (FR-ADM-07) — render/omit this as a config-driven boolean, not a hardcoded
  element.
- **Quick-action bar (optional, below header):** configurable shortcut chips
  (embed config `quickActions[]`) — same chip visual/interaction pattern as
  Quick Reply Chips (§5.3.2) for consistency, but these are **persistent** (not
  single-use-disabled — tapping one pre-fills/sends a request and the bar remains
  available for the next shortcut), a deliberate visual/behavioral distinction
  from in-conversation quick replies that nexus-dev should not collapse into one
  component variant without a "persistent vs. single-use" prop.

#### 5.2.3 Welcome / Home screen (A.1.3)

**Shown when:** widget opens with no active conversation, or after a conversation
is resolved (exit point from §5.2.2's close flow lands back here on next open).

**States:**
- **Default:** greeting (personalized "Welcome back, [Name]" if identity is
  known via `customerIdentifier`/`customerAuthToken`, else generic "Welcome 👋"),
  service-menu cards (grid/list, icon+label, fully tenant-configured, tapping
  pre-fills a request and enters the conversation — the agent extracts
  parameters, no client-side intent classification per the spec), a
  free-text "Ask me anything…" input, and — if a session/history exists — a
  recent-conversation preview (last message snippet + "Continue conversation"
  link).
- **Loading:** if service-menu cards or the recent-conversation preview require
  a network round-trip on open, show `Skeleton` placeholders for the card grid
  rather than a blank Home screen — this is a small, fast-loading surface, so a
  full spinner overlay would read as sluggish; skeleton cards keep the layout
  stable and communicate "content incoming."
- **Empty (no recent conversation):** simply omit the recent-conversation
  preview block — this is not an error, just an absent optional element; don't
  render a "No recent conversations" placeholder message for something the
  first-time visitor has no expectation of seeing.
- **Error (service-menu config fails to load):** fall back to just the greeting
  + free-text input (the one thing that always works, since it doesn't depend on
  tenant menu config) rather than showing a broken/empty card grid or an alarming
  error message on what should feel like a low-stakes landing screen.
- **Tapping a card or the recent-conversation "Continue" link** transitions into
  the conversation area (§5.3), where the tapped request appears as the first
  customer message bubble (cards) or the prior thread resumes at its last
  message (continue link).

#### 5.2.4 Language selection modal (A.1.4)

**Flow:** opened via the header's language toggle (§5.2.2) at any time, or
auto-triggered on first load if auto-detection wants confirmation → user picks a
language (or dismisses the auto-detect banner) → selection persists (local
storage/session) for the rest of the session → modal closes, all subsequent UI
strings and AI responses render in the chosen language.

**States:**
- **Default (explicit list):** tappable language cards (self-demonym script per
  language, e.g., "العربية" not "Arabic" written in Latin script), tenant-
  configured list/order (do not alphabetically sort a mixed-script list — that
  produces a meaningless order; use the tenant's configured explicit ordering).
- **Auto-detect banner variant:** shown *only* when auto-detection actually
  fired and is confident enough to suggest (not merely defaulting) — "We
  detected your language as [X]. Continue?" with "Continue" (accept) and
  "Choose another language" (falls through to the explicit list) actions. Per
  FR-OC-07, if detection is ambiguous/unsupported, skip this banner entirely and
  silently default to the tenant's configured default language — **never block
  interaction while asking**; the banner (when it does appear) is a dismissible
  suggestion layered over an already-usable widget, not a gate the user must
  clear before chatting.
- **This modal is a true modal dialog** (APG dialog pattern) regardless of
  desktop/mobile widget mode: focus trapped inside it while open, Escape closes
  it, focus returns to the language-toggle button in the header (not all the way
  back to the launcher) on close — see §5.5 for how this differs from the
  window's own (non-modal, desktop) open/close behavior.
- **Changing language mid-conversation** does not clear the transcript — prior
  messages remain in their original language (translating history retroactively
  is out of scope); only the UI chrome strings and subsequent AI responses
  switch. This is worth a one-line note in the modal itself if the transcript
  isn't empty ("Your existing messages won't be translated") to set expectations
  (help users recognize what will and won't change).

#### 5.2.5 Offline state (FR-OC-01 boundary case)

**Flow:** host page loses connectivity while the widget is open → input area
switches to an offline-messaging state → user keeps typing/sending, messages
queue client-side → connectivity returns → queue flushes in order.

**States:**
- **Input area (offline):** the send button remains enabled (never block the
  user from *composing*), but immediately below/above the input field a
  persistent, non-dismissible inline banner reads exactly "You're offline —
  messages will send once you're back online." (verbatim per the spec's own
  boundary-case language) — styled as an informational (not error/red) banner,
  since this is an expected, recoverable condition, not a failure.
- **Per-message queued indicator:** each customer bubble sent while offline
  renders with a distinct "Queued" visual state (e.g., a clock icon in place of
  the normal sent-tick — see §5.3.1) rather than looking identical to a
  successfully-sent message; this is the message-level counterpart to the
  input-area banner (visibility of system status at both the macro and
  per-message level).
- **Queue-full boundary (>20 queued):** per LLD §5.3/FR-OC-01, the 20th message
  is the last one silently accepted; the 21st+ triggers dropping the *oldest*
  queued message with a `console.warn` (a developer-facing signal, not a
  customer-facing one per the spec's own wording) — however, a console warning
  alone is invisible to the actual end user, which is a real UX gap: recommend
  also surfacing a one-time, dismissible inline notice in the transcript itself
  the first time a message is dropped ("Some earlier messages couldn't be saved
  and were removed — you may want to resend them.") so the customer isn't
  silently missing content they believe they sent. Flagging this as a
  spec-vs.-UX-completeness gap for nexus-dev: the spec only requires the console
  warning; the customer-facing notice above is this document's recommendation to
  close the gap, not a restatement of an existing requirement — treat it as
  should-have, not a blocking requirement, if the phase's scope needs to hold
  the line at spec-literal behavior.
- **Reconnect/flush:** the offline banner disappears the moment connectivity is
  confirmed (not merely "no longer offline" client-side heuristics, but once
  the SSE stream/POST round-trip actually succeeds again — avoid flapping the
  banner on a flaky connection), each queued message's indicator updates from
  "Queued" to normal sent-state in order as the server acks them (via the
  `clientMessageId`-keyed idempotency replay per LLD §5.3).

### 5.3 Message bubble states — the 5 types implemented this phase

All five below share two baseline behaviors: (1) every bubble type supports both
LTR and RTL layouts per §5.4; (2) new messages append to an `aria-live="polite"`
region so screen-reader users hear new AI/system content without needing to poll
the transcript manually — this applies once per appended message, not per
animation frame or per SSE delta chunk (buffer streaming token deltas and
announce on `message.complete`, not on every `message.delta`, to avoid a
screen-reader user hearing a message read out token-by-token).

#### 5.3.1 Text Message Bubble (A.2.1)

- **AI message (inline-start-aligned):** avatar icon + bubble, sanitized
  markdown-lite rendering (bold, links, line breaks only — since this is
  AI-generated same-origin content rendered as HTML-ish markup, sanitize/allowlist
  the rendered tag set rather than trusting the string verbatim; flagging this as
  an implementation note, not a new UX requirement).
  - **Typing indicator (loading):** three-dot animated indicator in place of/
    preceding the next AI bubble while a response is in flight; respects
    `prefers-reduced-motion` (static "Typing…" label fallback instead of
    animated dots); announced once via the live region ("NextBot is typing"),
    not re-announced per animation cycle, and cleared/replaced the moment the
    real message arrives.
- **Customer message (inline-end-aligned):** plain right-aligned (LTR) bubble.
  Delivery-state ticks, scoped to what's actually meaningful for a web-session
  channel (the spec's "sent/delivered/read... on channels that support it" is
  more literally true for WhatsApp-style channels than a live web session) —
  concretely for the Web Widget: **Sending** (subtle clock/spinner glyph,
  optimistic render before the server ack), **Sent** (single check, once
  `SendWidgetMessageResponse` is received), **Failed** (red exclamation glyph,
  tappable to retry — this state isn't in the screen inventory's tick list but
  is required to give the offline/queue-drop and any send-error case a visible,
  actionable per-message state; without it a failed send is indistinguishable
  from one still in flight). **Queued** (offline case, §5.2.5) is a fourth,
  distinct glyph from all three.
- **System message (centered):** gray, smaller text, non-interactive — "Conversation
  started", "Transferred to agent", timestamps. Rendered with `role="status"`
  (not `alert` — these are ambient, not urgent) so a screen-reader user still
  hears conversation milestones without them interrupting.

#### 5.3.2 Quick Reply Chips (A.2.2)

- **Default:** horizontal, scrollable row of real `<button>` chips below an AI
  message, grouped under one accessible group label (e.g., `role="group"
  aria-label="Quick reply options"`). Overflow beyond the visible width relies
  on native scroll/swipe (touch) with a partial-next-chip peeking at the edge as
  the discoverability cue, plus optional prev/next chevron affordances on
  desktop pointer hover (not required for touch).
- **Tap behavior (single-use):** tapping a chip sends it as a customer message
  (§5.3.1) and **disables the entire row**, not just the tapped chip — but
  disabled ≠ hidden or illegible: the tapped chip keeps a distinct "selected"
  visual treatment (e.g., filled/checked state) while its siblings dim to a
  muted, non-interactive state, so scrolling back through history still shows
  what was offered and what was picked (recognition over recall). Disabled
  chips are removed from the tab order but remain in the accessibility tree as
  static text, not `aria-hidden`.
- **RTL:** chip order visually mirrors (first/primary option renders at the
  inline-start, right in RTL) purely via the widget-root `dir` + logical flex
  properties per the baseline's logical-props rule — DOM order stays semantic
  (first-offered-option-first), so tab order is unaffected by the visual flip.

#### 5.3.3 Interactive List / Picker (A.2.3)

- **Default (≤8 items):** a card with a title and a scrollable list of rows
  (label + optional subtitle + optional icon + a "Select" action per row), no
  search bar.
- **Search/filter variant (>8 items, per the spec's own threshold):** a search
  input pinned to the top of the card, live-filters the list as the user types,
  with the visible result count communicated via `aria-live="polite"` ("4
  results") so screen-reader users get the same feedback sighted users get
  visually from the shortened list. Implement as an APG **combobox-with-listbox**
  pattern (arrow keys navigate filtered options, Enter selects) when search is
  present; a plain APG **listbox** pattern when it isn't.
- **Loading (list content itself is tool-call-derived, not static):** `Skeleton`
  rows inside the card rather than a spinner replacing the whole card.
- **Empty (search filters to zero matches):** "No matching options" inline in
  the card body, distinct from the list's own possible upstream empty-result
  state (that's A.2.7's concern, out of scope this phase) — this is specifically
  "your filter text matched nothing," so invite the user to adjust their search,
  not treat it as a data-availability error.
- **Selection confirmation:** tapping "Select" on a row (1) appends the chosen
  item as a customer message bubble (§5.3.1), and (2) collapses the card itself
  into a compact, non-interactive summary row ("You selected: [item label]")
  rather than leaving the full list visible and re-selectable — same single-use-
  after-choice pattern as Quick Reply Chips (§5.3.2), applied here for
  consistency (Nielsen's consistency & standards) rather than inventing a
  second post-selection treatment.

#### 5.3.4 Form Collection Card (A.2.8)

- **Default:** an inline card in the transcript with labeled fields (text,
  email, phone, dropdown/select, textarea, file upload) stacked vertically,
  required-field markers, one "Submit" button pinned at the bottom — mirrors the
  Admin Console wizard's "advance disabled until valid" pattern (§3.1) applied
  here to a single card instead of a multi-step wizard: **Submit stays disabled
  until every required field currently passes validation.**
- **Inline field validation:** validate **on blur per field** (not only at
  submit time) — an invalid field gets a red-accented border/underline plus a
  field-targeted message directly beneath it, reusing the exact re-prompt tone
  FR-AI-01 specifies for extracted-parameter validation (e.g., "That doesn't
  look like a valid email — could you share it again?") rather than a generic
  "Invalid input." **Forward-compat note (not new scope this phase):** author
  each field's label and validation message as its own discrete, translatable
  string keyed to that field — not folded into one paragraph describing the
  whole form — since FR-OC-06's later sequential-fallback renderer (one
  question per message, for non-rich channels) will need to reuse these same
  per-field strings verbatim; getting the data shape right now avoids a rewrite
  when that fallback ships. The fallback *behavior* itself is out of scope this
  phase and needs no UI here (the Web Widget is always a rich-capable channel).
- **Submit (loading):** button shows a spinner + disables; **all fields become
  read-only** for the duration (prevents edits/double-submit mid-flight) rather
  than just disabling the button alone.
- **Submit (success):** the card collapses into a compact, non-editable summary
  ("✓ Submitted" + a condensed key–value recap of what was sent) — same
  collapse-after-completion treatment as quick replies (§5.3.2) and the list
  picker (§5.3.3), not a lingering full editable form post-submit.
- **Submit (error — network/tool-call failure):** an inline `Alert` anchored at
  the top of the card itself (stays in transcript context, not a toast) using
  the tool-call-failure copy verbatim from FR-AI-05 (§5.3.5), plus a "Retry"
  action that resubmits **without clearing the user's entered values** —
  recognition over recall / error prevention (don't make the customer retype a
  multi-field form because of a transient backend failure).
- **Open question flagged for nexus-dev:** the screen inventory lists "file
  upload" as one of the Form Card's embeddable field types, but the standalone
  File Upload/Attachment Bubble (A.2.14) is explicitly deferred to a later
  phase. Recommend treating a file-upload *field inside a Form Card* as deferred
  along with it this phase (same underlying attachment-upload endpoint concern)
  unless the dev plan has already scoped attachment upload in for some other
  reason — confirm before building a form that includes this field type,
  rather than assuming it's covered by "the 5 message types this phase."

#### 5.3.5 Error / Fallback Message (A.2.15, FR-AI-05)

Three **fixed, verbatim** copy variants — never paraphrased — each rendered as
an AI-avatar bubble (§5.3.1's AI variant) but **visually distinct from a normal
AI message** via an amber/warning-tier accent (a left accent border/stripe plus
a small warning glyph with `aria-label="Warning"`, not a full red/error-tone
treatment — reserve red for the Admin Console's meaning of "failure requiring
attention"; a recoverable, conversational fallback to the end customer is
lower-stakes and should read as "a hiccup, still talking to you," not "the
system is broken"):

1. **Backend timeout:** "I'm having trouble reaching the system right now.
   Please try again in a moment, or I can connect you to an agent." — rendered
   with two Quick Reply-style chips executing the two choices the copy itself
   offers: "Try again" / "Talk to a human" (this is directly operationalizing
   the sentence's own two named options via the chip component already in scope
   this phase, §5.3.2 — not new invented scope).
2. **Goal not understood:** "I'm not sure I understand. Could you rephrase
   that, or choose from the options below?" + quick-reply chips (per FR-AI-05
   this is the one variant the spec itself explicitly pairs with chips) —
   populate the chips from context-appropriate suggestions (e.g., re-surfacing
   the Welcome screen's service-menu goals), reusing the same single-use
   Quick Reply component.
3. **Tool call failed:** "Something went wrong while processing your request.
   I've logged this — would you like to try again or speak with an agent?" —
   same "Try again"/"Talk to a human" chip treatment as variant 1.

- These are the *only* three copy strings ever shown for these failure classes
  — do not soften, lengthen, or vary the wording per-tenant or per-locale
  translation drift (the English string above is the canonical meaning every
  locale's translation must match, same principle as the Admin Console's
  exact-error-copy rule in §1.b's heuristic #9).
- No additional "error ID" or diagnostic UI is shown to the customer — FR-AI-05's
  correlatable-logging requirement is a backend/observability concern (NFR-9),
  not a widget-surface element.
- **"Talk to a human" chip dependency:** this chip's action depends on the
  human-escalation flow (ESC-* backlog items), which may not be wired end-to-end
  in this phase — flagging for nexus-dev to confirm sequencing: if escalation
  isn't live yet, the chip should either be omitted for now (safer — don't
  offer an action that goes nowhere) or wired to a clearly-labeled "not yet
  available" state, rather than silently failing when tapped.

### 5.4 RTL behavior specific to the widget

Builds directly on the baseline's logical-CSS-properties rule (§1.b) — this
section only calls out widget-specific applications of it, not a re-derivation:

- **Bubble alignment mirroring:** AI messages are inline-start-aligned (visually
  right in RTL, left in LTR), customer messages inline-end-aligned (mirrored the
  other way) — driven by `dir` at the widget-root, not per-message conditional
  logic.
- **Chip/list ordering:** per §5.3.2/§5.3.3, DOM order stays semantic
  (first-offered option first); only the visual flow direction mirrors via
  `dir` + logical flex/inline properties, so keyboard tab order is unaffected.
- **Form field direction (A.2.8):** field labels and card layout mirror fully
  (label position, required-marker position, submit-button alignment); but
  individual field *content* that is inherently Latin-script/LTR (email
  addresses, phone numbers) needs bidi isolation (`<bdi>`/`unicode-bidi:
  isolate`) wherever such a value is echoed back inside RTL surrounding text
  (e.g., a post-submit summary line combining Arabic labels with a Latin-script
  email value) — same rule as the baseline's tracking-number/tool-name
  bidi-isolation note, applied here to form values.
- **Language modal:** each language's own name renders in its own script/
  demonym (§5.2.4) — do not sort a mixed-script list alphabetically by Latin
  transliteration; use the tenant's configured explicit ordering.
- **Numerals inside AI text (A.2.1):** any generated token embedded in
  AI-authored text (a tracking number, order ID) inside an RTL response needs
  the same bidi-isolation treatment as form values above.

### 5.5 Accessibility specifics — iframe-embedded widget

Beyond the §1.b baseline (WCAG 2.2 AA, axe-core gate, keyboard operability),
these are specific to the fact this surface renders inside one iframe (§5.1):

- **Iframe element itself:** a static, descriptive `title` attribute (e.g.,
  `title="NextBot chat widget"`) set once and never changed dynamically across
  open/close/language-change (a changing iframe title mid-session is disorienting
  for screen-reader users, since some assistive tech re-announces on title
  change) — all state communication happens *inside* the iframe document via
  ARIA, not by mutating the outer iframe's attributes.
- **Landmark structure inside the iframe document:** one top-level landmark
  wrapping the whole widget (`role="complementary"` + `aria-label`, e.g., "Chat
  support"). The expanded window is either a non-modal `region` (desktop) or a
  modal `dialog` (mobile full-screen/bottom-sheet) — see focus management below
  for why these differ.
- **Focus management / keyboard trapping — resolved per widget mode (not left
  ambiguous):**
  - **Desktop widget window (floating ~400×600 panel):** treated as
    **non-modal** — the host page remains fully usable while the widget is
    open (a hard focus trap on a panel that floats *over* content rather than
    covering it would be surprising and would violate user control/freedom).
    On open, focus moves programmatically to the first interactive element
    inside the window (typically the message input, or the close/minimize
    button if there's a reason to lead with chrome), with a one-time
    visually-hidden `aria-live="polite"` announcement ("Chat window opened").
    Implement the launcher as `<button aria-expanded="false|true"
    aria-controls="nextbot-window">` toggling the window's visibility, so the
    trigger/content relationship is programmatically explicit rather than only
    visually implied.
  - **Mobile full-screen/bottom-sheet mode:** treated as a **true modal
    overlay** (matches how it visually behaves — a full takeover of the
    viewport, host page inert/non-scrollable behind it) — standard APG dialog
    pattern: focus trapped inside while open, returned to the launcher button
    on close.
  - **Escape key — resolved as: minimizes the widget back to the launcher in
    both modes**, focus returning to the launcher button. This is a deliberate,
    consistent convenience shortcut applied uniformly rather than only where
    APG strictly requires it (desktop mode is non-modal, so Escape isn't
    "required" there by the dialog pattern) — a predictable, broadly-learned
    "Escape dismisses the floating thing" convention outweighs the minor
    inconsistency of applying it beyond a strict-modal context, and nothing
    else in the widget needs Escape reserved this phase.
  - **Language Selection Modal (§5.2.4)** is always a true modal regardless of
    desktop/mobile widget mode (it's a dialog layered on top of whichever
    window mode is active) — Escape closes it specifically, returning focus to
    the header's language-toggle button, not all the way to the launcher.
- **Collapsed-state click-through (structural iframe consequence):** the
  iframe's interactive hit region while collapsed must track only the
  visually-drawn launcher button (~56–64px), never a larger invisible box — a
  full-size iframe reserved at all times with unconditional pointer-events would
  silently block host-page clicks/hover underneath it. Resolve via a
  `postMessage`-driven iframe resize (small box when collapsed, expands to the
  full window size on open) so the *entire* box model — including the collapsed
  launcher — lives inside the isolated iframe document; avoid a host-page-side
  wrapper element with manual `pointer-events` scoping, since that reintroduces
  a small "must never leak/never get overridden by host CSS" surface outside
  the iframe boundary that the resize approach avoids entirely.
- **Tab-order placement (flagged for awareness, not a defect to fix in the
  widget itself):** the iframe occupies exactly one stop in the host page's
  native tab order, at wherever the loader script inserted it in the host DOM
  (typically end of `<body>`) — a keyboard user must tab through the entire
  host page's own content before reaching the widget on a long page. This is
  outside the widget's own control (it's a host-page DOM-order concern); no
  widget-side fix changes it. Note it in integration documentation for
  tenants/developers rather than treating it as something this phase's UI work
  can resolve.
- **Contrast — light/dark host-page contexts:** the expanded window has its own
  opaque, theme-tokened background (a full Chakra surface), so message-bubble
  contrast is evaluated only against the widget's *own* theme tokens (tenant
  primary color, neutral surfaces) — it is self-contained and independent of
  whatever background color the host page happens to use, and dark mode remains
  out of MVP scope per the baseline (§1.b). The one place host-page background
  genuinely shows through is the **collapsed launcher's surrounding iframe
  canvas**, which must stay transparent (not white) so the launcher reads as a
  floating button rather than a visible rectangle. Since that transparent
  region carries no text, it has no contrast obligation of its own, but the
  launcher's drop-shadow/pulse-ring must remain visually legible against both a
  very light and a very dark arbitrary host background — don't tune the shadow
  only against a white sample page; verify it (design QA step) against both a
  pure-white and a near-black sample host background before sign-off.
- **Launcher-to-window transition, screen-reader perception:** because this is
  one continuous iframe document (not a page navigation), the transition is a
  DOM/visibility change: a screen-reader user hears the launcher `<button>`'s
  own `aria-expanded` state flip (standard disclosure-button semantics), then
  focus moves into the revealed window (per the focus-management rules above),
  which announces its own accessible name via its landmark label ("Chat
  support, dialog" or "…, region" depending on mode) — implement via the
  `aria-controls`/`hidden`-toggle pattern above, not a separate mount/unmount
  of a whole new component tree, so no live-region timing or focus-target
  element gets lost between the two states.

### Notes for `nexus-dev` (Widget section)

- Three flagged items needing an explicit decision/confirmation before or during
  implementation (not left silently resolved): (1) the offline-queue-drop
  customer-facing notice in §5.2.5 is this document's recommendation beyond the
  spec's literal console-warning requirement — treat as should-have, confirm
  scope; (2) whether a Form Card's file-upload field type is in scope this phase
  given A.2.14 is deferred (§5.3.4) — recommend deferring it too, pending
  confirmation; (3) the "Talk to a human" chip's dependency on ESC-* escalation
  wiring (§5.3.5) — confirm sequencing before wiring the chip to a dead end.
- The postMessage-driven iframe resize approach (§5.5) is this document's
  recommended mechanism for the collapsed-state click-through requirement; it's
  a firm UX requirement (collapsed hit region must track the visual button),
  the specific mechanism is a technical implementation choice nexus-dev owns,
  provided the requirement itself is met.
- Escape-key behavior (§5.5) and the non-modal-desktop/modal-mobile focus split
  are resolved decisions in this document, not open questions — implement as
  specified rather than re-deriving.

---

## 6. Feature: Agent Platform Architecture Console (B.15)

**Covers:** FR-AGT-01 through FR-AGT-10, as sliced by this phase (registry/versioning,
tenant-owned Git-hosted diff/review per ADR-0009, eval-suite promotion gate, Model
Gateway configuration, basic runtime observability). Surface: **Admin console (tenant
application)** per §1.a — this is not a new surface bucket, it's Portal B's B.15 area,
gated end-to-end by the `agent_platform` RBAC module (already a real seeded
permission-matrix key per `packages/modules/iam/src/domain/system-roles.ts` — Tenant
Admin: Write, Platform Engineer: Write, Backend System Owner: Read, other roles: None).
Reuses the RBAC hide/disable/tooltip convention from §2.3 exactly, no new pattern
needed there. Screen-inventory refs: B.15.1 (Agent Definition Registry), B.15.4 (Eval
Suite Runner), B.15.5 (Model Gateway Configuration), B.15.6 (Runtime Observability —
partial, see §6.0). Architecture refs: LLD §3.10/§3.10a/§7.1, ADR-0009. Primary
persona: **Platform Engineer** — a technical, code-comfortable audience; Tenant
Admin/Backend System Owner mostly consume this area at Read.

No Figma input supplied — this section is the full source of UX judgment for it.

### 6.0 Scope boundary within B.15 (read this first)

This phase (plan Phases 10–11) ships the console for: Agent Definition Registry &
versioning (B.15.1), Git-connect/diff/review (ADR-0009), Eval Suite Runner (B.15.4),
Model Gateway configuration (B.15.5), and a basic run list (a slice of B.15.6). It
**does not** ship:

- **B.15.2, the chat-driven Code-First Agent Builder** (natural-language authoring,
  sandboxed dry-run against an in-progress definition) — that's BL-19, Phase 4.
  **Naming collision to avoid:** the plain YAML editor this phase ships (§6.4) is easy
  to mislabel "Code-First Agent Builder" since that's the inventory's literal name for
  B.15.2 — don't. This document calls this phase's screen the **Version Editor**, a
  mode of the Agent Definition Detail screen, not a standalone nav item — reserve
  "Agent Builder" / "Code-First Agent Builder" as a name for BL-19's later chat surface
  so nav labels/breadcrumbs/copy never conflate the two.
- **B.15.3, the Deployment & Canary Manager** (traffic-split editor, promote-canary
  slider, rollback UI, rollout history) — that's BL-13, Phase 3. The backend's
  `Approved -> Production` transition *does* already atomically create a real
  `deployment` row at 100% traffic the moment it fires (LLD §3.10,
  `createInitialProductionDeployment`) — so **"Promote to Production" is a real,
  fully-working action this phase**, it just has no accompanying traffic-split/rollback
  screen to manage what happens next. §6.4 states exactly what this implies for the
  promotion control's copy. **Superseded 2026-08-31 (Phase 17, BL-48/ADR-0019 §2.7):**
  this canary/split/history/metrics surface — plus a new Shadow Evaluation capability
  never named in this original scope note at all — now ships as **§6.8**, a
  **"Deployments & Canary" tab added to the existing Definition Detail screen**, not a
  separate top-level console area (ADR-0019 §2.7 rejects a standalone "Deployment
  Manager" area explicitly). §6.4's "Promote to Production" confirm-dialog copy (its
  "later release" wording) must be updated per §6.8's Notes for nexus-dev now that this
  ships.
- **The full Trace Viewer / span waterfall** (per-tool-call spans read from
  `agent_run_span` in ClickHouse) — that's Phase 13 (BL-06), the phase that stands up
  the ClickHouse read path for the first time. §6.7 covers only the flat Postgres
  `agent_run` list this phase actually has data for; it explicitly is not a trace
  timeline and must not be presented as one.

### 6.1 Agent Definition list/detail

**Flow:**
1. Nav: "Agent Platform" (new top-level sidebar section, icon + label, inserted in the
   existing sidebar list per §1's "Agent Platform (nested: Definitions, Deployments,
   Evals, Model Gateway, Runtime Traces)" line) → default sub-tab **Definitions**.
   **Nav correction from the baseline's own placeholder wording:** per §6.0, omit
   **Deployments** from the nested sub-nav entirely this phase (hide, don't show a dead
   stub) — it ships with BL-13. The four real sub-items this phase are **Definitions,
   Evals, Model Gateway, Runtime Traces**.
2. **Definitions list:** a table — name, description (truncated + tooltip, same pattern
   as §4.1), version count, current Production version (badge, or muted "—" if none is
   in Production yet), last updated. Row click → Definition Detail.
3. "+ New Agent Definition" (Write only) → a small form modal (name, description) →
   `POST` creates the identity row with zero versions → lands directly on the new,
   empty Definition Detail (see empty state below), not back on the list.
4. **Definition Detail:** header (name, description, an inline-editable pencil for
   both), then a **Versions table**: version (semver), status badge
   (Draft/EvalGated/HumanReview/Approved/Production/Deprecated — the exact enum
   vocabulary, never paraphrased, since this technical audience will also see these
   values verbatim in API responses/logs), eval-run status for the version's last run
   (Passed/Failed/Running/Queued/Error, or a muted "Not run yet" — see the "—" vs.
   failure distinction below), Git commit SHA (short, monospace `<code>`, with a "Copy
   full SHA" icon button — never truncated with no way to get the full value), PR
   number + status badge (Open/Merged/Closed, or muted "No PR yet"), created-by,
   created-at.
5. Row actions: "Open" (Version Editor in read-only/view mode, §6.4), "Compare…"
   (opens the diff view, §6.2, defaulting the "against" side to the row's immediate
   predecessor version, or to the current Production version if one exists and differs
   — whichever is more likely to be what the engineer wants to see changed), the
   **Promote to…** control (§6.4), "Submit for Review" (§6.3/§6.4).
6. Exit: breadcrumb ("Agent Platform > Definitions > [Name] > v1.2.0") back to
   Definitions list at any point; no wizard lock-in anywhere in this feature.

**States:**
- **Loading:** `Skeleton` rows for both the Definitions list and the Versions table
  (same convention as §4.1's catalog) — never a full-page spinner replacing already-
  rendered chrome.
- **Empty — no definitions yet (fresh tenant):** empty-state illustration + "No agent
  definitions yet" + "+ New Agent Definition" CTA (Write only; Read-only users see the
  same message with no CTA, since there's nothing to disable-with-tooltip against on an
  empty state).
- **Empty — definition exists, zero versions:** "This agent definition has no versions
  yet" + "Create first version" CTA opening the Version Editor pre-filled with a
  commented scaffold template at `0.1.0`.
- **Error (list/detail fails to load):** inline `Alert` + "Retry", same convention as
  §4.1.
- **Eval-run-status "—" vs. genuine failure (generalizes the §4.1 "—"-vs-"0%" rule to
  this table):** a version whose eval suite has never been run shows a muted "Not run
  yet" — never a red "Failed" badge — since "never run" and "ran and failed" are
  operationally very different signals for an engineer deciding what to do next. A
  version that *has* run and genuinely failed shows a red "Failed" badge. Same
  distinction, generalized: don't let "no data" and "bad data" render identically.
- **Git columns when there's no tenant Git connection at all:** don't render 40 blank
  cells across every row — show one persistent inline banner at the top of the
  Versions table instead: "Connect a Git repository to enable versioning, diff, and
  review for this agent." with a "Connect Git" link to §6.3, and render the SHA/PR
  columns as a muted "—" per row underneath it (not per-row error alerts).
- **Git columns for a platform-shared definition (`tenant_id` NULL) or a legacy
  pre-Decision-2 row with no commit:** muted "—" with a tooltip "Not tracked in your
  Git repo" — distinct from the "no connection configured" banner case above (this
  case is a property of the *version*, not the tenant's connection state).

**Information architecture:** "Agent Platform" top-level nav item (new); default
landing sub-tab "Definitions." Breadcrumb: "Agent Platform > Definitions > [Agent Name]
> v1.2.0" for version-level screens.

**Accessibility beyond baseline:** status/eval/PR badges pair color + text + (where
space allows) icon, never color alone, per baseline. Git SHA's copy-icon-button needs
its own `aria-label` ("Copy commit SHA") and a brief visible/announced confirmation on
click (a transient "Copied" tooltip plus an `aria-live="polite"` announcement, since a
silent clipboard write is unverifiable for a screen-reader user). Table columns
sortable per the baseline's APG grid pattern.

**Relevant heuristics:** match between system and real world (exact status
vocabulary); recognition over recall (persistent breadcrumb + Versions table always
visible, no need to remember which version you were looking at); visibility of system
status (the connection banner surfaces *why* Git columns are empty, rather than the
admin guessing).

**Responsive:** desktop-only per baseline (§1.b), same ≥1280px / tablet-icon-rail /
sub-768px-notice treatment as the rest of the Admin Console — this is a dense
engineering surface, not a candidate for mobile optimization.

**Error/validation messaging:** reuse the backend's own DomainError copy verbatim, per
the project's established exact-error-copy convention — e.g.
`AgentDefinitionNameDuplicateError` → "An agent definition named '{name}' already
exists." exactly, not a paraphrase.

### 6.2 Version diff view

**Flow:** from Definition Detail, "Compare…" on a version row (or an explicit two-
version picker reachable from the Versions table) → `GET
/versions/:versionId/diff?against=:otherVersionId` → renders a real git-provider
compare-API diff (never a local `git diff`, per ADR-0009) as a file-list + patch view.

**Pattern:** the API returns `{ files: [{ path, patch, additions, deletions }] }` — in
practice almost always a single file (`agents/<id>/<version>.yaml`), but the viewer
must handle N files generically since a future authoring surface (BL-19) may touch
more than one:
- A per-file header/tab if `files.length > 1` (path + a compact `+N −M` badge); a
  single inline patch block with no file-selector chrome if there's exactly one file
  (the common case — don't force tab chrome on a single-file diff).
- Render the unified patch text as-is (added lines prefixed `+`, removed `-`, context
  unprefixed) with a subtle background tint per line class (green-tinted/red-tinted/
  neutral) — color is a *reinforcement* here, not the only signal, since the leading
  `+`/`-`/` ` character is already textually present in the patch itself.
- A header line: base SHA (short) → head SHA (short), each an external link (opens the
  provider's own commit page in a new tab, icon + `aria-label` "Open commit on
  GitHub"/"…on GitLab").
- "Open Pull Request" / "View Pull Request #N" sits next to the header when relevant
  (see §6.4 for exactly when this action is offered).

**States:**
- **Loading:** a skeleton block of a few gray bars mimicking diff lines, plus an
  `aria-live="polite"` "Loading diff…" announcement.
- **Error — `GIT_CONNECTION_UNAVAILABLE` (409):** a full-width `Alert`
  (status="warning") reading exactly "Git connection unavailable — reconnect in
  Settings." with a direct link into §6.3 — never render a broken/empty diff panel
  underneath it.
- **Error — provider API failure (e.g., a renamed/deleted repo, a garbage-collected
  commit, a rate-limited compare call):** surface the verbatim provider error text
  (same verbatim-transport-error philosophy already established for MCP connectors,
  §3.3) plus a "Retry" action — do not paraphrase into "Something went wrong."
- **Empty (both versions resolve to identical content):** "No differences between
  these two versions." — styled neutrally/informationally, not as an error, same
  principle as the permission-rule-builder's "no rule matched" state (§4.3c).
- **Success:** as described above.

**Accessibility for the diff view (flagged explicitly, per the same "genuinely new
composite pattern" treatment already given to the rule builder in §4.3):** a colored
diff gutter alone is not screen-reader-legible. Required, not optional:
- A **textual summary line** above the diff, generated once the diff finishes loading
  and announced via `aria-live="polite"` exactly once (e.g., "1 file changed, 12
  additions, 4 deletions") — mirrors the convention GitHub/GitLab's own UIs already
  use, giving a screen-reader user the headline without traversing every line.
- Each diff line needs a **programmatically-available change-state**, not just a
  leading character a screen reader may or may not announce distinctly at every
  verbosity setting: render the patch body as a `role="list"` of `role="listitem"`
  lines, each carrying a visually-hidden prefix ("Added: ", "Removed: ", nothing for
  unchanged context) before the visible line text, so a screen reader announces "Added:
  model_route: chat.primary" rather than bare code with no change-state context.
- The diff body is read-only but must remain keyboard-reachable/scrollable
  (`tabindex="0"` on the scrollable region if content can overflow the viewport, with a
  visible focus outline on that region) — this is a common gap for "just a read pane"
  components.
- Line-anchored permalinks are a nice-to-have, not required this phase.

**Relevant heuristics:** visibility of system status (loading/error states are
distinct and specific); help recognize/diagnose/recover from errors (verbatim provider
error text, exactly as MCP connector errors already do).

### 6.3 Git-connect flow

**Flow:**
1. Entry points: a Settings → Integrations → "Git Connection" card (this is where it
   canonically lives, since `git_connection` is one row per tenant — LLD §3.10a — not
   per agent), *and* a contextual status chip/banner surfaced inside Agent Platform >
   Definitions whenever it's not `Connected` (§6.1's banner), so an engineer working in
   B.15 doesn't have to leave the section to notice it's broken.
2. Not-connected default: two buttons side by side, "Connect GitHub" / "Connect
   GitLab," each with the provider's own logo + label. A self-hosted-GitLab base-URL
   field appears only after choosing GitLab (optional; blank = gitlab.com).
3. Click → **full-page redirect** (not a popup window) to the provider's OAuth/App-
   install flow — a deliberate choice for this admin-console flow, more robust for
   keyboard-only/screen-reader/popup-blocker edge cases than a popup; contrast with the
   widget's different popup-based OAuth pattern (§3.2), which had a different
   constraint (staying inside an in-progress wizard) that doesn't apply here.
4. Provider redirects back to a callback route → brief "Finishing connection…" loading
   screen while the exchanged token lists installable repos → **repo picker**: a
   searchable/filterable list (APG combobox pattern, per baseline) of repos the token
   can see, each row showing owner/name + a private/public icon.
5. Selecting a repo reveals a **residency disclosure** (mandatory per ADR-0009, not
   optional fine print) directly above the "Connect" confirm button: "Agent definition
   content (not customer conversation data) will be stored in this repository, which
   sits outside NextBot's regional data-residency guarantee for your tenant. Customer
   and conversation data are unaffected." — this must be visible inline, not buried in
   a collapsed tooltip or a secondary help link.
6. "Connect" → `POST /connection` → the card flips to **Connected** (green, repo
   owner/name shown, "Disconnect" + "Change repository" secondary actions).
7. Exit: "Disconnect" is a **confirmable action** (error prevention/user control &
   freedom, consistent with the baseline's destructive-action pattern) — the confirm
   dialog states the concrete consequence: "Existing deployed agent versions keep
   running normally. New versions, diffs, and pull requests can't be created until you
   reconnect." — not a generic "Are you sure?"

**States:**
- **Default (not connected):** as above.
- **Loading (mid-OAuth round trip):** "Finishing connection…" spinner screen.
- **Repo picker:** combobox-with-listbox pattern (arrow keys navigate, Enter selects,
  `aria-live="polite"` result count as the search narrows), per the same pattern
  already specified for the Interactive List Picker (§5.3.3) and the Discover Tools
  step (§3.3) — reuse, don't reinvent.
- **Error — user cancels/denies the OAuth prompt:** a neutral (not alarming) message,
  "Connection cancelled — you can try again anytime," returning to the not-connected
  default with no error banner — this is a normal user choice, not a failure.
- **Error — token exchange or provider API failure:** verbatim provider error detail +
  "Retry," same convention as §6.2.
- **Persistent connection-status badge** (shown on the Settings card, the §6.1
  contextual banner, and the Version Editor header, §6.4) — three states, always
  color+text, never color alone:
  - **Connected** (green) — health-checked before every write/diff/PR call per
    ADR-0009; no user-visible polling needed beyond that.
  - **Unreachable** (amber) — auth revoked, repo renamed, or a provider outage was
    detected by that same pre-call health check; shows an inline "Reconnect" action.
  - **Disconnected** (neutral gray) — the tenant explicitly disconnected; shows a
    "Connect" action.
- **`GIT_CONNECTION_UNAVAILABLE` graceful-failure surfacing, anywhere a Git-dependent
  action is attempted while not Connected** (new version creation, diff, "Submit for
  Review"): block with an inline `Alert` reading exactly "Git connection unavailable —
  reconnect in Settings." plus a direct link — never a silent failure, never a
  spinner-forever. Critically, **surface this proactively, before the user starts
  writing**, not only at the point of a late save/submit failure — see §6.4's specific
  recommendation on this (in-progress YAML work is real, unsaved effort; losing it to a
  Git outage discovered only at save time is a genuine, avoidable UX failure this
  document flags explicitly).

**Information architecture:** lives under Settings → Integrations, with a contextual
status surfaced inside Agent Platform screens (§6.1); this reconciles with the
existing "Settings" sidebar item already named in the baseline's shared nav (§1).

**Accessibility:** repo-picker combobox per APG, per baseline; both provider buttons
and the residency-disclosure text must remain in normal document/tab order (not
revealed only on hover).

**Relevant heuristics:** error prevention (residency disclosure shown before
connecting; disconnect confirmed with its concrete consequence stated); visibility of
system status (persistent, always-visible connection badge); match between system and
real world (GitHub/GitLab's own vocabulary — "repository," "organization" — used as-is).

### 6.4 Version Editor (YAML authoring, validation, submit-for-review, promotion)

**A structural fact this flow must be designed around, verified against the actual
service code (`agent-definition-service.ts`):** there is **no "save draft without a Git
commit"** step. `createAgentDefinitionVersion` commits the artifact to the tenant's Git
repo *first*, synchronously, as part of creating the `Draft` row — every successful
"Create Version" click is a real commit, not a client-side-only save. Two direct UX
consequences:

1. **If the Git connection is unreachable, version creation is blocked outright** — an
   engineer cannot even get to `Draft` without a healthy connection. The editor must
   surface Git connection health *before* the user invests time writing YAML (a
   persistent status chip in the editor's header, matching §6.3's badge), not only
   discover it's broken when they click "Create Version" after finishing a long edit.
   **Recommendation for nexus-dev (should-have, not spec-mandated):** persist the
   in-progress YAML text to `localStorage`/session-scoped client storage as the user
   types, independent of the server round-trip, so a failed create attempt (Git
   outage, validation error, accidental navigation) never loses the engineer's actual
   work. This is this document's own recommendation to close a real gap, not a
   restatement of an existing requirement.
2. **Versions are immutable once created — there is no "edit this Draft in place."**
   To change content, the engineer creates a *new* version (bump the semver) using the
   same editor. The editor's mental model is "author the next version," not "edit the
   current one" — word every affordance ("Create Version 0.1.1", not "Save") to match,
   and don't imply an existing Draft row can be silently overwritten.

**Flow:**
1. From Definition Detail, "+ New Version" (or "Create next version" on an existing
   row) opens a **full-page** editor (not a modal — code content needs width, same
   reasoning as the wizard-shell choice in §3.1).
2. Fields above the editor: Version (semver text input, pattern-validated
   `^\d+\.\d+\.\d+$`, pre-suggested as the next patch/minor bump from the latest
   existing version), Graph Type (`Select`, default `ADK`; `LangGraph`/`PydanticAI` are
   schema-valid but **not installed** in this deployment — show them in the list with a
   trailing "(not installed — can't reach Production)" note rather than hiding them,
   since they're valid values the schema accepts even though promotion to Production
   will reject them per `GRAPH_TYPE_NOT_INSTALLED`), Model Route Key (a `Select`
   sourced from the tenant's existing Model Gateway routes, §6.6 — not free text, so an
   engineer can't typo a route key the runtime will never resolve).
3. The main editor: a plain code editor/textarea (per this phase's explicit scope —
   not a visual builder) for the artifact's `spec` body (`instructions`, `toolPolicy`,
   `guardrails`, `memory`, `budgets`, plus an informational `evalSuite` string field —
   see the eval-suite-binding note below), pre-filled with a commented scaffold
   template for a brand-new version or the prior version's full content as a starting
   point when authoring a follow-up version.
4. **Inline TypeBox-validation-error surfacing** (explicitly required): on submit
   attempt (and, ideally, debounced live validation as the user types, since the schema
   check is pure/synchronous and cheap), parse the YAML and check it against
   `AgentDefinitionArtifactSchema` with `Value.Check`/`Value.Errors`. Render each error
   as a structured list beside/beneath the editor — e.g. "`spec.toolPolicy.
  maxToolCallsPerTurn`: must be ≥ 1" — using the schema's own path + message, not a
   generic "Invalid YAML" banner. Each entry should best-effort jump/scroll the editor
   to the matching key when clicked; note for nexus-dev that TypeBox errors carry a
   JSON-pointer-style path, not a line number, so exact line-jump precision depends on
   how the implementation maps a path back to editor position — don't over-promise
   pixel-perfect jump-to-line in this spec, a "scroll to roughly the right section" is
   an acceptable fallback.
5. **Eval suite binding is a separate, explicit control from the YAML's own
   `spec.evalSuite` field** — flagging this distinction plainly since it's easy to
   conflate: the promotion gate (`EvalGated -> HumanReview`) checks the version row's
   `eval_suite_id` column, which is set by a dedicated "Bind Eval Suite" action
   (`Select` of existing suites, §6.5) on this screen — *not* derived automatically
   from whatever string the engineer typed into the YAML's `spec.evalSuite` field. Show
   both, clearly labeled: the YAML field as descriptive/documentation content within
   the artifact itself, and a distinct "Eval Suite: [Select ▾]" control above/beside
   the editor as the actual binding the gate enforces — with a one-line note ("This is
   what actually gates promotion — the YAML's own `evalSuite` value is descriptive
   only.") so the two aren't assumed to be the same mechanism.
6. **"Create Version"** → validates client-side, submits → on `GIT_CONNECTION_
   UNAVAILABLE`, surfaces the blocking alert (§6.3) without losing the editor's content
   (this is exactly the case the localStorage recommendation above exists for) → on
   success, lands on the new version's detail/view (read-only) with its fresh Git
   commit SHA shown.
7. **"Submit for Review"** (a separate action from "Create Version," available once a
   version has a commit): opens a real PR/MR against the tenant's repo
   (`submitVersionForReview`) and records `git_pr_number`/`git_pr_status: Open`.
   **Recommendation, flagged as an open item below:** wire this button to *also*
   trigger an eval run (`triggeredBy: "VersionSubmitted"`) at the same time, since
   FR-AGT-06 specifies suites "run automatically on every new version submitted for
   review" but the backend only exposes eval execution as an explicitly-triggered
   endpoint (`triggeredBy` defaults to `"Manual"` if the caller doesn't pass it) — see
   the open questions at the end of this section.
8. **The "Promote to…" control** — resolved interaction design (not left ambiguous),
   since the brief's two requirements ("hides, never disables, unavailable
   transitions" + "surfaces *why* a transition is blocked on hover/ask") are in
   tension if read as one single UI element (a hidden menu item can't be hovered):
   - The **Promote menu itself** is a simple button/menu listing only the targets in
     the API's `_allowedTransitions` array for the current version — genuinely absent
     entries for anything not currently allowed, not a disabled menu item. Typically
     1–2 items (the single forward step, plus `Deprecated` where applicable, since it's
     reachable from any non-terminal status).
   - **Separately**, a persistent "Why can't I promote this further?" (?) affordance
     sits beside the status badge whenever the version isn't yet `Production` or
     `Deprecated` — this is *not* inside the promote menu (so it's reachable
     regardless of what's hidden). On hover/focus/click it shows the blocking reason
     for the version's *next* pipeline step, reusing the domain's own reason strings
     **verbatim** (never paraphrased, per this project's established exact-error-copy
     convention) — e.g. "No eval run has been submitted for this version yet.", "The
     bound eval suite has not passed (last run status: 'Failed').", "The reviewer
     approving this version must be different from the person who created it.", "This
     version still has active traffic — reduce its traffic split to 0% before
     deprecating it.", "Graph type 'LangGraph' is not installed in this deployment."
   - **New, small API surface this affordance needs and doesn't yet have — flagged for
     nexus-dev, not silently assumed:** the domain's `canPromote()` function already
     computes exactly this reason for any candidate target status (it backs
     `_allowedTransitions` today), but there's currently no read-only endpoint exposing
     the *reason* for a target that isn't allowed. Recommend a small addition, e.g.
     `GET /versions/:id/promotion-check?target=X` returning `{ allowed, reason }` by
     calling the same pure `canPromote()` the console already trusts — cheap to add
     since the logic already exists and is already unit-tested per-branch.
   - **Creator-vs-reviewer asymmetry, worth designing around explicitly:**
     `_allowedTransitions` is computed per *viewer* (`HumanReview -> Approved` requires
     `actingUserId !== createdByUserId`), so the version's own creator genuinely won't
     see "Approve" in their menu while a colleague will. The (?) affordance above is
     exactly what explains this to the creator if they notice the asymmetry (e.g., by
     comparing notes with a colleague) — this is intended behavior stemming from a real
     reviewer-independence requirement, not a bug, and the reason text above states it
     plainly.
   - **"Promote to Production" copy, given §6.0's scope boundary:** since this action
     silently creates a live, 100%-traffic `deployment` row with no traffic-split UI to
     manage afterward this phase, the confirm step for this specific transition must
     say so explicitly — e.g. "This immediately deploys v1.2.0 to 100% of Production
     traffic. Traffic-split and rollback controls will be available on the Deployment &
     Canary Manager screen in a later release — for now, promoting a new version here
     replaces the prior one's traffic outright." This is a confirmation dialog, not a
     silent action, satisfying error prevention/user control-freedom for what is
     otherwise a one-click full production cutover with no safety net yet.

**States:** default (scaffold-filled editor), loading (submit in flight — editor
becomes read-only, submit button spinner+disabled), validation-error (inline structured
list, editor stays editable, nothing is discarded), Git-unavailable (blocking alert,
content preserved), success (lands on the new version's read view), promote-loading
(button spinner+disabled during the promotion call), promote-error (surfaces
`PromotionNotAllowedError.reason` verbatim inline — this should be rare given the
menu already only shows allowed targets, but a race is possible if state changed
between page-load and click, e.g. someone else just changed traffic split).

**Accessibility beyond baseline:** the plain code editor/textarea must remain fully
keyboard-operable (standard textarea behavior, or if a lightweight code-editor library
is used instead of a bare `<textarea>`, verify it doesn't trap Tab focus inside itself
— a common gap with embedded code editors that capture Tab for indentation; provide an
documented escape mechanism, e.g. Esc-then-Tab or a visible "exit editor focus" hint,
consistent with the baseline's no-keyboard-traps rule). Inline validation errors are
associated with the editor via `aria-describedby`/a live region announcing the error
count once per validation pass (not per keystroke). The (?) promotion-reason affordance
is a real, focusable button with `aria-describedby` pointing at its own reason text
(reachable by keyboard/screen reader, not hover-only), per the same convention already
established for the RBAC read-only-tooltip pattern (§2.3).

**Relevant heuristics:** error prevention (Production-promotion confirm states its
concrete, current-phase-specific consequence); user control & freedom (in-progress
content is never silently lost to a late Git failure — hence the localStorage
recommendation); recognition over recall (the always-visible (?) reason affordance,
rather than requiring the engineer to guess or search docs for why a transition is
missing); help recognize/diagnose/recover from errors (verbatim TypeBox/domain error
copy throughout).

### 6.5 Eval Suite Runner

**Information architecture:** Eval Suites are a reusable, shared library — CRUD lives
under the **Evals** nav sub-item (list of suites: name, description, case count, pass
threshold). *Running* a suite is always against a specific bound version, so "Run Eval
Suite" and its results live on the **Version Editor's / version detail's Eval tab**
(showing the currently-bound suite + a "Run Eval Suite" button + run history), not on
the standalone Evals list.

**Flow:**
1. Suite list (Evals nav) → "+ New Eval Suite" (name, description, cost/latency
   budget, pass threshold % — default 100) → Suite Detail.
2. Suite Detail: **case list** (name, input-transcript preview, has-expected-tool-calls
   indicator, expected-response-pattern preview) + "+ Add Case."
3. **Add-case form:** name; an **input transcript builder** — an ordered, appendable
   list of `{sender, text}` rows (sender: `Select` customer/AI; text: `Textarea`; "+ Add
   turn" appends a row, a remove-icon-button per row); an **expected-response-pattern**
   field — a single text input with helper text stating precisely what it does:
   "Matched as a case-insensitive regular expression against the agent's final response
   text." (this document deliberately does **not** call it "semantic," even though the
   LLD's data-model description says "regex or semantic assertion," because this
   phase's actual evaluator (`eval-service.ts`) only implements the regex match — flag
   this as an honest-scope note for nexus-dev's copy, not an invented restriction: don't
   let the UI imply semantic matching exists yet); an **expected tool calls** field
   (optional, an appendable list of `{toolName, argMatchers}` rows) — kept available in
   the form for forward-compatibility (the schema already accepts it and a suite should
   be authorable ahead of Phase 12), but with a **persistent, non-dismissible inline
   notice directly under this part of the form**: "Tool-call assertions can't be
   evaluated until a later phase — cases with these will always show as
   'not yet supported,' not pass or fail on their actual behavior." (see the honest
   treatment below — this notice at authoring time is what makes the eventual result
   unsurprising).
4. **"Run Eval Suite"** (from a version's Eval tab, bound suite required first — if
   none is bound, this button is replaced by "Bind Eval Suite" per §6.4) → submits →
   poll/refresh for completion (no SSE in this phase's scope) → results render below.

**Per-case pass/fail results table:** case name, status badge, actual response
(truncated + "expand" for the full text), failure reason (verbatim from the backend),
cost, latency.

**The honest "not yet supported" treatment for tool-call-expectation cases (explicitly
required, and verified against the exact backend copy in `eval-service.ts`):** a case
whose `expectedToolCalls` is non-empty is recorded as `passed: false` with
`failureReason: "Tool-call expectations cannot be evaluated until Phase 12 wires real
tool dispatch through the turn pipeline."` — **render this distinctly from a genuine
content-mismatch failure**, not as an identical red "Failed" row:
- A **neutral/gray "Not yet supported" badge** (not red "Failed"), with the exact
  reason string shown inline (verbatim, per the exact-error-copy convention) rather
  than implying something is broken.
- A one-line clarifying note directly beneath it: "This case type isn't evaluated
  yet — it's counted against the pass rate for safety (fail-closed), not because your
  agent's behavior was checked and found wrong." — this is the sentence that keeps a
  fail-closed design decision from reading as a product defect to the engineer looking
  at it, satisfying this document's own "must not make that look like a bug"
  instruction.
- **A real, non-obvious gotcha worth flagging inline in the same place:** because
  `pass_rate_pct` is computed as `passedCount / cases.length` and these cases always
  count as failed, **a suite containing any tool-call-expectation case can never reach
  a 100% pass rate this phase** — if the suite's `pass_threshold_pct` is 100 (the
  default), such a suite can never gate a version past `EvalGated`. Recommend the Suite
  Detail screen surface a proactive warning when a suite contains ≥1 tool-call-
  expectation case: "N of M cases in this suite assert tool calls, which can't pass
  until a later phase ships — this suite can't reach 100% until then. Consider a lower
  threshold or a separate suite without these cases for now." This is a should-have
  recommendation from this document, not a hard requirement, but a genuinely useful one
  given how easy it would be for an engineer to be stuck wondering why their suite
  never passes.

**States:**
- **Suite-level:** Queued/Running (badge + spinner on the "Run Eval Suite" button;
  disable re-triggering while one run is already in flight for this version), Passed/
  Failed (green/red badge, pass-rate % shown), **Error** (the *whole run* failed to
  complete — an infrastructure failure, distinct from any individual case's pass/fail
  — render as its own alert-level state, "Eval run failed to complete," never folded
  into the per-case results table as if it were just another case).
- **Empty — suite has zero cases:** "No test cases yet — add one to start gating
  promotions." **Also flagged: a suite with zero cases is computed as passing at 100%
  by the backend** (`cases.length > 0 ? … : 100`), which means **binding an empty suite
  trivially satisfies the promotion gate with zero real verification.** Recommend the
  version's Eval tab show a prominent warning whenever the currently-bound suite has
  zero cases: "This eval suite has no test cases — it will automatically pass with no
  real verification. Add at least one test case before relying on this gate." This is a
  genuine safety-relevant UX gap this document is flagging, not a cosmetic nicety.
- **No suite bound yet (on the version's Eval tab):** "No eval suite is bound to this
  version yet — bind one to enable promotion past Draft." + "Bind Eval Suite" CTA.

**Accessibility:** the input-transcript builder's appendable row list needs the same
accessible-reorder/add/remove treatment as other appendable-row patterns already
established in this document (§4.3's rule builder) — explicit "Remove turn" icon
buttons with `aria-label`s including the row's ordinal ("Remove turn 2"), not bare ×
glyphs.

**Relevant heuristics:** help recognize/diagnose/recover from errors (the "not yet
supported" distinction is precisely this heuristic — the interface must help the
engineer correctly diagnose *why* a case failed, not just that it did); error
prevention (the empty-suite and 100%-threshold warnings above pre-empt a confusing,
hard-to-debug promotion deadlock).

### 6.6 Model Gateway configuration

**Flow:**
1. **Tenant model routes list** (Model Gateway nav sub-item): route key, provider chain
   summary (e.g. "openai:gpt-4o → anthropic:claude-3-5-sonnet"), strategy, cache mode,
   total timeout. Row click → route editor.
2. **Route editor:**
   - **Route Key**: a `Select` constrained to the six meaningful logical names the
     runtime actually resolves (`chat.primary`, `chat.fast`, `reasoning.planner`,
     `classify.guardrail`, `summarize.escalation`, `embed.knowledge`, per LLD §7.1) —
     **not free text**, even though the underlying schema technically allows any
     string. An arbitrary custom route key would simply never be looked up by any
     runtime code path this phase, which would silently confuse an engineer who
     configured one expecting it to take effect. **Flagged as an open question below**
     if a future phase intends tenant/agent-specific custom route keys beyond these
     six — confirm before assuming free text is ever appropriate here.
   - **Provider chain editor** — an **ordered, appendable list** of chain-entry rows.
     Reuse the exact accessible-reorder pattern already specified for the permission
     rule builder (§4.3: drag-handle *plus* explicit up/down icon-button keyboard
     alternative — not drag-only) rather than inventing a second ordered-list pattern
     in the same product.
   - **Each chain-entry row** is a small form with a **binary mode toggle** stated
     explicitly (this reconciles two different underlying semantics the API silently
     distinguishes by field presence, per `model-gateway-service.ts`'s
     `isTenantOwnEndpoint` check — the UI should make the distinction an explicit
     choice, not an implicit side-effect of which optional fields happen to be
     filled in):
     - **"Use a platform-registered provider"** → `providerKey` `Select` sourced from
       the read-mostly provider registry below, `model` free text (e.g. `gpt-4o`),
       optional `maxTokens`/`timeoutMs`. Inline note: "Subject to your tenant's
       data-residency region unless out-of-region inference is enabled in Settings."
     - **"Use my own endpoint"** → `baseUrl` (required in this mode), `model` free
       text, a credential picker for the API key reusing the exact masked-credential-
       vault pattern already specified for connector credentials (§3.2 — masked-only
       display, "Rotate"/"Replace," never a reveal action), optional
       `maxTokens`/`timeoutMs`. Inline note: "Requests to your own endpoint aren't
       subject to the platform's regional provider filtering."
   - **Cache mode**: `Select` (Off/Exact Match/Semantic). **Semantic threshold** field
     appears only when Semantic is selected (0–1, default 0.95) — standard
     conditional-field-reveal pattern, not shown/disabled when irrelevant.
   - **Total timeout** (ms, default 30000, min 1000/max 120000 per schema) — numeric
     input with inline range validation.
   - **Validation:** the chain must have ≥1 entry — block save with an inline message
     ("Add at least one provider to this route's chain") if empty, same pattern as the
     rule builder's incomplete-condition block (§4.3).
3. **Model Provider registry** (a separate, simpler read-mostly list on the same nav
   sub-item, below or beside the routes table): key, label, base URL (shown, not
   masked — this is an endpoint, not a secret), regions, enabled status. **No
   add/edit/delete controls are exposed to a tenant admin at all here** — not
   disabled-with-tooltip, genuinely absent — since `model_provider` is explicitly
   platform-level data (LLD §3.10: "platform-level, not tenant-scoped"), consistent
   with this project's baseline classification of a cross-tenant operator console as
   out of MVP scope (§1.a). **Flagged as an open question below**: the backend already
   ships a working `registerModelProvider` service function with no UI caller anywhere
   in this phase's scope — confirm whether that's intentionally seed-script/migration-
   only for MVP, or whether some UI (even a lightly-gated one) is expected to reach it.

**States:** loading/empty ("No model routes configured yet — the platform default
route will be used" — since LLD §7.1 states resolution falls through to an env default
when no tenant row exists, this is a legitimate, non-broken empty state, not an error)/
error (inline alert + retry, same convention throughout)/save-validation (chain-empty
block above)/success.

**Accessibility:** conditional-reveal fields (semantic threshold, own-endpoint fields)
must be properly associated/announced when they appear (`aria-live="polite"` region or
focus-management on reveal, not a silent DOM insertion a screen-reader user might miss).

**Relevant heuristics:** consistency & standards (reusing the §4.3 ordered-list pattern
and the §3.2 masked-credential pattern rather than inventing new ones for this
screen); recognition over recall (explicit mode toggle rather than an implicit
field-presence inference the engineer has to reverse-engineer).

### 6.7 Runtime Observability — basic run list (not a trace viewer)

**Explicitly scoped down, per §6.0:** this is a flat list of `agent_run` rows for a
given agent definition/version — status, trigger, duration, cost, timestamp. It is
**not** a trace timeline/span waterfall (that's Phase 13's job once the ClickHouse read
path exists) — do not design or imply a per-tool-call breakdown here.

**A real, verified gap this document is flagging rather than silently designing
around:** `startAgentRun`/`completeAgentRun` (the `agent_run` write path,
`agent-run-service.ts`) exist, are unit/integration-tested, and are exported — **but
nothing in this phase's code actually calls them yet.** `eval-service.ts`'s
`runEvalSuite` invokes the `GraphRuntime` directly per case without creating an
`agent_run` row at all, and there is (correctly, since it's Phase 12's job) no turn
pipeline yet to call it from a real conversation. **This means the run list this
screen renders will likely be genuinely empty in practice for the whole of this
phase**, unless nexus-dev additionally wires eval executions through
`startAgentRun`/`completeAgentRun` (the `RunTrigger` enum already has an `EvalCase`
value seemingly for exactly this). **Flagged as an open question below** — recommend
wiring it (the mechanism, span, and enum value already exist for exactly this purpose,
so it reads like an oversight rather than a deliberate scope cut, but confirm rather
than assume), and in the meantime, design a genuinely good **empty state** for this
screen rather than treating "no rows" as a loading/error state: "No agent runs
recorded yet. Runs will appear here once eval executions and live conversations are
wired through this observability path." — honest about *why* it's empty, not a bare
empty table.

**Flow:** Runtime Traces nav sub-item → pick an agent definition/version (`Select` or
inherited from wherever the user navigated from) → filterable list: trigger
(`CustomerMessage`/`A2ATask`/`HumanAgentAction`/`EvalCase`/`SandboxTest`/
`ResumeAfterHitl`), status (`Running`/`Succeeded`/`Failed`/`PausedForApproval`/
`Cancelled`/`TimedOut`), date range.

**Columns:** status (badge, color+text per baseline), trigger (badge/text), started
at, duration (humanized, e.g. "1.2s"), cost (`$0.0031`, or muted "—" for a run still
`Running` with no final cost yet — same "—"-vs-real-value distinction pattern as
§4.1), a copyable `otel_trace_id` (monospace, copy-icon-button — forward-compat for
Phase 13's fuller trace viewer, which will look this ID up in ClickHouse).

**Deliberately not built this phase:** a "Resume" action on `PausedForApproval` rows.
Although FR-AGT-09 names this, nothing in this phase's orchestration can actually
produce a `PausedForApproval` run (that's Phase 14/BL-08's Tier-2/3 approval engine) —
building a "Resume" button now would be a dead, no-op action. Defer it to Phase 15
(Approval Queue UI), the phase that actually has something for it to do; this basic
list should render `PausedForApproval` as just another status badge this phase, with
no action attached.

**What a fuller Trace Viewer will need later (flagged, not designed now, per the
task's own instruction):** a per-run drill-down showing a span waterfall (one row per
`GraphNode`/`ModelCall`/`ToolCall`/`Guardrail`/`Retrieval`/`Hitl` span, nested by
`parent_span_id`, with per-span duration/status/attributes) reading from
`agent_run_span` in ClickHouse (LLD §3.10's schema already names this) — Phase 13
stands up that read path for the first time; this phase's list should link out to
"View full trace" only once that screen exists (a dead link otherwise, so omit the
link entirely until Phase 13, rather than adding it now and pointing nowhere).

**States:** loading (skeleton rows), the honest empty state above, error (inline alert
+ retry), filtered-to-zero (distinct, lighter-weight message: "No runs match these
filters" + a "Clear filters" action — not the same copy as the genuinely-no-data empty
state, same principle as the Interactive List Picker's search-empty vs. upstream-empty
distinction, §5.3.3).

**Accessibility:** filter controls and the table itself follow the same conventions as
every other admin list in this document (§4.1) — no new pattern needed here.

**Relevant heuristics:** honesty about system state (the empty-state copy explaining
*why* there's nothing to show) is this screen's main heuristic concern — visibility of
system status applied to "there is currently nothing to be visible," which is just as
important to get right as a populated state.

### Notes for `nexus-dev` (Agent Platform Architecture Console)

**Open questions flagged for explicit resolution — not silently decided, since each has
real product/behavior implications:**

1. **Auto-triggering the eval run on submission (§6.4/§6.5).** FR-AGT-06 says suites
   "run automatically on every new version submitted for review," but the backend's
   `runEvalSuite`/`handleRunEvalSuite` only expose an explicitly-triggered endpoint
   (`triggeredBy` defaults to `"Manual"`). Recommend the console's "Submit for Review"
   action also calls `runEvalSuite` with `triggeredBy: "VersionSubmitted"` immediately
   after opening the PR, achieving the spec's "automatic" language via frontend
   orchestration — confirm this is the intended division of responsibility (frontend
   orchestrates two backend calls) rather than expecting a backend change.
2. **A new read-only "why is this transition blocked" endpoint (§6.4).** The (?)
   promotion-reason affordance needs a way to fetch `canPromote()`'s reason for a
   target status that isn't currently allowed, which no existing endpoint exposes
   today. Recommend a small `GET /versions/:id/promotion-check?target=X` addition
   reusing the already-tested pure domain function — flagging as new, small backend
   scope this UI genuinely needs, not something the frontend can fake convincingly on
   its own (the reasons depend on server-side eval-run/traffic state).
3. **Empty-eval-suite and 100%-tool-call-case-suite promotion deadlocks (§6.5).** Two
   real gotchas verified directly in `eval-service.ts`: a suite with zero cases
   auto-passes at 100%, and a suite containing any tool-call-expectation case can never
   reach 100% (fails closed permanently, by design, until Phase 12). Recommend the
   should-have inline warnings specified in §6.5; confirm whether product wants these
   as hard warnings, soft hints, or accepted as-is for this phase.
4. **`registerModelProvider`/`listModelProviders` has no UI caller this phase (§6.6).**
   Confirm whether the platform-level model-provider registry is genuinely
   seed-script/migration-only for MVP (this document's working assumption, consistent
   with the baseline's deferred-platform-console classification, §1.a) or whether some
   UI — even a narrowly-gated one — is expected to reach it this phase.
5. **`agent_run` write path has no caller yet (§6.7).** `startAgentRun`/
   `completeAgentRun` exist and are tested but aren't invoked by `eval-service.ts` or
   anywhere else in this phase's code, so the Runtime Observability screen will likely
   render its honest-empty-state for the whole of this phase in practice. Recommend
   wiring eval-case executions through this path (trigger: `EvalCase`) so the screen
   has real, inspectable data sooner rather than staying empty until Phase 12 — confirm
   this is in scope for this dispatch rather than deferred.
6. **Route-key free text vs. a constrained six-value `Select` (§6.6).** This document
   recommends constraining `route_key` to the six logical names the runtime actually
   resolves. Confirm whether a later phase intends tenant/agent-specific custom route
   keys beyond those six, in which case a combobox-with-free-entry (known values +
   custom) would be the better long-term pattern instead of a closed `Select`.
7. **Whether a confirm-with-consequence dialog is warranted before "Promote to
   Production" (§6.4).** This document resolves this explicitly as **yes** — a
   dedicated confirm step stating the concrete, current-phase-specific consequence
   (immediate 100%-traffic cutover, no traffic-split/rollback UI to manage it yet) —
   rather than leaving Production promotion as a single undifferentiated menu click
   identical to every other, much lower-stakes transition.

**Resolved decisions, not open questions — implement as specified rather than
re-deriving:** the naming split between this phase's plain "Version Editor" and
BL-19's future "Code-First Agent Builder" (§6.0); full-page redirect (not popup) for
Git OAuth (§6.3); the "Promote menu hides / separate (?) affordance explains" split
for the promotion control (§6.4); the neutral "not yet supported" (not red "Failed")
treatment for tool-call-expectation eval cases (§6.5); omitting "Deployments" from the
nested Agent Platform nav this phase (§6.1) **— superseded 2026-08-31: Phase 17
(BL-48/ADR-0019 §2.7) ships the canary/rollout surface as a tab on Definition Detail,
not a nav item; the nested sub-nav still has no "Deployments" entry and now never will,
since ADR-0019 rejected that placement outright — see §6.8**; omitting a "Resume"
action from the basic run list this phase (§6.7).

---

### 6.8 Deployments & Canary tab (+ Shadow Evaluation card) — Phase 17, BL-48/ADR-0019

**Covers:** FR-AGT-04/05 (traffic split, promote canary), FR-AGT-09/10 (per-version
metrics), FR-AGT-30/ADR-0017 (emergency rollback — already shipped; this section only
gives its history rows a place to render). Surface: **Admin console (tenant
application)** per §1.a — same B.15 Agent Platform area as the rest of §6, same
`agent_platform` RBAC module (Write required for every mutating control below; Read
sees everything else read-only, per §2.3's hide/disable/tooltip convention — see
Accessibility below for exactly which). Governing document: **ADR-0019** + **LLD §15**
(read both before implementing; this section is their UI-judgment layer, not a
restatement). No Figma input was supplied — this section is the full source of UX
judgment for it.

**Placement, stated once and load-bearing:** per §6.0's superseding note and ADR-0019
§2.7, this is **one new tab, "Deployments & Canary," on the existing Definition Detail
screen** (`.../agent-platform/definitions/[id]/DefinitionDetail.tsx`) — *not* a new
top-level "Deployment Manager" console area, and *not* a new nested Agent Platform
sub-nav item (§6.1's nested sub-nav stays exactly Definitions/Evals/Model
Gateway/Runtime Traces, permanently, not just "for now"). Definition Detail today has
no `Tabs` at all — its whole body is the Versions table. This phase must wrap it in the
same `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` primitive and `?tab=` query-param
deep-link convention `VersionDetail.tsx` already established (§6.4's sibling screen) —
reuse that pattern verbatim, don't invent a second tabs convention in the same feature
area. Two tabs: **"Versions"** (today's entire existing screen content, unchanged) and
**"Deployments & Canary"** (new, this section). Breadcrumb is unaffected ("Agent
Platform > Definitions > [Name]") — the tab is in-page state, not a navigation level.

**Environment context, fixed this phase:** per ADR-0019 §2.7 ("Staging/Sandbox rollout
workflows beyond keeping `environment` a parameter" are out of scope — only Production
has a live resolver consumer), this tab operates against a **fixed "Production"
context**, shown as a plain read-only label/badge at the top of the tab, not a
picker — do not build an environment switcher with nowhere real for Staging/Sandbox to
go, same "omit a dead control" precedent §6.7 already applies to the Trace-Viewer link.
A one-line caption under the label: "Only Production has a live traffic resolver this
phase — Staging and Sandbox allocations aren't yet wired to any live turn."

---

#### Surface 1 — Allocations, split editor, per-version metrics, rollout history

**Flow:**
1. Open the "Deployments & Canary" tab → `GET .../deployments?environment=Production`
   loads current allocations + metrics in one call; `GET .../deployments/history`
   loads the timeline (separate, paginated call, per LLD §15.7's `cursor` param).
2. **One unified table**, row per currently-active allocation — split-editing and its
   consequence (the metrics) sit in the same row deliberately, so an admin sees the
   effect of their last change beside the control that made it (recognition over
   recall): **Version** (semver + status badge, always `Production` here since §6.4's
   promotion gate already guarantees it — ADR-0019 §2.4), **Traffic %** (editable
   numeric input, see the split editor below), **Runs**, **Error rate**, **p50**,
   **p95**, **Cost**, **Row actions** (Remove from split / Promote to 100%).
3. **"+ Add version to split"** (Write only) opens a version picker (see the resolved
   eligibility design below) → appends a new row.
4. **"Save split"** (Write only) → opens the required-reason confirm dialog → `PUT
   .../deployments` → on success, table refreshes from the response; on `409`, see
   Error/validation messaging below.
5. **"Promote to 100%"** (Write only, appears on any row whose split is <100% while
   other active rows exist) → its own required-reason confirm dialog → `POST
   .../deployments/promote-canary`.
6. **Rollout history timeline**, below the table: reverse-chronological list of
   `deployment_history` rows — action badge (`Deploy`/`SplitChange`/`PromoteCanary`/
   `Rollback`/`EmergencyRollback`, the exact enum vocabulary, never paraphrased, same
   "match system/real world" rule §6.1 already applies to version-status vocabulary),
   version, from-state → to-state (compact, e.g. "90/10 → 100/0"), reason (verbatim,
   truncated + tooltip for long text, same convention as §6.1's description-truncation
   pattern), actor, timestamp. **`EmergencyRollback` rows get a visually distinct
   treatment** (a destructive-toned badge/left-border accent, not just the same neutral
   badge as every other action) — this is what ADR-0017's own emergency-rollback dialog
   copy in `DefinitionDetail.tsx` already promises ("visible on this agent's deployment
   history, labelled distinctly from an ordinary rollback"); this timeline is that
   promise's fulfillment, not a new decision.
7. Exit: same breadcrumb as the rest of Definition Detail; switching to the "Versions"
   tab and back preserves this tab's loaded state for the session (no need to refetch
   on every tab switch — refetch on an actual mutating action's success instead).

**The split editor itself — how allocations are added/removed/balanced (resolves the
prompt's flagged design questions):**

- **The common case (2 rows: a stable version + one canary) gets a paired-slider
  behavior, not two independent inputs the admin must manually keep summing to 100.**
  Editing either row's % input live-recomputes the other as `100 − edited value`
  (clamped 0–100) — this makes the sum-to-100 constraint impossible to violate by
  construction for the single most common workflow ("shift 10% to my canary"), rather
  than relying on the admin doing arithmetic or hitting a rejection.
- **The general case (3+ rows, e.g. a second canary added)** falls back to
  **independent numeric inputs** per row (the paired auto-adjust has no single correct
  target once there are ≥3 rows) plus a persistent **live "Total: N%"** readout and a
  **"Distribute evenly"** convenience button (resets every row to `floor(100/n)`,
  remainder added to the first row) — the general N-row path is the one that must work
  regardless of whether the 2-row polish above is built; do not ship only the 2-row
  case and call the API's general shape unsupported.
- **Live sum readout:** icon + text, never color alone — a check icon + "Total: 100% —
  ready to save" in normal/success-tinted text when the sum is exactly 100; a warning
  icon + "Total: 90% — must equal 100% to save" in amber (`WARNING_BADGE_CLASS`'s hue
  family, not raw `amber-600` text per that constant's own contrast note) otherwise.
  Announced via `aria-live="polite"` **on blur/commit of a row's input, not per
  keystroke** (debounced) — a live region firing on every digit typed is worse than
  useless for a screen-reader user editing a percentage field.
- **"Save split" is disabled** (not merely validated on click) until (a) the sum is
  exactly 100 and (b) at least one row's value actually differs from what's currently
  persisted (no-op saves are blocked, not just discouraged) — `aria-disabled` +
  `aria-describedby` pointing at the same live-sum text, so a screen-reader/keyboard
  user gets the same "why can't I save" explanation a sighted user reads directly,
  reusing the §2.3 disabled-control-explains-itself convention rather than a
  hover-only tooltip.
- **Remove-row button** is disabled/hidden on the last remaining row (a split can never
  drop to zero active rows through this editor — that would mean no active deployment
  at all, which `setTrafficSplit` doesn't produce and this UI shouldn't imply is
  reachable).
- **Version-eligibility in the "+ Add version to split" picker — deliberately diverges
  from this screen's own emergency-rollback hide convention, and the divergence is
  reasoned, not accidental:** `DefinitionDetail.tsx`'s existing emergency-rollback
  button is **hidden** for an ineligible version because that ineligibility is usually a
  dead end the admin doesn't need to act on. Here the opposite is true — an admin
  adding a version to the split is very often trying to canary a version they *just*
  built, and "must be Production first" is an actionable, one-step-away fact (go
  promote it), not a dead end. So: **show every non-`Deprecated` version of this
  definition in the picker; a version whose `status !== 'Production'` renders as a
  disabled item** (not omitted) **with its own status badge and a reachable explanation**
  — "Must be promoted to Production before it can receive canary traffic" — via
  `aria-describedby` on the disabled item (same §2.3 pattern, not hover-only), *plus* a
  persistent one-line `FieldHint`-style caption under the picker itself ("Only versions
  already promoted to Production can receive canary traffic — promote one from the
  Versions tab first.") so the reason is visible without first discovering the disabled
  state. Use the composed `Select`/combobox primitive (not a bare native `<select>`) so
  a disabled item can actually carry this description — a native `<option disabled>`
  cannot.
- **Required reason (both Save split and Promote to 100%):** exactly the existing
  emergency-rollback dialog's pattern in `DefinitionDetail.tsx` — a `Label` + `FieldHint`
  + `Textarea`, confirm button `disabled={reason.trim().length === 0}`, server
  re-validates the trimmed value regardless. `FieldHint` copy: "A non-blank reason is
  required for every split change and canary promotion — it's written to the audit log
  (`deployment_history` + the outbox) alongside the actor and the resulting
  allocations." Do not add a second, differently-worded reason convention for this
  screen when one already exists two components away in the same file.
- **The next-turn/stickiness consequence (point 4) — stated twice, both times in one
  sentence, never as a separate modal or a repeated toast:** (a) a **persistent caption
  below the allocations table**, always visible, not dismissible, not a banner: "Changes
  apply to each conversation's next turn — conversations mid-turn finish on their
  current version." (b) **inside the confirm dialog's description**, one sentence
  appended to the action-specific text: "…and, like every split change, takes effect on
  each conversation's *next* turn — already-in-progress turns finish on their current
  version." The success toast itself stays a plain "Traffic split updated." /
  "Canary promoted to 100%." — do **not** repeat the stickiness sentence a third time
  there; two well-placed mentions is legible, a third is noise.
- **Metrics — the "—" vs "0%" distinction, generalized to this table exactly as §6.1/§4.1
  already establish it, with one semantic correction that matters here:** a version
  with `runs: 0` renders a muted "—" (not "0", not "0%") in every metric column — no
  data yet, not "zero and bad." A version *with* runs renders real numbers in normal
  text. **Unlike the Tool Catalog's "0% success rate is alarming" rule (§4.1), a 0%
  *error* rate here is the desired outcome, not a bad one** — render it as plain,
  unaccented "0%", not a red/alert tone (the semantics inverted because the metric
  inverted: success-rate-of-0 is bad, error-rate-of-0 is good). Only accent the error-
  rate cell (amber/red per severity) when it's *meaningfully high* (reuse the Agent
  Tool Registry's existing >5% red-accent threshold, §4.2, rather than inventing a new
  one) — a genuinely called-out signal, paired with text/icon per the color-never-alone
  baseline, not decoration on every row.

**States:**
- **Loading:** `Skeleton` rows for the allocations table, metrics columns, and the
  history timeline independently (three separate skeleton regions, since history is a
  separate paginated call per LLD §15.7 and shouldn't block the allocations table from
  rendering once it's ready) — same "skeleton the region that's loading, don't blank
  the whole tab" convention as §4.1/§6.1.
- **Empty — no active deployment yet:** a brand-new definition with zero versions ever
  promoted to Production has no `deployment` row at all. "No active deployment yet —
  promote a version to Production from the Versions tab to begin." with a link back to
  that tab (no CTA button here, since the action lives on the other tab, not this one).
  This is not an error.
- **Error (any of the three calls fails):** inline `Alert` + "Retry", same convention
  throughout §6, scoped to just the region that failed (don't fail the whole tab if
  only history's paginated call errors).
- **History — empty:** "No deployment actions recorded yet." — a version's very first
  Production promotion already writes a `Deploy` history row (`createInitialProduction
  Deployment`), so this state should be rare/transient, not a common steady state.
- **Save/Promote loading:** confirm button spinner+disabled, same as every other
  confirm-dialog action in this file (§6.1/§6.4's rollback/promotion dialogs).

**Information architecture:** tab label "Deployments & Canary", second tab on
Definition Detail (after "Versions", which stays the default/first tab so existing deep
links/behavior are unchanged). No new breadcrumb level, no new nav item.

**Accessibility beyond baseline:** covered inline above (live-sum region debounced to
blur/commit; disabled Save/disabled picker-items reachable via `aria-describedby`, not
hover-only; row remove/promote buttons need `aria-label`s that include the version,
e.g. "Remove v1.3.0 from split", "Promote v2.3.0 to 100%", so multiple identical icon
buttons in a table remain distinguishable to a screen reader). Numeric % inputs are
real `<input type="number">`s with a `<Label htmlFor>` + a `FieldHint`: "The percentage
of new conversations for this agent in Production that should be routed to this
version. All rows must add up to exactly 100%." Timeline rendered as a semantic ordered
list; each entry's action badge pairs color with text exactly as every other badge in
this document.

**Relevant heuristics:** error prevention (required reason + confirm dialog on both
mutating actions, sum-to-100 impossible-by-construction in the 2-row case); visibility
of system status (live sum readout, the next-turn consequence stated where it matters);
recognition over recall (metrics sit beside the control that produced them; the
disabled-picker-item explanation is visible without extra discovery); match between
system and real world (exact `deployment_action`/version-status vocabulary).

**Responsive:** desktop-only, same ≥1280px / tablet-icon-rail / sub-768px-notice
treatment as the rest of the Admin Console (§1.b) — this is a dense engineering/ops
surface, not a mobile-optimization candidate.

**Error/validation messaging (verbatim per this project's exact-error-copy
convention):**
- `409 TRAFFIC_SPLIT_MUST_SUM_TO_100` → "Traffic allocations must sum to exactly 100%
  (got N%)." — client-side disabling of Save should make this unreachable in normal use;
  show it verbatim as a toast if a race (another admin changed the split concurrently)
  still produces it, then refetch.
- `409 VERSION_NOT_PRODUCTION` → "Version 2.3.0 must be promoted to Production before it
  can receive canary traffic." — same race scenario (a version's status changed between
  page-load and save); show verbatim, refetch, and the now-ineligible row's picker
  option should reflect the new disabled state on refetch.
- `422 REASON_REQUIRED` → should be unreachable given the disabled-until-non-empty
  confirm button; if hit anyway (bypassing the client), surface inline on the Textarea
  field itself, not a toast.
- `409 VERSION_NOT_IN_DEFINITION` → defensive-only; the picker only ever lists this
  definition's own versions, so this should never fire from normal use.

---

#### Surface 2 — Shadow evaluation card

**A structural fact that must shape every control on this card:** shadow results are
**evidence, never a gate** (ADR-0019 §2.5/§3). **No control on this card may look like,
or function as, a promotion/apply/adopt action** — the only actions here are Start,
Stop, and drill into the report/per-run list. This is stated once, plainly, and applies
to every sub-bullet below; it is not re-derived per state.

**Flow:**
1. Below the allocations table/history timeline, in its own bordered `Card` (visually
   separated — this is a different tool with a different risk profile: it spends real
   money and touches real customer content a second time, per point 6/ADR-0019 §2.6).
2. **Default (no active evaluation):** "No shadow evaluation running for this agent in
   Production." + "Start shadow evaluation…" (Write only).
3. **Start form** (inline in the card or a small modal — a modal is preferable here
   specifically *because* the confirm step below needs the admin's full attention, not
   a card they can half-see while scrolling): **Candidate version** (`Select` — see the
   eligibility contrast with Surface 1 below), **Sample %** (1–100, numeric, no strong
   prior default; suggest starting low, e.g. 10, in placeholder/helper text only, never
   pre-filled as if it were a recommendation the admin didn't choose), **Max runs**
   (integer, required), **Max cost (USD)** (currency input, required). Each of the
   three numeric fields gets a `FieldHint`: Sample % — "The percentage of live
   Production turns for this agent that are also replayed against the candidate,
   off the customer-facing path. Higher sampling produces evidence faster and costs
   more."; Max runs — "Hard ceiling — the evaluation automatically stops once this many
   candidate runs complete, regardless of cost spent."; Max cost — "Hard ceiling — the
   evaluation automatically stops once total candidate spend reaches this amount,
   regardless of run count."
4. **"Start"** → opens the confirm dialog below → `POST .../shadow-evaluations` → on
   `201`, card switches to the Active state; on `409 ALREADY_ACTIVE`, see Error
   messaging below.
5. **Active state:** config summary (candidate version, sample %, ceilings), live
   counters (below), **"Stop…"** (Write only) → required-reason dialog → `POST
   .../shadow-evaluations/{sid}/stop`.
6. **Stopped/Completed/AutoStopped:** the same report view, now frozen, plus "Start new
   shadow evaluation…" reappears (a tenant may only have one *active* evaluation per
   agent/environment at a time, per the schema's partial-unique constraint, but a new
   one can start once the prior finishes).
7. **Per-run drill-down** (paginated list, `GET .../shadow-evaluations/{sid}/runs`):
   opened from a "View runs" link/expand on the card, not a separate nav destination.

**Start confirmation — genuinely legible, not buried, but still scannable (point 6):**
an `AlertDialog` (reusing the exact primitive/shape as the rollback and Production-
promotion confirms elsewhere in this file), title "Start shadow evaluation for
v{version}?", description as a **short bulleted list** (three items, not one dense
paragraph — a real spend/data decision deserves more than the usual one-sentence
confirm, but still needs to be scannable in a few seconds, not a wall of text):
- "This resends a sample of real customer conversations to v{version}'s model a second
  time, off the customer-facing path. It never reaches a real tool, is never shown to
  any customer, and never creates an approval request."
- "This is genuine model-provider spend — billed and reported like any other run.
  Sampling {samplePct}% of turns, capped at {maxRuns} runs or ${maxCost}, whichever
  comes first."
- "This is evidence only — it does not change which version is currently serving
  traffic, and a good result here does not shorten or skip the promotion gate."
No reason field on Start (the API contract takes none — `{environment,
candidateVersionId, samplePct, maxRuns, maxCostUsd}`; audit already happens
structurally via the outbox per ADR-0019 §2.6, so don't invent a reason input the
backend doesn't accept).

**Candidate-version eligibility — deliberately the opposite of Surface 1's rule, and
the contrast is worth stating explicitly so nexus-dev doesn't copy-paste the wrong
restriction:** Surface 1's split editor only allows already-`Production` versions
(canary is not a second route past the promotion gate, ADR-0019 §2.4). **Shadow
evaluation is the opposite case by design** — its entire value is testing a
*pre-promotion* candidate against real traffic with zero exposure, so the picker lists
**every non-`Deprecated` version regardless of status** (`Draft` through `Production`),
each with its own status badge shown for context, and **no version is disabled here**.

**Live spend-against-ceiling display (point 6):** two `Progress` bars (reuse the
existing `Progress` primitive, already used for the Conversation confidence gauge) —
"${spendUsd} of ${maxCostUsd} spent" and "{runsCompleted} of {maxRuns} runs" — plus a
smaller caption "{runsEnqueued} enqueued, not yet completed" so an admin can tell "why
hasn't this produced results yet" is a queue-depth fact, not a stall (visibility of
system status). **Poll, don't stream** — no SSE in this phase's scope, same precedent
as the Eval Suite Runner (§6.5) — and poll on a **calmer cadence than the worker's own
5 s internal pump cadence** (recommend 10–15 s for this admin-console `GET`); update the
counters inside an `aria-live="polite"` region but only announce on an actual value
change between polls, not every poll tick, so the region stays useful rather than
chatty.

**Status badges — lifecycle, not quality, and none of the four should look alarming:**
`Active` (blue/neutral, "In progress"), `Stopped` (gray/neutral, "Stopped by admin"),
`Completed` (gray/neutral, "Completed" — **confirm with nexus-dev whether this status
is genuinely reachable this phase or only `Active`/`Stopped`/`AutoStopped` are in
practice; if `Completed` never actually fires, treat it identically to `Stopped`
visually rather than designing a distinction nothing produces, same precedent §6.7
applies to `PausedForApproval`**), `AutoStopped` (amber, paired with the verbatim
`stopReason`, e.g. "Auto-stopped — reached its cost ceiling" — amber because it's
worth noticing, not because anything failed).

**The "evidence, never a gate" framing (point 7) — one persistent line, not a banner,
not repeated per state:** a small, always-visible, non-dismissible caption beside the
card's title: "Evidence only — does not affect what's deployed." One line, present in
every state (default/active/completed), never a dismissible one-time banner (a
dismissed banner is a banner nobody sees again exactly when it matters most — the day a
result looks encouraging enough to want to act on). **Report/aggregate stats (reply
divergence %, tool-call divergence %, escalation-rate delta, latency delta, cost delta,
error-rate delta) render in plain, neutral styling — no green/red pass-fail treatment,
regardless of how favorable or unfavorable the numbers look.** This is a deliberate
divergence from this document's usual green/red badge conventions, stated explicitly
because the whole point is that a reviewer must not mistake a low-divergence stat for a
"passed" badge — it's a measurement, not a verdict. A one-line note near the stats:
"Promotion happens from the Versions tab — a good result here doesn't change what's
required there." Any stat still `null` (nothing completed yet) renders the same muted
"—" convention as everywhere else in this document — **never "0%"** (point 6's own
flagged distinction; a `null` reply-divergence and a genuine 0%-divergence measured
across real completed runs are very different claims).

**Per-run list — three non-alarming, distinct tool-call outcomes (point 8) and one
normal, non-failure skip reason (point 9):**
- **Run status column:** `Pending`/`Claimed` → neutral gray "Queued"/"In progress"
  (collapse `Pending`+`Claimed` to one plain-language label — the distinction is an
  implementation detail of the lease mechanism, not something an admin needs to parse).
  `Completed` → neutral (not celebratory — completion isn't a quality signal here,
  §7 above applies equally at the row level). `Failed` → red/error badge (a genuine
  execution failure — actionable, distinct from everything else on this list).
  `Skipped` → **neutral gray, not red** — paired with its `skipReason` rendered as
  plain text, distinct per reason since each means something different to a reviewer:
  `SourceGone` → "Skipped — source conversation no longer available (purged by
  retention)"; `QuotaDeferredTooLong` → "Skipped — repeatedly deferred by quota
  pressure"; `EvaluationStopped` → "Skipped — the evaluation was stopped before this
  run executed." **`Skipped` must never render with the same red tone as `Failed`** —
  a purged source conversation is an expected, normal outcome of retention/DSR policy
  doing its job, not a defect in the shadow run, same "procedurally normal ≠ failure"
  principle §6.5 already establishes for eval's "not yet supported" cases.
- **Per-run tool-call intents (`wouldHaveToolCalls`):** each entry — tool name
  (monospace `<code>`), masked args (monospace, from `argsMasked` — never unmasked,
  same masking convention `maskArgsForLogging` already applies elsewhere), tier badge
  (exact Tier 1/2/3 vocabulary), and an **outcome badge that must read as three
  distinct, non-alarming findings, not a traffic-light pass/fail/error trio** — do
  **not** color-code these three by red/green/amber; use one consistent neutral/
  informational badge tone for all three, distinguished by **text and icon only**:
  - `Executed(shadow-noop)` → "Would have executed (no-op)" — tooltip: "This Tier-1
    tool call was validated against its schema but never actually sent — shadow runs
    can't reach a real tool."
  - `ShadowSuppressed` → "Would have required Tier {N} approval" — tooltip: "In a live
    run, this call would have required Tier {N} human/customer approval before
    executing. No approval request was created, since this is a shadow evaluation." —
    render this as a genuine, interesting **finding**, not an error: this is exactly
    the "the candidate would have required Tier-3 approval for `issue_refund`" case a
    reviewer is looking for.
  - `PolicyDenied` → "Would have been denied by policy" — tooltip: "Tool-permission
    policy would have denied this call outright in a live run."
- **Escalation signal / guardrail outcome (captured, never acted on):** a small
  icon+tooltip on the row when present ("Escalation signal captured (not acted on)" /
  "Guardrail outcome: {outcome} (captured, not enforced)") — informational only, never
  a badge that implies the platform did anything with it, per ADR-0019 §2.5's "captured
  as data, never acted on."
- **"View shadow trace"** link (only when `shadowAgentRunId` is present, i.e. the run
  actually executed) — links to the existing Runtime Traces detail view (§6.7)
  for that specific run id. This is the **one** place a shadow run's trace is
  reachable, deliberately: the Runtime Traces **list** itself must exclude
  `trigger = 'ShadowEvaluation'` rows entirely (LLD §15.5's reader-audit requirement) —
  this per-run link bypasses the list by linking to the run's id directly, which is the
  intended, narrow exception, not a contradiction of the list's own exclusion rule.

**States:**
- **Loading:** skeleton for the card's config/counters area and, independently, for the
  per-run list (separate paginated call).
- **Empty (no evaluation ever run):** the Default flow state above — not an error.
- **Empty (per-run list, evaluation just started, pump hasn't fired yet):** "No runs
  yet — the pump enqueues a shadow run on the next matching live turn." — not an error,
  not a stall (visibility of system status: explain the delay is expected).
- **Error (any call fails):** inline `Alert` + Retry, scoped to the failed region only.
- **`409 ALREADY_ACTIVE` on Start:** verbatim server copy — "A shadow evaluation is
  already running for this agent definition and environment. Stop it before starting
  another." — shown as a toast/inline alert on the start form (a real, reachable race:
  two admins, or a stale page, both trying to start one); refetch and switch to the
  Active state showing the one that's already running.
- **Stop — required reason:** exact same Label+FieldHint+Textarea+disabled-confirm
  pattern as Surface 1/the existing rollback dialog. `FieldHint`: "Written to the audit
  log alongside the evaluation's final counters." Confirm dialog description: "In-
  flight replays already claimed by the worker will finish; nothing new will be
  enqueued after this."

**Information architecture:** lives inside the same "Deployments & Canary" tab, below
Surface 1's table/timeline, in its own visually distinct `Card` — no separate nav entry,
no separate tab (the prompt's own framing: "in the same tab").

**Accessibility beyond baseline:** the three tool-call outcome badges and the `Skipped`
status must each pair an icon with text (never rely on the reader inferring meaning
from badge shape/tone alone, since all three/four are deliberately similar-toned per
the "not alarming" design above — text is doing the real distinguishing work here, more
than usual, so it must be unambiguous). The live spend/run counters' `aria-live` region
only announces on genuine value change (see Poll cadence above) to avoid becoming
unusable noise for a screen-reader user leaving the tab open. Masked-args monospace
text needs the same bidi-isolation treatment as any generated-token interpolation per
the baseline's RTL/i18n rule (§1.b) if a tool/arg name could ever be Latin-script inside
an RTL locale's surrounding text.

**Relevant heuristics:** error prevention + help users recognize errors (the Start
confirm's three-bullet legibility, the `ShadowSuppressed`/`Skipped(SourceGone)`
non-alarming framing so a reviewer doesn't misdiagnose a normal outcome as a bug);
visibility of system status (spend/run counters, queue-depth caption); consistency &
standards (reusing the existing confirm-dialog/reason-textarea/Progress-bar/badge
primitives rather than inventing new ones); match between system and real world (exact
`ShadowRunStatus`/`ShadowEvaluationStatus`/outcome vocabulary, never paraphrased).

**Responsive:** desktop-only, same as Surface 1/the rest of the Admin Console (§1.b).

**Error/validation messaging (verbatim):**
- `201`/`409 ALREADY_ACTIVE` on start — covered above.
- Numeric field validation (`samplePct` 1–100, `maxRuns`/`maxCostUsd` > 0) — inline,
  field-targeted, blocks the Start button client-side; there is no server error string
  named for these in LLD §15.7 beyond the general validation-failure shape, so use a
  plain field-level message ("Enter a value between 1 and 100.") rather than inventing
  a specific server-sounding string that doesn't exist.

---

### Notes for `nexus-dev` (§6.8 specifically)

1. **Update the existing "Promote to Production" confirm-dialog copy now.**
   `DefinitionDetail.tsx`'s current `AlertDialogDescription` for that action says
   "Traffic-split and rollback controls will be available on the Deployment & Canary
   Manager screen in a later release — for now, promoting a new version here replaces
   the prior one's traffic outright." That is now false — this tab ships in this same
   phase. Replace it with something like: "This immediately creates a 100% Production
   deployment for v{version}. Adjust the split or promote a canary anytime from the
   Deployments & Canary tab above." Keep calling it a **tab**, not a "screen" or
   "Manager" — ADR-0019 §2.7 deliberately rejected the latter framing.
2. **The 2-row paired-slider split editor is a should-have refinement on top of the
   mandatory general N-row path**, not a replacement for it — verify the independent-
   input + live-sum + "Distribute evenly" fallback genuinely works for 3+ rows before
   treating the feature as done, even if the 2-row polish ships first.
3. **This tab's own metrics table is itself one of the `agent_run` reader-audit call
   sites LLD §15.5 names as this phase's single highest-risk item** — confirm the
   per-version metrics query explicitly excludes `trigger = 'ShadowEvaluation'` rows;
   getting this one wrong would make this exact screen quietly lie about canary
   performance using traffic no customer ever saw.
4. **Confirm whether `ShadowEvaluationStatus.Completed` is genuinely reachable this
   phase** (vs. only `Active`/`Stopped`/`AutoStopped` in practice) before designing a
   visual distinction for it that nothing produces — flagged as an open question, not
   assumed either way.
5. **Poll cadence for the Active shadow card and Surface 1's metrics table**: recommend
   10–15 s, deliberately looser than the worker's internal 5 s pump cadence, so the UI
   (and its `aria-live` regions) stay calm rather than tracking backend internals
   1:1.
6. **Don't build an environment switcher.** This tab is Production-only this phase, per
   ADR-0019 §2.7 — a picker with two dead options (Staging/Sandbox) is worse than a
   fixed label, same precedent as omitting Phase-13's dead trace-viewer link (§6.7).

---

## 7. Feature: Channels — Add Channel Type Picker + WhatsApp (Meta) Connector

**Covers:** FR-OC-02 (Channel Registration & Overview), FR-OC-03 (Channel Setup
Wizard), FR-OC-04 (Channel Routing Rules — referenced only, not re-specified),
FR-META-01 through FR-META-13 (Meta Business Manager Integration: WhatsApp WABA,
phone numbers, messaging tier, 24h session window; Messenger/Instagram OAuth link;
template sync; opt-in/consent tracking with bulk import/export). Surface: **Admin
console (tenant application)** per §1.a. Screen-inventory ref: B.2 (Channel Config).
Architecture refs: LLD §3.4 (`channel`/`channel_capability` schema), §8 (channel
adapter design — `send()`'s pre-send 24h-window check, `render()`'s quick-reply →
button degradation), §12.3 (Meta family tables: `meta_business_account`,
`whatsapp_template`, `consent_record`, `consent_import_log`). Today's actual code
(`apps/web/app/(admin)/channels/new/CreateChannelForm.tsx`) only creates a Web
Widget channel with no type step at all — this section adds the missing type
picker and the full WhatsApp config flow behind it.

No Figma input supplied — this section is the full source of UX judgment for it.

### 7.1 "Add Channel" entry point — type-selection step

**Flow:** Channels list (FR-OC-02: table of all channels, columns type/status/24h
volume) → "+ Add Channel" → **type-selection step** (new — does not exist in code
today) → routes into a type-specific config flow (Web Widget's existing minimal
form for that type; WhatsApp's flow, §7.2, for that type) → same wizard-shell
"Activate" gate as §3.1 (no "Activate" action until the type's required fields
validate, per FR-OC-03).

**Reuse, don't reinvent:** this is Step 1 of the same wizard-shell chrome as §3.1
(Add Connector Wizard) — horizontal step indicator, full-page container (not a
modal — WhatsApp's config screen has enough fields/subsections to need width),
"Back"/"Next"/"Save as draft and exit" footer pattern. The type-selection step
itself mirrors §3.1 Step 1's "Choose Type" card grid exactly (same `Card`
component, clickable whole-card, visible selected state via border+check icon).

**States:**
- **Default:** a responsive card grid — one card per `ChannelType` the tenant can
  add. Each card: channel logo/icon, name, one-line description. Enabled cards
  this phase: **Web Widget**, **WhatsApp**. Per LLD §8's adapter registry already
  reserving folders for `messenger/`, `instagram/`, `voice/`, `email/`, `sms/`,
  `slack/`, `teams/`, `x/` — but only WhatsApp has a real config flow built this
  phase — render **Messenger** and **Instagram** as visible, disabled cards
  labeled "Coming soon" (grayed-out card, disabled cursor, no click handler,
  small "Coming soon" `Tag` in the corner) rather than omitting them from the
  grid — per this task's explicit instruction, admins should see the roadmap, not
  a silently-shorter list. Any other `ChannelType` with no config flow yet this
  phase (Voice, Email, SMS, Slack, Teams) follows the same "visible, disabled,
  Coming soon" treatment rather than being hidden, for the same reason — X is the
  one type that should be omitted entirely, since it was dropped from spec scope
  by explicit user decision (2026-08-15), not merely deferred.
- **Hover/focus on a disabled "Coming soon" card:** no interaction, but the card
  remains in the tab order (not `aria-hidden`) with `aria-disabled="true"` and an
  accessible name that includes "coming soon" (e.g. `aria-label="Messenger —
  coming soon"`), so a screen-reader user hears why nothing happens, not silence.
- **Selecting Web Widget:** proceeds directly into the existing minimal
  name+environment form (`CreateChannelForm.tsx`'s current content, unchanged).
- **Selecting WhatsApp:** proceeds into §7.2's config screen.

**Information architecture:** "+ Add Channel" lives on the Channels list (top-
level sidebar item "Channels" per §1's shared nav) — no new nav entry, this is a
new step inserted before channel-type-specific config, consistent with FR-OC-03's
"type-specific wizard" language.

**Relevant heuristics:** match between system and real world (show the real
roadmap — "Coming soon" — rather than pretending Messenger/Instagram don't
exist, since admins evaluating the product need to know what's next); consistency
& standards (reuse §3.1's exact card-grid pattern instead of a new one).

### 7.2 WhatsApp Channel Connector Config — core deliverable

This is a single scrollable config screen (not a strict linear wizard beyond the
type-selection step) with distinct subsections, each independently loadable/
saveable, mirroring how a real WABA gets configured incrementally over time (OAuth
link now, phone numbers added later, templates synced repeatedly as Meta approves
new ones) — reuse `Tabs` (per baseline's Chakra composite-pattern convention) with
one tab per subsection below, all reachable via a persistent sub-nav so the admin
never loses place mid-config, consistent with the Connector Detail tabs pattern
already named in §1.b's ARIA guidance.

#### 7.2.1 Meta Business Manager OAuth link

Directly reuses the **"honest disconnected state" pattern from §6.3 (Git-connect
flow)** — same four-state model, same never-fake-a-working-connection principle,
adapted to Meta's OAuth instead of GitHub/GitLab's:

- **Not connected (default):** a single "Connect Meta Business Manager" `Button`
  (Meta logo + label), explanatory text ("Links your WhatsApp Business Account,
  Messenger Page, and Instagram professional account through one Meta OAuth
  grant").
- **Connecting (loading):** full-page redirect to Meta's OAuth/embedded-signup
  flow (same full-page-redirect-over-popup reasoning as §6.3 step 3 — more robust
  for keyboard/screen-reader/popup-blocker edge cases) → "Finishing connection…"
  loading screen on callback while Meta's Business Manager details are fetched.
- **Connected:** a green "Connected" badge (color+text, never color alone) showing
  the **verified business name and Meta Business ID** (monospace `<code>` for the
  ID, "Copy" icon button), plus "Disconnect" and "Reconnect" secondary actions.
  This is the state that unblocks every subsection below (WABA config, phone
  numbers, credentials, templates, consent) — those subsections render their own
  "no WABA linked yet" empty state (§7.2.6) until this is Connected.
- **Connection lost (Unreachable — amber, same three-color vocabulary as §6.3):**
  Meta revoked the grant, the linked business was removed, or a health check
  against the Graph API failed — shows the last-known business name/ID (grayed,
  so the admin can still recognize *which* account is broken) with an inline
  "Reconnect" action. **Never show "Connected" once a health check has failed** —
  this is the same principle §6.3 states explicitly: a fake-green badge on a
  broken connection is worse than an honest amber one.
- **Disconnect is a confirmable action** (error prevention + user control/
  freedom, same pattern as §6.3 step 7): confirm dialog states the concrete
  consequence — "Existing WhatsApp conversations continue normally. New inbound
  messages, template syncs, and phone-number changes stop until you reconnect."

#### 7.2.2 WABA configuration

- **WABA ID field:** plain text `Input` (populated automatically from the OAuth
  grant when possible; editable as a fallback for tenants using a pre-existing
  WABA ID Meta's embedded signup didn't return).
- **Phone number list:** a `Table` — columns: phone number (E.164, monospace),
  display name, verification status **badge** (Verified/Pending/Unverified — each
  paired with an icon, not color alone: check/clock/warning-triangle
  respectively), messaging tier (see gauge below, per-number since Meta assigns
  tier per phone number), quality rating if Meta returns one. Row action:
  "Remove."
- **"Add phone number" action:** opens Meta's phone-number-registration flow
  (OTP verification against the number) inline or via a focused sub-dialog —
  states: default (phone `Input` + "Send code"), verifying (OTP entry, per the
  same `PinInput`/masked-input pattern as the Admin Console's own MFA challenge,
  §2.2, for interaction consistency even though this is Meta's OTP not NextBot's),
  success (number appears in the list with status "Verified"), error (Meta's own
  rejection reason surfaced verbatim, e.g. "This number is already registered to
  another WABA" — same verbatim-transport-error philosophy as §3.2/§3.3).
- **Messaging-tier gauge:** per this task's explicit instruction, render as a
  **stepped/segmented gauge** (4 discrete segments, Tier 1 through Tier 4, current
  tier segment filled/highlighted, remaining segments dimmed) rather than a bare
  number or a continuous progress bar — the point is "which of 4 discrete tiers,"
  not "what percent," and a continuous bar would misleadingly imply a smooth
  scale. Pair the visual gauge with a text label ("Tier 2 · up to 10,000
  business-initiated conversations/24h" using Meta's own tier-limit numbers)
  since the gauge alone doesn't communicate the actual ceiling.
- **24-hour customer session window policy toggle:** a `Switch` labeled "Enforce
  24-hour session window" (default **on** — this is a real Meta platform
  constraint, not an optional business choice; the toggle exists to let an admin
  see/acknowledge the policy is active, not to actually disable Meta's own
  enforcement) with inline explanatory copy directly beneath it: "WhatsApp only
  allows free-form messages within 24 hours of the customer's last message.
  Outside that window, only an approved template can be sent." A "Learn more"
  disclosure (or just always-visible secondary text) states the **exact
  FR-META-01 rejection copy** the admin will see if this is violated: "This
  message requires an approved WhatsApp template outside the 24-hour session
  window" — quoting the literal string here (not paraphrasing it) so the admin
  recognizes it later when it actually appears (§7.3), consistent with the
  baseline's exact-error-copy heuristic (§1.b, heuristic #9).

#### 7.2.3 Credentials section

Reuses the **masked-credential pattern from §3.2** exactly — no new pattern:

- **System User token:** masked (`type="password"`-equivalent display, no show/
  reveal ever), a "Rotate" action (requires entering a new token, never
  re-displays the old one in plaintext — same rule as §3.2's "no reveal action
  anywhere in the UI, ever," per FR-SEC-02), a "Last rotated: <date>" timestamp.
- **App ID:** plain, editable `Input` (not a secret — Meta app IDs are public-ish
  identifiers, safe to display).
- **App Secret:** masked exactly like the System User token — same rotate-only,
  never-reveal treatment.

#### 7.2.4 Template sync

- **Default (no sync yet):** a "Sync from Meta" primary `Button` + empty template
  table (see §7.2.6 empty state).
- **Loading:** button → spinner + disabled; `aria-live="polite"` region announces
  "Syncing templates…" then the result count once complete (same pattern as
  Discover Tools, §3.3).
- **Success:** brief inline confirmation ("12 templates synced") + the table
  populates/refreshes below.
- **Error:** verbatim Meta API error surfaced inline (e.g., "Sync failed: rate
  limited by Meta, try again in a few minutes") + "Retry" — same verbatim-error
  philosophy as §3.2/§7.2.2.
- **Template table:** columns — name, language, status **badge** (Approved/
  Pending/Rejected — paired with icon+text, not color alone: check/clock/X
  respectively), variable list (expandable — a small `{{1}}, {{2}}` chip row or
  "View variables" disclosure showing each placeholder's position and any sample
  value Meta returned), last synced timestamp. A Rejected template's row expands
  to show Meta's rejection reason if the API provides one, so the admin
  understands *why* without leaving the console.
- **Empty (zero templates synced yet, or Meta genuinely has none):** "No
  templates synced yet — click 'Sync from Meta' to pull your approved message
  templates." with the CTA inline, not a bare empty table (same "no bare blank
  panel" rule as §3.3's empty-discovery state).

#### 7.2.5 Opt-in/consent tracking

- **Opt-in toggle:** a tenant-level `Switch` ("Require opt-in tracking for
  WhatsApp outreach") — when on, the consent log below becomes the enforcement
  record; when off, the log still displays (historical data isn't hidden) but a
  neutral inline note states tracking isn't currently required for new sends.
- **Consent log table:** columns — masked customer phone (e.g., `+1••••••1234`,
  same masking convention as PII elsewhere per NFR-5/FR-SEC-04), opt-in date,
  consent source (`Tag`: e.g. "Customer-initiated," "Bulk import," "API"), status
  **badge** (OptedIn/OptedOut — green check / gray-with-icon respectively, text-
  paired). Filterable by status/source/date range (same filter-bar pattern as
  §4.1's Tool Catalog).
- **Bulk import:** a file-upload control (`Input type="file"`, CSV/XLSX) →
  **dry-run preview before commit** — per this task's explicit instruction, mirror
  **FR-KB-01's per-item failure pattern** exactly: parsing failures for individual
  rows never block the rest of the file. The preview shows a table of every row
  with a per-row outcome (Valid/Will-import, or Error with the specific reason —
  e.g. "Invalid phone format," "Missing consent date," "Duplicate of row 14") and
  a summary line ("48 of 50 rows valid — 2 errors, shown below"). Only after
  reviewing the preview does the admin click a separate "Commit import" action
  (error prevention — importing 50 consent records is not reversible in the same
  lightweight way as most admin actions, so it earns an explicit confirm step,
  not just a file-upload-and-go). **Commit (loading):** progress indicator
  (count processed / total) since large files may take a few seconds; **commit
  success:** summary banner ("46 records imported, 2 skipped due to errors") +
  log refreshes; **commit error (transport failure mid-commit):** the exact same
  verbatim-error convention, plus guidance that already-committed rows are not
  re-imported on retry (idempotent by row, if the backend supports it — flag for
  nexus-dev to confirm this idempotency guarantee exists before promising it in
  copy, rather than asserting it here as fact).
- **Export:** an "Export" `Button` (CSV) generating an async, PII-masked export
  delivered as a signed URL — same async-export pattern already established for
  Reporting exports (LLD §12.5) — with a loading/"preparing export" state and a
  success state offering the download link (time-limited, stated inline: "This
  link expires in 24 hours").
- **Empty (zero consent records):** "No consent records yet — import a list or
  wait for customer-initiated opt-ins to appear here automatically." with the
  bulk-import CTA inline, same no-bare-blank-panel rule.

#### 7.2.6 Subsection-level empty/error states (cross-cutting)

Every subsection above needs its own **"no WABA linked yet"** gate state, shown
instead of its normal content whenever §7.2.1's OAuth link isn't Connected: a
muted panel with a one-line explanation ("Connect Meta Business Manager above to
configure phone numbers.") and no interactive controls rendered as if they were
usable-but-empty (avoids the same "read-only trap without explanation" mistake
the RBAC pattern in §2.3 warns against, applied here to a connection-state gate
instead of a permission gate). Each subsection's *own* empty state (zero phone
numbers once connected, zero templates synced, zero consent records) is distinct
from this connection gate and specified per-subsection above — never conflate
"not connected yet" with "connected but genuinely empty," since the next-action
affordance differs (Connect vs. Add/Sync/Import).

### 7.3 24-hour session-window violation — inline surfacing at send time

**Where this appears:** the Human Agent Bridge composer (Portal D) and, per
LLD §8's `send()` pre-send check, anywhere else an outbound WhatsApp send is
attempted outside the 24h window without an approved template — including any
AI-agent-initiated send that hits the same adapter path, surfaced back through
the conversation transcript rather than only logged.

- **Human agent composer:** attempting to send a free-text message outside the
  window renders an inline `Alert` (status="error") **directly above the message
  input**, not a toast — per this task's explicit instruction, this needs to be
  visible and specific, and a toast (auto-dismissing, easy to miss, disconnected
  from the input the agent is about to retry) fails both criteria. Copy is the
  **exact FR-META-01 string, verbatim**: "This message requires an approved
  WhatsApp template outside the 24-hour session window." The send button itself
  is disabled while this condition holds (error prevention — don't let the agent
  attempt-and-fail repeatedly), and a secondary action "Choose a template" is
  offered right there, opening a searchable picker over the tenant's Approved
  templates from §7.2.4's synced list (never Pending/Rejected — those aren't
  legal to send).
- **Conversation transcript:** once a send is actually rejected pre-send by the
  backend (rather than caught purely client-side), the attempted message renders
  as a system-message-styled row (centered, muted, per §5.3.1's system-message
  convention, reused here in the Human Agent Bridge's own transcript component)
  reading the same verbatim string, timestamped, so a reviewer scrolling the
  transcript later understands why a message never went out — this is a
  transcript-level "help recognize/diagnose/recover from errors" application,
  distinct from the composer-level pre-emptive block above (the composer block
  prevents the attempt when the UI already knows the window is closed; the
  transcript entry covers the case where the block is bypassed or a race exists
  between the UI's cached window-state and the backend's authoritative check —
  the backend's `send()` check per LLD §8 is the source of truth either way, the
  UI block is a courtesy that must not be the only enforcement point).
- **Never softened, never generalized:** do not paraphrase this into "Message
  couldn't be sent" or a generic delivery-failure state — the specific reason is
  the entire point, per FR-META-01's own "never silently dropped or silently
  downgraded" language, and per the baseline's exact-error-copy heuristic (§1.b,
  #9).

### 7.4 Quick-reply → WhatsApp button preview (capability-limit warning)

Per LLD §8, `render()` maps quick-reply chips to WhatsApp interactive buttons and
truncates/paginates per Meta's platform limits (seeded per-channel-type in
`channel_capability`: `max_quick_replies`, `max_button_label_chars`) rather than
failing to send — but an admin authoring a quick-reply set in Designer Studio has
no way to see this will happen unless the authoring UI itself previews it.

- **Where:** wherever quick-reply chips are authored (Designer Studio's message-
  type editor for a playbook/response) that is enabled for a WhatsApp-capable
  channel — add a **"Preview on WhatsApp"** toggle/tab alongside whatever default
  preview the authoring UI already shows (e.g., a generic chip-row preview),
  rendering the *actual* WhatsApp button chrome (rounded button list, WhatsApp's
  own visual idiom) so the admin sees the platform-native result, not just the
  abstract authored content.
- **Over-limit warning (exceeds 3 buttons):** if the authored chip set exceeds
  `max_quick_replies` (3 for WhatsApp), the preview shows exactly how the
  `render()` degradation will actually behave — the first 3 as buttons, remainder
  paginated into a "More options" follow-up per Meta's own list-message pattern
  if the adapter implements pagination that way, or explicitly flagged as
  dropped if it does not (confirm which behavior `render()` actually implements
  before finalizing this preview's copy — flagging for nexus-dev since the exact
  degradation shape determines the exact preview wording) — plus an inline
  warning banner above the preview: "WhatsApp shows a maximum of 3 buttons — the
  remaining N option(s) will [be shown as a follow-up list / not be sent],"
  worded to match whatever `render()` genuinely does.
- **Over-limit warning (label exceeds 20 chars):** any chip label longer than
  `max_button_label_chars` is shown in the preview already truncated with an
  ellipsis exactly as WhatsApp will render it, plus a field-targeted inline note
  under that specific chip's authoring input ("This label will be cut off on
  WhatsApp — shorten to 20 characters or fewer") rather than a single generic
  banner, so the admin can fix the specific offending chip without hunting for
  it.
- **This is a warning, not a hard block:** per FR-META-01's own "truncated/
  paginated rather than failing to send" language, authoring is never prevented
  — the point is eliminating the surprise, not adding a new validation gate the
  spec doesn't call for.

### 7.5 Accessibility specifics beyond the §1.b baseline

- **Status badges never color-only:** every badge introduced this section
  (OAuth Connected/Unreachable/Disconnected, phone-number Verified/Pending/
  Unverified, template Approved/Pending/Rejected, consent OptedIn/OptedOut)
  pairs its color with both text and an icon, per this task's explicit
  instruction and consistent with the baseline rule (§1.b) already applied to
  every other status badge in this document.
- **Stepped messaging-tier gauge:** implement as a labeled composite, not a bare
  set of colored `div`s — an `aria-label` stating the full value in text ("Tier 2
  of 4") on the gauge as a whole, so a screen-reader user gets the same
  information a sighted user reads from the filled segments, without needing to
  infer it from counting DOM nodes.
- **Bulk-import dry-run preview table:** per-row error cells need the same
  sortable/scannable table semantics as every other admin table in this document
  (§4.1) — additionally, the per-row status column should be filterable
  ("Show only errors") for a large import, since scrolling a 500-row preview to
  find the 2% that failed is a real usability problem at scale.
- **WhatsApp button preview:** the platform-native preview chrome is decorative/
  illustrative (it mimics WhatsApp's own UI, which the admin doesn't interact
  with here) — mark it appropriately (e.g., `role="img"` with a descriptive
  `aria-label` summarizing the button set) rather than exposing WhatsApp's own
  non-standard button chrome as if it were a live, operable control inside the
  admin console.

### 7.6 Responsive behavior

Follows the baseline's admin-console breakpoints (§1.b) — this is a desktop-
oriented config screen (tables, a gauge, a template list) like every other
Admin Console screen in this document; no widget-style mobile-first treatment
applies here. At tablet width (~768–1279px), the subsection `Tabs` scroll
horizontally rather than wrapping, and the phone-number/template/consent tables
adopt the same horizontal-scroll-with-sticky-first-column pattern already
implicit in this document's other wide admin tables (§4.1) rather than a card-
per-row mobile reflow, since sub-768px admin use is out of MVP scope per the
baseline.

### Notes for `nexus-dev` (Channels / WhatsApp Meta section)

**Open questions flagged for explicit resolution — not silently decided:**

1. **Exact pagination-vs-drop behavior of `render()` beyond 3 quick replies
   (§7.4).** This document specifies the preview must reflect whatever the
   adapter genuinely does, but the LLD text ("truncating labels and paginating
   beyond Meta's button count") is the only source read for this section —
   confirm with the actual `whatsapp/render.ts` implementation before finalizing
   the preview's exact copy/behavior.
2. **Bulk-import per-row idempotency on retry after a partial-commit failure
   (§7.2.5).** This document does not assert already-committed rows are safely
   skipped on retry — confirm the backend's actual guarantee before the UI
   promises it in copy.
3. **Whether the 24h-window client-side check (composer pre-emptive block,
   §7.3) is fed by a live, server-confirmed window state or a client-cached
   one** — if client-cached, there is an inherent race with the backend's
   authoritative `send()` check (LLD §8), which is why §7.3 specifies the
   transcript-level surfacing as a required second layer, not just the composer
   block alone; confirm the actual mechanism nexus-dev builds keeps both layers
   rather than treating the composer block as sufficient on its own.

**Resolved decisions, not open questions — implement as specified rather than
re-deriving:** Messenger/Instagram/other not-yet-built channel types are shown
disabled with "Coming soon," never hidden (§7.1); the WhatsApp OAuth link reuses
§6.3's four-state honest-disconnected-state model verbatim (§7.2.1); credentials
reuse §3.2's masked-only, never-reveal pattern verbatim (§7.2.3); the messaging
tier renders as a stepped/segmented gauge, not a bare number or continuous bar
(§7.2.2); the 24h-window rejection copy is the exact FR-META-01 string everywhere
it appears, never paraphrased (§7.3); bulk consent import requires a dry-run
preview before commit, per-row errors never block the rest of the file, mirroring
FR-KB-01's pattern exactly (§7.2.5).

---

## Notes for `nexus-dev`

- No Figma input was supplied for any of these feature sets — this document
  is the full source of UX judgment for them; implement states/patterns exactly as
  specified above rather than improvising missing states.
- The rule-builder composite pattern (§4.3) and the git-diff-view pattern (§6.2) are
  flagged as genuinely new patterns not covered by Chakra/Ark UI out of the box —
  build them compositionally per the guidance given rather than treating them as
  solved primitives.
- Everything in §1.b (WCAG 2.2 AA, Nielsen heuristics, axe-core enforcement) applies
  to all feature sections even where not restated per-control.
