# ExamLand — UX Guidelines

Authority: this document is binding on `nexus-dev` for UX/UI decisions, the same bar
`docs/architecture/LLD.md` is held to for technical decisions. It is cumulative — new
sections are appended per feature/phase; the baseline in §1 is written once and
referenced, not restated.

---

## 1. Design System Baseline

### 1a. UI surface classification

ExamLand is a SaaS (multi-tenant) deployment, tenant-scoped by subdomain
(`{tenant}.examland.app`), with a separate fixed-origin platform console
(`docs/architecture/HLD.md`/LLD §7.1, §10.3 `platform-shell`). Surfaces:

| Surface | Who uses it | Design language |
|---|---|---|
| **Public/marketing site** | Anonymous visitors, prospects considering ExamLand | Not in scope for the MVP backlog as specified (`docs/PRODUCT_SPECIFICATION.md` §9.4 has no marketing-site FR) — **not yet classified**; must be classified explicitly before any such surface is built. Do not default it to the tenant-app template. |
| **Platform admin console** (`/platform/**`, `platform-shell`) | ExamLand's own staff (Platform Admin), single fixed origin, not tenant-scoped | Admin dashboard template: sidebar nav, data tables, charts, standard CRUD/list/detail. See §1c. |
| **Tenant application** (`tenant-shell`, `exam-shell`) — both tenant admins and regular end-users (learners) | Tenant admins, exam authors, and learners, all on `{tenant}.examland.app` | Same admin dashboard template as the platform console, with features/actions gated by RBAC permission rather than a visually distinct skin per role. The **auth screens covered by this dispatch (`auth-shell`: login, register, forgot/reset password) are the one deliberate exception** — see §1c "auth-shell" below; they use a focused, centered-card layout, not the sidebar shell, since the user has no session/nav context yet. |
| Anything else | — | Not covered — classify explicitly before building. |

This dispatch (Dev-3/BL-03) covers **Login** and **Registration**, both inside
`auth-shell`, both part of the **tenant application** surface (no separate marketing
site exists in this build).

### 1b. Standards baseline (apply project-wide; reference, don't restate)

- **Accessibility**: WCAG 2.2 level AA is the target for every surface —
  ≥4.5:1 contrast for body text, ≥3:1 for large text (≥24px, or ≥19px bold) and
  meaningful UI components (borders, icons conveying state); full keyboard
  operability with a visible focus indicator (never `outline: none` without a
  replacement); semantic HTML structure and ARIA per the WAI-ARIA APG patterns for any
  custom component; screen-reader-usable, not just visually correct. This matches
  LLD §10.3's explicit call-out that NFR-5/WCAG 2.2 AA is a hard requirement on the
  auth flow.
- **Interaction heuristics**: judge flows against Nielsen's 10 usability heuristics —
  visibility of system status; match between system and the real world; user control &
  freedom; consistency & standards; error prevention; recognition over recall;
  flexibility & efficiency of use; aesthetic & minimalist design; help users recognize/
  diagnose/recover from errors; help & documentation. Call out only the ones a given
  flow implicates, not all ten per feature.
- **Platform design language**: web is the only surface in scope. **Angular Material
  is adopted as the UI kit** (judgment call, flagged below) — Material Design
  conventions (spacing, elevation, motion, form-field patterns) then apply throughout
  and don't need re-deriving per feature.

  **Flagged judgment call**: `apps/web/package.json` currently has no UI kit
  installed (plain `@angular/*` packages only, per `docs/architecture/LLD.md` §10.3's
  `shared/ui/` folder being an empty aspirational list — buttons, table, paginator,
  modal, toast, file-drop, empty-state — with no library named). The LLD is silent on
  which library backs it. Angular Material is the natural choice: it *is* Material
  Design (satisfying my own operating baseline without re-deriving a visual system),
  it is the first-party Angular component kit (lowest integration risk against
  Angular 20 signals/standalone components), and it ships accessible primitives
  (`mat-form-field`, `mat-error`, focus trapping, `MatSnackBar` with built-in
  `aria-live`) that materially reduce the a11y burden LLD §10.3 mandates for the auth
  flow specifically. **`nexus-dev` should install `@angular/material` +
  `@angular/cdk` as part of this phase** and build `shared/ui/` as thin wrappers/
  compositions over Material primitives, not a parallel component system. If this is
  rejected, `docs/design/UX_GUIDELINES.md` needs a replacement §1c before Login/
  Register can be built against it.

### 1c. Visual language & component conventions

**Palette** (Material 3 tonal approach — define as CSS custom properties /
Angular Material theme tokens in `apps/web/src/styles.css`, do not hardcode hex
values in components):

| Token | Role | Notes |
|---|---|---|
| `--el-color-primary` | Primary actions, links, focus rings, active nav | Deep indigo/blue (`#3949AB`-class), not the generic Material stock purple — gives ExamLand its own identity while staying inside Material conventions. Verify ≥4.5:1 against white before finalizing the exact hex in code. |
| `--el-color-primary-container` | Selected/active surface states | Light tint of primary |
| `--el-color-secondary` | Secondary actions, badges | Warm accent (amber/teal-class) reserved for non-primary emphasis (e.g. "Practice" vs "Exam" mode badges) — not used on the auth screens |
| `--el-color-error` | Error text, invalid field borders, destructive actions | Material's standard error red-class token; must hit ≥4.5:1 against the surface it's placed on |
| `--el-color-success` | Success confirmations, completed states | Green-class token |
| `--el-color-surface` / `--el-color-surface-container` | Backgrounds, cards | Neutral off-white / light-gray scale, plus a dark-surface reserved slot (dark mode is **not** in MVP scope — don't build a toggle, but don't hardcode colors in a way that blocks it later) |
| `--el-color-outline` | Borders, dividers | Neutral gray, ≥3:1 against surface where it conveys a meaningful boundary (e.g. input borders) |

**Typography**: a single system/web-safe font stack (e.g. Roboto, matching Material's
default, or a project-chosen alternative — either is fine, just pick one and use it
everywhere) at Material's default type scale (`headline`, `title`, `body`, `label`
levels). Never go below 14px for body text; form labels and helper/error text at
12–14px minimum with ≥4.5:1 contrast (small error text is the single most common AA
contrast failure — check it explicitly).

**Spacing/layout grid**: Material's 8px base unit (4px for tight/inline spacing,
8/16/24/32px for stacked/section spacing). Auth-shell content max-width ~400–480px,
centered.

**Component conventions**:
- **Buttons**: primary action = filled/raised button, one per screen/form (the
  single obvious next step — e.g. "Log in", "Create account"); secondary/tertiary
  actions (e.g. "Forgot password?", "Already have an account? Log in") = text/link
  style, visually subordinate. Never two filled buttons competing for attention on
  one screen.
- **Inputs**: Material form-field pattern (floating label, helper text slot below,
  error text replaces helper text below the field when invalid, not as a tooltip or
  toast — errors must be visible without an extra interaction). Every input has a
  programmatically associated `<label>` (via `mat-form-field`/`for`/`id`, never
  placeholder-as-label).
- **Alerts/banners**: form-level errors (e.g. `INVALID_CREDENTIALS`) render as an
  inline banner/alert region above the form fields, not a toast — toasts are for
  transient, non-blocking notifications elsewhere in the app (e.g. "Saved"), not for
  errors the user must read and act on to proceed.
- **Loading**: buttons show an inline spinner + disabled state during an in-flight
  submit (`mat-progress-spinner` inside the button, button text preserved or replaced
  with "Logging in…"/"Creating account…"); full-screen spinners are reserved for
  initial route/data loads, never for form submission.
- **Motion**: Material's standard easing/duration tokens for transitions
  (200–300ms for small UI changes); respect `prefers-reduced-motion` — disable
  non-essential transitions/animations for users who request it.

This baseline is now established; it is not re-derived in the feature sections below.

---

## 2. Feature: Login & Registration (Dev-3 / BL-03)

**Surface**: Tenant application, `auth-shell` (§1a/§1c). No sidebar/nav chrome — a
centered card on a plain branded background. No tenant picker anywhere in this flow:
the tenant is implicit from the hostname (`{tenant}.examland.app`); the UI must never
ask the user to select or type a tenant/organization.

**Entry/branding**: `TenantConfigStore` (LLD §10.2) fetches `GET
/tenant/public-config` before the auth screens render, returning
`{name, logoUrl, allowEmailRegistration, allowGoogleSignIn, googleClientId?}`. Render
the tenant's name/logo at the top of the auth card (falls back to a generic ExamLand
mark if `logoUrl` is absent) so the user has some confirmation they're on the right
tenant's login page — this is the *only* tenant-identifying UI, not a picker.

- **Loading state for this pre-fetch**: show a lightweight skeleton/placeholder card
  (logo-sized gray block + two input-shaped skeleton bars) rather than a blank page or
  a full-page spinner — avoids a flash of unstyled/wrong content and satisfies
  "visibility of system status."
- **Error state for this pre-fetch** (e.g. tenant resolution failed, network error):
  this is distinct from `INVALID_CREDENTIALS`/`WEAK_PASSWORD` further down — if
  `public-config` itself fails, show a full-card-replacing error message ("We
  couldn't load this page. Try again.") with a retry button, since there is no valid
  form to show without knowing `allowEmailRegistration`/`allowGoogleSignIn`.

### 2.1 Login screen

**Flow**:
1. User lands on `{tenant}.examland.app/login` (direct nav, redirect from an expired
   session via `errorInterceptor`'s 401 handling, or the "Log in" link from
   Registration).
2. Enters email + password, submits (Enter key or the primary button).
3. Success → token stored (`AuthStore`, `el.tok.{slug}` key per LLD §10.2) → redirect
   to the tenant dashboard (or the originally-requested deep link if the user arrived
   via `authGuard` redirect — preserve `returnUrl`).
4. Failure → generic error shown inline, form remains filled in (except password —
   see below), focus returns to a sensible point, user can retry immediately.
5. Exit points: "Forgot password?" link → forgot-password flow (FR-IAM-3, not built
   this phase but the link should exist and route correctly if the route is stubbed);
   "Don't have an account? Create one" link → Registration (only rendered if
   `allowEmailRegistration` is true — if registration is disabled tenant-wide, this
   link must not appear at all, not appear-then-error).

**States**:
- **Default**: empty email + password fields, primary "Log in" button enabled from
  first render (don't disable it pending "valid form" — let submit trigger validation,
  see §2.3).
- **Loading (submitting)**: primary button shows inline spinner + "Logging in…",
  button and both inputs disabled for the duration (prevents double-submit /
  editing-while-in-flight), no full-page spinner.
- **Empty-state**: N/A (this is a form, not a list) — but on-submit validation must
  catch empty email/password before hitting the network (see §2.3).
- **Error — validation** (empty/malformed email client-side): inline per-field error,
  as described in §2.3.
- **Error — `INVALID_CREDENTIALS`** (server, 401): see copy guidance below.
- **Error — `USER_INACTIVE`** (403, per LLD §7.3): a distinct message is warranted
  here since this is *not* the enumeration-sensitive case — the account exists but is
  deactivated. Copy: "Your account has been deactivated. Contact your administrator
  for help." This does not violate FR-IAM-1's generic-failure requirement, because
  FR-IAM-1's requirement is specifically about *unknown email vs wrong password* being
  indistinguishable — account-active-state is a different, already-known-to-exist
  signal the backend deliberately returns as a separate code (LLD §7.3), so the UI is
  allowed and expected to surface it distinctly.
- **Error — network/5xx**: generic "Something went wrong. Please try again." banner,
  distinct wording from `INVALID_CREDENTIALS` so the user doesn't think their
  credentials were wrong when the real issue was connectivity.
- **Success**: brief (no visible intermediate "success" screen needed) — redirect
  immediately; if there's any perceptible delay before navigation completes, keep the
  button's loading state active until the route change actually happens rather than
  re-enabling the form.
- **Disabled**: submit button disabled only while a request is in flight (not
  pre-submit — see §2.3 on avoiding premature disabling, which harms "user control &
  freedom" and "flexibility of use").
- **Focus/hover**: visible focus ring on every interactive element (Material default
  satisfies this); hover state on the button per Material conventions.

**`INVALID_CREDENTIALS` copy guidance** (must not imply "wrong password" vs "unknown
email" — FR-IAM-1 is explicit that the endpoint must not be enumerable, and the UI
copy must not leak the distinction the API already correctly hides):
> "The email or password you entered is incorrect."

Do **not** say "Incorrect password" (implies the email was found), do **not** say "No
account found with that email" (implies the opposite), do **not** subtly hint via
which field gets the error styling — apply the error indicator to **both** the email
and password fields identically (not just password), and place the message as a
single form-level banner above the fields, not as a per-field `mat-error`. A
per-field error on only "password" would itself be an enumeration leak through the UI
even though the API response is generic.

**Information architecture**: `/login` is the root of `auth-shell`; not present in any
sidebar nav (auth-shell has none). Adjacent screens reachable only via the explicit
links described above (forgot-password, register).

**Accessibility** (beyond §1b baseline):
- The `INVALID_CREDENTIALS`/`USER_INACTIVE`/network-error banner must be an
  `aria-live="assertive"` (or `role="alert"`) region — it appears asynchronously
  after submit with no other visual page change to alert a screen-reader user
  otherwise.
- On error, move focus to the error banner (or to the first field, if per-field
  errors from client-side validation are what's showing) so a screen-reader/keyboard
  user isn't left with focus stranded on a disabled button — this is focus
  management, not just visual display.
- Do not clear the email field on failure (reduces re-entry burden — recognition
  over recall); it is acceptable and slightly more secure to clear the password
  field, but if cleared, set focus into the password field, don't leave the user
  guessing why nothing happened.
- Label association: use `mat-form-field`'s built-in `<label>`/`for` wiring for both
  fields; the password field needs an accessible show/hide toggle if one is included
  (icon button with `aria-label="Show password"`/`"Hide password"`, toggling
  correctly, `type="password"`/`type="text"` swap) — not required by the spec but
  recommended for usability; if added, it must be keyboard-operable and not the tab
  order's dead end.

**Relevant heuristics**: visibility of system status (loading state on submit);
help users recognize/diagnose/recover from errors (the generic-but-still-actionable
`INVALID_CREDENTIALS` copy — "check your email and password" is implicitly conveyed
by naming both fields in the message, without revealing which was wrong); error
prevention (client-side required-field + email-format checks before hitting the
network, reducing round-trips for the most obvious mistakes, but never so aggressive
it blocks a legitimate submit — see §2.3).

**Responsive behavior**: single-column centered card at all breakpoints. Desktop:
card ~400–480px wide, vertically centered in viewport, generous surrounding
whitespace/branding background. Tablet: same card, full-bleed background. Mobile
(≤600px): card expands to near-full-width with standard page margins (16–24px),
no fixed vertical centering if it would push the card off-screen with the keyboard
open — let it sit naturally at the top with normal document flow so the on-screen
keyboard doesn't cover the fields being edited.

### 2.2 Registration screen

**Flow**:
1. User lands on `/register` (link from Login, or direct nav) — **only reachable/
   rendered if `TenantConfigStore.allowEmailRegistration` is true**; if false, redirect
   to `/login` rather than showing a broken/disabled form (error prevention — don't
   let a user fill out a form that can never succeed).
2. Fields: first name, last name, email, password (per FR-IAM-2 — no tenant field,
   no role picker, no confirm-password field required by the spec, though a
   confirm-password field is a reasonable, spec-compatible addition if `nexus-dev`
   wants extra error prevention — not mandated).
3. Submit → success → per FR-IAM-2, a newly registered user gets no roles by default
   unless the tenant configured a default self-register role; either way, the
   product behavior after successful registration should be **auto-login and
   redirect to the dashboard** (register normally implies immediate access), unless
   `nexus-dev`'s auth API contract for this phase returns only a success confirmation
   without a token — if so, redirect to `/login` with a pre-filled email and a
   confirmation banner ("Account created — log in to continue") instead of leaving
   the user on a dead-end success screen. Whichever the API actually does, the UI
   must not show a bare "success" screen with no next action.
4. Failure → inline errors per §2.3/copy guidance below; user can correct and resubmit
   without re-entering already-valid fields.
5. Exit: "Already have an account? Log in" link back to `/login`.

**States**: same shape as Login's (§2.1) — default, loading (submit-in-flight,
inline spinner + disabled fields), error (validation / `WEAK_PASSWORD` /
`EMAIL_ALREADY_REGISTERED` / network), success (auto-login or confirmation redirect
per above). No meaningful "empty state" beyond the initial blank form.

**`WEAK_PASSWORD` copy guidance** — this error is the opposite case from
`INVALID_CREDENTIALS`: FR-IAM-2 explicitly requires it to **name the unmet rule**, so
the UI must surface whatever specific rule text the API returns, not a generic
message. Render it as a **per-field error on the password input** (unlike login's
form-level banner) since this is actionable, non-enumeration-sensitive, field-specific
feedback:
> e.g. "Password must be at least 8 characters." / "Password must include an
> uppercase letter." / "Password must include a number." (per
> `PASSWORD_REQUIRE_UPPER/LOWER/DIGIT/SYMBOL`, LLD §2 config table — pass the API's
> returned rule-detail straight through rather than inventing separate client-side
> copy that could drift from the server's actual configured policy).

If the API returns only a rule *code* rather than ready copy, maintain the
`ErrorCode`→message mapping in `core/errors/error-message.map.ts` (LLD §10.3) with an
entry per named rule so the mapping is centralized, not duplicated per component.
Recommend also implementing a **live client-side password-strength checklist**
(e.g. a small list: "✓/○ At least 8 characters", "✓/○ One uppercase letter", etc.,
updating as the user types) sourced from the same tenant-configurable rule set exposed
via `public-config` or a similar endpoint if available — this converts `WEAK_PASSWORD`
from a reactive post-submit correction into proactive error prevention, satisfying
"error prevention" and "recognition over recall" directly. If the current rule set
isn't available to the client, ship without the checklist and rely on the per-field
error only — do not hardcode a guessed rule set that could contradict server config.

**`EMAIL_ALREADY_REGISTERED` copy guidance** — unlike login, registration
*is* a context where confirming "this email already has an account" is expected and
does not create a security problem (the user just typed that email into a
registration form themselves; this is not a blind enumeration vector the way login is)
per-field error on the email input:
> "An account with this email already exists. [Log in instead]" — the bracketed
> portion is a real inline link to `/login` (ideally pre-filling the email), giving
> the user a direct path forward rather than a dead end (user control & freedom).

**Information architecture**: `/register` sibling to `/login` inside `auth-shell`;
not linked from anywhere if `allowEmailRegistration` is false.

**Accessibility** (beyond §1b baseline):
- Each field's error is a `mat-error` associated to its input via
  `aria-describedby` (Material's default wiring) — screen-reader users hear the
  error when landing on/leaving the field, not just see red text.
- On submit-triggered validation failure, move focus to the **first invalid field**
  (not a form-level banner, since these are field-specific), and ensure the field's
  error text is announced (`aria-live="polite"` region tied to the error, or rely on
  `aria-describedby` re-reading — verify with a screen reader before shipping, per
  LLD §10.3's a11y smoke test requirement with axe + Testing Library).
- The password-strength checklist, if built, needs `aria-live="polite"` so updates
  are announced as the user types without interrupting typing (`polite`, not
  `assertive` — this is incidental feedback, not a blocking error).
- First/last name fields: standard `autocomplete="given-name"`/`"family-name"`,
  email `autocomplete="email"`, password `autocomplete="new-password"` (distinct
  from login's `"current-password"`) — helps password managers behave correctly and
  is a WCAG 2.2 AA success criterion (1.3.5 Identify Input Purpose) in its own right.

**Relevant heuristics**: error prevention (real-time password-strength feedback,
inline `EMAIL_ALREADY_REGISTERED` with a direct recovery link); user control & freedom
(don't discard valid fields when one field errors); consistency & standards (same
loading/error visual pattern as Login, so the two screens feel like one system, not
two).

**Responsive behavior**: same as Login (§2.1) — single centered card, expands to
near-full-width on mobile, no fixed vertical centering that fights the on-screen
keyboard. Four/five stacked fields plus a strength checklist will run longer than
Login's two fields — on mobile, don't force the whole form above the fold; normal
scroll is expected and fine.

### 2.3 Form validation UX (applies to both screens)

- **On-submit validation, not aggressive on-blur/on-keystroke validation**, for the
  *first* interaction with each field: don't show "this field is required" the
  instant a user tabs out of an empty field they haven't tried to submit yet — this
  is a well-documented usability irritant (error prevention should guide *toward*
  correct input, not punish incomplete-but-in-progress input). Trigger full
  validation on submit attempt.
- **After the first submit attempt**, switch to live/on-change validation for the
  remainder of the session on that form — once a user has seen an error, clearing it
  as soon as they fix the field (rather than making them re-submit to find out) is
  the correct, less-frustrating behavior. This is the standard Material/Angular
  reactive-forms pattern (`updateOn: 'submit'` initially, or track a
  `submitted`/`touched-after-submit` flag driving `mat-error` visibility) — mirrors
  the LLD's signals-first store convention (§10.2): a small `submitted` signal per
  form component, feeding computed per-field error visibility.
- **Email format**: client-side format check (basic regex/`Validators.email`) before
  submit is fine and expected — this is not enumeration-sensitive (it doesn't tell
  the user anything about *other* accounts, only about the syntax of what they just
  typed).
- **Required fields**: standard "This field is required" per-field messaging on
  Registration's name fields; Login's email/password required-check can be a simple
  disabled-submit-prevented-with-shake or inline required message — either is fine,
  just be consistent with Registration's pattern rather than inventing a second one.
- Never disable the submit button based on client-side form validity before the
  user has attempted to submit (flexibility & efficiency of use — some users paste
  in credentials from elsewhere and the button should not visibly "reject" them
  before they've even tried).

---

## 3. Feature: Platform Admin Console — Tenants (Dev-5b / BL-05, FR-MT-9)

**Surface**: Platform admin console (§1a) — `platform-shell`, sidebar-nav admin
dashboard template. Not `auth-shell`'s centered-card exception, **except** for the
platform-admin login screen itself, which is structurally its own auth realm
(separate login endpoint/token/guard from the tenant app per LLD, per the dispatch
context) but is still a "log in" screen with no session yet — it follows the exact
same `auth-shell` visual pattern as §2.1 (centered card, no sidebar), just pointed at
`/api/platform/auth/login` instead of the tenant endpoint, with its own token storage
key (distinct from `el.tok.{slug}` — e.g. `el.tok.platform`) and its own route guard.
Once authenticated, the admin lands inside `platform-shell`'s sidebar template for
everything else (tenant list/detail/create). Baseline standards (§1b) and the shared
palette/typography/component conventions (§1c) apply throughout; not restated here.

### 3.0 Platform Admin login

Identical flow/state/copy pattern to §2.1 (Login), with these substitutions:
- Endpoint: `POST /api/platform/auth/login`.
- No tenant branding fetch — this is a fixed-origin console, not tenant-scoped.
  Render a static "ExamLand Platform Admin" mark instead of a tenant logo. No
  loading/error state is needed for a pre-fetch, since there is no `public-config`
  equivalent here — the login form renders immediately.
- No registration link, no "forgot password" link unless/until a platform-admin
  password-reset flow exists — omit both entirely (don't stub dead links).
- On success: store `{accessToken, expiresInSeconds}` under the platform-specific
  token key, redirect to `/platform/tenants` (the tenant list, §3.1) as the console's
  home/landing screen — there is no "dashboard" screen specified for this phase, so
  the tenant list *is* the landing page.

**`INVALID_CREDENTIALS` copy** — identical enumeration-safety treatment as §2.1,
same rationale (the endpoint is generically 401 for both unknown-email and
wrong-password cases):
> "The email or password you entered is incorrect."

Same rules apply: apply the error indicator to both fields identically, single
form-level `role="alert"`/`aria-live="assertive"` banner (not per-field), don't clear
the email field, do clear-and-refocus the password field if cleared. Do not invent a
`USER_INACTIVE`-style distinct message unless the platform-admin API actually returns
a corresponding code (context above doesn't mention one for this realm — ship the
generic message only, revisit if `nexus-dev` finds a distinct code on the real
endpoint).

**Accessibility/responsive**: identical to §2.1 — nothing platform-specific to add.

### 3.1 Tenant list screen (`/platform/tenants`)

**Flow**:
1. Admin lands here immediately after login, or via the sidebar nav item "Tenants"
   (first/primary nav item — this console has essentially one resource in this
   phase, so it should be the default-selected/highlighted nav entry on load).
2. Table loads via `GET /api/platform/tenants` with default `page=1`, a sensible
   default `pageSize` (25 recommended — balances scan-ability against pagination
   friction), `status` unset (all non-deleted statuses) and `includeDeleted=false`.
3. Admin can filter by `status` (a `mat-button-toggle-group` or `mat-select` above
   the table — either is fine, `mat-select` is more compact if more statuses are
   added later), toggle "Show deleted" (a checkbox, off by default — deleted tenants
   are an edge case, not the default view), and paginate (`mat-paginator` driven by
   `page`/`pageSize`, `total` from the response).
4. Row action: "View" (or clicking the row) → tenant detail (§3.2). Row-level quick
   actions (suspend/activate/retry) are acceptable *in addition to* the detail
   screen's actions (per the dispatch context, "list-row action button acceptable
   too") but the detail screen remains the primary, always-available place for every
   action — don't make any action row-only.
5. Primary action: "Create tenant" button (top-right of the table header, filled/
   raised — the one primary action on this screen per §1c's one-filled-button rule)
   → create form (§3.3).
6. Exit: sidebar nav to another console section (none exist yet this phase — tenants
   is the only console section), or log out (account menu, top-right, standard admin
   dashboard placement).

**States**:
- **Loading (initial/filter/page change)**: use a **skeleton table** (gray placeholder
  rows matching the real column layout, ~5-8 rows) for the *initial* load, not a
  spinner — this previews the eventual layout and reduces perceived wait (matches
  §2's precedent of skeleton-over-spinner for structural loads). For a **subsequent**
  filter/sort/page change on an already-rendered table, use a lighter treatment: keep
  the existing rows visible but dim/overlay them with a small inline spinner (avoids
  the jarring full-skeleton flash on every filter click) — this is the standard
  Material data-table refresh pattern.
- **Empty (no tenants match the current filter)**: a centered empty-state block
  (icon + message + primary action), not a blank table with just headers. Copy:
  - No tenants at all yet: "No tenants yet. Create the first one to get started." +
    a "Create tenant" button (same action as the header button — don't make the user
    hunt for it).
  - Tenants exist but the current filter excludes all of them (e.g. filtered to
    `Failed` and none are failed): "No tenants match the current filter." + a
    "Clear filter" action, no "Create tenant" CTA here (it would be a non-sequitur —
    the problem is the filter, not an absence of tenants).
- **Error** (list fetch fails, network/5xx): replace the table body with an inline
  error block ("We couldn't load tenants. Try again." + retry button) — same pattern
  as §2's `public-config` fetch error, adapted to a table body rather than a full
  card.
- **Success**: table populated, pagination controls reflect `total`/`pageSize`.
- **Row-level loading** (a quick action — suspend/activate/retry triggered from the
  row): disable that row's action button(s) and show an inline spinner on the
  clicked button only; don't block the whole table. On completion, update that row's
  status badge in place (optimistic-safe: re-fetch the row or the whole page rather
  than hand-rolling client-side state mutation, to stay consistent with server
  truth) and show a transient confirmation via `MatSnackBar` (e.g. "Tenant suspended.")
  — this is exactly the "toast for transient non-blocking notification" case §1c's
  Alerts/banners rule reserves toasts for.
- **Disabled**: quick-action buttons are conditionally rendered/disabled based on
  current status (e.g. "Suspend" only shown/enabled for `Active` tenants, "Activate"
  only for `Suspended`, "Retry" only for `Provisioning`/`Failed`) — this is error
  prevention: don't let the admin click an action the API will reject with
  `INVALID_TENANT_STATE`, even though that error is also handled gracefully if a race
  causes it (see §3.4).

**Table columns** (in order): Name, Subdomain (`{slug}.examland.app` — render as the
full resolvable domain string, not just the raw slug, since that's the actually
useful piece of information to an admin), Status (badge, §3.1a), Created (relative +
absolute on hover/tooltip, e.g. "3 days ago" with a title attribute giving the exact
timestamp — recognition over recall for both scan-speed and precision), Actions
(icon buttons or a `mat-menu` overflow, admin's choice, but keep destructive/
state-changing actions visually distinct from "View").

**Sorting**: not in the API surface described (no `sort`/`sortBy` param on `GET
/api/platform/tenants`) — do not build client-side sorting that silently only sorts
the current page (that would misrepresent the data across pages and is worse than no
sorting at all). Ship unsorted (server's default order, presumably `createdAt desc`)
for this phase; flagged below for `nexus-dev`/backend awareness if sorting becomes a
real need later.

**Pagination**: standard `mat-paginator` bound to `page`/`pageSize`/`total`;
`pageSize` options e.g. `[10, 25, 50, 100]` (100 is the API's stated max — don't
offer a client option above it). Page-size and current page are reasonable to persist
in the URL query string (`?page=2&pageSize=25&status=Active`) so a reload/shared link
preserves the admin's view — small but real "flexibility & efficiency of use" win for
a screen an admin will return to repeatedly.

**Information architecture**: `/platform/tenants` is the console's landing route and
its only sidebar nav item this phase (a single-item sidebar is a bit sparse but is an
honest reflection of current scope — don't pad it with placeholder nav items for
sections that don't exist yet).

#### 3.1a Status badge treatment

First place badges appear in the project — establishing this now as a project-wide
component pattern (`shared/ui`), not a one-off:

| Status | Badge color token (§1c) | Icon (Material Symbols) | Meaning/tone |
|---|---|---|---|
| `Provisioning` | `--el-color-primary-container` background, `--el-color-primary` text/icon | `sync` (or `progress_activity`, animated per Material's indeterminate-progress motion token, respecting `prefers-reduced-motion` — a static icon if motion is disabled) | Transient, informational — "in progress," not a final state |
| `Active` | `--el-color-success` background tint / darker `--el-color-success` text, or `--el-color-success` as a solid dot + text if a filled badge with green background risks contrast issues — **verify actual token hex pairing hits ≥4.5:1 nomally before finalizing in code**, per §1b | `check_circle` | Positive, healthy |
| `Suspended` | Neutral warning treatment — an amber/warning tint if the palette (§1c) has one, otherwise `--el-color-outline`-toned neutral gray with a distinct icon so it isn't confusable with `Active` for a colorblind user (icon differentiation is load-bearing here, not just color) | `pause_circle` | Reversible, admin-initiated — not an error, not success |
| `Failed` | `--el-color-error` background tint / `--el-color-error` text/icon | `error` | Negative, actionable (retry available) |

Badge component requirements (applies to every status, not per-row):
- **Never color-only** — every badge pairs a color with a distinct icon and text
  label ("Active", "Failed", etc., not an icon alone) — satisfies WCAG 2.2 AA's
  "don't convey meaning by color alone" and the ≥3:1 contrast requirement for
  meaningful UI components (§1b).
- Build once as a `shared/ui` `StatusBadgeComponent` taking a `status` input and
  internally mapping to color/icon/label — do not hand-roll the color/icon logic per
  screen (list row vs. detail header both need the exact same badge).
- The palette (§1c) doesn't yet define an explicit "warning/amber" token for
  `Suspended` — **flagged below** as a small addition `nexus-dev` should make to the
  Material theme tokens rather than improvising an ad hoc color inline.

### 3.2 Tenant detail screen (`/platform/tenants/:id`)

**Flow**:
1. Entered via the list's row/"View" action, or a direct URL (bookmarked/shared).
2. Fetches `GET /api/platform/tenants/:id` — full `TenantSummary` shape.
3. Displays all fields (name, subdomain, schema name, status badge, flags
   `isDefault`/`allowEmailRegistration`/`allowGoogleSignIn`, `defaultSelfRegisterRole`,
   logo if present, timestamps, and — conditionally — `provisioningError`,
   `deletedAt`/`purgeAfterAt` if soft-deleted).
4. Primary state-changing actions live here (Suspend / Activate / Retry provisioning
   — exactly one is available/enabled at a time per current status, same
   error-prevention logic as the list's row actions).
5. Exit: "Back to tenants" (breadcrumb or back-link at the top, standard admin
   dashboard convention) → list, preserving the list's prior filter/page state if
   feasible (don't reset pagination on back-navigation — recognition over recall).

**States**:
- **Loading**: skeleton detail layout (label/value pairs as gray placeholder bars),
  not a spinner — consistent with the list's skeleton choice.
- **Not found** (`404`/bad id): a dedicated "Tenant not found" message with a link
  back to the list, not a blank/broken detail page.
- **Error** (fetch fails, network/5xx): inline error block + retry, same pattern as
  the list.
- **Success**: full detail rendered.
- **Action-in-flight** (suspend/activate/retry clicked): the clicked action button
  shows an inline spinner and disables itself *and* the other action buttons for the
  duration (prevent firing two state transitions concurrently against the same
  tenant — directly relevant given QA's Dev-2 finding of a real concurrency race on
  concurrent `retry()` calls; the UI-level guard doesn't replace the backend needing
  its own lock/CAS, but it's the correct, expected client-side error-prevention
  behavior regardless). On completion: re-fetch the tenant detail (server truth, not
  a hand-rolled optimistic status flip) and show a `MatSnackBar` confirmation.
- **Provisioning error display** (status `Failed`, `provisioningError` present):
  render as a distinct, visually flagged block (e.g. an inline error-toned panel,
  `--el-color-error` accent border/background tint) directly below the status badge
  — not buried in a generic "details" list — containing the raw `provisioningError`
  text (labelled "Provisioning error:") plus the "Retry provisioning" action
  immediately adjacent. Since this text originates server-side (a workflow-step
  failure reason), treat it as message content, not markup — render as plain text,
  never `innerHTML`.

**Accessibility** (beyond §1b/§3.1a baseline):
- Status changes (suspend/activate/retry completing) should be announced via an
  `aria-live="polite"` region tied to the snackbar/confirmation, not just the visual
  badge update — a screen-reader user acting on this screen needs to know the action
  actually took effect without re-reading the whole page.
- Label/value pairs use proper semantic association (a definition list `<dl>`/`<dt>`/
  `<dd>`, or at minimum visually-and-programmatically paired label+value elements) —
  not just two adjacent `<div>`s with CSS spacing implying the relationship.

**Relevant heuristics**: visibility of system status (action-in-flight state, live
status badge); user control & freedom + error prevention (disabling the
inapplicable actions rather than showing all three always and erroring after the
fact); help users recognize/diagnose/recover from errors (the provisioning-error
panel is specifically there to let the admin *act* on a `Failed` tenant, not just see
that it failed).

### 3.3 Create-tenant screen/dialog (`/platform/tenants/new` or a modal)

Either a dedicated route or a modal dialog is acceptable (admin dashboard convention
supports both for a 3-field create form) — a **modal is recommended** here since the
form is short and the "create → land back on an updated list" loop is tighter without
a full route round-trip, but a dedicated route is equally valid if `nexus-dev`
prefers consistent deep-linkability across all create flows in the console. Whichever
is chosen, apply consistently to any future console create-flows (consistency &
standards).

**Flow**:
1. Triggered by the list's "Create tenant" button.
2. Fields: Tenant name (text), Subdomain slug (text, with a live preview of the
   resulting full domain, e.g. "your-slug.examland.app", updating as the admin
   types — recognition over recall, and it doubles as implicit format guidance),
   Admin email (email input). All three required per the API contract
   (`INVALID_SUBDOMAIN`/`TENANT_NAME_REQUIRED`/`VALIDATION_FAILED` on adminEmail).
3. Client-side validation before submit (same on-submit-then-live pattern as §2.3):
   name non-empty, slug format (lowercase alphanumeric + hyphens is the reasonable
   assumed rule — mirror whatever `INVALID_SUBDOMAIN`'s actual accepted pattern is
   once `nexus-dev` confirms it against the real validator, per FR-MT-1's existing
   subdomain rules already built in Dev-1), email format. This reduces avoidable
   round-trips but does **not** replace server validation display.
4. Submit → **this call is synchronous and can take several seconds** (full
   provisioning workflow runs inline per the dispatch context) — see the dedicated
   loading treatment below; this is the single most important UX call in this
   section, since a multi-second POST with no feedback reads as a frozen/broken
   button otherwise (a direct "visibility of system status" violation).
5. Success (`201`, tenant `Active`) → close the modal/navigate away from the create
   route, then land on the **new tenant's detail screen** (§3.2) — not back on the
   bare list — with a `MatSnackBar` confirmation ("Tenant '{name}' created."). Landing
   on the detail screen is preferred over the list because it's the more useful next
   view of exactly what the admin just did (recognition over recall) and it's where
   they'd immediately need to go anyway to inspect a freshly-provisioned tenant.
6. Mid-provisioning failure (`201`/success-shaped response but tenant comes back with
   `status: Failed`, or however the real contract surfaces this — confirm the exact
   response shape against Dev-5a's actual implementation before building, flagged
   below) → **do not show this as a rejected/failed submission** the way a
   `400`/`409` validation error is shown. A tenant row *was* created — treat it as a
   success-with-a-caveat: close the form, navigate to the new tenant's detail screen
   (same as the happy path), where the `Failed` status badge and the
   `provisioningError` panel (§3.2) are exactly the mechanism for surfacing "partially
   created, retry available." This distinction matters because the two failure
   shapes mean genuinely different things to the admin: a `400/409` means "nothing
   was created, fix your input and resubmit the form"; a `Failed`-status
   post-create means "something was created, go manage it on its own detail page."
   Conflating them (e.g. showing a form-level error banner for both) would send the
   admin back to a form to "fix" input that was actually fine.
7. Hard rejection (`400 INVALID_SUBDOMAIN`, `409 SUBDOMAIN_TAKEN`,
   `400 TENANT_NAME_REQUIRED`, `400 VALIDATION_FAILED`) → the form remains open,
   per-field error shown on the relevant field (subdomain errors on the subdomain
   field, name error on the name field, adminEmail shape error on the email field) —
   these are field-specific, actionable, non-enumeration-sensitive errors, so
   per-field `mat-error` is correct here (unlike login's form-level banner pattern).
   Copy should reflect the actual condition plainly:
   - `INVALID_SUBDOMAIN`: "This subdomain isn't valid. Use lowercase letters,
     numbers, and hyphens only." (adjust exact wording once the real accepted
     pattern/reserved-word list is confirmed against Dev-1's validator.)
   - `SUBDOMAIN_TAKEN`: "This subdomain is already in use. Try another."
   - `TENANT_NAME_REQUIRED`: "Enter a tenant name."
   - `VALIDATION_FAILED` (bad adminEmail shape): "Enter a valid email address."
8. `500 TENANT_PROVISIONING_FAILED` (a hard, no-tenant-created failure distinct from
   the `Failed`-status case above — confirm against the real contract which of these
   two failure shapes actually occurs in which circumstance, flagged below): treat as
   a form-level banner error (network/5xx pattern, §2.1) — "Something went wrong
   while creating this tenant. Please try again." — since in this shape nothing
   persisted for the admin to go manage.

**Loading experience during the synchronous provisioning call** (the dispatch
context's explicit ask):
- On submit: disable all three fields and both the submit and cancel/close buttons
  (prevent double-submit and prevent the admin closing the modal mid-request, which
  would leave them uncertain whether provisioning is still running server-side).
- Submit button shows an inline spinner and its label changes to "Creating tenant…".
- **In addition to the button's own spinner**, render explicit copy near the form
  (e.g. below the button, or as a full-width banner inside the modal):
  > "Provisioning your tenant… this can take a few seconds. Please don't close this
  > window."
  This extra sentence is deliberately more explicit than the button-spinner pattern
  used elsewhere (§1c) because a multi-second wait is long enough that a user who has
  only ever seen sub-second submits elsewhere in this app may reasonably suspect
  something is broken without an explicit "this is expected to take a while" cue —
  directly addressing "visibility of system status" for an atypically long operation.
- Do not use a full-page/full-screen spinner or navigate away before the response
  resolves — the admin should watch the form itself "hold" through the duration,
  reinforcing that their one action is what's being processed.

**Accessibility**:
- Every field has a real, programmatically associated `<label>` via
  `mat-form-field` (name → "Tenant name", slug → "Subdomain", email → "Admin email"),
  matching §1c's input convention.
- The live subdomain-preview text ("your-slug.examland.app") should be associated to
  the slug field via `aria-describedby` so a screen-reader user hears the resulting
  domain as they type, not just sighted users seeing it update visually.
- On submit, move focus into the disabled-region's live-region announcement
  ("Provisioning your tenant…") via `aria-live="polite"` (not assertive — it's
  status, not an interruption) so a screen-reader user isn't left in silence for
  several seconds wondering if their submit registered.
- On success, if this is a modal: move focus to the destination (the new detail
  screen's heading) after navigation completes — don't leave focus stranded on a
  now-destroyed dialog. On a hard-rejection error, move focus to the first invalid
  field (same pattern as §2.2's registration form) or to the form-level banner for
  the 5xx case (same pattern as §2.1's login form).
- If a modal (`mat-dialog`): standard Material dialog a11y applies automatically
  (focus trap, `aria-modal`, initial-focus, Escape-to-close) — Escape-to-close must
  be **disabled while the submit is in flight** (consistent with disabling the
  cancel button above) and re-enabled once the request resolves.

**Relevant heuristics**: visibility of system status (the dominant concern for this
screen, given the multi-second synchronous call); error prevention (client-side
format checks before submit); help users recognize/diagnose/recover from errors (the
success-vs-Failed-status distinction in step 6 above is precisely this heuristic
applied to a non-obvious API shape).

### 3.4 Suspend / Activate / Retry-on-Failed flows

**Suspend** (`Active` → `Suspended`) and **Activate** (`Suspended` → `Active`):
- Available from both the list row and the detail screen (§3.1/§3.2's action
  buttons), gated to the applicable current status only.
- **Confirmation before suspend**: yes — a lightweight `mat-dialog` confirm
  ("Suspend '{tenant name}'? Users on this tenant will be unable to sign in until it
  is reactivated." / Cancel / "Suspend" as the dialog's action button) — this is a
  real behavioral impact on the tenant's live users, warranting the "error
  prevention + user control & freedom" pairing the baseline calls out for destructive
  actions, even though it's reversible (reversibility reduces the bar but doesn't
  eliminate it, since the *impact window* while suspended is still real for that
  tenant's users).
- **Confirmation before activate**: not required — reactivating is the
  "un-doing" of a deliberate prior action and has no destructive downside; requiring
  a confirm here would be friction without a matching risk (over-confirming is its
  own heuristic violation — flexibility & efficiency of use).
- On `409 INVALID_TENANT_STATE` (a race — someone else changed the status between
  page-load and this click): show a `MatSnackBar` ("This tenant's status has
  changed. Refreshing…") and re-fetch the row/detail rather than a blocking error
  dialog — this is a benign, recoverable race, not a user mistake, so the recovery
  should be automatic re-sync, not a modal demanding acknowledgment.

**Retry provisioning** (`Provisioning`/`Failed` → attempts to reach `Active`):
- Primary location: the detail screen (§3.2), directly adjacent to the
  `provisioningError` display, since that's where the context (*why* it failed) is
  visible. A list-row quick action is also acceptable per the dispatch context, but
  should navigate to (or refresh in place and then implicitly encourage a click into)
  the detail screen's error panel rather than resolving to a bare snackbar with no
  further context — the admin should be able to see *why* it failed, not just that a
  retry was fired.
- **Confirmation before retry**: not required — retry is a corrective, non-destructive
  action on an already-broken state; there is no "undo" concern (nothing new is being
  destroyed) and no reasonable case for blocking it behind a confirm dialog. Just an
  inline spinner on the retry button per §3.2's action-in-flight state.
- The endpoint returns `202` (accepted, async-flavored) even though the dispatch
  context notes this workflow is otherwise synchronous elsewhere — **treat this one
  as fire-and-poll or fire-and-manual-refresh**: since `202` implies the retry itself
  may not have finished synchronously, don't assume the immediately-following
  `GET /api/platform/tenants/:id` will already reflect `Active`. Recommended UX:
  after firing retry, show the button's in-flight state for a fixed short window (or
  poll `GET .../:id` every few seconds while status remains `Provisioning`) with
  status-badge live updates, rather than a single fetch-and-done — confirm the
  actual behavior (does `202` mean the workflow runs fully before responding, same as
  create's synchronous behavior, or does it genuinely return before completion?)
  against Dev-5a's real implementation, flagged below, since it changes whether
  polling is actually necessary.
- On `409 INVALID_TENANT_STATE` (tenant already `Active` by the time retry is
  clicked — same race class as suspend/activate): identical snackbar + re-fetch
  treatment as above.

### 3.5 Responsive behavior

The platform admin console is used by ExamLand's own staff, realistically on
desktop/laptop screens for day-to-day tenant management — but per §1b's baseline
(no fixed-form-factor exception applies here; this isn't a CLI-adjacent internal
tool, it's a standard admin dashboard), still specify graceful degradation:
- **Desktop** (primary target): sidebar nav persistently visible, table at full
  column set.
- **Tablet**: sidebar collapses to an icon rail or a toggleable drawer (standard
  Material responsive sidenav pattern); table remains, possibly dropping the
  "Created" column's absolute-timestamp tooltip affordance in favor of relative-only
  text if space is tight (the tooltip itself, not the underlying data, is what's
  cut).
- **Mobile**: sidebar becomes a full-drawer overlay (hidden by default, hamburger
  toggle); the tenant table degrades to a stacked-card list (one card per tenant:
  name + status badge prominent, subdomain/created as secondary text, actions in a
  `mat-menu` overflow) rather than a horizontally-scrolling table — a horizontally-
  scrolling data table on mobile is a well-documented usability failure and should be
  avoided even though this console is desktop-primary.

### 3.6 Copy summary (quick reference)

| Condition | Placement | Copy |
|---|---|---|
| Platform login `INVALID_CREDENTIALS` | Form-level banner, both fields flagged | "The email or password you entered is incorrect." |
| List: no tenants at all | Empty-state block | "No tenants yet. Create the first one to get started." |
| List: filtered to zero results | Empty-state block | "No tenants match the current filter." |
| List/detail fetch failure | Inline error block | "We couldn't load tenants. Try again." / "We couldn't load this tenant. Try again." |
| Create: in-flight | Inline banner near submit | "Provisioning your tenant… this can take a few seconds. Please don't close this window." |
| Create: `INVALID_SUBDOMAIN` | Per-field (subdomain) | "This subdomain isn't valid. Use lowercase letters, numbers, and hyphens only." |
| Create: `SUBDOMAIN_TAKEN` | Per-field (subdomain) | "This subdomain is already in use. Try another." |
| Create: `TENANT_NAME_REQUIRED` | Per-field (name) | "Enter a tenant name." |
| Create: `VALIDATION_FAILED` (email) | Per-field (admin email) | "Enter a valid email address." |
| Create: `TENANT_PROVISIONING_FAILED` (hard 500, nothing created) | Form-level banner | "Something went wrong while creating this tenant. Please try again." |
| Create success (incl. resulting `Failed` status) | Snackbar + navigate to detail | "Tenant '{name}' created." |
| Suspend confirm dialog | Modal body | "Suspend '{name}'? Users on this tenant will be unable to sign in until it is reactivated." |
| Suspend/Activate/Retry success | Snackbar | "Tenant suspended." / "Tenant activated." / (retry: rely on status-badge update, no separate snackbar needed since the badge itself is the confirmation) |
| Race (`409 INVALID_TENANT_STATE`) on any action | Snackbar | "This tenant's status has changed. Refreshing…" |

---

## 4. Feature: Tenant Admin — User Management (Dev-6b / BL-06, FR-IAM-7)

**Surface**: Tenant application (§1a) — but this is the **tenant realm's own admin
surface** (a Tenant Admin managing their own tenant's users), structurally distinct
from §3's Platform Admin console (`platform-shell`, fixed origin, ExamLand's own
staff). This lives inside the tenant's authenticated shell at
`{tenant}.examland.app`, gated by RBAC permission (§1a: "features/actions gated by
role rather than a visually distinct skin per role") rather than a separate
sub-origin. Baseline standards (§1b) and shared palette/typography/component
conventions (§1c) apply throughout, reusing the *structural patterns* §3 established
(skeleton/empty/error states, `StatusBadgeComponent`-style component thinking,
confirm-dialog-required for destructive actions, mobile card-list table degradation)
— not restated below except where this surface diverges.

### 4.0 Tenant authenticated shell (new — establishing it now)

Per the dispatch context, Dev-3/Dev-6a shipped only a bare, unguarded placeholder
dashboard with **no nav chrome** — there is no tenant-realm sidenav/shell yet for
this feature to live inside. **This document specifies that `nexus-dev` must build
one as part of Dev-6b**, mirroring `platform-shell`'s pattern (§3) rather than
inventing a second shell convention:
- Persistent sidebar nav (desktop), collapsing to a drawer/hamburger below tablet
  width (identical breakpoint behavior to §3.5).
- Top bar: tenant name/logo (reusing the `TenantConfigStore` data already fetched
  for `auth-shell`, §2), account menu (profile link → the existing Dev-6a
  self-service profile screen, log out).
- Sidebar nav items are **permission-gated, not role-name-gated** — a nav entry for
  "Users" only renders if the current user's resolved permissions include the
  user-management capability (consistent with §1a's "gated by RBAC permission"
  principle and with Dev-4's RBAC model). Do not hardcode a check for the literal
  "Tenant Admin" role name; check the permission.
- This shell wraps every authenticated tenant-app route from this phase forward
  (the dashboard placeholder, the profile screen, and this phase's user-management
  routes) — it is a foundational, cross-cutting UI change, not scoped narrowly to
  the `/users` routes alone. Flagged below for `nexus-dev` awareness since it's a
  structural addition beyond the literal "list/create/edit/delete users" ask.
- Route guard: an authenticated-route guard (already implied by Dev-3/Dev-6a's
  session handling) plus a permission guard on the `/users/**` route tree
  specifically — a user without the manage-users permission must not be able to
  reach these routes by direct URL, not just have the nav link hidden (defense in
  depth; a hidden nav link is not access control).

**Information architecture**: sidebar item "Users" (or "Team"/"Members" — pick one
consistent label; "Users" is recommended since it matches the API/FR naming and
avoids ambiguity with "Team" implying a different collaboration concept the product
doesn't have), positioned after the dashboard's primary nav items. Route tree:
`/users` (list, §4.1), `/users/new` (create, §4.3), `/users/:id` (detail/edit, §4.2).

### 4.1 User list screen (`/users`)

**Flow**:
1. Tenant Admin reaches this via the sidebar "Users" item.
2. Table loads via the list endpoint with default paging, no filter, default sort
   (whatever the API's default order is — presumably `createdAt desc` or `email
   asc`; confirm against the real contract, flagged below).
3. Admin can search (a debounced text input above the table, searching name/email —
   confirm which fields the API's search actually matches against and reflect that
   in placeholder text, e.g. "Search by name or email"), sort by clicking column
   headers (`mat-sort` bound to whatever `sortBy`/`sortDir` params the API exposes —
   unlike §3.1's tenant list, FR-IAM-7 explicitly requires sort, so build real
   server-driven column sorting here, not the "ship unsorted" fallback §3.1 used),
   and paginate (`mat-paginator`, same pattern as §3.1).
4. Row actions: "View/Edit" (single combined screen, §4.2) and "Delete" (§4.5),
   plus the active/inactive state visible inline (see badge below).
5. Primary action: "Create user" button (top-right, filled — one primary action per
   §1c) → create flow (§4.3).
6. Exit: sidebar nav elsewhere, or into a row's detail screen.

**States** (same shape as §3.1 — reuse, not reinvent):
- **Loading (initial)**: skeleton table rows.
- **Loading (search/sort/page change)**: dim existing rows + inline spinner overlay,
  not a full skeleton flash, matching §3.1's refresh treatment.
- **Empty (no users at all)**: this should be structurally rare (a tenant always has
  at least the seeded admin), but still handle it defensively — centered empty-state
  block, "No users found." + "Create user" CTA. Do not word this as if it's an
  expected first-run state the way §3.1's "no tenants yet" is.
- **Empty (search/filter yields zero)**: "No users match your search." + a "Clear
  search" action, no "Create user" CTA here (same non-sequitur logic as §3.1).
- **Error** (list fetch fails): inline error block + retry, same pattern as §3.1.
- **Success**: table populated.

**Table columns**: Name (firstName + lastName combined, primary/bold text), Email
(secondary text under or beside name — or its own column if width allows; either is
acceptable, but email must always be visible without an extra click since it's the
primary identifier admins will scan for), Roles (rendered as a compact chip list —
`mat-chip` per role name, wrapping or truncating with a "+N more" affordance if a
user has many roles — not a plain comma-joined string, since roles are the one
piece of data this screen exists to let the admin manage and deserve visual
distinction), Status (Active/Inactive — reuse the `StatusBadgeComponent` pattern
from §3.1a: green `check_circle`/"Active" vs. neutral-gray `block` or `pause_circle`
/"Inactive", never color-only), Last login (relative + absolute-on-hover, same
treatment as §3.1's "Created" column; show "Never" as plain text if `lastLoginAt` is
null — not a blank cell), Actions (View/Edit, Delete — Delete visually distinct/
de-emphasized relative to View per §1c's destructive-action-distinction rule, e.g. a
plain icon button in an error-tinted state only on hover/focus, or tucked in a
`mat-menu` overflow next to a plain "View" button).

**Sorting**: unlike §3.1's tenant list, FR-IAM-7 explicitly specifies sort as part
of this feature — implement real server-driven sorting on whichever columns the API
exposes as sortable (likely name/email/createdAt/lastLoginAt; confirm exact
`sortBy` enum against the real contract, flagged below). Persist sort/search/page
state in the URL query string, same rationale as §3.1's pagination persistence.

**Mobile degradation**: below 599.98px, same stacked-card pattern as §3.1/§3.5 —
one card per user: name + status badge prominent, email as secondary text, role
chips wrapped below, actions in a `mat-menu` overflow. Search/sort controls
collapse to a single search input with sort exposed via a `mat-select` ("Sort by:")
rather than clickable column headers, since there are no visible column headers in
card view.

### 4.2 User detail/edit screen (`/users/:id`)

**Flow**:
1. Entered via the list's row/"View" action or direct URL.
2. Fetches the user record.
3. A single screen serves both **view** and **edit** — no separate read-only mode
   toggle is required by the spec; the recommended pattern (consistency with a
   standard admin-dashboard edit form, and simplicity) is: fields render as an
   editable form immediately (not gated behind an explicit "Edit" button click),
   with "Save"/"Cancel" always visible, matching the admin-dashboard template's
   common convention. If `nexus-dev` prefers a view-then-edit-toggle pattern
   instead (lower risk of accidental edits), that's an acceptable alternative —
   pick one and apply it consistently to any future tenant-admin edit screens, not
   a per-screen choice.
4. Fields editable: firstName, lastName, phone, occupation, companyName, country
   (all optional/free-text or a country select per whatever input type Dev-6a's own
   self-service profile screen already uses — reuse that exact component, don't
   reinvent a second country picker), roles (multi-select, see below), isActive
   (toggle, see below). Email is **read-only display** here (not an editable
   field — FR-IAM-7 doesn't mention admin-editable email, and changing a login
   identifier administratively is exactly the kind of decision this document
   won't silently assume without an FR backing it; flagged below for `nexus-dev`
   to confirm against the real contract whether the update endpoint even accepts
   an email field). No avatar/profile-photo control on this screen (out of scope
   per the dispatch context — that's the user's own self-service surface).
5. Save → success → snackbar confirmation ("User updated."), remain on the screen
   with the saved values reflected (don't navigate away — the admin may want to
   make further edits, e.g. also adjust roles right after saving a name change).
6. Cancel → discard in-progress edits, revert fields to last-fetched values (a
   confirm-before-discard prompt is not required here since this isn't a
   multi-step/destructive action, but if the form has unsaved changes and the admin
   navigates away via the browser back button or a nav link, a lightweight
   "Discard unsaved changes?" browser-native `beforeunload`-style guard is a
   reasonable, spec-compatible addition — not mandatory).
7. Exit: "Back to users" link/breadcrumb → list, preserving prior list state
   (search/sort/page), same as §3.2's back-navigation rule.

**Role-assignment control**: a `mat-select` with `multiple` (a multi-select
dropdown, standard Material pattern for "assign several from a bounded set") rather
than a full chip-input/autocomplete, since roles are a small, closed, tenant-scoped
set (not free text) — listing all available role names as checkable options,
showing currently-assigned roles pre-selected. Communicating "this is a protected
system role" (Tenant Admin/Member, `isSystem: true` per Dev-4's RBAC model): append
a small lock icon + "(system role)" suffix text next to those two options in the
dropdown list (icon + text, not color alone, per §1b) — this is purely
informational here, **not a disabled option**, since a Tenant Admin must remain
able to assign/unassign the Tenant Admin and Member roles to/from users (that's the
whole point of this screen); the "protected" property that matters at this layer is
that the *last* Tenant Admin can't have the role removed (enforced server-side,
surfaced as `LAST_ADMIN_PROTECTED`, see below) — not that the role itself can't be
touched. Selected roles render as a summary of chips below/inside the closed
select (Material's default multi-select chip-summary behavior) so the current
assignment is scannable without opening the dropdown.

**Active/deactivate toggle**: a `mat-slide-toggle` labeled "Active" (on) /
"Inactive" (off), inline near the top of the form (not buried at the bottom) since
this is a high-visibility state, not an incidental field. Deactivating a user via
this toggle is a meaningful action (an active user losing access) — apply the same
confirm-before-destructive-state-change logic §3.4 used for tenant Suspend: **show
a confirm dialog when flipping the toggle from Active → Inactive** ("Deactivate
'{name}'? They will no longer be able to sign in."), **no confirm needed** for
Inactive → Active (reversing a deliberate prior action, matching §3.4's
Activate-needs-no-confirm rationale). If the toggle is part of the same form as the
other editable fields (rather than firing its own immediate API call), the confirm
dialog fires on toggle-click before the switch visually commits, and the actual
deactivation only takes effect on the form's "Save" — pick whichever of these two
patterns (toggle-fires-immediately vs. toggle-is-part-of-the-saved-form) matches
the real API contract's granularity (one combined update endpoint vs. a separate
activate/deactivate endpoint), flagged below for `nexus-dev` to confirm.

**Field-level vs. form-level error mapping**:
| Error code | Where it can occur | Placement |
|---|---|---|
| `404 USER_NOT_FOUND` | On load (deleted/bad id since page-load), or on save if the user was deleted by someone else mid-edit | Full-screen "User not found" replacement (on load, same pattern as §3.2's tenant-not-found) or, if it happens on save, a form-level banner: "This user no longer exists. It may have been deleted." + a link back to the list (not a per-field error — nothing about the form fields is wrong) |
| `404 ROLE_NOT_FOUND` | On save, if a selected role was deleted concurrently by someone managing roles elsewhere | Per-field error on the role multi-select: "One or more selected roles no longer exist. Refresh and try again." — plus auto-refresh the role option list so the stale option is removed |
| `409 LAST_ADMIN_PROTECTED` | On save, if the edit would remove the Tenant Admin role from (or deactivate) the tenant's last remaining Tenant Admin | Per-field error on the role multi-select (if triggered by role removal) or a form-level banner (if triggered by the active-toggle) — see dedicated copy guidance below, this is not a generic error |

**`LAST_ADMIN_PROTECTED` copy** (applies identically here and in §4.5's delete
flow — this is explicitly *not* a generic 409, it should explain why and suggest
the fix, per the dispatch context):
> "This tenant must always have at least one Tenant Admin. Assign another user as
> Tenant Admin first, then try again."

Render this as a non-dismissible-until-acknowledged inline banner/alert directly
above the role select or the active toggle (whichever triggered it), not a bare
toast — the admin needs to read and act on it, matching §1c's alerts/banners rule
for errors requiring the user's attention.

**Accessibility** (beyond §1b/§3.2 baseline):
- Role multi-select: `mat-select[multiple]` inherits Material's ARIA listbox
  pattern; ensure the "(system role)" annotation is read by screen readers (part of
  the option's accessible name/description, not a sibling element a screen reader
  would skip).
- The active/inactive toggle's confirm dialog: standard `mat-dialog` focus-trap
  behavior (§3.3's dialog a11y notes apply identically).
- Save success/error announced via the same `aria-live` snackbar/banner conventions
  established in §2/§3.

**Relevant heuristics**: error prevention + user control & freedom (confirm before
deactivating); help users recognize/diagnose/recover from errors
(`LAST_ADMIN_PROTECTED`'s explain-and-suggest-fix copy is the direct application of
this heuristic); consistency & standards (reusing the exact list/detail/confirm
patterns §3 already established rather than inventing tenant-realm-specific
variants).

**Responsive behavior**: single-column stacked form on mobile (standard Material
form responsive behavior — no table involved on this screen), role multi-select and
toggle remain full-width, Save/Cancel buttons stack or remain side-by-side per
available width (either acceptable).

### 4.3 Create-user screen/flow (`/users/new`)

Same route-vs-modal judgment call as §3.3 applies (dedicated route recommended here
for consistency with the detail screen also being a dedicated route, and because
this form is a bit longer than tenant-create's 3 fields).

**Flow/fields**:
1. Triggered by the list's "Create user" button.
2. Fields: email (required), firstName, lastName (required per standard identity
   fields — confirm exact required-field set against the real create-user DTO,
   flagged below since FR-IAM-7's spec text doesn't enumerate which of
   phone/occupation/companyName/country are required vs. optional at creation time;
   this document assumes only email/firstName/lastName are required and the rest
   are optional, matching Dev-6a's presumed self-registration field requirements),
   phone/occupation/companyName/country (optional, same components as §4.2), **an
   optional temporary password field**, and an **optional initial role
   multi-select** (same control as §4.2's, pre-selecting nothing by default —
   an admin who wants the new user to have no roles yet, e.g. just "Member" via a
   tenant default, should be able to leave this empty rather than being forced to
   pick one).
3. **Temporary password field UX**: rendered as an optional password input with
   clear helper text under it: "Leave blank to generate a secure temporary
   password automatically." A show/hide toggle (same pattern as §2.1's optional
   login password toggle) if the admin does type one in. If the admin supplies a
   password, it is validated client-side against the same password-strength rules/
   checklist described in §2.2 (reusing that component, not rebuilding it) and
   server-side as `400 WEAK_PASSWORD` with the same per-field-error copy-passthrough
   treatment as §2.2.
4. Submit → success (`201`) → **the response includes the effective temporary
   password once** (whichever was used — admin-supplied echoed back is unnecessary
   since the admin already knows it, but if the admin left the field blank, the
   generated placeholder must be surfaced now since it is genuinely
   non-retrievable afterward). See the dedicated one-time-reveal pattern below.
5. After the one-time-password step is dismissed/copied, navigate to the new
   user's detail screen (§4.2) — consistent with §3.3's "land on the newly created
   resource's detail screen" pattern — with a snackbar confirmation ("User
   created.").
6. Failure (`409 EMAIL_ALREADY_REGISTERED`, `400 WEAK_PASSWORD`, `404
   ROLE_NOT_FOUND` if an initial role selection references a role deleted between
   page-load and submit): form remains open, per-field errors:
   - `EMAIL_ALREADY_REGISTERED`: per-field on email — "An account with this email
     already exists." (no "log in instead" link here, unlike §2.2's registration
     case — the admin isn't the account owner, so redirecting to login is a
     non-sequitur; instead, offer a plain text hint: "If this is an existing
     user, find them in the user list instead of creating a new account.")
   - `WEAK_PASSWORD`: per-field on the temporary-password field, same rule-naming
     copy convention as §2.2.
   - `ROLE_NOT_FOUND`: per-field on the role multi-select, same copy as §4.2's
     table row, plus auto-refresh the role option list.

**One-time temporary-password reveal (novel state — genuinely new, not a
restatement of any existing pattern)**:

This is the one moment in the product where a secret is shown to someone other
than its owner, and it is **never retrievable again** after this screen is left —
the UX must treat it with the weight that implies, not as an incidental success
message:
- On successful create, present the generated (or admin-supplied) temporary
  password in a **dedicated, visually distinct panel** (not folded into a snackbar
  toast, which auto-dismisses and cannot be the home for a value someone needs to
  copy) — e.g. an inline alert-styled card at the top of the newly-created user's
  detail screen, or a step within the create flow before navigating away. Content:
  - Label: "Temporary password" (or "Temporary password (generated)" if it was
    auto-generated, vs. no qualifier if the admin supplied their own — distinguish
    the two so the admin isn't confused about whether this matches what they typed).
  - The password value itself, rendered in a monospace font for unambiguous
    character legibility (distinguishing 0/O, l/1, etc. — a real usability concern
    for a value someone will need to type or relay accurately).
  - A **copy-to-clipboard button** (icon button, `content_copy` Material Symbol,
    `aria-label="Copy temporary password"`) adjacent to the value — this is the
    primary interaction, not an incidental nicety, since the whole point of this
    state is enabling accurate relay of a value that won't be shown again.
  - Explicit warning copy directly in the panel: "Copy this password now and share
    it with the user through a secure channel. It won't be shown again." — stating
    the non-retrievability plainly, not leaving the admin to infer it.
  - A dismiss action ("I've copied this" / "Done") that the admin must click to
    close the panel — don't let it auto-dismiss on a timer or on background click,
    since accidentally losing it before copying would have no recovery path other
    than resetting the user's password through a separate flow.
- **This is not merely a visual affordance** — it needs to work for a screen-reader
  user with the same guarantees:
  - On reveal, the panel's appearance must be announced via `aria-live="assertive"`
    (this is a one-time, must-not-miss piece of information appearing after a page
    transition/form submit with no other cue — assertive is warranted here, unlike
    most success confirmations, precisely because missing it means the information
    is permanently lost, not just delayed).
  - The password value itself should be exposed as readable text to assistive
    technology (not, e.g., rendered as an image or obscured behind a masked-input
    pattern requiring an extra reveal click — there's no "hide" state needed here
    since this is a one-time disclosure to the person who is supposed to see it,
    unlike a normal password field).
  - The copy button's success feedback ("Copied!") must also be announced (a small
    `aria-live="polite"` confirmation adjacent to or replacing the button label
    briefly) — a sighted user sees a checkmark/tooltip flash; a screen-reader user
    needs the equivalent spoken confirmation that the copy actually happened before
    they navigate away.
  - Focus should move into this panel when it appears (e.g. onto the copy button
    or the panel's heading) so a keyboard/screen-reader user lands on it
    immediately rather than having to hunt for it after the create form
    disappears.

**Accessibility (create form fields, beyond the above)**: same `mat-form-field`/
`autocomplete` conventions as §2.2 (`autocomplete="new-password"` on the temporary
password field), first-invalid-field focus movement on validation failure, live
password-strength checklist if reused.

**Relevant heuristics**: help users recognize/diagnose/recover from errors
(explicit non-retrievability warning prevents the far worse failure of an admin
realizing *after* leaving the screen that they never copied the password); error
prevention (the explicit "Copy this now" framing before allowing dismissal);
visibility of system status (the `aria-live="assertive"` reveal announcement).

### 4.4 (reserved — intentionally left for role-CRUD if it lands later)

Not applicable this phase — role CRUD is out of scope per the dispatch context
(RBAC/Dev-4 already shipped it elsewhere); this section number is skipped to avoid
renumbering collisions if a future phase adds a dedicated roles-management screen
inside this same tenant-admin nav area.

### 4.5 Delete-user flow

**Confirm dialog** (required — hard delete, irreversible, per §1c/§3.4's
destructive-action-confirmation rule, and doubly warranted here since this is a
*hard* delete, not the reversible suspend/soft-delete patterns §3 dealt with):
> "Delete '{name}' ({email})? This permanently removes their account and cannot be
> undone. Their exam attempts and curricula history will be retained for
> reporting, but will show as 'deleted user' instead of their name."

The second sentence is deliberately included (not just a generic "cannot be
undone") because FR-IAM-7 specifies exactly this retained-but-attributed-to-
"deleted user" behavior — telling the admin what *does* survive is directly useful,
non-obvious information that changes whether they'd expect a full trace to vanish
elsewhere in the product (recognition over recall + trust-building specificity,
beats a generic "this cannot be undone" that leaves the admin guessing what "this"
covers).

Dialog actions: "Cancel" / "Delete" (the delete button styled with
`--el-color-error` per §1c's destructive-action convention, not a neutral filled
button).

**`409 LAST_ADMIN_PROTECTED` on delete** — same non-generic treatment as §4.2's
version, but as a *rejection of the delete attempt* rather than a form error since
there's no form here:
- Do not let the confirm dialog itself silently fail/close on this error. Replace
  the dialog's content in place (keep it open) with the explanation, or close the
  confirm dialog and immediately show a **non-dismissible-by-accident inline
  banner or a follow-up dialog** on the list/detail screen with the same copy as
  §4.2:
  > "This tenant must always have at least one Tenant Admin. Assign another user
  > as Tenant Admin first, then try again."
- Do not word this as a bare "Cannot delete this user" — the admin needs the
  *reason* and the *fix* in the same message, matching the dispatch context's
  explicit instruction that this is not a generic error.
- After dismissing this message, the admin remains on the list (row unchanged,
  since nothing was deleted) — no navigation, no partial-state ambiguity.

**Other delete-time errors**: `404 USER_NOT_FOUND` (someone else already deleted
this user between page-load and this click) → snackbar ("This user was already
removed.") + remove the row from the list in place / redirect away from the detail
screen if triggered there, rather than a blocking error dialog — this is a benign
race, same treatment philosophy as §3.4's `INVALID_TENANT_STATE` race handling.

**Success**: row removed from the list (re-fetch the page rather than hand-rolling
a client-side splice, consistent with §3's server-truth-over-optimistic-mutation
convention) + snackbar ("User deleted.").

**Accessibility**: standard `mat-dialog` a11y (focus trap, initial focus on
"Cancel" — the non-destructive default action — not "Delete", per common
destructive-confirm-dialog convention to avoid an accidental double-Enter deleting
something); the `LAST_ADMIN_PROTECTED` follow-up message needs the same
`aria-live`/focus-movement treatment as any other error banner in this document.

**Relevant heuristics**: error prevention + user control & freedom (the confirm
dialog, defaulting focus away from the destructive action); help users recognize/
diagnose/recover from errors (`LAST_ADMIN_PROTECTED`'s explain-and-fix copy, again).

### 4.6 Copy summary addendum (this feature)

| Condition | Placement | Copy |
|---|---|---|
| List: no users at all | Empty-state block | "No users found." |
| List: search/filter yields zero | Empty-state block | "No users match your search." |
| List/detail fetch failure | Inline error block | "We couldn't load users. Try again." / "We couldn't load this user. Try again." |
| Create: `EMAIL_ALREADY_REGISTERED` | Per-field (email) | "An account with this email already exists." + "If this is an existing user, find them in the user list instead of creating a new account." |
| Create/edit: `WEAK_PASSWORD` | Per-field (password) | Same rule-naming pass-through as §2.2 |
| Create/edit: `ROLE_NOT_FOUND` | Per-field (role select) | "One or more selected roles no longer exist. Refresh and try again." |
| Edit/delete: `LAST_ADMIN_PROTECTED` | Form-level banner (edit) / follow-up banner (delete) | "This tenant must always have at least one Tenant Admin. Assign another user as Tenant Admin first, then try again." |
| Edit: `USER_NOT_FOUND` (on save) | Form-level banner | "This user no longer exists. It may have been deleted." |
| Delete confirm dialog | Modal body | "Delete '{name}' ({email})? This permanently removes their account and cannot be undone. Their exam attempts and curricula history will be retained for reporting, but will show as 'deleted user' instead of their name." |
| Delete: `USER_NOT_FOUND` (race) | Snackbar | "This user was already removed." |
| Delete success | Snackbar | "User deleted." |
| Create success | Navigate to detail + snackbar | "User created." |
| One-time temp-password panel warning | Inline panel, permanent until dismissed | "Copy this password now and share it with the user through a secure channel. It won't be shown again." |
| Deactivate confirm dialog | Modal body | "Deactivate '{name}'? They will no longer be able to sign in." |

---

## Open items / flags for `nexus-dev`

1. **UI kit decision (§1b)**: Angular Material + CDK recommended and assumed
   throughout this document; not yet installed in `apps/web/package.json`. If a
   different kit is chosen instead, this document's component-level guidance
   (`mat-form-field`, `mat-error`, `MatSnackBar` a11y behavior) needs a
   corresponding rewrite before Login/Register are built.
2. **Public/marketing site (§1a)** remains unclassified — out of scope for this
   dispatch and for the MVP backlog as currently specified; flag again if a future
   phase introduces one.
3. **Post-registration behavior (§2.2 step 3)**: this document specifies the *UX*
   requirement (no dead-end success screen) but the actual choice between
   auto-login-with-token vs. redirect-to-login depends on what Dev-3's actual
   `/auth/register` response contract does — confirm against the real API response
   shape when building, not just this document's illustrative wording.

### Flags added with §3 (Platform Admin Console, Dev-5b)

4. **Mid-provisioning failure response shape (§3.3 steps 6/8)**: this document
   assumes `POST /api/platform/tenants` can come back two distinguishable ways on
   failure — (a) a hard rejection where nothing was created (`400`/`409` validation
   codes, or `500 TENANT_PROVISIONING_FAILED`), vs. (b) a "success-shaped" response
   where a tenant row exists but its `status` is `Failed`. Confirm the exact real
   shape/status-code Dev-5a's implementation actually returns for case (b) — a `201`
   with `status: Failed` in the body, or something else — before building the
   success-vs-failure branching in the create form, since the UI's whole "don't treat
   a partially-created tenant as a rejected form submission" behavior depends on
   being able to tell these two cases apart reliably.
5. **Retry endpoint's actual synchronicity (§3.4)**: `POST
   .../provisioning/retry` returns `202`, which reads as "accepted, may still be
   running," in contrast to `POST /tenants` which is described as fully synchronous.
   Confirm whether retry actually completes the whole workflow before responding
   (in which case a single re-fetch after the call suffices, same as create) or
   genuinely returns before completion (in which case the UI needs to poll
   `GET .../:id` until status leaves `Provisioning`). Building against the wrong
   assumption produces either an unnecessary polling loop or a stale "still
   provisioning" badge shown after the workflow has actually finished.
6. **Missing "warning/amber" palette token**: §1c's palette table has no token for
   a neutral-warning tone, which §3.1a's `Suspended` badge needs to stay visually
   distinct from both `Active` (success) and `Failed` (error) without relying on
   icon alone. Recommend adding `--el-color-warning`/`--el-color-warning-container`
   to the Material theme tokens (small, additive change) rather than reusing
   `--el-color-secondary` (reserved for a different purpose per §1c) or improvising
   an inline color.
7. **No sort parameter on `GET /api/platform/tenants` (§3.1)**: the list is
   specified with pagination but no `sort`/`sortBy` query param. This document
   deliberately does not add client-side column sorting (it would misrepresent
   cross-page ordering). If sortable columns are wanted later, that's a backend
   contract addition, not a frontend-only feature.
8. **`INVALID_SUBDOMAIN`'s exact accepted pattern/reserved-word list (§3.3)**: the
   copy guidance given is a reasonable placeholder ("lowercase letters, numbers, and
   hyphens"); Dev-1's actual subdomain validator (already built, per
   `docs/NEXUS_STATE.md`'s Dev-1 entry, including the reserved-subdomain list) is the
   source of truth and should be reflected exactly, including surfacing a distinct
   message if the specific rejection reason is a reserved word vs. a format
   violation, if the API differentiates those (currently believed to share one code).

### Flags added with §4 (Tenant Admin — User Management, Dev-6b)

9. **No tenant-realm authenticated shell exists yet (§4.0)**: Dev-3/Dev-6a shipped
   only a bare, unguarded placeholder dashboard with no sidenav/nav chrome. This
   document specifies building one now (mirroring `platform-shell`), wrapping every
   authenticated tenant-app route going forward, not just `/users/**` — a
   structurally larger change than "add a user-management screen." Confirm this
   scope is acceptable for Dev-6b rather than a separate/later phase.
10. **Required vs. optional fields on user creation (§4.3)**: FR-IAM-7's spec text
    doesn't enumerate which of phone/occupation/companyName/country are required at
    admin-creation time. This document assumes only email/firstName/lastName are
    required, mirroring Dev-6a's self-registration field set — confirm against the
    real create-user DTO before building.
11. **Whether the update endpoint accepts an email change (§4.2)**: this document
    treats email as read-only on the edit screen since FR-IAM-7 doesn't mention
    admin-editable email and changing a login identifier is a decision this
    document won't assume without spec backing — confirm against the real contract.
12. **Toggle-fires-immediately vs. toggle-is-part-of-saved-form for
    activate/deactivate (§4.2)**: depends on whether the real API exposes a
    separate activate/deactivate endpoint or only a combined user-update endpoint —
    confirm before building the confirm-dialog's exact trigger point.
13. **Sortable-column enum on the user list (§4.1)**: FR-IAM-7 requires sort
    (unlike §3.1's tenant list, which has none), but the exact `sortBy` values the
    API exposes aren't enumerated in the spec text consulted for this document —
    confirm against the real contract before wiring `mat-sort`.

---

## 5. Feature: Tenant Branding — Registration Settings & FR-MT-10 Theming (Dev-7 / BL-07)

This dispatch is a **blocking, foreground prerequisite** for Dev-7: HLD §14a item 5
and `docs/NEXUS_STATE.md` require `nexus-ux` to publish concrete light/dark surface
hex values before the FR-MT-10 server-side contrast check (LLD §9.11) can be
implemented against real constants. §5.1 resolves that; §5.2–§5.4 cover the rest of
Dev-7's user-facing surface (branding settings screen, logo-URL field, and
`auth-shell`'s consumption of the resolved brand).

### 5.1 `THEME_SURFACE_LIGHT` / `THEME_SURFACE_DARK` — final values

**Decision: the interim placeholders are CONFIRMED AS FINAL, unchanged.**

| Constant | Final value | Rationale |
|---|---|---|
| `THEME_SURFACE_LIGHT` | `#FFFFFF` | Matches Material Design's own baseline light-theme surface (elevation-0 surface = white), and is consistent with §1c's `--el-color-surface` direction ("neutral off-white / light-gray scale") — the tenant app's actual rendered card/background surface in the light theme the product ships is at or extremely close to white at its highest/base elevation, so `#FFFFFF` is the correct worst-case (least forgiving) light anchor for a contrast check: any accent that passes against pure white passes against every slightly-tinted `--el-color-surface` variant actually in use, since off-white tints only ever move *toward* white, never away from it. Using the literal whitest value the UI can present, rather than a slightly grayed token value, is deliberately conservative — it never lets a tenant pick an accent that would then fail against a genuinely-white card/modal background that a slightly-off-white anchor would have missed. |
| `THEME_SURFACE_DARK` | `#121212` | This is Material Design's own documented canonical dark-theme base surface color (Material's dark theme spec fixes elevation-0 surface at `#121212`, not pure black, specifically because pure black causes halation/eye-strain and defeats elevation shading). §1c's baseline explicitly reserves a "dark-surface slot" in the surface token scale without assigning it a value yet ("dark mode is not in MVP scope... don't hardcode colors in a way that blocks it later") — this is that assignment. Per the dispatch's framing, this is a **forward-looking contrast guarantee, not a dark-mode UI feature**: no dark-mode toggle ships this phase, but adopting Material's own canonical dark-surface value now means that whenever dark mode *does* ship (post-MVP), no tenant's already-accepted accent color silently becomes non-compliant against a different, not-yet-decided dark value — the contrast guarantee is locked in at the same time as the accent itself, not retrofitted later. |

Both values are **literal, final, server-side constants** as of this dispatch — not
aspirational placeholders. `nexus-dev` should treat `docs/architecture/LLD.md` §2's
env-var table row for these two vars as now satisfied (the "must be replaced with
`nexus-ux`'s published baseline values" note against that row is resolved: the
existing default values are the published values, no code change to the defaults is
required) and remove the "HLD §14a item 5" blocking annotation once Dev-7 lands.
`ACCENT_CONTRAST_MIN_RATIO=3.0` (WCAG 2.2 AA non-text minimum, already correct) is
unaffected.

**No other runtime theming surface is implied by this decision** — confirming these
two constants does not reopen §1c's "no primary/secondary override" scope boundary
(FR-MT-10, spec §9.3) or suggest a dark-mode UI is imminent; it only makes the
existing light-mode-only UI's contrast guarantee correct against both anchors a
tenant's accent could ever eventually render on.

### 5.2 Branding settings screen (`/settings/branding`, new tenant-admin surface)

**Surface**: Tenant application (§1a), inside `tenant-shell` (§4.0) — same shell,
sidenav, permission-gating pattern as §4's user management, not a new shell. Gated by
the `tenant.settings.manage` permission (nav item hidden if absent, route guarded by
`permissionGuard('tenant.settings.manage')` — same defense-in-depth pattern as §4.0's
`/users/**` guard: a hidden nav link is not access control).

**Information architecture**: sidebar item "Settings" (a new top-level nav section —
if other tenant settings exist/are planned, this screen is a tab/sub-route under it,
e.g. `/settings/branding`, `/settings/registration`, so registration settings (also
in scope for Dev-7 per BL-07) and branding are visually grouped as siblings under one
"Settings" nav entry, not two unrelated top-level nav items). Positioned after "Users"
in the sidebar order (§4.0).

**Flow**:
1. Tenant Admin reaches this via Settings → Branding.
2. Fetches current config (`accentColorOverride`, `logoUrl` — both nullable) via
   `GET` on the tenant's own settings endpoint.
3. Two independent fields, each with its own save affordance is **not** recommended
   (would create a confusing "which save button did what" state for two fields that
   conceptually belong to one "Branding" settings form) — build this as **one form
   with one "Save changes" action**, submitting both fields together, consistent with
   §1c's one-filled-primary-button-per-screen rule. A field-level "Reset to default"
   action on the accent-color field specifically (§5.2.3) is the one exception,
   since it's framed as an immediate, idempotent action distinct from "save."
4. Exit: standard tenant-shell nav (no dead-end — this is a persistent settings
   screen, not a wizard/modal).

#### 5.2.1 Accent color field

- **Input**: a text field accepting a 6-digit hex string (with or without a leading
  `#` — strip/normalize client-side before submit, mirroring LLD §9.11's
  `normalizeHex`), **plus** a native color-picker affordance (`<input type="color">`
  or a Material/CDK color-swatch picker) alongside it — text entry alone is
  sufficient to satisfy the requirement, but a visual picker is a meaningful,
  low-cost usability improvement for a color value and is recommended.
- **Live preview** (required by this dispatch): render a small preview block *inside
  this screen* showing the candidate accent color applied to representative sample
  UI chrome — at minimum a sample filled button ("Save changes", using the candidate
  color, not the real button, to avoid the jarring effect of the actual submit
  button changing color as the admin types) and a sample link/text-accent example.
  This preview updates **live as the admin types/picks**, before submission — this is
  client-side, cosmetic-only preview and must not be confused with server-side
  validation: the preview shows what the color *would* look like even if it would
  fail the contrast check, since the preview's job is "see the color," not
  "pre-validate the color." Do not attempt to replicate LLD §9.11's contrast
  algorithm client-side to gate the preview or to pre-empt the server error — per
  LLD §10.2's explicit design ("the server has already validated contrast, the
  client performs no contrast check"), contrast is exclusively a server concern; the
  preview is purely visual and the validation errors below are the only place
  contrast is enforced or reported.
- **Validation-error state — malformed hex** (`INVALID_COLOR_FORMAT`): per-field
  `mat-error` below the input (same convention as §2/§4's forms):
  > "Enter a valid 6-digit hex color, e.g. #3949AB."
  Also apply basic client-side format pre-validation (does it match `^#?[0-9A-Fa-f]{6}$`
  after trim) before submit, purely to save an avoidable round-trip on an obvious
  typo — this duplicates, not replaces, the server's `normalizeHex` check.
- **Validation-error state — insufficient contrast** (`INSUFFICIENT_COLOR_CONTRAST`):
  per-field `mat-error`, and this is the one place in the product where the **exact
  server-returned numbers must be surfaced verbatim**, not paraphrased — LLD §9.11
  returns `{ratio, required, failingSurface}` specifically so the message can be
  actionable:
  > "This color doesn't have enough contrast. It measures {ratio}:1 against the
  > {failingSurface} surface — {required}:1 is required. Try a darker/lighter
  > shade." (e.g. "It measures 2.31:1 against the dark surface — 3:1 is required.")
  The "darker/lighter" hint should pick the correct direction based on whether the
  candidate color is lighter or darker than the failing surface (a color failing
  against a light surface generally needs to go darker, and vice versa for the dark
  surface) — a small, worthwhile touch since the two surfaces can fail in opposite
  directions and generic advice would be actively unhelpful for one of them. If
  determining direction reliably isn't feasible from the client alone, drop the
  suggestion clause and keep the ratio/required/failingSurface sentence, which is
  the load-bearing part per LLD §9.11's own reporting rule ("never silently applied
  or silently clamped").
- **Save/success state**: standard submit-button spinner + disable pattern (§1c),
  `MatSnackBar` confirmation ("Branding updated.") on success, form remains on
  screen showing the newly-saved value (not a redirect elsewhere — this is a
  persistent settings screen, per "recognition over recall": the admin should see
  their own current setting reflected back, not wonder if it saved).
- **"Reset to default" (clear override) action**: a distinct, secondary (text/link
  style, not filled — §1c) button/link adjacent to the accent field, e.g. "Reset to
  default color." Per LLD §9.11 and spec FR-MT-10, clearing is **idempotent and
  always succeeds** — this action requires **no confirmation dialog** (unlike §3.4's
  suspend action): it is non-destructive to any user-facing data, trivially
  reversible (the admin can immediately set a new override), and over-confirming a
  safe, reversible action is itself a heuristic violation (flexibility & efficiency
  of use) — do not add a confirm step here even though it superficially resembles
  §3.4's "destructive action" pattern; it isn't one. On click: fires immediately
  (`accentColorOverride: null`), clears the input, updates the live preview back to
  the platform default accent, shows a `MatSnackBar` ("Accent color reset to
  default.").

#### 5.2.2 Logo URL field

Per this dispatch's explicit note, logo is a **plain URL string field in this phase
only** — no file upload (that's BL-19's signed-delivery infrastructure, not yet
built). This is a deliberate, temporary scope boundary the UI must reflect honestly,
not paper over with upload-style affordances:

- **Input**: a plain text field, label "Logo URL", helper text: "Paste a direct link
  to your logo image (PNG, JPG, or SVG)." No drag-and-drop zone, no "Upload" button,
  no file-picker — those would misrepresent what this phase actually does and set an
  expectation BL-19 hasn't shipped yet.
- **Live preview**: render an `<img>` preview of the current field value (debounced,
  e.g. 500ms after the admin stops typing, not on every keystroke) inside the
  settings screen so the admin can confirm the URL resolves to the logo they intend
  before saving.
  - **Image-load-failure state**: if the previewed `<img>` fails to load (broken
    URL, wrong content type, CORS-blocked host, 404, etc.), replace the preview with
    a neutral broken-image placeholder block + inline text: "We couldn't load an
    image from this URL. Double-check the link and try again." — this is a
    client-side, informational state (the browser's own `img.onerror`), **distinct
    from a server-side validation error**: the field is not necessarily invalid per
    the server's rules (the server likely only checks it's a plausible URL shape,
    not that it currently resolves to a loadable image, since a temporarily-down
    image host shouldn't hard-block saving a settings form) — so this state should
    **not** block the Save button; it's a warning, not a validation failure. Treat it
    as "help the admin catch their own mistake before saving," not "the form is
    invalid."
  - **Empty state**: no preview block shown at all when the field is empty (not a
    broken-image placeholder) — an empty logo URL is a valid, expected state (falls
    back to the tenant-name/generic mark per §2's existing auth-shell fallback), not
    an error.
- **Validation-error state — malformed URL** (if the server returns a distinct
  `INVALID_LOGO_URL`-class error, or reuses `VALIDATION_FAILED` — confirm the actual
  error code against Dev-7's real contract, flagged below): per-field `mat-error`:
  > "Enter a valid URL, e.g. https://example.com/logo.png."
  Basic client-side URL-shape pre-check (valid absolute URL, `http`/`https` scheme)
  before submit, same error-prevention rationale as the accent field's format
  pre-check.
- **"Reset to default" for the logo**: clearing the field to empty and saving is the
  reset mechanism (no separate "reset" button needed here, unlike the accent color,
  since a plain text field's own native clear/backspace is already the natural
  "unset" interaction — adding a second button would be redundant for a single
  string field, whereas the accent field's picker/swatch UI benefits from an
  explicit reset affordance since there's no obvious "clear the color picker"
  gesture).

#### 5.2.3 Accessibility (beyond §1b baseline)

- The live accent-color preview block must have a text label ("Preview") and must
  not be the *only* place a screen-reader user can determine the field's current
  value — the hex value in the text input itself remains the authoritative,
  accessible source of truth; the preview swatch is a visual supplement.
- `<input type="color">`, if used, must have a proper associated `<label>` (Material
  form-field wrapping, or an explicit `aria-label` if the native color input isn't
  wrapped in `mat-form-field`) — the native color picker has historically poor
  built-in labeling and needs this addressed explicitly.
- The `INSUFFICIENT_COLOR_CONTRAST` message must be announced (`mat-error`'s
  `aria-describedby` wiring, consistent with §2.2/§4's field-error pattern) — this
  message is unusually information-dense (three numbers), so don't truncate or
  paraphrase it for a screen-reader-only variant; the full sentence should be what's
  announced.
- The broken-logo-image preview state needs an `alt` attribute update reflecting the
  failure (e.g. `alt="Logo preview unavailable"` on the placeholder, not the raw
  attempted URL as alt text) so a screen-reader user gets the same "this didn't load"
  signal a sighted user gets from the broken-image placeholder.

**Relevant heuristics**: visibility of system status (live preview for both fields);
error prevention (client-side format pre-checks, non-blocking image-load-failure
warning distinct from a hard validation error); help users recognize/diagnose/recover
from errors (verbatim ratio/required/failingSurface reporting is precisely this
heuristic — a vague "color rejected" message would fail it); user control & freedom
(idempotent, no-confirm reset action); consistency & standards (one form/one save
button, matching §1c's single-primary-action convention, rather than two independent
per-field save actions).

**Responsive behavior**: standard `tenant-shell` content-area degradation (§3.5's
sidebar/drawer pattern, reused, not restated). The two field blocks (accent + logo,
each with its own preview) stack vertically at all breakpoints — this form is never
wide enough to need a multi-column layout, so no responsive column-count change is
needed beyond the shell's own sidebar collapse.

### 5.3 How the login screen (`auth-shell`) applies tenant branding

Extends, does not replace, §2's existing `auth-shell`/`TenantConfigStore` entry
description — this section closes the loop for FR-MT-10 specifically, consistent
with LLD §10.2's exact runtime-theming design (`TenantConfigStore` applies exactly
one CSS custom property, `--brand-accent`, plus a `logoUrl` signal — no other runtime
theming).

- **Logo display**: unchanged from §2's existing rule — the resolved `logoUrl`
  (tenant override if set, otherwise absent) renders at the top of the auth card;
  when `logoUrl` is null/unset, fall back to the generic ExamLand mark (§2's existing
  fallback), never a broken-image icon and never an empty gap where the logo would
  be. If `TenantConfigStore` propagates a `logoUrl` that itself fails to load at
  runtime on the login screen (same broken-URL risk as §5.2.2's preview, but now on
  a public, unauthenticated screen where there is no admin present to notice/fix it),
  the `<img>`'s `onerror` handler must swap to the generic ExamLand mark
  automatically, client-side, with no visible broken-image flash — a stricter
  requirement than §5.2.2's settings-screen warning, because this is the first thing
  every user of that tenant sees on every login, so silently degrading to the
  fallback mark (rather than showing an explicit "couldn't load" message the way the
  settings screen does) is the correct behavior here — there is no one to act on an
  error message on this screen.
- **Accent application**: `TenantConfigStore` sets `--brand-accent` on
  `document.documentElement` before the auth screens render (already part of the
  pre-render fetch described in §2's "Entry/branding" section). On the login screen
  specifically, `var(--brand-accent)` drives: the primary "Log in" button's fill
  color, the "Forgot password?" and "Create account" links' text color, and the
  focus-ring color on interactive elements if the design system's focus token is
  accent-derived (confirm against the actual Material theme wiring — if focus rings
  are tied to `--el-color-primary` rather than the brand accent, leave them on the
  platform-wide primary and do not override focus-ring color per tenant, since a
  contrast-safe *button fill* doesn't guarantee a contrast-safe *focus ring* against
  every possible page background, and LLD §9.11 only validates the accent against
  the two surface anchors, not against every possible focus-ring context).
  Everything else on the screen (error banners, form-field borders, body text)
  remains on the fixed platform palette (§1c) — accent substitution is scoped
  narrowly to primary-action/link elements, matching LLD §10.2's "every component
  that needs the accent consumes `var(--brand-accent)`, never a hard-coded accent
  hex" rule, and matching FR-MT-10's bounded override scope (no primary/secondary
  palette override).
- **No client-side contrast re-check on this screen**: since the accent was already
  validated server-side at save time (LLD §9.11) against the exact two surface
  constants now finalized in §5.1, the login screen applies `--brand-accent` as
  given, with no runtime contrast gate — consistent with LLD §10.2's explicit design
  note that the client performs no contrast check.
- **No dark-mode variant is rendered on this screen** — §5.1's `THEME_SURFACE_DARK`
  value exists purely as a forward-looking validation anchor (per the dispatch's own
  framing); the actual login screen ships light-mode-only this phase, matching §1c's
  existing "dark mode is not in MVP scope" statement, which this section does not
  change.

### 5.4 Flags for `nexus-dev` to confirm against the real Dev-7 contract

14. **Logo URL field's exact server-side error code**: this document assumes either
    a distinct `INVALID_LOGO_URL` code or a reused `VALIDATION_FAILED` shape for a
    malformed URL — confirm which, and adjust the per-field error-mapping
    (`core/errors/error-message.map.ts`, per §2.2's precedent) accordingly rather
    than guessing a code that doesn't exist.
15. **Whether registration-settings fields (also in Dev-7/BL-07 scope per the
    backlog item, e.g. `allowEmailRegistration`/`allowGoogleSignIn`/
    `defaultSelfRegisterRole` toggles) share this same `/settings` screen as a
    sibling tab, or ship as a separate screen** — this document assumes a shared
    "Settings" nav section with Branding as one tab/sub-route (§5.2's IA) but does
    not fully specify the registration-settings tab's own fields/states, since this
    dispatch's explicit brief is theming; if `nexus-dev` builds registration
    settings without further UX input, apply this same shared-nav/one-form/
    one-save-button, per-field-error convention rather than inventing a different
    pattern for that adjacent screen.
16. **Whether the branding settings endpoint is combined (accent+logo in one
    PATCH) or two separate endpoints** — §5.2's "one form, one save button" design
    assumes a combined write; if the real contract is two independent endpoints,
    the UI can still present one form/one button and fire both calls together
    (treating a partial failure — one succeeds, one returns a validation error — as
    two independent per-field errors on the same still-open form, not a full
    rollback), but confirm this against the real API shape before building.
17. **Whether `TenantConfigStore`'s existing `GET /tenant/public-config` (§2)
    already returns the resolved `accentColorOverride`/`logoUrl`, or whether Dev-7
    adds/changes that response shape** — §5.3 assumes the existing endpoint/store
    is extended, not replaced, matching LLD §10.2's description of
    `TenantConfigStore` as the single existing owner of this data; confirm no
    second, competing fetch is introduced for the auth screen's branding needs.

---

## 16. Feature: Confidence-Threshold Recalibration Analytics (Dev-33 / BL-32, spec §7.3)

**Surface**: Tenant application (§1a), inside the existing `tenant-shell` (§4.0) —
same shell/sidenav/permission-gating pattern as §5.2/§6/§11, not a new shell. Gated by
`pdf.review` (the same permission §11 gates the review/edit/flag actions on — this
screen is read-only analytics *about* that same review activity, so it rides on the
narrowest permission that already implies "this person is trusted with PDF-review
judgment calls," not a new permission). Route guarded by
`permissionGuard('pdf.review')`, same defense-in-depth convention as every other
gated route in this document — a hidden nav link is not access control.

This is this document's **first analytics/reporting screen** — every prior tenant-app
screen (§3/§4/§6/§7/§9/§10/§11) is a CRUD list/detail/wizard over live records with a
single obvious "row." This screen has no rows to click into, no create/edit/delete
action, and no detail page to drill into — it is read-only, aggregate, and advisory
only, per the scope decision in the dispatch (no button that changes
`reviewFlagConfidenceThreshold`; that remains an env var). Establishing that shape
explicitly now, since later analytics-style screens (if any) should follow this
section's precedent rather than each reinventing "how do we show a table of
aggregates with a computed verdict column" from scratch.

**Information architecture**: sidebar item "Confidence Calibration" under the
existing "Settings" nav grouping established in §5.2/§6 (this is tenant-operational
insight into the PDF pipeline's own tuning, the same category as Branding/Taxonomy,
not a peer of "PDF Import" itself — a reviewer already inside §11's PDF Import area
is mid-task on a specific session, whereas this screen is a step back, "how is the
pipeline doing in aggregate," which belongs with the other tenant-configuration/
oversight screens under Settings). Route: `/settings/confidence-calibration`. Single
route, no sub-routes, no query-param drill-down — unlike §6's breadcrumb pattern,
there is no hierarchy to descend into here; every band for every generation method is
shown at once on one screen (see layout below), so URL state is limited to the
optional filter controls (§16.2).

### 16.1 Data shape recap (for layout decisions below)

Per generation method (`lesson_generation`, `exam_extraction_provided`,
`exam_extraction_inferred`, `reused_from_cache`, `regenerated`) × confidence band
(`<0.6`, `0.6–0.75`, `0.75–0.9`, `0.9–1.0`), the screen surfaces:
- **Total question count** in that method × band cell.
- **Human-edit rate** — `isHumanEdited` count / total, as a percentage.
- **Finalize/acceptance rate** — `linkedExamTypeId IS NOT NULL` count / total, as a
  percentage.
- **Advisory suggestion** — plain-English text, computed server-side per the
  dispatch's heuristics (e.g. "high edit rate below the current threshold — consider
  raising it," "rarely edited despite being below threshold — consider lowering it,"
  or no advisory at all for a band that looks healthy).

`reviewFlagConfidenceThreshold`'s current value (0.75 by default) is itself
displayed once, prominently, near the top of the screen — every band's "below/above
threshold" framing is meaningless without the reviewer seeing the live threshold
value being discussed. This is present-only, not editable here (the dispatch's scope
boundary); render it as a plain labeled value ("Current review-flag threshold: 0.75"),
not as an input field, so nothing on screen visually suggests it can be changed on
this page — an editable-looking-but-disabled field would violate error prevention by
inviting an attempt at an action this screen cannot perform.

### 16.2 Layout: table, not cards

**Decision: one table, generation methods as row-groups, confidence bands as
columns** — not a grid of per-band cards. Rationale:
- The core comparison a tenant operator needs to make is cross-band *within* a
  method ("is the 0.6–0.75 band behaving differently from 0.75–0.9 for
  `lesson_generation`?") and cross-method *within* a band ("is `exam_extraction_
  inferred` worse than `lesson_generation` at the same band?") — a table makes both
  comparisons scannable in the same view; a card grid forces the eye to jump between
  disconnected cards to make either comparison, which is strictly worse for this
  screen's actual task (recognition over recall — the table's fixed row/column
  headers do the "which band/method am I looking at" work for the operator instead of
  making them re-read a card title every time).
- A native `<table>` (or the project's existing Material `mat-table` — reuse it, this
  document has never introduced a second table primitive) gets sortable-column and
  row/column-header semantics for free with proper markup, which a card grid does not
  naturally offer to assistive tech.

**Structure**:
- Row groups: one per generation method, with a group header row showing the method's
  display name (e.g. "Lesson generation", "Exam extraction (provided answer)", "Exam
  extraction (inferred answer)", "Reused from cache", "Regenerated" — human-readable
  labels, not raw enum strings, per match-between-system-and-real-world) and, in that
  same header row, the method's **overall** total count/edit-rate/acceptance-rate
  across all bands combined — this rolled-up row lets an operator who doesn't care
  about band-level granularity for a given method still get a useful number without
  expanding anything (there is no expand/collapse interaction here — both the
  rolled-up header row and the four band rows beneath it are always visible; this is
  not a §6-style drill-down, since unlike taxonomy's hierarchy, every level of this
  data is useful to see simultaneously and the whole dataset is small and finite by
  construction: 5 methods × 4 bands).
- Under each method's header row, four data rows, one per confidence band, columns:
  **Band** (`<0.6` / `0.6–0.75` / `0.75–0.9` / `0.9–1.0`, with the currently-active
  threshold's boundary visually annotated — see below), **Total questions**,
  **Human-edit rate** (%), **Finalize/acceptance rate** (%), **Advisory** (text, or an
  em dash "—" for a band with no advisory this run — never a blank cell, which reads
  as a loading/error state rather than "nothing to flag here").
- The band whose lower bound equals the current live threshold (0.6–0.75 in the
  0.75-default case, i.e. the band immediately *below* the threshold) gets a small
  "Below current threshold" text label appended to its Band cell — this is the one
  piece of context that ties the abstract band boundaries back to the one live number
  from §16.1, and it must be text, not merely a highlighted row background (never
  color-only, same rule as §3.1a's status badges).
- A row (band) that the advisory flags as "needs attention" (either direction — edit
  rate too high below threshold, or too low despite being below threshold) is marked
  with the same never-color-only treatment as §3.1a: a small warning icon (Material
  Symbols `flag` or `priority_high`) plus the word "Review" or similar in the
  Advisory cell itself, not merely a tinted row background. Do not build a second,
  separate `StatusBadgeComponent`-style component for this — the icon+text pairing can
  live inline in the Advisory cell text itself, since the advisory text *is* the
  content being flagged, unlike §3.1a's badges which annotate an otherwise-plain row.

**Filters** (`16.2.1`, optional but recommended given 5×4=20 rows may be more than an
operator wants scanning at once): a generation-method multi-select chip filter above
the table (reuse the project's existing filter-chip pattern from §7/§9's list
screens, not a new filter component) — filtering hides non-matching row-groups
entirely rather than graying them out, consistent with this document's existing
filter behavior elsewhere. No date-range filter this phase (the dispatch doesn't call
for a time-series view — this is a point-in-time snapshot of all-time aggregates per
FR-PDF-4/5's data; flagging as an open question for a future phase if operators need
"since last threshold change" trend data, since the current `GeneratedQuestion` model
per §16.1 has no explicit "threshold value at generation time" column visible in this
dispatch — if `nexus-dev` finds the API can't cheaply answer "how would this look
under a different threshold" for historical rows, that's expected and out of scope,
not a bug).

### 16.3 States

- **Loading**: skeleton table — a skeleton group header row + 4 skeleton band rows
  repeated 5 times (one per method), matching the real row shapes, not a spinner —
  same skeleton-over-spinner convention as §3.1/§4.1/§6.1.
- **Empty — no `GeneratedQuestion` rows exist at all yet** (fresh tenant, no PDF
  processing has ever run): replace the table entirely with a centered empty-state
  block: "No questions have been generated yet. Once PDFs are processed, this screen
  will show confidence-band statistics per generation method." No filter chips shown
  in this state (nothing to filter) — same "don't show a filter control with nothing
  behind it" restraint as this document's other empty-state treatments.
- **Empty — questions exist, but none have any human review/finalize activity yet**
  (e.g. a session just completed generation, nothing has been reviewed/edited/
  finalized): still render the full table (counts are meaningful even at 0% edit/
  accept rate — a "0%" rate is real data, not an empty state) but show a one-line
  informational banner above the table: "Edit and acceptance rates will become more
  meaningful as reviewers finalize more questions." This is distinct from the
  all-zero-rows empty state above — do not conflate "no data exists" with "data
  exists but the rates aren't statistically meaningful yet."
- **Populated, no bands flagged**: table renders normally; Advisory column reads "—"
  (or "Looks healthy" / similarly reassuring plain text, not literally an em dash if
  that reads as an error to a screen-reader user — prefer the explicit phrase) for
  every row — visibility of system status: an operator should be able to tell at a
  glance "I checked, and there's nothing to act on here" rather than wondering whether
  the advisory column is broken.
- **Populated, one or more bands flagged**: as above, flagged rows carry the
  icon+text treatment from §16.2. No banner/toast on load for this — the table itself
  is the notification; this is a page the operator navigates to deliberately to
  check, not a live alert feed, so there's no ambient-attention mechanism needed
  beyond the in-row markers.
- **Error** (aggregate-stats fetch fails, network/5xx): inline error block + "Retry"
  button replacing the table body, same pattern as §3.1/§4.1/§6.1's list-fetch error
  treatment. No partial-table-with-error-per-cell handling — this is one aggregate API
  call per this dispatch's scope, not five independent per-method calls, so failure is
  all-or-nothing.

### 16.4 Accessibility

- Table markup uses real `<th scope="col">` for the Band/Total/Edit-rate/Acceptance-
  rate/Advisory column headers and `<th scope="row">`-equivalent treatment (or
  `mat-table`'s row-header styling convention if the kit supports it) for each
  method's group-header row, so a screen-reader user navigating cell-by-cell always
  hears which method and column a given number belongs to — this table has no
  interactive per-row action (no click-through, unlike every prior table in this
  document), so the *only* accessibility job is correct read-order and header
  association; there is no keyboard-focus-into-a-row concern the way §7/§9's
  actionable tables have.
- Sortable columns are not required this phase (5 methods × 4 bands is small enough
  that sorting adds little value and the fixed method/band grouping is more legible
  than a re-sorted flat list would be) — if `nexus-dev` still wants to add
  column-sort as a nice-to-have, it must follow the WAI-ARIA APG sortable-table
  pattern (`aria-sort` on the `<th>`) rather than a silent visual-only reorder.
  Flagging as optional, not required, to avoid over-building relative to spec §7.3's
  explicitly "informational" framing.
- No chart/graph is required by this screen's design (a table fully satisfies the
  content per §16.2's rationale) — if `nexus-dev` or a future iteration adds a visual
  chart (e.g. a bar per band), it must ship with a text-equivalent (the same
  underlying table data, not hidden — charts here should be presented as an
  **additional, optional** visualization layered above the table, never as a
  replacement for it), per this document's WCAG 2.2 AA baseline (§1b) requiring
  non-text content to have a text alternative.
- Every "needs attention" signal is icon + text, never color-only, consistent with
  §3.1a's badge rule — restated here because this screen is this document's first
  table where an entire *row's* interpretation (not just a status chip) depends on a
  visual "flagged" treatment; a colorblind operator must be able to identify flagged
  rows from the Advisory cell's text/icon alone with the row background tint disabled.
- The current-threshold value (§16.1) and the "Below current threshold" band label
  (§16.2) are both plain text, already screen-reader-accessible without extra markup.

### 16.5 Responsive behavior

- **Desktop/tablet** (the primary expected use case — this is an operator/admin
  analytics screen, not a mobile task): full table as described, five columns visible
  at once.
- **Mobile/narrow viewport**: horizontal scroll on the table (a sticky first column
  showing Method/Band labels while Total/Edit-rate/Acceptance-rate/Advisory scroll
  underneath) rather than collapsing to stacked cards — consistent with treating this
  as a genuinely desktop-oriented operator tool first (mirrors this document's
  existing precedent of not over-investing in bespoke mobile layouts for admin-only
  screens, e.g. §7/§8's catalog/allowlist tables), while still keeping the screen
  usable rather than entirely unusable below tablet width. Filter chips (§16.2.1)
  wrap to multiple lines rather than scrolling horizontally, same as this document's
  existing chip-filter responsive behavior elsewhere.

## 6. Feature: Taxonomy Browse/Create (Dev-8 / BL-08, FR-TAX-1..4)

**Surface**: Tenant application (§1a), inside the existing `tenant-shell` (§4.0) —
same sidenav/permission-gating pattern as §4/§5, not a new shell. Gated by the
`taxonomy.read`/`taxonomy.create`/`taxonomy.delete` permissions (nav item hidden if
`taxonomy.read` is absent; route guarded by `permissionGuard('taxonomy.read')`, same
defense-in-depth convention as §4.0/§5.2 — a hidden nav link is not access control).
Create/delete affordances are additionally gated per-action by `taxonomy.create`/
`taxonomy.delete` (a user with only `taxonomy.read` sees the browse UI with the
inline "add" row and delete icons simply omitted, not disabled-and-visible — omission
is clearer than a perpetually-disabled control here since there's no in-context reason
a read-only user would need to know the affordance exists at all).

**Information architecture**: sidebar item "Taxonomy" under the existing "Settings"
nav grouping established in §5.2 (education levels/stages/subjects are
tenant-configuration data, the same category as branding/registration settings, not
a peer of "Users"). Single route: `/settings/taxonomy`. No sub-routes — see layout
decision below for why drill-down state lives in query params, not nested routes.

**Layout decision (made, not left open)**: a **single master list with
breadcrumb-style drill-down** — one list panel on screen at a time (Education
Levels, or the Stages of a selected level, or the Subjects of a selected stage),
with a breadcrumb trail above it ("All education levels" / "{Level name}" /
"{Level name} > {Stage name}") — rather than a three-column/three-panel side-by-side
layout. Rationale:
- The LLD explicitly scopes this as minimal, unblocking-only UI, not a full CRUD
  suite; a three-panel layout is the heavier build (three simultaneously-visible
  lists, three sets of loading/empty/error states rendered at once, tricky sizing
  choices for panels 2/3 before anything is selected) for a feature whose only job
  this phase is "browse and create/delete."
- Three-panel layouts consume desktop-only width and degrade badly to mobile (three
  columns cannot coexist below tablet width without a redesign anyway) — a
  single-panel drill-down needs no separate mobile layout at all: it is already the
  correct one-thing-at-a-time layout for a narrow viewport, satisfying "aesthetic &
  minimalist design" and giving a uniform experience across breakpoints for free.
- A breadcrumb trail keeps "where am I in the hierarchy" fully visible (match
  between system and the real world, consistency & standards — reusing the same
  breadcrumb-back pattern §3.2/§4.2 already use for "back to list"), while a single
  focused list at a time is easier to make correctly keyboard/screen-reader
  navigable than three simultaneously-live listboxes.
- Drill-down state (which level/stage is currently selected) is carried in the URL
  query string (`?levelId=…` / `?levelId=…&stageId=…`), not nested routes — this
  gives back-button and reload/deep-link support (recognition over recall, matching
  §3.1/§4.1's URL-state-persistence precedent) without the routing complexity of
  three nested route levels for what is, per screen, always exactly one visible list.

### 6.1 Browse flow

**Flow**:
1. Tenant Admin/Exam Manager reaches `/settings/taxonomy` via Settings → Taxonomy.
2. Default view: the Education Levels list, breadcrumb reads "Education Levels"
   (no back-link at this top level — it's the root).
3. Clicking an Education Level row (not its delete icon) drills in: breadcrumb
   becomes "Education Levels > {Level name}", the panel now shows that level's
   Stages list (`GET /api/taxonomy/stages?educationLevelId=`).
4. Clicking a Stage row drills in again: breadcrumb becomes "Education Levels >
   {Level name} > {Stage name}", panel shows that stage's Subjects list.
5. Subjects is the leaf level — no further drill-down; rows are select-inert (no
   click-to-navigate) apart from the delete action.
6. Breadcrumb segments are clickable/keyboard-operable links that navigate back up
   to that level's list (updating the URL query string accordingly) — this is the
   flow's only "exit" mechanism besides sidebar nav elsewhere; there is no separate
   "back" button distinct from the breadcrumb (avoids redundant, inconsistent
   navigation affordances — consistency & standards).

**States, per level** (Education Levels / Stages-of-X / Subjects-of-X — identical
state shape at each depth, described once):
- **Loading**: skeleton list rows (3-5 gray placeholder bars matching the row
  layout), not a spinner — consistent with §3.1/§4.1's skeleton-over-spinner
  convention. On drill-down navigation (selecting a row to go deeper), show the
  child panel's skeleton immediately rather than leaving the parent panel visible
  mid-fetch — the breadcrumb updates immediately (system status: "you're now looking
  at X's children") even before the list content arrives.
- **Empty — root level has zero Education Levels**: centered empty-state block:
  "No education levels yet. Add one to get started." — the inline "add new" row
  (§6.2) is still shown above/alongside this message so the CTA is the same
  affordance the admin would use anyway, not a separate button (there is exactly one
  way to create an entry at any level: the inline row).
- **Empty — a level has zero children** (e.g. an Education Level with no Stages
  yet, or a Stage with no Subjects yet): same empty-state treatment but distinctly
  worded to reflect *whose* children are missing, since this is a normal,
  expected mid-hierarchy state, not a first-run condition: "No stages under
  '{Level name}' yet. Add one below." / "No subjects under '{Stage name}' yet. Add
  one below." Do not reuse the root-level's "yet to get started" framing verbatim at
  deeper levels — recognition over recall benefits from naming the specific parent
  the empty list belongs to, since at any given moment the breadcrumb is the only
  other on-screen confirmation of which parent's children are being viewed.
- **Error** (list fetch fails, network/5xx): inline error block + retry, same
  pattern as §3.1/§4.1, replacing the list body at whichever depth failed.
- **Error — parent 404 `TAXONOMY_ENTRY_NOT_FOUND`** (drilled into a level/stage
  whose id no longer exists — e.g. it was deleted in another tab, or via a stale
  bookmarked URL with a `levelId`/`stageId` query param pointing at a removed
  entry): do not render a blank/broken child panel. Show a dedicated message in
  place of the list: "This education level no longer exists. It may have been
  deleted." (or the stage-scoped equivalent) with a link that resets the breadcrumb
  back to the root Education Levels list — same "entity no longer exists, offer the
  way back" pattern as §4.2's `USER_NOT_FOUND`-on-load treatment, applied to a
  drill-down parent instead of a detail screen.
- **Success**: list populated, breadcrumb reflects current depth.

**Row content, per level**: entry name (primary text) and, for Education
Levels/Stages only, a small chevron/disclosure affordance (`chevron_right` Material
Symbol) indicating the row is drillable — Subjects rows have no chevron, signaling
visually (in addition to structurally) that they're a leaf with nothing further to
open. Delete icon button at the row's trailing edge, gated by `taxonomy.delete`
(§6.3). `createdAt` is not shown in the row — per this phase's explicitly minimal
scope, there is no other metadata worth surfacing per entry yet; if a future phase
adds "where is this used" (BL-11/BL-12), that's an addition to this row, not a
redesign of it.

### 6.2 Inline create affordance

A single persistent row at the bottom of whichever list panel is currently showing
(Education Levels root, or a given level's Stages, or a given stage's Subjects) —
one text input + an "Add" button, always visible (not hidden behind a separate
"+ Add" toggle click) since this is the feature's primary action and the LLD's
"minimal UI" framing favors the lowest-friction, always-visible affordance over a
two-step reveal.

**States**:
- **Idle**: empty text input, placeholder text scoped to the level ("Add education
  level…" / "Add stage…" / "Add subject…"), "Add" button present but not disabled
  pre-input (§2.3's precedent: never disable a submit control pre-attempt — let
  submit trigger validation).
- **Submitting**: input and "Add" button disabled, button shows inline spinner
  (§1c's standard button-loading pattern) — brief, single-field submits, no
  full-panel loading state needed.
- **Success (both 200-existing and 201-created)**: identical treatment for the
  user regardless of status code — the row appears (or is confirmed already
  present) in the list above the input in its correct alphabetical/list position
  (re-fetch the panel's list rather than hand-splicing, consistent with §3/§4's
  server-truth convention), the input clears and returns focus to itself (ready for
  the next entry — this is a repeat-entry-friendly affordance, admins will often add
  several stages/subjects in a row), and a single, low-key `MatSnackBar`
  confirmation reading simply "Added." — never two different confirmation copies for
  the 200-vs-201 case, and never surfacing "this already existed" to the user at
  all: the create-or-fetch semantics are backend plumbing this screen must not leak
  into a surprising or contradictory-feeling message (visibility of system status
  must stay honest to what the user *did* — they asked to add "Grade 5", and
  "Grade 5" is now present in the list either way — not to what happened
  server-side).
- **Error — `INVALID_NAME`** (400): per-field error directly under the inline
  input, matching this project's established per-field `mat-error` convention
  (§2.2/§4.2/§5.2's precedent, not a form-level banner — this is a single-field,
  actionable, non-enumeration-sensitive error):
  > "Enter a name between 2 and 150 characters."
  Basic client-side length/non-empty pre-check (trim, 2-150 chars) before submit,
  same error-prevention rationale as every other form field pre-check in this
  document — duplicates, doesn't replace, the server check.
- **Error — parent 404 `TAXONOMY_ENTRY_NOT_FOUND`** on create (the parent
  level/stage was deleted concurrently, between page-load and this submit): treat
  identically to §6.1's browse-time 404 handling — replace the whole panel with the
  "no longer exists" message and a way back to the root, since the create row itself
  has become meaningless without a valid parent.
- **Error — network/5xx**: a small inline banner directly above the create row
  (not per-field, since this isn't about the name's validity), same generic copy as
  §2.1's network-error pattern: "Something went wrong. Please try again."

### 6.3 Delete affordance

**Confirm dialog** (required — reuse `shared/ui/confirm-dialog`, §3.4's
destructive-confirm pattern, not a new dialog component): triggered by the row's
delete icon button at any of the three levels.
> "Delete '{name}'? This cannot be undone."

This is a shorter confirm body than §4.5's user-delete dialog deliberately — there is
no retained-history nuance to explain here (this phase has no downstream references
to taxonomy entries yet, per the dispatch's explicit scope note), so a plain
irreversibility warning is the honest, non-padded copy; do not invent retained-data
language this phase's backend doesn't actually implement. Dialog actions: "Cancel" /
"Delete" (destructive-styled, `--el-color-error`, per §1c), initial focus on
"Cancel" (§4.5's precedent — never default focus onto the destructive action).

**`409 TAXONOMY_ENTRY_IN_USE`** — explain-and-suggest-fix copy, matching §4.5/§4.2's
`LAST_ADMIN_PROTECTED` precedent for this class of error (never a bare "cannot
delete"):
> "'{name}' is in use and can't be deleted. Remove or reassign whatever references it
> first, then try again."

Since this phase has no UI that shows *what* references it (no Exam Types/Curricula
consumer yet, per the dispatch's explicit scope boundary), the copy deliberately
stays generic about "whatever references it" rather than naming a specific consumer
screen that doesn't exist yet — do not invent a link to a screen that isn't built.
Render as a non-dismissible-until-acknowledged inline banner (replacing the confirm
dialog's content in place, or a follow-up dialog immediately after — either is
acceptable, consistent with §4.5's own either/or on this exact question) rather than
letting the confirm dialog silently close on failure.

**`404 TAXONOMY_ENTRY_NOT_FOUND`** on delete (already deleted by someone else,
race): snackbar ("This entry was already removed.") + remove the row in place /
re-fetch the panel, same benign-race treatment as §3.4/§4.5's precedent — not a
blocking error.

**Success**: row removed from the current panel's list (re-fetch, server-truth
convention) + snackbar ("Deleted."). Deleting an Education Level or Stage also
implicitly removes access to its former children's drill-down path — if the admin
had that entry's child panel open in another tab/window and returns to it, that's
exactly the 404-on-browse case in §6.1, already handled.

**Accessibility**: standard `confirm-dialog`/`mat-dialog` a11y (focus trap, initial
focus on "Cancel") — no new a11y pattern needed beyond §3.4/§4.5's existing dialog
conventions.

**Relevant heuristics**: error prevention + user control & freedom (confirm dialog,
non-destructive default focus); help users recognize/diagnose/recover from errors
(`TAXONOMY_ENTRY_IN_USE`'s explain-and-suggest-fix copy, directly following the
project's established precedent for this error class rather than a generic 409).

### 6.4 Accessibility — drill-down-specific (beyond §1b/§3/§4 baseline)

- The breadcrumb (`nav aria-label="Taxonomy breadcrumb"` with an ordered list of
  links, the current/last segment marked `aria-current="page"` and rendered as
  plain text rather than a link since it's not actionable) is the load-bearing
  mechanism conveying "whose children am I looking at" — it must be a real
  semantic breadcrumb, not styled `<div>`s, since it is the *only* persistent
  indicator of hierarchy depth for a screen-reader user (there is no side-by-side
  panel context to fall back on, per the layout decision in §6).
- Each list panel's heading (e.g. an `<h2>` reading "Stages of {Level name}" /
  "Subjects of {Stage name}", visually may be the breadcrumb itself but should have
  a distinct, explicit programmatic heading too) must update and be associated with
  the list below it (`aria-labelledby`) so a screen-reader user navigating by
  heading lands on unambiguous context, not a bare "Stages" heading disconnected
  from which level it belongs to.
- On drill-down (row click/Enter), move focus to the new panel's heading (not leave
  focus stranded on the now-scrolled-away parent row) — same focus-management
  principle as every route-like transition elsewhere in this document (§3.3/§4.2's
  precedent), even though this is a query-param transition within one route rather
  than a full navigation.
- Rows at Education-Level/Stage depth are operable as buttons/links (keyboard
  Enter/Space triggers drill-down), not `<div onclick>` — use a real `<button>` or
  `<a>` semantic per row, with the trailing delete icon button as a separate,
  independently-focusable control within the row (not nested inside the row's own
  click target in a way that intercepts/duplicates the click).
- The inline create row's "Added."/error announcements follow the same
  `aria-live="polite"` (success) / `mat-error` `aria-describedby` (validation)
  conventions established in §2.2/§4.3 — nothing novel needed here.

### 6.5 Responsive behavior

Single-panel-at-a-time layout (§6's layout decision) means there is no
three-column/table-to-card degradation problem to solve, unlike §3.5/§4.1 — the
same layout serves every breakpoint:
- **Desktop/tablet**: list panel at a comfortable reading width (does not need to
  stretch full-bleed across a wide content area — cap at roughly 600-720px,
  centered or left-aligned within the `tenant-shell` content area, matching the
  settings-screen width precedent implied by §5.2's single-column form).
  Breadcrumb and inline create row sit directly above/below the list at full panel
  width.
- **Mobile** (`Breakpoints.Handset`, §3.5's convention): panel expands to the
  content area's full width with standard page margins; rows remain single-line
  (name + chevron + delete icon) without needing a stacked-card degradation, since
  each row here is already simple enough (a name and two icons) to stay legible at
  narrow widths without the table-to-card transformation §3.1/§4.1 needed for
  multi-column tables.

### 6.6 Copy summary addendum (this feature)

| Condition | Placement | Copy |
|---|---|---|
| Root: no education levels yet | Empty-state block | "No education levels yet. Add one to get started." |
| Mid-level: no children yet | Empty-state block | "No stages under '{Level name}' yet. Add one below." / "No subjects under '{Stage name}' yet. Add one below." |
| List fetch failure | Inline error block | "We couldn't load this list. Try again." |
| Drilled into a deleted parent | Panel-replacing message | "This education level no longer exists. It may have been deleted." (stage-scoped equivalent for the subjects level) |
| Create: `INVALID_NAME` | Per-field, under create input | "Enter a name between 2 and 150 characters." |
| Create: network/5xx | Inline banner above create row | "Something went wrong. Please try again." |
| Create success (200 or 201 alike) | Snackbar | "Added." |
| Delete confirm dialog | Modal body | "Delete '{name}'? This cannot be undone." |
| Delete: `TAXONOMY_ENTRY_IN_USE` | Non-dismissible banner/follow-up dialog | "'{name}' is in use and can't be deleted. Remove or reassign whatever references it first, then try again." |
| Delete: `TAXONOMY_ENTRY_NOT_FOUND` (race) | Snackbar | "This entry was already removed." |
| Delete success | Snackbar | "Deleted." |

### 6.7 Flags for `nexus-dev`

18. **Sort order of listed entries**: the API surface described has no `sort`
    param on any of the three list endpoints. This document assumes the server's
    default order is usable as-is (presumably alphabetical or `createdAt` order) —
    confirm, and if the default order is `createdAt` rather than alphabetical,
    consider whether client-side alphabetical sort within a single fetched page is
    safe here (unlike §3.1's flagged concern, these lists are not paginated per the
    endpoints described, so a full-list client-side sort does not have §3.1's
    cross-page misrepresentation problem — it is safe to do here even though it
    wasn't safe there).
19. **No pagination on any of the three list endpoints as described** — this
    document assumes tenant hierarchies stay small enough (a bounded, curated set
    of education levels/stages/subjects, not an open-ended user-generated list) that
    an unpaginated full-list fetch per panel is acceptable for this phase. If a
    tenant's taxonomy ever grows large, revisit both the API (add pagination) and
    this UI (the single-panel-list would then need its own loading-more/pagination
    treatment) — not a concern this document resolves now, since nothing in the
    dispatch context suggests it's a near-term risk.

---

## 7. Feature: Platform Admin Console — Feature/Package Catalog & Tenant Subscription (Dev-9b / BL-09, FR-PKG-7)

**Surface**: Platform admin console (§1a) — `platform-shell`, the same sidebar-nav
admin dashboard shell §3 established (skeleton/empty/error states, pagination,
`StatusBadgeComponent` component-thinking, `mat-dialog` confirm pattern, mobile
card-list table degradation). This section adds two new top-level console resources
(Features, Packages) plus one new section on the existing tenant detail screen
(§3.2) — it does not introduce a new shell or a new destructive-confirm mechanism;
it reuses `shared/ui/confirm-dialog` throughout (§3.4/§4.5/§6.3's established
component), not a bespoke dialog.

### 7.0 Navigation and screen split

**Decision: two separate list screens ("Features" and "Packages"), not one combined
"Catalog" screen — plus a "Subscriptions" concept that is *not* a third top-level nav
item.**

Rationale:
- Features and Packages are different resources with different lifecycles and
  different table shapes (a feature is a flat catalog entry; a package additionally
  carries a nested feature-configuration sub-resource, §7.3). Cramming both into one
  screen (e.g. tabs) would still need two visually distinct tables/forms underneath —
  the "combined screen" option only saves one sidebar entry at the cost of a busier
  single screen, and this console already establishes the one-resource-per-nav-item
  pattern (§3.1's "Tenants" as its own item, §4.1's "Users" as its own item). Two
  separate items is simply consistent with the shell's existing IA, not a new
  pattern.
- Row counts are small (<20 features, <10 packages per the dispatch context) — this
  makes a *combined* screen tempting for "just fit it all on one page," but small row
  counts equally make two separate simple list screens cheap to build and does not
  create a pagination/scroll-fatigue problem either way when split. Splitting is
  the more consistent choice, not the more expensive one.
- Editing a package's feature configuration (§7.3) is naturally a **sub-section of
  the package edit screen**, not a separate nav item or a separate screen — a package's
  feature matrix has no independent identity outside the package it belongs to (it is
  replaced atomically via `PUT /platform/packages/:id/features`, always in the context
  of "this package"), so it belongs inside `/platform/packages/:id`, one level down
  from the Packages list, exactly the same relationship §3.2's tenant-detail actions
  have to the Tenants list.
- **Tenant subscription reassignment is not a third nav item.** It is a new section/
  tab on the existing tenant-detail screen (§3.2) — see §7.4. A standalone
  "Subscriptions" list screen would imply subscriptions are independently browsable/
  manageable entities, but FR-PKG-7 frames this strictly as "view/reassign any
  tenant's active subscription" — i.e. a property of a tenant, viewed and changed in
  the context of that tenant, not a cross-tenant list an admin would browse on its own
  (there is no listed requirement for "show me all tenants on Package X," and
  inventing that screen now would be scope creep beyond FR-PKG-7's literal ask).

**Sidebar order**: "Tenants" (§3, existing) → "Features" (new) → "Packages" (new).
Features before Packages because a package's feature-configuration sub-screen (§7.3)
depends on the feature catalog already existing/being visible to the admin —
placing Features first primes the admin with the vocabulary (feature names/keys)
they'll be picking from when they next open Packages, consistent with "match between
system and the real world."

**Routes**: `/platform/features` (list, §7.1), `/platform/features/new` (create,
§7.1), `/platform/features/:id` (edit, §7.1) — same dedicated-route judgment call as
§3.3/§4.2 (see route-vs-modal note below); `/platform/packages` (list, §7.2),
`/platform/packages/:id` (edit + feature-configuration sub-section, §7.3),
`/platform/packages/new` (create, §7.2). Tenant subscription lives at the existing
`/platform/tenants/:id` route as a new section (§7.4), no new route.

**Route-vs-modal / inline-create-row choice for Features and Packages — dedicated
route, not §6's inline-create-row pattern**: §6 (Taxonomy) used an always-visible
inline-create-row because taxonomy entries are single-field, flat, no-further-detail
entities (a name and nothing else) organized in a drill-down browse flow. Features
and Packages are **not** that shape — a Feature has four fields (key, name,
description, unit, resetPeriod) and a Package has five-plus a nested feature-
configuration sub-resource; both need a real create *form*, not a one-input-plus-
button row, and both need a dedicated edit surface afterward (a feature/package is
revisited and edited repeatedly, unlike a taxonomy entry which is create-once/
rarely-touched). This is structurally the same shape §3.3's tenant-create
form and §4.3's user-create form already are, so this section follows **that**
precedent (dedicated route for create, e.g. `/platform/features/new`, landing on the
new entity's own edit screen on success) rather than §6's inline-row precedent —
consistency & standards, applied to the more shape-similar prior art rather than the
most recent one.

### 7.1 Feature list / create / edit screens

**List (`/platform/features`)**:
- Table columns: Key (monospace, since it's an identifier admins may need to
  communicate/copy precisely — same monospace rationale as §4.3's temporary-password
  value), Name, Unit (plain text, e.g. "exams", "PDF pages"), Reset period (a small
  text/chip: "None" / "Daily" / "Monthly" — not a `StatusBadgeComponent`; this is a
  configuration property, not a lifecycle state, so it doesn't warrant the
  color+icon status-badge treatment §3.1a reserves for actual state), Description
  (truncated with a tooltip/title showing the full text if it overflows — this is
  supporting/secondary information, not the primary scan column), Actions (Edit,
  Delete).
- No pagination needed given the stated <20-row expectation, but do **not** hardcode
  "no pagination" as a permanent design decision — if the catalog can exceed roughly
  50-100 features over the product's life, revisit; for this phase, fetch the full
  list unpaginated (mirrors §6.7's flag #19 reasoning for taxonomy) and skip
  `mat-paginator` entirely rather than building dead pagination UI for a list that
  never fills a page.
- No search/filter given the small expected size — a plain full list is the
  simplest, most honest UI for <20 rows; do not add a search box that would only ever
  filter a handful of visible rows (aesthetic & minimalist design).
- **Loading**: skeleton table rows (§3.1's convention).
- **Empty** (zero features defined yet — plausible on a fresh platform before any
  package is configured): centered empty-state block, "No features defined yet.
  Create the first one to get started." + "Create feature" CTA (same button as the
  header's primary action).
- **Error** (fetch fails): inline error block + retry (§3.1's convention).
- Primary action: "Create feature" button (top-right, filled, §1c's one-primary-
  button rule) → `/platform/features/new`.

**Create/edit form (`/platform/features/new`, `/platform/features/:id`)**:
- Fields: Key (text, required, format guidance "lowercase letters, numbers, hyphens,
  underscores" — confirm the actual accepted key-format pattern against the real
  validator, flagged below, since the API surface given doesn't state one), Name
  (text, required), Description (textarea, optional), Unit (text, required — a
  free-text label like "exams"/"PDF pages" rather than a fixed enum, since the API
  surface doesn't describe unit as a closed set), Reset period (a `mat-select` with
  the three fixed options None/Daily/Monthly — a genuinely closed enum, so a select
  is correct here, not free text).
- **Immutable-key-once-referenced UX treatment — decision: handle preemptively via
  a server-supplied flag, not purely reactively.** The dispatch correctly notes the
  client can't locally determine "is this feature referenced by any package" — so
  this document specifies that `GET /platform/features` (list) and the feature detail
  fetch **must include an `isReferenced: boolean` field** (or equivalent) in the
  response, and `nexus-dev` should confirm this against/add this to the real Dev-9a
  response shape (flagged below) rather than the UI silently guessing. Given that
  flag:
  - On the **edit** screen, if `isReferenced` is `true`: render the Key field as
    **read-only/disabled** (not hidden — the admin still needs to see the current
    key), with a small inline helper note directly under it: "This feature's key
    can't be changed because it's used by one or more packages." (a lock icon next
    to the field is a reasonable additional visual cue, matching §3.1a's icon+text-
    over-color-alone convention, though key immutability isn't a "status" needing
    the full `StatusBadgeComponent` treatment — a plain disabled-field + helper-text
    pattern is proportionate here).
  - If `isReferenced` is `false`: the Key field remains a normal editable text input.
  - **Reactive handling is still required as a fallback**, not a replacement for the
    above: if a `409 FEATURE_KEY_IMMUTABLE` is returned anyway (a race — the feature
    became referenced by another admin's concurrent package-save between this
    screen's load and this submit), treat it exactly like §3.4/§4.5's race-condition
    pattern — do not show a blocking, confusing error on a field the UI told the
    admin was editable a moment ago. Show a snackbar ("This feature is now used by a
    package, so its key can no longer be changed. Refreshing…"), re-fetch the
    feature (which will now correctly show `isReferenced: true` and lock the field),
    and preserve the admin's other in-progress edits (name/description/unit/
    resetPeriod) rather than discarding the whole form on this specific race.
  - This preemptive-flag approach is preferred over pure reactive-409-handling
    because reactive-only would mean the Key field looks perfectly editable right up
    until the admin submits and gets a surprising rejection — a direct "error
    prevention" violation for a field whose lockedness is knowable in advance; the
    flag turns an avoidable post-submit surprise into an accurate up-front affordance.
- Create submit → success (`201`) → land on the new feature's own edit screen
  (`/platform/features/:id`), snackbar "Feature created." (same "land on the created
  resource's detail/edit screen" convention as §3.3/§4.3).
- Edit submit → success (`200`) → remain on the screen with saved values reflected,
  snackbar "Feature updated." (matches §5.2's persistent-settings-screen convention,
  since this is also an edit-in-place screen, not a create wizard).
- **Error — `409 FEATURE_KEY_EXISTS`** (create, or the rare case a key edit is
  attempted on a not-yet-referenced feature and collides): per-field error on Key:
  > "A feature with this key already exists."
- **Error — `409 FEATURE_KEY_IMMUTABLE`**: covered above (race-only path, since the
  preemptive flag should prevent the field being editable in the non-race case).
- **Delete** (list row action, or a "Delete feature" action on the edit screen —
  offer it in both places, same as §3's "row-level quick action is acceptable in
  addition to the detail screen's action" precedent): reuse
  `shared/ui/confirm-dialog`:
  > "Delete '{name}'? This cannot be undone."
  (short-form copy, matching §6.3's taxonomy-delete precedent, since — like taxonomy
  entries before this phase — there is no retained-history nuance to explain for a
  feature deletion beyond the reference-guard itself).
  - **`409 FEATURE_IN_USE`** — explain-and-suggest-fix copy, following the
    project's established precedent for this whole class of "can't delete, here's
    why and what to do" errors (§4.5's `LAST_ADMIN_PROTECTED`, §6.3's
    `TAXONOMY_ENTRY_IN_USE`):
    > "'{name}' is used by one or more packages and can't be deleted. Remove it from
    > those packages' feature configuration first, then try again."
    Render as a non-dismissible-until-acknowledged banner/follow-up dialog, same
    either/or placement rule as §4.5/§6.3. Note this copy is more actionable than
    taxonomy's generic "whatever references it," since — unlike taxonomy at the time
    §6 was written — this phase's UI *does* have a concrete place to point the admin
    (the Packages screen's feature-configuration sub-section, §7.3); if feasible,
    make "those packages' feature configuration" a real link to `/platform/packages`.
  - `404 FEATURE_NOT_FOUND` on delete (race): snackbar ("This feature was already
    removed.") + remove the row/redirect from edit screen, same benign-race pattern
    as §3.4/§4.5/§6.3.

**Accessibility** (beyond §1b/§3 baseline): standard `mat-form-field` labeling for
every field; the disabled-Key-with-helper-text state needs the helper text
associated via `aria-describedby` so a screen-reader user hears *why* the field is
disabled, not just that it is; Reset period's `mat-select` needs its three options
individually announced with plain labels ("None", "Daily", "Monthly"), not raw enum
values (`NONE`/`DAILY`/`MONTHLY`).

**Relevant heuristics**: error prevention (preemptive Key-lock via `isReferenced`
rather than a surprise 409); help users recognize/diagnose/recover from errors
(`FEATURE_IN_USE`'s explain-and-fix copy); consistency & standards (reusing the
confirm-dialog, snackbar, and land-on-created-resource conventions verbatim rather
than inventing catalog-specific variants).

### 7.2 Package list / create screens

**List (`/platform/packages`)**:
- Table columns: Name, Key (monospace, same rationale as Features), Price (formatted
  from `priceCents`/`currency`, e.g. "$29.00/mo" — confirm against the real contract
  whether packages are inherently recurring/monthly or whether a billing-period label
  needs to come from elsewhere; if the API gives no period, render just the
  formatted amount, e.g. "$29.00", without inventing a "/mo" suffix not backed by the
  data — flagged below), Active (a `StatusBadgeComponent`-style badge: green
  `check_circle`/"Active" vs. neutral-gray `block`/"Inactive", same icon+color+text
  convention as §3.1a/§4.1's Active/Inactive badge — this **is** a genuine lifecycle
  state, unlike Feature's reset-period property, so the full badge treatment is
  warranted here), Sort order (plain numeric column — this is what drives display
  order elsewhere in the product, e.g. a future tenant-facing pricing page, so
  surfacing it as a visible, sortable-by-eye column matters even though there's no
  dedicated "reorder" UI this phase), Actions (Edit — no "Delete" action listed in
  the given HTTP surface for packages; confirm whether package deletion exists at
  all, flagged below, since none of the five package endpoints given is a `DELETE`).
- Default sort: by `sortOrder` ascending (matches the field's evident purpose) if the
  API's default list order already reflects it; otherwise a client-side sort by
  `sortOrder` is safe here (unpaginated full-list fetch, same reasoning as §6.7's
  flag #18 — no cross-page misrepresentation risk when nothing is paginated).
- **Loading/Empty/Error**: identical pattern to §7.1's Features list — skeleton
  rows; empty state "No packages defined yet. Create the first one to get started."
  + CTA; inline error + retry.
- Primary action: "Create package" button → `/platform/packages/new`.

**Create form (`/platform/packages/new`)**:
- Fields: Key (text, required, same format-guidance treatment as Feature's Key —
  packages have no stated immutability rule in the given surface, so no lock
  treatment is needed here, just the standard `409 PACKAGE_KEY_EXISTS` per-field
  error), Name (text, required), Description (textarea, optional), Price (a
  currency-aware input: a numeric amount field paired with a currency selector/fixed
  currency display, converting to `priceCents` on submit — e.g. admin types "29.00"
  in a field labeled "Price", a separate small `mat-select` or fixed label shows the
  currency; confirm whether currency is admin-selectable per package or platform-
  fixed, flagged below), Active (a toggle, default on for a new package — a package
  is normally created ready to use; no confirm needed on this toggle at *create*
  time since nothing is being deactivated yet, unlike the edit-time case below),
  Sort order (a plain numeric input, default to "add at the end," e.g. pre-filled
  with `max(existing sortOrder) + 1` computed client-side from the already-fetched
  list, so the admin isn't forced to guess a number that avoids collisions — this is
  a "recognition over recall" nicety, not a hard requirement, since the API doesn't
  enforce sort-order uniqueness per the given surface).
- Submit → success (`201`) → land on the new package's edit screen
  (`/platform/packages/:id`), which **immediately shows an empty feature-
  configuration sub-section** (§7.3) the admin can now fill in — this two-step flow
  (create the package shell, then configure its features) is the natural
  consequence of the API's own two-endpoint design (`POST /packages` then separately
  `PUT /packages/:id/features`), and is called out explicitly here so `nexus-dev`
  doesn't try to cram feature-configuration into the create form itself (it can't —
  the package doesn't have an id yet until the first POST resolves). Snackbar:
  "Package created — now configure its features below." (deliberately more directive
  than a bare "Package created." — this is the one moment a plain confirmation isn't
  enough, since an admin who stops here has created an unusable package with no
  enabled features at all, a real, easy-to-fall-into gap this copy exists to close).
- **Error — `409 PACKAGE_KEY_EXISTS`**: per-field on Key, same copy pattern as
  Feature's: "A package with this key already exists."

**Edit screen (`/platform/packages/:id`)** — top section (basic fields) + bottom
section (feature configuration, §7.3):
- Same fields as create, pre-filled, editable in place (matches §5.2/§7.1 edit's
  persistent-settings-screen convention: one "Save changes" button for the top
  section's fields, remaining on screen with saved values reflected on success,
  snackbar "Package updated.").
- **Deactivating a package (Active → Inactive)**: this is a meaningful action —
  an inactive package presumably can no longer be newly assigned to a tenant (confirm
  this behavioral assumption against the real contract, flagged below, since the
  given API surface states `isActive` as a field but not its enforcement
  consequence). Applying the same confirm-required-on-the-"off"-direction pattern
  §3.4/§4.2 established for Suspend/Deactivate: **confirm before flipping Active →
  Inactive** ("Deactivate '{name}'? Tenants will no longer be able to have this
  package newly assigned to them." — adjust wording once the real enforcement
  behavior is confirmed), **no confirm for Inactive → Active** (reactivating is
  reversing a deliberate prior action, matching the established asymmetric-
  confirmation rule).
- No delete action on this screen per the given HTTP surface (no `DELETE
  /platform/packages/:id` listed) — if `nexus-dev` confirms deletion is in fact
  possible via an endpoint not listed here, apply the same confirm-dialog +
  `PACKAGE_IN_USE`-class-error pattern as §7.1's Feature delete for consistency,
  rather than a bespoke treatment.

### 7.3 Package feature-configuration sub-section (`PUT /platform/packages/:id/features`)

This is the section's most novel UI, since it's a genuinely new shape (a per-package,
per-feature matrix submitted as one atomic replace) not directly precedented
elsewhere in this document — closest analog is §4.2's role multi-select (a bounded,
closed set the admin picks from), but this needs per-row *configuration* (a limit
value), not just inclusion/exclusion, so it's built as a table, not a multi-select.

**Layout**: a table with **one row per feature in the entire catalog** (not just
currently-enabled ones — the admin needs to see and be able to enable *any* catalog
feature for this package, matching the "default-deny, absent = disabled" backend
semantics stated in the dispatch context: a feature not present in the config is
already effectively "disabled," so showing every feature with an unchecked box is the
honest representation of that default, rather than only showing already-enabled rows
and requiring a separate "add a feature" step).

Columns:
- **Feature** (name — plus the key in smaller/secondary text under or beside the
  name, so the admin can cross-reference against the Features screen; not the raw
  key alone, since name is the human-readable identifier admins reason with day to
  day).
- **Enabled** (a checkbox — checking/unchecking is the mechanism for "in config" vs.
  "absent/default-deny"; per the backend semantics, an *unchecked* row is simply
  omitted from the `PUT` payload's feature list on save, not sent as
  `{enabled: false}`, unless the real contract actually expects an explicit
  `enabled: false` entry rather than omission — confirm this against the real
  request-shape contract, flagged below, since it changes what the client
  constructs before calling `PUT`).
- **Limit** (a number input, enabled/editable only when that row's checkbox is
  checked — disabled/grayed when unchecked, since a limit is meaningless for a
  disabled feature; §1c's disabled-input convention applies). **Empty/blank = 
  unlimited**: when the admin leaves this field blank, render the input showing a
  gray placeholder text "Unlimited" (not a literal "0" or an error) — this is the
  field's genuine null-state, not an unset/invalid state, so it must look
  intentionally different from an empty-and-invalid required field elsewhere in this
  document (e.g. §6.2's `INVALID_NAME`); no `mat-error` styling on a blank Limit
  field. If the admin types a number, it commits as that integer limit; clearing it
  back to blank returns to "Unlimited" (`limit: null` on submit).

**Row states**: default (unchecked, limit disabled+blank+"Unlimited" placeholder);
checked-no-limit (checked, limit blank/"Unlimited" placeholder, this is a fully
valid, common combination — "unlimited access to this feature" — not a state
requiring the admin to enter a number); checked-with-limit (checked, limit has a
concrete integer); on load, pre-populate checked rows + their limit values from the
package's *existing* `PackageFeature` configuration (features absent from that
existing config render unchecked/blank, per the default-deny semantics above).

**Submission model — one atomic "Save feature configuration" button, separate from
the top section's "Save changes" button**: since `PUT .../features` is its own
endpoint (a full atomic replace, independent of the package's basic-fields `PATCH`),
this sub-section gets **its own save action**, not folded into the top section's
form — these are two genuinely independent server calls with independent success/
failure, and conflating them into one button would misrepresent that (§1c's
one-filled-primary-button-per-screen rule is about not having *two competing*
primary actions fighting for attention on one screen; two sequential, clearly
labeled, spatially-separated section-scoped save buttons — "Save changes" for basic
fields, "Save feature configuration" for the matrix — is the correct application of
that rule, not a violation of it, since each is unambiguously the "main action of
its own section," matching how §5.2 itself already treats its single form as one
section with one button — this is simply two sections instead of one).

**States**:
- **Loading (initial fetch of the catalog + this package's existing configuration)**:
  skeleton table rows for the matrix (matching §7.1/§7.2's convention) while both
  the full feature catalog and the package's existing `PackageFeature` rows are
  fetched (these are presumably two separate reads — the catalog list and the
  package detail — reconciled client-side into the matrix's initial checked/limit
  state; confirm whether the package-detail response already embeds its
  `PackageFeature` rows directly or whether a separate fetch is needed, flagged
  below).
- **Empty catalog (zero features exist in the platform at all)**: this sub-section
  cannot function without at least one catalog feature to configure. Render a
  dedicated empty-state message in place of the table: "No features have been
  defined yet. Create at least one feature before configuring this package." + a
  direct link to `/platform/features/new` — this is a genuine, spec-relevant edge
  case (a fresh platform with packages created before any feature), and pointing the
  admin at the actual next step (go create a feature first) is directly the "help
  users recognize/diagnose/recover" heuristic applied to a structural precondition,
  not an error.
- **Submitting**: the "Save feature configuration" button shows an inline spinner +
  disables itself; the entire matrix (every checkbox/limit input) disables for the
  duration, preventing edits mid-save (consistent with §3.3/§4.3's submit-disables-
  the-whole-form convention) — this is a single atomic replace, so a partial edit
  mid-flight would be genuinely ambiguous about what's being saved.
- **Success**: snackbar "Feature configuration saved." — remain on the screen,
  matrix reflects the just-saved state (re-fetch or trust the just-submitted local
  state, either acceptable since this is a full atomic replace with no server-side
  transformation expected of the submitted values — re-fetching is the safer,
  more server-truth-consistent choice per this document's established convention,
  and cheap given the catalog's small size).
- **Error — `404 FEATURE_NOT_FOUND`** (a selected feature was deleted concurrently,
  between this screen's load and this atomic save — a real, if narrow, race given
  Features and Packages are edited on separate screens by potentially different
  admin sessions): do **not** silently drop that row and resubmit. Show a
  non-dismissible-until-acknowledged inline banner above the table: "One or more
  features in this configuration no longer exist. The list has been refreshed —
  review and save again." then **re-fetch the full feature catalog** (removing the
  now-deleted feature's row from the matrix entirely) so the admin's next save
  attempt only references features that still exist — same "explain, auto-recover
  the stale reference, let the admin retry" pattern as §4.2's `ROLE_NOT_FOUND`
  handling on the role multi-select, applied to this table instead.
- **Error — network/5xx**: inline banner above the table, generic copy ("Something
  went wrong while saving. Please try again."), matrix re-enabled so the admin can
  retry without having lost their in-progress checkbox/limit edits (do not re-fetch/
  reset the matrix on a network failure the way the 404 case above does — a network
  error means nothing was necessarily wrong with the *data*, so preserve the admin's
  work-in-progress exactly as they left it).

**Accessibility** (beyond §1b/§3 baseline):
- This is a data table with interactive controls in cells — needs real `<table>`
  semantics (`<th scope="col">` for Feature/Enabled/Limit headers) so a screen-reader
  user gets row/column context per cell, not a div-grid.
- Each row's Limit input needs an accessible name that includes the feature name
  (e.g. `aria-label="Limit for {feature name}"`, not a bare generic "Limit" repeated
  identically across every row with no differentiation) — critical here since there
  are potentially up to ~20 visually-identical "Limit" inputs on one screen.
  Likewise each checkbox: `aria-label="Enable {feature name}"` or a properly
  associated visible `<label>` per row (not just a shared column header alone),
  since a screen-reader user tabbing through the table needs each control's purpose
  disambiguated without relying on visually scanning the row.
- The Limit input's disabled-when-unchecked state must be announced (disabled
  native `<input>`s are skipped by default in most screen-reader table navigation,
  which is correct here, but confirm the disabled state is reflected the moment the
  checkbox toggles, not just at initial render, for a screen-reader user tabbing
  through after checking a box).
- "Feature configuration saved."/the 404 banner both need the same `aria-live`
  conventions established throughout this document (assertive for the 404 case
  since it invalidates part of what the admin was looking at, polite for the plain
  success snackbar).

**Relevant heuristics**: visibility of system status (per-row disabled state
communicating "this limit doesn't apply" without a separate explanation); error
prevention (disabling the whole matrix during save, preventing a race with the
admin's own concurrent edits); help users recognize/diagnose/recover from errors
(the `FEATURE_NOT_FOUND` auto-refresh-and-explain treatment, not a bare rejection);
consistency & standards (blank-Limit-means-unlimited placeholder text mirrors
ordinary form "helper text" conventions rather than inventing a new visual language
for nullable-number inputs).

### 7.4 Tenant subscription reassignment (new section on the existing tenant-detail screen)

**Placement — confirmed**: a new section on the existing `/platform/tenants/:id`
screen (§3.2), **not** a new top-level nav item and not a new route. This matches
FR-PKG-7's framing exactly ("view/reassign *any tenant's* active subscription" — a
per-tenant action, viewed in the context of that tenant, the same relationship §3.2's
existing Suspend/Activate/Retry actions already have to that screen) and avoids
inventing a cross-tenant "Subscriptions" browse surface the FR doesn't ask for (§7.0's
reasoning). Add it as a new labeled section below the existing tenant-detail fields/
status badge, above or alongside the existing action buttons — a natural additional
"panel" on an already label/value-pair-structured screen (§3.2's `<dl>` convention),
not a full screen replacement.

**Section contents**:
1. **Current package** — plain label/value display: current package name + price
   (fetched as part of the tenant's existing subscription data, or via a small
   additional read if the tenant-detail endpoint doesn't already embed it — confirm
   against the real contract, flagged below) + the subscription's own status
   (ACTIVE/PAST_DUE/CANCELED) rendered via the **same `StatusBadgeComponent` pattern**
   as §3.1a (this is a genuine, three-value lifecycle state — color+icon+text: ACTIVE
   green `check_circle`, PAST_DUE the same neutral/amber-warning treatment §3.1a
   flagged as a missing token for `Suspended` — reuse that same to-be-added
   `--el-color-warning` token here rather than inventing a second ad hoc amber, CANCELED
   `--el-color-error`-toned `block`/`cancel` icon).
2. **Reassign control** — a `mat-select` dropdown listing every **active** package
   (per §7.2, packages with `isActive: true` — do not list inactive packages as
   reassignment targets, since an admin reassigning a tenant to a package that can no
   longer be "newly assigned" per §7.2's edit-screen deactivation semantics would be
   a direct contradiction; if the tenant's *current* package has since been
   deactivated, still show it as the current-package display in item 1 above, just
   don't offer it — or any other inactive package — as a *new* selectable option),
   each option rendered as "{name} — {price}" (both pieces of information the admin
   needs to make an informed reassignment decision, per "recognition over recall" —
   don't make them cross-reference the Packages screen separately to know what
   they're picking).
3. **Usage snapshot** (read-only, `GET /platform/tenants/:id/usage`) — a small
   read-only table directly below/beside the reassign control, **so the admin can see
   the effect of a prospective reassignment before committing to it** (the dispatch's
   explicit ask): columns Feature, Enabled (for the *current* package), Limit, Used,
   Remaining, Resets at (relative + absolute-on-hover, same convention as every other
   timestamp in this document). This table reflects the tenant's **current**
   subscription's usage, not a preview of what usage would look like under the
   newly-selected-but-not-yet-saved package — computing a hypothetical "what would
   usage look like under package X" preview client-side would require replicating
   the backend's enable/limit logic in the frontend and is out of scope for this
   phase; the value this table delivers is showing the admin *what the tenant has
   already consumed*, which is exactly the context that matters when deciding whether
   a reassignment (e.g. downgrading to a lower-limit package) would immediately put
   the tenant over a new, lower cap — the admin reasons about that comparison
   themselves using the visible current-usage numbers against the new package's
   known limits (visible via the Packages screen), rather than the UI attempting to
   pre-compute it.

**Confirmation before reassignment — decision: confirm required.** Justified against
§3.4's existing "Suspend needs confirm, Activate doesn't" asymmetric rule: that rule
turns on whether an action is a *reversal of a deliberate prior action* (no confirm)
or introduces a *new behavioral change with real impact* (confirm). Reassigning a
subscription is **never** simply "reversing" a prior state the way Activate reverses
Suspend — even reassigning back to a tenant's previous package is, from the system's
perspective, a fresh assignment with its own consequences (a different feature/limit
set potentially taking effect for real, live end-users immediately), and per the
usage-snapshot rationale above, a reassignment can materially reduce what a tenant's
users are currently able to do (e.g. a lower-limit downgrade could put an
already-over-the-new-limit tenant into an immediately-blocked state for some
feature). This is squarely the "meaningful action changing what a tenant can do"
case the task explicitly frames it as, so:
> "Reassign '{tenant name}' to '{new package name}' ({price})? This takes effect
> immediately and changes what this tenant's users can do." (Cancel / "Reassign")

Reuse `shared/ui/confirm-dialog`, destructive-adjacent but not literally destructive
styling — this isn't a delete, so the confirm button need not be `--el-color-error`-
styled the way §4.5's user-delete/§6.3's taxonomy-delete buttons are; a standard
filled primary-color confirm button is appropriate here (it's a consequential change,
not a destructive one), matching §3.4's own Suspend-confirm-dialog's non-error-toned
"Suspend" action button.

**States**:
- **Loading (initial fetch of current subscription + usage snapshot)**: skeleton
  block for this section specifically (not a full-page skeleton, since the rest of
  the tenant-detail screen may have already loaded — same "section-scoped loading"
  precedent as any partial-page async region).
- **Reassign submitting**: the reassign select + confirm dialog's action button
  disable/spin during the `PUT` call (§1c's standard pattern); the rest of the
  tenant-detail screen's other actions (Suspend/Activate/Retry) should also disable
  for the duration, consistent with §3.2's existing "disable all action buttons while
  any one action-in-flight" rule, since a subscription change and a status change are
  both tenant-mutating operations worth serializing at the UI level even if the
  backend doesn't strictly require it.
- **Success**: re-fetch and reflect the new current-package display + a fresh usage
  snapshot (the newly-assigned package's own feature/limit set — `used` figures
  presumably carry over/reset per the backend's own semantics, not something the UI
  invents), snackbar "Subscription updated to '{package name}'."
- **Error — `404` (package not found, a race — the selected package was deactivated/
  deleted between opening the dropdown and confirming)**: snackbar ("This package is
  no longer available. Refreshing options…") + re-fetch the active-packages list for
  the dropdown, same benign-race pattern as every other 404-race case in this
  document (§3.4/§4.5/§6.3/§7.1's precedent) — the admin simply re-picks from the
  refreshed list, no data was lost.
- **Usage snapshot — empty (package has zero configured features, i.e. an empty
  `PackageFeature` set — §7.3's "empty catalog" edge case's downstream effect)**:
  "This package has no configured features yet." rather than a blank table — mirrors
  §7.3's own empty-state honesty.
- **Usage snapshot — error** (the `/usage` fetch fails independently of the
  subscription fetch): inline error block + retry scoped to just this sub-table,
  not blocking the reassign control above it from being usable (the admin can still
  reassign even if the usage read specifically fails — these are independent reads
  with independent failure domains).

**Accessibility**: the reassign `mat-select`'s options need "{name} — {price}" as
their full accessible name (not just visually adjacent text); the usage table needs
the same real `<table>`/`<th scope="col">` semantics as §7.3's matrix; the
subscription status badge follows §3.1a's existing badge accessibility rules
verbatim (never color-only).

**Relevant heuristics**: error prevention + user control & freedom (confirm-before-
reassign, given real immediate impact on live tenant users); visibility of system
status (the usage snapshot existing specifically so the admin isn't reassigning
blind); help users recognize/diagnose/recover from errors (the active-packages-only
dropdown prevents ever selecting a target that would immediately fail server-side).

### 7.5 Loading / empty / error / accessibility / responsive — summary

All of §7.1–§7.4 already specify their own loading/empty/error states inline per
screen (per §1's per-feature completeness requirement); this subsection exists only
to confirm the cross-cutting conventions applied throughout, so `nexus-dev` isn't
left re-deriving them: skeleton-over-spinner for structural loads (§3.1's
convention), dim-existing-rows-plus-inline-spinner for refreshes, centered
empty-state blocks with a directly-usable CTA where one exists, inline
error-block-plus-retry for fetch failures, `MatSnackBar` for transient success
confirmations, non-dismissible-until-acknowledged banners for explain-and-fix 409s,
and benign-race auto-recovery (snackbar + re-fetch, no blocking dialog) for every
404-due-to-concurrent-deletion case.

**Accessibility** (cross-cutting, beyond what's called out per-screen above): every
new table in this section (Features list, Packages list, the feature-configuration
matrix, the usage snapshot) uses real `<table>`/`<th scope="col">` semantics, not
div-grids; every save/delete/reassign success or failure is announced via the
established `aria-live` snackbar/banner conventions; focus moves to the newly-
created resource's heading after every create-then-navigate flow (§3.3/§4.3's
precedent), and to the first invalid field or form-level banner on every rejection
(§2.2/§2.1's precedent, applied consistently rather than re-derived per screen).

**Responsive/mobile behavior** — same `Breakpoints.Handset` (~599.98px) breakpoint
and degradation pattern as §3.5/§4.1, applied per table in this section:
- **Features list / Packages list**: degrade to the established stacked-card
  pattern (§3.5) — one card per row, primary identifying text (Name) prominent, Key/
  Unit/Reset-period or Price/Active-badge as secondary text, Actions in a `mat-menu`
  overflow.
- **Feature-configuration matrix (§7.3)**: this is the one table in this section
  that does **not** degrade well to the stacked-card pattern as-is, since each "card"
  would still need to contain two interactive controls (checkbox + limit input) per
  feature — the stacked-card conversion here should render each feature as a small
  card with its name as the card title and the Enabled checkbox + Limit input
  stacked vertically beneath it (label above each control, full-width inputs) rather
  than attempting a horizontally-scrolling table — still avoiding §3.5's flagged
  horizontal-scroll-table anti-pattern, just with a two-control card body instead of
  the simpler name/badge/secondary-text card body used elsewhere.
- **Usage snapshot table (§7.4)**: same stacked-card degradation as the Features/
  Packages lists (read-only rows, no interactive controls to preserve, so the
  simpler card body applies directly).
- **Tenant-detail's new subscription section (§7.4)**: the reassign `mat-select` and
  confirm dialog need no special mobile treatment beyond Material's own responsive
  defaults (a `mat-select` panel and a `mat-dialog` already adapt to narrow viewports
  natively); the section's label/value "current package" display follows §3.2's
  existing `<dl>` mobile behavior (already established, not new).

### 7.6 Copy summary addendum (this feature)

| Condition | Placement | Copy |
|---|---|---|
| Features list: none yet | Empty-state block | "No features defined yet. Create the first one to get started." |
| Packages list: none yet | Empty-state block | "No packages defined yet. Create the first one to get started." |
| Feature edit: key locked (`isReferenced`) | Helper text under disabled Key field | "This feature's key can't be changed because it's used by one or more packages." |
| Feature: `FEATURE_KEY_EXISTS` | Per-field (key) | "A feature with this key already exists." |
| Feature: `FEATURE_KEY_IMMUTABLE` (race) | Snackbar + re-fetch | "This feature is now used by a package, so its key can no longer be changed. Refreshing…" |
| Feature delete confirm | Modal body | "Delete '{name}'? This cannot be undone." |
| Feature: `FEATURE_IN_USE` | Non-dismissible banner/follow-up dialog | "'{name}' is used by one or more packages and can't be deleted. Remove it from those packages' feature configuration first, then try again." |
| Feature: `FEATURE_NOT_FOUND` (delete race) | Snackbar | "This feature was already removed." |
| Feature create/edit success | Snackbar | "Feature created." / "Feature updated." |
| Package: `PACKAGE_KEY_EXISTS` | Per-field (key) | "A package with this key already exists." |
| Package create success | Navigate to edit screen + snackbar | "Package created — now configure its features below." |
| Package edit success | Snackbar | "Package updated." |
| Package deactivate confirm | Modal body | "Deactivate '{name}'? Tenants will no longer be able to have this package newly assigned to them." |
| Feature-config: empty catalog | Panel-replacing message | "No features have been defined yet. Create at least one feature before configuring this package." |
| Feature-config save success | Snackbar | "Feature configuration saved." |
| Feature-config: `FEATURE_NOT_FOUND` (race) | Non-dismissible banner + auto-refresh | "One or more features in this configuration no longer exist. The list has been refreshed — review and save again." |
| Feature-config: network/5xx | Inline banner above table | "Something went wrong while saving. Please try again." |
| Subscription reassign confirm | Modal body | "Reassign '{tenant name}' to '{new package name}' ({price})? This takes effect immediately and changes what this tenant's users can do." |
| Subscription reassign success | Snackbar | "Subscription updated to '{package name}'." |
| Subscription reassign: package not found (race) | Snackbar + re-fetch dropdown | "This package is no longer available. Refreshing options…" |
| Usage snapshot: empty | Inline message in place of table | "This package has no configured features yet." |

### 7.7 Flags for `nexus-dev` to confirm against the real Dev-9a contract

20. **`isReferenced` (or equivalent) flag on the feature list/detail response**:
    §7.1's preemptive Key-lock UX assumes this flag exists or can be cheaply added to
    `GET /platform/features` and the feature detail fetch. If Dev-9a's actual
    response shape doesn't include it, either get it added (preferred, since it's a
    small additive backend change and materially better UX than reactive-only) or
    fall back to always-editable-Key-until-a-409 (a strictly worse but functional
    fallback) — confirm which before building.
21. **Exact request-shape for `PUT /packages/:id/features`**: does the atomic
    replace payload expect only enabled rows (feature omitted entirely = disabled),
    or an explicit `{featureId, enabled: false, limit: null}` entry for every
    catalog feature regardless of state? §7.3 assumes the former (omission = disabled,
    matching the "default-deny, absent = disabled" semantics stated in the dispatch
    context) — confirm against the real DTO before building the payload-construction
    logic.
22. **Feature key format rule**: no accepted-key-pattern is given in the described
    surface; §7.1 uses placeholder guidance ("lowercase letters, numbers, hyphens,
    underscores") mirroring the project's existing subdomain/taxonomy-name format
    conventions — confirm the real validator's actual accepted pattern and adjust the
    per-field format guidance/pre-check accordingly, same open item pattern as
    §3.6/flag #8's `INVALID_SUBDOMAIN` precedent.
23. **Package price/currency input shape**: §7.2 assumes a numeric decimal-amount
    input converted client-side to `priceCents`, with currency either admin-selected
    or platform-fixed — confirm which, and confirm whether packages are implicitly
    recurring (monthly) for display-label purposes ("$29.00/mo" vs. bare "$29.00").
24. **Package deletion**: no `DELETE /platform/packages/:id` is listed in the given
    HTTP surface. §7.2 assumes packages cannot be deleted this phase (only
    deactivated via `isActive`) — confirm this is intentional (not an omission from
    the summarized surface) before deciding whether a Delete action belongs on the
    Packages screen at all.
25. **`isActive: false` enforcement semantics**: §7.2/§7.4 assume an inactive
    package can no longer be *newly assigned* to a tenant (and is therefore excluded
    from §7.4's reassignment dropdown) but does not affect a tenant *already* on that
    package. Confirm this is the real enforcement rule before finalizing the
    deactivate-confirm dialog's copy and the reassignment dropdown's filtering logic.
26. **Does the tenant-detail response already embed current-subscription data** (or
    does §7.4 need a separate fetch beyond the existing `GET
    /platform/tenants/:id`)? Confirm before deciding whether the new subscription
    section triggers its own independent loading state or shares the screen's
    existing single fetch.
27. **Package-detail response and its embedded `PackageFeature` rows**: confirm
    whether `GET /platform/packages/:id}` (implied, not explicitly listed in the
    given surface — only list/create/patch/features-PUT are given) already returns
    the package's current feature configuration inline, or whether the
    feature-configuration matrix (§7.3) needs a second, separate read to populate
    its initial checked/limit state.

---

## 8. Feature: Platform Admin — AI Model Allowlist & Per-Tenant Assignment (Dev-9c / BL-09a, FR-AI-2, FR-AI-3)

**Surface**: Platform admin console (§1a) — `platform-shell`, sidebar-nav admin
dashboard template, same shell §3/§7 already use. The allowlist screen is a new
top-level nav item; the per-tenant assignment control is a new section on the
existing tenant-detail screen (§3.2/§7.4's precedent), not a new route. Baseline
standards (§1b), shared visual conventions (§1c), and the structural patterns §3/§7
already established (skeleton-over-spinner, `StatusBadgeComponent`, confirm-dialog-
for-consequential-actions, `MatSnackBar` transient confirmations, benign-race
auto-recovery) apply throughout and are not restated below except where this feature
diverges.

### 8.0 Navigation

**Decision: a new "AI Models" top-level nav item**, positioned after "Packages"
(§7.0's sidebar order) — sidebar order becomes "Tenants" → "Features" → "Packages" →
"AI Models". Rationale, consistent with §7.0's own reasoning: the allowlist is an
independently browsable/manageable catalog resource (approve, enable/disable, set
default, remove) with its own lifecycle, the same shape as Features/Packages, not a
property of any single tenant — so it earns its own nav item and route rather than
living inside another screen. The **per-tenant assignment**, by contrast, is exactly
the "Subscriptions" case from §7.0: a property of one tenant, viewed/changed in the
context of that tenant, not a cross-tenant "which tenants use model X" browse
screen (no such requirement exists in FR-AI-3) — so it is a new section on the
existing `/platform/tenants/:id` screen, not a second nav item or route.

**Route**: `/platform/ai-models` (list + inline actions, §8.1). No separate create
route/screen — approving a model is a lightweight two-field action, better suited to
an inline "Approve model" row/dialog on the list screen itself (same reasoning as
§6's inline-create-row for single-purpose, low-field-count entries — an
`{openRouterModelId, displayName}` pair is closer in shape to a taxonomy entry than
to a Feature/Package's multi-field form) than a dedicated `/new` route.

### 8.1 AI Model Allowlist screen (`/platform/ai-models`)

**Flow**:
1. Admin reaches this via the "AI Models" sidebar item.
2. Table loads via `GET /platform/ai-models?includeDisabled=true` (the admin view
   must show disabled models too, since disabling/re-enabling/removing are all
   admin actions performed *from* this screen — a `?includeDisabled=true` list is the
   only view that makes those actions reachable at all).
3. Table columns (in order): Model ID (the OpenRouter `provider/model` string,
   monospace treatment recommended since it's a technical identifier the admin may
   need to copy/compare), Display Name, Status (Enabled/Disabled — reuse
   `StatusBadgeComponent`, §3.1a, with a two-value enabled/disabled treatment: enabled
   = `--el-color-success` tint + `check_circle` + "Enabled"; disabled = neutral
   `--el-color-outline`-toned + `visibility_off` + "Disabled" — not the error-red
   treatment, since disabled is an intentional, non-error admin state, same
   reasoning §3.1a gives for `Suspended` not being error-toned), Default (a distinct,
   non-status "★ Default" badge/chip on whichever row `isDefault` is true — this is
   a separate concept from Enabled/Disabled and must not be folded into the same
   badge, since a model is always both "Enabled" and, on exactly one row,
   additionally "Default"), Actions (per-row: Enable/Disable toggle, "Set as
   default", Remove — icon buttons or a `mat-menu` overflow, admin's choice per
   §3.1's existing precedent).
4. Primary action: "Approve model" button (top-right of the table header, filled/
   raised, the one primary action per §1c's one-filled-button rule) → opens an
   inline approve form, recommended as a `mat-dialog` (two fields, no multi-step
   flow — a lightweight dialog is simpler than a route round-trip here, same
   reasoning as §3.3's tenant-create modal recommendation).
5. Exit: sidebar nav elsewhere, or the per-tenant assignment control lives on the
   tenant-detail screen (§8.3), not here.

**Approve-model dialog** (`POST /platform/ai-models`):
- Fields: OpenRouter Model ID (text, e.g. `anthropic/claude-3.5-haiku` — placeholder
  text should show a real example id, since this is a technical, format-sensitive
  field most admins won't have memorized the exact shape of), Display Name (text,
  the human-facing label shown everywhere else in the product, e.g. tenant
  assignment dropdowns).
- Client-side validation: both non-empty before submit (on-submit-then-live
  pattern, §2.3); do **not** attempt to client-side-validate the OpenRouter
  `provider/model` shape beyond "contains a `/`" as a soft hint, since the
  authoritative format rule lives server-side (`INVALID_MODEL_ID`) and duplicating
  it risks drifting from the real accepted pattern — same reasoning §3.3 gives for
  `INVALID_SUBDOMAIN`.
- Submit → success (`201`): close the dialog, re-fetch the list, snackbar "Model
  '{displayName}' approved." If this is the **first-ever** approval (list was empty
  before this call), the response model is auto-designated default (FR-AI-2) —
  surface this explicitly in the same snackbar rather than silently updating the
  Default badge with no acknowledgment: "Model '{displayName}' approved and set as
  the platform default (first approved model)." — this is a meaningful,
  automatically-triggered side effect the admin didn't explicitly request, so it
  needs its own visibility (visibility of system status).
- `400 INVALID_MODEL_ID` → per-field error on the Model ID field: "This doesn't
  look like a valid OpenRouter model id. Use the `provider/model` format, e.g.
  `anthropic/claude-3.5-haiku`."
- `409 MODEL_ALREADY_APPROVED` → per-field error on the Model ID field (this is a
  field-specific, actionable, non-enumeration-sensitive condition, same class as
  §3.3's `SUBDOMAIN_TAKEN`): "This model is already on the allowlist."
- Network/5xx → form-level banner (§2.1 pattern): "Something went wrong while
  approving this model. Please try again."

**Enable/Disable toggle** (`PATCH /platform/ai-models/:id`, `{isEnabled}`):
- A row-level toggle switch (Material `mat-slide-toggle`), not a separate
  edit-screen field — this is a single boolean flipped in place, the same
  interaction weight as §3.4's Suspend/Activate row actions.
- **Disabling has no confirm dialog by default** — it is non-destructive (FR-AI-2:
  any tenant already assigned keeps using it unchanged) — *except* when disabling
  the current default, which the backend rejects outright with
  `DEFAULT_MODEL_REQUIRED` (see below); there is no "disable and also silently
  reassign a new default" combined action in the given API surface, so the UI does
  not attempt to offer one — it simply surfaces the rejection and tells the admin
  what to do next.
- Row-level loading: disable the toggle and show an inline spinner on it during the
  in-flight `PATCH`, mirroring §3's row-action-loading convention.
- `409 DEFAULT_MODEL_REQUIRED` (attempting to disable the current default): the
  toggle visually reverts to its prior (enabled) state, and a non-dismissible
  inline banner or dialog (§7's "explain-and-fix 409" convention, e.g. §7's
  `FEATURE_IN_USE` banner) explains the fix rather than a bare snackbar, since this
  is a blocking condition the admin must actively resolve, not a passive
  notification: "This is the platform default model and can't be disabled. Set a
  different model as the default first, then try again." — no auto-navigation
  needed since "Set as default" is another action on this same row's list.
- `404 MODEL_NOT_FOUND` (race — someone else removed the model between page-load
  and this click): snackbar + re-fetch, the same benign-race pattern as every other
  404-due-to-concurrent-deletion case in this document (§3.4/§4.5/§6.3/§7.4): "This
  model was already removed. Refreshing…"

**"Set as default" action** (`PUT /platform/ai-models/:id/default`):
- Available on every **enabled** row that is not already the default (hide or
  disable the action on the current-default row itself, and on any disabled row —
  error prevention, since the backend rejects a disabled target with
  `MODEL_DISABLED` and there's no reason to let the admin attempt it).
- **No confirmation dialog** — this is an atomic, immediately-reversible swap (the
  admin can always set a different model back as default with one more click), the
  same "no confirm for a reversible administrative toggle" reasoning §3.4 gives for
  Activate — unlike §7.4's subscription reassignment, this has no live-user-facing
  behavioral cliff of its own within this screen's frame (the actual effect — future
  AI generations using the new default — is a background/indirect consequence, not
  an immediate visible state change for anyone watching this screen the way a
  subscription downgrade is).
- Success: re-fetch the list (the Default badge atomically moves rows per the
  backend's same-transaction swap, §9.12), snackbar: "'{displayName}' is now the
  platform default model."
- `409 MODEL_DISABLED` (race — the row was disabled by another admin session
  between page-load and this click): snackbar + re-fetch, same benign-race pattern:
  "This model is disabled and can't be set as default. Refreshing…"
- `404 MODEL_NOT_FOUND` (race): same treatment as the toggle's 404 above.

**Remove action** (`DELETE /platform/ai-models/:id`):
- **Confirmation required** — hard delete is irreversible (§3.4/§6.3's
  "irreversible destructive action" bar, distinct from the reversible-toggle cases
  above), destructive-styled confirm dialog (`--el-color-error`-toned action button,
  same treatment as §4.5/§6.3's delete confirmations):
  > "Remove '{displayName}'? This permanently deletes the model from the
  > allowlist and cannot be undone."
- `409 MODEL_IN_USE` (`details.tenantCount`): this is a **block, not a race** —
  the admin needs to actually go fix something before retrying, not just
  auto-refresh and re-attempt. Follow §7's `FEATURE_IN_USE` non-dismissible-
  banner-or-follow-up-dialog convention, naming the count exactly as the API
  returns it: "'{displayName}' is currently assigned to {tenantCount} tenant(s)
  and can't be removed. Reassign those tenants to a different model or to the
  platform default first, then try again." Do not offer a "view affected tenants"
  deep link unless a real endpoint exists to list them (none is given in the
  documented surface) — flagged below.
- `409 DEFAULT_MODEL_REQUIRED` (attempting to remove the current default): same
  non-dismissible explain-and-fix treatment as the toggle's case above: "This is
  the platform default model and can't be removed. Set a different model as the
  default first, then try again."
- `404 MODEL_NOT_FOUND` (race): benign-race snackbar + re-fetch, same as above:
  "This model was already removed."
- Success (`204`): re-fetch the list, snackbar "'{displayName}' removed."

**States**:
- **Loading (initial)**: skeleton table, §3.1's convention.
- **Empty (no models approved yet)**: centered empty-state block: "No AI models
  approved yet. Approve the first one to enable AI-powered features across
  tenants." + "Approve model" CTA (same action as the header button). Note this is
  a meaningful product-wide gate, not a cosmetic empty state — per §9.12/FR-AI-1,
  every AI-dependent feature fails closed with `AI_NOT_CONFIGURED` while this list
  is empty; consider a small explanatory line under the headline making that
  consequence explicit to the admin rather than leaving it implicit: "Until a
  model is approved, AI-powered features (document processing, question
  generation) are unavailable to every tenant."
- **Error** (list fetch fails): inline error block + retry, §3's pattern.
- **Success**: table populated, Default badge on exactly one row (whenever the
  list is non-empty, per FR-AI-2's invariant — the UI does not need to handle a
  "no default" case on a non-empty list, since the backend guarantees this can't
  occur).
- **Row-level loading**: per-row spinner on the toggle/action being invoked,
  §3.1's row-action convention; other rows' actions remain interactive (unlike
  §3.2's whole-screen action-serialization — these are independent per-row
  mutations against independent models, not sequential mutations against one
  shared tenant record, so there's no correctness reason to freeze the whole table).

**Information architecture**: `/platform/ai-models`, fourth sidebar item after
Tenants/Features/Packages (§8.0).

**Accessibility** (beyond §1b/§3.1a baseline):
- The Default indicator must not be conveyed by a star icon alone — pair it with
  visible "Default" text (same "never color/icon-only" rule §3.1a establishes for
  status badges).
- `mat-slide-toggle` for Enable/Disable needs an accessible name identifying which
  model it controls (e.g. `aria-label="Enable {displayName}"`/`"Disable
  {displayName}"`), not a bare unlabeled switch relying on row-position alone.
- The non-dismissible `MODEL_IN_USE`/`DEFAULT_MODEL_REQUIRED` explain-and-fix
  banners follow §7's existing `aria-live` announcement convention for
  explain-and-fix 409s.

**Relevant heuristics**: error prevention (hiding/disabling "Set as default" on
disabled/already-default rows rather than letting the admin trigger a guaranteed
rejection); help users recognize/diagnose/recover from errors (the
`MODEL_IN_USE`/`DEFAULT_MODEL_REQUIRED` copy names the exact fix, not just the
failure); user control & freedom (no confirm on the reversible set-default toggle,
confirm required on the irreversible remove — same asymmetric-confirm principle as
§3.4/§7.4, applied consistently).

**Responsive behavior**: same `Breakpoints.Handset` degradation as §3.5/§7.5 —
desktop: full table; mobile: stacked-card list, one card per model (Model ID +
Display Name prominent, Status/Default badges as secondary, Actions in a
`mat-menu` overflow) rather than a horizontally-scrolling table.

### 8.2 Copy summary (this screen)

| Condition | Placement | Copy |
|---|---|---|
| No models approved yet | Empty-state block | "No AI models approved yet. Approve the first one to enable AI-powered features across tenants." |
| First model approved (auto-default) | Snackbar | "Model '{displayName}' approved and set as the platform default (first approved model)." |
| Model approved (not first) | Snackbar | "Model '{displayName}' approved." |
| Approve: `INVALID_MODEL_ID` | Per-field (Model ID) | "This doesn't look like a valid OpenRouter model id. Use the `provider/model` format, e.g. `anthropic/claude-3.5-haiku`." |
| Approve: `MODEL_ALREADY_APPROVED` | Per-field (Model ID) | "This model is already on the allowlist." |
| Disable: `DEFAULT_MODEL_REQUIRED` | Non-dismissible banner, toggle reverts | "This is the platform default model and can't be disabled. Set a different model as the default first, then try again." |
| Remove: `DEFAULT_MODEL_REQUIRED` | Non-dismissible banner | "This is the platform default model and can't be removed. Set a different model as the default first, then try again." |
| Remove: `MODEL_IN_USE` | Non-dismissible banner | "'{displayName}' is currently assigned to {tenantCount} tenant(s) and can't be removed. Reassign those tenants to a different model or to the platform default first, then try again." |
| Remove confirm dialog | Modal body | "Remove '{displayName}'? This permanently deletes the model from the allowlist and cannot be undone." |
| Remove success | Snackbar | "'{displayName}' removed." |
| Set-default success | Snackbar | "'{displayName}' is now the platform default model." |
| Set-default: `MODEL_DISABLED` (race) | Snackbar + re-fetch | "This model is disabled and can't be set as default. Refreshing…" |
| Any action: `MODEL_NOT_FOUND` (race) | Snackbar + re-fetch | "This model was already removed." |

### 8.3 Per-tenant AI model assignment (new section on the existing tenant-detail screen)

**Placement**: a new labeled section on `/platform/tenants/:id` (§3.2), alongside
§7.4's subscription section — same relationship to the tenant-detail screen, not a
new route (§8.0's reasoning above). Recommend ordering it directly below §7.4's
subscription section, since both are "what capabilities/spend this tenant currently
draws on" panels of the same conceptual kind.

**Section contents**:
1. **Effective model (read-only)** — a label/value display (`<dl>` convention,
   §3.2): "Current AI model: {displayName} ({openRouterModelId})" plus a small
   source indicator distinguishing `source: 'assigned'` ("Explicitly assigned")
   from `source: 'platform_default'` ("Using platform default") — this distinction
   is the entire point of surfacing this control per FR-AI-3, so it must never be
   collapsed into a single ambiguous "current model: X" line; use a small chip/
   secondary-text label, not just prose, so it's scannable.
2. **Assignment control** — a `mat-select` dropdown listing every currently
   **enabled** approved model (mirrors §8.1's list, filtered to enabled — a
   disabled model must not be offered as a new assignment target, since the
   backend would reject it with `MODEL_NOT_APPROVED` anyway; error prevention,
   same reasoning as §7.4's active-packages-only filter), each option rendered as
   "{displayName} ({openRouterModelId})" (both pieces of information, same
   "recognition over recall" reasoning §7.4 gives for package options). A distinct,
   always-present, separately-styled option/action **"Use platform default"**
   clears the tenant's explicit assignment (`DELETE
   /platform/tenants/:id/ai-model`) — render this as a clearly separate action
   (e.g. a "Clear assignment" text-button beside the dropdown, or an explicit first
   option in the select styled distinctly, e.g. italicized "— Use platform
   default —") rather than an ordinary selectable model, since it is semantically
   "unset," not "pick one of these," and conflating it with an ordinary dropdown
   row risks the admin not realizing it's the clear/reset action.
3. If the currently-assigned model is itself **disabled** (a valid, unbroken state
   per FR-AI-2 — a tenant already assigned to a model keeps using it even after
   disabling), still show it as the current effective-model value in item 1, but
   it must **not** appear as a selectable option in the dropdown per item 2's
   enabled-only filter — this mirrors §7.4's "current package may be inactive but
   still shown, not re-selectable" precedent exactly.

**Flow**:
1. Admin opens a tenant's detail screen, scrolls to (or a tab reveals) the AI
   Model section.
2. Selects a different enabled model from the dropdown, or clicks "Use platform
   default" to clear.
3. **No confirmation dialog** for either action — unlike §7.4's subscription
   reassignment (which the doc explicitly requires confirmation for, given
   immediate feature/limit impact on live tenant users), a model assignment
   change has no comparably sharp, immediately-blocking user-facing cliff — it
   changes which model *future* AI generations for that tenant use, not something
   an end-user is mid-task against at the moment of the change, and clearing to
   platform-default is explicitly documented as idempotent/always-succeeding
   (FR-AI-3), signaling this is meant to be a low-friction, freely-reversible
   control. This is a **judgment call, flagged below**, since it is a real
   divergent choice from §7.4's nearest analog on the same screen and `nexus-dev`
   should be able to override it if the product team disagrees.
4. Submit → success: re-fetch and reflect the new effective-model display
   (updated `displayName`/`openRouterModelId`/`source`), snackbar per below.

**States**:
- **Loading (initial fetch of effective model + enabled-models list for the
  dropdown)**: section-scoped skeleton (label/value + select-shaped placeholder),
  same "section-scoped loading" precedent §7.4 establishes for this same screen.
- **Assignment submitting**: dropdown/clear-action disabled + inline spinner
  during the `PUT`/`DELETE` call, consistent with §1c's standard in-flight
  pattern. Unlike §7.4's subscription reassignment, this does **not** need to
  freeze the screen's other actions (Suspend/Activate/Retry/subscription
  reassignment) — an AI-model assignment write is independent of tenant-status
  and subscription mutations with no shared-state race to guard against at the
  UI level.
- **Success (assign)**: snackbar "AI model updated to '{displayName}'."
- **Success (clear/unassign)**: snackbar "AI model assignment cleared — this
  tenant now uses the platform default ('{platform default displayName}')." —
  name the resulting default explicitly rather than just "cleared," since the
  admin's very next question is "so what does it use now," and the effective-
  model display answers that but the confirmation should too (visibility of
  system status).
- **Error — `409 MODEL_NOT_APPROVED`** (race: the selected model was disabled or
  removed between opening the dropdown and submitting — the API returns one code
  for both unknown and disabled per LLD §7.1, deliberately not distinguishing
  them to avoid enumerating disabled ids): treat as a benign race, same pattern as
  §7.4's `404` package-not-found case — snackbar + re-fetch the enabled-models
  list: "This model is no longer available for assignment. Refreshing options…"
- **Error — `404 TENANT_NOT_FOUND`** (the tenant itself was deleted concurrently —
  an edge case shared with every other action on this screen): same treatment as
  §3.2's existing not-found handling for this screen — this would only occur via
  an already-stale open tab, so a full inline "This tenant could not be found"
  replacing the section (or the whole screen, if the underlying tenant fetch
  itself now 404s) is appropriate rather than a scoped snackbar.
- **Error — network/5xx**: inline banner scoped to this section (§7.4's usage-
  snapshot-error precedent — an independent read/write failure domain from the
  rest of the tenant-detail screen): "Something went wrong while updating this
  tenant's AI model. Please try again."
- **Unassign when already unassigned**: per FR-AI-3, this is explicitly
  idempotent and always succeeds — the UI should not special-case or block a
  "Use platform default" click when the tenant is already on the platform default
  (e.g. by disabling the action) — just let it succeed silently/with the same
  success snackbar as any other clear, since the backend guarantees success and
  disabling the control for no visible reason would just be confusing dead UI.

**Accessibility**: the `mat-select`'s options need "{displayName}
({openRouterModelId})" as their full accessible name; the "Use platform default"
action needs a clear, non-ambiguous accessible name (e.g. `aria-label="Clear AI
model assignment and use platform default"`) distinguishing it from an ordinary
model option if implemented as a select option rather than a separate button; the
source indicator ("Explicitly assigned" / "Using platform default") is
programmatically associated with the effective-model value it qualifies (part of
the same `<dt>`/`<dd>` pair, not a visually-adjacent-only element).

**Relevant heuristics**: recognition over recall (showing both the resolved
model and its source, rather than making the admin infer whether an assignment
exists); visibility of system status (naming the resulting default explicitly on
clear, per above); consistency & standards (reusing the same section-scoped-
loading/independent-failure-domain pattern §7.4 already established on this exact
screen) tempered by the deliberate divergence on confirmation (flagged above).

**Responsive behavior**: no special mobile treatment beyond Material's native
`mat-select` responsiveness — same "no special treatment needed" note §7.4 gives
its own reassignment control.

### 8.4 Loading / empty / error / accessibility / responsive — summary

§8.1–§8.3 already specify their own states inline per screen (§1's per-feature
completeness requirement); this subsection exists only to confirm no new
cross-cutting convention was introduced — this feature reuses every established
pattern verbatim: skeleton-over-spinner for structural loads, row-scoped/section-
scoped spinners for partial updates, centered empty-state blocks with a directly-
usable CTA, inline error-block-plus-retry for fetch failures, `MatSnackBar` for
transient confirmations, non-dismissible banners for explain-and-fix 409s
(`MODEL_IN_USE`, `DEFAULT_MODEL_REQUIRED`), and benign-race auto-recovery
(snackbar + re-fetch) for every 404/race-class 409 (`MODEL_NOT_FOUND`,
`MODEL_DISABLED`, `MODEL_NOT_APPROVED`). The one genuinely new judgment call this
feature introduces is §8.3's no-confirm-on-assignment-change decision, flagged
below.

### 8.5 Copy summary addendum (per-tenant assignment)

| Condition | Placement | Copy |
|---|---|---|
| Effective model display | `<dl>` value + source chip | "{displayName} ({openRouterModelId})" + "Explicitly assigned" / "Using platform default" |
| Assign success | Snackbar | "AI model updated to '{displayName}'." |
| Clear/unassign success | Snackbar | "AI model assignment cleared — this tenant now uses the platform default ('{platform default displayName}')." |
| Assign: `MODEL_NOT_APPROVED` (race) | Snackbar + re-fetch dropdown | "This model is no longer available for assignment. Refreshing options…" |
| Assign/clear: network/5xx | Inline banner scoped to section | "Something went wrong while updating this tenant's AI model. Please try again." |

### 8.6 Flags for `nexus-dev` to confirm against the real Dev-9c contract

28. **No-confirm-on-assignment-change (§8.3 step 3)**: this document deliberately
    diverges from §7.4's confirm-required subscription-reassignment pattern on the
    same screen, on the reasoning that an AI-model change has no comparably sharp
    immediate user-facing impact and unassignment is explicitly idempotent/
    always-succeeding per FR-AI-3. This is a genuine judgment call, not a spec
    requirement either way — if the product team disagrees (e.g. because model
    choice materially affects generation quality/cost and warrants the same
    "this changes something live" pause as a subscription downgrade), add a
    lightweight confirm step consistent with §7.4's pattern instead.
29. **"View affected tenants" on `MODEL_IN_USE` (§8.1 remove action)**: the
    documented API surface returns only `details.tenantCount`, not the affected
    tenant ids/names. This document's copy names the count but does not offer a
    deep link to the affected tenants, since no endpoint to list them by model is
    given in LLD §7.1. If one exists or is cheap to add, a "View affected
    tenants" link in the `MODEL_IN_USE` banner would materially improve the
    remediation path (the admin currently has to go hunt for them tenant-by-tenant
    on the Tenants list) — confirm before deciding whether to add it.
30. **Row-level vs. dedicated-edit-screen shape for "Display Name" edits**: LLD
    §7.1 lists `PATCH /platform/ai-models/:id` accepting `{displayName?,
    isEnabled?}`, implying the display name is editable post-approval, but §8.1
    as written only exposes an Enable/Disable toggle and no explicit
    "rename" affordance. Confirm whether renaming an approved model is an
    expected admin capability for this phase; if so, add a simple inline-edit
    (click-to-edit text, or a small pencil-icon action opening a one-field
    dialog) on the Display Name column — the same one-field-PATCH shape as
    §4.2's simpler field edits, no new pattern needed, just confirm it's in scope
    before `nexus-dev` builds it either way.
31. **Model ID immutability**: this document assumes `openRouterModelId` is
    permanently fixed once approved (not part of the `PATCH` body per LLD §7.1)
    and therefore renders as plain, non-editable text everywhere it appears
    (allowlist table, tenant-assignment dropdown, effective-model display) —
    confirm this is correct rather than an omission from the summarized DTO.

---

## 9. Feature: Manual Exam Authoring UI (Dev-12b / BL-11, FR-AUTH-1, FR-AUTH-5)

**Surface**: Tenant application (§1a), inside the existing `tenant-shell` (§4.0) —
same sidenav/permission-gating pattern as §4/§6, not a new shell. Gated by
`exams.read`/`exams.create`/`exams.delete`, identical shape to §4's
`users.read/create/delete` and §6's `taxonomy.read/create/delete` gating (nav item
hidden without `exams.read`; route tree guarded by `permissionGuard('exams.read')`,
defense-in-depth per §4.0; create/delete actions additionally gated per-action by
`exams.create`/`exams.delete`, omitted rather than disabled-and-visible per §6's
precedent for a reader with no create/delete permission).

**Information architecture**: sidebar item "Exam Types", a peer of "Users" (§4.0),
not nested under "Settings" the way Taxonomy is (§6) — Exam Types are the tenant's
core content/product configuration, not a configuration-settings screen, so it
belongs at the sidebar's top level alongside Users. Route tree: `/exam-types` (list,
§9.1), `/exam-types/new` (create, §9.3), `/exam-types/:id` (detail, §9.2).

### 9.1 Exam Type list screen (`/exam-types`)

**Flow**: modeled directly on §4.1's user list.
1. Reached via the sidebar "Exam Types" item.
2. Table loads via `GET /api/exam-types`, default paging/order (no sort/filter
   params documented on this endpoint — ship unsorted/server-default order, same
   "don't build client-side cross-page sort" restraint as §3.1, flagged below).
3. Row action: "View" (or clicking the row) → detail (§9.2).
4. Primary action: "Create Exam Type" button (top-right, filled, one primary action
   per §1c) → the upload flow (§9.3), gated by `exams.create`.
5. Exit: sidebar nav elsewhere, or into a row's detail screen.

**States** (reuse §4.1/§6.1's shapes, not reinvented):
- **Loading (initial)**: skeleton table rows.
- **Loading (page change, if pagination exists on this endpoint)**: dim existing
  rows + inline spinner overlay, same refresh treatment as §3.1/§4.1.
- **Empty (no Exam Types yet)**: centered empty-state block: "No Exam Types yet.
  Create one to get started." + a "Create Exam Type" CTA (same button as the header
  action, gated by `exams.create` — if the viewing user lacks `exams.create`, the
  empty state drops the CTA and reads instead: "No Exam Types yet. Ask an exam
  manager to create one.").
- **Error** (list fetch fails): inline error block + retry — "We couldn't load Exam
  Types. Try again."
- **Success**: table populated.

**Table columns**: Name (primary text), Description (secondary/truncated text, "—"
if absent), Stage (name, not raw id — resolve via the same taxonomy data §6
manages), Total questions, Duration (minutes, rendered as "{n} min"), Created
(relative + absolute-on-hover, same treatment as §3.1/§4.1's "Created" column),
Actions (View; Delete, gated by `exams.delete`, visually de-emphasized per §1c's
destructive-action-distinction rule, same as §4.1's Delete treatment). Module
breakdown is **not** a list column (it would require a second fetch per row or an
overloaded API response) — it lives on the detail screen only (§9.2), consistent
with the dispatch's own framing ("module breakdown available via detail").

**Mobile degradation**: stacked-card list below 599.98px, same pattern as §3.1/
§4.1 — one card per Exam Type: name + Stage prominent, description as secondary
text, total questions/duration as compact metadata line, actions in a `mat-menu`
overflow.

### 9.2 Exam Type detail screen (`/exam-types/:id`)

**Flow**: modeled directly on §4.2's user detail screen, but **read-only** (no
inline-edit form this phase — the dispatch/API contract gives no `PATCH
/exam-types/:id`, only create-via-ZIP and delete; do not build edit affordances the
backend doesn't support).
1. Entered via the list's row/"View" action or direct URL.
2. Fetches `GET /api/exam-types/:id`.
3. Displays metadata (name, description, Stage, total questions declared, total
   minutes, created timestamp) as a semantic label/value block (`<dl>`/`<dt>`/`<dd>`
   per §3.2's accessibility precedent), plus a **modules table**: one row per
   module, columns Module name / Declared question count / Questions actually
   stored (from the detail response's per-module actual count) — if the two counts
   differ for a module (declared vs. actually stored, which can legitimately drift
   after authoring per FR-AUTH-3's note that availability is enforced at
   attempt-generation time, not authoring time), render the actual-stored count with
   a small neutral-informational note, not an error/warning treatment: "{n} stored"
   next to "{declared} declared" — this is expected, normal drift, not a fault
   condition, so it must not borrow the error-badge/warning-badge visual language
   §3.1a/§8 established for genuine problem states.
4. Delete action: a destructive-styled button ("Delete Exam Type", `--el-color-error`
   text/icon per §1c) placed at the top of the screen near the title/metadata block
   (not buried at the bottom) — gated by `exams.delete`, same prominence convention
   as §4.5's user-delete placement (a destructive action on a detail screen is a
   primary, not incidental, affordance).
5. Exit: "Back to Exam Types" breadcrumb/link → list, preserving prior list state
   (page/scroll), same convention as §3.2/§4.2/§6.1's back-navigation rule.

**States**:
- **Loading**: skeleton detail layout (label/value pairs + skeleton modules table),
  same convention as §3.2/§4.2.
- **Not found** (`404`): "This Exam Type no longer exists. It may have been
  deleted." + link back to the list — same phrasing pattern as §4.2/§6.1's
  entity-gone treatment.
- **Error** (fetch fails, network/5xx): inline error block + retry.
- **Success**: full detail + modules table rendered.
- **Delete-in-flight**: see §9.5.

**Accessibility** (beyond §1b/§3.2/§4.2 baseline):
- Modules table: standard `<table>` semantics with `<th scope="col">` headers (a
  small, non-sortable table — no need for `mat-sort`/ARIA-sort semantics since
  there's nothing to sort here, unlike a paginated list).
- The declared-vs-stored count note ("{n} stored" beside "{declared} declared")
  must be programmatically associated with its row (not a floating tooltip-only
  disclosure) so a screen-reader user gets both numbers without extra interaction.

**Relevant heuristics**: match between system and the real world (the
declared-vs-stored distinction is exactly this — the two numbers mean different
things and must not be visually conflated into one, potentially-misleading count);
consistency & standards (reusing §4.2/§6's detail-screen and back-navigation
conventions rather than inventing a new shape for this one read-only screen).

**Responsive behavior**: single-column stacked metadata block on mobile (same as
§4.2's form-to-stack pattern, minus the form since this is read-only); modules
table degrades to a stacked mini-card per module below 599.98px (module name +
declared/stored counts), consistent with §3.1/§4.1/§9.1's table-to-card mobile
convention.

### 9.3 ZIP upload/create flow (`/exam-types/new`)

**Route vs. dialog**: a **dedicated route is chosen** (not a dialog), diverging
from §3.3/§4.3's "either is fine" framing — this form includes a file upload with a
multi-second, must-not-be-interrupted server round-trip (structurally identical to
§3.3's synchronous-tenant-create concern) *plus* a dynamically-growing module
repeater that can get long (many modules). A modal risks feeling cramped and raises
an extra "can I close this mid-upload" question a full route avoids entirely (the
route itself becomes the natural "don't navigate away mid-upload" guard via a
route-leave confirmation, see below). This also keeps it consistent with detail
(§9.2) and list (§9.1) both being dedicated routes.

**Flow**:
1. Triggered by the list's "Create Exam Type" button (`exams.create`-gated) or
   direct URL (also guarded by `permissionGuard('exams.create')`, defense in depth).
2. Fields, in order:
   - **Name** (required, text) — duplicate-name errors surface here, see below.
   - **Description** (optional, textarea).
   - **Stage** (required, `mat-select` sourced from the tenant's taxonomy Stages —
     reuse the exact Stage picker component §6/§5 established, do not build a
     second one).
   - **Total questions** (required, integer input, `min=1`).
   - **Total minutes** (required, integer input, `min=1`).
   - **Modules** (required, at least one) — a dynamic repeater: each row is a
     Module name (text) + Question count (integer, `min=1`) pair, with a trailing
     "Remove" icon button per row (disabled/hidden on the row if it's the only
     remaining row — at least one module is required, so removing the last one
     isn't a legal end-state; per §6/§2.3's error-prevention-over-punishment
     principle, prevent this via a disabled remove button on the sole remaining
     row rather than allowing zero-then-erroring). An "Add module" button below the
     rows appends a new empty pair and moves focus into its name field
     (recognition/efficiency — the admin is about to type into it immediately).
   - **ZIP file** (required) — a Material file-drop/file-picker component (per
     LLD §10.3's `shared/ui` file-drop aspiration) supporting both click-to-browse
     and drag-and-drop, accepting `.zip` only (`accept=".zip,application/zip"` as a
     client-side hint, not a security boundary — the server is the real validator).
     Once selected, show the filename + file size, with a "Remove"/"Change file"
     affordance to swap it before submitting.
3. **Client-side pre-checks before submit** (error prevention, explicitly *not* a
   replacement for server validation — same caveat §6.2 establishes for its
   `INVALID_NAME` pre-check):
   - Name non-empty.
   - Stage selected.
   - Total questions ≥ 1, Total minutes ≥ 1 (integers).
   - At least one module row, every module row has a non-empty name and a
     question-count ≥ 1 (surfaced as per-row `mat-error`s, focus moves to the first
     invalid row on submit attempt).
   - A ZIP file has been selected (non-empty).
   - **Explicitly not pre-checked client-side** (left to the server, since
     duplicating this logic client-side risks drifting from the server's real
     parsing rules): ZIP internal structure/folder-to-module correspondence,
     per-question-file field completeness, and the totalQuestions-vs-sum-of-modules
     reconciliation — these three are exactly what `INVALID_ZIP_STRUCTURE`/
     `INVALID_QUESTION_FILE`/`QUESTION_COUNT_MISMATCH` exist to catch server-side; a
     client-side sum check of declared module counts vs. the Total questions field
     **is** cheap and safe to add as a pre-check (pure arithmetic on already-entered
     form fields, no ZIP parsing involved) and is recommended to catch the most
     common `QUESTION_COUNT_MISMATCH` case before a multi-second upload even starts.
4. Submit → state machine below.
5. Success → redirect to the **new Exam Type's detail screen** (§9.2), consistent
   with §3.3/§4.3's "land on the newly created resource" convention, with a
   `MatSnackBar` confirmation: "Exam Type '{name}' created."
6. Exit (cancel, before submit): "Cancel" link/button back to the list; if any
   field has been touched, a lightweight `beforeunload`-style guard on
   navigation-away is a reasonable, spec-compatible addition (same optional
   treatment as §4.2 step 6), not mandatory.

**State machine** (the dispatch's explicit ask — this is the section's core
contribution):

- **Idle**: form fully editable, one module row present by default (empty name/
  count, so "Add module" isn't required just to get to a legal minimum), "Create
  Exam Type" submit button enabled from first render (never pre-disabled pending
  client-side validity, per §2.3's standing rule).
- **Uploading**: on submit, run the client-side pre-checks (§9.3 step 3) first —
  if any fail, stay in Idle with per-field errors, no network call made. If they
  pass, disable every field and the submit button, and show a **determinate
  upload-progress indicator** (`mat-progress-bar` bound to the `XMLHttpRequest`/
  `HttpClient` upload-progress events Angular's `HttpClient` exposes for
  multipart POSTs) rather than an indeterminate spinner — a ZIP upload's progress
  is genuinely measurable (bytes sent), and a determinate bar is strictly better
  visibility of system status than an indeterminate one when the underlying
  operation supports it. Button label changes to "Uploading… {n}%".
- **Validating** (server-side ZIP parsing/DB validation, after the upload transfer
  itself completes but before the response returns): per the dispatch's own
  framing, no separate visual step is required if this phase is fast, but it
  **must not look stuck** — once the progress bar reaches 100% (upload transfer
  done) and the response hasn't returned yet, switch the progress bar to
  **indeterminate** mode and the button label to "Processing…" (not "Uploading…
  100%" frozen indefinitely, which reads as hung) — this is the one small addition
  beyond "no separate step needed": the *visual mode* of the same progress
  indicator changes from determinate to indeterminate as the operation moves from
  "measurable transfer" to "unmeasurable server-side work," giving continuous
  visibility of system status across the whole submit without a jarring extra
  step.
- **Error**: form re-enables, all previously-entered field values and the selected
  ZIP file **remain exactly as they were** (do not clear the form or require
  re-selecting the file on failure — the user must be able to retry immediately
  after fixing just the one thing that was wrong, per the dispatch's explicit
  requirement). Distinct copy per error code, detailed in the table below. Focus
  moves to the form-level banner (network/5xx/structural errors) or the specific
  invalid field (name/stage duplicate-style errors), matching the
  banner-vs-per-field split established across §2/§4/§6.
- **Success**: brief transitional state (progress bar completes, button shows a
  checkmark tick or simply proceeds straight to navigation — no dead-end
  "success" screen, same rule as §2.2/§3.3) → redirect to detail (§9.2 step 5).

**Error copy, per code** (each distinct, per the dispatch's explicit requirement —
no generic "upload failed" anywhere in this flow):

| Error code | Placement | Copy |
|---|---|---|
| `VALIDATION_FAILED` (missing/malformed DTO field not caught by client pre-checks) | Per-field, on whichever field the server names, or a form-level banner if the response doesn't identify a specific field | "Enter a valid value for {field}." (or the server's field-specific message verbatim if provided — prefer the server's exact wording here since it names the exact field, over inventing separate client copy that could drift) |
| `EXAM_TYPE_NAME_EXISTS` | Per-field, on Name | "An Exam Type named '{name}' already exists. Choose a different name." |
| `FILE_TOO_LARGE` (413) | Per-field, on the file picker | "This ZIP file is too large. Choose a smaller file." (name the actual size limit here once `nexus-dev` confirms it against the real multipart-size-limit config — placeholder wording otherwise, flagged below) |
| `INVALID_ZIP_STRUCTURE` | Form-level banner (not field-specific — this is about the archive's internal layout, not any one form field) | "This ZIP file's structure doesn't match the modules you've defined. Each module name must have a matching top-level folder in the ZIP, and every top-level folder must correspond to a declared module. Check the folder names and try again." |
| `INVALID_QUESTION_FILE` (server names the file and field) | Form-level banner | "The question file '{fileName}' is missing or has an invalid '{field}' value. Fix this file in your ZIP and re-upload." — pass the server's `fileName`/`field` straight through (safe to display verbatim per the dispatch's contract note), do not paraphrase into something vaguer |
| `EMPTY_MODULE` (server names the module) | Form-level banner | "The module '{moduleName}' has no valid questions in the ZIP. Add at least one valid question file to its folder and try again." |
| `QUESTION_COUNT_MISMATCH` — **form self-consistency** variant (`details: {declaredTotal, sumOfModules}`) | Form-level banner | "The total questions you entered ({declaredTotal}) doesn't match the number of questions found across your modules ({actualTotal}). Update the Total questions field or your modules, then try again." — surface both numbers from the response, don't just say "counts don't match" |
| `QUESTION_COUNT_MISMATCH` — **module-vs-ZIP-content** variant (`details: {module, declaredCount, actualCount}`, added Dev-12b retry) | Form-level banner | "The module '{module}' declares {declaredCount} questions, but the ZIP contains {actualCount} question(s) for it. Update that module's question count or fix your ZIP, then try again." — names the offending module, same name-the-entity convention as `EMPTY_MODULE`; pluralize the noun naturally ("1 question"/"2 questions"), never literal "(s)" in rendered copy |
| Network/5xx | Form-level banner | "Something went wrong while uploading this Exam Type. Please try again." |

All form-level banners here are `role="alert"`/`aria-live="assertive"` (same
convention as §2.1's login-failure banner) — these are async, must-read errors
appearing after a multi-second wait with no other visual cue, arguably even more
critical to announce reliably than a fast-failing login, since the user has just
waited through an upload.

**Accessibility**:
- File picker: a real, keyboard-operable `<input type="file">` (never a
  click-div-only drop zone with no keyboard path) with a visible, programmatically
  associated label ("Exam Type ZIP file"); the drag-and-drop surface is an
  *enhancement* layered over the real input, not a replacement for it.
- Dynamic repeater rows: each "Add module" click moves focus into the new row's
  name field (stated above); each "Remove" click moves focus to a sensible
  neighboring control (the previous row's Remove button, or the "Add module"
  button if the removed row was first) rather than dropping focus to `<body>` —
  this is the same "don't strand focus after a DOM removal" principle §6.3/§4.5's
  dialogs already apply to modal-closes, applied here to a repeater instead.
- Upload/processing progress: the `mat-progress-bar` region and its accompanying
  percentage/label text are wrapped in an `aria-live="polite"` region so a
  screen-reader user hears periodic status ("Uploading, 40 percent" /
  "Processing…") without needing sighted access to the bar — polite, not
  assertive, since this is ongoing status, not an error requiring interruption.
- Error banners: `aria-live="assertive"` per above; per-field errors use standard
  `mat-error`/`aria-describedby` wiring (§2.2's convention).

**Relevant heuristics**: visibility of system status (the dominant concern here,
per the dispatch's framing — determinate-then-indeterminate progress across the
upload/validate boundary); error prevention (client-side pre-checks, disabled
"remove" on the sole remaining module row); help users recognize/diagnose/recover
from errors (every server error code gets distinct, actionable copy naming the
specific file/module/numbers involved, never a generic failure message); user
control & freedom (form state is preserved verbatim after any failure, so
correcting one field never costs the user the rest of their work).

**Responsive behavior**: single-column stacked form at all breakpoints (same
convention as §4.2/§4.3's forms) — the module repeater's name+count pair sits
side-by-side on tablet/desktop (two inputs per row) and stacks vertically per row
on mobile (below 599.98px) so neither input becomes too narrow to use comfortably;
the "Remove" icon button stays at the row's trailing edge in both layouts. The
progress bar and its label span the form's full width at every breakpoint.

### 9.4 Delete flow

Modeled directly on §4.5/§6.3's confirm-dialog pattern (reuse
`shared/ui/confirm-dialog`, not a new component), triggered from the list row's
Delete action (§9.1) or the detail screen's Delete button (§9.2).

**Confirm dialog copy** — per FR-AUTH-5, deletion is a genuine hard cascade
(configuration, stored question content, cache entries, generated-question
sessions, and uniquely-tied images), which is materially more consequential than
§6.3's taxonomy-entry delete and warrants naming what's actually destroyed, similar
in spirit to §4.5's user-delete dialog's specificity:
> "Delete '{name}'? This permanently removes the Exam Type, all of its questions,
> and any generated content tied to it. This cannot be undone."

Dialog actions: "Cancel" / "Delete" (destructive-styled, `--el-color-error`,
initial focus on "Cancel" — same non-destructive-default-focus convention as
§4.5/§6.3).

**`409 EXAM_TYPE_HAS_ACTIVE_ATTEMPTS`** — per the dispatch's explicit instruction,
handle this gracefully as a real possibility even though it is currently
unreachable/stubbed false server-side; treat it with the same
explain-and-suggest-fix, non-generic-409 pattern §4.2/§4.5/§6.3 established for
`LAST_ADMIN_PROTECTED`/`TAXONOMY_ENTRY_IN_USE`, adapted to this error's actual
semantics — per FR-AUTH-5 this is a **deferred**, not permanently blocked,
deletion (it becomes possible once in-progress attempts finish/expire), so the
copy should say so rather than implying the admin must go take some manual
corrective action:
> "'{name}' can't be deleted right now because it has learners actively taking
> exams. Try again once those attempts are finished."

Render as a non-dismissible-until-acknowledged inline banner (replacing the
confirm dialog's content in place, or a follow-up dialog — either acceptable, same
§4.5/§6.3 either/or) rather than letting the dialog silently close. No "reassign"
or "remove references" call-to-action here (unlike `LAST_ADMIN_PROTECTED`/
`TAXONOMY_ENTRY_IN_USE`) since there is nothing for the admin to manually fix — the
correct guidance is genuinely just "wait," which the copy states plainly rather
than inventing a fake actionable step.

**`404 EXAM_TYPE_NOT_FOUND`** (race — already deleted elsewhere between page-load
and this click): snackbar ("This Exam Type was already removed.") + remove the row
in place (list) / redirect to the list (detail screen), same benign-race treatment
as §3.4/§4.5/§6.3's precedent.

**Success**: row removed from the list (re-fetch, server-truth convention) or
redirect from detail to the list, + snackbar ("Exam Type deleted.").

**Accessibility**: standard `confirm-dialog` a11y (focus trap, initial focus on
"Cancel"); the `EXAM_TYPE_HAS_ACTIVE_ATTEMPTS` follow-up message needs the same
`aria-live`/focus-movement treatment as every other error banner in this document.

**Relevant heuristics**: error prevention + user control & freedom (confirm
dialog, non-destructive default focus); help users recognize/diagnose/recover from
errors (`EXAM_TYPE_HAS_ACTIVE_ATTEMPTS`'s wait-don't-fix framing is a direct,
non-generic application of this heuristic, distinct from the reassign-style fixes
elsewhere in the document because the underlying condition is genuinely
time-bound, not admin-actionable).

### 9.5 Responsive behavior — summary

Covered inline per screen above (§9.1 list card-degradation, §9.2 detail
stack-and-mini-cards, §9.3 form stacking) — this subsection exists only to confirm
no new cross-cutting breakpoint convention was introduced, consistent with §8.4's
same closing move: every breakpoint behavior here reuses §3.5/§4.1's established
table-to-card and single-column-form patterns verbatim.

### 9.6 Copy summary (this feature)

| Condition | Placement | Copy |
|---|---|---|
| List: no Exam Types yet (`exams.create` present) | Empty-state block | "No Exam Types yet. Create one to get started." |
| List: no Exam Types yet (`exams.create` absent) | Empty-state block | "No Exam Types yet. Ask an exam manager to create one." |
| List/detail fetch failure | Inline error block | "We couldn't load Exam Types. Try again." / "We couldn't load this Exam Type. Try again." |
| Detail: not found | Panel-replacing message | "This Exam Type no longer exists. It may have been deleted." |
| Upload: uploading | Progress bar + button label | "Uploading… {n}%" |
| Upload: validating (post-transfer) | Progress bar (indeterminate) + button label | "Processing…" |
| Upload: `VALIDATION_FAILED` | Per-field or form banner | "Enter a valid value for {field}." (or server's verbatim field message) |
| Upload: `EXAM_TYPE_NAME_EXISTS` | Per-field (name) | "An Exam Type named '{name}' already exists. Choose a different name." |
| Upload: `FILE_TOO_LARGE` | Per-field (file picker) | "This ZIP file is too large. Choose a smaller file." |
| Upload: `INVALID_ZIP_STRUCTURE` | Form-level banner | "This ZIP file's structure doesn't match the modules you've defined. Each module name must have a matching top-level folder in the ZIP, and every top-level folder must correspond to a declared module. Check the folder names and try again." |
| Upload: `INVALID_QUESTION_FILE` | Form-level banner | "The question file '{fileName}' is missing or has an invalid '{field}' value. Fix this file in your ZIP and re-upload." |
| Upload: `EMPTY_MODULE` | Form-level banner | "The module '{moduleName}' has no valid questions in the ZIP. Add at least one valid question file to its folder and try again." |
| Upload: `QUESTION_COUNT_MISMATCH` (form self-consistency) | Form-level banner | "The total questions you entered ({declaredTotal}) doesn't match the number of questions found across your modules ({actualTotal}). Update the Total questions field or your modules, then try again." |
| Upload: `QUESTION_COUNT_MISMATCH` (module vs. real ZIP content) | Form-level banner | "The module '{module}' declares {declaredCount} questions, but the ZIP contains {actualCount} question(s) for it. Update that module's question count or fix your ZIP, then try again." |
| Upload: network/5xx | Form-level banner | "Something went wrong while uploading this Exam Type. Please try again." |
| Upload success | Navigate to detail + snackbar | "Exam Type '{name}' created." |
| Delete confirm dialog | Modal body | "Delete '{name}'? This permanently removes the Exam Type, all of its questions, and any generated content tied to it. This cannot be undone." |
| Delete: `EXAM_TYPE_HAS_ACTIVE_ATTEMPTS` | Non-dismissible banner/follow-up dialog | "'{name}' can't be deleted right now because it has learners actively taking exams. Try again once those attempts are finished." |
| Delete: `EXAM_TYPE_NOT_FOUND` (race) | Snackbar | "This Exam Type was already removed." |
| Delete success | Snackbar | "Exam Type deleted." |
| Re-map subjects: in-flight | Button label + `aria-live="polite"` status region | "Re-mapping subjects…" |
| Re-map subjects: success, mapped > 0 | Snackbar | "Re-mapped {mapped} of {examined} question(s) to a subject." |
| Re-map subjects: success, examined > 0, mapped = 0 | Snackbar | "No changes — the {examined} unmapped question(s) still couldn't be confidently classified. Try again later or after adding more Curriculum content." |
| Re-map subjects: success, examined = 0 | Snackbar | "Nothing to re-map — every question in this Exam Type already has a subject." |
| Re-map subjects: `AI_SERVICE_UNAVAILABLE` | Inline banner near the action | "The AI classification service is temporarily unavailable. Try again in a few minutes." |
| Re-map subjects: network/5xx | Inline banner near the action | "Something went wrong while re-mapping subjects. Please try again." |

### 9.7 Flags for `nexus-dev`

32. **No sort/filter params documented on `GET /api/exam-types`**: this document
    assumes server-default order is acceptable for this phase and deliberately
    does not add client-side sort (same cross-page-misrepresentation concern as
    §3.1/flag 7) unless the endpoint is confirmed unpaginated (in which case, per
    flag 18's reasoning, a full-list client-side sort would actually be safe) —
    confirm pagination shape against the real contract before deciding.
33. **`FILE_TOO_LARGE` limit value**: the copy above is deliberately generic
    ("too large") pending confirmation of the actual configured multipart size
    limit (nginx/NestJS body-parser/multer config) — once known, state it
    explicitly ("...must be under {X}MB") since a concrete number is strictly more
    actionable than a vague one.
34. **Upload-progress event availability**: the determinate-progress-bar design in
    §9.3 assumes `HttpClient`'s `reportProgress`/`observe: 'events'` upload-progress
    events are reliably available for a multipart `FormData` POST in this app's
    HTTP interceptor chain (LLD §10.2/§10.3) — confirm no existing interceptor
    (auth token attach, error mapping) interferes with event-stream observables
    before building; if progress events are unavailable for any reason, fall back
    to an indeterminate bar for the whole "Uploading…" phase rather than a fake/
    simulated determinate progression.
35. **Stage picker reuse**: this document assumes the Stage `mat-select` used here
    is the same shared component §5/§6 already built for taxonomy pickers
    elsewhere (populated from `GET /api/taxonomy/stages` or equivalent) — confirm
    the component is generic enough to reuse as-is (e.g. not hardcoded to a
    different parent-filtering context) rather than needing a near-duplicate.
36. **Module-name uniqueness within one Exam Type**: neither the spec excerpt nor
    the API contract given states whether two modules in the same Exam Type may
    share a name (which would make ZIP folder correspondence ambiguous). This
    document does not add a client-side "module names must be unique among
    siblings" pre-check, since inventing that rule without confirmation risks
    blocking a legal submission — confirm with the real `INVALID_ZIP_STRUCTURE`
    validation logic whether duplicate module names are rejected server-side, and
    if so, add this as a client-side pre-check too (cheap, safe, and would catch a
    likely-common mistake earlier).

### 9.8 Retroactive subject re-mapping (Dev-28 / BL-27, FR-AUTH-6 / FR-PDF-7)

**Surface**: Tenant application (§1a), same `tenant-shell`/detail-screen home as
§9.2 — this is not a new screen, it's a new action on the existing Exam Type
detail screen (`/exam-types/:id`), since the operation is scoped to one Exam
Type's questions and the detail screen is where that Exam Type's
metadata/modules already live. Gated by a **new, distinct permission,
`exams.remap_subjects`** — not folded into `exams.update` or `exams.delete`,
since re-mapping neither edits the Exam Type's declared configuration nor
destroys anything; it is its own capability an org may want to grant separately
(e.g. to a reviewer who classifies content but doesn't otherwise edit/delete
Exam Types), consistent with this document's "gate on the specific permission
the endpoint actually requires" principle (§4.0/§9's route-guard precedent).

**1. Placement.** A secondary (outlined/tonal, not filled-primary, not
error-colored) button labeled **"Re-map Subjects"** with a `sync`/refresh-style
icon (Material `autorenew` or equivalent — an icon that reads as "re-run a
classification pass," distinct from Delete's `delete`/error icon), placed in
the same top-of-screen actions row as §9.2 step 4's Delete button, **to Delete's
left** (non-destructive actions precede the destructive one, left-to-right,
matching the general reading-order convention of "safe action first, dangerous
action last" this document has followed wherever multiple actions share a row).
Gated by `exams.remap_subjects` — omitted entirely (not disabled-and-visible)
for a viewer without that permission, same omit-don't-disable convention as
§9's `exams.create`/`exams.delete` action gating. A brief caption line sits
directly under the button (visible whenever the button is, not just on
hover/focus, so it is discoverable without extra interaction): *"Re-checks only
questions that don't yet have a subject. Uses AI processing budget."* — this
sets cost/scope expectations up front without requiring a modal to convey them
(see confirm-dialog decision below).

**2. Confirm dialog: not used, by deliberate decision.** This diverges from
§4.5/§6.3/§9.4's confirm-dialog pattern, and the divergence is intentional
rather than an oversight: this action is non-destructive (it only ever fills in
a currently-`NULL` subject, never overwrites an existing mapping — per the
dispatch's own framing, "already-mapped questions are never touched") and
safely re-runnable (idempotent in the "no further changes" sense). The
confirm-dialog pattern in this document is reserved for actions that are
either destructive (§9.4's delete) or otherwise hard/impossible to undo
(§4.5/§6.3's precedent) — re-mapping is neither, so gating it behind an extra
click-through would be pure friction with no error-prevention benefit (it
would not prevent any state a user couldn't immediately and safely re-run out
of). The cost/budget concern the dispatch raises is real but is a
*disclosure* need, not a *confirmation-gate* need — it's addressed by the
caption text in item 1 and by disabling the button for the duration of any
in-flight run (item 3) so a user can't stack duplicate concurrent runs by
repeated clicking, rather than by an interstitial dialog. **Flagged below
(flag 39)**: if the real per-call AI cost for this operation turns out to be
materially higher than a typical PDF-processing classification call (e.g. it
re-examines every null-subject question in one shot rather than in small
batches), reconsider this decision in favor of a lightweight, non-blocking
"this will use approximately N AI calls — Run / Cancel" confirm dialog; nothing
in the spec excerpt given to this dispatch indicates that's the case, so the
no-dialog default stands unless that's confirmed.

**3. Loading (in-flight) state.** On click: the button disables immediately,
its label swaps to **"Re-mapping subjects…"** with a spinner replacing its
icon (same button-in-flight convention as §9.3's "Uploading…"/"Processing…"
button-label swap), and the caption line beneath it is replaced with the same
status text inside an `aria-live="polite"` region (see Accessibility below).
Because the backend call is a single request/response (not a pollable session
like PDF processing, per the route table's `202 + summary` shape returned
synchronously to the request rather than a background job the client polls),
no separate "queued" vs. "processing" distinction is needed — this is one
continuous in-flight state from click to response, unlike §9.3's
determinate-then-indeterminate two-phase progress (there is no measurable
byte-transfer phase here to justify a determinate bar; use a single
indeterminate spinner throughout). The rest of the detail screen (metadata,
modules table, Delete button) remains interactive during this call — re-mapping
does not lock the whole screen, only its own trigger button, since nothing
else on the screen depends on its result mid-flight.

**4. Success state.** On `202` + `{examined, mapped}`, re-enable the button,
restore its default label/icon and caption, and surface a `MatSnackBar` whose
copy distinguishes three outcomes rather than one generic "done" — because
"mapped: 0" is ambiguous on its face (it can mean "nothing needed mapping" or
"AI still couldn't determine anything," per the dispatch's own note) and
collapsing those into one message would misrepresent which case actually
occurred, violating match-between-system-and-real-world:
   - `examined === 0` (no unmapped questions existed to examine — either
     never had any, or an earlier run already resolved them all): "Nothing to
     re-map — every question in this Exam Type already has a subject."
   - `examined > 0 && mapped === 0` (candidates existed but the AI couldn't
     confidently classify any of them this run): "No changes — the {examined}
     unmapped question(s) still couldn't be confidently classified. Try again
     later or after adding more Curriculum content." (the "try again
     later/add more Curriculum content" clause gives the user something
     concretely actionable rather than leaving "couldn't be classified" as a
     dead end — grounding strength is the lever the spec associates with
     classification confidence elsewhere in this feature area, so pointing at
     it here is consistent with the system's actual behavior, not invented)
   - `mapped > 0` (the common, successful case): "Re-mapped {mapped} of
     {examined} question(s) to a subject." — naming both numbers, not just
     `mapped` alone, since "examined" gives the user a sense of how much of
     the previously-unmapped backlog is still outstanding (`examined - mapped`
     remain null after this run).

No page reload/re-fetch of the modules table is required as part of this
success flow — subject mapping is a per-question attribute, not something
reflected in the Exam Type detail screen's existing metadata/modules-table
counts (§9.2), so there is nothing on this screen to visually refresh; if a
future phase surfaces a per-question subject-mapping view on this screen, that
view should re-fetch after this action succeeds, but no such view exists yet
in scope for §9.2.

**5. Error states**, each distinct per this document's standing "no generic
failure message" rule (§9.3):

| Error | Placement | Copy |
|---|---|---|
| `AI_SERVICE_UNAVAILABLE` (FR-AI-1's named failure mode for an unreachable/timed-out AI service) | Inline banner directly below the button (not a snackbar — this failure plausibly recurs on immediate retry, so it should stay visible and adjacent to the retry trigger rather than disappearing on a timer) | "The AI classification service is temporarily unavailable. Try again in a few minutes." |
| Network/5xx (anything else unexpected) | Same inline banner placement | "Something went wrong while re-mapping subjects. Please try again." |
| `404` Exam Type not found (race — deleted elsewhere between page-load and this click) | Redirect to the list, same benign-race treatment as §9.4's `EXAM_TYPE_NOT_FOUND` | "This Exam Type was already removed." (reuses §9.4's exact copy — same condition, same message, not a variant) |

The inline banner (for the first two rows) persists until the user either
retries (re-clicks the button, which clears the banner and re-enters the
in-flight state) or navigates away — it is not auto-dismissed on a timer,
since an unresolved AI-availability problem is exactly the kind of status a
user should not lose track of mid-session.

**Accessibility** (beyond §1b/§9.2 baseline):
- The in-flight status text ("Re-mapping subjects…") and the success snackbar
  are both `aria-live="polite"` (ongoing/completed status, not an
  interruption-worthy error) — same polite/assertive split §9.3 already
  established for its own progress-vs-error regions.
- Error banners (`AI_SERVICE_UNAVAILABLE`, network/5xx) are
  `role="alert"`/`aria-live="assertive"`, matching every other error-banner
  convention in this document (§2.1, §9.3).
- Focus handling: focus **remains on the trigger button** throughout the
  in-flight state and after success/error (it is never moved away to a
  banner or snackbar) — unlike a modal dialog's focus-trap-then-return
  pattern (§4.5/§6.3), there is no dialog here to move focus into or out of;
  the button itself is the one stable, always-visible anchor, and its
  re-enabled state after completion is exactly where a keyboard user would
  expect to be able to act again (e.g. re-run, or tab onward) without having
  to hunt for where focus went.
- The button's disabled state during the in-flight run removes it from the
  tab order only in the sense that a disabled control is normally
  unfocusable/unactionable per platform convention — it must still be
  visible and correctly announced as disabled (not simply hidden), so a
  screen-reader user understands why it's currently unavailable rather than
  perceiving the button as having vanished.

**Relevant heuristics**: visibility of system status (the in-flight
label/spinner and the outcome-differentiated snackbar copy are the dominant
concerns here — a bare "mapped: 0" with no context would fail this heuristic
by leaving the user unable to tell success-with-nothing-to-do from
partial-failure); help users recognize/diagnose/recover from errors
(`AI_SERVICE_UNAVAILABLE` gets its own actionable, non-generic copy distinct
from a bare network/5xx failure, and the mapped:0-with-candidates case gives a
concrete next step rather than a dead end); error prevention is deliberately
**not** invoked here via a confirm dialog (see item 2) — the safe-repeatability
of the action is the reason error prevention doesn't require the usual gate,
not an oversight of that heuristic.

**Responsive behavior**: the button and its caption sit in the same
top-of-screen actions row as Delete (§9.2), which already stacks to a
vertical button group below 599.98px per that section's mobile convention —
Re-map Subjects stacks above Delete in that vertical arrangement (same
left-to-right-becomes-top-to-bottom order, safe action before destructive
action preserved), with its caption text remaining directly beneath it at
every breakpoint. The inline error banner spans the same full-width column
the metadata block already uses on mobile.

---

## 15. Feature: Cross-Tenant Migration Rollout as a Dedicated Ops Tool (Dev-29 / BL-28, FR-MT-5)

**Surface**: Platform admin console (§1a) — `platform-shell`, sidebar-nav admin
dashboard template, same shell §3/§7/§8 already use. Baseline standards (§1b),
shared visual conventions (§1c), and the structural patterns already established
(skeleton-over-spinner, `StatusBadgeComponent`, `ConfirmDialogComponent` for
consequential actions, `MatSnackBar` transient confirmations, benign-race
auto-recovery) apply throughout, except where explicitly diverged from below —
**and this feature diverges more than any prior one**, because it is the first
screen in this console that can trigger genuinely irreversible, unattended-by-
design DDL across every live tenant schema at once. Treat this section as
overriding the general "no-confirm-for-a-reversible-toggle" and
"benign-race-auto-recovery" defaults wherever it says so explicitly; it does not
silently relax any of them.

### 15.0 Navigation

**Decision: a new "Migrations" top-level nav item**, positioned **last**, after
"AI Models" (§8.0's order) — sidebar order becomes "Tenants" → "Features" →
"Packages" → "AI Models" → "Migrations". Rationale: every other item in this
sidebar is a browsable, CRUD-shaped resource catalog (tenants, features,
packages, models); this one is not a resource at all, it is a single-purpose,
high-risk operational trigger with no list/detail/edit lifecycle of its own —
placing it last visually separates "manage the platform's data" (the first four
items) from "run a dangerous one-off operation against the platform" (this one).
Use icon `build_circle` (reads as "maintenance operation," distinct from every
other item's catalog-style icon) and label **"Migrations"** (not "Tenant
Migrations" — the nav is already scoped to the platform-admin context, and the
route/heading can carry the fuller "Cross-Tenant Schema Migrations" name without
needing to repeat "Tenant" in the compact nav label).

**Route**: `/platform/migrations` — a single screen, no list/detail split (there
is exactly one action this screen exists to perform, plus a view of its last
result; no separate `/new` route the way §7/§8's catalog resources have, since
there is nothing to browse).

Optionally, consider a small warning-colored dot/badge on the nav item itself
if the design system already has a precedent for an "unusual/high-risk section"
nav indicator; none exists yet in this project, so do not invent one for this
phase alone — flagged below (flag 33).

### 15.1 Migrations screen (`/platform/migrations`)

**Flow**:
1. Admin reaches this via the "Migrations" sidebar item — no deep link/redirect
   into this screen from anywhere else in the console (nothing else references
   or depends on it), unlike, say, §7.4's tenant-detail-to-packages relationship.
2. Screen loads with **no automatic backend call on entry** — unlike every
   other screen in this document, there is no `GET` to populate a list; the
   screen renders an empty trigger form and, once a run has happened in this
   session, the last run's report beneath it. There is no persisted "history of
   past runs" view in the given API surface (`POST
   /platform/migrations/tenants/run` is the only endpoint) — the report shown is
   only the one from the run just triggered in this browser session, lost on
   navigation away/reload. This is a real, load-bearing gap for an audit-minded
   operator; **flagged below (flag 34)**, not silently worked around by
   inventing a client-side persisted history this phase.
3. Admin configures the trigger form (§15.2) and submits.
4. Request is synchronous (per LLD: the backend runs every tenant's migration
   sequentially and returns the full report in one HTTP response) — the screen
   shows an in-flight state for the whole duration (§15.4) with no polling, no
   navigating away and coming back to check progress. This can plausibly be a
   multi-minute call across many tenants; the in-flight UI must make that
   plausible duration legible (see §15.4) rather than reading as a hung request.
5. Response renders as the batch summary + per-tenant report (§15.5) in place,
   below the form.
6. Exit: sidebar nav elsewhere. There is no "undo" exit path — by the time a
   report is showing for a non-dry-run, the DDL has already run; leaving the
   screen does not roll anything back (this is stated explicitly in the
   confirm-dialog copy, §15.3, precisely so no admin is confused about this).

### 15.2 Trigger form

Rendered as a `mat-card` form at the top of the screen (not a dialog — unlike
§8.1's lightweight two-field approve-model dialog, this form has several
interdependent fields and its own risk-communication copy that deserves a
persistent, full-width, always-visible surface rather than something that can
be dismissed/lost by clicking outside it).

**Fields**:
1. **Mode** — `mat-radio-group`, not a `mat-select` (only two mutually-exclusive
   options, each with a consequence worth reading, not just picking from a
   closed dropdown list — radio buttons make both options and their
   descriptions visible at once, better recognition-over-recall for a
   high-stakes choice):
   - "Halt on error" (**default, pre-selected**) — helper text: "Stop the run as
     soon as any tenant fails or partially applies a migration. Tenants after
     the failure are left Pending." Defaulting to the safer, backend default
     (`halt-on-error`) matches the runner's own default and is the conservative
     choice for a rarely-used dangerous tool — never default an ops trigger to
     its more permissive option.
   - "Continue on error" — helper text: "Keep migrating remaining tenants even
     if one fails or partially applies. Use only when you specifically need a
     full pass despite isolated failures." The word "only" here is deliberate —
     this is the more dangerous of the two modes (a failure in tenant A doesn't
     stop tenant B, C, D... from also potentially being left in a bad state) and
     the copy should read as a caution, not a neutral alternative.
2. **Dry run** — `mat-checkbox`, **checked by default** (this is the single
   most important default-safety decision on this screen: an admin who doesn't
   deliberately think about this checkbox gets a dry run, not real DDL).
   Label: "Dry run (recommended) — check which migrations would run, without
   applying anything." Unchecking it visibly changes the submit button's label/
   color (§15.3) so the transition from safe to dangerous is never silent.
3. **Tenant ID restriction (advanced, optional, collapsed by default)** — a
   `mat-expansion-panel` labeled "Advanced: restrict to specific tenants" containing
   a multi-select (`mat-select multiple`, populated from the same tenant list
   §3.1 already fetches, showing name + subdomain per option, same
   recognition-over-recall reasoning §7.4/§8.3 give for similarly-shaped
   dropdowns) or a plain comma/chip-input of tenant ids if a dedicated
   multi-select is more than this phase needs. Left empty (the collapsed,
   un-interacted default), the request omits `tenantIds` entirely and the
   runner processes **every** tenant — this must be stated explicitly next to
   the control, not left implicit: "Leave empty to run against every tenant."
   This is a deliberate **judgment call to ship as advanced/collapsed rather
   than a prominent top-level field**, since restricting scope is the exception
   (most legitimate uses of this tool are "roll out to everyone"), and burying
   it slightly adds a small amount of intentional friction against an admin
   fat-fingering a partial run without meaning to — flagged below (flag 35) in
   case product wants it promoted to a first-class field instead.

**Submit button**: label and color are **state-dependent on the Dry Run
checkbox**, not a static "Run migrations" button throughout — this is the
screen's single most important piece of visibility-of-system-status:
- Dry run checked (default): `--el-color-primary` filled button, label "Run dry
  run".
- Dry run unchecked: `--el-color-error`-toned filled button (the same
  destructive-action color treatment §4.5/§6.3/§8.1 reserve for irreversible
  delete confirmations, applied here to the trigger button itself, not just a
  dialog — this is the only screen in the document where the primary trigger
  button itself, not just a confirm dialog's action button, carries error
  styling, precisely because unlike a delete button sitting next to safe
  content, this button's own click is the dangerous act), label "Run migrations
  on {N} tenant(s) — this will apply real changes" where `{N}` is either "all"
  (no restriction) or the selected count from the advanced panel — naming the
  blast radius directly on the button, not just inside a dialog the admin
  might not fully read.

### 15.3 Confirmation friction before a real (non-dry-run) run

This is the section that most sharply diverges from §9.8's deliberate
**no**-confirm-dialog precedent, and the reasoning must be stated up front so
`nexus-dev` doesn't pattern-match the two together: §9.8's re-map action is
non-destructive (only fills nulls) and safely re-runnable; this action can run
real, irreversible DDL against every tenant schema in the system, with a
"continue on error" mode that can leave a subset of tenants in a
`PartiallyApplied` state with **no automatic recovery path** — this sits
squarely in the "destructive or hard/impossible to undo" bucket the document
already reserves confirm dialogs for (§4.5/§6.3/§9.4), at a materially higher
blast radius than any single-record delete those sections cover.

**Rule: dry runs never require a confirm dialog; non-dry-runs always do,
regardless of mode or tenant-restriction scope.** Submitting with "Dry run"
checked goes straight through (it reads and reports, it changes nothing —
same "no friction for a genuinely inert action" reasoning as any read-only
operation elsewhere in this document). Submitting with "Dry run" unchecked
opens a `ConfirmDialogComponent` (the shared dialog used for §4.5/§6.3/§9.4's
deletions) with:
- **Title**: "Run real migrations across {N} tenant(s)?"
- **Body**, naming the mode and scope explicitly rather than a generic
  warning, so the admin is confirming the *actual* configured action, not a
  vague one (recognition over recall — the admin should not need to scroll
  back up to the form to remember what they configured):
  > "This will apply pending database migrations to **{N} tenant schema(s)**
  > {scope clause: "(every tenant)" or "(the {N} tenant(s) selected above)"}
  > in **{mode}** mode. This is a real, irreversible schema change and cannot
  > be undone by leaving this page or retrying. {mode-specific clause: if
  > continue-on-error — "Because 'Continue on error' is selected, some
  > tenants may be left partially migrated if a failure occurs, with no
  > automatic rollback."}"
- **Confirm action button**: `--el-color-error`-toned (same treatment as
  §4.5/§6.3's delete confirmations), label **"Run migrations"** (not a generic
  "Confirm"/"Yes" — the label restates the actual verb being confirmed, per
  this document's standing convention for destructive confirm buttons).
- **Cancel**: closes the dialog, returns focus to the submit button, no
  request sent — standard `ConfirmDialogComponent` behavior, no divergence.
- **No secondary "type the word CONFIRM to proceed" typed-confirmation
  step** — this document considers the named-scope, named-mode, named-
  consequence dialog above sufficient friction for this phase, consistent
  with how every other confirm dialog in this document is a single click-
  through, not a typed challenge; **flagged below (flag 36)** as a place
  product may reasonably want to go further (e.g. require typing the tenant
  count, or the word "MIGRATE") given the severity here is a step above
  anything else in the document, but this document does not invent that
  heavier pattern unprompted, since no other screen uses it and introducing
  a wholly new confirmation *mechanism* for one screen is itself a design-
  system decision worth an explicit product call, not a UX-agent default.

### 15.4 In-flight state

Because the call is synchronous and can plausibly run for minutes across many
tenants, the in-flight UI must actively communicate "this is working, not
stuck" for longer than the button-spinner pattern (§1c, §9.3, §9.8) elsewhere
in this document typically needs to hold up for:
- On submit (dry run or real, after the confirm dialog if shown): the entire
  form becomes disabled (all fields, not just the submit button — unlike
  §8.1's per-row-only freeze, there is exactly one operation this screen can
  perform and it is already running; there's nothing safe to let the admin
  touch concurrently, e.g. changing Mode mid-flight would be meaningless).
- Submit button label swaps to "Running migrations…" with its icon replaced by
  an indeterminate spinner (same button-in-flight convention as §9.3/§9.8), but
  additionally: a persistent status line beneath the form, inside an
  `aria-live="polite"` region, reading "Running migrations across tenant
  schemas. This may take several minutes — please keep this tab open." — the
  explicit "may take several minutes" / "keep this tab open" framing is new to
  this document and necessary here specifically, since every other in-flight
  state in this document (§9.3, §9.8) resolves quickly enough that users
  aren't likely to assume something's broken; this one plausibly won't, and a
  silent multi-minute spinner reads as a hang without it.
- No progress bar/percentage — the API returns the full report only on
  completion, with no partial/streaming per-tenant progress in this phase's
  contract (a single synchronous `POST`, not a polled job per the LLD) — do
  not fake a determinate progress indicator against data the client doesn't
  have. **Flagged below (flag 37)**: if a future phase adds a pollable job/SSE
  stream for this endpoint, upgrade this to a live per-tenant progress list
  (tenant name transitioning from Pending → Succeeded/Failed as each
  completes) — that would meaningfully improve this screen's usability for a
  large tenant count, but is out of scope for the synchronous-call contract
  given to this phase.
- If the tab/request errors out via a client-side timeout (the browser or a
  proxy times out a long-held connection before the backend responds): treat
  as a **network/5xx-class failure** (§15.5) with copy that explicitly warns
  the actual server-side run may still be in progress or may have completed
  despite the client not getting a response — this is a materially different,
  more consequential message than a normal "try again" network error, because
  blindly retrying could mean re-running DDL against tenants that already
  succeeded: "The connection was lost while migrations were running. The
  server-side run may still be in progress, or may have completed without a
  response reaching this page. Do not immediately retry — check tenant status
  or contact engineering before re-running, since re-submitting may re-attempt
  migrations that already succeeded." This is a deliberately unusual,
  non-generic error message for this document because retry safety is
  genuinely unlike every other network-error case covered elsewhere.

### 15.5 Report display

**Batch summary** (`mat-card`, top of the report region, appears once the
response is in):
- A label/value grid (or simple `<dl>`, §3.2's convention): Mode, Dry run
  (Yes/No), Started at / Finished at (both absolute timestamps, plus a
  computed duration, e.g. "3m 42s" — recognition over recall, don't make the
  admin do the subtraction), Total tenants, Succeeded, Failed, Skipped.
- If `dryRun: true`, prefix the whole summary card with a clearly visible,
  persistent (not auto-dismissing) banner: **"Dry run — no changes were
  applied."** in a neutral-informational tone (not error/success colored;
  reuse `--el-color-primary-container`-style informational treatment) — this
  must be impossible to miss, since misreading a dry-run report as a real
  result would be a serious comprehension failure given what this tool does.
- If `failed > 0` or any item is `PartiallyApplied`, the summary card itself
  takes on an alarmed treatment (`--el-color-error` left-border accent or
  equivalent, not just relying on the per-row badges below to carry that
  signal) — the admin should be able to tell the run had a problem from the
  summary alone, without scrolling into the per-tenant table.

**Per-tenant report**: a `mat-table` (desktop) with columns Tenant (schema
name — plus display name/subdomain if the response or a client-side join
against the already-fetched tenant list can supply it; if only `schemaName` is
available in the payload, show that plainly rather than inventing a lookup
this phase doesn't have data for — flagged below, flag 38), Status (badge,
new statuses added to `StatusBadgeComponent`'s existing status-badge system,
§3.1a — do not hand-roll a separate badge component for this screen), Applied
migrations (count, e.g. "3 applied" with the list itself available via an
expandable row/tooltip — not all migration filenames inline in the table by
default, since that could be a long list per tenant and would blow out row
height; recognition-over-recall satisfied by making the detail one click away,
not by forcing it into view for every row), Pending migrations (same
treatment), Error (the `error` string when non-null, truncated with a
"View full error" expansion if long — never silently truncated with no way to
see the rest), Duration (`durationMs` formatted as seconds, e.g. "1.2s").

**Status badge treatment** — extending §3.1a's system with this screen's five
new values (do not reuse `Active`/`Suspended`/etc.'s exact meanings even where
a status word is shared, since these are per-migration-run outcomes, not
tenant lifecycle states):

| Status | Badge treatment | Icon | Meaning/tone |
|---|---|---|---|
| `Succeeded` | `--el-color-success` tint | `check_circle` | This tenant's pending migrations applied cleanly (or, in dry-run mode, would apply cleanly) |
| `Pending` | Neutral `--el-color-outline`-toned | `schedule` | Not yet reached — only occurs after a `halt-on-error` run stopped partway; this is an informational, not alarming, state, but must read as "not yet run," not "done" |
| `Skipped` | Neutral `--el-color-outline`-toned, but visually distinct from `Pending` (different icon, not just different label, so a colorblind user relying on icon shape can still tell them apart) | `block` (or `remove_circle_outline`) | No pending migrations existed for this tenant — an expected, benign outcome, not a problem |
| `Failed` | `--el-color-error` tint | `error` | The migration attempt for this tenant failed outright — **but no partial DDL landed** (the runner's transactional attempt rolled back cleanly) |
| `PartiallyApplied` | **Most alarming treatment on the screen** — solid/high-contrast `--el-color-error` fill (not just a tint, to visually outrank the plain `Failed` tint), `warning`/`report` icon (distinct from `Failed`'s `error` icon — these are different failure classes and must look different, not just carry different text), plus a small "Needs manual review" secondary label directly beside the badge, not just in a tooltip | `warning` | Real DDL landed on this tenant's schema with **no completed-migration bookkeeping row** — the schema is now in an inconsistent state the runner itself cannot cleanly resume from; this is qualitatively worse than a clean `Failed` and the UI must not let it visually blend in as "just another kind of failure" |

Every `PartiallyApplied` row additionally gets a one-line explanatory caption
directly under its Error cell (not just relying on the badge/tooltip):
"Migration DDL applied but the completed-migration record was not written.
This tenant's schema state should be verified manually before re-running
migrations against it." — this is the single most important piece of copy
this screen introduces, since a `PartiallyApplied` result is exactly the case
where an admin might otherwise shrug and re-run the tool, potentially making
things worse.

**Table sort/filter**: not required for this phase (no stated need, and a
report is read once per run, not repeatedly re-queried the way §3.1's tenant
list is) — but if `failed > 0` or any `PartiallyApplied` exists, default-sort
those rows to the top (a client-side sort of the already-fetched report array,
not a server request) so the admin sees the problems first rather than having
to scan past every `Succeeded`/`Skipped` row first — small but real
recognition-over-recall/efficiency win given this report can span every
tenant in the system.

### 15.6 States (loading / empty / error / accessibility / responsive)

**Loading**: no initial-load skeleton (§15.1 step 2 — there is nothing to
fetch on entry). The only loading state on this screen is the in-flight
submit state, covered fully in §15.4.

**Empty**: before any run has been triggered this session, the report region
below the form simply does not render (not an empty-state block with an icon/
message — unlike §3.1/§8.1's "no records yet" empty states, there is no
absence-of-data to explain here, just "nothing has happened yet," which is
adequately conveyed by the report region's absence).

**Error** (the `POST` itself fails, distinct from a within-report `Failed`/
`PartiallyApplied` tenant item, which is a **successful** response describing
partial failure, not an HTTP error):
- `400` validation error (malformed `tenantIds`, invalid `mode` value, etc.):
  re-enable the form, inline banner directly above the form (not a snackbar —
  this needs to stay visible while the admin corrects the input, same
  reasoning §2.1 gives form-level errors generally): "There's a problem with
  this request: {backend-provided message if one exists, otherwise "please
  check the selected options and try again."}" — if the backend returns
  field-level detail (e.g. which tenant id is invalid), surface it per-field
  in the advanced tenant-selector rather than only in the generic banner.
- `401`/`403` (session expired, or a platform-admin permission specifically
  gating this endpoint that the current session lacks): standard console
  auth-failure handling — redirect to login (`401`) or a "You don't have
  permission to run migrations" inline block replacing the form (`403`), same
  pattern this console already uses elsewhere for auth failures.
- Network/5xx **before any response body is received at all** (distinct from
  the mid-run connection-loss case in §15.4, which gets the specific
  don't-blindly-retry warning): re-enable the form, inline banner: "Something
  went wrong while starting the migration run. No migrations were attempted.
  Please try again." — explicitly stating "no migrations were attempted" here
  is safe and important precisely because this failure mode (request never
  reached/was rejected by the server before any run began) is distinguishable
  from the ambiguous mid-run case, and telling the admin retrying is safe here
  (unlike §15.4's case) prevents unnecessary hesitation on a genuinely
  harmless-to-retry failure.

**Accessibility** (beyond §1b/§3.1a baseline):
- The in-flight status line (§15.4) and the batch-summary/report region on
  completion are both inside an `aria-live="polite"` region, so a screen-
  reader user is told when the run finishes without needing to poll focus
  back to the page manually — consistent with §9.8's polite-live-region
  precedent for its own in-flight-to-complete transition, extended here to
  also announce a short summary on completion (e.g. "Migration run finished.
  {succeeded} succeeded, {failed} failed, {skipped} skipped." — the live
  announcement should be this short summary line, not the entire per-tenant
  table, which would be an unusable wall of speech via screen reader on
  completion).
- The mid-run connection-loss warning and the `PartiallyApplied` explanatory
  caption are both `role="alert"`/`aria-live="assertive"` — these are the two
  places on this screen where an interruption-worthy announcement is
  warranted, distinct from the polite-channel completion summary above.
- `PartiallyApplied`'s badge must not rely on color/fill-weight alone to read
  as "worse than Failed" for a screen-reader or colorblind user — the
  "Needs manual review" text label (§15.5) and the distinct `warning` icon
  (vs. `Failed`'s `error` icon) are both load-bearing here, not decorative.
- The confirm dialog (§15.3) follows the existing `ConfirmDialogComponent`'s
  established focus-trap/return-focus-on-close behavior — no new dialog
  accessibility pattern needed.
- The advanced tenant-restriction `mat-expansion-panel` (§15.2) uses standard
  Material expansion-panel ARIA (`aria-expanded`, `aria-controls`) — no
  custom disclosure widget.

**Responsive behavior**: this is an infrequently-used admin tool, not a
routine daily-use screen, but should not be actively broken on a tablet-sized
admin viewport:
- Desktop: form fields laid out in a single column within the `mat-card`
  (this form has enough consequential copy per field that a multi-column
  layout would hurt scannability more than it would save vertical space —
  unlike §3.3/§7.1's more routine multi-field create forms); per-tenant report
  as a full `mat-table`.
- Below `Breakpoints.Handset` (§3.5/§7.5/§8.1's existing breakpoint): report
  table degrades to the same stacked-card-per-row pattern §8.1 establishes
  for its own table (Tenant + Status prominent, Applied/Pending/Error/Duration
  as secondary fields within the card) — the `PartiallyApplied` alarmed
  treatment and "Needs manual review" label must survive this collapse
  unchanged, not be dropped for space.
- This screen is realistically desktop-first in practice (an ops trigger an
  admin is unlikely to run from a phone), but the document does not special-
  case it out of mobile support entirely, consistent with every other
  platform-admin screen in this document.

### 15.7 Copy summary (this screen)

| Condition | Placement | Copy |
|---|---|---|
| Dry run checked (default) | Submit button | "Run dry run" |
| Dry run unchecked | Submit button | "Run migrations on {N} tenant(s) — this will apply real changes" |
| Non-dry-run confirm dialog title | Dialog | "Run real migrations across {N} tenant(s)?" |
| Non-dry-run confirm dialog body | Dialog | "This will apply pending database migrations to **{N} tenant schema(s)** {scope clause} in **{mode}** mode. This is a real, irreversible schema change and cannot be undone by leaving this page or retrying. {continue-on-error clause if applicable}" |
| Non-dry-run confirm action | Dialog button | "Run migrations" |
| In-flight status | `aria-live="polite"` line under form | "Running migrations across tenant schemas. This may take several minutes — please keep this tab open." |
| Dry-run report banner | Banner atop batch summary | "Dry run — no changes were applied." |
| Completion live-region summary | `aria-live="polite"` | "Migration run finished. {succeeded} succeeded, {failed} failed, {skipped} skipped." |
| `PartiallyApplied` row caption | Under Error cell, per row | "Migration DDL applied but the completed-migration record was not written. This tenant's schema state should be verified manually before re-running migrations against it." |
| Mid-run connection loss | Inline banner, `role="alert"` | "The connection was lost while migrations were running. The server-side run may still be in progress, or may have completed without a response reaching this page. Do not immediately retry — check tenant status or contact engineering before re-running, since re-submitting may re-attempt migrations that already succeeded." |
| Request rejected before any run started (network/5xx) | Inline banner above form | "Something went wrong while starting the migration run. No migrations were attempted. Please try again." |
| `400` validation error | Inline banner above form | "There's a problem with this request: {backend message, or "please check the selected options and try again."}" |
| `403` (lacks permission) | Inline block replacing form | "You don't have permission to run migrations." |

### 15.8 Flags for `nexus-dev` to confirm against the real Dev-29 contract

32. **No persisted run history in the given API surface** (§15.1 step 2): this
    document ships a screen that only ever shows the report from the run just
    triggered in the current browser session — nothing survives reload/
    navigation. For a tool this consequential, an audit trail (who ran what,
    when, with what result) is a strong candidate for a near-term follow-up
    even if out of scope for this phase; confirm whether the backend logs
    these runs anywhere queryable (the runner logs via `this.logger.log`
    per the LLD, which is not the same as an admin-facing queryable history)
    and whether a "Recent runs" list belongs on this screen once such an
    endpoint exists.
33. **No "high-risk section" nav indicator invented** (§15.0) — flagged in
    case product wants a visual differentiator (badge/dot/divider) marking
    this nav item as categorically different from the catalog items above it;
    not built this phase since no such pattern exists yet elsewhere in the
    design system and inventing one unprompted for a single nav item risks
    being inconsistent with whatever convention a future truly-standard
    pattern would want.
34. *(intentionally reserved to match numbering with the reasoning inline
    above — see flag 32 for the actual history-related flag; renumber if a
    future editor finds this awkward.)*
35. **Tenant-restriction field shipped as collapsed/advanced rather than
    first-class** (§15.2 field 3) — a deliberate judgment call to bias toward
    "run against everyone" being the frictionless path and scoped runs being
    the deliberately-sought-out path; confirm this matches how the tool is
    actually expected to be used in practice (e.g. if staged rollouts to a
    subset of tenants before a full rollout turn out to be the *normal*
    workflow rather than the exception, promote this field to a top-level,
    equally-prominent control instead).
36. **No typed/challenge-style secondary confirmation on the real-run confirm
    dialog** (§15.3) — this document's named-scope/named-mode/named-
    consequence dialog is the same *mechanism* (a single click-through
    `ConfirmDialogComponent`) used for every other destructive action in the
    product, deliberately not escalated to a heavier "type CONFIRM" pattern
    despite this action's higher blast radius, since introducing a new
    confirmation mechanism for one screen is a design-system decision this
    document does not make unilaterally. Revisit if product wants a stronger
    gate given the severity gap versus a normal delete.
37. **No live per-tenant progress during the run** (§15.4) — this phase's
    contract is a single synchronous `POST` with no pollable job/SSE stream,
    so the in-flight UI is necessarily a single indeterminate spinner plus
    static warning copy rather than a live-updating per-tenant status list.
    If a future phase changes the endpoint to a pollable/streamed job, this
    screen should be upgraded to show tenants transitioning from Pending to
    their final status live — that would be a meaningful usability
    improvement for large tenant counts and is worth prioritizing given how
    long this operation can plausibly run.
38. **Per-tenant report may only carry `schemaName`, not a friendly tenant
    display name/subdomain** (§15.5) — this document renders whatever the
    response actually contains; if the backend can cheaply join in
    `name`/`subdomain` (or the client can join against the already-available
    `GET /api/platform/tenants` list client-side), do so, since `schemaName`
    alone is a meaningfully worse scanning experience for an admin trying to
    recognize which tenants are affected — confirm which is actually planned
    before `nexus-dev` builds either the plain-schemaName version or a
    client-side join.

---

## 10. Feature: Curriculum Management, Document Ingestion & Semantic Search (Dev-15b / BL-12, FR-CUR-1/1a/2/3)

**Surface**: Tenant application (§1a), inside the existing `tenant-shell` (§4.0) —
same shell as §4/§6/§9, not a new one. This feature diverges from §4/§6/§9's
RBAC-permission-gating shape in one structural way, per FR-CUR-1/1a: **Curriculum
ownership is per-individual-user, not per-role**. Any Member or Tenant Admin can own
Curricula (this is core, everyday content for a Member's own use, not an
admin-configuration surface restricted by a `*.create`-style permission the way
Taxonomy/Exam Types are). Accordingly:
- The sidebar nav item "Curriculum" is visible to any authenticated tenant user with
  a curriculum-bearing role (Member, Tenant Admin) — not conditioned on a granular
  `curricula.read` permission the way §4/§6/§9 condition their nav items, since
  per FR-CUR-1 there is no "read-only, can't own" curriculum role described in the
  spec excerpt. **Flagged below (flag 37)**: confirm against the real RBAC/role
  model whether a role exists that should see Curriculum at all versus not (e.g. a
  pure "Learner" role that only ever consumes generated practice, never authors a
  Curriculum) — if such a role exists, gate the nav item on whatever capability
  distinguishes it, mirroring §4.0's "gate on permission, not role name" principle;
  do not hardcode a role-name check either way.
- **List scope is "my Curricula," not "all tenant Curricula."** Per FR-CUR-1a,
  ownership is enforced per-user; a Member's `/curricula` list shows only Curricula
  they own. Whether a Tenant Admin's oversight capacity (FR-CUR-1: "or a Tenant Admin
  acting in an oversight capacity") surfaces as a *separate* "all curricula in this
  tenant" admin view, or is limited to being able to open/modify a specific
  Curriculum they were given a link/id to, is not specified by the excerpt given to
  this dispatch. **This document specifies the narrower interpretation for this
  phase**: `/curricula` always shows the signed-in user's own Curricula only,
  regardless of role; a Tenant Admin's oversight ability manifests only if/when they
  navigate directly to another user's Curriculum's detail URL (§10.3's ownership
  handling below), not via a separate tenant-wide browse screen. **Flagged below
  (flag 38)**: confirm this scope decision against the real Dev-15a API contract
  (does `GET /curricula` accept any tenant-wide/all-owners query param for admins?)
  before building; if one exists, add an admin-only toggle/filter to §10.1 rather
  than leaving oversight access URL-only.
- Create/delete remain gated by **ownership at the resource level** (you can only
  delete/upload-to/search a Curriculum you own, or — per the oversight carve-out —
  that a Tenant Admin is permitted to act on), not by a static permission flag
  checked once at the nav level. The list's "Create Curriculum" button is therefore
  always shown to any user who can reach the "Curriculum" nav item at all (no
  separate create-permission omission logic like §6/§9's `*.create` gating), since
  per FR-CUR-1 anyone who can own a Curriculum can always create one.

**Information architecture**: sidebar item "Curriculum", a peer of "Users"/"Exam
Types" (§4.0/§9) — like Exam Types, this is core content a Member actively works
with, not a configuration-settings screen, so it does not live under "Settings" the
way Taxonomy does (§6). Route tree: `/curricula` (list, §10.1), `/curricula/new`
(create, §10.2), `/curricula/:id` (detail, §10.3).

### 10.1 Curriculum list screen (`/curricula`)

**Flow**: same shape as §9.1's Exam Type list.
1. Reached via the sidebar "Curriculum" item.
2. Table/list loads via `GET /curricula` (or equivalent, scoped to the current user
   per the ownership decision above), server-default order (no sort/filter params
   assumed documented — same unsorted-is-fine restraint as §3.1/§9.1 until
   confirmed otherwise).
3. Row action: "View" (or clicking the row) → detail (§10.3).
4. Primary action: "Create Curriculum" button (top-right, filled, one primary
   action per §1c) → create screen (§10.2). Always shown (see scope note above —
   no permission-based omission here).
5. Exit: sidebar nav elsewhere, or into a row's detail screen.

**States**:
- **Loading (initial)**: skeleton table/list rows, same convention as §3.1/§4.1/
  §9.1.
- **Empty — first-run (the user owns zero Curricula)**: this is the state this
  dispatch explicitly calls out as needing first-time-user framing, not a bare
  "no curricula yet" line — a new user's very first encounter with this screen is
  also plausibly their first encounter with the *concept* of a Curriculum in this
  product (it's a new noun this phase introduces), so the empty state should
  briefly explain *what a Curriculum is for* before prompting creation, not assume
  the user already knows:
  > "Curricula are where you upload your own documents so ExamLand's AI features —
  > semantic search, prompt-based practice, and grounded question generation — can
  > draw on your material instead of generic knowledge. Create your first
  > Curriculum to get started."

  Paired with a "Create Curriculum" CTA (same action as the header button) and a
  simple supporting illustration/icon (e.g. a stacked-documents icon), consistent
  with an onboarding-style empty state rather than the terser "No X yet." one-liner
  §3.1/§4.1/§9.1 use for their (non-first-run-framed) empty states — this is a
  deliberate content difference from those precedents, not a new visual pattern:
  reuse the same centered empty-state block component, just with longer,
  explanatory copy and no shorthand "yet." framing.
- **Error** (list fetch fails, network/5xx): inline error block + retry — "We
  couldn't load your Curricula. Try again." (same pattern as §3.1/§9.1, worded to
  reflect the "my Curricula" scope rather than a tenant-wide list).
- **Success**: list populated.

**Row/card content**: Name (primary text), Subject (name, resolved via the
taxonomy data §6 manages — not a raw id), Description (secondary/truncated, "—" if
absent), Document count (small metadata, e.g. "3 documents"), Created (relative +
absolute-on-hover, same treatment as §3.1/§4.1/§9.1's "Created" column). No Actions
column beyond "View" at the list level — Delete lives on the detail screen only
(§10.3), consistent with keeping destructive actions concentrated where the full
cascade impact (FR-CUR-8) can be explained, rather than a bare icon button in a
dense list row.

**Mobile degradation**: stacked-card list below 599.98px, same pattern as
§3.1/§4.1/§9.1 — one card per Curriculum: name + Subject prominent, description and
document count as secondary text.

### 10.2 Curriculum create screen (`/curricula/new`)

**Flow**:
1. Triggered by the list's "Create Curriculum" button, or direct URL.
2. Fields, in order:
   - **Name** (required, text).
   - **Description** (optional, textarea).
   - **Subject** (required) — a **three-level cascading select**: Education Level →
     Stage → Subject, since `Curriculum.subjectId` points one level deeper into the
     taxonomy than Exam Type's `stageId` (§9.7 flag 35's Stage-only `mat-select`).
     This is a **new composite control this phase introduces** (not a reuse of
     §9's single-level Stage picker, since selecting a Subject requires narrowing
     through two parent levels first) — build it once as a `shared/ui`
     `SubjectCascadeSelectComponent` (three `mat-select`s in a row on
     desktop/tablet, stacked on mobile — see Responsive below) rather than
     inlining three ad hoc selects on this one screen, so §6's taxonomy data is
     consumed the same way anywhere else in the app that eventually needs a
     Subject picker (e.g. a future Adaptive Lesson Practice screen per FR-CUR-6,
     out of scope this phase but foreseeable). Behavior:
     - Education Level select populates first (`GET
       /api/taxonomy/education-levels` — reuse §6's existing fetch, don't
       re-implement).
     - Selecting an Education Level enables and populates the Stage select
       (`GET /api/taxonomy/stages?educationLevelId=`), clearing any previously
       selected Stage/Subject (changing a parent invalidates the child selection —
       don't leave a stale, now-inconsistent Subject selected).
     - Selecting a Stage enables and populates the Subject select (`GET
       /api/taxonomy/subjects?stageId=`), clearing any previously selected
       Subject.
     - Stage and Subject selects are **disabled (not hidden)** until their parent
       is chosen — visible-but-disabled here (unlike §6.1's omit-entirely-if-
       ungated convention) is correct because this is a required sequential
       dependency intrinsic to the data model, not a permission gate; showing all
       three from the start also communicates the three-level shape up front
       (recognition over recall — the user sees immediately that Subject requires
       narrowing through two prior choices, rather than fields appearing out of
       nowhere).
     - If a level/stage has zero children (e.g. a Stage with no Subjects yet, per
       §6.1's empty-taxonomy-branch state), the next select shows a disabled state
       with helper text: "No {subjects} available under '{Stage name}'. Add one in
       Taxonomy settings first." — a dead end that names the fix and where to go,
       rather than a silently-empty dropdown.
3. **Client-side pre-checks before submit** (error prevention, not a replacement
   for server validation, same standing caveat as §6.2/§9.3): Name non-empty,
   Subject fully resolved (all three levels selected, not just Education
   Level/Stage).
4. Submit: **this is a fast, synchronous create** — unlike §9.3's ZIP-upload
   create, there is no file involved on this screen (per FR-CUR-1, document upload
   happens afterward on the detail screen, §10.3). Treat it like §3.3/§6.2's
   ordinary create-form loading, **not** §9.3's multi-second determinate-progress
   treatment: submit button shows an inline spinner + "Creating…" label, form
   fields disabled for the (expected sub-second) duration — no extra "this may take
   a while" banner (§9.3's explicit addition for an atypically long wait doesn't
   apply here).
5. Success → redirect to the **new Curriculum's detail screen** (§10.3), same
   "land on the newly created resource" convention as §3.3/§9.3, with a
   `MatSnackBar` confirmation: "Curriculum '{name}' created." The detail screen is
   also where the user immediately continues into document upload — landing there
   directly (rather than back on the list) puts the natural next step in front of
   them without an extra click.
6. Hard rejection errors: field-specific per-field errors on the relevant field
   (Name required / Subject required, whatever exact codes the real contract
   returns — **flagged below (flag 39)**, since the spec excerpt given doesn't
   enumerate a Curriculum-create error-code table the way FR-AUTH-1's ZIP-upload
   codes are enumerated; do not invent duplicate-name-style codes not confirmed
   against the real API). Network/5xx: form-level banner, "Something went wrong
   while creating this Curriculum. Please try again." — same pattern as
   §2.1/§3.3/§9.3.
7. Exit (cancel, before submit): "Cancel" link/button back to the list.

**States**: default (empty form, cascading selects at their initial
none-selected/disabled-downstream state), loading (submit-in-flight, per above),
error (validation / network, per above), success (redirect, no dead-end screen).

**Accessibility**:
- Each of the three cascading selects has its own visible, programmatically
  associated label ("Education Level", "Stage", "Subject") — not one shared label
  for all three.
- When a select is disabled pending its parent's selection, its disabled state and
  the reason are conveyed to assistive tech via the standard disabled-`mat-select`
  treatment plus `aria-describedby` pointing at helper text ("Select an Education
  Level first.") — a screen-reader user tabbing to a disabled control needs to know
  *why*, not just that it's inert.
- When a parent selection changes and clears a downstream selection, this is a
  non-obvious side effect a sighted user sees instantly (the Subject select
  visibly resets) but a screen-reader user might not — announce it via a brief
  `aria-live="polite"` note (e.g. "Subject selection cleared.") tied to the cascade,
  same "don't let a state change go unannounced" principle as §9.3's repeater
  focus-management rule, applied here to a value reset instead of a DOM removal.

**Relevant heuristics**: match between system and the real world (the taxonomy's
actual three-level structure is reflected directly in the control, not flattened
into a single searchable Subject dropdown that would hide the level/stage
relationship); error prevention (sequential disable-until-parent-chosen prevents an
impossible partial selection from ever being submitted).

**Responsive behavior**: the three cascading selects sit side-by-side (three
columns) on tablet/desktop; stack vertically, full-width, one per row on mobile
(below 599.98px) — same single-column-form-on-mobile convention as §4.2/§9.3.
Name/Description stack full-width at every breakpoint (standard text
field/textarea sizing).

### 10.3 Curriculum detail screen (`/curricula/:id`)

**Flow (entry/exit)**:
1. Entered via the list's row/"View" action, direct URL, or immediately after
   create (§10.2 step 5).
2. Fetches the Curriculum's metadata (`GET /curricula/:id`) plus its document list
   (either embedded in the same response or a separate `GET
   /curricula/:id/documents` — whichever the real contract shapes; flagged below,
   flag 40).
3. Displays: metadata header (Name, Description, Subject — resolved
   Level/Stage/Subject breadcrumb-style label, e.g. "Secondary > Grade 10 >
   Biology", Created timestamp), a **Delete Curriculum** action (destructive-
   styled, top of screen near the title, same prominence convention as §4.5/§9.2's
   detail-screen destructive-action placement), then the three concerns below,
   stacked top-to-bottom in this order: **Document upload** → **Document list** →
   **Search**. This ordering follows the natural task sequence (you upload before
   you have anything to search) and keeps the highest-friction, most-attention-
   needing zone (upload, with its multi-state machine) above the passive document
   list, with Search — the feature's actual payoff — last as the "now use it"
   capstone of the screen.
4. Exit: "Back to Curricula" breadcrumb/link → list, preserving prior list state,
   same convention as §3.2/§4.2/§6.1/§9.2.

**Ownership/not-found handling** (per FR-CUR-1a): if the current user is not the
owner and has no oversight access, or the id doesn't exist, treat both
identically at the UI layer regardless of which the backend actually
distinguishes (403 `NOT_CURRICULUM_OWNER` vs. 404) — per FR-CUR-1a's own note that
the choice between the two is an implementation decision, the UI must not leak
which one occurred (a distinct "you're not allowed" message would itself reveal
that *something* exists at that id to a user who shouldn't know that). Render the
same generic message either way:
> "This Curriculum doesn't exist or you don't have access to it." + a link back to
> the list.

**Top-level states**:
- **Loading**: skeleton detail layout (label/value header + skeleton upload zone +
  skeleton document list + skeleton search box), same convention as §3.2/§9.2.
- **Not found / not owned**: per above, replacing the whole screen body.
- **Error** (metadata fetch fails, network/5xx): inline error block + retry,
  replacing the screen body.
- **Success**: full detail rendered, the three sub-sections below each manage
  their own internal state independently (a search-in-progress doesn't block
  upload interaction and vice versa — these are three independent regions on one
  screen, not one shared state machine).

#### 10.3a Document upload zone

Structurally related to but **materially different from** §9.3's ZIP upload:
multi-file rather than single-file, no dynamic form fields alongside it (no
module repeater equivalent — just files), and each file gets its own independent
success/failure outcome rather than one all-or-nothing result (per FR-CUR-2: "each
[document] is validated and processed independently so one bad file doesn't block
the rest").

**Flow**:
1. A Material file-drop/file-picker (same underlying `shared/ui` file-drop
   component §9.3 uses, extended to accept `multiple`), click-to-browse or
   drag-and-drop, accepting whatever document types the real contract defines
   (assume common document formats — PDF/DOCX/TXT-class — pending confirmation;
   **flagged below, flag 41**, since the spec excerpt doesn't enumerate accepted
   extensions and `INVALID_EXTENSION` implies a real allow-list exists
   server-side that the client-side `accept` attribute should mirror once known).
2. Selecting files (one or many, additively — a second selection adds to, not
   replaces, the first) populates a **pending-files list**: filename + size per
   row, each with its own "Remove" icon button to drop it before uploading.
3. An "Upload {n} file(s)" button (pluralize naturally, never literal "(s)" per
   §9.6's established pluralization rule) submits all pending files in one
   multipart request (per FR-CUR-2's "multiple documents... in one request").
4. On completion (success or partial failure — this endpoint always returns per
   FR-CUR-2's per-file result list, never an all-or-nothing outcome), render the
   **per-file result list** in place of/below the pending list, and refresh the
   document list (§10.3b) to reflect any newly successful documents.
5. The upload zone resets to its idle/empty state after results are shown (ready
   for another batch) — the per-file result list persists on screen until the
   user dismisses it or starts a new upload (don't auto-hide results after a
   timeout; a mix of partial failures is exactly the kind of outcome a user needs
   time to read, not a transient toast-worthy confirmation).

**States**:
- **Idle/empty**: no files selected, drop zone shows its default prompt ("Drag
  files here or click to browse").
- **Files selected, not yet uploaded**: pending-files list populated, "Upload"
  button enabled, each row's "Remove" available; drop zone remains active so more
  files can be added before submitting.
- **Uploading**: pending-files list and "Upload"/drop-zone controls disabled,
  **indeterminate** progress indicator (per the dispatch's own framing —
  unlike §9.3's single-file determinate bar, there is no single meaningful
  "percent of this batch" figure across independently-sized, independently-
  processed files, so an indeterminate `mat-progress-bar` is the correct choice
  here, not a fabricated aggregate percentage). Button label: "Uploading…".
- **Per-file result list** (after the request resolves): one row per submitted
  file, each showing filename + a distinct success/failure treatment:
  - **Success**: `check_circle` icon (`--el-color-success`), "Processed" or
    similar confirmation text.
  - **Failure**: `error` icon (`--el-color-error`), the specific error code's
    mapped message (table below) — never a generic "failed" with no reason, per
    the same non-generic-error standard §9.3's error-copy table sets.
  A result list containing any failures does **not** block the successfully
  processed files from appearing in the document list (§10.3b) — success and
  failure are per-file, independent outcomes, and the UI must reflect that
  independence rather than treating the batch as a single pass/fail unit.
- **Disabled**: the whole zone (drop target, browse button, pending-list
  controls) is disabled during Uploading only; otherwise always interactive.

**Per-file error copy** (mirroring §9.3/§9.6's non-generic-per-code convention):

| Error code | Copy |
|---|---|
| `NO_EXTRACTABLE_TEXT` | "No readable text could be found in this file. If it's a scanned image, it may need OCR before it can be used." |
| `EMPTY_FILE` | "This file is empty." |
| `INVALID_EXTENSION` | "This file type isn't supported. {accepted formats list}." (fill in the real accepted-extensions list once flag 41 above is confirmed) |
| `INVALID_FILE_SIGNATURE` | "This file doesn't match its extension and may be corrupted or mislabeled." |
| `FILE_TOO_LARGE` | "This file is too large. Choose a smaller file." (name the actual size limit once confirmed, same treatment as §9.6's `FILE_TOO_LARGE` flag) |
| Any other/unrecognized code | "This file couldn't be processed." (generic fallback only for a genuinely unmapped code — every code named above must use its specific copy, this fallback is a safety net, not a first choice) |

**Accessibility**:
- Same file-input-is-real-and-keyboard-operable requirement as §9.3 (`<input
  type="file" multiple>`, drag-and-drop as an enhancement layered over it, not a
  replacement).
- The per-file result list is a real list (`<ul>`/`<li>` or equivalent ARIA list
  semantics), each item's success/failure icon paired with visible text (never
  color/icon alone, same §3.1a rule), and the whole result region is wrapped in an
  `aria-live="polite"` region so a screen-reader user is told results are ready
  without needing to re-discover the region after an indeterminate wait.
- Removing a pending file (before upload) moves focus to a sensible neighbor (the
  next remaining row, or the file-picker button if the list becomes empty) — same
  "don't strand focus after a DOM removal" principle as §9.3's repeater.

#### 10.3b Document list

**Flow**: a simple, non-paginated (assume small-N per Curriculum; **flagged
below, flag 42** if the real contract expects pagination here) list below the
upload zone, refreshed after any successful upload and after any delete.

**Row content**: filename, page count, chunk count (both as plain metadata text,
e.g. "12 pages · 84 chunks" — chunk count is meaningful to a technically-curious
user and costs nothing to show, consistent with this app's general
don't-hide-useful-metadata pattern elsewhere), a **Delete** icon button per row.

**States**:
- **Loading**: skeleton list rows (part of the detail screen's overall skeleton on
  first load; a lighter inline spinner-on-refresh treatment after an upload/delete
  completes, same refresh-vs-initial-load distinction as §3.1's table).
- **Empty (zero documents uploaded yet)**: a short inline message above/beside the
  upload zone rather than a large centered empty-state block (this is a
  sub-section of a busier screen, not a standalone list screen like §10.1 — a
  full-width illustrated empty state here would be visually heavier than the
  moment warrants): "No documents uploaded yet. Add one above to start building
  this Curriculum's knowledge base." This is **not** the first-run framing from
  §10.1 restated — §10.1's empty state introduces the *concept* of a Curriculum;
  this one is a narrower, in-context nudge toward the upload zone immediately
  above it.
- **Success**: list populated.
- **Delete confirm dialog**: reuse `shared/ui/confirm-dialog` (§4.5/§6.3/§9.4's
  established component), copy naming the real cascade per FR-CUR-8: "Delete
  '{filename}'? This permanently removes the document, its indexed content, and
  any Exam Types generated solely from it. This cannot be undone." — same
  specificity precedent as §9.4's Exam Type delete dialog, since FR-CUR-8's
  cascade (vectors, stored file, DB record, processing sessions, solely-derived
  Exam Types) is comparably consequential and deserves the same
  name-what's-destroyed treatment rather than a generic "Delete this document?"
- **Delete-in-flight**: the row's Delete button shows an inline spinner and
  disables itself (and, per §9.2's action-in-flight convention, the row's other
  interactive elements if any) for the duration.
- **Delete success**: row removed (re-fetch, server-truth convention), snackbar
  "Document deleted."
- **Delete: cascading Exam Type blocked** (`409`-class, mirroring §9.4's
  `EXAM_TYPE_HAS_ACTIVE_ATTEMPTS` deferred-cascade handling, since FR-CUR-8
  explicitly says cascading Exam Type deletion "follows the same rules as
  FR-AUTH-5"): same non-dismissible-banner treatment and copy pattern as §9.4 —
  "'{filename}' can't be deleted right now because an Exam Type generated from it
  has learners actively taking exams. Try again once those attempts are
  finished." **Flagged below (flag 43)**: confirm the actual error code this
  condition surfaces as against the real Dev-15a/Dev-15b contract before wiring
  this exact copy — the code name here is inferred from FR-CUR-8's cross-reference
  to FR-AUTH-5, not confirmed against a real API response.

#### 10.3c Search box + ranked results

This is the section requiring the most explicit state discipline, per FR-CUR-3's
own explicit product-behavior carve-out: **an empty query is a valid, boring
state, never an error.**

**Flow**:
1. A single search input (labelled "Search this Curriculum", not a generic
   unlabeled magnifying-glass icon field) sits above the results region.
2. The user types a query and submits (Enter key, or an explicit "Search" button
   — recommend **both** work identically, don't require the button click if
   Enter is the more natural input method here). Do **not** trigger a network
   call on every keystroke (live-search-as-you-type) unless debounced
   generously (≥400ms) and only once the query is non-trivially short-avoided
   (e.g. ≥2–3 characters) — semantic search against embeddings is not a cheap
   local filter operation the way a client-side table filter is, and firing a
   request per keystroke against an LLM-adjacent backend is wasteful; a
   debounced-live or explicit-submit approach are both acceptable, but explicit
   submit-on-Enter is the simpler, safer default for this phase.
3. Results render as a ranked list: each result shows its excerpt (with the
   matching query terms visually highlighted within it — `<mark>` element,
   sufficient contrast per §1b), the originating document's filename, and page
   number ("p. 14" or similar compact form).
4. Clearing the query (deleting all typed characters, or an explicit "Clear" (×)
   button inside the field) returns the results region to the **initial/no-query
   state**, not to an error or a "no results" state — per FR-CUR-3, an empty
   query is a legitimate, quiet non-state, and the UI must treat it identically
   whether the user never typed anything or typed something and then cleared it.
5. Exit: this sub-section has no navigation exit of its own — it's a persistent
   part of the detail screen, not a separate flow.

**States** (four genuinely distinct states — this is the crux of the dispatch's
explicit ask, so each is called out individually rather than collapsed):
- **Initial / no query yet**: the query field is empty and has never been
  submitted (or has been cleared back to empty). Results region shows a quiet,
  non-alarming placeholder — **not styled like an error or empty-state block**,
  since nothing has gone wrong and nothing was searched for:
  > "Search this Curriculum to find relevant excerpts from your uploaded
  > documents."
  Rendered as plain, low-emphasis body text (no error-red, no warning icon, no
  "empty state" illustration treatment) — visually, this should read as closer to
  helper/placeholder text than to any of §3.1/§4.1/§9.1's genuine empty-state
  blocks, precisely so it cannot be mistaken for "you searched and got nothing."
- **Loading**: on submit, show a lightweight inline loading indicator (a small
  spinner near the search input, or 2–3 skeleton result rows below it — either is
  acceptable; skeleton rows are slightly preferable since they preview the
  eventual result shape) while the request is in flight. The query field remains
  editable during this state (unlike a full-form submit-lock elsewhere in this
  document) — search is a low-stakes, cheaply-repeatable action; locking the
  input would be an unnecessary "flexibility & efficiency of use" cost for a
  screen a user may want to quickly refine and re-search on.
- **No results (a real, non-empty query matched nothing)**: this must read
  visibly differently from the Initial state above, since the two mean opposite
  things ("you haven't tried yet" vs. "you tried and it didn't work") — use the
  standard empty-state visual treatment this document uses elsewhere (§3.1/§4.1/
  §9.1's centered block), including the query itself for context:
  > "No results found for '{query}'. Try different or more specific search
  > terms, or make sure you've uploaded documents covering this topic."
  No "create" CTA here (there's nothing to create from a failed search) — the
  suggestion is behavioral (try different terms / check your documents), not a
  navigational shortcut.
- **Results**: ranked list per the Flow description above, each result a
  self-contained card/row (excerpt with highlighted terms, filename, page
  number). No pagination assumed for this phase unless the real contract caps
  and paginates results (**flagged below, flag 44**) — if capped, show a simple
  "showing top {n} results" note rather than inventing pagination controls
  speculatively.

**Explicit non-negotiable per the dispatch**: submitting an empty query, or
clearing the query box back to empty, must **never** render a validation message
("Please enter a search term"), form-level error banner, or any visual treatment
resembling one — this is the one place in this entire document where an empty
required-looking input is deliberately *not* validated as an error, because per
FR-CUR-3 the backend itself defines empty-query behavior as a normal `200 []`
response, not a rejected request; the UI should arguably not even issue the
network call for a purely-empty query (cheaper and equally correct to just show
the Initial state locally without a round-trip) but if it does call through,
the resulting `[]` must render as the Initial state's copy, not the "No results"
state's copy — these two states must never share rendering logic even though
both ultimately display "nothing," because conflating them is exactly the failure
mode this dispatch calls out.

**Accessibility**:
- The results region is an `aria-live="polite"` region so a screen-reader user
  submitting a search hears when results (or the no-results message) arrive,
  without needing to navigate to find them.
- Highlighted excerpt terms (`<mark>`) must not rely on color alone if the
  surrounding text is otherwise plain — Material/browser-default `<mark>`
  styling (background tint + normal text color) already satisfies this by using a
  background rather than a text-color-only cue; verify the chosen tint hits
  §1b's ≥3:1 contrast requirement for the highlighted region against the card
  background.
- Each result's document filename should be a real link/button if clicking it is
  meant to do anything (e.g. jump to the document row in §10.3b) — if no such
  interaction is planned this phase, it's fine as plain text, but don't make it
  *look* interactive (underlined/colored like a link) if it isn't.
- The search input has a real `<label>` ("Search this Curriculum") even if
  visually rendered as placeholder-styled text inside a search-affordance field —
  never placeholder-as-only-label (same rule as §1c's baseline).

**Relevant heuristics**: help users recognize/diagnose/recover from errors is
*deliberately not invoked* for the empty-query case (there is no error to
recognize) — the relevant heuristic here is instead aesthetic & minimalist design
(the Initial state's quiet, non-alarming copy) and match between system and the
real world (No-results genuinely differs from Initial, and the UI must reflect
that real difference, not paper over it with one shared "nothing to show" state).

**Responsive behavior**: search input full-width at every breakpoint; results
render as a single-column stacked list at all breakpoints (no multi-column
result grid) since excerpts are prose-length and benefit from full available
width for readability, consistent across desktop/tablet/mobile.

### 10.4 Responsive behavior — summary

Covered inline per sub-section above (§10.1 list card-degradation, §10.2 form
stacking, §10.3a/b/c each specifying their own breakpoint behavior) — consistent
with §9.5's same closing move, no new cross-cutting breakpoint convention is
introduced here beyond the new `SubjectCascadeSelectComponent` (§10.2) and the
indeterminate multi-file progress pattern (§10.3a), both already specified above.

### 10.5 Copy summary (this feature)

| Condition | Placement | Copy |
|---|---|---|
| List: first-run empty (zero Curricula owned) | Onboarding-style empty-state block | "Curricula are where you upload your own documents so ExamLand's AI features — semantic search, prompt-based practice, and grounded question generation — can draw on your material instead of generic knowledge. Create your first Curriculum to get started." |
| List fetch failure | Inline error block | "We couldn't load your Curricula. Try again." |
| Create: network/5xx | Form-level banner | "Something went wrong while creating this Curriculum. Please try again." |
| Create success | Snackbar + navigate to detail | "Curriculum '{name}' created." |
| Detail: not found / not owned | Panel-replacing message | "This Curriculum doesn't exist or you don't have access to it." |
| Upload: `NO_EXTRACTABLE_TEXT` | Per-file result row | "No readable text could be found in this file. If it's a scanned image, it may need OCR before it can be used." |
| Upload: `EMPTY_FILE` | Per-file result row | "This file is empty." |
| Upload: `INVALID_EXTENSION` | Per-file result row | "This file type isn't supported. {accepted formats list}." |
| Upload: `INVALID_FILE_SIGNATURE` | Per-file result row | "This file doesn't match its extension and may be corrupted or mislabeled." |
| Upload: `FILE_TOO_LARGE` | Per-file result row | "This file is too large. Choose a smaller file." |
| Document list: empty | Inline in-context message | "No documents uploaded yet. Add one above to start building this Curriculum's knowledge base." |
| Document delete confirm | Modal body | "Delete '{filename}'? This permanently removes the document, its indexed content, and any Exam Types generated solely from it. This cannot be undone." |
| Document delete: cascading Exam Type blocked | Non-dismissible banner | "'{filename}' can't be deleted right now because an Exam Type generated from it has learners actively taking exams. Try again once those attempts are finished." |
| Document delete success | Snackbar | "Document deleted." |
| Search: initial/no query | Quiet placeholder text (not an empty-state block) | "Search this Curriculum to find relevant excerpts from your uploaded documents." |
| Search: no results (real query) | Empty-state block | "No results found for '{query}'. Try different or more specific search terms, or make sure you've uploaded documents covering this topic." |

### 10.6 Flags for `nexus-dev`

37. **Curriculum nav-item gating**: confirm against the real RBAC/role model
    whether any tenant role should be excluded from seeing "Curriculum" in the
    sidebar at all (e.g. a pure Learner role) — this document defaults to showing
    it to any user capable of owning a Curriculum, gated on capability, not role
    name, per §4.0's standing principle.
38. **List scope — "my Curricula" vs. tenant-wide oversight view**: this document
    assumes `/curricula` is always scoped to the signed-in user, with a Tenant
    Admin's FR-CUR-1 oversight capacity reachable only via direct URL to a
    specific Curriculum's detail screen, not a separate all-curricula browse
    screen. Confirm against the real `GET /curricula` contract (any tenant-wide
    query param for admins?) before building; add an admin filter/toggle to §10.1
    if one exists rather than leaving oversight access URL-only.
39. **Curriculum-create error-code table**: the spec excerpt given to this
    dispatch doesn't enumerate a Curriculum-create error-code table the way
    FR-AUTH-1's ZIP-upload codes are (§9.3/§9.6). This document assumes plain
    required-field validation only (Name, Subject) plus a generic network/5xx
    banner; confirm the real contract for any additional codes (e.g. a
    duplicate-name constraint) before shipping, and extend §10.2/§10.5's copy
    table to match rather than leaving an unhandled code to fall through to the
    generic banner.
40. **Document-list data source**: this document assumes the Curriculum detail
    fetch either embeds the document list or requires one additional call (`GET
    /curricula/:id/documents`) — confirm the actual response shape so the detail
    screen's loading/skeleton sequencing (one combined fetch vs. two) is built
    correctly (a combined fetch means one skeleton-to-success transition; two
    separate fetches mean the document list and metadata header could each
    resolve at different times, requiring their own independent
    loading/success states within the already-independent-per-subsection model
    §10.3 establishes).
41. **Accepted document extensions**: `INVALID_EXTENSION` implies a real
    allow-list exists server-side; the spec excerpt doesn't enumerate it. Confirm
    the exact accepted extensions (assume PDF/DOCX/TXT-class pending
    confirmation) and mirror them in both the file-picker's `accept` attribute
    and the `INVALID_EXTENSION` copy's "{accepted formats list}" placeholder.
42. **Document-list pagination**: this document assumes a small, non-paginated
    per-Curriculum document list. Confirm against the real contract whether large
    document counts are expected/paginated; if so, add standard `mat-paginator`
    treatment consistent with §3.1/§4.1's pagination convention rather than
    rendering an unbounded list.
43. **Cascading-Exam-Type-blocked error code**: the exact `409`-class error code
    for "can't delete this document because a solely-derived Exam Type has active
    attempts" is inferred from FR-CUR-8's cross-reference to FR-AUTH-5, not
    confirmed against a real API response from Dev-15a/Dev-15b — confirm the
    actual code name before wiring §10.3b's handling to it.
44. **Search-result capping/pagination**: the spec excerpt doesn't state whether
    `GET` search results are capped/paginated. This document assumes an
    uncapped-but-reasonably-sized ranked list rendered in full; if the real
    contract caps results, add a "showing top {n} results" note (§10.3c) rather
    than inventing pagination controls speculatively.

---

## 11. Feature: PDF Upload, Review & Finalize (Dev-19b / BL-16, FR-PDF-1..9)

**Surface**: Tenant application (§1a), inside the existing `tenant-shell` (§4.0),
same shell/sidenav/permission-gating shape as §9/§10 — no new shell. This is the
**entire** `pdf-processing` frontend feature area built in one phase (upload
through finalize); there is no earlier screen to enter from, so §11.0 below
covers the whole route tree and IA before the per-state sections. Gated by
`pdf.upload` (upload), `pdf.review` (session list, review screen, edit/flag/
bulk-delete/regenerate), and `exams.finalize` + `@RequiresFeature('exams.create')`
(finalize wizard) — same "gate the nav item on the broadest relevant permission,
gate individual actions on their own narrower permission" shape §4.0/§9 already
establish, not a new gating idea.

This section builds directly on §9's upload-flow state-machine vocabulary
(Idle/Uploading/Validating/Error/Success) and §7's bulk-action-toolbar-over-a-
table pattern (there is no exact prior bulk-select table in this document —
§7/§4/§3's tables are single-row-action only — so §11.3 below is this document's
**first** bulk-row-selection table; later features should follow it as
precedent, not invent a second shape) rather than starting from nothing.

### 11.0 Route tree, IA, and cross-state navigation

**Routes** (all under the existing `tenant-shell`):
- `/pdf-processing/upload` — upload screen (§11.1)
- `/pdf-processing/sessions/:id` — session status ("generating," §11.2) **and**
  review ("reviewing," §11.3), same route, different rendered content by
  `session.status` (see below) — not two separate routes, because the user never
  manually navigates between "status" and "review"; the screen transforms itself
  in place as the poll response's status changes, which is a state transition
  within one screen, not a navigation. A route split would additionally force an
  awkward mid-poll redirect the instant status flips to `Completed`, which is
  exactly the kind of jarring, easily-avoided context-loss this document's
  route-vs-modal reasoning elsewhere (§9.3, §6's precedent) argues against
  building unless the two states are genuinely separate destinations — they
  are not.
- `/pdf-processing/sessions/:id/finalize` — finalize wizard (§11.4), a **separate**
  route from the review route, unlike the status/review pair above: finalize is a
  deliberate, user-initiated forward step (clicking "Finalize" from review) with
  its own multi-field form and its own exit ("Cancel" returns to review, success
  navigates away entirely to the new Exam Type) — it is a genuinely separate
  destination the way §9.3's create-form is separate from §9.1's list, not an
  in-place transformation of the review screen.
- `/pdf-processing/sessions` — the reviewer's own session list (`GET
  /pdf-processing/sessions`), the natural landing page for re-finding an
  in-progress or already-reviewed session without re-uploading; see §11.5.

**Sidebar**: one nav item, "PDF Import" (or "Import from PDF" — pick one, not
load-bearing), a peer of "Exam Types" (§9.0) and "Curriculum" (§10.0), gated on
`pdf.review` (a user who can review is the meaningful minimum to see this area at
all; `pdf.upload`-only with no `pdf.review` is an unusual/unlikely combination
but if it occurs, still show the nav item — uploading with no ability to ever
review your own upload is a degraded-but-valid state, not a reason to hide the
entry point, per recognition-over-recall: hiding it would strand such a user with
no path to the feature at all). Clicking the nav item lands on
`/pdf-processing/sessions` (§11.5), **not** directly on the upload screen — the
list is the home base (mirrors §9.0/§10.0's "list is the landing page, create is
one click deeper" convention); a prominent "Upload PDF" primary action on that
list screen goes to `/pdf-processing/upload`.

### 11.1 Upload screen (`/pdf-processing/upload`)

**Flow**:
1. Reached via the session-list screen's "Upload PDF" button (§11.5), gated by
   `pdf.upload`; route additionally guarded by `permissionGuard('pdf.upload')`,
   defense in depth per §4.0's standing pattern.
2. Fields:
   - **PDF file** (required) — reuse §9.3's exact file-drop/file-picker
     component (`shared/ui/file-drop`), restricted to PDF: `accept=".pdf,
     application/pdf"` as a client-side hint only, same "not a security
     boundary" caveat as §9.3 — the server's magic-byte check (FR-PDF-1) is the
     real gate. Once selected: filename + size + a "Change file" affordance,
     same as §9.3.
   - **Content-type hint** (optional) — a `mat-select` with three options
     (Lesson / Exam / Reference) plus an implicit fourth "Let the system detect
     it" (the default, unselected state) — this is an optimization the uploader
     can supply when they already know the document type (FR-PDF-1/FR-PDF-3),
     not a required classification step; framing it as "skip detection" copy
     under the field helps a first-time uploader understand why the option
     exists ("Skip automatic classification if you already know this
     document's type").
   - **Subject** (optional) — reuse the taxonomy Subject picker (§6/§9.3's
     precedent), a `mat-select`/cascading picker sourced from the tenant's
     taxonomy, not a second bespoke component.
   - **Curriculum** (optional) — a `mat-select` sourced from `GET /curricula`
     (reuse §10's Curriculum list data, not a new fetch pattern) — relevant
     mainly for Reference-content uploads (FR-PDF-6) but left available
     regardless of the hint chosen, since the uploader may not yet know the
     document is Reference content until classification runs.
   - **Force reprocess** (optional) — a checkbox, off by default, with helper
     text explaining what it does: "Reprocess even if this exact document (or
     one very similar) has already been processed" (FR-PDF-2) — off-by-default
     because skipping reprocessing (reusing cached results) is the cheaper,
     faster, and correct default per FR-PDF-2's own framing; this is an
     escape-hatch checkbox for the rare case the uploader wants a fresh run,
     not a decision every uploader should have to think about.
3. **Client-side pre-checks before submit** (error prevention, same "not a
   replacement for server validation" caveat as §9.3): a file has been selected;
   non-empty. That is the only genuinely client-checkable precondition — file
   size and PDF-signature validity are both server-side-only checks (the same
   restraint §9.3 applies to ZIP-internal-structure checks), so this document
   does **not** attempt a client-side file-size pre-check even though
   `FILE_TOO_LARGE` exists, because the configured max size (FR-PDF-1: "default
   50MB," but tenant-configurable per the LLD's env-var table) is not knowable
   client-side without an extra config fetch this phase doesn't otherwise need;
   **flagged below** — if `nexus-dev` finds the max size is exposed via
   `GET /tenant/public-config` (already fetched app-wide per §2's
   `TenantConfigStore`) or similar, add a client-side size pre-check for
   immediate feedback rather than waiting on a full upload round-trip to learn
   the file was too large.
4. Submit → state machine below.
5. Success (`202 {sessionId, status:'Pending'}`) → navigate immediately to
   `/pdf-processing/sessions/:id` (§11.2), which will render the Generating
   state on arrival (`status='Pending'` is itself a Generating sub-state, see
   §11.2) — same "land on the resource you just created" convention as
   §3.3/§4.3/§9.3, adapted here to "land on the resource's status page" since
   there is no static detail page yet to land on (the questions don't exist).
6. Exit (cancel, before submit): "Cancel" link back to `/pdf-processing/sessions`.

**States**:
- **Idle**: form fully editable, submit button ("Upload") enabled from first
  render, same never-pre-disabled rule as §9.3.
- **Uploading**: on submit (after the one pre-check above), disable all fields +
  submit button, determinate `mat-progress-bar` bound to upload-progress events
  exactly as §9.3 — a PDF upload is the same "measurable single-file transfer"
  shape as a ZIP upload, so the identical determinate-then-indeterminate pattern
  applies verbatim: button label "Uploading… {n}%", switching to indeterminate +
  "Processing…" once the transfer completes and the 202 response is still
  pending (this phase's server-side work here is trivial — signature/size check,
  hash, session insert — so this indeterminate window should be brief, but the
  pattern still applies for consistency and because it costs nothing to include).
- **Error**: form re-enables, all field values and the selected file remain
  exactly as entered (§9.3's identical "don't punish the user for one wrong
  field" rule) — distinct copy per error code, table below.
- **Success**: brief transitional state, then navigate per step 5 (no dead-end
  success screen, same rule as §2.2/§3.3/§9.3).

**Error copy, per code** (each distinct, matching FR-PDF-1's own explicit
per-code framing, same "no generic upload failed" standard as §9.3):

| Error code | Placement | Copy |
|---|---|---|
| `INVALID_FILE_SIGNATURE` | Per-field, on the file picker | "This file doesn't look like a genuine PDF — it may be corrupted or mislabeled. Choose a different file." |
| `INVALID_EXTENSION` | Per-field, on the file picker | "Only PDF files are supported. Choose a file ending in .pdf." |
| `EMPTY_FILE` | Per-field, on the file picker | "This file is empty. Choose a different file." |
| `FILE_TOO_LARGE` (413) | Per-field, on the file picker | "This PDF is too large. Choose a smaller file." (fill in the real configured max size once confirmed — same open item §9.3's `FILE_TOO_LARGE` row flags, applies identically here) |
| Network/5xx | Form-level banner | "Something went wrong while uploading this file. Please try again." |

**Accessibility**: same file-picker-is-a-real-keyboard-operable-input,
drag-and-drop-as-enhancement-only, and progress-region-`aria-live="polite"`
conventions as §9.3, applied verbatim to this single-file case. Error banners
`role="alert"`/`aria-live="assertive"`, matching §2/§9.3's convention.

**Relevant heuristics**: visibility of system status (progress states);
error prevention (the one pre-check that's genuinely safe to run client-side);
help users recognize/diagnose/recover from errors (distinct per-code copy).

**Responsive behavior**: single-column stacked form at all breakpoints, same
convention as §4.2/§4.3/§9.3's forms; the four optional fields (hint, subject,
curriculum, force-reprocess) stack in the order listed above at every
breakpoint (no side-by-side pairing needed — there's no natural two-column
grouping among them the way §9.3's module repeater had one).

### 11.2 Session status — "Generating" state (rendered at `/pdf-processing/sessions/:id`)

This is the in-place-transforming half of the shared status/review route
described in §11.0. It renders whenever `session.status` is one of `Pending`,
`Extracting`, `Classifying`, or `Processing` (LLD §8.3's worker state machine)
and is superseded by the Reviewing render (§11.3) the instant a poll response
returns `Completed`, and by the Error render (§11.6) on `Failed`.

**Polling**: `GET /pdf-processing/sessions/:id` every 2s, exponential slow-down
to 10s, stopping on `Completed`/`Failed` and on route destroy — this is LLD
§10.2's own explicit spec, implemented exactly as stated, not re-derived here.
**Flagged below**: the LLD doesn't state the exact backoff curve between 2s and
10s (linear step, doubling, etc.) — any reasonable monotonic backoff satisfies
"exponential slow-down to a 10s ceiling"; pick one (e.g. 2s → 4s → 6s → 8s →
10s, holding at 10s) and don't over-engineer it.

**Indicator**: an **indeterminate** progress indicator (`mat-progress-spinner`
or an indeterminate `mat-progress-bar`), not determinate — unlike §9.3's
upload-transfer bytes, there is no measurable "percent of AI processing done"
quantity available from the poll response (the response gives status/counts/
tokens/cost, not a completion fraction), so an indeterminate indicator is the
honest choice here (visibility of system status must not fabricate false
precision).

**Status copy**, shown as a headline above the spinner, one line per current
`status` value (recognition over recall — tell the reviewer what's literally
happening, in plain language, not the raw enum):
| `status` | Headline copy |
|---|---|
| `Pending` | "Queued for processing…" |
| `Extracting` | "Reading your document…" |
| `Classifying` | "Figuring out what kind of document this is…" |
| `Processing` | "Generating questions from your document…" (or, if the poll response's classification data is already available and indicates Reference content, "Indexing your document for search…" — reuse whatever field the response exposes to distinguish the branch; **flagged below** if the response shape doesn't expose contentType before `Completed`) |

**Supporting info surfaced beneath the headline, as it becomes available**
(each a plain label/value line, not a dense stat-grid — this is a waiting
screen, keep it calm per aesthetic & minimalist design):
- Page count, once extraction has produced one (present from `Extracting`
  onward).
- Tokens used / cost so far, once any AI call has been logged (present from
  `Classifying` onward) — rendered as plain informational text ("~1,200 tokens
  used so far"), not a progress bar against a target (the budget is a ceiling
  the pipeline self-enforces, not a quota the user is meant to watch tick up
  toward exhaustion in real time).
- **`budgetExhausted` warning**: if the poll response ever reports
  `budgetExhausted: true` while still `Processing`, or once `Completed` with
  it set, show a distinct, non-alarming informational banner (not an error
  banner — per FR-PDF-12 this is an expected graceful-completion path, not a
  fault): "This document reached its processing budget before every possible
  question could be generated. The questions generated so far are ready to
  review below." Placed inline in the status area while still processing, and
  carried forward as a persistent (dismissible) banner at the top of the
  Reviewing screen (§11.3) once `Completed`, so the reviewer isn't confused
  about why the question count seems lower than expected.
- **`reusedFromSessionId` present** (FR-PDF-2 cache hit): a distinct
  informational note, since this session skipped AI processing entirely and
  will jump straight to `Completed` very quickly: "This document matches one
  already processed — reusing its questions instead of reprocessing." This
  is genuinely good news (fast, free), so it should read as a neutral/positive
  note, not any kind of warning styling.

**"Stuck at Classifying" / AI-outage graceful state** (LLD §8.3: on
`AI_SERVICE_UNAVAILABLE` the worker releases its lease and status *stays*
`Classifying` with no watermark change, to be resumed later): after a
configurable client-side threshold of continuous polling at the same status
with no change (**recommend 60 seconds** as the smallest-reasonable-choice
default — flagged below for `nexus-dev` to confirm/tune against real observed
worker retry timing), swap the headline copy to a "this is taking a bit
longer than usual" variant rather than continuing to imply imminent
completion or, worse, implying failure:
> "Still processing — this can take a bit longer than usual. No need to do
> anything; this page will update automatically once it's ready."
This copy is deliberately reassuring and explicitly non-alarming (help users
recognize/diagnose/recover from errors is *not* invoked here because this is
not yet an error — `StaleSessionRecoveryWorker` will resume it — jumping to
error-toned copy this early would be a false alarm the user can do nothing
about anyway). If polling continues past a materially longer threshold (this
document does not set one — genuinely open-ended per §8.3's up-to-5-minute
heartbeat lapse + resume-attempt cycle), the copy does not change further; it
does not degrade into an error state client-side unless/until the server
itself actually returns `Failed`.

**Exit**: a "Cancel and delete this session" link/button (uses `DELETE
/pdf-processing/sessions/:id`, owner-or-`exams.review`-gated per the route
table) — reuses §9.4/§4.5/§6.3's confirm-dialog pattern: "Delete this import?
This stops processing and permanently removes the uploaded file and any
questions generated so far. This cannot be undone." This gives a reviewer a way
out of a session they no longer want, rather than trapping them on an
indefinite-length waiting screen with no exit besides closing the tab (user
control & freedom). Closing the tab/navigating away is also always valid — the
poll simply stops; the session keeps processing server-side and is re-findable
later via `/pdf-processing/sessions` (§11.5).

**Accessibility**: the whole status region (headline + supporting info) is
wrapped in a single `aria-live="polite"` region, so a screen-reader user hears
each status change as it happens without needing to re-focus the page —
polite, not assertive, since these are non-urgent progress updates, not errors
requiring interruption (same polite/assertive split §9.3 already establishes
for its own progress region). The spinner itself carries `role="status"` (or is
purely decorative with `aria-hidden="true"` if the live region text alone fully
conveys status, which it does here — avoid double-announcing the same
information via both the spinner's own accessible name and the live region
text).

**Relevant heuristics**: visibility of system status (the dominant concern,
same as §9.3); help users recognize/diagnose/recover from errors is
deliberately *soft-pedaled* for the "stuck at Classifying" case per above,
since premature alarm would itself be a usability fault here.

**Responsive behavior**: single centered column at all breakpoints (this is a
waiting screen with a handful of lines of text, not a data-dense layout — no
table-to-card concern applies).

### 11.3 Reviewing state — paginated review screen (rendered at `/pdf-processing/sessions/:id`)

Renders once `session.status === 'Completed'`. This is this document's first
bulk-row-selection table (see §11.0) — later features needing multi-select
bulk actions should follow this shape as precedent.

**Flow**:
1. On the poll transitioning to `Completed`, the screen re-renders in place
   (same route, per §11.0) — a brief, one-time "Processing complete" toast/
   snackbar announces the transition (`aria-live` already covers the
   screen-reader case via §11.2's live region catching the final status
   change; the toast is a redundant *visual* cue for a sighted user who may
   have looked away from this tab), then the table loads via `GET
   /pdf-processing/sessions/:id/questions?page=1&pageSize=…` (reuse the
   standard `mat-paginator` convention §3.1/§4.1/§7.1 already establish —
   **flagged below**: confirm the actual default/max `pageSize` the endpoint
   accepts).
2. The `budgetExhausted` banner from §11.2 (if applicable) and the
   `reusedFromSessionId` note carry forward at the top of this screen,
   dismissible.
3. Table columns: a leading **selection checkbox** column (header checkbox =
   select-all-on-current-page, same `mat-table` + `mat-checkbox` "select all
   visible rows" convention Material's own table recipes use — **not**
   select-all-across-all-pages, since bulk-delete/regenerate operate on
   explicit id lists the client must actually hold; selection is
   explicitly scoped to "what's currently loaded," flagged below if
   `nexus-dev` wants a "select all N across all pages" affordance later),
   Question text (truncated with expand-on-row-click into the inline editor,
   see below), Type/source indicator (Lesson-generated vs. Exam-extracted vs.
   Reference n/a — reference sessions produce no questions to review, so this
   screen is simply never reached for a Reference-classified session; route
   guard: if `status==='Completed'` and the session's contentType was
   Reference, redirect to a dedicated "This document was indexed for search,
   not converted into questions" confirmation screen rather than rendering an
   empty review table — **flagged below**, since the exact field name isn't
   confirmed), Confidence (a numeric badge, color-banded per a threshold
   convention — **flagged below**, this document recommends ≥0.85 green /
   0.60–0.85 amber / <0.60 red as a reasonable starting scheme, to be tuned
   against real generation-quality data, not treated as load-bearing), **Human-
   edited indicator** and **Review-flag indicator** (two small, visually
   *distinct* icon-badges in their own column each — FR-PDF-8 is explicit that
   these must never be conflated: a small pencil icon + "Edited" tooltip for
   `is_human_edited`, a small flag/bookmark icon + "Flagged" tooltip, toggled
   independently by the reviewer for the flag one via a click, read-only/
   system-set for the edited one), Actions (a per-row overflow menu: Edit
   inline / Flag-Unflag toggle / Delete this one question).
4. **Inline editing**: clicking a row (or its "Edit" action) expands it in
   place into an edit form (question text as a textarea, each option as a
   text input with a radio/select to mark which is correct, explanation as a
   textarea, plus a free-text "reviewer notes" field) — an in-place expansion,
   not a modal or a separate route, because a reviewer editing many questions
   in sequence benefits from staying in table context (recognition over
   recall — the surrounding rows/pagination stay visible) and because this
   mirrors §4.2's "single screen serves view+edit" philosophy applied at row
   granularity instead of screen granularity. Save (`PATCH
   /pdf-processing/questions/:id`) collapses the row back, updates its Human-
   edited badge to "on" immediately (optimistic, confirmed by the response),
   and shows a small inline "Saved" confirmation (not a snackbar per-row —
   too noisy if a reviewer edits many rows in sequence; the collapsing
   animation plus the now-visible Edited badge is sufficient visibility of
   system status). Cancel (discard edits) collapses without saving, same
   confirm-only-if-dirty restraint as §4.2 step 6 (a lightweight "discard
   unsaved changes?" prompt only if the reviewer actually typed something).
5. **Row selection checkboxes + bulk-action toolbar**: a toolbar fixed above
   the table (sticky on scroll for long pages), showing a live count ("3
   selected") and two buttons: "Delete selected" and "Regenerate selected."
   **Zero-rows-selected behavior — both buttons are disabled (grayed,
   non-interactive), not hidden, and clicking is simply impossible rather
   than producing any validation message** — the dispatch is explicit that the
   backend no-ops gracefully on an empty list, but the *UI* should not even
   attempt the round-trip for a no-op; disabling communicates "there's nothing
   to act on yet" via standard disabled-button affordance rather than a
   click-then-error cycle, which is strictly better error prevention than
   relying on the backend's tolerance for the empty case. "Delete selected"
   opens the same confirm-dialog pattern as §9.4/§4.5/§6.3, worded to name the
   count: "Delete {n} selected question(s)? This cannot be undone." (pluralize
   naturally per §9.3's rule, no literal "(s)" in rendered copy). "Regenerate
   selected" does **not** need a destructive confirm dialog the same way delete
   does (it replaces, doesn't merely destroy, and per FR-PDF-8 preserves the
   original count) — but per error prevention it should still show a brief,
   lighter-weight confirmation given it discards existing edits/flags on the
   selected rows: a `mat-dialog` reading "Regenerate {n} selected question(s)
   from the source document? Any edits or flags on these will be replaced.
   This cannot be undone." with a non-destructive-styled (not error-red)
   confirm button, since regenerating is a normal, expected workflow action,
   not a destructive one in the same sense delete is — but the "your edits get
   thrown away" consequence still deserves a beat of confirmation
   (error prevention).
6. **Regenerate in-flight**: while a regenerate request is outstanding for a
   set of rows, those specific rows show a small inline "Regenerating…"
   overlay/skeleton state (not a full-table blocking spinner — other rows
   remain interactive), and re-fetch/replace just those rows on completion
   (the response presumably returns the fresh replacement rows or the client
   re-fetches the current page — **flagged below**, confirm the actual
   response shape of the regenerate endpoint).
7. Primary forward action: a persistent "Finalize" button (top of the screen,
   filled, gated by `exams.finalize` — per-action gating, same shape as
   §9.0's `exams.create` gating) → `/pdf-processing/sessions/:id/finalize`
   (§11.4). Always enabled regardless of selection/pagination state (finalize
   operates on confidence-threshold criteria across the whole session per
   FR-PDF-9, not on the review table's row-selection state — these are two
   independent selection mechanisms and must not be visually conflated: row
   checkboxes are for bulk delete/regenerate only, finalize's own eligible-
   question selection happens inside the wizard via `minConfidence`, entirely
   separately).
8. Exit: "Back to sessions" link → `/pdf-processing/sessions` (§11.5),
   preserving nothing special to preserve (a session's own state persists
   server-side regardless of when the reviewer leaves).

**States**:
- **Loading (initial questions fetch)**: skeleton table rows, §3.1's
  convention.
- **Loading (page change)**: dim existing rows + inline spinner overlay, same
  as §3.1/§4.1/§9.1.
- **Empty** (a `Completed` session with zero generated questions — plausible
  if extraction/generation produced nothing usable, or if `budgetExhausted`
  fired before any question was produced): centered empty-state block: "No
  questions were generated from this document." + guidance: if the session
  isn't `budgetExhausted`, suggest "Try uploading a clearer or more
  detailed version of this document." — if it *is* `budgetExhausted`, say so
  plainly instead: "This document reached its processing budget before any
  question could be generated." Either way, offer a "Delete this import" and
  a "Upload a different PDF" pair of actions rather than leaving the reviewer
  on a dead end.
- **Error** (questions fetch fails): inline error block + retry, §3.1's
  convention.
- **Row error** (a single edit/flag/delete-one action fails): inline error
  text within that row's own area (not a global banner — this is scoped to
  one row's action, same "don't escalate a local failure to a global banner"
  restraint implicit in keeping edit state row-scoped per point 4 above),
  with the row's prior state (pre-edit values) preserved so the reviewer can
  retry or cancel without losing their in-progress edit.
- **Bulk-action error** (bulk-delete/regenerate call fails outright, e.g.
  network/5xx): form-level/toolbar-area banner, `role="alert"`: "Something
  went wrong while {deleting/regenerating} the selected questions. Please try
  again." — selection state is preserved (checkboxes remain checked) so the
  reviewer can simply retry without re-selecting.
- **Success** (table populated, normal review in progress): as described
  above.

**Accessibility** (beyond §1b baseline):
- The table is a real `<table>`/`mat-table` with proper header scoping;
  row-selection checkboxes each have a programmatically associated label
  naming the row's question (e.g. "Select question: {truncated text}"), not a
  bare unlabeled checkbox, and the header "select all" checkbox announces its
  tri-state (none/some/all selected) via `aria-checked="mixed"` where
  applicable.
- The whole table must be operable via keyboard alone: Tab reaches each
  checkbox/row-action in document order, Enter/Space toggles a checkbox or
  activates a button, and the inline-edit expansion is reachable and
  closable via keyboard (Escape collapses the edit form, same as a
  `mat-dialog`'s Escape-to-close convention, applied to an in-page expansion
  instead of an actual dialog).
- The Human-edited and Review-flag badges must not be conveyed by icon/color
  alone without a text alternative (`aria-label`/visually-hidden text
  "Human-edited" / "Flagged for review") — this is directly what FR-PDF-8's
  own "distinctly shown" requirement means for a screen-reader user, not just
  a sighted one.
- The bulk-action toolbar's live "{n} selected" count is in an
  `aria-live="polite"` region so a screen-reader user gets feedback as they
  check/uncheck rows without needing to re-navigate to the toolbar to learn
  the current count.

**Relevant heuristics**: visibility of system status (edit-saved confirmation,
regenerate-in-flight per-row state); error prevention (disabled bulk buttons
at zero-selection, regenerate's lighter confirm given it discards edits);
user control & freedom (cancel-without-saving on inline edit, undo-via-
regenerate-again if a reviewer regenerates and dislikes the result — no
literal undo exists, but nothing here is irreversible except delete, which
alone gets the heavier destructive-confirm treatment); recognition over
recall (Human-edited/Review-flag as persistent visible badges rather than
information the reviewer would otherwise have to remember or re-derive).

**Responsive behavior**: below 599.98px, degrade from a table to a **stacked
card list**, per §3.1/§4.1/§9.1's established table-to-card convention — one
card per question: question text (truncated, tap to expand into the same
inline edit form), confidence badge + Human-edited/Review-flag badges as a
compact metadata line, selection checkbox in the card's top-left corner
(still individually operable, not lost in the mobile layout), row actions in
a `mat-menu` overflow at the card's top-right — same shape §9.1's mobile card
already uses for its own actions overflow. The bulk-action toolbar remains
sticky at the top of the viewport on mobile too, since bulk operations are
equally relevant on a phone reviewing a short list, just with the same two
buttons stacked full-width rather than side-by-side if horizontal space is
too tight for both labels.

**Inline images (BL-24, Dev-25b)**: a question row's associated images (per
`FR-PDF-11`/`FR-FILE-3`) now render inline in both the collapsed row's
question-text cell and the expanded inline editor — see §14 for the full
treatment (layout, states, and accessibility), which applies to this screen
identically in desktop-table and mobile-card form.

### 11.3a "Find similar questions" reviewer tool (Dev-31, BL-30)

**Surface**: Tenant application (§1a), same `pdf-processing` review screen as §11.3
(`/pdf-processing/sessions/:id`, Reviewing state) — this is an addition to that
screen's existing per-row overflow menu, not a new route or a new screen. Gated by
`pdf.review`, identical to every other action already on this screen (§11.0).

This is explicitly a **P2/nice-to-have quality aid**, not a gate: a reviewer can
finalize a session having never opened this tool once, and nothing in §11.3/§11.4's
existing flow changes as a result of this addition — see point 5 below.

**1. Trigger placement**: a new item appended to the bottom of the existing per-row
overflow menu (`mat-menu`) established in §11.3 point 3/point 4 (currently Edit /
Flag-Unflag / Delete), below a `mat-divider` separating it from those three — the
existing three are all direct mutating actions on the row itself; this one is a
read-only lookup, so the visual divider signals "this is a different kind of action"
without inventing a second menu component. Label: **"Find similar questions"**. Icon:
`content_copy` (Material Symbols) — chosen over `search` because the tool's purpose is
specifically near-duplicate detection, not general search, and `search` is already
implicitly "taken" by this document's semantic-search precedent in §10 (Curriculum
search) which is a different, unrelated feature; reusing a generic search icon here
risks a reviewer conflating the two. **Flagged below**: if `nexus-dev`'s icon set
doesn't have a closer duplicate-detection glyph (e.g. `find_replace`,
`compare_arrows`), either is an acceptable substitute — `content_copy` is not
load-bearing, just "not `search`."

Available on every row regardless of that row's own state (edited, flagged, low-
confidence, mid-inline-edit) — there is no row state that should disable this menu
item, since it's a pure read query against the vector index keyed only on that
question's own text, independent of whatever the reviewer is doing to the row.

**2. Presentation surface — dialog, not inline expansion.** Recommend a `mat-dialog`
built on the same `ConfirmDialogComponent`-adjacent pattern already established in
this section (§11.3 point 5's confirm dialogs, §11.2/§9.4's delete-confirm) — a
lightweight, purpose-built dialog component (not literally `ConfirmDialogComponent`
itself, since this dialog has no confirm/cancel action to take, just a close), rather
than a second inline-expansion mechanism. Reasoning, weighed explicitly against this
screen's existing conventions:
- §11.3 point 4 already uses row-expansion for inline *editing* — expanding the same
  row a second, different way for a *different* purpose (viewing unrelated read-only
  results from elsewhere in the tenant's question bank) would collide with that
  established meaning: a reviewer who has learned "clicking/expanding this row means
  I'm editing it" would be confused by an expansion that instead shows other
  questions from other Exam Types entirely. A dialog is unambiguously a different
  mode, avoiding that collision (consistency & standards).
- The results being shown live conceptually *outside* this session/table entirely
  (other Exam Types, other modules, possibly other sessions never seen on this
  screen) — a modal boundary correctly frames them as "borrowed context surfaced for
  reference," not as part of this table's own data, which an inline expansion would
  visually imply.
- A reviewer triggering this per-row, possibly on several rows in sequence while
  reviewing, benefits from a quick open → glance → close cycle that returns them to
  exactly where they were in the table (scroll position, other rows' state) — a
  dialog's overlay-and-return interaction is the right weight for that "quick lookup,"
  matching this document's standing "dialog for a bounded lookup/confirm task, inline
  expansion only for genuine in-place editing" split (same distinction §9's/§10's
  dialog-vs-route choices already draw elsewhere).

Dialog title: "Similar questions" with a secondary line showing a truncated snippet of
the source question being checked (so the reviewer has context if they reopen it
later or take a screenshot) — not the full question text, to keep the dialog compact.

**3. States**:
- **Loading**: dialog opens immediately on trigger (don't wait for the response
  before showing the dialog shell — visibility of system status), showing a centered
  `mat-progress-spinner` (indeterminate — same reasoning as §11.2's spinner choice:
  no measurable progress fraction for an embedding + vector-search call) with the copy
  "Searching for similar questions…" beneath it. Given the dispatch's "typically
  sub-second but could occasionally take a couple of seconds" framing, do **not**
  render the spinner so briefly it flashes for barely-perceptible loading — a short
  minimum-display floor (e.g. 300ms) is a reasonable, non-load-bearing polish detail,
  not a requirement.
- **Empty results** (`[]`, the common case): a calm, explicitly non-alarming
  informational message, not an error/warning treatment of any kind — no red/amber
  styling, no icon suggesting a problem. Recommend a neutral checkmark-style icon
  (`check_circle_outline` or similar) with copy: "No similar questions found in this
  tenant's question bank." This is good news (or at minimum, neutral information),
  and per FR-PDF-... this tool's own framing ("most reviewed questions will have no
  genuine duplicate"), an empty result must never read as if something went wrong.
- **Populated results**: a simple vertical list (not a table — this is a short,
  informational list, not a data grid the reviewer sorts/filters/acts on), one card/
  row per match, highest-score first (server already orders it, don't re-sort
  client-side). Each match shows:
  - **Score**, as a percentage badge (e.g. "94% match"), color-banded using this
    document's existing confidence-badge convention from §11.3 point 3 (≥85% green /
    60–85% amber / <60% red) reused verbatim rather than inventing a second color
    scheme for a second kind of percentage on the same screen — same numeric-badge
    component, different bound source.
  - **Exam Type name + module name** as a small secondary line (e.g. "Algebra II
    Midterm → Quadratic Equations"), giving the reviewer the context needed to judge
    whether the match is a meaningful duplicate or coincidental topical overlap.
  - **Question text**, truncated to roughly 2 lines with an ellipsis (same truncation
    convention as the review table's own Question-text column, §11.3 point 3) — no
    "expand" affordance needed here, since this is informational only; a reviewer
    who wants the full text can use the exam/module names as enough of a lead to find
    it themselves if truly needed (this tool is explicitly not a merge/link/navigate-
    to-source action per the dispatch — no click-through is specified against any
    endpoint, so none is built: **flagged below**, if `nexus-dev`/product later wants
    a "view full question" or "open source Exam Type" affordance per match, that's a
    natural follow-on but is out of this pass's contracted scope).
  - No action buttons on an individual match — this is display-only, matching the
    dispatch's explicit framing.
  A short header line above the list states the count: "3 similar questions found"
  (or "1 similar question found" — singular/plural per this document's standing
  pluralization rule, §9.3).
- **Error** (network/5xx): replace the list area with this document's standard
  inline-error-plus-retry treatment (§3.1/§11.3's own "Error (questions fetch fails)"
  convention) — icon + "Something went wrong while searching for similar questions."
  + a "Retry" button that re-issues the same request without closing the dialog.
  This is a genuine fault state, visually distinct from the empty-results state above
  (do not let these two ever look alike — one is bad news about the request, the
  other is neutral/positive news about the result).

Close: an explicit "Close" button plus the standard dialog dismiss affordances
(×, Escape, backdrop click) — same conventions as every other dialog in this document.

**4. Accessibility**:
- **Focus management**: on open, focus moves to the dialog's title (or its first
  focusable element per standard `mat-dialog`/APG dialog pattern — `MatDialog`
  handles this by default, so this is confirming the default applies, not inventing
  new behavior), and focus is trapped within the dialog while open (`mat-dialog`'s
  standard behavior). On close (any method — button, Escape, backdrop), focus returns
  to the overflow-menu trigger button on the row that opened it, so the reviewer's
  keyboard position in the table is preserved exactly where they left off (matching
  §11.3's own inline-edit-Escape-returns-focus precedent).
- **`aria-live` announcement**: once the request resolves (success or error), an
  `aria-live="polite"` region within the dialog announces the outcome to a screen-
  reader user without requiring them to re-navigate to discover it — mirroring this
  screen's own §11.2 status-region precedent and §11.3's bulk-toolbar-count
  precedent. Announced text: the same count line shown visually ("3 similar questions
  found" / "No similar questions found" / the error copy) — one region, reused for
  all three outcomes, not three separate live regions.
- **Trigger keyboard operability**: the menu item is a standard `mat-menu` item,
  already keyboard-operable (Tab/Enter within the existing overflow-menu pattern) —
  no new keyboard handling needed beyond what §11.3's existing menu already provides.
- **Dialog keyboard operability**: standard `mat-dialog` semantics (`role="dialog"`,
  `aria-labelledby` pointing at the title) — no custom ARIA needed beyond the
  `aria-live` region called out above, since the results list itself is plain static
  content (no interactive controls per match to make operable, per point 3's "no
  action buttons on a match" decision).

**5. Never blocks Finalize — explicit confirmation.** This tool has **no
relationship whatsoever** to §11.3 point 7 / §11.4's Finalize flow: the persistent
"Finalize" button remains unconditionally enabled regardless of whether any row's
"Find similar questions" has ever been opened, regardless of what it returned, and
regardless of whether its dialog is currently open. There is no per-row "duplicate
found" badge added to the table, no new field consulted by `NO_ELIGIBLE_QUESTIONS`'s
eligibility computation (§11.4), and no confirm-before-finalize step referencing this
tool's results. It is purely advisory context a reviewer may consult before deciding,
on their own judgment, to edit, flag, or delete a question they suspect is a
near-duplicate — those three existing actions (§11.3 point 3) remain the *only*
mechanisms by which this tool's findings can actually change anything about the
session; the tool itself never writes anything.

**Relevant heuristics**: visibility of system status (immediate dialog-open +
loading spinner rather than a silent wait); help users recognize/diagnose/recover
from errors (distinct, retry-capable error state, clearly differentiated from the
non-alarming empty state); recognition over recall (surfacing exam/module context per
match so the reviewer doesn't have to separately go look up what that other question
belongs to); aesthetic & minimalist design (no data grid, no per-match actions — kept
to the minimum needed to make an informed judgment call).

**Responsive behavior**: the dialog uses this document's standard responsive
`mat-dialog` sizing (near-full-width sheet below 599.98px, fixed max-width centered
modal above it — same convention as every other dialog in this document, e.g.
§9.4/§11.2's confirm dialogs) — no bespoke breakpoint behavior needed since this is a
short list, not a data-dense layout.

### 11.4 Finalizing state — finalize wizard (`/pdf-processing/sessions/:id/finalize`)

**Route vs. modal**: a dedicated route, not a dialog — same reasoning as
§9.3's ZIP-create-form: this form has enough fields (name, description,
duration, question count, confidence threshold, module configuration,
optional curriculum links) that a modal would feel cramped, and it is a
genuinely separate destination from the review screen (§11.0), reachable via
its own "Finalize" button and its own "Cancel" returning to review.

**Flow**:
1. Triggered from the review screen's "Finalize" button (§11.3 step 7),
   `exams.finalize`-gated; route additionally guarded by
   `permissionGuard('exams.finalize')`.
2. Fields, in order:
   - **Exam name** (required, text) — duplicate-name errors surface here
     (`EXAM_TYPE_NAME_EXISTS`, same code/copy §9.3/§9.6 already established
     for the ZIP path — reuse verbatim, do not invent different wording for
     the same error code appearing on a second flow).
   - **Description** (optional, textarea).
   - **Total minutes** (required, integer, `min=1`).
   - **Total question count** (required, integer, `min=1`) — display, beside
     this field, a live "eligible questions: {n}" readout that recomputes as
     the confidence threshold and auto-generated-only toggle below change
     (client-side count against the already-loaded review-table data, or a
     fresh lightweight count call — **flagged below**, since no endpoint for
     "count eligible without finalizing" is described in the route table;
     recommend computing it client-side from the already-fetched question
     list if the review screen's full question set is realistically available
     client-side, otherwise this readout should be omitted rather than
     invented against a nonexistent endpoint).
   - **Confidence threshold (`minConfidence`)** — a slider or numeric stepper
     from 0 to 1 (e.g. steps of 0.05), defaulting to a sensible mid value
     (**recommend 0.60**, matching FR-PDF-5's own "inferred" confidence floor
     as a reasonable non-arbitrary default — flagged below for `nexus-dev` to
     confirm/tune), with the live eligible-count readout above updating
     alongside it so the reviewer sees the tradeoff in real time (recognition
     over recall — no need to mentally estimate how many questions clear a
     given threshold).
   - **"Auto-generated only" toggle** (optional, off by default) — helper
     text: "Only include questions the AI generated fresh, excluding any
     reused from a previous document" (plain-language gloss of what
     `autoGeneratedOnly` actually filters, since the raw field name alone
     doesn't self-explain to a non-technical reviewer).
   - **Module configuration** — a segmented choice, default selected:
     - "Group automatically by source section" (default, matches FR-PDF-9's
       own stated default behavior) — no further input needed; a read-only
       preview list beneath shows the auto-detected module names/counts once
       computed (again client-side against the loaded question data if
       feasible, otherwise omitted per the same flag as the eligible-count
       readout above).
     - "Define modules manually" — reveals the same named-module repeater
       pattern §9.3 already established (Module name text input + trailing
       Remove button, "Add module" below), except here each module's
       "question count" isn't manually typed — instead each module maps to
       one or more detected source sections the reviewer assigns from a
       multi-select sourced from the session's actual detected sections
       (**flagged below**: the exact shape of "source section" data
       available from the review-questions response isn't confirmed —
       assume each question record exposes a `sourceSection` label the
       wizard can enumerate into a distinct-values list for this
       multi-select; confirm against the real field name before building).
   - **Curriculum linking** (optional) — an "Add curriculum link" repeater:
     each row is a Curriculum picker (`mat-select`, sourced from `GET
     /curricula`, reused from §11.1's identical picker) + a **context weight**
     numeric input bounded 1–10 (client-side `min=1 max=10` pre-check,
     matching the server's `INVALID_CONTEXT_WEIGHT` exactly — same
     "client pre-check mirrors a real server-side bound" pattern as §9.3's
     `min=1` integer fields), with a trailing Remove button — same repeater
     shape as the module repeater and §9.3's, for consistency across this
     single wizard rather than three visually different repeater treatments.
3. **Client-side pre-checks before submit**: name non-empty; total
   minutes/questions ≥ 1; confidence threshold within its slider's own
   bounds (can't be invalid by construction); every manually-defined module
   (if that path is chosen) has a non-empty name and at least one assigned
   source section; every curriculum-link row's context weight is an integer
   1–10. Left to the server: the actual eligible-question computation and
   `NO_ELIGIBLE_QUESTIONS` determination (this is exactly the kind of
   real-data-dependent check §9.3's "don't duplicate server parsing logic
   client-side" restraint applies to, even with the client-side estimate
   readout above — that readout is a best-effort UX aid, not a guarantee,
   and must not block submission if it's ever wrong/unavailable).
4. Submit → **synchronous** (per LLD §8.5's sequence diagram, `finalize` is a
   single-request/single-response transactional operation, not a
   poll-for-status flow the way upload is) — show a determinate-feeling
   inline spinner + disabled form + button label "Finalizing…" (indeterminate
   is correct here too, since there's no measurable progress signal for a
   single backend transaction, same reasoning as §11.2's spinner choice, just
   scoped to a form-submit rather than a whole-screen wait).
5. Success (`201 ExamType`) → navigate to the new Exam Type's detail screen
   (§9.2), with a snackbar: "Exam Type '{name}' created." — same "land on the
   newly created resource" convention as §9.3 step 5, explicitly matching the
   dispatch's own instruction to mirror Dev-12b's convention.
6. Exit (cancel, before submit): "Cancel" link back to
   `/pdf-processing/sessions/:id` (review), same lightweight
   touched-field navigation-guard treatment as §9.3/§4.2 (optional, not
   mandatory).

**`NO_ELIGIBLE_QUESTIONS` (400)** — this is the section's own named exit gate
per FR-PDF-9, and it deserves specific, non-generic copy rather than falling
into a catch-all validation-error banner: render a **form-level banner**,
`role="alert"`, directly above the confidence-threshold field (the field most
directly responsible for this outcome) reading:
> "No questions in this session meet the selected confidence threshold
> (and auto-generated-only setting, if enabled). Lower the confidence
> threshold, turn off "Auto-generated only," or review and adjust individual
> questions before finalizing."
This explicitly names the two levers the reviewer actually controls (matching
this document's standing "always name the concrete next step" rule from
§3.3/§4.5/§6.3/§9.3's error-copy tables) rather than a bare "no eligible
questions" restatement of the error name. The form remains fully populated
and editable after this error (same field-preservation rule as every other
error state in this document) so the reviewer can immediately loosen the
threshold and resubmit without re-entering anything else.

**`EXAM_TYPE_NAME_EXISTS` (409)**: per-field on Name, identical copy to
§9.3/§9.6's existing row: "An Exam Type named '{name}' already exists. Choose
a different name."

**`INVALID_CONTEXT_WEIGHT` (400)**: per-field, on the specific curriculum-link
row's weight input the server names (or the first/only row if the response
doesn't disambiguate — **flagged below**, confirm whether the error response
identifies which row/link failed when multiple are present): "Context weight
must be a whole number from 1 to 10."

**Network/5xx**: form-level banner, "Something went wrong while finalizing
this Exam Type. Please try again."

**Accessibility**:
- **Focus management between wizard sections**: this is a single-page form
  with a linear field order (not a multi-step/paginated wizard with separate
  "Next" screens — the dispatch's "focus management between wizard steps"
  ask is satisfied here by treating each *section* — module configuration,
  curriculum linking — as an expandable/revealed sub-section rather than a
  literal step; when the "Define modules manually" option is chosen, revealing
  the module repeater, focus moves into its first field, same "move focus to
  what just appeared" rule §9.3's "Add module" already establishes) — if
  `nexus-dev` instead judges the field count large enough to warrant a true
  multi-screen (Angular CDK Stepper-style) wizard, apply standard
  `mat-stepper` focus-on-step-change semantics (CDK handles this by default)
  and treat this as the smallest-reasonable-choice alternative rather than a
  deviation requiring further sign-off.
- The confidence-threshold slider has a visible numeric readout beside it
  (not conveyed by slider handle position alone) and is fully keyboard-
  operable (arrow keys) per standard `mat-slider`/APG slider pattern.
- The live "eligible questions: {n}" readout (if built, per the flag above)
  is in an `aria-live="polite"` region so a screen-reader user hears it
  update as they adjust the threshold, without needing to re-navigate to it.
- Repeater rows (modules, curriculum links) follow the identical
  focus-after-add/remove rules §9.3 already established.

**Relevant heuristics**: error prevention (bounded numeric inputs matching
real server constraints); help users recognize/diagnose/recover from errors
(`NO_ELIGIBLE_QUESTIONS`'s two-lever, name-the-fix copy is the flagship
example in this section); visibility of system status (live eligible-count
readout, if built); flexibility & efficiency of use (auto-group-by-section
default lets a reviewer finalize with zero extra module configuration, while
manual grouping remains available for reviewers who need it).

**Responsive behavior**: single-column stacked form at all breakpoints, same
convention as every other form in this document; the module and curriculum-
link repeaters stack their sub-fields vertically per row on mobile (below
599.98px) rather than side-by-side, same degradation §9.3's module repeater
already specifies.

### 11.5 Session list (`/pdf-processing/sessions`)

The nav-item landing page (§11.0). Modeled directly on §9.1/§10.1's list
screens.

**Flow**: table/card list of the reviewer's own sessions (`GET
/pdf-processing/sessions`, own sessions for a Member, all sessions for a user
with `exams.review` per the route table) — columns: source filename (or a
"Untitled upload" fallback if no filename is retained), Status (a
`StatusBadgeComponent`, §3.1a's convention, one badge state per
Pending/Extracting/Classifying/Processing/Completed/Failed — the four
in-progress statuses can reasonably share one "Processing" visual badge
treatment with the specific status as a tooltip/secondary line, to avoid a
five-way badge-color scheme where four of the five values are transient and
only two are meaningfully "at rest" — **flagged below** as a judgment call,
`nexus-dev` may instead give each status its own distinct badge if preferred,
either is reasonable), Question count (once `Completed`), Uploaded
(relative + absolute-on-hover, §3.1/§4.1's convention), Actions (a row action
that routes to `/pdf-processing/sessions/:id`, landing on whichever of
§11.2/§11.3/§11.6 that session's current status renders — "Review" as the
label once `Completed`, "View status" while in progress, "View error" if
`Failed`).

**States**: Loading (skeleton rows), Empty ("No PDF imports yet. Upload one
to get started." + "Upload PDF" CTA, gated by `pdf.upload` same
omit-not-disable rule as §9.1's empty-state CTA), Error (inline block +
retry), Success.

**Primary action**: "Upload PDF" button (top-right, filled), gated by
`pdf.upload`, → `/pdf-processing/upload`.

**Mobile degradation**: stacked-card list below 599.98px, same convention as
§3.1/§4.1/§9.1 — filename + status badge prominent, question count/uploaded
as compact metadata line, action button/link at the card's trailing edge.

### 11.6 Error state — session `Failed`

Rendered at `/pdf-processing/sessions/:id` (§11.0) whenever a poll returns
`status: 'Failed'`. This is distinct from — and must not be visually confused
with — the transient upload-form errors of §11.1: this is a session that
reached a terminal failure *after* the 202 upload succeeded.

**Content**: a centered panel (replacing the spinner/progress UI of §11.2 in
place, same screen), showing:
- A clear, non-alarmist-but-honest headline: "This document couldn't be
  processed."
- The session's `errorMessage` from the poll response, rendered verbatim as
  supporting text — per this document's standing "pass server-supplied
  specific detail through rather than paraphrasing it into something vaguer"
  rule (§9.3's `INVALID_QUESTION_FILE`/`EMPTY_MODULE` precedent), since
  `errorMessage` is presumably already written to be reviewer-facing (e.g.
  `UNRECOGNIZED_CONTENT_TYPE`'s specific unrecognized label, or
  `SESSION_RECOVERY_EXHAUSTED` after repeated resume attempts per LLD §8.3).
  **Flagged below**: confirm `errorMessage` is genuinely safe/appropriate to
  render verbatim to an end user (not an internal stack-trace-style string)
  before wiring it through unmodified; if it can contain internal detail,
  map known error codes to friendlier copy instead and keep `errorMessage` as
  a "technical details" disclosure-triangle for advanced users only.
- Two actions: "Upload a different PDF" (→ `/pdf-processing/upload`) and
  "Delete this import" (same confirm-dialog pattern as §11.2's exit action) —
  a failed session has no forward path (no questions to review), so both
  offered actions are exit paths, not retry-in-place (there is no
  client-triggerable retry endpoint in the route table; do not invent a
  "Retry" button against a nonexistent endpoint).

**Accessibility**: the panel replaces the live-region content of §11.2 in
place — the status change to `Failed` is itself announced by that same
`aria-live="polite"` region (a `Failed` status transition is exactly the kind
of "final state reached" update `aria-live="polite"` is meant to carry;
`assertive` is reserved for errors requiring the user's *immediate*
interruption mid-task, which this is not — the reviewer is already on a
passive waiting screen, not typing into a form).

**Relevant heuristics**: help users recognize/diagnose/recover from errors
(the verbatim-but-honest error message plus two concrete forward actions);
match between system and the real world (calling this "couldn't be
processed" rather than a raw status enum or error code).

### 11.7 Copy summary (this feature)

| Condition | Placement | Copy |
|---|---|---|
| Upload: `INVALID_FILE_SIGNATURE` | Per-field (file picker) | "This file doesn't look like a genuine PDF — it may be corrupted or mislabeled. Choose a different file." |
| Upload: `INVALID_EXTENSION` | Per-field (file picker) | "Only PDF files are supported. Choose a file ending in .pdf." |
| Upload: `EMPTY_FILE` | Per-field (file picker) | "This file is empty. Choose a different file." |
| Upload: `FILE_TOO_LARGE` | Per-field (file picker) | "This PDF is too large. Choose a smaller file." |
| Status: `Pending` | Headline | "Queued for processing…" |
| Status: `Extracting` | Headline | "Reading your document…" |
| Status: `Classifying` | Headline | "Figuring out what kind of document this is…" |
| Status: `Processing` (questions) | Headline | "Generating questions from your document…" |
| Status: `Processing` (reference) | Headline | "Indexing your document for search…" |
| Status: stuck/slow | Headline swap | "Still processing — this can take a bit longer than usual. No need to do anything; this page will update automatically once it's ready." |
| `budgetExhausted` (in progress or completed) | Informational banner | "This document reached its processing budget before every possible question could be generated. The questions generated so far are ready to review below." |
| `reusedFromSessionId` present | Informational note | "This document matches one already processed — reusing its questions instead of reprocessing." |
| Review: empty (no budget issue) | Empty-state block | "No questions were generated from this document. Try uploading a clearer or more detailed version of this document." |
| Review: empty (budget-exhausted) | Empty-state block | "This document reached its processing budget before any question could be generated." |
| Review: bulk-delete confirm | Dialog body | "Delete {n} selected question(s)? This cannot be undone." |
| Review: bulk-regenerate confirm | Dialog body | "Regenerate {n} selected question(s) from the source document? Any edits or flags on these will be replaced. This cannot be undone." |
| Review: bulk-action network/5xx | Toolbar-area banner | "Something went wrong while {deleting/regenerating} the selected questions. Please try again." |
| Review: image reload after expiry (BL-24) | Small text button beneath the image | "Reload" |
| Review: image load failure (BL-24) | Inline text beneath the broken image | "This image couldn't be loaded." |
| Finalize: `NO_ELIGIBLE_QUESTIONS` | Form-level banner | "No questions in this session meet the selected confidence threshold (and auto-generated-only setting, if enabled). Lower the confidence threshold, turn off \"Auto-generated only,\" or review and adjust individual questions before finalizing." |
| Finalize: `EXAM_TYPE_NAME_EXISTS` | Per-field (name) | "An Exam Type named '{name}' already exists. Choose a different name." |
| Finalize: `INVALID_CONTEXT_WEIGHT` | Per-field (weight) | "Context weight must be a whole number from 1 to 10." |
| Finalize: network/5xx | Form-level banner | "Something went wrong while finalizing this Exam Type. Please try again." |
| Finalize success | Snackbar + navigate to Exam Type detail | "Exam Type '{name}' created." |
| Session list: empty | Empty-state block | "No PDF imports yet. Upload one to get started." |
| Session Failed | Panel headline + body | "This document couldn't be processed." + verbatim `errorMessage` |
| Session exit/cancel confirm | Dialog body | "Delete this import? This stops processing and permanently removes the uploaded file and any questions generated so far. This cannot be undone." |

### 11.8 Flags for `nexus-dev`

45. **Client-side file-size pre-check for upload**: this document doesn't add
    one (the configured max size isn't confirmed as client-fetchable this
    phase). If the max size is exposed via `GET /tenant/public-config` or
    similar already-fetched config, add an immediate client-side check rather
    than waiting on a full upload round-trip to learn `FILE_TOO_LARGE`.
46. **Backoff curve for status polling**: LLD §10.2 specifies "every 2s with
    exponential slow-down to 10s" but not the exact step curve. This document
    assumes any reasonable monotonic backoff (e.g. 2s→4s→6s→8s→10s, holding
    at 10s) satisfies the requirement; pick one without further
    over-engineering.
47. **Whether contentType is exposed on the poll response before
    `Completed`**: assumed available from `Classifying` onward for the
    "Indexing your document for search…" vs. "Generating questions…" headline
    split (§11.2). If not exposed until `Completed`, keep a single generic
    "Processing your document…" headline through `Processing` instead of the
    branch, and only reveal the split for `Reference` sessions on the
    post-`Completed` redirect described in §11.3 point 3.
48. **"Stuck at Classifying" threshold**: this document recommends 60 seconds
    of unchanged status before swapping to the reassurance copy (§11.2).
    Tune against real observed AI-outage/retry timing once available;
    not load-bearing at any specific number.
49. **Confidence badge color-banding thresholds**: this document recommends
    ≥0.85 green / 0.60–0.85 amber / <0.60 red (§11.3) as a starting scheme.
    Revisit against real generation-quality data; not load-bearing.
50. **Row-selection scope — current page only, not cross-page "select all
    N"**: this document scopes bulk-select checkboxes to currently-loaded
    rows only (§11.3 point 3). If reviewers commonly need to bulk-act across
    an entire multi-page session, consider adding a "select all N across all
    pages" affordance later; not built this phase.
51. **Reference-session redirect off the review route**: this document
    assumes a `Completed` session whose contentType is `Reference` should
    redirect away from the questions-review table entirely (§11.3 point 3),
    to a dedicated confirmation screen, since no questions exist to review.
    Confirm the actual field/value used to detect this before wiring the
    redirect; if no such field exists cheaply from the session response, an
    acceptable fallback is simply rendering the ordinary Empty state (§11.3)
    with its existing copy, without a special redirect.
52. **Eligible-question live count and auto-grouping preview on the finalize
    wizard**: this document recommends computing both client-side from the
    already-loaded review-question data if realistically available in full
    (not paginated-away), since no "count eligible without finalizing"
    endpoint exists in the route table (§11.4). If the full per-session
    question set isn't practically available client-side (e.g. very large
    sessions), omit both readouts rather than inventing a nonexistent
    endpoint call.
53. **Source-section field name for manual module mapping**: this document
    assumes each reviewed question exposes a `sourceSection`-shaped field the
    finalize wizard can enumerate for the "define modules manually" path
    (§11.4). Confirm the actual field name/shape on the questions response
    before building this sub-section.
54. **`INVALID_CONTEXT_WEIGHT` row disambiguation**: confirm whether the
    error response identifies which curriculum-link row failed when multiple
    rows are present, so §11.4's per-field error placement can target the
    correct row rather than defaulting to the first one.
55. **`errorMessage` end-user-safety on the Failed panel**: confirm
    `session.errorMessage` is written to be reviewer-facing plain language,
    not an internal/technical string, before rendering it verbatim (§11.6);
    if it can be technical, map known codes to friendlier copy and demote
    the raw message to an optional "technical details" disclosure.
56. **Session-list status badge granularity**: this document recommends
    collapsing Pending/Extracting/Classifying/Processing into one shared
    "Processing" badge visual with the specific status as secondary text
    (§11.5), to avoid a five-way badge palette where four values are
    transient. A fully distinct badge per status is equally valid if
    `nexus-dev` prefers it — not load-bearing either way.
57. **Default `minConfidence` slider value**: this document recommends 0.60
    as a non-arbitrary default (matching FR-PDF-5's own "inferred" floor,
    §11.4). Tune against real reviewer feedback once available; not
    load-bearing at this specific number.

---

## 12. Feature: Exam Taking & Review (Dev-20b / BL-17, FR-TAKE-1, FR-TAKE-4, FR-TAKE-5, FR-TAKE-8)

**Surface**: Tenant application (§1a), inside the existing `tenant-shell` (§4.0) —
same shell/sidenav/permission-gating shape as §9/§10/§11, **except** the
in-progress exam-taking screen itself (§12.3), which suppresses the shell's
sidenav/chrome entirely (see §12.3's own framing) the way a full-screen focused
task legitimately should. This is the platform's core end-user flow (per the
dispatch's own framing) — a Member discovers an Exam Type, reads instructions,
takes it one question at a time under a server-authoritative deadline, submits,
and reviews the result. Built on Dev-20a's already-QA-green backend contract
(`attempts.types.ts`, `attempts.controller.ts`, `exam-instructions.controller.ts`,
`errors.ts`) — this section takes every response shape and error code as fixed,
not proposed.

Gated by `attempts.take` (discovery list, instructions, start, take, answer,
submit) and `attempts.read_own`/`attempts.read_all` (history/review — see
§12.6's ownership note, mirroring §11's "review is deliberately
authentication-only" pattern from the controller's own doc comment). This
section builds on §9.3/§11.1's file-form state-machine vocabulary only loosely
(there is no file involved here); the more relevant prior precedent is §11.2's
polling/live-region discipline and §7's confirm-dialog convention, both reused
directly below rather than reinvented.

### 12.0 Route tree and IA

- `/exams/available` — discovery list (§12.1), the nav-item landing page.
  Sidebar item **"Take an Exam"** (a peer of "Exam Types"/"Curriculum"/"PDF
  Import" in the tenant sidenav), gated on `attempts.take` (omit, don't
  disable, per §4.0/§9.1's standing gating convention — a user who can never
  take an exam has no use for this nav item at all).
- `/exams/:examTypeId/instructions` — instructions screen (§12.2), reached
  only from the discovery list's row action, never linked to directly from
  elsewhere in the shell.
- `/attempts/:attemptId/take` — the in-progress exam-taking screen (§12.3),
  one question at a time, entered only via "Start" on the instructions screen
  or "Resume" from the `ATTEMPT_ALREADY_IN_PROGRESS` recovery dialog (§12.2a).
- `/attempts/:attemptId/result` — the immediate post-submit result screen
  (§12.4), reached only via a successful `POST /attempts/:id/submit` response
  (never deep-linked to on its own — a Member returning later to a submitted
  attempt lands on the review screen directly, §12.5).
- `/attempts/:attemptId/review` — the review screen (§12.5), reached from the
  result screen's "Review answers" action and from attempt history (§12.6)
  for any past `Submitted`/`TimedOut` attempt.
- `/attempts/history` — the Member's own attempt history (§12.6), reachable
  from the discovery list (a persistent "My attempts" link) and, for a Tenant
  Admin holding `attempts.read_all`, an additional tenant-wide variant at
  `/admin/attempts` reusing the same table shape with an added "User" column
  (FR-TAKE-9) — not designed in further depth here since the dispatch scopes
  this section to FR-TAKE-1/4/5/8; flagged below (flag 58) as the one
  FR-TAKE-9 admin-oversight surface left under-specified pending a future
  pass, same "flag rather than silently invent" discipline as prior sections.

### 12.1 Discovery list (`/exams/available`)

No prior "browse exams" list exists elsewhere in this document (§9's Exam
Types screens are the **authoring** side, gated on `exams.create`/`exams.view`
for staff building Exam Types — this is the **taking** side, gated on
`attempts.take` for Members consuming them; the two must not be conflated or
merged into one screen even though both ultimately list "Exam Types," because
their audiences, permissions, and available actions are disjoint). Modeled on
§9.1/§10.1/§11.5's list-screen shape, adapted to a **card grid** rather than a
`mat-table` — each item here is a single glanceable choice a Member picks
once and commits to, not a row a user scans/sorts/filters/bulk-acts on the
way an admin table is, so a card grid (Material's own recommended pattern for
a "pick one of these" gallery) fits this task better than reusing the table
convention purely for consistency's sake.

**Flow**: `GET /attempts/available-exams` populates a responsive card grid,
one card per `AvailableExamSummary` — name, description (if present, truncated
to ~2 lines), and a compact metadata line ("{totalQuestions} questions ·
{totalMinutes} min · {moduleCount} module(s)", pluralized naturally per §9.3's
rule). Each card's primary action, "View instructions" (filled button, full
card also clickable), routes to `/exams/:examTypeId/instructions` (§12.2).

**States**:
- **Loading (initial)**: skeleton card grid (3–6 gray placeholder cards
  matching the real card's shape), same skeleton-over-spinner convention as
  every prior list screen (§3.1/§4.1/§9.1/§10.1/§11.5).
- **Empty** (zero Exam Types currently available to this Member — no Exam
  Types exist yet, or none are visible to this Member's role/enrollment):
  centered empty-state block: "No exams are available to you right now. Check
  back later, or contact your administrator if you believe this is a
  mistake." No "create" CTA (a Member taking exams has no authoring
  capability; contrast §9.1's own empty state, which *does* offer a "Create
  Exam Type" CTA for its authoring audience — this is a deliberately
  different empty state for a deliberately different audience, not an
  oversight).
- **Error** (list fetch fails): inline error block + retry, §3.1's
  convention: "We couldn't load available exams. Try again."
- **Success**: grid populated as above.

**Information architecture**: "Take an Exam" nav item → this list is the
landing page; "My attempts" persistent link (top-right of this screen, or a
secondary sidenav item — either is acceptable, not load-bearing) → `/attempts/
history` (§12.6), giving a Member a path to past results without needing to
re-discover it through a completed attempt's own result screen.

**Accessibility**: cards are real interactive elements (`<a>`/button
semantics, not a `<div>` with a click handler) reachable by Tab in grid
reading order, with a visible focus ring per §1b; card metadata line is real
text, not an icon-only summary, so nothing here depends on iconography alone.

**Relevant heuristics**: recognition over recall (metadata visible on the
card itself, no need to open instructions just to see question count/
duration before deciding).

**Responsive behavior**: multi-column grid on desktop (3–4 columns depending
on viewport), 2 columns on tablet, single column full-width cards on mobile
(below 599.98px) — standard Material card-grid reflow, no table-to-card
translation needed since this was never a table.

### 12.2 Instructions screen (`/exams/:examTypeId/instructions`)

**Flow**:
1. `GET /exam-types/:id/instructions` on entry — renders `ExamInstructions`:
   exam name as the page heading, description (if present) beneath it, then a
   clearly labeled summary block: total questions, total duration (minutes,
   phrased as "You will have {totalMinutes} minutes to complete this exam"
   rather than a bare number, per match-between-system-and-real-world — the
   Member needs to understand this is a hard ceiling, not an estimate), and a
   simple list of modules (`moduleName` + `questionCount` per module,
   e.g. "Module 2: Networking Fundamentals — 15 questions").
2. A single primary CTA, **"Start Exam"** (filled, prominent — this is a
   deliberate, consequential action per FR-TAKE-2/FR-TAKE-6: starting
   immediately begins the server-authoritative countdown, so the button copy
   and a short line directly beneath it make that explicit rather than
   implying a casual "preview" action: "Starting begins your timer
   immediately — make sure you're ready before continuing."), calling `POST
   /attempts` with the `examTypeId`.
3. Success (`201 StartAttemptResult`) → navigate immediately to
   `/attempts/:attemptId/take` (§12.3), which renders `firstQuestion`
   directly from the same response (no extra round-trip needed to show
   question 1 — same "land already-populated" convention as prior sections'
   "land on the resource you just created" moves).
4. Exit (before starting): a "Back to exams" link back to `/exams/available`
   (§12.1) — always available, no confirmation needed (nothing has been
   committed yet).

**States**:
- **Loading (initial)**: skeleton detail layout (heading-shaped bar +
  paragraph-shaped bars + a skeleton module list), same convention as
  §9.2/§10.2.
- **Error**: `EXAM_TYPE_NOT_FOUND` (id invalid, deleted, or not visible to
  this Member) → panel-replacing message, same treatment as §10.2's
  not-found case: "This exam doesn't exist or isn't available to you." with
  a "Back to exams" action. Network/5xx → inline error block + retry.
- **Starting** (button clicked, `POST /attempts` in flight): button shows an
  inline spinner + "Starting…" label, disabled for the duration; the rest of
  the instructions content remains visible and unchanged underneath (no
  reason to blank the screen for a single-request transactional call, same
  restraint as §11.4's finalize-submit treatment).
- **`INSUFFICIENT_QUESTION_BANK` (400, FR-TAKE-3)**: form-level (page-level)
  banner naming the deficient module and shortfall **verbatim from the
  server's own message** (the error already names the module and states
  available-vs-required, per `errors.ts`'s `InsufficientQuestionBankError`) —
  do not paraphrase this into a generic "can't start" message, per this
  document's standing "pass server-supplied specific detail through
  verbatim" rule (§9.3/§11.6 precedent): render the error's own `message`
  string directly. No retry action beyond "Back to exams" — this is a
  content-authoring gap the Member cannot personally fix, so the only honest
  next step is to leave, not to hit "Start" again expecting a different
  result.
- **`ATTEMPT_ALREADY_IN_PROGRESS` (409)** — see §12.2a immediately below;
  this is a **named recovery state**, not a generic error banner.

#### 12.2a `ATTEMPT_ALREADY_IN_PROGRESS` — resume dialog

Per FR-TAKE-2, a Member can hold at most one `InProgress` attempt per Exam
Type; clicking "Start Exam" while one already exists is an entirely expected,
recoverable situation (the error body carries the resumable `attemptId`
specifically so the client can offer resumption), not a dead-end fault — it
must never render as a plain "something went wrong" toast.

**Treatment**: a non-dismissible-by-backdrop-click `mat-dialog` (reuse
§4.5/§6.3/§9.4/§7.5's `shared/ui/confirm-dialog` shape, non-destructive
styling since resuming is the *expected*, encouraged path here, not a
cautionary one):

> **You already have this exam in progress**
> You started this exam earlier and haven't finished it yet. You can pick up
> right where you left off, with your remaining time already counted down.

Two actions: **"Resume"** (primary, filled) → navigates directly to
`/attempts/:attemptId/take` using the `attemptId` the error body supplied
(no new `POST /attempts` call — this is not a new attempt), and **"Cancel"**
(text button) → dismisses the dialog, returning the Member to the
instructions screen exactly as it was (no attempt is started or altered by
canceling). There is no third "abandon and start fresh" option in this phase
— FR-TAKE-2 defines only resume-or-reject, never a client-triggerable
force-restart, so this dialog must not invent one.

**Accessibility**: standard `mat-dialog` focus-trap semantics (focus moves
into the dialog on open, returns to the "Start Exam" button on close/cancel,
same convention every prior confirm-dialog in this document already
establishes), `role="alertdialog"` given this interrupts an in-progress
action the user just took with information they need before proceeding.

### 12.3 Taking the exam (`/attempts/:attemptId/take`)

This is the flow's center of gravity, and the section the dispatch's four
numbered asks are primarily about.

**Shell treatment**: this route suppresses the tenant-shell's sidenav/top-nav
chrome (a distraction-minimizing, exam-proctoring-adjacent convention — the
persistent header described below **replaces** the shell's own header for the
duration of this route, not stacks beneath it) and reintroduces it only on
`/attempts/:attemptId/result` (§12.4) onward. This is a deliberate exception
to §4.0's "always inside the shell" baseline, flagged here explicitly (flag
59) as the one screen in this document that departs from that baseline, and
justified by the same reasoning a full-screen exam UI universally uses:
minimizing incidental navigation temptation/distraction during a timed,
graded task.

**Persistent header** (present on every question, sourced from a combination
of the `StartAttemptResult`/`GET /attempts/:id` `AttemptHeader` and the
current question's own index — do not re-fetch the header on every question
navigation; the header's own fields, other than `answeredCount`, are static
for the attempt's lifetime and `answeredCount` is knowable client-side from
the Member's own navigation without a dedicated re-fetch):
- Exam name (`examTypeName`), left-aligned.
- **"Question {n} of {totalQuestions}"**, center or right per layout, always
  visible, updates immediately on navigation.
- **Timer** (elapsed-vs-total, per FR-TAKE-4) — see the dedicated timer
  sub-section below; this is the header's most behaviorally significant
  element and gets its own full treatment rather than a one-line mention.
- A thin linear progress indicator beneath the header (visual "how far
  through the question count" cue, `answeredCount`/`totalQuestions` or
  `currentIndex`/`totalQuestions` — either is defensible; recommend
  `currentIndex`/`totalQuestions` since it reflects navigation position, the
  thing the header's "Question n of total" text already states, keeping the
  two numbers consistent with each other rather than one counting answered
  and the other counting visited) — purely decorative reinforcement of the
  "N of total" text already present, not a replacement for it (never convey
  progress via the bar alone, per §1b's no-color/no-icon-alone standard
  extended to "no progress-bar-alone" here).

**Timer — precise behavior** (HLD §10.4: server-authoritative, client
display-only):
- On entering the screen (from `StartAttemptResult` or a subsequent `GET
  /attempts/:id`), the client receives `startTime`, `deadlineAt`, and
  `serverNow` together in the same response. Compute a one-time clock-skew
  offset (`serverNow - Date.now()` at receipt) and apply that offset to all
  subsequent local-clock timer ticks, rather than trusting the Member's
  device clock directly — this keeps the *displayed* countdown honest even
  when the device clock is wrong, without needing to re-fetch `serverNow`
  every tick.
- Display format: total time remaining, counting down (e.g. "34:12
  remaining"), updating once per second via a local `setInterval`/timer —
  this is **purely cosmetic**; per HLD §10.4 the client never enforces the
  deadline itself (no "auto-navigate away at 0:00" logic that fires
  client-side) — enforcement is entirely server-side via the lazy-timeout
  path (see the named edge-case state immediately below), so the client
  timer reaching zero simply keeps displaying "0:00" (or "Time's up —
  submitting…" framing, see below) and waits for the Member's next
  interaction to surface the server's authoritative outcome, rather than
  racing to synthesize its own submit call.
- **At the instant the client timer reaches 0:00**, switch the timer's
  visible text to a distinct "Time's up" framing ("Time's up — your next
  action will submit this exam.") rather than freezing at "0:00" with no
  explanation, so a Member watching the header understands what's about to
  happen on their very next click, softening (though not eliminating, since
  clock skew/tab suspension mean this client-side moment and the server's
  real deadline are only approximately aligned) the surprise of the named
  edge case below.
- **Warning thresholds**: the timer's on-screen color shifts to
  `--el-color-error`-toned text (never relying on color alone — the text
  itself already states the remaining time, so this is a supplementary cue,
  not the only one) once remaining time drops below 5 minutes, consistent
  with a conventional "running low" visual pattern.

**Timer's screen-reader treatment** (the dispatch's specific accessibility
ask): the timer's visible text updates every second, but **is not itself
wrapped in an `aria-live` region** — a live region firing every second would
violate both the spirit of WCAG 2.2's 4.1.3 Status Messages (which expects
status updates to be perceivable, not necessarily every single tick of a
constantly-changing value) and basic screen-reader usability (a per-second
announcement would be genuinely unusable, drowning out every other action a
Member takes during that same second). Instead:
- The timer is a normal, focusable-adjacent static text element, discoverable
  by a screen-reader user navigating to it at any time (its current value is
  always available on request, just not push-announced every tick) — same
  "perceivable without being intrusive" principle already established for
  §11.2's spinner-vs-live-region split, applied here to a much higher-
  frequency value.
- A **separate, low-frequency `aria-live="polite"` announcement region**
  (visually hidden, screen-reader-only) fires at exactly three points in an
  attempt's lifecycle: once on entry ("You have {totalMinutes} minutes for
  this exam."), once when remaining time first crosses **5 minutes** ("5
  minutes remaining."), and once when it first crosses **1 minute** ("1
  minute remaining."). These three thresholds mirror the visual warning
  threshold above (5 minutes) plus a final urgent checkpoint (1 minute) and
  the natural on-entry orientation announcement — deliberately not more
  granular than this, since the goal is meaningful checkpoints a Member
  needs to act on, not a running commentary.
- Each threshold announcement fires **exactly once** per attempt (guarded by
  a client-side flag per threshold, not re-derived from a range check every
  tick, to avoid re-announcing if the same second is somehow re-rendered).

**Question view** (`AttemptQuestionView`):
- `questionText` as the screen's main heading-adjacent content (an `<h2>` or
  equivalent, not a plain paragraph — see focus-management below, this
  heading is exactly where focus lands after navigation).
- Options (`Record<string, string>`, i.e. option-key → option-text) rendered
  as a **Material radio group** (`mat-radio-group` over `mat-radio-button`
  per option) — genuinely a native single-select radio group semantically,
  not a set of independently-styled clickable cards with manual ARIA
  bolted on, since a radio group is the exact native pattern this
  interaction already is (WAI-ARIA APG's own recommended pattern for
  "choose exactly one of a small, fully-visible set of options" — a listbox
  or custom widget would be over-engineering here).
- `selectedOption` (if non-null, e.g. returning to a previously-answered
  question via "Previous") pre-selects the matching radio button on render.
- Selecting an option fires `POST /attempts/:id/questions/:index/answer`
  immediately (autosave-on-select, not gated behind a separate "confirm
  answer" step) — per FR-TAKE-5, "a selection can be changed while the
  attempt is in progress," so re-selecting a different option simply
  re-fires the same call with the new value; the radio group itself remains
  fully interactive throughout (never locks after a first selection).
- A small, unobtrusive **inline save-confirmation** appears briefly next to
  the option group after each successful answer call resolves (e.g. a
  `check` icon + "Saved" fading in/out over ~1.5s) — visibility of system
  status for an action that has no other visible consequence (no page
  change, no navigation), so the Member has *some* confirmation their
  selection was recorded server-side, not just visually toggled locally.
  This is deliberately lightweight (no snackbar — a snackbar firing on every
  single option click across 20+ questions would be noisy, violating
  aesthetic & minimalist design) and non-blocking (the Member can move on
  immediately without waiting for it).
- **Answer-call failure** (network/5xx on the answer call itself, not the
  named `ATTEMPT_NOT_IN_PROGRESS` edge case below): the radio selection
  visually reverts to the previously-confirmed value and a small inline
  error note appears beside the option group: "Your answer couldn't be
  saved. Try selecting again." — the Member's attempted selection is not
  silently accepted as if saved when it wasn't (error prevention/visibility
  of system status: never show a selection as active locally if the server
  hasn't actually confirmed it).

**Navigation controls** (bottom of screen, persistent): "Previous" (disabled
and hidden — not merely disabled, per §1a/§9's own precedent of omitting
truly inapplicable controls rather than showing a permanently-dead one — on
question 1) and "Next", which becomes **"Submit"** (distinct filled/primary
styling, not just a relabeled "Next") on the final question
(`questionIndex === totalQuestions - 1`), per FR-TAKE-4's explicit "final
question's action changes from Next to Submit."

- **"Previous"/"Next"** simply navigate between already-fetched-or-fetchable
  question indices (`GET /attempts/:id/questions/:index`); answering is
  never required to navigate away from a question (a Member may skip and
  return later — nothing in FR-TAKE-4/5 requires an answer before
  advancing).
- **"Submit"** opens a lightweight confirm dialog before actually calling
  `POST /attempts/:id/submit` (error prevention + user control/freedom — this
  is the flow's single most consequential, irreversible action, and per
  FR-TAKE-7 a second submit attempt is flatly rejected, so there is no "oops,
  undo" available after the fact): reuse `shared/ui/confirm-dialog`, body
  text naming the concrete state so the Member can make an informed final
  choice: "Submit this exam? You've answered {answeredCount} of
  {totalQuestions} questions. Once submitted, you can't change any answers."
  (If `answeredCount < totalQuestions`, this sentence itself is the
  unanswered-questions warning — no separate dedicated "you have unanswered
  questions" banner is needed beyond stating the count plainly here.)
  Confirming calls `POST /attempts/:id/submit` and, on success, navigates to
  `/attempts/:attemptId/result` (§12.4).

**Loading states between question navigations** (the dispatch's specific
ask — precise, not "handle gracefully"):
- **The current question remains fully visible, unchanged, until the next
  question's data has actually arrived** — no blanking, no skeleton swap-in
  for a simple index navigation (this is a fast, already-known-shape
  request; a full skeleton flash here would be a worse experience than a
  brief static hold, and would violate the "avoid unnecessary layout
  shift/flash" instinct this document already applies to lighter refresh
  loads elsewhere, e.g. §3.1/§7.1's row-scoped-spinner-over-full-skeleton
  convention for non-initial loads).
- **Both "Previous" and "Next"/"Submit" are disabled for the duration of the
  in-flight navigation request**, with the clicked button specifically
  showing an inline `mat-progress-spinner` in place of/beside its label
  (e.g. "Next" → spinner, or "Submit" → spinner + "Submitting…") — this
  communicates exactly which action is in flight (visibility of system
  status) while preventing a double-click from firing two overlapping
  navigation/submit requests, the same "disable the specific button, not the
  whole screen" restraint §9.2/§11.4 already use for single-request
  transactional calls.
- The radio group and question text remain visually static (not dimmed/
  overlaid) during this brief in-flight window — unlike a slower structural
  load elsewhere in this document, a question-to-question navigation is
  expected to resolve in well under a second under normal conditions, so a
  dimming treatment would introduce visible flicker for no benefit; if
  `nexus-dev` finds real-world latency meaningfully higher, a short
  (e.g. 300ms) delay-before-showing-spinner threshold is an acceptable
  refinement, not a deviation.
- On the new question's data arriving, the question text/options
  swap in as a unit (never an in-between state showing question 5's text
  with question 6's options, or similar partial swap) and buttons re-enable.

**Focus management on question transitions** (the dispatch's specific
ask): after a successful "Next"/"Previous"/navigation completes, **focus
moves programmatically to the new question's heading** (the `questionText`
`<h2>` from above, given `tabindex="-1"` so it's programmatically focusable
without being in the normal Tab order) — not left stranded on the
now-potentially-relabeled "Next"/"Submit" button, and not reset all the way
up to the page's outer container. This mirrors the exact "move focus to what
just meaningfully changed" principle this document already applies to
dialogs, wizard-step reveals, and repeater add/remove actions (§9.3/§11.4);
a screen-reader user landing on the new question's heading immediately
understands "I'm now looking at a new question" and can navigate its options
from a sensible, predictable starting point, rather than having to
re-discover where they are on the page after every single navigation.

**Keyboard-only operability** (the dispatch's specific ask):
- Tab order: header (non-interactive, skipped) → radio group (arrow keys
  move selection within the group per native `mat-radio-group` behavior,
  Tab enters/exits the group as one stop, Space/Enter on a focused radio
  selects it — all native HTML radio-group semantics, not reimplemented) →
  "Previous" (if present) → "Next"/"Submit". This is the natural DOM order a
  correctly-marked-up radio group + trailing buttons already produces; no
  custom `tabindex` choreography is needed beyond the post-navigation
  focus-landing point described above.
- Selecting an option via keyboard (arrow keys within the radio group) fires
  the same autosave-on-select answer call as a mouse click — keyboard and
  pointer interaction are functionally identical paths into the same
  component, never a keyboard-only degraded experience.
- "Next"/"Submit"/"Previous" are real `<button>` elements (native Enter/
  Space activation, no custom click-handler-on-div substitute), consistent
  with every other actionable control in this document.

### 12.3a Named edge case: mid-navigation server-side timeout

This is a **named state, not a fallback generic-error toast** — the dispatch
is explicit that this deserves its own defined copy and recovery action, and
this document treats it accordingly.

**Mechanism** (HLD §10.4): the client's countdown display is cosmetic only;
the server's `deadline_at`, persisted at attempt creation, is the sole
enforcement point. Any read/write against an `InProgress` attempt whose
deadline has already passed triggers the lazy-timeout path — scoring +
`status = 'TimedOut'` — **before** that request is served. Concretely: a
Member on question 5 of 20 clicks "Next" (or triggers an answer save) at a
moment when their local timer still shows time remaining (clock drift, a
suspended/backgrounded tab, or simply a request that started just before and
resolved just after the true deadline) — the server closes the attempt out
from under that very request, and the response the client receives back is
not the expected next-question payload but an `ATTEMPT_NOT_IN_PROGRESS`
error.

**UI treatment — the "Time Expired" interstitial**: on receiving
`ATTEMPT_NOT_IN_PROGRESS` from *any* in-flight action on the taking screen
(Next, Previous, Submit, or an answer-save call), **immediately replace the
entire question-taking screen** (not a toast, not a banner stacked above the
now-stale question content) with a dedicated full-screen interstitial:

> **Time's up**
> The time allowed for this exam ran out while you were answering. Your exam
> was automatically submitted with the answers you had saved.
>
> **[View my results →]**

- The `[View my results]` button routes directly to
  `/attempts/:attemptId/result` (§12.4) — since the attempt is now
  authoritatively `TimedOut`/scored server-side, the result screen's own
  `GET`/whatever confirms this works unmodified for a `TimedOut` status
  exactly as it does for a Member-initiated `Submitted` one (§12.4 already
  handles both `SubmitResult.status` values identically in its content,
  see below), so no special-cased result rendering is needed beyond that.
- This interstitial takes over the full screen precisely because the
  question content underneath it is now meaningless/stale — showing it dimmed
  behind a modal (as a lighter-weight error might warrant) would invite a
  confused Member to keep trying to interact with a question that can no
  longer accept answers; a full replacement removes that temptation
  entirely (error prevention via removing the possibility of a doomed retry,
  not just discouraging it).
- Distinct from a generic network/5xx error on the same calls: a genuine
  network failure (request never reached the server, or a real 5xx) keeps
  the Member on the question screen with a small inline retry affordance
  ("Something went wrong. Try again.") exactly as §12.3's ordinary
  answer-failure handling above describes — **only** the specific
  `ATTEMPT_NOT_IN_PROGRESS` code triggers this named full-screen
  interstitial, because only that code means the attempt itself is
  authoritatively over, versus "this one request failed but the attempt is
  still alive and worth retrying against."
- No "Try again" or "Go back" action is offered on this interstitial (unlike
  the ordinary retry-inline case) — there is nothing to retry against; the
  attempt is over. The single forward action is reviewing the outcome.

**Accessibility**: the interstitial replacing the screen is announced via
the same `aria-live="polite"` pattern §11.2/§11.6 already establish for a
final-state transition a screen-reader user needs to know about without
needing to re-discover it, and receives programmatic focus on appearing
(focus moves to the interstitial's heading, "Time's up," per the same
"move focus to what just meaningfully changed" rule used throughout this
document).

**Relevant heuristics**: visibility of system status (the Member is told
exactly what happened and why, not left staring at a question that silently
stopped responding); help users recognize/diagnose/recover from errors (a
concrete, single, correct next action — view results — rather than a dead
end or an invitation to retry something that cannot succeed); error
prevention (removing, not just discouraging, further doomed interaction with
the stale question content).

### 12.4 Post-submit result screen (`/attempts/:attemptId/result`)

Re-enters the tenant-shell's normal chrome (§12.3's suppression ends here).

**Flow**: renders the `SubmitResult` returned by the submit call (or, for the
timed-out path, the equivalent data the result screen's own fetch returns for
a now-`TimedOut` attempt — both statuses render through the same screen and
mostly-shared copy, distinguished only by the headline, see below):
- Headline: "Exam submitted" (`status === 'Submitted'`) or "Time's up — exam
  submitted automatically" (`status === 'TimedOut'`, matching the language
  the §12.3a interstitial already used, so a Member arriving here via that
  path sees consistent framing rather than a screen that suddenly stops
  mentioning the time-out at all).
- A prominent score summary: `scorePercent` as the dominant figure, with
  `correctCount`/`wrongCount`/`answeredCount` of `totalQuestions` beneath it
  as supporting detail (e.g. "16 correct · 4 wrong · 20 of 20 answered").
- Two actions: **"Review answers"** (primary, filled) → `/attempts/
  :attemptId/review` (§12.5), and **"Back to exams"** (secondary) →
  `/exams/available` (§12.1).

**States**: Loading (brief skeleton for the score block while the submit
response resolves, typically instantaneous given submit is the same
single-request/single-response shape as §11.4's finalize); this screen has no
meaningful error state of its own beyond ordinary route-guard handling (a
Member cannot reach it without a real just-completed submit or timeout, so
there's no "not found"-class case worth designing for here, unlike §12.2's
instructions screen which is reachable via arbitrary URL entry).

**Accessibility**: the score summary is the page's primary heading-adjacent
content, receiving focus on route entry (same "land with focus on the thing
that matters" convention as the taking screen's per-question heading focus).

**Relevant heuristics**: visibility of system status (this screen exists
specifically to close the loop on the action the Member just took, rather
than silently dropping them back on the exam list with no confirmation).

### 12.5 Review screen (`/attempts/:attemptId/review`)

Reached from the result screen (§12.4, immediately post-submit) and from
attempt history (§12.6, for any past `Submitted`/`TimedOut` attempt) —
identical screen either way, no separate "recent" vs. "historical" variant.

**Flow**: `GET /attempts/:id/review?filter=all|wrong` — a **toggle** (a
`mat-button-toggle-group` of two options, "All questions" / "Wrong answers
only", not two separate routes/tabs) sits at the top of the screen above the
item list, defaulting to "All questions" on first load. Switching the toggle
re-fetches with the new `filter` value (a fresh network call per toggle,
matching the endpoint's own query-param shape, rather than fetching `all`
once and filtering client-side — simpler, and correctly reflects the
server as the single source of truth for what counts as "wrong" the way
every other server-authoritative concern in this document is treated). Per
FR-TAKE-8, **ordering is always by original question position regardless of
filter** — "wrong only" is a subset view, never a re-ordered one, so
switching the toggle never causes items to visually reorder relative to each
other, only some to appear/disappear.

**Item content** (one `AttemptReviewItem` per row/card, per FR-TAKE-8's
required fields — "the question, all options, the Member's selection,
correctness, and the explanation"):
- `questionText`, with the original question number prefixed ("Question 7:
  …") so the "always ordered by original position" guarantee is visible to
  the Member, not just true under the hood — this is exactly the kind of
  fact this document elsewhere insists on making legible rather than merely
  correct (e.g. §11's Human-edited/Review-flag "distinctly shown" framing).
- All `options`, each rendered with three possible visual treatments,
  distinctly and simultaneously legible (never color-alone, per §1b):
  - The **correct answer** (`correctAnswer`): a `check_circle` icon
    (`--el-color-success`) + "Correct answer" label, regardless of whether
    the Member selected it.
  - The **Member's selection** (`selectedOption`), if it differs from
    the correct answer: an `error`/`cancel` icon (`--el-color-error`) +
    "Your answer" label on that option.
  - If `selectedOption === correctAnswer`: a single combined treatment on
    that one option (success icon + "Your answer — correct", not two
    stacked badges competing for the same option row).
  - If `selectedOption` is `null` (the Member reached submit/timeout without
    ever answering this question): no "Your answer" marker appears on any
    option, and a plain neutral note below the options reads "You didn't
    answer this question" — distinct from a wrong-answer treatment (this is
    "no answer given," not "wrong answer given," and per match-between-
    system-and-the-real-world the copy must say so plainly rather than
    implying the Member picked something incorrect).
  - Every other, non-selected, non-correct option: plain, unmarked text —
    no icon, no color treatment, exactly the "leave the uninvolved options
    alone" restraint this implies.
- `isCorrect` drives a small overall badge on the item itself ("Correct" /
  "Wrong" / — if `null`, meaning unanswered — no badge at all, relying on the
  "didn't answer" note above instead of forcing a correct/wrong binary onto
  a question that was never attempted), positioned consistently (e.g.
  top-right of each item) so a Member scanning down the list can assess
  overall performance at a glance without reading every option in every row.
- `explanation` (if non-null) rendered beneath the options, visually
  distinct (e.g. a light `--el-color-surface-container` background block
  with a small "Explanation" label) so it reads as supplementary teaching
  content, not as part of the question/options block itself. If `null`
  (no explanation authored for this question), omit the block entirely
  rather than showing an empty "Explanation" label with nothing beneath it.

**States**:
- **Loading (initial, and on every toggle switch)**: skeleton item list
  (§3.1's convention) — a toggle switch is treated as a fresh, if brief,
  load rather than an instant client-side filter, consistent with the
  "always hit the server for filter truth" decision above; keep this
  lightweight (skeleton, not a full-page blank) since the request is small
  and fast.
- **Empty ("wrong only" filter, zero wrong answers)**: this is a
  genuinely positive empty state, not a generic "no results" — per
  aesthetic & minimalist design and match-between-system-and-real-world (an
  empty "wrong answers" list is good news, and must read that way): a
  centered block with a `check_circle`/celebratory (but not garish) treatment:
  "You got every question right! There's nothing to review here." with the
  toggle remaining visible so the Member can switch to "All questions" to
  see the full list if they want to.
- **Error** (review fetch fails): inline error block + retry, §3.1's
  convention: "We couldn't load your review. Try again."
- **Success**: item list rendered per above.

**Information architecture**: reached from §12.4's "Review answers" and
§12.6's history-row action ("Review" label on any `Submitted`/`TimedOut`
row) — no independent nav-item entry point of its own, consistent with this
being a detail view of a specific attempt rather than a standalone section.

**Accessibility**: the toggle group uses native `mat-button-toggle-group`
semantics (`role="group"`, arrow-key navigation between the two options,
same APG pattern as a native radio group); switching the toggle's resulting
item-list re-render is wrapped in an `aria-live="polite"` announcement of the
new count ("Showing 4 of 20 questions" / "Showing all 20 questions") so a
screen-reader user gets the same "results ready, here's how many" signal
§10.3c's search results already establish for an analogous filter-and-
refetch interaction. Each option's correct/selected/neutral status is
conveyed via icon + text label together (never icon or color alone, per
§1b), and the overall correct/wrong badge per item likewise pairs an icon
with visible text.

**Relevant heuristics**: recognition over recall (correct answer always
shown regardless of the Member's own selection, so nothing requires the
Member to remember or infer the right answer from context); match between
the system and the real world (the "didn't answer" vs. "wrong answer"
distinction above; the positive framing of a zero-wrong empty state).

**Responsive behavior**: single-column stacked item list at every breakpoint
(each item is prose-plus-options content that benefits from full width the
same way §10.3c's search results do) — the toggle group remains full-width
or centered at the top at every breakpoint, never collapsed into an
overflow menu (it's exactly two options, always cheap to show both).

### 12.6 Attempt history (`/attempts/history`)

Modeled directly on §9.1/§10.1/§11.5's list-screen shape (a real `mat-table`
this time, not a card grid — this is a scannable, potentially-sortable log of
past activity, the opposite of §12.1's "pick one" gallery framing).

**Flow**: `GET /attempts` (own history; optionally filtered by
`examTypeId` via a `mat-select` filter above the table, per FR-TAKE-9's
"optionally filtered to one Exam Type") — columns: Exam name
(`examTypeName`), Status (`StatusBadgeComponent`, §3.1a's convention:
`InProgress` gets the same "informational, transient" treatment as §3's
`Provisioning`/§11.5's in-progress badges; `Submitted` gets a neutral/
success-adjacent "complete" treatment distinct from `TimedOut`'s own badge,
since a Member should be able to tell at a glance which of their past
attempts ran out the clock versus which they submitted deliberately — these
must not share one badge, per the same "distinctly shown" precedent as
§11.3's Human-edited/Review-flag pair), Score (`scorePercent`, or "—" for a
still-`InProgress` row with no score yet), Started (`startTime`, relative +
absolute-on-hover per §3.1/§4.1's convention), Actions (row action: "Review"
→ `/attempts/:attemptId/review` for `Submitted`/`TimedOut` rows, "Resume" →
`/attempts/:attemptId/take` for the (at most one, per FR-TAKE-2)
`InProgress` row if present).

**States**: Loading (skeleton table rows, §3.1's convention), Empty ("You
haven't taken any exams yet." + a "Browse available exams" CTA →
`/exams/available`, gated the same omit-not-disable way as prior empty-state
CTAs, though here there's nothing to gate — every Member who can reach this
screen can also reach the discovery list), Error (inline block + retry),
Success.

**Tenant Admin oversight variant** (FR-TAKE-9's "same level of detail" across
the whole tenant): flagged as under-specified this pass (flag 58 above) —
this document assumes it reuses the identical table shape with an added
"User" column, sourced from `GET /admin/attempts`, gated on
`attempts.read_all`, but does not further design its own filter/search
affordances (by user, by Exam Type) beyond noting the endpoint already
accepts both as query params per `AdminAttemptHistoryQueryDto`.

**Responsive behavior**: table-to-stacked-card degradation below 599.98px,
identical convention to every prior table in this document (§3.1/§4.1/
§9.1/§11.3/§11.5) — exam name + status badge prominent, score + started as a
compact metadata line, action button/link at the card's trailing edge.

### 12.7 Copy summary (this feature)

| Condition | Placement | Copy |
|---|---|---|
| Discovery: empty | Empty-state block | "No exams are available to you right now. Check back later, or contact your administrator if you believe this is a mistake." |
| Discovery: fetch failure | Inline error block | "We couldn't load available exams. Try again." |
| Instructions: duration framing | Summary block | "You will have {totalMinutes} minutes to complete this exam." |
| Instructions: Start CTA sub-line | Beneath "Start Exam" button | "Starting begins your timer immediately — make sure you're ready before continuing." |
| Instructions: `EXAM_TYPE_NOT_FOUND` | Panel-replacing message | "This exam doesn't exist or isn't available to you." |
| Instructions: `INSUFFICIENT_QUESTION_BANK` | Page-level banner | Verbatim server `message` (already names the module + shortfall) |
| `ATTEMPT_ALREADY_IN_PROGRESS` | Resume dialog | "You already have this exam in progress. You started this exam earlier and haven't finished it yet. You can pick up right where you left off, with your remaining time already counted down." |
| Timer: entry announcement (SR-only) | Live region, on entry | "You have {totalMinutes} minutes for this exam." |
| Timer: 5-minute threshold (SR-only) | Live region, once | "5 minutes remaining." |
| Timer: 1-minute threshold (SR-only) | Live region, once | "1 minute remaining." |
| Timer: reached zero | Header timer text | "Time's up — your next action will submit this exam." |
| Answer save failure | Inline note beside options | "Your answer couldn't be saved. Try selecting again." |
| Submit confirm | Dialog body | "Submit this exam? You've answered {answeredCount} of {totalQuestions} questions. Once submitted, you can't change any answers." |
| Mid-navigation server timeout | Full-screen interstitial | "Time's up. The time allowed for this exam ran out while you were answering. Your exam was automatically submitted with the answers you had saved." + "View my results" |
| Result: submitted | Headline | "Exam submitted" |
| Result: timed out | Headline | "Time's up — exam submitted automatically" |
| Review: unanswered question | Neutral inline note | "You didn't answer this question." |
| Review: zero wrong answers | Positive empty state | "You got every question right! There's nothing to review here." |
| Review: fetch failure | Inline error block | "We couldn't load your review. Try again." |
| History: empty | Empty-state block | "You haven't taken any exams yet." |

### 12.8 Flags for `nexus-dev`

58. **FR-TAKE-9 tenant-wide oversight view**: this section scopes its detailed
    design to FR-TAKE-1/4/5/8 per the dispatch; §12.6's admin variant is
    assumed to reuse the own-history table shape plus a "User" column and the
    existing `AdminAttemptHistoryQueryDto` filters, but its own filter/search
    UI (by user, by Exam Type) isn't independently designed here — give it a
    proper pass before building if the admin oversight screen turns out to
    need materially different UI from a straight column addition.
59. **Shell-chrome suppression on the taking screen**: §12.3 suppresses the
    tenant-shell's sidenav/top-nav for the duration of `/attempts/:id/take`,
    the one deliberate exception to §4.0's "always inside the shell"
    baseline in this document. Confirm this matches `nexus-dev`'s actual
    shell/router-outlet architecture (e.g. a layout-less route vs. a
    shell-internal "focus mode" flag) before building — the UX intent
    (minimize distraction during a timed task) is the load-bearing part,
    not any specific implementation mechanism.
60. **Header re-fetch cadence**: this document assumes the persistent header
    (exam name, question n of total, timer inputs) is populated once from
    `StartAttemptResult`/the initial `GET /attempts/:id` and never
    re-fetched purely for header purposes during normal question-to-question
    navigation (only `GET /attempts/:id/questions/:index` is called per
    navigation). If `nexus-dev` finds a reason the header needs periodic
    re-validation against the server (e.g. detecting an out-of-band
    timeout before the Member's next click, rather than only discovering
    it reactively per §12.3a), that's a reasonable enhancement but changes
    the "display-only, discovered reactively" framing HLD §10.4 and this
    section both currently assume — flag any such change back into this
    document rather than silently diverging from it.
61. **"Previous" availability policy**: this document assumes free
    back-and-forth navigation between any already-reached question index
    (no restriction beyond `QUESTION_NOT_FOUND`'s out-of-range/wrong-attempt
    guard). If the real product intent is closer to a forward-only exam
    (no revisiting earlier questions), that's a materially different flow
    from what's designed here and needs its own pass — nothing in
    FR-TAKE-4/5 as read for this dispatch implies a forward-only
    restriction, so this document defaults to allowing full navigation.

---

## 13. Feature: Prompt Practice (Dev-21 / BL-18, FR-CUR-5)

**Surface**: Tenant application (§1a), inside the existing `tenant-shell` (§4.0) —
same shell/sidenav shape as §9/§10/§11/§12, no new shell. This is a Member-facing
generation flow, not a reviewer/authoring surface, so its confidence handling is
deliberately different from §11.3's reviewer-facing numeric confidence badge (see
the "Confidence — deliberately not surfaced" note under Results below).

Gated the same "omit the nav item, don't disable it" way as §12.0 — assume a
`curricula.practice`-shaped capability (**flagged below, flag 62**, since the real
RBAC model for this specific action isn't confirmed) rather than reusing the plain
"can own a Curriculum" check §10's nav item uses, since prompt practice is a
distinct, LLM-cost-bearing action from Curriculum CRUD and may reasonably be its
own gate.

**Information architecture**: a new top-level sidebar item, **"Prompt Practice"**,
a peer of "Take an Exam" (§12.0) and "Curriculum" (§10) — not nested under
Curriculum, because per FR-CUR-5 the flow's own first step *is* picking a
Curriculum (the same "discovery-first" shape as §12.1's Exam Type gallery, not a
sub-action of an already-open Curriculum). Also add a secondary entry point: a
"Practice from this Curriculum" button on the Curriculum detail screen (§10.3,
placed near Search, §10.3c) that deep-links into the same screen with the
Curriculum pre-selected — a convenience shortcut, not a second implementation.
Route: `/practice/prompt` (optionally `/practice/prompt?curriculumId=`).

### 13.1 Entry, flow, and generation

**Flow**:
1. Reached via the "Prompt Practice" nav item, or the Curriculum detail shortcut
   above (pre-selecting that Curriculum).
2. Form fields, in order:
   - **Curriculum** (required) — a `mat-select` sourced from `GET /curricula`
     (the signed-in user's own Curricula, same "my Curricula" scope as §10.1's
     list — a Member can only practice against Curricula they own, no
     tenant-wide picker here). If the user owns zero Curricula, replace the
     entire form with an onboarding-style redirect prompt rather than showing a
     picker with nothing in it: "You don't have any Curricula yet. Create one to
     start generating practice questions from your own material." + a "Create
     Curriculum" CTA → `/curricula/new` (§10.2) — same first-run framing
     principle as §10.1's empty state, applied here since this screen is equally
     plausibly a new user's first encounter with the feature.
   - **Prompt** (required, multi-line textarea, generous height — a free-text
     prompt is likely a full sentence or more, not a short single-line input) —
     labelled "What would you like to practice?" with helper text: "Describe a
     topic or skill from your Curriculum's material — the more specific, the
     better the questions." (proactively hints at the zero-usable-questions
     failure mode below, per error prevention).
   - **Question count** (required, numeric stepper/input, 1–30) — labelled
     "Number of questions", with a visible "(1–30)" range hint beside the label
     (recognition over recall — the bound is stated up front, not just
     discovered via a rejected submission).
3. **Client-side pre-checks before submit** (error prevention, mirroring
   §6.2/§9.3/§10.2's standing "don't call the network for input we can already
   reject" convention, and explicitly the convention §10.3c's empty-query
   restraint also embodies): Curriculum selected; prompt non-empty after
   trimming whitespace (`EMPTY_PROMPT` — a whitespace-only prompt must be
   rejected identically to a truly empty one, per the spec's own "empty/
   whitespace-only" framing); question count is an integer within 1–30
   (`INVALID_QUESTION_COUNT`, enforced via `min=1 max=30` on the stepper plus a
   pre-submit check, same "client bound mirrors a real server-side bound"
   pattern as §11.4's context-weight field). **None of these three conditions
   should ever reach the network** — this mirrors this document's established
   restraint (§10.3c) that a rejection you can already compute locally doesn't
   need a round trip. `CURRICULUM_NOT_FOUND` is the one named error that
   **cannot** be prevented client-side (the picker is populated from the same
   list the server validates against, but the Curriculum could be deleted
   between page load and submit, or accessed via a stale pre-selected
   `curriculumId` query param) — see §13.3 below for its handling.
4. Submit ("Generate Questions" button) → `POST` to the prompt-practice
   endpoint. **This is a live, multi-second LLM generation call**, not a fast
   synchronous create like §10.2/§11.4 — treat it with the same
   "this may take a while" framing §9.3 uses for its atypically long ZIP
   upload, not the plain inline-spinner treatment of a sub-second form submit.
5. On completion: either the **Results** state (§13.2, one or more usable
   questions) or the **Failed session** state (§13.2, zero usable questions) —
   both are `2xx` responses per the spec's own framing that a failed session is
   not an HTTP-level error; render whichever the response actually contains,
   never a generic success toast that ignores which one occurred.
6. Exit: a "New practice request" action (visible in both Results and Failed
   states) resets the form to its idle/entry state (Curriculum and prompt
   cleared, ready for another attempt) without a full page reload; the nav item
   itself is always available for exit-elsewhwere.

### 13.2 States

- **Idle/entry (default)**: form as described above, Curriculum unselected
  (unless deep-linked via `curriculumId`), prompt empty, question count
  defaulted to a reasonable value (**recommend 10** as a sensible default,
  **flagged below, flag 63**, since the spec doesn't name one) rather than
  defaulting to an edge value (1 or 30) that would misrepresent typical use.
  "Generate Questions" is enabled the moment both required fields are validly
  filled (no separate "review before submit" step — this is a low-stakes,
  cheaply-repeatable request, same "flexibility & efficiency of use"
  reasoning §10.3c gives its own search submit).
- **Generating (loading)**: the form's fields (Curriculum select, prompt
  textarea, count stepper) become read-only/disabled, and the submit button
  becomes a disabled state showing an inline spinner + "Generating…" label,
  **plus a supporting line beneath the button**: "This can take up to a
  minute — grounding your questions against '{Curriculum name}'." (visibility
  of system status — an LLM call is long enough relative to typical web
  interactions that a bare spinner alone risks reading as a hang; naming both
  the expected duration and *what* is happening, per the same reasoning
  §9.3/§11.2 already establish for their own multi-second waits). No
  determinate progress bar (there is no meaningful sub-progress signal for a
  single generation call, same reasoning as §11.4's finalize spinner).
- **Results (one or more usable questions returned)**: a plain, scrollable
  list of the generated questions — each item shows the question text, its
  answer choices (correct answer indicated, since this is a practice tool for
  the Member's own use, not a review/authoring queue — unlike §11.3's
  reviewer-facing table, there's no editing, flagging, or finalizing UI here;
  the Member is looking at questions to practice with directly, not curating
  a bank). Above the list: a summary line, "Generated {n} question(s) from
  '{Curriculum name}'." Below the list: the "New practice request" exit action
  (§13.1 step 6).
  - **Confidence — deliberately not surfaced to the Member.** Per LLD §9.3,
    `calibrateConfidence` produces a 0.50–0.95 score reflecting how much
    relevant grounding context was actually retrieved — this is a
    *reviewer*-facing quality signal in §11.3 (where a human is deciding
    whether to keep, edit, or discard AI output before it becomes a real
    exam), but here the "reviewer" and the "consumer" are the same Member,
    and the questions are used immediately and informally for self-practice,
    never finalized into a shared Exam Type. Surfacing a raw numeric
    confidence score to that Member would invite exactly the kind of
    "recognition over recall" burden §11's badge exists to *relieve* for a
    reviewer, but has no equivalent payoff for a practicing learner — a
    Member has no action to take on a 0.62 vs. a 0.88 (there's no edit/flag/
    discard affordance here), so a bare number would just be unexplained
    noise. **Do not render a confidence badge, percentage, or star-rating
    anywhere on this screen.** If a future phase wants to communicate
    grounding quality to the Member, it should do so qualitatively (e.g. only
    the zero-usable-questions failure state below, which is itself already
    the low-confidence/no-grounding outcome made actionable) rather than by
    exposing the raw calibrated score. **Flagged below (flag 64)** for
    product sign-off, since the spec doesn't explicitly forbid surfacing
    confidence — this document's default is to withhold it, not display it,
    on the reasoning above.
- **Failed session (request succeeded, zero usable questions)** — a
  **distinct, non-error state**, never rendered with the generic error
  block's iconography/tone (§3.1/§9.1's red/warning error treatment is
  reserved for genuine failures below): a centered informational block,
  neutral-to-encouraging tone (not alarming — nothing went *wrong* at the
  system level):
  > "We couldn't generate usable questions from this prompt. Try being more
  > specific about a topic or concept from '{Curriculum name}', or choose a
  > different Curriculum if this one doesn't cover what you're asking about."

  Paired with the same "New practice request" exit action, with focus
  returned to the prompt textarea (not the Curriculum select) so the Member's
  most likely next action — rewording the prompt — is immediately available
  without an extra click (recognition over recall + user control & freedom).
- **Error (network/5xx, or an unhandled non-2xx)**: standard inline error
  block, this document's established generic-failure pattern (§3.1/§9.1's
  wording style): "Something went wrong while generating your practice
  questions. Please try again." with a "Try again" action that resubmits the
  same form values (Curriculum/prompt/count are preserved, not cleared, on a
  genuine error — only the Failed-session and Results states clear the form
  via the explicit "New practice request" action) — losing a Member's typed
  prompt to a transient network blip would be a needless "user control &
  freedom" violation.
- **Validation (client-side, pre-submit)**: per §13.3 below.

### 13.3 Validation UX for the three named errors

Following this document's standing distinction (§2/§6.2/§9.3/§10.2) between
what's prevented locally versus what only the server can determine:

| Error | Prevented client-side? | Placement | Copy |
|---|---|---|---|
| `EMPTY_PROMPT` | **Yes** — submit is disabled while the prompt is empty or whitespace-only; this condition should never reach the network. | Inline `mat-error` beneath the prompt textarea (shown once the field has been touched/blurred, not on first paint of an untouched empty form) | "Enter a prompt describing what you'd like to practice." |
| `INVALID_QUESTION_COUNT` | **Yes** — the stepper is bounded `min=1 max=30`; an out-of-range value (including empty) disables submit before any request fires. | Inline `mat-error` beneath the count field | "Enter a number of questions between 1 and 30." |
| `CURRICULUM_NOT_FOUND` | **No** — the one condition genuinely dependent on server-side state at submit time (deleted-between-load-and-submit, or a stale pre-selected id from a deep link), per §13.1 step 3. | `MatSnackBar` (not inline, since it's not a static field-validity problem the Member caused by typing — it's a stale-state race condition surfaced only at submit) | "This Curriculum is no longer available. Choose another Curriculum and try again." — same non-distinguishing "not found/not owned" treatment as §10.3's Curriculum detail screen (never a different message for "deleted" vs. "never yours" vs. "doesn't exist" — this app's standing convention). |

On `CURRICULUM_NOT_FOUND`, also clear the (now-invalid) Curriculum selection and
re-fetch the picker's option list, so the Member isn't left staring at a
selection that will fail again identically on retry.

### 13.4 Accessibility

Beyond the §1b baseline:
- The Curriculum `mat-select`, prompt textarea, and count field each have a
  real, visible, programmatically associated `<label>` (never placeholder-as-
  label, per §1c's baseline) — "Curriculum", "What would you like to practice?",
  "Number of questions".
- The Generating → Results/Failed-session transition is announced via an
  `aria-live="polite"` region wrapping the results/failure area, mirroring
  §10.3c's search-results and §12.5's toggle-refetch precedent — a
  screen-reader user submitting a multi-second generation request must be told
  when it resolves without needing to re-poll the page for a change.
- On transition into Results, move focus to the results summary heading
  ("Generated {n} question(s)…"); on transition into the Failed-session state,
  move focus to that state's message block — same "don't strand focus after an
  async content swap" principle as §9.3's repeater and §10.3a's file-removal
  rule, applied here to a full-region content replacement.
- The Failed-session state's message is **not** marked `role="alert"` (that
  role is reserved for this document's genuine error states, per §13.2's own
  distinction between "failed session" and "error" — an `alert` role on a
  non-error, encouraging message would misrepresent it to assistive tech as a
  problem needing urgent attention).
- The genuine network/5xx error block **does** use `role="alert"`, consistent
  with every other error block in this document.
- During Generating, the disabled form fields remain in the tab order but are
  correctly announced as disabled (standard Material behavior) rather than
  removed from the DOM — a screen-reader user tabbing through mid-generation
  should hear "disabled," not encounter a confusing empty gap.

### 13.5 Responsive behavior

Single-column form at every breakpoint (Curriculum select, prompt textarea,
count field each full-width, stacked) — there's no multi-column layout
opportunity here the way §10.2's three-level cascade or §11.4's wizard have,
since this form has only three fields and a prompt textarea that benefits from
full width regardless of viewport. The Results list is a single-column stacked
list at every breakpoint too, consistent with §10.3c/§12.5's "prose-length
content wants full width" precedent — no card-grid degradation needed since
there was never a multi-column layout to degrade from.

### 13.6 Copy summary (this feature)

| Condition | Placement | Copy |
|---|---|---|
| Zero Curricula owned | Full-form replacement (onboarding redirect) | "You don't have any Curricula yet. Create one to start generating practice questions from your own material." |
| Generating | Sub-line beneath disabled submit button | "This can take up to a minute — grounding your questions against '{Curriculum name}'." |
| Results summary | Heading above question list | "Generated {n} question(s) from '{Curriculum name}'." |
| `EMPTY_PROMPT` | Inline `mat-error` | "Enter a prompt describing what you'd like to practice." |
| `INVALID_QUESTION_COUNT` | Inline `mat-error` | "Enter a number of questions between 1 and 30." |
| `CURRICULUM_NOT_FOUND` | Snackbar | "This Curriculum is no longer available. Choose another Curriculum and try again." |
| Zero usable questions (failed session) | Centered informational block (not error-styled) | "We couldn't generate usable questions from this prompt. Try being more specific about a topic or concept from '{Curriculum name}', or choose a different Curriculum if this one doesn't cover what you're asking about." |
| Network/5xx | Inline error block, `role="alert"` | "Something went wrong while generating your practice questions. Please try again." |

### 13.7 Flags for `nexus-dev`

62. **Prompt Practice's own gating capability**: this document assumes a
    distinct `curricula.practice`-shaped permission gates the "Prompt
    Practice" nav item, separate from §10's plain "can own a Curriculum"
    check, since this is an LLM-cost-bearing action. Confirm against the real
    RBAC model whether such a capability exists, or whether this should
    instead reuse the same ungated "any curriculum-bearing role" check §10.0
    uses.
63. **Default question count**: this document recommends defaulting the
    count field to 10 (a typical mid-range value) rather than 1 or 30.
    Confirm/tune against real usage expectations before shipping.
64. **Whether to surface confidence to the Member at all**: this document
    defaults to withholding the calibrated confidence score entirely from
    this screen (§13.2's Results state), reasoning that it's a reviewer-only
    signal elsewhere in the app (§11.3) with no equivalent action for a
    Member practicing informally. If product wants some qualitative signal
    (e.g. a subtle "lightly grounded in your Curriculum" note on
    low-confidence questions) surfaced instead of nothing, that's a content
    decision this document defers back to product rather than inventing a
    speculative badge design.

---

## 14. Feature: Inline Image Rendering — PDF Review & Exam Taking (Dev-25b / BL-24, FR-PDF-11, FR-FILE-3)

**Surface**: both host screens are already-classified **tenant application**
surface (§1a) — this feature adds a shared, reusable rendering unit consumed
by two existing screens, not a new screen of its own: the PDF review table's
expanded/collapsed question rows (§11.3, `PdfSessionComponent`, "reviewing"
state) and the exam-taking question body (§12.3, `AttemptTakeComponent`).
Nothing here introduces a new route, nav entry, or IA change.

**Backend contract this phase actually delivers** (Dev-25a, confirmed
QA-green): every image is `position: 'question_text'` only (never `'option'`/
`'explanation'` yet — FR-FILE-3's richer per-position association is a later,
not-yet-built manual/reviewer-edit flow) and every `altText` is currently the
literal placeholder `"Image from page N of the source document."` — see
§14.4 for this document's verdict on that wording. Design below is written to
already accommodate `'option'`/`'explanation'` positions and reviewer-authored
alt text without rework, since FR-FILE-3's full shape is already spec'd even
though this phase only emits one of its three positions.

### 14.0 Shared component: `InlineImageComponent`

Both host screens render every associated image through one new
`shared/ui` component (`apps/web/src/app/shared/ui/inline-image/`,
sibling to `AvatarComponent`), reusing `AvatarComponent`'s established
sign-then-load state machine and `FilesService.sign(storageKey)` call
rather than inventing a second version of it. This is the client-side
continuation of the "no UI code constructs a `/files/d/...` URL directly"
rule §0/`FilesService`'s own doc comment already states — `InlineImageComponent`
and `AvatarComponent` become the only two permitted call sites.

**Inputs**: `storageKey` (required), `altText` (required, non-empty —
rendered as the native `<img alt>`, never omitted or defaulted client-side;
if a future data defect ever delivers an empty string, treat it as an error
state per §14.3, not a silently-empty `alt=""`, since these are meaningful
content images, not decorative ones), `caption` (optional), `width`/`height`
(optional, used as `<img width>`/`<img height>` intrinsic-size hints to
reserve layout space and avoid content-jump as the signed URL resolves —
standard CLS-prevention practice, not new to this project but not previously
needed since `AvatarComponent`'s fixed-size circle never had this problem).

**States** (identical vocabulary to `AvatarComponent`'s `AvatarState`, no new
state names invented):
- **`loading`**: a fixed-aspect-ratio placeholder box (using `width`/`height`
  if provided, else a 16:9-ish default) containing a centered
  `mat-progress-spinner`, sized modestly (not full-bleed) — this is a
  content image inside a denser layout (a table row or a question body), not
  a full-screen load, so treat it like §3.1's row-scoped spinner convention,
  not a page-level skeleton.
- **`loaded`**: the `<img>` itself, per the sizing rules in §14.1/§14.2.
- **`expired`**: identical to `AvatarComponent` — the signed URL's TTL
  elapsed before/while the browser tried to load it (long-open review
  session, long-open exam attempt, or a cached stale URL). Render a
  bordered placeholder box (same footprint as the loaded image would
  occupy, using `width`/`height` if known, to avoid a layout jump when it
  resolves) containing a neutral broken-image icon, the text "This image
  couldn't be loaded.", and a "Reload" text button that re-invokes
  `FilesService.sign(storageKey)` — exactly `AvatarComponent.resolve()`'s
  retry path, reused verbatim in shape.
- **`error`** (the sign request itself fails outright — network/5xx, or a
  since-invalidated storage key rejected server-side): same visual
  treatment and same "Reload" affordance as `expired` — from the reviewer's
  or Member's perspective these are indistinguishable failures needing the
  same recovery action, so this document deliberately collapses them into
  one rendered state (`AvatarComponent`'s own `error` handling already does
  this by folding a sign failure into `expired` — `InlineImageComponent`
  keeps that same collapse rather than adding a fourth visible state that
  wouldn't change what the user does next).
- There is no `empty` state analogous to `AvatarComponent`'s (a question
  either has zero associated images, in which case `InlineImageComponent`
  is never instantiated for it at all, or it has one or more, each of which
  independently goes through `loading`/`loaded`/`expired`/`error` above) —
  don't reuse `AvatarComponent`'s `empty`/initials-placeholder concept here,
  it has no meaning for a content image.

### 14.1 Rendering in the PDF review screen (§11.3)

- **Collapsed row**: beneath the (possibly-truncated) question text in the
  Question-text cell, render each `question_text`-position image (in the
  order the backend already returns them — see §14.3) as a small inline
  thumbnail strip: each thumbnail capped at **120px max-height** (width
  auto, preserving aspect ratio), thumbnails laid out in a horizontal
  `flex-wrap` row with **8px gaps** (§1c's spacing scale) so 2–3 thumbnails
  sit comfortably even in a narrower cell before wrapping to a second line.
  Thumbnails are **not clickable/expandable to full-size** in this phase
  (no lightbox) — this is a reviewer-context preview, not a document
  viewer, and adding a lightbox is a speculative feature this dispatch
  doesn't ask for; flagged below if `nexus-dev`/product wants one later.
- **Expanded inline editor** (§11.3 point 4): the same images render again,
  this time larger — capped at **320px max-height, 100% max-width of the
  editor column** — directly beneath the question-text textarea, in their
  own labeled sub-section ("Images" as a small `mat-subtitle`-weight label
  above the strip) so a reviewer editing the text understands these images
  are read-only context for that edit, not something the edit form lets
  them touch this phase (no add/remove/reposition affordance yet — that's
  the not-yet-built manual-association flow FR-FILE-3 gestures at).
- **Caption**: if `caption` is present and non-empty, render it as a small
  (`mat-caption`-weight, ≤14px per §1c's minimum) line directly beneath the
  image, left-aligned to the image's own width — this is a `<figcaption>`
  inside a `<figure>` wrapping the `<img>`, the correct semantic pairing
  (never a floating unlabeled `<p>` beside the image). If `caption` is
  absent or empty, render no caption line at all (no empty gap, no
  placeholder dash).
- **Mobile card view** (§11.3's <599.98px stacked-card degradation): same
  thumbnail strip, same 120px cap, placed directly beneath the card's
  (truncated) question text, above the confidence/badge metadata line — the
  image is contextual to the question text it's near, so it stays adjacent
  to that text rather than moving to the bottom of the card.

### 14.2 Rendering in the exam-taking screen (§12.3)

- Renders directly beneath the `questionText` `<h2>` heading (§12.3's
  "Question view" section) and **above** the radio-group options — since
  every image delivered this phase is `position: 'question_text'`, it
  belongs visually between the question's own text and the answer choices,
  matching a Member's natural reading order (read the question, see its
  supporting image, then read the options). When `'option'`/
  `'explanation'`-position images ship in a later phase, they render
  adjacent to their own option row / the post-submit explanation
  respectively — not addressed further here since this phase emits neither,
  but flagged so `nexus-dev` doesn't need a fresh UX pass just to wire that
  position switch later.
- **Sizing**: capped at **400px max-height**, full available content width
  (up to the question body's own max-width — this document doesn't specify
  a numeric content max-width for `AttemptTakeComponent` beyond "readable
  measure," consistent with §12.5's prose-width precedent; the image simply
  never exceeds that same column), centered if narrower than the column.
  This is deliberately larger than the review screen's expanded-editor cap
  (320px) since the exam-taking screen is the Member's primary, single-task
  focus on this content — a reviewer skimming many rows benefits from a
  smaller footprint, a Member answering one question benefits from a more
  legible one.
- **Caption**: same `<figure>`/`<figcaption>` treatment as §14.1, rendered
  beneath the image, above the radio group.
- **Multiple images on one question**: stacked vertically (not
  side-by-side) with **16px spacing** between each `<figure>` block, in
  backend-provided order (§14.3) — vertical stacking is the correct choice
  here specifically because horizontal thumbnails (as the review screen
  uses) would compress each image below a comfortably legible size on a
  single-question focus screen; the review screen's row-preview use case
  and the exam-taking screen's read-one-question-carefully use case
  genuinely call for different layouts, this is not an inconsistency to
  reconcile.
- **Question-navigation interaction**: images participate in the exact same
  §12.3 "current question remains visible until the next question's data
  arrives" / "swap in as a unit" rule already specified for question
  text/options — an image is part of that same atomic swap, never
  rendered mid-transition with the previous question's text but the new
  question's image (or vice versa). No separate loading treatment is needed
  for the navigation transition itself; each `InlineImageComponent` instance
  simply mounts fresh (starting in its own `loading` state per §14.0) as
  part of the new question's render, exactly as an `AvatarComponent`
  instance already does when its `pictureKey` input changes.
- **Focus management**: unaffected by §12.3's "focus moves to the new
  question's heading" rule — images are non-interactive content, not focus
  targets, so they simply sit in reading order after the heading; a
  screen-reader user tabbing/reading forward encounters each image's `alt`
  text as part of that same natural flow. The **sole interactive element**
  an image can contain is the `expired`/`error` state's "Reload" button —
  see §14.3 for its accessible name.

### 14.3 Accessibility (beyond §1b baseline)

- **`alt` usage**: every `<img>` uses the native `alt` attribute, sourced
  directly from `altText` — never a `title` attribute, never a visually
  hidden duplicate `<span>` doing the same job, never `alt=""` (these are
  meaningful content images per FR-PDF-11/FR-FILE-3, not decorative). If a
  `caption` is present and happens to be materially different information
  from `altText` (e.g. `altText` describes what's depicted, `caption`
  attributes a source or adds a note), both are shown — the `<figcaption>`
  is additional, not redundant. If a `caption` were ever identical or
  near-identical to the `altText` (not expected from this phase's
  placeholder data, since captions aren't populated by Dev-25a at all —
  flagged below), don't render both, since a screen-reader user would hear
  the same sentence twice in a row (once as the image's accessible name,
  once as the following caption text) — collapse to just the caption in
  that case and let the caption itself serve as the accessible description
  via `aria-describedby`, but this is a defensive rule for a
  not-yet-populated field, not an active concern this phase.
- **Reload button**: labeled with an explicit `aria-label` naming what it
  reloads, not a bare "Reload" with no context when multiple images are on
  screen — e.g. `aria-label="Reload image {n} of {total}"` when more than
  one image is present on the same question/row, or plain "Reload image"
  when there's exactly one; reachable in normal Tab order (it's the only
  interactive part of an otherwise non-interactive image block) and
  activates via native Enter/Space as a real `<button>`.
- **Loading spinner**: not wrapped in its own `aria-live` region — same
  reasoning §11.2/§12.3 already establish for this document's spinners in
  general (a screen-reader user encountering the image in reading order
  will hear "loading" via the spinner's own `aria-label`/visually-hidden
  text once, not a repeated announcement); no live-region escalation is
  warranted for a brief per-image load.
- **Table semantics** (review screen only): the thumbnail strip sits inside
  the existing Question-text `<td>`/cell — it does not require its own
  additional `<th>`/column, since it's supplementary content within the
  question-text cell's existing semantic slot, not a new independently
  sortable/scoped column.

### 14.4 Verdict: is the current placeholder alt text WCAG-adequate?

**Recommendation: acceptable as a temporary, honest stopgap for this phase,
but it should not be treated as the final state — flag it to product as a
known content gap, not a solved one.**

Reasoning:
- WCAG 2.2's actual requirement (SC 1.1.1 Non-text Content) is that a text
  alternative serves the **equivalent purpose** the image serves for a
  sighted user. For content extracted from an arbitrary source PDF at
  automatic-association time, the system genuinely does not know what the
  image depicts (a diagram, a chart, a photo, a stray page-decoration
  graphic) — it only knows where it came from. `"Image from page N of the
  source document."` is truthful and does not fabricate semantic content
  it doesn't have (which would be worse than the current wording: a
  confidently-wrong description like "Diagram of a triangle" when the
  image is actually an unrelated logo is a *harder* failure mode for a
  screen-reader user to detect and recover from than an honest
  provenance note).
- However, it does **not** convey equivalent information — a sighted
  reviewer/Member sees the actual diagram/chart/figure; a screen-reader
  user gets zero information about *what the image shows*, only where it
  came from. For an image that's often load-bearing to actually answering
  a question correctly (e.g. a diagram a question refers to), this is a
  real, not cosmetic, accessibility gap for AA conformance in the fullest
  sense — it satisfies "there is *an* alt attribute with *some* text" but
  not the intent behind 1.1.1 for images that are semantically part of
  the question content itself, particularly on the exam-taking screen
  where the gap could materially disadvantage a screen-reader-using Member
  relative to a sighted one on the same question.
- **Verdict, concretely**: ship the current placeholder as-is for this
  phase (Dev-25a's automatic-association pipeline cannot fabricate a
  real description without an additional AI-vision-captioning step that is
  explicitly not in scope here) — do not block Dev-25b on it, and do not
  have `nexus-dev` invent a more "descriptive-sounding" placeholder that
  implies content it doesn't actually know (worse than the honest
  provenance note). Instead:
  1. Keep the exact wording `"Image from page N of the source document."`
     for this phase — it is accurate and non-misleading, which is the
     right property for a placeholder to have.
  2. Treat "reviewer can author/edit a real `altText` per image" as the
     natural next increment to prioritize once the manual-association/
     reviewer-edit flow (already gestured at by FR-FILE-3's
     `'option'`/`'explanation'` positions) is built — that's the point at
     which a human with eyes on both the image and the question can supply
     a genuinely descriptive alt text, and this document recommends the
     inline-edit form (§11.3 point 4) grow an editable `Alt text` field per
     image at that time, required non-empty, with the current placeholder
     shown as the field's pre-filled starting value the reviewer is
     expected to replace, not append to.
  3. Do not silently accept the placeholder as "done" from an accessibility
     standpoint — flagged formally below (flag 65) as an explicit product
     decision needed: either commission AI-vision alt-text generation as a
     P1 follow-up, or accept indefinitely-generic alt text as an intentional
     scope tradeoff, but this document is not the place to make that
     tradeoff silently.

### 14.5 Responsive behavior

- **Review screen** (§11.3): the 120px/320px thumbnail caps already scale
  naturally with the existing table-to-card breakpoint (§11.3's
  <599.98px degradation) — no separate breakpoint-specific sizing rule is
  needed beyond what §14.1 already states, since percentage/flex-wrap
  layout already adapts.
- **Exam-taking screen** (§12.3): this is the one screen in this document
  where vertical space is already under real pressure — the persistent
  header + timer + progress bar (§12.3) occupies a fixed vertical slice
  before any question content renders, and a large image plus a
  multi-option radio group plus bottom navigation buttons must all still
  fit without the *options* scrolling out of initial view (a Member should
  never have to guess an option exists below the fold on a small viewport).
  Below **599.98px** (this document's standing mobile breakpoint), reduce
  the image cap from 400px to **200px max-height** rather than keeping the
  desktop cap and accepting more scrolling — the image is supporting
  content, the options are the actual task, and on a small viewport the
  options must win the available space. The image remains fully visible
  (never cropped) at the reduced cap, just smaller; a Member can still
  scroll to see it larger if `width`/`height` metadata suggests it's
  worth it, but this document doesn't add a tap-to-zoom affordance this
  phase (flagged below) since it's a speculative addition beyond what was
  asked. Caption text, if present, remains full legibility (no proportional
  shrinking of caption font size below §1c's 14px floor regardless of
  viewport).

### 14.6 Multiple-images-per-position ordering (both screens)

FR-PDF-11/FR-FILE-3 associate zero or more images per question at a given
position; this phase's backend (Dev-25a) already returns them in a stable,
meaningful order (by source page number, ascending, per the extraction
pipeline) — the UI renders them in exactly the order the API returns them,
applying no client-side re-sort, so "first image in the array" reliably
means "first image encountered in the source document" for both the
review-screen thumbnail strip (§14.1, horizontal) and the exam-taking
stacked layout (§14.2, vertical, 16px gaps). If a future position
(`'option'`/`'explanation'`) or a manual-association flow ever allows a
reviewer to reorder images explicitly, that ordering decision belongs to
that later flow, not this one.

### 14.7 Copy summary addendum (this feature)

| Condition | Placement | Copy |
|---|---|---|
| Image loading | Visually-hidden spinner label | "Loading image…" |
| Image expired/load failure | Beneath the broken-image placeholder | "This image couldn't be loaded." |
| Reload affordance (single image) | Button label | "Reload" (accessible name: "Reload image") |
| Reload affordance (multiple images) | Button label | "Reload" (accessible name: "Reload image {n} of {total}") |
| Placeholder alt text (this phase, unchanged) | `<img alt>` | "Image from page {N} of the source document." |

### 14.8 Flags for `nexus-dev`

65. **Placeholder alt-text is a known, not fully AA-satisfying, content
    gap** (§14.4) — ship as specified for this phase, but this document
    recommends product explicitly decide between (a) an AI-vision
    alt-text-captioning follow-up phase, or (b) knowingly accepting
    generic provenance-only alt text as a permanent tradeoff. Don't let
    this decision default silently by omission.
66. **No lightbox/full-size expansion for review-screen thumbnails
    this phase** (§14.1) — flagged in case product wants one; not built
    now since it wasn't asked for and adds meaningful scope (focus
    trapping, Escape-to-close, another dialog pattern) beyond "render
    inline with alt text."
67. **No tap-to-zoom on the exam-taking screen's reduced-size mobile
    image** (§14.5) — same reasoning as flag 66; the 200px mobile cap
    keeps the image fully visible rather than cropped, which this
    document considers sufficient for this phase without an added zoom
    interaction.
68. **Caption field is not populated by Dev-25a at all this phase** — the
    `caption`-vs-`altText` redundancy-collapse rule in §14.3 is written
    defensively for when captions do start being populated (the
    manual-association flow), not because it's an active concern with
    today's placeholder-only data. Confirm this reading of Dev-25a's
    actual output before `nexus-dev` spends effort building that
    collapse logic prematurely.
69. **Exact review-screen thumbnail cap (120px/320px) and exam-taking
    caps (400px/200px) are this document's own reasonable-default
    numbers**, not derived from a Figma mockup (none was supplied for
    this phase per §2's process) — treat as a starting point `nexus-dev`
    can tune once real extracted-image aspect ratios/sizes are visible in
    practice, not as pixel-exact load-bearing values.

---

## 17. Feature: Self-Serve Tenant Plan Upgrades (Dev-37 / BL-36, FR-PKG-6)

**Surface** (§1a): Tenant application — Tenant Admin only. Same `tenant-shell` as
§4/§5, not a new shell. This is the tenant-realm mirror of §7.2's platform Packages
list and §7.4's platform-side reassignment panel, but self-service and Stripe-Checkout-
driven rather than an admin directly setting the tenant's package.

### 17.0 Navigation, route, and RBAC gating

- New route `/settings/billing`, sibling to `/settings/branding` (§5.2) under the same
  "Settings" sidebar section — positioned after "Branding" in nav order (and after
  "Registration" if that has since landed).
- **Nav visibility**: the "Billing" sidebar item under Settings renders only if the
  current user's resolved permissions include `billing.read` — same permission-gated-
  not-role-gated pattern as §4.0/§5.2 ("Members" never see this item at all, since
  Member never holds `billing.read` per the dispatch contract).
- **Route guard**: `permissionGuard('billing.read')` on `/settings/billing` itself —
  defense in depth per §4.0/§5.2's established rule, a hidden nav link is not access
  control.
- **`billing.manage` vs `billing.read`**: `billing.read` gates *seeing* the screen
  (current plan + catalog); `billing.manage` additionally gates the "Upgrade"/"Change
  plan" actions. Per the dispatch, Tenant Admin holds both; if a future role holds
  `billing.read` without `billing.manage` (not stated as existing yet, but the screen
  should handle it defensively since the permission model already separates the two),
  render the screen read-only: catalog cards visible, but each card's action button
  replaced with a disabled state + tooltip/helper text "Only a Tenant Admin can change
  your plan." rather than hiding the whole screen — consistent with "recognition over
  recall" (the user can see what plans exist even if they can't act) and avoiding a
  silent, confusing full-page gate for a distinction the permission model itself
  already draws. Flagged for `nexus-dev` to confirm no such role exists yet this phase;
  if none does, this is forward-defensive, not urgently needed.

### 17.1 Layout

**Current plan panel** (top of the page, above the catalog): a label/value block
matching §5.2/§7.4's `<dl>`-style current-state display —
- Plan name + formatted price (same price-formatting convention as §7.2's Packages
  list — "$29.00" or "$29.00/mo" per whatever billing-period convention `nexus-dev`
  confirmed there; reuse it verbatim, don't invent a second format here).
- Subscription status via the same `StatusBadgeComponent` pattern as §7.4: ACTIVE
  green `check_circle`; **PAST_DUE** the shared `--el-color-warning` amber/neutral-
  warning token (§3.1a/§7.4's precedent) with icon `warning` and text "Past due" —
  this is the state a Tenant Admin most urgently needs to notice, so in addition to
  the badge, render a **persistent inline banner** directly beneath the current-plan
  panel (not just the badge alone): "Your payment is past due. Update your payment
  method or your plan may be downgraded/canceled." (adjust exact consequence wording
  to match the real dunning behavior once confirmed — flagged below) with a link/
  button to the Stripe billing portal if one is available this phase, otherwise plain
  informational text; **CANCELED** uses `--el-color-error`-toned `block`/`cancel`
  icon + text "Canceled", with a similar persistent banner: "Your subscription has
  been canceled. Choose a plan below to resubscribe." — this reframes the catalog
  below from "upgrade" framing to "resubscribe" framing when status is CANCELED,
  since "upgrade" is the wrong verb for a lapsed tenant.

**Catalog** (below the current-plan panel): a **card grid**, one card per active
package (`isActive: true` only — same filtering rule as §7.4's reassignment dropdown;
do not list inactive packages as selectable, and if the tenant's current package has
since been deactivated, still show it correctly in the current-plan panel above, just
don't render a card for it in the grid below, matching §7.4's precedent for the
platform-admin equivalent). Each card:
- Plan name (title), formatted price, and a short feature/limit summary if the
  `GET /tenant/billing/plans` response includes one (a bullet list of the package's
  enabled features — reuse §7.3's feature-name-not-key display convention if this
  data is present; if the endpoint doesn't return feature details this phase, omit
  the summary rather than inventing one — flagged below since it materially affects
  whether the catalog is browsable-with-confidence or just a bare price list).
- Action button: "Upgrade to {name}" (or "Downgrade to {name}" if the target price is
  lower than current, or "Resubscribe" when current status is CANCELED — use whichever
  verb accurately reflects the direction/state rather than a blanket "Select" for
  every card, per "match between system and the real world").
- **Current-plan card**: visually marked as current (a filled/outlined "Current plan"
  chip in the card header, same visual language as an active/selected state elsewhere
  in the product) and its action button is **disabled**, not hidden, with helper text
  "This is your current plan." — showing it disabled (not omitting the card) lets the
  admin see where their plan sits relative to the others in the grid, which matters
  for a pricing/upgrade decision (comparison context), rather than making them
  remember which one they already have.

### 17.2 States

- **Loading (initial fetch of `GET /tenant/billing/plans`)**: skeleton — a skeleton
  block for the current-plan panel + skeleton card grid (matching §7.1/§7.2's
  skeleton-over-spinner convention), not a full-page spinner.
- **Empty (no active packages in the catalog at all)**: this is a rare, arguably
  misconfigured-platform state, not a normal "nothing yet" empty state — render it
  distinctly from the standard empty-state block copy used elsewhere (e.g. §7.2's "No
  packages defined yet. Create the first one to get started." is platform-admin-
  actionable copy that would be actively wrong here, since a Tenant Admin cannot
  create packages): "No plans are currently available. Please contact support." — no
  CTA button, since there is nothing this user can do to fix it themselves.
- **Error (fetch failure)**: inline error block + "Retry" button in place of the
  current-plan panel and catalog, same pattern as every other fetch-failure state in
  this document (§7.5's summary) — not a full-page error, since the tenant-shell nav
  itself should remain usable.
- **Upgrade action in flight**: the clicked card's action button shows an inline
  spinner + disables (§1c's standard in-button-loading pattern); **all other cards'
  action buttons also disable** for the duration (same "serialize mutating actions at
  the UI level" rule as §7.4's reassign-in-flight behavior) — prevents a double-click
  from firing two concurrent checkout-session requests for two different packages.
- **Success (`201`/`200` with `{url}`)**: **immediate full-page redirect**
  (`window.location.href = url`, not a new tab/popup — matches the dispatch's explicit
  "full-page navigation" requirement and the existing platform-admin Stripe flow's own
  convention). No intermediate "Redirecting…" screen is needed beyond the button's own
  spinner state, since the redirect should fire as soon as the URL is returned — but
  do keep the spinner/disabled state visible for the brief window between response and
  navigation firing, so the screen never appears to hang with no feedback.
- **Error — `503 BILLING_NOT_CONFIGURED`**: this is a platform-level misconfiguration,
  not something the Tenant Admin caused or can fix — non-dismissible-until-acknowledged
  inline banner (§7.5's "explain-and-fix 409" banner convention, applied here to a 503
  instead since the semantics — "you can't proceed, and it isn't your fault" — are the
  same shape): "Billing isn't set up for this environment yet. Please contact support
  and try again later." — the clicked button returns to its normal enabled state (the
  action didn't succeed, nothing is left mid-flight).
- **Error — `404`/race, package deactivated or removed between page-load and click**:
  same benign-race pattern as every other 404-race case in this document (§3.4/§4.5/
  §6.3/§7.1/§7.4's precedent): snackbar + re-fetch the catalog — "This plan is no
  longer available. Refreshing options…" — no blocking dialog, the admin simply
  re-picks from the refreshed grid.
- **Error — generic network/5xx on the checkout-session call**: snackbar, "Something
  went wrong starting checkout. Please try again." — button returns to enabled state,
  no re-fetch needed (this isn't a race, just a transient failure).

### 17.3 Confirmation: no confirm dialog before redirecting to Stripe Checkout

Per the dispatch's own framing, this document's confirm-dialog reservation is for
destructive/hard-to-reverse **in-app** actions (§3.4/§4.5/§6.3/§7.4/§9.4/§15.3's
precedent — deactivating a tenant, deleting a user, reassigning a live subscription,
running a real migration). Initiating a Stripe Checkout session is neither destructive
nor hard-to-reverse from the user's perspective: nothing changes about the tenant's
actual subscription until the user completes payment on Stripe's own hosted page, and
the user can abandon/cancel at any point on that page with zero effect — Stripe's
hosted checkout page is itself already the "are you sure" step (it shows the plan,
price, and requires explicit payment confirmation before anything happens). Adding an
in-app confirm dialog on top of that would be pure friction with no error-prevention
benefit (flexibility & efficiency of use), and no existing precedent in this document
treats "navigate to an external, self-confirming flow" as needing its own gate — this
is the first feature to redirect to an external hosted flow, and it establishes the
rule for any future one: **click the card's action button → immediate redirect, no
in-app confirm dialog**, precisely because the destination page already re-confirms.

The one exception already covered above: the disabled current-plan card's button
takes no action at all (it's disabled), so there is no accidental-click risk there
either.

### 17.4 Handling the post-checkout return (`?checkout=success` / `?checkout=cancel`)

Stripe redirects back to `/settings/billing` with a query param after the hosted flow
ends. Since activation is **webhook-driven and asynchronous** (FR-PKG-6), the UI must
never claim the upgrade is already complete just because the browser is back — that
would be a direct, checkable-in-seconds false statement the moment the admin refreshes
and sees the old plan/status still showing.

- **On page load, always re-fetch `GET /tenant/billing/plans`** regardless of which
  query param is present (or absent) — the current-plan panel must reflect real,
  server-confirmed state, never an assumption inferred from the redirect alone.
- **`?checkout=success`**: show a **transient, non-error banner** (not a `MatSnackBar`
  — this needs to persist long enough to be read after a full page navigation, where a
  snackbar's auto-dismiss timing is easy to miss since the user is arriving fresh, not
  mid-interaction) immediately above the current-plan panel: "Checkout complete —
  we're confirming your new plan now. This usually takes a few seconds, and this page
  will update automatically once it's active." If the re-fetched status is already
  ACTIVE on the new package by the time this renders (webhook beat the redirect back,
  plausible for a fast webhook), show a success-toned variant instead: "Your plan has
  been upgraded to {package name}." Either way, this banner is dismissible (an `X`)
  and the URL's `?checkout=success` param is stripped from the address bar after
  handling it (`location.replace`/router navigation without the query param) so a
  page refresh doesn't re-trigger the same banner indefinitely.
  - **Poll briefly for confirmation** rather than leaving the "confirming…" message
    stale indefinitely: re-fetch `GET /tenant/billing/plans` on an interval (e.g. every
    3–5 seconds) for a bounded window (e.g. up to ~30–60 seconds) after landing with
    `?checkout=success`, stopping as soon as the current package matches the one just
    purchased and status is ACTIVE — then swap the banner to the success-toned message
    above. If the window elapses without confirmation, swap to a neutral, non-alarming
    message: "Still confirming your new plan — refresh this page in a moment, or
    contact support if this persists." (not phrased as an error, since nothing has
    necessarily gone wrong; webhook delivery can legitimately take longer under load).
- **`?checkout=cancel`**: a brief, neutral `MatSnackBar` (this one *is* fine as a
  snackbar — it's purely informational, nothing async to keep confirming) on load: "No
  changes were made to your plan." No re-fetch-and-poll needed here beyond the normal
  page-load fetch. Strip the `?checkout=cancel` param the same way, for the same
  reason.
- **Neither param present** (a normal, non-redirect-return visit to the page): no
  banner, just the normal current-plan panel from the standard fetch.

### 17.5 Accessibility (beyond §1b baseline)

- The current-plan status badge follows §3.1a/§7.4's badge rule verbatim — icon +
  color + text, never color alone; PAST_DUE and CANCELED specifically must not rely on
  amber/red alone to convey urgency, given how important it is that a screen-reader or
  color-blind user not miss these two states.
- The persistent PAST_DUE/CANCELED banners (§17.1) and the post-checkout confirmation
  banner (§17.4) render inside an `aria-live="polite"` region so their appearance (and
  the success/still-confirming swap during polling) is announced without requiring the
  user to be visually looking at the page — this is the one screen in the product so
  far with a genuinely async, page-load-triggered status message that changes on its
  own after mount (the polling swap), so it needs `aria-live` more than most of this
  document's static-on-load banners do.
- **Focus management on redirect-away**: since the redirect to Stripe is a full browser
  navigation (not an SPA route change), there is no in-app focus state to preserve —
  nothing further needed here beyond ensuring the button itself was focused/actionable
  via keyboard before the click fired (standard button semantics, no custom widget).
- **Focus management on redirect-back**: on landing at `/settings/billing?checkout=…`,
  move focus to the top-of-page banner (§17.4) if one is rendered (via a
  programmatically-focused, `tabindex="-1"` heading/container on mount), so a
  keyboard/screen-reader user returning from an external site lands directly on the
  most relevant new information rather than at a default, unhelpful focus position
  (browser default is typically document body/top of page, which in this case happens
  to already be roughly right, but the explicit `.focus()` call should not be skipped
  since default behavior isn't guaranteed across browsers after a cross-origin
  redirect-back).
- Catalog cards' action buttons need accessible names that include the plan name
  explicitly ("Upgrade to {name}", not a bare "Upgrade" repeated identically across
  every card — screen-reader users navigating by button list must be able to
  distinguish them without relying on surrounding visual context).

### 17.6 Relevant heuristics

Visibility of system status (in-flight spinner, the post-checkout "confirming…" banner
existing specifically so the async webhook gap is never silently unexplained);
help users recognize/diagnose/recover from errors (`BILLING_NOT_CONFIGURED`'s
you're-not-at-fault framing, the benign-race snackbar for a deactivated-package race);
match between system and the real world (Upgrade/Downgrade/Resubscribe verbs matching
actual direction and state rather than one generic "Select"); user control & freedom
(no forced in-app confirm dialog per §17.3 — Stripe's own hosted page is where the
real "are you sure" moment belongs, not a redundant earlier one).

### 17.7 Responsive behavior

Same `Breakpoints.Handset` (~599.98px) pattern as the rest of this document. The
catalog card grid uses a standard responsive grid (e.g. 3 columns desktop → 2 columns
tablet → 1 column stacked on handset), which is a native fit for `mat-grid-list`/CSS
grid and needs no bespoke stacked-card conversion the way this document's *tables*
require (§3.5/§7.5) — cards are already the mobile-friendly unit here, unlike a data
table. The current-plan panel's `<dl>` follows the same mobile stacking as §3.2/§5.2's
existing `<dl>` behavior.

### 17.8 Copy summary addendum (this feature)

| Condition | Placement | Copy |
|---|---|---|
| Status: PAST_DUE banner | Persistent inline banner below current-plan panel | "Your payment is past due. Update your payment method or your plan may be downgraded/canceled." |
| Status: CANCELED banner | Persistent inline banner below current-plan panel | "Your subscription has been canceled. Choose a plan below to resubscribe." |
| Empty catalog | Panel-replacing message, no CTA | "No plans are currently available. Please contact support." |
| Current-plan card helper text | Below disabled action button | "This is your current plan." |
| Read-only user (has `billing.read`, not `billing.manage`) | Disabled button tooltip/helper text | "Only a Tenant Admin can change your plan." |
| `503 BILLING_NOT_CONFIGURED` | Non-dismissible inline banner | "Billing isn't set up for this environment yet. Please contact support and try again later." |
| `404` package race | Snackbar + re-fetch catalog | "This plan is no longer available. Refreshing options…" |
| Generic network/5xx on checkout-session call | Snackbar | "Something went wrong starting checkout. Please try again." |
| `?checkout=success`, not yet confirmed | Dismissible top-of-page banner, `aria-live` | "Checkout complete — we're confirming your new plan now. This usually takes a few seconds, and this page will update automatically once it's active." |
| `?checkout=success`, confirmed active | Same banner, success-toned | "Your plan has been upgraded to {package name}." |
| `?checkout=success`, still unconfirmed after poll window | Same banner, neutral-toned | "Still confirming your new plan — refresh this page in a moment, or contact support if this persists." |
| `?checkout=cancel` | Snackbar | "No changes were made to your plan." |

### 17.9 Flags for `nexus-dev` to confirm against the real Dev-37 contract

70. **Whether `GET /tenant/billing/plans` includes per-package feature/limit
    summaries** for the catalog cards (§17.1) — if not, the cards render price-only,
    which is a materially thinner browsing experience; confirm whether this data
    should be added to the response (small additive change, same category as flag
    #20's `isReferenced` precedent) or whether feature comparison is explicitly
    out of scope for this phase.
71. **Exact PAST_DUE/CANCELED consequence copy** (§17.1's banner text) is this
    document's reasonable placeholder, not derived from the real dunning/grace-period
    behavior — confirm what actually happens on PAST_DUE (grace period length, auto-
    downgrade vs. auto-cancel) before finalizing the banner's wording, since an
    inaccurate urgency claim here is worse than a generic one.
72. **Whether a Stripe customer billing portal link exists this phase** (§17.1's
    PAST_DUE banner mentions one conditionally) — if `POST
    /tenant/billing/checkout-session` or a sibling endpoint doesn't yet expose a
    portal-session URL, drop that link and keep the banner text-only.
73. **Poll interval/window for the post-checkout-success confirmation state**
    (§17.4) — the 3–5s interval / 30–60s window given here are this document's own
    reasonable defaults (same category as flag #69's thumbnail-cap precedent), not
    derived from real webhook-latency data; tune once observed in practice.
74. **Whether a `billing.read`-without-`billing.manage` role actually exists this
    phase** (§17.0) — if not, the read-only-disabled-button treatment there is
    forward-defensive scaffolding, not an urgent build requirement; confirm before
    spending effort on it.
75. **Soft-delete's "type the tenant name to confirm" pattern (§18.4)** is this
    dispatch's own new judgment call, not derived from any existing legacy screen —
    legacy never built a tenant soft-delete UI at all. Revisit the exact confirmation
    mechanism (a typed name vs. a second "are you sure" step vs. a countdown) if a
    future accessibility or usability pass finds the typed-input pattern adds more
    friction than value for this specific low-frequency operator action.
76. **Row-density/desktop-only assumption for the tenant table (§18.1)** carries
    forward §3.5's own "used by ExamLand's own staff... realistically on
    desktop/laptop" framing unchanged; if the platform console ever gains external
    (non-ExamLand-staff) users, this responsive/density assumption should be
    revisited.

---

## 18. Feature: Platform Console (Next.js/Chakra Rewrite) — Console Shell, Login &
Tenants CRUD UI (migration plan Phase 2, sub-slice "2a")

**Surface**: Platform admin console, rebuilt on the new Next.js + Chakra UI v3 stack
(`docs/plans/nextjs-rewrite-phase2-plan.md`). This section **extends §3** (written for
the legacy Angular/Material implementation of this exact same feature) rather than
replacing it — §3's flows/states/copy/reversibility reasoning all carry forward
unchanged; only the concrete component vocabulary changes (Material → Chakra v3). Where
this section is silent on a state/flow/copy point, §3's guidance applies verbatim. This
section additionally covers the one piece of UI §3 never specified at all: a tenant
soft-delete action (§18.4), which legacy never built.

### 18.0 Component vocabulary mapping (Material → Chakra v3)

Read this table once; every reference below to "the sidebar," "a confirm dialog," "a
toast," etc. means the Chakra-v3 equivalent, not a re-explanation each time:

| §3's Material concept | Chakra v3 equivalent used here |
|---|---|
| `mat-sidenav`/`mat-toolbar`/`mat-nav-list` (persistent sidebar + top bar) | A plain `Flex`-based shell (`components/platform/platform-shell.tsx`): a fixed-width `Box` sidebar (desktop) + a `Drawer.Root` overlay (mobile), a `Flex` top bar with a `Menu.Root` account menu |
| `mat-dialog` (confirm dialog) | `Dialog.Root`/`.Backdrop`/`.Positioner`/`.Content` (`components/platform/confirm-dialog.tsx`) |
| `MatSnackBar` (toast) | Chakra's own documented `createToaster`/`<Toaster />` snippet (`components/ui/toaster.tsx`), mounted once alongside `ChakraProvider` |
| `mat-table`/`mat-paginator` | `Table.Root`/`.Header`/`.Body`/`.Row`/`.ColumnHeader`/`.Cell`, plus a plain Previous/Next pager (no separate pagination component wired this dispatch — see flag) |
| `mat-select`/`mat-button-toggle-group` (status filter) | `NativeSelect.Root`/`.Field` |
| Status badge (§3.1a) | `components/platform/status-badge.tsx` — a Chakra `Badge` (`colorPalette` per status) with a visible text label, not an icon (see §18.1a) |
| `mat-form-field`/`mat-error` | `Field.Root`/`.Label`/`.ErrorText` |
| Angular route guard (`platformAdminGuard`) | A client-side auth-context check in `app/platform/(console)/layout.tsx` (this stack has no server-side session to gate a Server Component on — the platform-admin bearer token lives in `localStorage`; see the migration plan doc for why) |

### 18.1 Tenant list / detail / create — carries §3.1/§3.1a/§3.2/§3.3/§3.4/§3.5 forward
unchanged

Every flow, state, loading/empty/error treatment, status-badge color/label mapping,
confirm-vs-no-confirm decision for suspend/activate/retry, and the create-tenant
synchronous-provisioning loading experience described in §3.1 through §3.5 applies
as-written to this Chakra rewrite — substitute the Chakra component per §18.0's table.
Two implementation notes worth calling out explicitly (neither changes the *behavior*
§3 already specified, only how it's satisfied on this stack):

- **No icon library exists in this app yet** (§3.1a called for a Material Symbols icon
  per status alongside color+text). Rather than adding a new icon-library dependency
  for a single badge component, the status badge's non-color differentiator is the
  **text label itself** ("Active", "Suspended", ...), which already independently
  satisfies "don't convey meaning by color alone" — a screen reader announces the word
  regardless of color, and a colorblind sighted user reads the same word. Revisit if a
  later phase adds an icon library for an unrelated reason (at which point restoring
  per-status icons on this badge is a small, low-risk addition, not a new decision).
- **Create-tenant is a dedicated route (`/platform/tenants/new`), not a modal** — §3.3
  explicitly left both acceptable ("a modal is recommended... but a dedicated route is
  equally valid... apply consistently to any future console create-flows"). A dedicated
  route was chosen here: simpler and more robust focus-management/back-navigation
  behavior on this stack (Next.js App Router's own page-transition model handles focus
  restoration more predictably than manually orchestrating a modal's focus trap around
  a multi-second synchronous submit), and it establishes the precedent every future
  Phase 2 console create-flow (billing/ai-models/packages/features) should also follow
  for consistency, per §3.3's own instruction.

### 18.1a URL routing convention (new decision, not present in §3 — Angular's router
had no equivalent question to answer)

The console lives at a real `/platform/**` URL path segment — `/platform/login`,
`/platform/tenants`, `/platform/tenants/new`, `/platform/tenants/:id` — matching
legacy's own Angular route paths exactly (`platform-shell.component.html`'s
`routerLink="/platform/tenants"` etc.), **not** a bare Next.js route group (which
produces no URL segment at all). This matters structurally on this stack in a way it
never did on Angular's single-origin SPA+API pairing: `middleware.ts`'s tenant-
resolution now excludes `/platform/**` from Host-header tenant lookup by literal path
prefix, the exact same mechanism `/api/platform/**` already used — without a real,
excludable `/platform` URL segment, a browser navigating to the console would
incorrectly attempt tenant resolution against whatever `Host` header served the
request and 404 before ever reaching a page component. See
`docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions made" for the full mechanical
reasoning; this doc records only the resulting user-facing URL shape.

### 18.2 Login (§3.0) — carries forward unchanged

Same flow/copy/enumeration-safety treatment as §3.0. The one Chakra-specific
implementation note: the login form is wrapped in a `Suspense` boundary (a Next.js App
Router requirement for any Client Component reading `useSearchParams()`, used here for
the `returnUrl` redirect target) — purely a framework mechanic, invisible to the admin
and with no effect on the documented flow/states.

### 18.3 Account menu / log-out (§3.1's "standard admin dashboard placement") —
carries forward unchanged

Top-right `Menu.Root` showing the authenticated admin's name; "Log out" clears the
stored token and redirects to `/platform/login`. No new decision here.

### 18.4 Tenant soft-delete (NEW — §3 never specified this; legacy never built it)

`TenantsService.softDelete` (FR-MT-1: "archival retention... rather than immediate
hard delete") has existed in this app's backend since Phase 1, but legacy's own
Angular console never wired any UI to it — `tenant-detail.component.ts` has no delete
action at all. This dispatch is the first UI for this action, so its confirmation
treatment is a fresh judgment call rather than a port of an existing pattern:

**Decision: soft-delete gets a *stronger* confirmation than suspend** — a
type-the-tenant-name-to-confirm input inside the confirm dialog (the confirm button
stays disabled until the typed value matches the tenant's real name exactly), not the
plain Cancel/Confirm dialog §3.4 established for suspend. Reasoning, following this
project's own established "graduate confirmation strength to the action's actual
reversibility" standard (the same reasoning §3.4 itself already applies — suspend gets
a confirm dialog specifically *because* it has a real, if reversible, impact on live
users; activate/retry get none because they have no destructive downside):

- **Suspend** is undone by a single click on "Activate," with no time pressure and no
  data loss — its confirm dialog exists only to stop an accidental click, not because
  the consequence is severe.
- **Soft-delete** blocks *all* access to the tenant immediately and starts an
  irreversible-after-the-retention-window purge countdown (`TENANT_RETENTION_DAYS`,
  currently 30 days per `server/config/env.schema.ts`) — a materially larger blast
  radius and a real, if delayed, point of no return. A plain "are you sure?" dialog is
  proportionate to suspend's stakes but not to delete's; requiring the admin to
  type the exact tenant name is a deliberate extra step that makes an accidental
  click structurally impossible, matching the industry-standard pattern for exactly
  this class of "reversible in principle, but only within a bounded and easy-to-miss
  window" action.

**Flow**: available on the tenant detail screen only (not a list-row quick action —
unlike suspend/activate/retry, this is deliberately *not* offered as a one-click row
action; the extra navigation step to the detail screen is itself a small, intentional
friction point for the console's single most consequential tenant action). Rendered as
a visually distinct destructive-toned button (Chakra's `red` `colorPalette`, `outline`
variant — distinct from suspend's neutral `outline` and activate/retry's `brand`
`colorPalette`), disabled while any other action on the screen is in flight (same
mutual-exclusion rule as every other action button on this screen, §3.2). On success:
a toast ("Tenant deleted.") and the detail screen re-renders showing the
`deletedAt`/`purgeAfterAt` banner (already specified generically by §3.2's "conditionally
— `provisioningError`, `deletedAt`/`purgeAfterAt` if soft-deleted" line — this section
just supplies the concrete trigger and copy). A second delete attempt on an already-
deleted tenant is `404 TENANT_NOT_FOUND` (the service's own idempotency-safety
contract) — surfaced as the ordinary generic-error toast, since this can only happen
via a stale/duplicate request, not a realistic user action from this screen (the
button itself disappears once `deletedAt` is set).

**Accessibility**: the typed-confirmation input has a real, programmatically
associated `<label>` naming exactly what must be typed ("Type '{name}' to confirm");
the confirm button's `disabled` state is a real DOM `disabled` attribute (not merely a
visual dimming), so a screen-reader/keyboard user gets the same "not yet actionable"
signal as a sighted mouse user.

### 18.5 Copy summary addendum (this section)

| Condition | Placement | Copy |
|---|---|---|
| Delete confirm dialog | Modal body | "This tenant will lose all access immediately and will be permanently purged after the retention window. This is far harder to undo than a suspension." |
| Delete confirm — typed-input label | Modal, per-field label | "Type '{tenant name}' to confirm" |
| Delete success | Toast | "Tenant deleted." |
| Delete on an already-deleted tenant (404, stale request) | Toast | "Something went wrong. Please try again." (generic — matches §3.4's existing race-recovery toast copy, since a real user never reaches this from the UI itself) |

### 18.6 Packages/Features CRUD UI + `platform/ai-models` allowlist (migration plan Phase 2,
sub-slice "2b")

**Surface**: the platform console's Packages/Features catalog management (FR-PKG-7) and the AI model
allowlist + per-tenant assignment (FR-AI-2/FR-AI-3). Extends §18 (this stack's own Chakra v3 platform
console) the same way §18 itself extended §3 — every flow/state/copy convention §18 already
established (list/detail/create as a dedicated route not a modal, `StatusBadge`'s text-not-color-only
rule, the generic `ConfirmDialog`, toast-on-mutation) carries forward unchanged; this section covers
only what's genuinely new.

**Nav placement**: three new top-level items in `PlatformShell`'s sidebar — "Packages", "Features",
"AI Models" — inserted after "Tenants" (the migration plan's own Phase 2 item-list order:
"`platform/billing`..., `platform/ai-models`..., packages/features CRUD UI..."; Tenants stays first as
the console's existing landing surface).

**List/create/edit screens (Features, Packages, AI Models)** — all follow §18's established pattern
directly, no new decision needed:
- A `Table.Root` list with loading/empty/error states, a "Create X"/"Approve model" call-to-action,
  and per-row actions gated by server-computed state (`isReferenced` on a feature, `isPlatformDefault`
  on an AI model) — never a client-guessed enable/disable.
- Create is a dedicated route (`/platform/{features,packages,ai-models}/new`), per §18.1's own
  "establishes the precedent every future Phase 2 console create-flow should also follow" instruction.
- Delete (features, AI models) uses the *plain* `ConfirmDialog` (§3.4's baseline, not §18.4's
  typed-confirmation escalation) — deliberately **not** graduated to the stronger tenant-soft-delete
  treatment: both actions are only ever offered once the server has already confirmed zero blast
  radius (`isReferenced: false` on a feature; not the platform default and not currently assigned to
  any tenant on an AI model, enforced server-side by `FEATURE_IN_USE`/`DEFAULT_MODEL_REQUIRED`/
  `MODEL_IN_USE`), so there is no live-user-impact scenario a typed-confirmation step would be
  protecting against — the reversibility-graduated-confirmation standard §18.4 itself established
  says the dialog strength should match the actual blast radius, and a delete that's already
  provably blast-radius-zero doesn't call for the heavier pattern.
- `MODEL_IN_USE`'s toast names the exact affected-tenant count (`details.tenantCount`) rather than a
  generic "in use" message — the spec's own explicit requirement (FR-AI-2), and the one place this
  console surfaces a structured `details` payload in a toast rather than just the envelope's `message`.

**New: the package↔feature association picker** (`app/platform/(console)/packages/[id]/page.tsx`) —
the one genuinely new UI pattern this dispatch introduces, not derivable from an existing §3/§18
surface:
- A checkbox-per-catalog-feature `Table.Root` (not a multi-select or a card grid — a table keeps the
  per-feature optional numeric `limit` input directly adjacent to its own checkbox, which a card grid
  or multi-select control couldn't do without a second, disconnected panel), with an explicit caption
  ("A feature left unchecked is disabled for this package by default") so the default-deny rule
  (FR-PKG-3) is never left implicit.
- Submitted as one atomic `PUT .../features` full-replace action, with its **own, separate Save
  button** from the package's Details form's Save button — a deliberate two-forms-not-one design:
  editing a package's name/price is a materially smaller, lower-blast-radius action than replacing its
  entire feature/limit configuration, and a single combined submit would risk silently resubmitting a
  possibly-stale picker state whenever an admin only meant to fix the price. This is the same
  "graduate the UI surface to the action's actual scope" instinct §18.4 applied to confirmation
  strength, applied here to form boundaries instead.
- No confirm dialog before this save (unlike tenant soft-delete) — the replace is fully, immediately
  reversible by simply re-checking/unchecking and saving again; nothing about it is destructive or
  time-bounded the way a tenant soft-delete's purge countdown is.
- The limit input is disabled (and visually blank, placeholder "Unlimited") whenever its row's
  checkbox is unchecked — prevents an admin from being confused about a limit value that has no effect
  until the feature itself is enabled.

**New: the tenant-detail "AI model" panel** (`app/platform/(console)/tenants/[id]/page.tsx`, additive
to §18's existing tenant detail screen) — surfaces FR-AI-3's per-tenant assignment directly on the
tenant a Platform Admin is already looking at, rather than requiring a trip to a separate screen:
- A single read-only line stating the currently-*effective* model and whether that's because of an
  explicit assignment or the platform default (`"Currently effective: {name} (explicitly assigned /
  platform default)"`) — computed client-side from the already-fetched allowlist plus the tenant's own
  `assignedAiModelId`, not a dedicated GET endpoint, since the tenant summary already carries
  everything needed (no new read route was justified for one derived line).
- A `NativeSelect` offering "Platform default" (the unassign case) plus every currently-*enabled*
  allowlist model (a disabled model is never offered as a new assignment target, matching the
  allowlist screen's own identical rule) with one "Save assignment" button — selecting "Platform
  default" and saving calls the unassign path (`DELETE .../ai-model`), any other selection calls the
  assign path (`PUT .../ai-model`). No confirm dialog: reassigning which model a tenant resolves to is
  fully, instantly reversible (select a different value, save again) and has no destructive/
  time-bounded consequence — the same reasoning that keeps suspend/activate/retry confirm-free-or-not
  proportionate to actual stakes.

**Scope boundary made visible to the admin, not just documented in code**: nothing in this UI ever
implies an actual AI/LLM call happens anywhere in this app yet (Phase 5's job) — the screens describe
the allowlist and assignment purely as configuration data, never phrasing copy like "used for
generating..." that would misstate current capability.

### 18.7 Copy summary addendum (this section)

| Condition | Placement | Copy |
|---|---|---|
| Feature delete confirm | Modal body | "This feature will be permanently removed from the catalog. This can't be undone." |
| Feature delete blocked (409 FEATURE_IN_USE, a stale-request race — the button itself is hidden once `isReferenced`) | Toast | "This feature is used by one or more packages and can't be deleted." |
| Feature key-change blocked (409 FEATURE_KEY_IMMUTABLE) | Inline banner | "This feature's key can't be changed because it's used by one or more packages." |
| AI model remove confirm | Modal body | "This model will no longer be assignable to any tenant. This can't be undone." |
| AI model remove blocked (409 MODEL_IN_USE) | Toast | "This model is still assigned to {tenantCount} tenant(s); reassign them first." |
| AI model disable/remove blocked (409 DEFAULT_MODEL_REQUIRED) | Toast | "Designate a different platform default before disabling/removing this model." |
| Package feature-association picker caption | Inline caption | "A feature left unchecked is disabled for this package by default — there is no separate "disabled" state to set." |
| AI model assignment saved | Toast | "AI model assignment saved." / "Reset to the platform default model." |

### 18.8 Tenant-detail "Billing" panel (migration plan Phase 2, sub-slice "2c" — Stripe integration)

**Surface**: the platform console's per-tenant billing panel (FR-PKG-6/FR-PKG-4) — the direct
(non-Stripe) package-reassignment action and the Platform-Admin-initiated Stripe Checkout Session
creation action. Additive to the existing tenant-detail screen (§3.2/§18.1), placed directly above the
§18.6 "AI model" panel it already sits alongside — both are per-tenant configuration panels on the same
screen, in the migration plan's own Phase 2 item-list order ("`platform/billing`... `platform/ai-models`
...").

**Read-only summary** — a `DataList.Root` (package name, price, `StatusBadge`-equivalent colored status
badge for `ACTIVE`/`PAST_DUE`/`CANCELED`, and whether a Stripe customer has ever been created for this
tenant) — carries forward §18's established read-only-summary-then-actions layout unchanged.

**New: two independent actions sharing one package-selection control, not two separate pickers.** A
single `NativeSelect` (offering only currently-*active* packages — the same "never offer a disabled
option as a new assignment target" rule §18.6's AI-model panel and the package-association picker both
already establish) feeds **two** buttons: "Reassign package" (the direct, non-Stripe path) and "Create
checkout session" (the real Stripe-hosted path). This is a deliberate divergence from the AI-model
panel's single-select-single-button shape — reassignment and checkout are two *materially different*
actions on the *same* target package (one takes effect immediately with no payment step; the other
opens a real payment page and only takes effect once that completes), so collapsing them to one button
would either hide which behavior the admin is about to trigger, or require a second control purely to
pick between them. Two buttons sharing one selection makes the choice already-visible in the UI's own
structure rather than behind a secondary toggle.

**No confirm dialog on "Reassign package"** — reassigning a package is fully, immediately reversible
(pick a different package, save again) and has no destructive/time-bounded consequence, the same
reasoning that already keeps the AI-model assignment panel confirm-free (§18.6).

**"Create checkout session" opens a real Stripe-hosted page in a new tab, never embeds payment
UI in this console** — this app's admin console is never itself a payment-collection surface; Stripe's
own hosted Checkout is where card details are actually entered. Creating a session never itself grants
access (FR-PKG-6), so the panel's own state does not update as a result of this action — a Platform
Admin who returns to this page after a completed checkout sees the update via an ordinary reload (the
webhook has already applied it server-side by then), not a client-side optimistic update that could be
wrong.

**`BILLING_NOT_CONFIGURED` (503) surfaces as a plain, non-alarming toast, not an error banner** — "This
deployment has no live Stripe configuration" is an expected, valid deployment shape (see
`env.schema.ts`'s own doc comment), not a bug state; the toast uses the same `type: 'error'` styling as
any other rejected action (consistent, not specially de-emphasized), but its copy is factual rather than
alarmist.

**Copy addendum**:

| Condition | Placement | Copy |
|---|---|---|
| Reassignment saved | Toast | "Subscription reassigned." |
| Reassignment blocked (409 PACKAGE_INACTIVE) | Toast | "That package is inactive and can no longer be assigned to a tenant." |
| Checkout session created | Toast (info, not success — the action isn't yet complete) | "Stripe Checkout opened in a new tab." |
| Checkout blocked (503 BILLING_NOT_CONFIGURED) | Toast | "Billing is not configured for this deployment." |
| Checkout blocked (409 PACKAGE_INACTIVE) | Toast | "That package is inactive and can no longer be assigned to a tenant." |

### 18.9 Reliability dashboard (migration plan Phase 2, sub-slice "2d")

**Surface**: a new top-level "Reliability" nav item (`/platform/reliability`), the last-but-one nav
entry (§18.1a's own established ordering convention: operational/read-mostly surfaces go at the end of
the nav, mirroring where legacy's own Angular console placed its equivalent ops tooling, §15). A
**dashboard, not an editor** — per the migration plan's own "platform/reliability dashboards" framing —
so this screen has zero mutating actions anywhere on it, a genuine departure from every other §18
screen, which all pair a read view with at least one action.

**Three stacked panels, not tabs or a single combined table**: Outbox health (pending/delivered/
dead-letter counts, aggregated across every `Active` tenant's own schema), File cleanup queue health
(count awaiting deletion), and Work hints (a small table, one row per hint kind). Three genuinely
distinct health signals with different natural shapes (three numbers; one number; a short table) —
forcing them into one combined view would either flatten the table into three more numbers (losing the
per-kind breakdown) or awkwardly nest a table inside a `DataList`. Stacked panels (this app's own
established "one bordered `Box` per logical grouping" convention, already used by the tenant-detail
Billing/AI-model panels, §18.6/§18.8) keep each signal's own natural shape.

**Dead-letter count gets a color-differentiated badge (red if `>0`, gray if `0`), every other count is
plain text** — a dead-letter row (an outbox message that has exhausted its retry budget and is now
stuck) is the one number on this page that represents a genuine, actionable problem; the others
(pending, delivered, file-cleanup-due) are normal, expected operational counts that fluctuate constantly
and would be needlessly alarming if visually flagged. The badge's own text label ("0"/a real count) is
never color-only — matches WCAG 2.2 AA's "don't convey meaning by color alone," identical to §18.1's
`StatusBadge` reasoning applied here to a single derived flag rather than a full status enum.

**The work-hints table's honest empty state (`0` for every kind) is presented as a caption, not treated
as an error or a "coming soon" placeholder** — no producer writes any hint yet (no `pdf-processing`/
`attempts` module has shipped), so a genuinely-populated table is the wrong-looking state right now, not
this one. The caption ("No pending hints is expected today...") tells the admin *why* it's honestly
empty rather than leaving them to wonder if the feature is broken — this project's own established
"distinguish an honest empty state from a broken one with explanatory copy" standard (see §16's
all-time-empty vs. no-activity-yet split for the identical instinct applied to a different feature).

**No pagination/filtering on this page** — every number here is a small, bounded aggregate (a handful of
demo/test tenants at this migration's current scale), not a row-per-item list; a future phase adding a
per-tenant drill-down (rather than only cross-tenant totals) would be the point to reconsider this, not
before.

### 18.10 Audit Log console page (migration plan Phase 2, sub-slice "2d")

**Surface**: a new top-level "Audit Log" nav item (`/platform/audit-log`), the very last nav entry
(after Reliability, per §18.9's own ordering rationale). Read-only, paginated, filterable by
actor/action/target (every filter combined with AND) — the console's viewer over every
`platform.audit_log` row this dispatch's own retrofit now writes for sub-slices 2a/2b/2c/2d's mutating
routes (§18.1's tenant actions, §18.6's catalog/AI-model actions, §18.8's billing actions).

**Free-text filter inputs, not dropdowns** — unlike tenant `status` (§18.1, a small fixed enum), an
audit `action` name (`tenant.suspend`, `aiModel.approved`, ...) is an open, ever-growing vocabulary that
will keep gaining new values as this migration adds more mutating surfaces in later phases; a dropdown
would need to be regenerated/kept in sync with every new action name added anywhere in the app, which a
free-text filter never needs. `targetType`/`targetId`/`actorId` are the same shape of open vocabulary.
Filters apply on an explicit "Apply filters" action (Enter key or button), not live-as-you-type — this
table has no natural upper bound on its own size over the product's life, so a live-filter re-fetch on
every keystroke would be a needless request storm against a table this app has no reason to assume
stays small.

**Table columns**: When (localized timestamp, full ISO in the `title` attribute — matching every other
timestamp display convention already established, e.g. §18.1's tenant `createdAt`), Actor (a small
color-differentiated badge for the three `actorType` values — `PlatformAdmin`/`TenantUser`/`System` —
plus the raw `actorId` in monospace when present; `System` rows, e.g. a Stripe-webhook-driven
subscription update, correctly show no human actor id at all), Action (monospace, the literal action
string — deliberately not humanized/prettified, since this is an audit trail an operator may need to
correlate against server logs or a future export, where the literal string is the more useful form),
Target (`type (id)` or an em-dash for actions with no single target), and Summary (the raw JSON
before/after summary, truncated visually via `maxW`+`whiteSpace: pre-wrap` rather than parsed into a
per-action-type custom renderer — this dispatch's own summary shapes already vary meaningfully
per-action, e.g. `{statusAfter}` vs. `{key, name}` vs. `{}`, and a raw-JSON display is the only rendering
that stays correct for every one of them without a dedicated per-action-type formatter, which is
disproportionate scope for this dispatch's own read-only viewer).

**No confirm dialog anywhere on this page** — it has no mutating action at all (read-only by design,
matching §18.9's identical "dashboard, not editor" framing), so §3.4's confirmation-strength guidance
doesn't apply here at all.

**Pagination follows the exact Tenant-list convention** (§18.1: Previous/Next + "Page X of Y (Z total)"
caption) rather than inventing a second pagination pattern for this one screen.

## 19. Feature: Tenant-Realm Shell + Taxonomy & Curricula (Next.js/Chakra Rewrite, migration plan
Phase 3, FR-TAX-1..4/FR-CUR-1/FR-CUR-1a)

**Surface**: the tenant application (§1a), rebuilt on the new Next.js + Chakra UI v3 stack. This is the
**first tenant-realm UI in the entire migration** — Phases 0-2 built only backend and the
Platform-Admin-only console; no `tenant-shell`, login screen, or any tenant-facing page existed in
`apps/next` before this dispatch. This section therefore does two things at once: (a) extends §4.0 (the
tenant-shell baseline, written for the legacy Angular build) and §6/§10 (taxonomy and curricula,
likewise legacy-Angular) the same way §18 extended §3 for the platform console's own rewrite; (b)
establishes the Chakra-v3 tenant-shell itself, since nothing yet plays the role `platform-shell.tsx`
played for §18.

### 19.0 Component vocabulary mapping (Material → Chakra v3) — identical to §18.0, not restated

Every reference below to "the sidebar," "a confirm dialog," "a toast," "a native select," etc. means the
same Chakra v3 primitive §18.0's table already names (`Flex`-based shell + `Drawer.Root`, `Dialog.Root`-
based `ConfirmDialog`, the shared `Toaster`, `Table.Root`, `NativeSelect.Root`/`.Field`, `Field.Root`/
`.Label`). `ConfirmDialog` and a `StatusBadge`-shaped component are **reused directly from
`components/platform/**`** rather than duplicated under a new `components/tenant/` copy — both are
already fully generic (no platform-specific business logic), and this stack's ESLint module-boundary
rule only protects `src/server/**`, never `src/components/**`, so this is not a boundary violation, only
a naming-location one. A future phase may relocate them to a shared `components/ui/**` home if a third
realm ever needs them; not warranted by this dispatch alone.

### 19.1 Tenant-realm shell (extends §4.0's baseline, established now in Chakra v3)

§4.0 already specified the shell's shape for the legacy build (persistent sidebar, permission-gated nav,
top bar with account menu, route guard on the underlying pages, not just a hidden nav link) — this
section supplies only the Chakra-v3 realization and this phase's own, deliberately minimal nav content:

- **Layout**: `app/(tenant)/layout.tsx` mounts a `TenantAuthProvider` (client-side, `localStorage`-token
  session state — this stack has no server-side session to check in a Server Component, mirroring
  `PlatformAuthProvider`'s identical pattern) for the whole tenant realm, login screen included. A
  nested `app/(tenant)/(shell)/layout.tsx` route group is the authenticated half — client-side auth
  guard (redirect to `/login?returnUrl=...` once `status` resolves `'unauthenticated'`, full-page
  spinner while `'checking'`) + the `TenantShell` sidebar/top-bar wrapper — mirroring
  `app/platform/(console)/layout.tsx`'s exact pattern. `/login` itself sits outside `(shell)`, rendering
  as a bare centered card (§2's `auth-shell` pattern, reused here rather than re-derived) with no
  sidebar chrome.
- **URL shape**: unlike `/platform/**`'s real path segment (§18.1a — required specifically so
  `middleware.ts` could exclude it from tenant resolution), tenant pages need **no** matcher exclusion
  at all — every tenant page *should* go through `resolveTenantForRequest()`, that being the entire
  point of the tenant realm. `(tenant)`/`(shell)` are therefore both bare route groups (no URL segment):
  pages live at plain top-level paths (`/login`, `/curricula`, `/settings/taxonomy`), matching legacy
  Angular's own tenant-realm URL shape and the migration plan's own "New app structure" listing.
- **Nav content, this phase**: exactly two items — "Curriculum" (top-level, gated by
  `curricula.manage_own`) and "Taxonomy" (grouped under a "Settings" heading, gated by
  `taxonomy.read`) — the only two this dispatch's own scope needs. §4.0's own "honest reflection of
  current scope" principle (echoed at §18.1's "don't pad it with placeholder nav items for sections
  that don't exist yet") applies identically here: no `Users`/`Profile`/`Dashboard` nav items exist yet,
  even though their *backends* have existed since Phase 1c — their Chakra UI hasn't been built, so they
  have no route to link to. Every later tenant-realm phase (4, 6, 7, 8, 9) extends this same shell
  exactly as §18's platform-shell grew across Phase 2's own sub-slices.
- **Account menu**: top-right menu showing the signed-in user's first+last name; "Log out" clears the
  stored token and redirects to `/login` — §4.0's own "standard admin dashboard placement," identical to
  §18.3's platform-console equivalent.
- **Post-login landing**: `/curricula`, not a dashboard. Phase 9 owns the real tenant dashboard
  ("aggregates across 3-8, deliberately last" per the migration plan's own phase sequence) — building a
  placeholder dashboard now would be dead UI with no real content to aggregate yet; `/curricula` is
  simply the first genuinely useful screen this phase's own scope makes reachable.
- **Route guard, not just a hidden nav link**: both `/curricula` and `/settings/taxonomy` (and their
  sub-routes) independently re-check the relevant permission client-side (rendering a plain "You do not
  have permission to view this page." message if absent) *and* every underlying Route Handler
  re-enforces the same permission server-side via `requirePermission` — §4.0's own defense-in-depth
  principle, reused verbatim rather than re-derived.

### 19.2 Login (extends §2's `auth-shell` pattern) — carries forward with one addition

Same centered-card layout, enumeration-safety framing (any credential rejection renders one generic
banner, never a per-field or code-specific message), and loading/error states §2.1 already established
for this exact screen shape. One Chakra-specific note, mirroring §18.2's identical platform-login
observation: the form is wrapped in a `Suspense` boundary (a Next.js App Router requirement for a Client
Component reading `useSearchParams()`, used here for the `returnUrl` redirect target) — a framework
mechanic only, invisible to the user.

### 19.3 Taxonomy browse/create/delete (extends §6 — Chakra v3 realization, ownership-model unchanged)

Every flow/state/copy decision §6 already made — the single-panel breadcrumb drill-down layout (over a
three-panel side-by-side layout), the always-visible inline create row, the omit-not-disable rule for
`taxonomy.create`/`taxonomy.delete` gating, the `TAXONOMY_ENTRY_NOT_FOUND`-on-drilled-into-a-deleted-
parent treatment, the `TAXONOMY_ENTRY_IN_USE` explain-and-suggest-fix delete-rejection copy — carries
forward to this Chakra rewrite unchanged; substitute Chakra primitives per §19.0's table. Two
implementation notes specific to this stack:

- **Drill-down state lives in the URL query string** (`?levelId=&stageId=`) exactly as §6 specified,
  read via `useSearchParams()`/written via `router.push()` — giving back-button/reload/deep-link support
  for free, including the "drilled into a deleted parent" 404 case (a stale bookmarked URL with a
  `levelId` that no longer exists correctly renders §6.1's "no longer exists" message on load, not a
  blank/broken panel).
- **Route placement**: `/settings/taxonomy` (not nested under `/platform/**`) — matches §6's own
  "Settings" information-architecture placement (tenant-configuration data, the same category as
  branding/registration settings once those land in a later phase), now realized as this app's actual
  route path rather than an Angular route.

### 19.4 Curriculum ownership/metadata list/create/detail (extends §10 — **scope-narrowed to this
phase's ownership/metadata-only backend**, not the full document-ingestion/search feature §10
describes)

**This is the one place this section deliberately diverges from §10's own scope, not just its component
vocabulary** — read this subsection's opening carefully before assuming §10 applies in full. §10 was
written for legacy's `CurriculaService`, which bundles Curriculum ownership *and* a full PDF-ingestion/
embedding/semantic-search pipeline into one feature. This migration's own Phase 3 (`docs/plans/
nextjs-rewrite-phase3-plan.md`) deliberately ships **only** the ownership/metadata half this dispatch —
no `VectorStorePort`/`EmbeddingsPort`/Qdrant infrastructure exists in `apps/next` yet (that's Phase 5's
job), and a document that could be uploaded but never searched or processed would be a confusing
dead end, not a coherent partial feature. Concretely, out of §10's full scope, this dispatch builds:

- §10 (surface/IA), §10.1 (list — carries forward as written: "my curricula" scope, the onboarding-style
  first-run empty state explaining what a Curriculum is for, Name/Subject/Description columns), §10.2
  (create screen — carries forward as written: the three-level cascading Education Level → Stage →
  Subject `NativeSelect` trio, sequential disable-until-parent-chosen, the fast synchronous-create
  loading treatment), and the **ownership/metadata half** of §10.3 (detail screen: metadata header,
  inline Name/Description edit, the Delete Curriculum action, the identical-treatment-for-403-or-404
  `NOT_CURRICULUM_OWNER`/`CURRICULUM_NOT_FOUND` handling per FR-CUR-1a).
- **Explicitly not built this phase** (deferred to whichever Phase 5/6 dispatch adds document
  management, per the plan doc's own scope-split write-up): §10.3a (document upload zone), §10.3b
  (document list), §10.3c (semantic search) — none of that UI exists yet. The detail screen instead
  shows a single, honest caption explaining the gap: *"Document upload and semantic search for this
  Curriculum are not available yet — they land in a later phase of this migration, once the underlying
  AI/vector infrastructure exists."* This is this project's own established "distinguish an honest gap
  from a broken feature with explanatory copy" standard (§16/§18.9's identical instinct), applied here
  to a deliberately-deferred feature slice rather than an empty-data state.
- **No document-count column** on the list screen (§10.1 specified one) — there are no documents to
  count yet; adding a column that always reads "0 documents" would misleadingly imply the capability
  exists. Re-add once Phase 5/6 lands.
- **Flag 37/38's oversight-scope questions** (§10's own flags: does a pure "Learner" role see the
  Curriculum nav item at all; does an admin oversight view need a separate all-curricula browse screen)
  are resolved for this phase exactly as §10 itself already specifies as its "narrower interpretation":
  the nav item gates on `curricula.manage_own` presence (not a role-name check), and oversight access
  is URL-only (a Tenant Admin who navigates directly to another user's Curriculum detail link can view/
  edit it via `curricula.read_all`; no separate "all curricula" admin browse screen exists this phase).

### 19.5 Copy summary addendum (this section, ownership/metadata scope only)

| Condition | Placement | Copy |
|---|---|---|
| Taxonomy/curricula not-yet-permitted route (direct URL, no nav access) | Full-page message | "You do not have permission to view this page." |
| Curriculum list, first-run empty | Onboarding empty-state block | "Curricula are where you organize your own material by Subject, so it can later ground ExamLand's AI features. Create your first Curriculum to get started." |
| Curriculum detail, not-found-or-not-owned (FR-CUR-1a, identical treatment) | Full-screen message | "This Curriculum doesn't exist or you don't have access to it." |
| Curriculum detail, document features not yet available | Persistent caption | "Document upload and semantic search for this Curriculum are not available yet — they land in a later phase of this migration, once the underlying AI/vector infrastructure exists." |
| Taxonomy/Curriculum create/delete/error copy | — | Identical to §6.6's/§10's own copy tables — not restated here. |

### 19.6 Flags for `nexus-dev`

39. **`/settings/taxonomy`'s exact URL path assumes no other "Settings" screen exists yet to establish a
    shared `/settings/**` layout/nav-grouping convention** (branding/registration settings land in a
    later phase per the migration plan). If a later phase's own settings screen introduces a shared
    `/settings` sub-layout, revisit whether `/settings/taxonomy` should move under it structurally
    (URL-compatible either way — this is a routing-organization question, not a breaking change).
40. **The Curriculum list/detail screens' "my curricula vs. oversight" scoping is entirely
    server-decided** (`GET /api/curricula` returns the right set already) — if a future phase adds an
    explicit tenant-wide admin toggle/filter (§10's own flag 38, still open), this section's list screen
    would need a new gated UI affordance for it; not built speculatively now.

## 20. Feature: Exam Authoring (Next.js/Chakra Rewrite, migration plan Phase 4, FR-AUTH-1/FR-AUTH-3/
FR-AUTH-5)

**Surface**: the tenant application, extending §19's tenant-shell (nav, identity, permission-gating
conventions) with a third top-level section, "Exam Types". This extends §9 (legacy Angular's manual
exam-authoring UI) the same way §19 extended §4.0/§6/§10 for the Chakra rewrite — every flow/state/copy
decision §9 already made carries forward unchanged; this section supplies only the Chakra v3
realization plus this stack's own implementation notes (Fetch `FormData` in place of Angular's
`HttpClient`, no server-side edit endpoint).

### 20.0 Nav placement

"Exam Types" is added as a third top-level nav item (peer to "Curriculum", not grouped under
"Settings" — core content, matching §19.1's own "Curriculum" placement), gated on `exams.read`. Route
guard, not just a hidden nav link: `/exam-types` and its sub-routes independently re-check
`exams.read` client-side (rendering "You do not have permission to view this page." if absent) and
every underlying Route Handler re-enforces the same permission server-side — §4.0/§19's defense-in-depth
principle, reused verbatim.

### 20.1 Exam Type list (`/exam-types`, extends §9.1)

Carries forward §9.1's shape as written: one unfiltered fetch (the endpoint has no sort/filter/
pagination params), skeleton/error/empty states, a table (Name/Stage/Questions/Duration/actions) with a
mobile card-list degradation. "Create Exam Type" is omitted (not disabled) for a viewer without
`exams.create`; the per-row Delete action is likewise omitted for a viewer without `exams.delete` —
§6's own "omit, don't disable" convention for a capability a user structurally cannot exercise. The
`EXAM_TYPE_HAS_ACTIVE_ATTEMPTS` delete-rejection is a persistent, non-modal banner (not a second dialog)
reading: *"'{name}' can't be deleted right now because it has learners actively taking exams. Try again
once those attempts are finished."* — matching §9.4's identical copy and its "not admin-actionable, no
reassign-style call to action" framing.

### 20.2 Exam Type create (`/exam-types/new`, extends §9.3)

Carries forward §9.3's field set and flow as written: Name/Description, a two-step cascading Education
Level → Stage select (no flat "every stage" endpoint exists — the same judgment call §9.3's own flag 35
already documents, reused verbatim rather than re-derived), a dynamically-growing Module repeater
(name + target question count, minimum one row, focus management on add/remove), a drag-and-drop ZIP
file zone, and per-error-code banner copy identical to §9.3's own table (`EXAM_TYPE_NAME_EXISTS` inline
on the Name field; `FILE_TOO_LARGE`/`INVALID_ZIP_STRUCTURE`/`INVALID_QUESTION_FILE`/`EMPTY_MODULE`/both
`QUESTION_COUNT_MISMATCH` shapes as a page-level banner). The form never clears on error — every
previously-entered value and the selected file remain exactly as they were, matching §9.3's own
"nothing is lost on a rejected submission" rule.

**One implementation-driven deviation from §9.3, documented per this migration's own established
convention (mirrors §18.2/§19.2's identical class of Chakra/Next.js-specific note)**: §9.3 specifies a
real **determinate** upload-progress bar, driven by Angular's `HttpClient` `reportProgress`/
`observe: 'events'` option. The Fetch `FormData` API this app's client uses instead has no equivalent
first-class upload-progress event in this app's supported browser matrix. This screen therefore shows a
single **indeterminate** "Uploading…" state (a loading button + disabled form) for the whole request
duration, rather than a percentage-driven bar — a smaller, still-complete UX than legacy's own (the
upload itself is byte-identical; only the *visibility* of its progress is coarser). Revisit if a future
phase adopts a streaming-upload technique that restores real progress events.

### 20.3 Exam Type detail (`/exam-types/:id`, extends §9.2 — ownership/metadata scope confirmed, no edit
form)

Carries forward §9.2's shape as written: read-only metadata (Description/Stage/Total questions declared/
Total minutes/Created), a Modules table (name + declared question count — the real `GET
/api/exam-types/:id` contract exposes only one count per module, matching §9.2's own documented
deviation from an assumed second "actually stored" field), and a Delete action gated by `exams.delete`.

**No inline-edit affordance exists, matching §9.2's own explicit instruction and this migration's own
"never invent scope" rule**: the real backend contract (ported faithfully from legacy, see
`docs/plans/nextjs-rewrite-phase4-plan.md`'s scope section) exposes only create-via-ZIP and delete — no
`PATCH /exam-types/:id` exists, in either the legacy reference implementation or this rewrite. Building
an edit form the backend cannot service would be inventing a feature never specified by
`docs/PRODUCT_SPECIFICATION.md`'s FR-AUTH entries.

The "Re-map Subjects" action (§9.8, FR-AUTH-6) is **not present on this screen** — deliberately deferred
alongside its backing `fixSubjectMapping` endpoint (real AI-backed, needs `AiServicePort`, which does
not exist until migration plan Phase 5+). Re-add per §9.8's own already-specified copy/state-machine
once Phase 5/6 lands that capability; nothing about §9.8's own writeup needs to change when it does.

### 20.4 Copy summary addendum (this section only)

| Condition | Placement | Copy |
|---|---|---|
| Exam Types not-yet-permitted route (direct URL, no nav access) | Full-page message | "You do not have permission to view this page." |
| Exam Type list, first-run empty (can create) | Empty-state block | "No Exam Types yet. Create one to get started." |
| Exam Type list, first-run empty (cannot create) | Empty-state block | "No Exam Types yet. Ask an exam manager to create one." |
| Exam Type detail, not found | Full-screen message | "This Exam Type no longer exists. It may have been deleted." |
| Every other create/delete/error copy | — | Identical to §9.3's/§9.4's own copy tables — not restated here. |

### 20.5 Flags for `nexus-dev`

41. **`fixSubjectMapping`/"Re-map Subjects" (§9.8) has no UI at all in this rewrite yet** — not hidden,
    not stubbed, simply absent, since its backing endpoint doesn't exist until `AiServicePort` does
    (Phase 5+). Whichever dispatch adds the backend should add this screen fragment in the same pass,
    reusing §9.8's already-specified copy/state-machine verbatim.
42. **Curriculum linking (FR-AUTH-4) has no UI anywhere in this feature** — confirmed (via
    `docs/plans/nextjs-rewrite-phase4-plan.md`'s judgment-call section) to belong to the PDF-processing
    finalize flow (migration plan Phase 6), not manual ZIP authoring's own create form. If a future
    reader expects a Curriculum picker on `/exam-types/new`, that expectation is based on a
    misunderstanding of legacy's own actual wiring — the real finalize-time linking flow needs its own
    UX writeup once Phase 6 builds it, not an extension of this section.

## 21. Feature: Exam Taking & Timeout Sweeper (Next.js/Chakra Rewrite, migration plan Phase 7,
FR-TAKE-1..9)

Reuses §12's own already-specified flows/copy/state-machine (legacy's `attempt-take`/`attempt-review`/
`attempt-result`/`attempt-history`/`exam-instructions`/`resume-attempt-dialog` screens) — this section
records only what's genuinely new to the Chakra v3/Next.js port: the route-naming split and the
server-authoritative-timer/timeout-interstitial implementation detail, not a re-derivation of §12's
already-settled UX judgment calls.

### 21.1 Route naming: `/exams` (discovery) vs. `/exam-types` (authoring/management)

A deliberate, documented split rather than one shared route: `/exam-types` (migration plan Phase 4) is
the Tenant Admin's authoring/management surface (`exams.read`/`exams.create`/`exams.delete`); `/exams`
(this phase) is the learner-facing discovery list (`attempts.take`) a Member browses to find something to
attempt. Both list `exam_type` rows, but the two audiences/actions are structurally different — a single
shared route would either bury the Start-exam affordance inside an admin-shaped table or force admin
actions (Delete) onto a screen a Member can reach. Two distinct top-level nav items ("Exam Types" /
"Exams"), each gated on its own real permission (never a role-name check, per §4.0/§19's own principle),
keep the affordance set on each screen honest about who it's for.

### 21.2 Server-authoritative timer — a display-only client value, never trusted for enforcement

The taking screen (`/attempts/[id]`) shows a live countdown derived once per header refresh from
`deadlineAt - serverNow` (both server-clock values returned by `GET /api/attempts/:id`), advanced locally
only by the client's own elapsed wall-clock time between refreshes, and re-synced on a 15s poll. This
countdown is a **display convenience only** — HLD §10.4's lazy-timeout path is what actually enforces the
deadline, applied server-side before every attempt-scoped read/write; the client never computes "is this
attempt expired" itself and never blocks an action based on its own clock reaching zero. The named "Time's
up" interstitial (§12.3a's own already-specified copy) is triggered exclusively by the server's own
`ATTEMPT_NOT_IN_PROGRESS` response to whatever the learner's next action happens to be (a periodic
header re-fetch, a Next/Previous navigation, an answer submission, or the final Submit) — never by the
client-side countdown reaching `0:00` on its own.

### 21.3 Resume dialog (§12's own specified flow, reused verbatim)

`ATTEMPT_ALREADY_IN_PROGRESS` (carrying `details.attemptId`) on `POST /api/attempts` opens the same
lightweight `ConfirmDialog` pattern §3.4/§20's screens already use, reusing its component directly rather
than a bespoke resume-dialog component — no new dialog shape was needed for this port.

### 21.4 Flags for `nexus-dev`

43. **`AttemptTimeoutSweeper` (FR-TAKE-6's belt-and-braces backstop) has no UI surface at all** — by
    design, matching legacy precedent: it is a background worker tick, never observed directly by any
    screen. Its only externally-visible effect is that an attempt nobody ever reads again eventually
    reaches `TimedOut` in `/attempts` history, exactly as if the lazy path had caught it on a read that
    never actually happened.
44. **No admin-facing `/admin/attempts` (tenant-wide history) screen was built this phase** — the
    backing `GET /api/admin/attempts` route exists and is RBAC-gated (`attempts.read_all`), but no
    Tenant-Admin-facing UI consumes it yet (legacy's own oversight screen was out of this dispatch's
    UI scope, which covered the learner-facing flow only). Building it is a small, additive follow-on
    (a table nearly identical to `/attempts`'s own history table, scoped tenant-wide instead of to the
    caller) for whichever future dispatch needs it — not a gap in the backend contract.

## 22. Feature: Practice — Prompt/Lesson/Full-Bank (Next.js/Chakra Rewrite, migration plan Phase 8,
FR-CUR-5/FR-CUR-6/FR-PDF-13)

### 22.1 Prompt Practice's explicit state machine (`/practice`)

`'form'` (entry: Curriculum picker, free-text prompt, question-count 1-30) → `'generating'` (a genuine
multi-second wait while a live `POST /api/practice/prompt` request is in flight — FR-CUR-5's own
"Generating" state) → exactly one of three terminal states:

- `'completed'` — the real generated questions render (question text, options with the correct one
  marked, explanation). **Confidence is never rendered** — `PromptPracticeService` computes it
  internally (feeding the same unit-tested `calibrateConfidence` scaling behavior every other
  generation path exercises) but never returns it on the wire, matching this app's already-established
  "Confidence — deliberately not surfaced to the Member" convention (§13.2's original Prompt Practice
  framing, carried into this Chakra port unchanged).
- `'failed'` — a normal `200` response body (`{status: 'failed', message}`), rendered as an
  actionable, non-alarming message ("try a more specific prompt or a different Curriculum") with a
  "Try again" affordance back to the form — visually distinct from `'error'` (a muted/warm tone, not
  red) since this is an expected, recoverable outcome, not a failure of the system.
- `'error'` — a genuine network/5xx failure (including the real `503 AI_DISABLED` this environment's
  own `AI_ENABLED=false` configuration produces for every live generation attempt this dispatch's own
  integration test proves), rendered in the app's standard error-state red with a "Try again"
  affordance.

Client-side validation prevents submitting an empty (or whitespace-only) prompt or a count outside
[1,30] before any request is made — `EMPTY_PROMPT`/`INVALID_QUESTION_COUNT` are both client-preventable
per FR-CUR-5's own framing, so a real user is never expected to see either code in practice; a stale
Curriculum selection racing a concurrent delete (`CURRICULUM_NOT_FOUND`) is the one server-side
validation error this form cannot prevent client-side, surfaced via the generic `'error'` state.

### 22.2 Lesson Practice / Full-Bank Assessment ship backend-only this phase — documented scope choice

**Decision**: this dispatch built the full Prompt Practice UI (§22.1) but shipped Lesson Practice
(FR-CUR-6) and Full-Bank Assessment (FR-PDF-13) **backend-only** — real, RBAC-gated Route Handlers and
application services exist and are proven by real-MySQL integration tests, but no Chakra screen consumes
`POST /api/practice/lesson`, `GET/POST /api/practice/sessions/:id(/answer)`, or
`POST/GET /api/practice/full-bank/**` yet.

**Reasoning**: this matches legacy's own precedent exactly — both Lesson Practice (Dev-27/BL-26) and
Full-Bank Assessment (Dev-26/BL-25) shipped backend-only, no UI, in the legacy Angular build (confirmed
by inspecting `legacy/web/src/app/features` — no Lesson Practice or Full-Bank Assessment screen exists
anywhere in the legacy frontend). Building genuinely new UI for two features that never had one in the
reference implementation is real, additive net-new scope beyond "port what exists" — a defensible thing
to do, but not the smallest-reasonable-scope choice for a single dispatch that already needed to build
a real bank-first/diversity-selection service, a full-bank fixed-shape resumable generation pipeline, a
new tenant-schema migration, and Prompt Practice's own complete UI. Matching legacy's own scope gap
(rather than closing it silently or by omission) keeps this dispatch's scope bounded and auditable; a
future dispatch can build either screen as a small, additive follow-on — Lesson Practice's screen would
look like a slightly richer Attempt-taking screen (scope selector, then a question-by-question flow
identical in spirit to §21's Attempt-taking screen but untimed); Full-Bank Assessment's screen would be
a progress/poll screen similar in spirit to `/pdf-processing/[id]`'s own session-status page.

### 22.3 Flags for `nexus-dev`

45. **No Lesson Practice UI** (`/practice/lesson` or equivalent) — backend-only this phase, see §22.2.
46. **No Full-Bank Assessment UI** (`/practice/full-bank` or equivalent) — backend-only this phase, see
    §22.2.
47. **No `StaleSessionRecoveryWorker` dispatch for `full_bank_assessment`-kind sessions** — a stuck
    full-bank session's `resumeProcessing` method exists and is proven by unit tests, but the worker's
    own sweep still only resumes `pdf_processing_session` rows via `PdfProcessingService`'s single,
    direct pipeline (Phase 6's own scope). Wiring a `SessionKindResumer`-style multi-provider dispatch
    (the same abstraction legacy itself introduced for this exact reason) is a small, additive follow-on
    for whichever future dispatch needs automatic crash-recovery for full-bank sessions specifically —
    today, a crashed full-bank session can still be resumed manually by calling
    `FullBankAssessmentService.resumeProcessing` directly (e.g. from a future admin tool), it simply
    isn't picked up automatically by the existing worker tick.

## 23. Feature: Tenant Branding (Next.js/Chakra Rewrite, migration plan Phase 9 sub-slice "9a",
FR-MT-10)

This is a direct Chakra v3 port of §5.2's already-published `/settings/branding` UX rules — nothing
about the underlying flow/validation/error-surfacing rules changed; only the component library did.
Re-stated briefly here (not re-derived) since this is the rewrite's own dedicated screen section:

- **One form, one save action** for both `accentColorOverride`/`logoUrl` together (§5.2's own rule —
  "not... two independent save buttons"). "Reset to default color" remains the one exception: an
  immediate, no-confirmation action, distinct from the form's own "Save changes".
- **Contrast validation is exclusively server-side** (§5.2.1/LLD §9.11) — the hex-input's live swatch
  preview next to the native `<input type="color">` picker is purely cosmetic; the server's own
  `INSUFFICIENT_COLOR_CONTRAST` response is what actually gates the save, and its exact `ratio`/
  `required`/`failingSurface` numbers are surfaced **verbatim** (not paraphrased) — e.g. "This color's
  contrast ratio is 1.16:1 against the light surface; at least 3:1 is required." (real server-computed
  copy, not a hand-authored approximation).
- **Client-side format pre-check only** (a plain `#?[0-9A-Fa-f]{6}` regex before submit) — an obvious
  typo is caught locally to save a round-trip, but the server's own `normalizeHex`/`INVALID_COLOR_FORMAT`
  path is the actual enforcement; the client never claims to have validated contrast.
- **Nav placement**: a new "Branding" item in the tenant shell's existing "Settings" nav grouping
  (alongside "Taxonomy" and "Confidence calibration"), gated on `tenant.settings.manage` — the same
  permission the backing `GET`/`PATCH /api/tenant/branding` routes themselves require, so an
  unauthorized user never sees a nav link to a page they can't use.
- **No FOUC, by construction** — unlike legacy's Angular client (which fetches `TenantConfigStore`
  after first paint, tolerating a brief flash of the platform-default color before the tenant's real
  accent applies), this rewrite's root layout server-renders the resolved `--brand-accent-*` CSS
  custom properties directly onto `<html>` before any HTML reaches the browser — every page (not just
  `/settings/branding` itself) picks up the tenant's live accent color from its very first paint, with
  zero client-side branding fetch anywhere in the app.

## 24. Feature: Tenant Dashboard (Next.js/Chakra Rewrite, migration plan Phase 9 sub-slice "9c",
migration plan's own "aggregates across 3-8" line)

**No legacy screen to port from** — `legacy/web/src/app/features/dashboard/dashboard.component.ts` is a
placeholder from very early in the legacy build; its own doc comment states the real aggregating
dashboard was "out of this phase's scope (later backlog items)" and legacy never built one. Every rule
below is this rewrite's own new design judgment (nexus-dev's own call, applying this document's §1
baseline and existing precedents rather than a fresh nexus-ux dispatch — see "Scope proportionality"
below for why a full nexus-ux consult wasn't warranted for this specific screen).

- **Route**: the tenant shell's own root/index route (`/`), not a separate `/dashboard` path — the first
  screen a Tenant Admin/Member lands on after login (`app/(tenant)/login/page.tsx`'s default post-login
  target, superseding the interim `/curricula` fallback the shell used before this screen existed). A new
  ungrouped "Dashboard" nav item leads back to it from anywhere in the shell.
- **Scope proportionality (the central judgment call)**: four bounded summary sections — Curricula count,
  Exam Types count, a short recent-attempts list (5) plus one "continue where you left off" in-progress
  card, and a short recent-practice-sessions list (3) — each linking out to its own real list screen
  (`/curricula`, `/exam-types`, `/attempts`, `/practice`). Deliberately **not** built as a speculative
  analytics platform (no charts, no time-series, no cross-tenant benchmarking) — the migration plan's own
  wording ("aggregates across 3-8") calls for an index/orientation surface, not a new BI feature; a full
  nexus-ux dispatch was judged disproportionate to a routine "counts + short recent-activity lists"
  summary screen this document's existing `StatTile`/list-row/status-badge patterns (§9, §12, §17) already
  cover without any novel interaction pattern.
- **Every section is optional in the response, gated per-permission, never a 403 for the whole page** —
  `DashboardSummary`'s own shape (`server/dashboard/domain/dashboard.types.ts`) omits a section entirely
  when the acting user lacks the same permission that section's own nav item/route already requires
  (`curricula.manage_own` for Curricula/Practice, `exams.read` for Exam Types, `attempts.read_own` for
  Attempts) — mirroring `tenant-shell.tsx`'s own `NAV_ITEMS.filter((item) => hasPermission(...))` pattern
  applied to page *content* rather than nav visibility. A Member holding only `attempts.take`/
  `attempts.read_own` therefore sees an attempts-only dashboard, never an empty-looking `0` for data that
  was never theirs to know, and never a route-level permission error for the whole page.
- **States**: `loading` (skeleton tiles matching §17's own `Skeleton` convention), `error` (a real retry
  button, matching §17's `state === 'error'` block verbatim), `loaded` with every-section-empty (a single
  neutral "nothing to show yet" message, not four separately-empty sections stacked), and `loaded` with
  a mix of populated/empty individual sections (each section's own empty state is a short, non-alarming
  inline sentence — "No completed attempts yet."/"No practice sessions yet." — never an error tone).
- **"Continue where you left off"**: only ever renders when `attempts.inProgress` is non-`null` — a
  single highlighted card (`blue.subtle`, matching this document's own informational-not-alarming token
  convention) with the Exam Type name and a "Resume" button linking directly to
  `/attempts/{attemptId}` (the existing attempt-take screen, §12) — no separate confirmation step, since
  resuming an already-in-progress attempt is non-destructive.
- **Attempt/practice status badges** reuse `settings/billing/page.tsx`'s own established "never
  color-only, a text label is the true differentiator" badge convention (§17.9) rather than inventing a
  third badge component — `InProgress`/`Submitted`/`TimedOut` and practice's `Completed`/`Failed` each get
  a colored `Badge` **and** a plain-English text label together.
- **No new confirm dialogs, no destructive actions anywhere on this screen** — every interaction is
  either a plain navigation link or the single non-destructive "Resume" action above.
