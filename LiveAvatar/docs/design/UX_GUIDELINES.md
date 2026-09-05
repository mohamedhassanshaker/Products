# Conversational Avatar Platform — UX Guidelines

**Status:** Baseline established; Phase 1 (BL-001–BL-004), Phase 2 (BL-005–BL-009), Phase 3 (BL-011–BL-012, Conversation SPA Screens 9–10), and Phase 7 (final phase — Dashboard, Sessions, GPU health, Alerts, Residency, and the real Screen 11 post-call summary replacing the Phase 3 stand-in) specified  
**Accessibility target:** WCAG 2.2 AA (NFR-4)  
**UI kit:** Angular Material 3 + CDK (LLD §1.2). Do not introduce a second component system.  
**No Figma file** was supplied. Pixel-level layout follows Material 3 defaults plus the tokens and patterns below.

This file is the implementation contract for user-facing UI. `nexus-dev` must not invent alternative copy, error wording, empty-state semantics, or navigation labels. Error sentences are owned by the spec and `packages/contracts` — the UI displays them verbatim.

---

## 1. Design System Baseline

Write-once. Later feature sections reference this section; they do not restate it.

### 1.1 UI surface classification

SaaS multi-tenant. Two Angular SPAs. Classify every new screen into one of these buckets before building it — do not silently default.

| Surface | Who uses it | SPA / origin | Design language | v1 status |
|---|---|---|---|---|
| **Public / marketing site** | Prospects | — | — | **Not in v1.** No marketing site, no self-serve signup, no pricing page. |
| **Platform admin console** | Platform operator staff (`operator` role) | Admin SPA at `/admin` | Admin dashboard template (sidebar + content) | Same SPA as tenant-admin; **not a separate skin**. Role gates actions. |
| **Tenant application (admin users)** | Deployment admins (`admin` role) | Admin SPA at `/admin` | Same admin dashboard template | Same chrome as operators. Features/actions hidden or disabled by role, never a second theme. |
| **Conversation client** | End users (no account) | Conversation SPA at `/c` | Consumer-facing call UI (own surface — not the admin template) | Phase 1: non-functional placeholder (§6, superseded). Phase 3: Screen 9 (§11) and Screen 10 (§12) fully specified. **Phase 7: Screen 11 (§18) is now fully specified and supersedes §12.2's "Ended" placeholder.** |
| **Auth chrome** | Invited admins before session | Admin SPA, unauthenticated routes | Centered Material card on a quiet canvas — **no sidebar** | Phase 1: login + invite-accept. |

**Rule:** If a later feature does not fit the table, add a named row here before implementation. Do not drop a consumer pattern into the admin SPA or an admin table into the conversation SPA.

**Personas (from spec §3) that Phase 1 UI must distinguish:**

| Persona | Role key | What Phase 1 UI assumes |
|---|---|---|
| Platform Operator | `operator` | Sees all tenants. Can create, rename, pause, activate. JWT `tenant_ids[]` is empty = all tenants. |
| Deployment Admin | `admin` | Sees assigned tenants only. Cannot create / pause / activate. Unassigned → empty list, **not** an error. |
| End User | `end_user` | Conversation SPA only. No admin JWT. Out of Phase 1. |

A single human may hold both `operator` and `admin`. Treat `roles` as an array: if `operator` is present, show operator capabilities.

### 1.2 Standards baseline (project-wide)

Apply on every surface. Feature sections only call out **extra** requirements.

**Accessibility — WCAG 2.2 AA (NFR-4):**

- Contrast: body text ≥ 4.5:1 against its background; large text (≥18 pt / 14 pt bold) and meaningful UI components (icons, borders of inputs, focus rings) ≥ 3:1.
- Full keyboard operability. Visible focus indicator on every interactive control (Material `focus-indicator` / `:focus-visible` — do not set `outline: none` without a replacement that meets 3:1).
- Semantic structure: one `h1` per page, landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`), skip link “Skip to main content” as the first focusable control in the admin shell.
- Form fields have a visible `<label>` (Material `mat-label` is sufficient). Errors are linked with `aria-describedby` / `mat-error`. Required fields use `aria-required` and a visible asterisk.
- Custom widgets follow WAI-ARIA APG: dialog, menu, tabs, table, combobox. Prefer Material/CDK implementations over hand-rolled ones.
- Status is never color alone: every chip, health cell, and badge is **icon + text** (LLD shared primitive `status-chip`).
- Hit targets ≥ 24×24 CSS px (NFR-4). Prefer Material’s 40×40 minimum for icon buttons; 48×48 on the conversation SPA later.
- Screen-reader content matches visual content. Do not rely on placeholder-as-label.
- Motion: respect `prefers-reduced-motion` — disable non-essential transitions; keep focus moves instant.

**Interaction heuristics (Nielsen) — apply project-wide; feature sections name only the ones they implicate:**

Visibility of system status · match to the real world · user control & freedom · consistency & standards · error prevention · recognition over recall · flexibility & efficiency · aesthetic & minimalist · error recovery · help & documentation.

**Platform design language:**

- Admin SPA and auth chrome: **Material Design 3** as encoded by Angular Material 20. Spacing, elevation, typography, motion, and density come from the kit. Do not import Tailwind, PrimeNG, Bootstrap, or a custom icon set.
- Conversation SPA (later): still Angular Material for form controls and dialogs, but the live-call layout is a custom surface (video stage + captions + controls) — classify under Conversation client, not the admin template.
- Native iOS/macOS: not in scope.
- Visual design is not a product differentiator (spec §1.2). Prefer Material defaults over custom illustration.

### 1.3 UI kit mapping (reuse, do not reinvent)

LLD already names the shared primitives. Use these and no parallel set:

| Need | Component | Location |
|---|---|---|
| App chrome | `mat-sidenav-container` + `mat-toolbar` | `admin/core` layout shell |
| Page title + primary actions | `page-header` | `projects/shared/ui` |
| Empty / zero-data | `empty-state` | `projects/shared/ui` |
| Confirm destructive / pause | `confirm-dialog` | `projects/shared/ui` |
| Status (`active` / `paused`) | `status-chip` (icon + text) | `projects/shared/ui` |
| Forms | `mat-form-field` (outline appearance) + Reactive Forms | feature pages |
| Tables | `mat-table` + `mat-paginator` + `mat-sort` (sort later if needed) | feature pages |
| Dialogs | `MatDialog` | create tenant, rename, confirm |
| Toasts | `MatSnackBar` (duration 6s, dismiss action “Dismiss”) | success + non-field errors |
| Progress | `mat-progress-bar` (page) / `mat-spinner` diameter 20 (buttons) | loading |
| Menus | `mat-menu` | row actions, user menu |
| Icons | `mat-icon` Material Symbols Outlined | never color-only meaning |

**State-management rule (LLD §9.1):** screens switch on `AppErrorCode`, never on message strings. Display the contract map sentence for that code.

### 1.4 Tokens

Light theme is the v1 default. Do not ship a dark theme in Phase 1 (not specified; adding one is a later classification).

Material 3 theme is generated from a single primary seed. Use these CSS custom properties (map them in the Angular Material theme, do not hard-code hex in feature templates):

| Token | Value | Use |
|---|---|---|
| `--la-primary` | `#1B4B8A` | Primary buttons, links, active nav, focus-adjacent accents |
| `--la-on-primary` | `#FFFFFF` | Text/icons on primary |
| `--la-primary-container` | `#D6E3F8` | Selected nav rail, chips at rest |
| `--la-on-primary-container` | `#0A2A52` | Text on primary container |
| `--la-surface` | `#F7F9FC` | App canvas behind cards / sidenav content |
| `--la-surface-container` | `#FFFFFF` | Cards, table surface, dialogs |
| `--la-on-surface` | `#1C1B1F` | Body text (≥4.5:1 on surface) |
| `--la-on-surface-variant` | `#44474F` | Secondary text, table meta |
| `--la-outline` | `#74777F` | Input borders (≥3:1) |
| `--la-error` | `#B3261E` | Errors, destructive confirm |
| `--la-on-error` | `#FFFFFF` | Text on error buttons |
| `--la-success` | `#1B7F4E` | Active status (with `check_circle` icon) |
| `--la-caution` | `#8B5A00` | Paused status (with `pause_circle` icon) — not yellow-on-white |
| `--la-focus` | `#1B4B8A` 2px solid offset 2px | Focus ring |

**Typography** (Material 3 type scale, Roboto / `theme.typography`):

| Role | Size / weight | Use |
|---|---|---|
| `headline-small` | 24 / 400 | Page `h1` |
| `title-medium` | 16 / 500 | Card titles, dialog titles |
| `body-medium` | 14 / 400 | Body, table cells |
| `body-small` | 12 / 400 | Helper, timestamps, captions |
| `label-large` | 14 / 500 | Buttons, nav items |

Do not introduce a second font family.

**Spacing** (4 px grid): `4, 8, 12, 16, 24, 32, 48`. Page padding: 24 desktop, 16 tablet/phone. Table cell padding: 12–16. Dialog padding: Material default (24).

**Elevation:** cards and dialogs use Material elevation 1 and 3 respectively. The sidenav is flat (outline divider, not drop shadow) to keep the admin template quiet.

**Density:** comfortable on forms; `dense` on `mat-table` so 25 default rows fit a 1080p viewport without a second scroll trap.

**Breakpoints:**

| Name | Width | Admin shell | Tables | Auth card |
|---|---|---|---|---|
| Phone | `< 768` | Temporary drawer (`mode="over"`), hamburger in toolbar | Horizontal scroll on table **or** stacked definition-list cards (pick one per page; Deployments uses stacked cards) | Full-width with 16 px inset |
| Tablet | `768–1279` | Temporary drawer | Table with optional hidden “Last modified” column | Centered, max 400 px |
| Desktop | `≥ 1280` | Persistent sidenav 256 px | Full table | Centered, max 400 px |

This product is used at a desk but is not a fixed-form-factor appliance — the layouts above are required.

### 1.5 Admin sidebar shell pattern

Authenticated admin routes render inside the shell. Auth routes (`login`, `invite`) do **not**.

```
┌─────────────┬──────────────────────────────────────────────┐
│ Brand       │ Toolbar: page title (duplicate of h1 ok)     │
│ Avatar      │              [user email] [role chip] [▾]    │
│ Platform    ├──────────────────────────────────────────────┤
│             │                                              │
│ Dashboard   │  <main id="main">                            │
│ Deployments │    page-header                               │
│ Providers   │    content                                   │
│ Sessions    │                                              │
│ GPU health  │                                              │
│ Alerts      │                                              │
│ Residency   │                                              │
│             │                                              │
│ ─────────   │                                              │
│ (footer)    │                                              │
└─────────────┴──────────────────────────────────────────────┘
```

**Brand:** wordmark “Avatar Platform” (full name “Conversational Avatar Platform” in `title` and `aria-label` on the brand link). No custom logo asset required in Phase 1 — a `mat-icon` `smart_toy` (or `account_circle` is wrong; use `smart_toy`) at 24 px + text is enough.

**Nav items** (recognition of the full IA; do not hide future screens):

| Label | Route (browser) | Screen | Phase 1 state |
|---|---|---|---|
| Dashboard | `/admin/dashboard` | Screen 1 | **Live** — cross-tenant snapshot, §13 |
| Deployments | `/admin/deployments` | Screen 3 | **Live** — `routerLinkActive` + `aria-current="page"` |
| Providers | `/admin/providers` | Screen 4 | **Live** — global catalog (§9). Per-tenant credentials are opened from a Deployments row, not from this nav item (§9.9). |
| Sessions | `/admin/sessions` | Screen 5 | **Live** — session logs/transcripts, §14 |
| GPU health | `/admin/gpu` | Screen 6 | **Live** — read-only node monitor, §15 |
| Alerts | `/admin/alerts` | Screen 7 | **Live** — deployment picker (§16.1); real form is tenant-scoped at `/admin/tenants/:id/alerts`, also reachable from a Deployments row action |
| Residency | `/admin/residency` | Screen 8 | **Live** — deployment picker (§17.1); real form is tenant-scoped at `/admin/tenants/:id/residency`, also reachable from a Deployments row action |

Agent Builder is **not** a top-level nav item. It is tenant-scoped and opened from a Deployments row (`/admin/tenants/:id/builder`, FR-CONFIG-5) — now fully specified, §10.

Per-tenant provider credentials are also **not** a top-level nav item. They are tenant-scoped and opened from a Deployments row action (“Manage provider credentials”, `/admin/tenants/:id/provider-credentials`) and from Agent Builder's own empty/missing-credential states (§9.9, §10).

Disabled items remain visible (recognition over recall) and are not buttons that navigate. Do not remove them from the DOM in a way that changes order later.

**Toolbar user cluster:** email (truncated with `title` for the full value) + `status-chip`-style role chip (“Operator” / “Admin” / “Operator · Admin”) + `mat-menu`:

- Sign out → `POST /api/auth/logout` with the refresh token, clear `AuthStore`, navigate to `/admin/login`.

**Skip link:** visually hidden until focused, first in tab order, target `#main`.

**Session expiry:** HTTP interceptor maps `401 AUTH_UNAUTHORIZED` and `401 AUTH_REFRESH_INVALID` to a redirect to `/admin/login` with a form-level banner using the spec sentence (`"Sign in required."` or `"Session expired. Sign in again."`). Do not invent a third sentence.

### 1.6 Error, toast, and form conventions

**Tone:** short, factual, no blame, no exclamation marks unless the spec sentence has one (none of the Phase 1 sentences do).

**Placement:**

| Kind | Where | Live region |
|---|---|---|
| Field validation (client or `details.fields`) | `mat-error` under that field | Linked via `aria-describedby`; no extra live region |
| Form-level API error (login, invite, dialog) | Banner **above** the submit button, `role="alert"` | Assertive (errors) |
| Page-level load failure (list) | Replaces table body via `empty-state` variant “error” + Retry | `role="alert"` |
| Success / non-blocking notice | `MatSnackBar` | Polite (Material default) |
| Confirm outcome (pause/activate/create) | Snackbar with the spec or the sentences in §4 | Polite |

**Never** invent a different sentence than the spec’s `error.message` for a known code. The interceptor already resolves code → sentence.

**Client-side checks** may use the same sentence the server would return for that field, so the user sees one wording whether or not the request left the browser.

**Passwords:** `autocomplete="current-password"` on login, `autocomplete="new-password"` on invite-accept. Visibility toggle (`mat-icon-button`, `aria-label` “Show password” / “Hide password”). Never echo the password in errors or logs.

**No “Forgot password”.** The spec does not define it. Do not add a link.

**No “Register” / “Sign up” / “Create account”** on any public admin route (FR-AUTH-3). A route-inventory test already forbids `POST /auth/register`.

### 1.7 Admin route map (Phase 1)

Admin SPA is served at `/admin` (LLD). Angular routes below are relative to that base. Browser URLs always include the `/admin` prefix.

| Angular path | Browser URL | Guard | Chrome |
|---|---|---|---|
| `login` | `/admin/login` | guest (redirect if already authed → `/admin/deployments`) | Auth card |
| `invite` | `/admin/invite?token=` | none (works logged-in or out) | Auth card |
| `deployments` | `/admin/deployments` | `AdminJwt` | Shell |
| `tenants/:id/builder` | `/admin/tenants/:id/builder` | `AdminJwt` | Shell — Screen 2, Agent Builder (§10) |
| `providers` | `/admin/providers` | `AdminJwt` | Shell — Screen 4a, global provider catalog (§9.2) |
| `tenants/:id/provider-credentials` | `/admin/tenants/:id/provider-credentials` | `AdminJwt` | Shell — Screen 4b, per-tenant credential list + create/edit (§9.9) |
| `dashboard` | `/admin/dashboard` | `AdminJwt` | Shell — Screen 1, Dashboard (§13) — genuinely cross-tenant |
| `sessions` | `/admin/sessions` | `AdminJwt` | Shell — Screen 5, session log list (§14.2) — genuinely cross-tenant |
| `sessions/:id` | `/admin/sessions/:id` | `AdminJwt` | Shell — Screen 5 detail (§14.2) |
| `gpu` | `/admin/gpu` | `AdminJwt` | Shell — Screen 6, GPU/node health (§15) — genuinely cross-tenant |
| `alerts` | `/admin/alerts` | `AdminJwt` | Shell — Screen 7 **picker/index** (§16.1) — the real form is tenant-scoped, see below |
| `tenants/:id/alerts` | `/admin/tenants/:id/alerts` | `AdminJwt` | Shell — Screen 7, the real fallback/retry config + alerts list (§16) |
| `residency` | `/admin/residency` | `AdminJwt` | Shell — Screen 8 **picker/index** (§17.1) — the real form is tenant-scoped, see below |
| `tenants/:id/residency` | `/admin/tenants/:id/residency` | `AdminJwt` | Shell — Screen 8, the real residency/privacy settings form (§17) |

**Routing conflict flag (Phase 7):** the Phase 1 nav scaffold seeded "Alerts" and "Residency" as flat top-level nav items anticipating flat, cross-tenant screens — but `FR-ALERT-1`/`FR-PRIV-1`'s actual LLD endpoints (`GET/PUT /tenants/{id}/alert-policy`, `GET /tenants/{id}/alerts`, `GET /tenants/{id}/failover-stats`, `GET/PUT /tenants/{id}/residency`) are single-tenant config reads/writes, exactly like Agent Builder and per-tenant provider credentials (which are explicitly **not** top-level nav items, §1.5). This document's resolution (§16.1/§17.1): keep the sidebar entries live (as the nav shell already promised) but make `/admin/alerts` and `/admin/residency` themselves a lightweight **deployment picker**, and move the actual editable screen under the already-established `/admin/tenants/:id/*` convention. Dashboard, Sessions, and GPU health have no such conflict — their endpoints are genuinely cross-tenant lists/aggregates with at most an optional `tenant_id` filter, so those three keep the flat routes with no picker indirection.

Default authenticated landing remains **`/admin/deployments`** (unchanged by this phase — Dashboard is live but Deployments stays the post-login default so existing muscle memory/bookmarks/tests are not disturbed by a phase that only adds screens). Guarded deep links store `returnUrl` and resume after login.

Unknown tenant id on the builder route: navigate to `/admin/deployments` and snackbar `"Tenant not found."` (`TENANT_NOT_FOUND`, FR-CONFIG-5).

---

## 2. Phase 1 — Login (`FR-AUTH-1`, `FR-AUTH-2`)

**Surface:** Auth chrome (not the sidebar shell).

### 2.1 User flow

1. User opens `/admin` or any guarded URL while signed out → redirected to `/admin/login` (optional `returnUrl` query).
2. Page shows a single card: product name, “Sign in”, email, password, primary button “Sign in”. **No** register link, **no** forgot-password link, **no** “create account” helper.
3. User submits. Client trims email (spec: leading/trailing whitespace on email is trimmed; password is not).
4. `POST /api/auth/login` `{ email, password }`.
5. Success → store access + refresh in `AuthStore`, start silent refresh, navigate to `returnUrl` if safe (same-origin admin path) else `/admin/deployments`.
6. User exits later via toolbar “Sign out”, or is returned here on `AUTH_UNAUTHORIZED` / `AUTH_REFRESH_INVALID`.

Already authenticated users hitting `/admin/login` skip the form and go to `/admin/deployments`.

### 2.2 Screen / component states

| State | Behavior |
|---|---|
| **Default** | Email focused on first paint. Submit enabled when both fields are non-empty. |
| **Hover / focus** | Material outline + §1.4 focus ring. Password toggle is a separate tab stop. |
| **Disabled** | Submit disabled while `submitting`. Fields `readonly` (not destroyed) during submit so a screen reader does not lose context. |
| **Loading** | Button label replaced by spinner + visually hidden “Signing in”. `aria-busy="true"` on the form. |
| **Empty** | Not an error. Helper under password is omitted (no hint that invites users to register). |
| **Field error (client)** | Invalid email shape **before** submit, or after blur: `AUTH_EMAIL_INVALID` sentence `"Enter a valid email address."` on the email field. Password empty on submit: Material required error “Enter your password.” (client-only; no spec code). |
| **AUTH_EMAIL_INVALID** (400) | Same sentence on the email field. **Do not** reuse the credentials sentence. |
| **AUTH_INVALID_CREDENTIALS** (401) | Form-level alert: `"Email or password is incorrect."` Same sentence for unknown email **and** wrong password. Do not reveal which. Do not attach it only to the password field (that implies the email was valid). |
| **AUTH_USER_DISABLED** (403) | Form-level alert: `"This account is disabled. Contact an operator."` Submit remains available (user may switch accounts). |
| **AUTH_RATE_LIMITED** (429) | Form-level alert: `"Too many login attempts. Try again in a few minutes."` Submit disabled for 30s **or** until `Retry-After` if the API sends it. Do not invent a countdown that claims a server window you do not have. |
| **Network / 5xx** | Form-level alert: `"Sign in failed. Check your connection and try again."` (no spec code — this is transport, not `AppError`). Retry allowed immediately. |
| **Success** | Navigate away. No success toast on login (status change is the new shell). |
| **Session banner** | If arrived with `AUTH_REFRESH_INVALID` / `AUTH_UNAUTHORIZED`, show that spec sentence above the form, then the form. |

### 2.3 Information architecture

- Lives outside the shell. Browser title: `Sign in · Avatar Platform`.
- Adjacent: invite-accept is a separate URL, not linked from login (the invite email is the entry). After `AUTH_EMAIL_EXISTS` on invite, that page links **to** login — not the reverse.

### 2.4 Accessibility (beyond §1.2)

- Form `autocomplete="on"`; email `autocomplete="username"`; password `autocomplete="current-password"`.
- Form-level alert is `role="alert"` and receives focus **or** is announced without moving focus (prefer announce-in-place so keyboard users are not yanked off the field they are correcting). If credentials error, move focus to the email field after announce.
- Do not use `placeholder` as the only label.
- Caps Lock: optional `aria-live="polite"` “Caps Lock is on” — nice-to-have, not required.

### 2.5 Relevant heuristics

- **Error prevention:** trim email; do not trim password; do not reveal account existence except via the spec’s disabled-account path (that code is explicit).
- **Error recovery:** rate-limit copy tells them to wait; disabled-account tells them who to contact.
- **Consistency:** same card chrome as invite-accept.

### 2.6 Responsive

Phone: card is the page (no decorative split panel). Tablet/desktop: vertically centered card, max-width 400 px, surface container on `--la-surface`.

### 2.7 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `AUTH_EMAIL_INVALID` | 400 | `Enter a valid email address.` | Email `mat-error` |
| `AUTH_INVALID_CREDENTIALS` | 401 | `Email or password is incorrect.` | Form alert |
| `AUTH_USER_DISABLED` | 403 | `This account is disabled. Contact an operator.` | Form alert |
| `AUTH_RATE_LIMITED` | 429 | `Too many login attempts. Try again in a few minutes.` | Form alert |

**Conflict flag:** the Phase 1 brief said `AUTH_EMAIL_INVALID` and `AUTH_INVALID_CREDENTIALS` share a message. The spec does **not**. “Same message either way” applies only inside `AUTH_INVALID_CREDENTIALS` (unknown email vs wrong password). **Follow the spec.**

---

## 3. Phase 1 — Invite accept (`FR-AUTH-3`)

**Surface:** Auth chrome (not the sidebar shell).

### 3.1 User flow

1. User opens `/admin/invite?token={token}` from the invite email (token TTL 72 hours). Token stays in the query string; it is **not** shown in a visible field.
2. There is **no** `GET /auth/invites/by-token` in the LLD. Do **not** invent a preview call. The page cannot show the invitee email. Heading: “Set your password”. Supporting line: “You were invited to administer Avatar Platform. Choose a password to activate your account.”
3. Form: password + confirm password. Rules helper (always visible, not only on error): “At least 8 characters, including a letter and a digit.”
4. Submit → `POST /api/auth/invites/accept` `{ token, password }` (confirm is client-only and is not sent).
5. Success `201` → same session bootstrap as login → `/admin/deployments`.
6. Invalid/expired/already-used token → do not leave a working form. Show the invalid state (§3.2). Exit: “Sign in” text button to `/admin/login` (only useful if they already have an account).

If `token` query is missing or empty: treat as `AUTH_INVITE_INVALID` immediately (no request).

If the user is already signed in: still show the accept form (this creates a **different** admin user). Do not auto-skip.

### 3.2 Screen / component states

| State | Behavior |
|---|---|
| **Default** | Both password fields empty. Submit disabled until both meet the rule and match. |
| **Loading** | Same pattern as login (“Activating account”). |
| **Client password rule** | On blur/submit if `< 8` or missing letter or missing digit: show helper as `mat-error` using the rule sentence above (no spec code). |
| **Mismatch** | Confirm field: “Passwords do not match.” (client-only). |
| **AUTH_INVITE_INVALID** (400 or missing token) | Replace the form with `empty-state`: title “Invite unavailable”, body `"This invite link is invalid or has expired."`, action “Sign in” → `/admin/login`. |
| **AUTH_EMAIL_EXISTS** (409) | Form-level alert: `"An admin with this email already exists."` + text button “Sign in” → `/admin/login`. |
| **Network / 5xx** | `"Could not activate this invite. Check your connection and try again."` + Retry. |
| **Success** | Navigate to deployments. Optional snackbar omitted (same as login). |
| **Disabled** | Submit disabled while submitting or while client rules fail. |

### 3.3 Information architecture

- Browser title: `Accept invite · Avatar Platform`.
- Not in the sidebar. Linked only from email (out of band).
- After existence conflict, login is the recovery path.

### 3.4 Accessibility (beyond §1.2)

- `autocomplete="new-password"` on both fields.
- Password rule helper is `aria-describedby` on the password input **before** it becomes an error, so the requirement is known up front (WCAG 3.3.2).
- Invalid-token empty-state is a heading + body + link; focus the heading on load so the screen reader does not land in a missing form.

### 3.5 Relevant heuristics

- **Error prevention:** confirm password; rule visible before submit.
- **User control:** they can leave to Sign in.
- **Help & documentation:** the rule sentence is the help; do not add a separate FAQ.

### 3.6 Responsive

Same card as login (max 400 px). Stack fields. No split layout.

### 3.7 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `AUTH_INVITE_INVALID` | 400 (or client, missing token) | `This invite link is invalid or has expired.` | Full-page empty-state (not a field error) |
| `AUTH_EMAIL_EXISTS` | 409 | `An admin with this email already exists.` | Form alert + link to login |

**Constraint flag:** invitee email cannot be shown without a new API. Do not add a decode-JWT-in-the-browser hack; tokens may not be JWTs.

---

## 4. Phase 1 — Admin shell (authenticated chrome)

**Surface:** Platform admin console / tenant application (same template).

This is the layout for every authenticated admin page, including Deployments and the Agent Builder placeholder.

### 4.1 User flow

1. After login/invite-accept, shell mounts. `AuthStore` provides email, `roles[]`, `tenant_ids[]`.
2. User moves via sidebar (Deployments live; others disabled).
3. User signs out from the toolbar menu.
4. On phone/tablet, hamburger opens the sidenav overlay; choosing a live item closes it. Escape / backdrop also closes (CDK default — keep it).

### 4.2 Screen / component states

| State | Behavior |
|---|---|
| **Default** | Persistent sidenav on desktop; Deployments highlighted when on that route or on `/admin/tenants/:id/*`. |
| **Loading identity** | If `/auth/me` is in flight on refresh, show a full-shell `mat-progress-bar` under the toolbar; do not flash login. |
| **Coming-soon nav** | Item looks disabled (lower contrast but still ≥ 3:1 against sidenav). Tooltip + `aria-label` “{Label}, coming soon”. |
| **Coming-soon page** | If user hits a reserved URL: `page-header` with that label + `empty-state` “Coming soon” / “This screen is not available in this release yet.” No fake charts. |
| **Error (refresh failed)** | See §1.5 session expiry. |

### 4.3 Information architecture

Sidebar labels in §1.5 are the product names. Do not call Deployments “Tenants” in the nav (spec Screen 3 title is Deployment / customer list). Page `h1` on the list is **Deployments**. Table and API may still say `tenant` internally.

### 4.4 Accessibility (beyond §1.2)

- `nav` labelled “Admin”. Current item `aria-current="page"`.
- Sidenav overlay: focus trap while open (CDK), restore focus to the hamburger on close.
- Role chip: text, not color. “Operator” is enough; do not use a green dot.

### 4.5 Relevant heuristics

- **Recognition over recall:** show the full IA disabled rather than a one-item nav.
- **Consistency:** every authenticated page has the same chrome.

### 4.6 Responsive

Per §1.4. Toolbar hamburger (`aria-label` “Open navigation”) only below 1280 px.

### 4.7 Error / validation messaging

Shell itself has no form. Logout failure: snackbar `"Sign in required."` if 401, else `"Could not sign out. Try again."` and still clear local tokens so the user is not trapped.

---

## 5. Phase 1 — Deployments list, Screen 3 (`FR-TENANT-1`–`4`, `FR-CONFIG-5`)

**Surface:** Platform admin console / tenant application (admin template).

### 5.1 User flow

**Enter:** sidebar “Deployments”, post-login default, or redirect from an unknown builder id.

**List:**

1. On init, `GET /api/tenants?page=1&page_size=25` plus any URL query (`q`, `status`, `page`, `page_size`). Sync filters ↔ URL (recognition, shareable).
2. Table columns: **Name**, **Slug**, **Providers**, **Status**, **Last modified**, and a non-sorting **Actions** column.
3. Search box `q` (max 80; hard-stop input / `maxlength`). Debounce 300 ms. Status filter: All / Active / Paused (`mat-select` or `mat-button-toggle` — toggle is better on desktop, select on phone).
4. Pagination: `mat-paginator` — page size options **10, 25, 50, 100** (all within 1–100). Default 25. Do not offer 200. `page_size > 100` is a server `PAGE_SIZE_INVALID`; the UI must not send it.
5. **Operator:** primary header action “Create deployment” opens the create dialog.
6. **Admin:** no Create button. Pause/Activate hidden.
7. Row click (or Enter when the row is focused) → `/admin/tenants/:id/builder`.
8. Actions menu (stop row navigation): **Open builder**; **Manage provider credentials** (→ `/admin/tenants/:id/provider-credentials`, §9.9); **Alerts & failover** (→ `/admin/tenants/:id/alerts`, §16, added Phase 7); **Data residency** (→ `/admin/tenants/:id/residency`, §17, added Phase 7); **Rename** (`FR-TENANT-3`, operator or assigned admin); **Pause** / **Activate** (operator only).

**Create deployment (operator):**

1. Dialog title “Create deployment”. Fields: Name (1–80), Slug (required).
2. Slug auto-suggests from name: lowercase, spaces → hyphens, strip characters outside `[a-z0-9-]`, ensure it starts with a letter (prefix `d` if the name starts with a digit). User may edit slug. Live helper: “Room namespace: `{slug}`” (equals slug, FR-TENANT-1).
3. Submit → `POST /api/tenants` `{ name, slug }` with a fresh `Idempotency-Key`. Do not send `status` (default active).
4. Success → close dialog, snackbar “Deployment created.”, refresh list, **stay on the list** (do not force-navigate to the placeholder builder — the row is the click-through). Optional: focus the new row.
5. Cancel / Escape / backdrop: close without save (user control).

**Rename (`FR-TENANT-3`):**

1. Dialog: Name only. Slug shown as read-only text (“Slug cannot be changed after creation.”) — this is the FR-TENANT-3 immutability rule made visible so users do not hunt for an edit control.
2. `PATCH /api/tenants/:id` `{ name }` + `If-Match: {updated_at}`.
3. `TENANT_CONFLICT` → `"Tenant was modified by another user. Reload and retry."` + a Retry that reloads the row.
4. Success → snackbar “Deployment renamed.”, refresh.

**Pause / activate (`FR-TENANT-4`):**

1. **Pause** always uses `confirm-dialog`: title “Pause deployment?”, body “New conversations will be refused. In-progress sessions can finish. Agent Builder edits stay allowed.” Buttons: “Cancel” / “Pause deployment” (error-colored).
2. **Activate** may proceed without confirm (non-destructive) or use a lighter confirm “Activate deployment? New conversations will be allowed.” Prefer a confirm for symmetry and mis-click prevention.
3. `POST /api/tenants/:id/status` `{ status }`. Same-status is a 200 no-op — still close and refresh; no error toast.
4. Success snackbar: “Deployment paused.” / “Deployment activated.”

**Builder (`FR-CONFIG-5`):**

1. Route `/admin/tenants/:id/builder`. Shell stays.
2. Load `GET /api/tenants/:id` for the header name. 404 → list + `"Tenant not found."`
3. Body: the full Agent Builder editor — see §10.
4. Back control: page-header secondary “Back to deployments” → `/admin/deployments`.

(Phase 1 shipped this route as a “coming soon” placeholder using the shared coming-soon state, §7. That placeholder is now superseded by §10 for this route. §7’s shared coming-soon state remains the pattern for the still-unbuilt Dashboard/Sessions/GPU/Alerts/Residency routes.)

**Exit:** navigate away via sidebar, back link, or sign out.

### 5.2 Screen / component states

| State | Behavior |
|---|---|
| **Default (has rows)** | Table populated. Search and filters persist in the URL. |
| **Loading (first fetch)** | `mat-progress-bar` under `page-header`. Table region `aria-busy="true"`. Show column headers + 5 skeleton rows **or** an inert empty table — do not flash the zero-tenant empty-state. |
| **Loading (filter/page change)** | Progress bar only; keep previous rows dimmed (`aria-busy`) to avoid layout jump. |
| **Empty — operator, zero tenants, no filters** | `empty-state`: title “No deployments yet”, body “Create a deployment to configure providers and start conversations.”, primary “Create deployment”. **Not an error.** |
| **Empty — admin, zero assigned, no filters** | `empty-state`: title “No deployments assigned”, body “No deployments are assigned to you. Contact an operator.” No Create button. **Not an error and not a 403.** |
| **Empty — filters/search, total 0** | `empty-state`: title “No matching deployments”, body “No deployments match your filters.”, action “Clear filters” (clears `q` + `status`, page=1). |
| **Providers column empty** | This phase may have no stack. Show an em dash with `aria-label` “Not configured” — **not** an error icon. |
| **Status** | `status-chip`: Active = `check_circle` + “Active”; Paused = `pause_circle` + “Paused”. |
| **Last modified** | Relative text (“2 hours ago”) + `title` / tooltip with absolute ISO local-formatted timestamp. |
| **Error — list fetch** | Error empty-state + “Retry”. Do not use the zero-tenant copy. Generic transport: “Could not load deployments. Try again.” `PAGE_SIZE_INVALID` should not appear if the paginator is correct; if it does, reset `page_size` to 25 and retry. |
| **Error — create** | Field or dialog alert per §5.7. Dialog stays open. |
| **Error — pause/activate** | Dialog or snackbar with spec sentence. |
| **TENANT_LIMIT_REACHED** | Dialog alert `"This platform instance supports at most 500 tenants."` Disable the Create button on the page afterwards (optimistic: also hide/disable Create when `total >= 500` on an unfiltered operator list). |
| **TENANT_FORBIDDEN** | Should not appear on list reads. On mutate: snackbar `"You are not assigned to this tenant."` |
| **Row hover / focus** | Entire row is a single tab stop (`tabindex="0"` on `tr` or a name-cell link). Hover background. Cursor pointer. Actions button is a **second** tab stop. |
| **Disabled Create** | Non-operators: control absent (not disabled — absence is the role gate). Operators at cap: present but disabled + tooltip with the limit sentence. |
| **Success** | Snackbars in §5.1. List refreshes. |

### 5.3 Information architecture

- Nav label: **Deployments**. `h1`: **Deployments**.
- Adjacent: Agent Builder (child, §10), per-tenant provider credentials (child, §9.9), Alerts & failover (child, §16, added Phase 7), Data residency (child, §17, added Phase 7) — all four are tenant-scoped children of a Deployments row, never top-level nav destinations for the actual edit form.
- URL query contract: `?q=&status=active|paused&page=1&page_size=25`. Omit empty `q` and `status` when “All”.

### 5.4 Accessibility (beyond §1.2)

- Table: `role="table"` via `mat-table`; caption or `aria-label` “Deployments”. Paginator: announce “Showing {start}–{end} of {total}” (`aria-live="polite"` on a visually hidden element or the paginator’s own label).
- Sortable columns are **not** required in Phase 1. If `mat-sort` is added later, use APG sort-button semantics (`aria-sort`).
- Search: `<label>` “Search deployments”, `maxlength="80"`, `aria-describedby` character limit only if you show a counter (optional).
- Status filter: labelled “Status”.
- Row activation: Enter/Space on the focused row opens builder. Actions menu: `aria-label` “Actions for {name}”.
- Confirm dialog: APG dialog (Material does this) — focus the title, trap focus, Escape cancels.
- Do not make the whole row a `<a>` wrapping buttons (invalid HTML). Prefer: name cell is the link; row click handler on `tr` ignores clicks that originated in the actions cell.

### 5.5 Relevant heuristics

- **Error prevention:** pause confirm; slug live-validation; maxlength on search and name; idempotency key on create (double-submit does not duplicate).
- **User control:** cancel on every dialog; clear filters; back to list from builder.
- **Visibility of status:** progress bar on fetch; snackbar on mutate; chips for tenant status.
- **Match the real world:** “Deployments” / “Pause” (stops new calls) as the spec describes, not “Delete” / “Archive”.
- **Recognition:** disabled future nav; slug helper shows the room namespace.

### 5.6 Responsive

- **Desktop:** full table, filters in one row (search flexes, status, spacer, paginator top or bottom — put paginator **below** the table, Material default).
- **Tablet:** hide “Last modified” column; keep Name, Slug, Status, Actions. Providers can wrap or hide.
- **Phone:** do **not** use a tiny table. Stacked cards: name as title, slug as meta, status chip, providers line, relative time, overflow actions. Search + status stack vertically. “Create deployment” stays in the page-header (sticky).

### 5.7 Error / validation messaging (authoritative)

**Create dialog**

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `TENANT_NAME_INVALID` | 400 | `Name is required and must be 1–80 characters.` | Name field |
| `TENANT_SLUG_INVALID` | 400 | `Slug must be 2–48 characters, start with a letter, and contain only lowercase letters, digits, and hyphens.` | Slug field. Client regex: `^[a-z][a-z0-9-]{1,47}$` (2–48 total). |
| `TENANT_SLUG_EXISTS` | 409 | `A tenant with this slug already exists.` | Slug field |
| `TENANT_LIMIT_REACHED` | 400 | `This platform instance supports at most 500 tenants.` | Dialog alert |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Use the contract sentence if present; otherwise close and refresh (same key + same body is a success replay). Different body: show the contract message and mint a new key. | Dialog alert |

Client copies the name/slug sentences on blur so users do not wait for 400.

**List**

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `PAGE_SIZE_INVALID` | 400 | `page_size must be between 1 and 100.` | Should be unreachable; if seen, reset size and snackbar this sentence |

**Rename**

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `TENANT_NOT_FOUND` | 404 | `Tenant not found.` | Snackbar; close dialog; refresh list |
| `TENANT_SLUG_IMMUTABLE` | 400 | `Slug cannot be changed after creation.` | Unreachable if slug is not in the PATCH body — never send `slug` |
| `TENANT_FORBIDDEN` | 403 | `You are not assigned to this tenant.` | Snackbar |
| `TENANT_CONFLICT` | 409 | `Tenant was modified by another user. Reload and retry.` | Dialog alert + Retry |

**Pause / activate**

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `TENANT_STATUS_INVALID` | 400 | Use the contract map sentence (spec names the code; if the map has no extra prose, show `error.message` from the envelope). | Snackbar |
| `TENANT_NOT_FOUND` / `TENANT_FORBIDDEN` | 404 / 403 | Spec sentences above | Snackbar |

**Builder deep link**

| Code | UI sentence (verbatim) | Placement |
|---|---|---|
| `TENANT_NOT_FOUND` | `Tenant not found.` | Snackbar on the Deployments list (FR-CONFIG-5) |

### 5.8 Role matrix (do not improvise)

| Action | `operator` | `admin` (assigned) | `admin` (unassigned) |
|---|---|---|---|
| See list | All tenants | Assigned only | Empty list (success) |
| Create | Yes | No (hide) | No (hide) |
| Rename | Yes | Yes | N/A (no rows) |
| Pause / activate | Yes | No (hide) | No |
| Open builder placeholder | Yes | Yes | N/A |

**Conflict flag:** `FR-TENANT-4` does not name a role. HLD §5.2 says only `operator` may pause/activate. **UX follows the HLD.** If product later allows admins to pause, change the HLD and this table together.

### 5.9 Create-dialog field spec (implementation-ready)

| Field | Bound to | Constraints | Autocomplete / a11y |
|---|---|---|---|
| Name | `name` | 1–80, required, `maxlength=80` | `aria-required="true"` |
| Slug | `slug` | `^[a-z][a-z0-9-]{1,47}$`, required, `maxlength=48` | Helper: room namespace. `spellcheck="false"`, `autocapitalize="off"` |

Primary button: “Create”. Secondary: “Cancel”. Submit disabled while invalid or submitting.

---

## 6. Conversation SPA — Phase 1 placeholder (superseded)

**Surface:** Conversation client (own classification — not the admin template).

Phase 1 did **not** design or implement Screens 9–11 (pre-call, live call, post-call). The Angular `conversation` project shipped as a workspace placeholder with a single unauthenticated page (browser title `Conversation · Avatar Platform`, body “Conversation client coming soon.”, no admin chrome).

**This section is now superseded for Screens 9, 10, and 11.** Phase 3 replaced the placeholder with the full flows in **§11 (Screen 9 — pre-call)** and **§12 (Screen 10 — live conversation)**. Phase 7 replaces §12.2's "Ended" terminal placeholder with the real **§18 (Screen 11 — post-call summary)** — the end-of-call navigation target described in §12.1/§12.2 is now `/c/:slug/summary/:summary_token` (§18.1), not the old same-SPA "You've left the call" stopgap.

---

## 7. Shared coming-soon page (admin)

**Superseded as of Phase 7.** This state was used by the disabled nav targets (Dashboard, Sessions, GPU health, Alerts, Residency) through Phase 6. All five now have real screens (§13–§17) and no admin nav item is disabled any more. The `empty-state` "Coming soon" primitive itself is not deleted — reuse it verbatim for any *future* not-yet-built screen (e.g. a later Tools management surface, §10.10) rather than inventing a new placeholder pattern.

- `page-header` `h1` = screen name
- `empty-state` title “Coming soon”
- Body: “This screen is not available in this release yet.”
- No primary action except a “Back to deployments” secondary link where relevant

---

## 8. Implementation notes for `nexus-dev`

1. Reuse `projects/shared/ui` primitives (`status-chip`, `page-header`, `empty-state`, `confirm-dialog`). If they do not exist yet, create them in that folder to the behaviors above — do not fork per feature.
2. Switch UI on `AppErrorCode`. Render `error.message` from the contract map (spec sentences).
3. Auth pages: no sidenav. Authenticated pages: sidenav always.
4. Default landing after auth: `/admin/deployments`.
5. Unassigned admin empty list is a **success empty-state**, not a toast and not an HTTP error.
6. Zero tenants for an operator is the same: success empty-state with Create.
7. Provider stack may be empty this phase — em dash, not a red error.
8. No self-signup affordance anywhere.
9. Pause confirm is mandatory; create/rename cancel is mandatory.
10. `@axe-core/playwright` + keyboard-only pass on login, invite, deployments, shell, and builder placeholder before calling Phase 1 UI done (NFR-4 / LLD a11y gate).
11. Provider Registry and Agent Builder (§9, §10) reuse the existing admin-only shared components named in the LLD workspace layout (`admin/shared`: `provider-badge`, `hosting-badge`, `yaml-viewer`) plus `projects/shared/ui` (`status-chip`, `page-header`, `empty-state`, `confirm-dialog`) — do not build a second badge/preview component.
12. Agent Builder's live-preview/validate loop is owned by `AgentBuilderStore` (LLD §9.1, SignalStore: structured draft, dirty flag, debounced 400 ms `validate` result, resolved preview, redacted YAML, `If-Match` token). Components read/write through the store; they do not call `HttpClient` directly and do not hold their own copy of the draft.
13. `@axe-core/playwright` + keyboard-only pass on the Provider Registry catalog table, the per-tenant credential form, and the full Agent Builder (all states in §10.3) before calling this slice of Phase 2 UI done.
14. Phase 7 introduces one new shared admin primitive, **`tenant-select`** (§13.8) — a typeahead over `GET /tenants?q=`, reused verbatim on Dashboard (§13), Sessions (§14), and GPU health (§15). Build it once in `projects/shared/ui`, do not fork a second tenant picker for any of the three.
15. Phase 7's Alerts (§16) and Residency (§17) screens each ship as **two routes**: a picker/index at the flat nav path and the real editable form at `/admin/tenants/:id/{alerts|residency}` — do not build only the flat route, the picker is not a substitute for the real screen.
16. Screen 11 (§18) is a **new page in the `conversation` Angular project**, not the `admin` one — plain CSS, no Material, no admin shell, same classification boundary as Screens 9/10 (§1.1, §11, §12). It supersedes §12.2's "Ended" placeholder; update Screen 10's end-call navigation target accordingly (§12.1 step 6, §12.2).
17. `@axe-core/playwright` + keyboard-only pass on all six Phase 7 surfaces (Dashboard, Sessions list + detail, GPU health, Alerts picker + form, Residency picker + form, Screen 11) before calling Phase 7 UI done — this is also Final Review's last a11y gate for the whole product (NFR-4 / LLD a11y gate), since no further UI phases follow this one.

### 8.1 Open conflicts (flagged, not silently resolved)

| Item | Decision for Phase 1 |
|---|---|
| Brief said one message for `AUTH_EMAIL_INVALID` and `AUTH_INVALID_CREDENTIALS` | **Spec wins:** two sentences. “Same either way” = unknown email vs bad password only. |
| Brief path `/tenants/:id/builder` vs FR-CONFIG-5 `/admin/tenants/{id}/builder` | **Spec/LLD wins:** browser URL `/admin/tenants/:id/builder`. |
| `FR-TENANT-4` silent on who can pause | **HLD wins:** operator only. |
| Invite page cannot show email | **No extra API.** Copy stays generic. |
| Forgot-password | **Out of spec.** Do not add. |
| Dark theme | **Not specified.** Light only. |

**Phase 2 additions (Provider Registry / Agent Builder) — flagged for `nexus-dev`, not silently resolved:**

| Item | Decision / open question |
|---|---|
| Route shape for per-tenant credentials | Neither the spec nor the LLD names a browser route for `GET/POST /tenants/{id}/provider-credentials` (only the API path is given). **This document decides:** `/admin/tenants/:id/provider-credentials`, opened from a Deployments row action and from Agent Builder's missing-credential state, mirroring the existing `/admin/tenants/:id/builder` pattern. The global catalog is the plain nav route `/admin/providers`. Flag to product/architecture if a different shape is preferred before building. |
| `llm.fallback` appears in **two** admin surfaces | `FR-CONFIG-1` lists an “optional LLM fallback” dropdown on Agent Builder (Screen 2); LLD §5.6 also has `PUT /tenants/{id}/alert-policy` (Screen 7) writing the same `llm.fallback` block transactionally. **This document's decision (§10.5):** Screen 2 owns the fallback **provider + model** dropdown pair (it is a pipeline-layer choice like every other dropdown on this screen and `CONFIG_FALLBACK_IDENTICAL` is a Screen-2-time validation error). Screen 7 (not yet built) owns *retry policy* (`retry.max_attempts`, `retry.backoff_ms`) and `degraded_mode_message` only. Screen 2 does not duplicate retry/backoff editing. If Screen 7's eventual design disagrees, reconcile there — do not let the two screens silently diverge on which one is the source of truth for `llm.fallback` identity. |
| Residency fields on the same `DeploymentConfig` object | `privacy.*` fields have their own future Screen 8 and API (`GET/PUT /tenants/{id}/residency`). **Decision (§10.5):** Screen 2 shows the tenant's current `privacy.send_to_remote_llm` value **read-only** (needed to explain a `CONFIG_RESIDENCY_BLOCKS_LLM` error inline) with a link to Residency once that screen exists; it does not expose an editable residency control. |
| `PROVIDER_CREDENTIAL_EXISTS` (409) has no spec sentence | Authored placeholder copy in §9.9's table (`“A credential for this provider and label already exists.”`) — confirm against the eventual contract map before shipping; do not invent a second wording later. |
| `CONFIG_CREDENTIAL_MISSING` reused for delete-blocked | The spec's sentence for this code (`"Add an endpoint and credential ref for {key} in Provider Registry."`) is written for the *Agent Builder save* context, not *deleting a credential the published config depends on*. §9.9 authors a second, delete-specific sentence under the same code. Flag to backend/contracts: either the map needs a context-aware message or the UI's delete-specific copy is the one true wording for this code+context pairing — confirm before ship. |
| `PROVIDER_PROBE_RATE_LIMITED` (429) has no spec sentence | Authored placeholder copy in §9.9 (`“Too many connection tests. Try again in a minute.”`) — same confirm-before-ship caveat as above. |

**Phase 3 additions (Conversation SPA — Screens 9 & 10, §11–§12) — flagged for `nexus-dev`, not silently resolved:**

| Item | Decision / open question |
|---|---|
| Browser route shape for Screens 9/10 | Neither the spec nor the LLD names a browser route. **This document decides (§11.1):** entry deep link `/c/:slug` is Screen 9 (pre-call); a successful token issue navigates to `/c/:slug/call` (Screen 10), passing the LiveKit URL/tokens and display name via router state (in-memory), not the URL, so a token never sits in browser history/query string. Reloading `/c/:slug/call` directly (no in-memory state) redirects back to `/c/:slug`. Flag to product/architecture if a different shape is preferred. |
| Screen 11 (post-call) doesn't exist yet | **This document's stopgap (§12.2, "Ending"/"Ended" states):** end-call (deliberate) and `CALL_RECONNECT_FAILED` (involuntary) land on two different outcomes since they are not the same event to the user — see §12.2. The deliberate end-call placeholder is a same-SPA "You've left the call" screen with a "Start a new call" action back to `/c/:slug`; it is explicitly authored as temporary and is expected to be replaced wholesale, not extended, when Screen 11 is built. |
| Exact wording for the FR-AVATAR-5 "no avatar track" banner | Spec says only "banner" with no copy. **Authored copy in §12.2:** "Still connecting you to your avatar…" (non-alarming, "still working" tone) — confirm against product copy before ship; do not let a future dev change this to alarming wording without updating this doc, since the spec gives no sentence to follow. |
| Camera toggle UI | Spec makes camera "optional" but does not describe any UI for it. **This document's invention (§11.1, §12.4):** camera defaults to off on both screens (mic-only is the FR-CALL-1 hard requirement; camera is opt-in, not opt-out) with an explicit "Turn on camera" toggle on Screen 9's preview area and a matching camera icon-button in Screen 10's control bar. Flag to product: confirm end users are even meant to send video of themselves (the FR only discusses receiving avatar video), since nothing in the spec's data flow describes what the platform does with a user's own camera feed once captured. |
| Avatar preview asset when no `preview_url` (today, always) | No illustration exists yet. **Authored placeholder (§11.1):** a static Material-styled avatar glyph card (`mat-icon` `face` at large scale on `--la-primary-container`), not a photorealistic placeholder — avoid implying a specific avatar is coming when today there is no v1 adapter. |
| Unsupported-browser detection mechanism | Spec names the supported-browser matrix but not the detection method. **This document's decision (§11.1):** feature-detect (`navigator.mediaDevices.getUserMedia` + `RTCPeerConnection` presence) rather than user-agent sniffing, since UA strings are unreliable and the spec's real requirement (NFR-6) is "WebRTC required," which is a capability, not a browser name. |
| Mic level indicator visual treatment | Not specified. **Authored (§12.4):** a simple radial or bar meter driven by LiveKit's local audio track level, updated at low frequency (~10 Hz) to avoid excessive re-render — decorative, not a substitute for the mute icon's own state. |

**Phase 7 additions (Dashboard §13, Sessions §14, GPU health §15, Alerts §16, Residency §17, Screen 11 post-call summary §18) — flagged for `nexus-dev`, not silently resolved:**

| Item | Decision / open question |
|---|---|
| Alerts/Residency nav-scaffold vs. tenant-scoped API mismatch | The Phase 1 nav shell seeded "Alerts"/"Residency" as flat top-level items anticipating flat screens, but their real LLD endpoints are single-tenant reads/writes exactly like Agent Builder (not a top-level nav destination). **This document's resolution (§16.1/§17.1, §1.7):** the sidebar routes become lightweight deployment pickers; the real editable screens move to `/admin/tenants/:id/alerts` and `/admin/tenants/:id/residency`, matching the established tenant-scoped-screen convention. Flag to product/architecture if a flat single-screen design or removing the sidebar items entirely (mirroring Agent Builder's own non-nav-item precedent) is preferred instead. |
| Screen 7's scope vs. §10.5's established fallback-LLM ownership | This dispatch's brief describes Screen 7 as configuring "fallback LLM + retry policy," but §10.1/§10.5 (Phase 2) already assigned fallback-LLM **identity** exclusively to Agent Builder specifically to avoid two screens editing the same field with no reconciliation UI. **This document's resolution (§16.2, §16.9):** Screen 7 shows fallback LLM read-only with a link to Agent Builder, and only edits retry policy + degraded-mode message. This is flagged as a genuine, unresolved product conflict — not silently picked — since `PUT /tenants/{id}/alert-policy` does technically accept an optional `llm_fallback` body, meaning the API itself doesn't force this document's chosen division of labor. |
| `PUT /tenants/{id}/alert-policy` full-replace vs. partial-body semantics | Unconfirmed whether omitting `llm_fallback` from this screen's `PUT` body preserves the existing value or nulls it (§16.9). If full-replace, the client must round-trip the read-only value back on every save. Confirm with the backend contract before wiring Save. |
| Dashboard provider-health has no `tenant_id` filter | `GET /dashboard/provider-health` takes no tenant scoping even though `GET /dashboard/summary` does (§13.9). Selecting a tenant filters only the snapshot widgets; the health grid stays aggregate-across-assigned-tenants with a disclosed "All assigned tenants" caption rather than silently mismatching the selected scope. |
| Dashboard → Provider Registry "filtered by category" click-through | FR-DASH-2 says "click-through to Provider Registry filtered by category," but the catalog (§9) is always exactly 10 rows, never actually filterable (FR-PROVIDER-1). **Resolution (§13.1, §13.9):** the click-through scrolls to and highlights the relevant category group header rather than removing other rows — an addition to §9.2's existing behavior, not a new filtering capability. |
| One empty-state sentence for both roles on Dashboard | FR-DASH-1 gives exactly one zero-tenant sentence, unlike Screen 3's established two-sentence role split (§5.2). §13.2 follows the spec's literal single sentence for both `operator` and `admin` — a deliberate, flagged departure from this document's own earlier precedent. |
| End-user-register `TRANSCRIPT_PURGED` copy on Screen 11 | The spec's `"Transcript was deleted per the retention policy."` sentence was authored for the admin Sessions detail (§14.4). §18.3/§18.8 author a second, shorter sentence ("Your transcript is no longer available.") for the same code on the unauthenticated, end-user-facing Screen 11 — confirm both wordings are acceptable for one code, or that a single contract-map sentence should be reused verbatim on both surfaces instead. |
| Screen 11's `SESSION_NOT_FOUND` reusing the expired-token sentence | The spec names `404 SESSION_NOT_FOUND` for this case without prescribing copy. §18.3/§18.8 reuse `"This summary link has expired."` verbatim rather than a distinct "session not found" sentence, specifically to avoid a token/session-existence oracle (FR-CALL-5) — flagged as authored, not spec-mandated wording. |
| `summary_token` living in the URL (Screen 11) | Diverges from §11.1's "never put a bearer credential in the URL" rule established for LiveKit tokens — justified in §18.1/§18.9 by the token's narrower blast radius and the product need for the summary link to survive a reload/share within its 30-minute TTL. Confirm this reasoning is acceptable. |
| GPU health utilization has no color threshold | Only the binary `healthy`/`unhealthy` flag is spec-defined; §15.2/§15.9 deliberately do not invent a "hot" utilization threshold the spec never gave. Flag to product if an at-a-glance "under heavy load" signal (distinct from "down") is wanted — it would need a threshold value that doesn't currently exist anywhere in the spec or LLD. |
| Agent Builder's Residency link must be un-blocked | §10.1/§10.6/§10.10 built the "Manage in Residency" link in a disabled/tooltipped state pending Screen 8's existence. Now that §17 ships, that link must be pointed at `/admin/tenants/:id/residency` and un-disabled — a required follow-up edit to prior-phase UI, not a new decision (§17.4). |

---

## 9. Phase 2 — Provider Registry, Screen 4 (`FR-PROVIDER-1`, `-2`, `-3`, `-6`, `-7`)

**Surface:** Platform admin console / tenant application (admin template, §1.1). No new surface classification needed.

Screen 4 is two related pages, not one: a **global catalog** (`/admin/providers`) and a **per-tenant credential list + form** (`/admin/tenants/:id/provider-credentials`). Both reuse `status-chip`, `page-header`, `empty-state`, `confirm-dialog` (§1.3) and the admin-only `provider-badge` / `hosting-badge` components already named in the LLD workspace layout — do not invent parallel components.

### 9.1 Global catalog vs per-tenant credentials — division of labor

| | Global catalog (`/admin/providers`) | Per-tenant credentials (`/admin/tenants/:id/provider-credentials`) |
|---|---|---|
| Data | `ProviderDefinition` (10 built-ins, seeded, never empty) | `ProviderCredential` (tenant-scoped rows admins create) |
| Who can enable/disable | `operator` only | — |
| Who can view | `operator` + `admin` (read-only for `admin`) | `operator` + assigned `admin` |
| Who can create/edit/delete rows | — | `operator` + assigned `admin` |
| Nav entry point | Top-level sidebar “Providers” (§1.5) | Deployments row action “Manage provider credentials”; also linked from Agent Builder’s missing-credential state (§10) |

### 9.2 Global catalog — user flow

1. **Enter:** sidebar “Providers” (live for both roles) or deep link `/admin/providers`.
2. On init: `GET /provider-definitions` (no query — full catalog, 10 rows, never empty per FR-PROVIDER-1).
3. Table is grouped by **category** (transport, stt, llm, tts, avatar) with a small group header row (category label + `mat-icon`: `lan` transport, `mic` stt, `psychology` llm, `record_voice_over` tts, `face` avatar — icon is decorative, category name is the accessible label, never icon-only).
4. Columns: **Provider** (display name), **Hosting** (`hosting-badge`: `self_hosted` | `remote`, icon + text — e.g. `dns` “Self-hosted” / `cloud` “Remote”), **Interface** (`ITransportProvider` etc. — small mono caption, optional on phone), **Enabled** (operator: `mat-slide-toggle`; admin: `status-chip` “Enabled”/“Disabled”, read-only).
5. **Operator toggles a provider off:** `confirm-dialog` (non-trivial effect on other tenants) — title “Disable {display name}?”, body “Tenants configured to use {display name} will fail validation until they switch providers. This does not affect sessions already in progress.” Buttons “Cancel” / “Disable”.
6. Confirmed → `PATCH /provider-definitions/{key}` `{enabled: false}`.
   - Success → toggle reflects off, snackbar “{display name} disabled.”
   - `422 PROVIDER_CATEGORY_EMPTY` (last enabled in category) → toggle **reverts** to on; **inline** error appears directly under that provider’s row (not a snackbar — the task calls for a clear inline error, and a toast that auto-dismisses would not satisfy “not a silent failure”): `role="alert"`, error-colored text with `warning` icon, the spec sentence `"At least one provider must remain enabled in this category."` The message stays until the operator’s next action on that row (retries or navigates away) — it does not auto-dismiss on a timer.
7. **Operator toggles a provider on:** no confirm needed (non-destructive) → `PATCH {enabled: true}` → snackbar “{display name} enabled.”
8. **Exit:** sidebar navigation elsewhere.

### 9.3 Global catalog — screen/component states

| State | Behavior |
|---|---|
| **Default** | 10 rows across 5 category groups, always populated (FR-PROVIDER-1: “catalog is never empty after seed”). |
| **Loading (first fetch)** | `mat-progress-bar` under `page-header`; `aria-busy="true"` on the table region. Never show an empty-state flash — catalog is guaranteed non-empty. |
| **Error (list fetch)** | `empty-state` “error” variant + Retry (§1.6 pattern). Generic transport copy, matching §5.2’s convention: “Could not load providers. Try again.” |
| **Toggle in flight** | The toggle itself shows a small inline spinner (Material’s built-in disabled/pending state) and is disabled; row otherwise unchanged (no full-page block — this is a small, local action). |
| **Toggle success (disable)** | Toggle off, `hosting-badge` unaffected, snackbar. |
| **Toggle blocked (`PROVIDER_CATEGORY_EMPTY`)** | Toggle reverts; inline row error per §9.2 step 6. Toggle remains interactive (operator can try a different provider in the category first). |
| **Read-only (admin)** | Toggle replaced by `status-chip`; no confirm-dialog ever shown to `admin` (they cannot trigger the mutation — this is an absent control, not a disabled one, consistent with §5’s Create-button role gate). |
| **Disabled provider row** | Row stays visible (recognition over recall) with `status-chip` “Disabled” (icon `block` or `pause_circle`, not color alone) at low-but-≥3:1 contrast; the row is not struck through or removed. |

### 9.4 Global catalog — information architecture

- Nav label / `h1`: **Providers**. No secondary action in the `page-header` (operators mutate inline, per row).
- Adjacent: per-tenant credential pages are one hop away via Deployments, not linked directly from this page (the catalog has no tenant context) — a supporting line under the page title may read “Manage per-tenant endpoints and credentials from a deployment’s row menu.” to prevent the operator from hunting for it here.

### 9.5 Global catalog — accessibility (beyond §1.2)

- Category group headers use a heading level below the page `h1` (e.g. `h2`) so screen-reader users can jump by category (WAI-ARIA APG table-with-grouping pattern; Material’s `mat-table` does not group natively — implement via a full-width group row with `role="rowgroup"`/visually a divider, or repeat as five small tables each with its own `<caption>`).
- Toggle: `mat-slide-toggle` exposes `aria-checked` natively; label it via `aria-label="Enable {display name}"` (the visible “Enabled” column header is the group label, not a per-row label).
- Inline blocked-toggle error: `role="alert"`, associated to the toggle via `aria-describedby` so the reason is read immediately after the toggle’s state is announced as reverted.

### 9.6 Global catalog — relevant heuristics

- **Error prevention + user control/freedom:** confirm-dialog before disable (affects other tenants); toggle-on needs no confirm (reversible, low-risk).
- **Error recovery:** the blocked-disable message states the rule plainly rather than a generic “Error” — the operator immediately understands why and what to do (enable a sibling provider first, or leave this one alone).
- **Recognition over recall:** disabled providers stay listed instead of disappearing.

### 9.7 Global catalog — responsive

- **Desktop (≥1280):** full grouped table as above.
- **Tablet/phone (<1280):** stacked cards per provider (same pattern as Deployments phone view, §1.4/§5.6): provider name as title, hosting badge + interface as meta line, enabled toggle/status-chip as the primary control. Category becomes a card-group heading instead of a table group row.

### 9.8 Global catalog — error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `PROVIDER_UNKNOWN` | 404 | Unreachable in normal use (toggle acts on rows already rendered from the catalog) — if seen, snackbar “Could not update this provider. Refresh and try again.” | Snackbar |
| `PROVIDER_CATEGORY_EMPTY` | 422 | `At least one provider must remain enabled in this category.` | Inline, under the row (§9.2 step 6) |

### 9.9 Per-tenant credential list + create/edit form — user flow

**Enter:** Deployments row action “Manage provider credentials”, or a link from Agent Builder’s missing-credential dropdown state (§10). **Exit:** page-header secondary “Back to deployments”, or the cross-link to Agent Builder once at least one credential exists.

**List:**

1. `GET /tenants/:id/provider-credentials` (optionally `category`/`provider_key` — not needed for the full list view).
2. Table columns: **Provider** (`provider-badge`: display name + `hosting-badge`), **Display label** (or em dash “Not labeled” if absent), **Endpoint** (truncated middle, full value in a `title` tooltip — never the secret), **Secret** (compact icon + text indicator, distinct from the health `status-chip`: `key` + “Configured” when `has_secret: true`, `key_off` + “Not set” when `false` — the provider still resolves via `endpoint_url` alone when `has_secret: false` and the provider does not require one), **Connection** (`status-chip`: `healthy` = `check_circle` “Healthy”, `degraded` = `warning` “Degraded” (`--la-caution`), `unreachable` = `error` “Unreachable” (`--la-error`), never-probed = `help_outline` “Not tested” — plus a `body-small` caption “Checked {relative time}” or “Never checked”), **Actions** (menu: Test connection, Edit, Delete).
3. Page-header primary action: “Add credential” → create dialog.
4. **Add credential:**
   - Dialog title “Add provider credential”. Fields (§9.9 field spec below).
   - Submit → `POST /tenants/:id/provider-credentials` with a fresh `Idempotency-Key`.
   - Success → close, snackbar “Credential added.”, refresh list.
5. **Edit credential:** same dialog pre-filled, title “Edit provider credential”, `PATCH … + If-Match`. Same field rules; secret fields never come pre-filled with a real value (there is none client-side to prefill — only `credential_ref`, which **is** shown, since it is a non-secret pointer, not the secret itself).
6. **Test connection:** row action → `POST …/{credId}/probe`. Button shows a 20px spinner label “Testing…” while in flight (§1.3 progress convention); on return, updates the Connection cell in place (chip + “Checked just now”). Always resolves to a `200` per FR-PROVIDER-3 (even “unreachable” is a normal result, not an error state for the row) — the row briefly announces the outcome via a polite live region so screen-reader users are not left waiting silently.
7. **Delete credential:** row action → `confirm-dialog` “Delete this credential?”, body “{display label or provider name} at {endpoint} will no longer be available to Agent Builder.” Buttons “Cancel” / “Delete”.
   - Success (`204`) → snackbar “Credential deleted.”, refresh list.
   - `422 CONFIG_CREDENTIAL_MISSING` (the published config depends on it) → **do not** show a generic error and silently fail. Keep the confirm-dialog open, replace its buttons with a form-level alert: “This credential is used by the published configuration for this deployment and can’t be deleted. Change the provider in Agent Builder first, then delete this credential.” Buttons become “Close” (primary) / “Open Agent Builder” (secondary, navigates to `/admin/tenants/:id/builder`). *(Authored copy — flagged in §8.1: the spec’s stock `CONFIG_CREDENTIAL_MISSING` sentence is written for the Builder-save context, not delete-blocked; confirm before shipping.)*

**Add/edit field spec (implementation-ready):**

| Field | Bound to | Constraints | Notes / a11y |
|---|---|---|---|
| Provider | `provider_key` | Required. `mat-select`, options from `GET /provider-definitions` filtered to `enabled: true` at open time (a since-disabled provider on an existing row still shows as plain text, not an editable select, to avoid silently re-pointing an existing credential at a hidden option) | Each option row: display name + `hosting-badge`. Disabled on edit (provider cannot be changed after creation — create a new credential instead; this mirrors the Deployments slug-immutability pattern, §5’s Rename dialog). |
| Endpoint URL | `endpoint_url` | Required, https, max 2048. `http://localhost`/`http://127.0.0.1` allowed for lab use. | Helper text (always visible, not only on error): “Must start with https://. http://localhost is allowed for local testing.” `type="url"`, `inputmode="url"`. |
| Credential reference | `credential_ref` | Optional, 1–256 | Label: “Credential reference (optional)”. Helper (always visible): “A reference to a secret already stored in your secret manager (e.g. a Vault path or Kubernetes secret name) — never paste the actual secret or API key here.” `autocomplete="off"`, not a password field (it is not secret itself, so no visibility toggle needed — it is safe to display in plaintext, unlike the secret it points to). |
| Display label | `display_label` | Optional | Helps disambiguate multiple credentials for the same provider (e.g. “prod key”, “eu-region key”). |
| Extra settings | `extra` | Optional JSON object, ≤8 KB | Monospace `textarea`, label “Extra settings (JSON, optional)”. Helper: “Non-secret configuration only. Do not include api_key, token, password, or secret — those fields are rejected.” Client-side `JSON.parse` before submit; malformed JSON blocks submit with a local message “Enter valid JSON.” (no code — client-only), separate from the server’s `PROVIDER_SECRET_IN_BODY`. |

Primary button: “Add” / “Save”. Secondary: “Cancel”.

### 9.10 Per-tenant credential list — screen/component states

| State | Behavior |
|---|---|
| **Default (has rows)** | Table populated, sorted by category then provider. |
| **Loading (first fetch)** | `mat-progress-bar`; `aria-busy="true"`. |
| **Empty — zero credentials** | `empty-state`: title “No provider credentials yet”, body “Add a credential to connect a provider for this deployment.”, primary “Add credential”. Not an error. |
| **Error (list fetch)** | `empty-state` error variant + Retry: “Could not load provider credentials. Try again.” |
| **Secret indicator** | Icon + text only (§9.9 step 2) — never a bare padlock icon with no text, never color alone. |
| **Connection — not yet tested** | `help_outline` “Not tested” (neutral, not an error state). |
| **Connection — testing** | Row shows a 20px spinner in the Connection cell, label “Testing…”. |
| **Connection — healthy / degraded / unreachable** | `status-chip` per §9.9 step 2, plus “Checked {relative time}” caption. |
| **Probe rate-limited (`429 PROVIDER_PROBE_RATE_LIMITED`)** | “Test connection” disabled for the row (or all rows, since the limit is per-tenant, not per-credential) with a tooltip/snackbar: “Too many connection tests. Try again in a minute.” *(Authored copy — no spec sentence; flagged in §8.1.)* |
| **Create/edit dialog — default** | Provider unset (create) or fixed (edit); submit disabled until required fields valid. |
| **Create/edit dialog — loading** | Submit shows spinner, fields `readonly` during submit (same pattern as §5’s Create-tenant dialog). |
| **Create/edit dialog — field errors** | Per §9.9’s error table, `mat-error` under the relevant field. |
| **Delete confirm — default** | Two-button confirm as in §9.9 step 7. |
| **Delete confirm — blocked** | Alert + two-button recovery as in §9.9 step 7 (never a silent no-op). |
| **Success** | Snackbars per §9.9. List refreshes; dialogs close. |

### 9.11 Per-tenant credential list — information architecture

- Page-header title: “{Tenant name} · Provider credentials”. Breadcrumb-style secondary line or back-link to Deployments. A secondary link “Open Agent Builder” once ≥1 credential exists (recognition — the natural next step).
- Not a top-level nav item (§1.5). Reached only through a deployment.

### 9.12 Per-tenant credential list — accessibility (beyond §1.2)

- Secret and Connection indicators are each icon + text (never icon-only), per baseline §1.2.
- Probe result announced via a polite `aria-live` region scoped to the row (not a page-wide alert — this is a non-blocking status update, not an error).
- Delete confirm-dialog’s blocked state re-parents focus to the alert text so a screen-reader user is told *why* before hearing the new button labels.
- Credential-reference helper text is linked via `aria-describedby` **before** any error state (WCAG 3.3.2, same pattern as §3.4’s invite password rule) — the “never paste a secret here” guidance must be available up front, not only after a mistake.

### 9.13 Per-tenant credential list — relevant heuristics

- **Error prevention:** the credential-reference helper text prevents the single most damaging mistake this screen enables (pasting a real secret into a field that is not the secret store). `PROVIDER_SECRET_IN_BODY` is the server backstop, not the primary defense.
- **User control & freedom:** delete confirm; blocked-delete gives a concrete next step (“Open Agent Builder”) rather than a dead end.
- **Visibility of system status:** probe spinner + “Checked {relative time}”; never a live call hidden behind a static-looking chip.
- **Match to the real world:** “Not tested” (neutral) vs “Unreachable” (a real negative outcome) are visually and textually distinct, not the same gray chip.

### 9.14 Per-tenant credential list — responsive

- **Desktop (≥1280):** full table.
- **Tablet/phone (<1280):** stacked cards, same convention as Deployments (§1.4/§5.6): provider + hosting badge as title, endpoint as meta, secret indicator and connection chip as two labeled lines, “Test connection”/“Edit”/“Delete” as an overflow menu. Dialog becomes a full-screen sheet below 768 px (Material default `mat-dialog` behavior at that breakpoint — do not force a fixed width that clips the JSON textarea).

### 9.15 Per-tenant credential list — error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `PROVIDER_UNKNOWN` | 404 | `Unknown provider '{key}'.` | Provider field (create/edit) |
| `PROVIDER_ENDPOINT_INVALID` | 400 | `Endpoint must be an https URL.` | Endpoint URL field |
| `PROVIDER_SECRET_IN_BODY` | 400 | `Do not send raw secrets. Store a credential_ref instead.` | Extra settings field |
| `PROVIDER_CREDENTIAL_EXISTS` | 409 | `A credential for this provider and label already exists.` *(authored — no spec sentence; flagged in §8.1)* | Display label field, or dialog alert if display label is blank on both sides |
| `TENANT_FORBIDDEN` | 403 | `You are not assigned to this tenant.` | Dialog alert / snackbar |
| `TENANT_NOT_FOUND` | 404 | `Tenant not found.` | Redirect to Deployments + snackbar (same as §5) |
| `CONFIG_CREDENTIAL_MISSING` (delete-blocked) | 422 | `This credential is used by the published configuration for this deployment and can't be deleted. Change the provider in Agent Builder first, then delete this credential.` *(authored — flagged in §8.1)* | Delete confirm-dialog, replacing its buttons (§9.9 step 7) |
| `PROVIDER_PROBE_RATE_LIMITED` | 429 | `Too many connection tests. Try again in a minute.` *(authored — flagged in §8.1)* | Snackbar + disabled “Test connection” |
| Network / 5xx | — | `Could not save this credential. Check your connection and try again.` | Dialog alert |

---

## 10. Phase 2 — Agent Builder, Screen 2 (`FR-CONFIG-1`–`5`, `FR-PROVIDER-5`, `-6`, `-7`)

**Surface:** Platform admin console / tenant application (admin template, §1.1). Tenant-scoped, opened only from a Deployments row (§5.1, FR-CONFIG-5) — still not a top-level nav item.

### 10.1 Scope decision — what lives on this screen vs. deferred (read this first)

The canonical YAML (`FR-CONFIG-2`) is one object, but several of its fields are the acknowledged, named responsibility of screens that do not exist yet. Building all of it here would duplicate future Screens 7/8’s job and create two sources of truth. This document draws the line as follows — `nexus-dev` should treat this as the scope contract for Screen 2’s v1 form:

**In scope for Screen 2 (this build):**

- `transport.provider` — effectively fixed to `livekit` in v1 (catalog has one entry). Rendered as a dropdown for consistency and future-proofing, pre-selected, non-interactive, with helper “v1 supports only LiveKit as transport.”
- `stt.provider`, `stt.language` (BCP-47), `stt.model` (optional)
- `llm.primary.provider`, `llm.primary.model` (required)
- `llm.fallback.provider`, `llm.fallback.model` (optional — see §8.1 conflict entry: Screen 2 owns the *identity* of the fallback provider/model; retry/backoff timing is Screen 7’s)
- `tts.provider`, `tts.voice_id` (required)
- `avatar.provider`, `avatar.avatar_id` (required)
- `agent.runtime` (`langgraph` | `pydantic-ai`)
- `agent.system_prompt` (large text area, live byte counter, 32 KiB limit)
- `agent.memory.enabled`, `agent.memory.window_turns` (1–64, shown when enabled)
- `agent.rag.enabled`, `agent.rag.index_ref` (shown/required when enabled)

**Deferred to Screen 7 — Alerts (not built yet; Screen 2 does not expose these controls):**

- `llm.retry.max_attempts`, `llm.retry.backoff_ms[]`
- `alerts.degraded_mode_message`

**Deferred to Screen 8 — Residency (not built yet; Screen 2 shows this read-only, does not let the admin edit it):**

- `privacy.send_to_remote_llm`, `privacy.retain_transcripts_days`, `privacy.recordings_enabled` — Screen 2 shows the current `send_to_remote_llm` value as a plain read-only line near the LLM dropdowns (needed to explain a `CONFIG_RESIDENCY_BLOCKS_LLM` error inline, §10.9), with a “Manage in Residency” link that is inert (tooltip “Coming soon”) until Screen 8 ships.

**Explicitly out of scope, no screen assigned yet — flagged, not silently built:**

- `agent.tools[]` — the LLD gives this its own CRUD endpoints (`GET/POST/PATCH/DELETE /tenants/{id}/tools`), implying a dedicated surface that isn’t any of the 11 named screens. Screen 2 shows a **read-only count** (“3 tools enabled”) with no edit affordance, so the admin is not blocked from publishing a config that references tools created elsewhere (e.g., via API) — flag to product/architecture that a Tools management screen needs a number before it’s built.
- A raw-YAML edit mode. `FR-CONFIG-3` accepts `yaml_text` **or** structured `config`, but this v1 UI only ever sends the **structured** form and only ever **displays** YAML (redacted, read-only) in the preview pane. `CONFIG_YAML_PARSE` / `CONFIG_YAML_UNKNOWN_KEY` / `CONFIG_VERSION_UNSUPPORTED` are therefore not reachable from this UI’s own inputs; they are still handled (as a generic banner, §10.9) in case the API ever returns one, but no dedicated field-level UI is built for them.

### 10.2 User flow

1. **Enter:** Deployments row click, or Actions menu “Open builder” (§5.1). Deep link `/admin/tenants/:id/builder`.
2. On load: `GET /tenants/:id` (header name; 404 → Deployments + `"Tenant not found."`, §5.7), `GET /tenants/:id/config` (structured draft + `status` + `updated_at` for `If-Match`), `GET /provider-definitions` (catalog, enabled only), `GET /tenants/:id/provider-credentials` (per-category options), `GET /tenants/:id/residency` (read-only display, §10.1) — treat a 404 on this last one as “not configured” rather than an error, since Residency doesn’t exist as an editable screen yet.
3. `AgentBuilderStore` (LLD §9.1) hydrates the structured draft from the response. Every dropdown is populated from catalog ∩ tenant-credentials for its category (§10.5).
4. Changing any dropdown or field updates the store’s draft, sets `dirty = true`, and triggers the debounced (400 ms) `POST /tenants/:id/config/validate`. The response updates: per-layer inline errors, the resolved-stack summary, and the redacted YAML preview — in one pass, so the two never show different information.
5. **Save Draft** (`PUT … {save_as: draft}` + `If-Match`): available whenever the draft is dirty and free of `400`-level schema errors (schema-invalid drafts are rejected server-side per LLD §5.5 — “malformed is never stored”; `422` combination errors do **not** block a draft save).
6. **Publish** (`PUT … {save_as: published}` + `If-Match`): available only when the last validate response is `valid: true` (both gates pass).
7. Success on either → toast (“Draft saved.” / “Configuration published.”), `dirty = false`, `updated_at`/`If-Match` token refreshed from the response, `status` updated.
8. **Concurrency:** stale `If-Match` → `409 CONFIG_CONFLICT`. Never silently overwritten — see §10.3 conflict state.
9. **Exit:** page-header “Back to deployments”. If `dirty`, a route-leave guard confirms: “You have unsaved changes. Leave without saving?” / “Stay” / “Leave”.

### 10.3 Screen/component states

| State | Behavior |
|---|---|
| **Loading (initial)** | Skeleton form (dropdown placeholders) + `mat-progress-bar`; preview pane shows a neutral “Loading…” placeholder, not “not configured yet” (avoid a false-empty flash). |
| **Empty / new tenant** | All dropdowns show placeholder “Select…”. Preview pane: “Not configured yet” plus the incomplete-layer list drawn straight from `errors[].layer` on the (still-run) validate call — e.g. “Select a provider for transport / stt / llm.primary / tts / avatar.” Save Draft is enabled as soon as anything is dirty (even the empty state can be explicitly re-saved as an empty draft, though there is nothing to change from a fresh row); Publish is disabled. |
| **Working draft — invalid** | Some dropdowns set, some not, or a set combination fails a rule. Inline error appears directly under/adjacent to the specific dropdown or field the `layer`/`field` in the error response names (never only a global banner — the task’s explicit requirement). Save Draft **enabled** (assuming no `400`-level schema error is present); Publish **disabled**, with a tooltip on the disabled button summarizing why (“Fix N validation error(s) to publish”) rather than leaving it unexplained. |
| **Valid — unpublished (new draft, never published)** | Validate returns `valid: true`. Publish **enabled**. Preview shows the full resolved stack + hosting badges + `has_secret` per layer + redacted YAML. No “unpublished changes” indicator yet (there is no prior published version to diverge from) — instead a neutral “Not published yet” caption near Publish. |
| **Published, in sync** | `status: published`, draft matches the last-published version, `dirty: false`. Publish button becomes “Published” (disabled, checkmark) or hidden in favor of a `status-chip` “Published” near the header; Save Draft still available if the admin starts editing again. |
| **Published, with unpublished changes** | `status: published` but current draft is `dirty` and differs from the last published version. A visible indicator near Publish/`page-header`: `status-chip`-style “Unpublished changes” (icon `edit_note`, not color alone) — this is the explicit “diverges from last-published” signal the task calls for. Publish re-enables once valid; Save Draft always available. |
| **Validating (debounce in flight)** | Small, non-blocking “Validating…” indicator in the preview pane header (`aria-live="polite"`, coalesced — do not announce every keystroke, only the settled debounce result). Dropdowns and fields remain interactive; do not block input while validating. |
| **Save/Publish in flight** | Button shows a spinner + busy label (“Saving draft…” / “Publishing…”); both buttons disabled during the request (prevents a double-submit race that the `Idempotency-Key` alone should not have to paper over). |
| **Conflict (`409 CONFIG_CONFLICT`)** | Do **not** overwrite. Show a persistent, dismiss-only-by-action banner above the form: `"Config was modified by another user. Reload and retry."` with a primary “Reload” button. If the local draft is `dirty`, clicking Reload first opens a `confirm-dialog`: “Discard your unsaved changes and reload the latest configuration?” / “Cancel” / “Discard and reload”. Confirmed → re-fetch `GET /tenants/:id/config`, re-hydrate the store, clear the conflict banner. |
| **Save/Publish error — schema (`400`)** | Inline at the specific field (system_prompt, stt.language, etc. — §10.9). Save Draft stays available for fields that are not part of the bad payload structurally, but in practice a `400` blocks the save outright per LLD §5.5 (“malformed is never stored”) — so the button re-enables after the error is shown, not silently retried. |
| **Save/Publish error — combination (`422`)** | Same inline-at-layer treatment as the live validate errors (§10.3 “Working draft — invalid”); this is the same rule set surfacing at save time instead of debounce time (LLD: “same rules, no drift”). |
| **Network / 5xx** | Form-level banner: “Could not save this configuration. Check your connection and try again.” Retry keeps the draft intact (never clears the form on a transport failure). |

### 10.4 Information architecture

- Page-header title: “{Tenant name} · Agent Builder”. Secondary actions: “Manage provider credentials” (→ §9.9) and “Back to deployments”.
- Layout, **≥1280 px:** two-column — left column is the scrollable form (dropdowns + fields sub-form, §10.1), right column is a **sticky** preview pane (resolved stack list with hosting badges + `has_secret`, redacted YAML dump in a `yaml-viewer`).
- Layout, **<1280 px:** single column, `mat-tab-group` with two tabs “Configuration” and “Preview” (the two panes are too dense to usefully stack indefinitely on a phone). The Preview tab shows a small error-count badge when the form tab is active and there are unresolved errors, so switching tabs isn’t the only way to notice a problem.
- Not in the sidebar (§1.5); reached only through Deployments.

### 10.5 Dropdown sourcing and the provider/credential relationship (new pattern — not covered by an existing primitive)

Each of the seven layer dropdowns (transport, stt, llm.primary, llm.fallback, tts, avatar, agent.runtime — note `agent.runtime` is not provider-backed, it is a fixed two-option enum) lists **catalog providers** for that category, each option showing its `hosting-badge`:

- A provider **without** any tenant `ProviderCredential` row is shown but **disabled/grayed**, with a trailing helper “No credential configured” and an inline “Add credential” link that opens §9.9’s create dialog in a new tab/route (preserve the Builder draft — do not navigate away and lose in-progress edits; open Provider Registry as a secondary route or dialog, per implementation preference, but do not discard unsaved Builder state to get there).
- A provider **with exactly one** tenant credential is selectable directly; selecting it sets both `provider` and `credential_ref` in the draft.
- A provider **with more than one** tenant credential (distinguished by `display_label`) reveals a second, compact “Credential” dropdown beneath the layer dropdown, populated with those rows’ labels (or truncated endpoint if unlabeled). *(This sub-case is not disambiguated by the spec, which describes one `credential_ref` per layer without addressing multiple credentials per provider — flagged as an open item below.)*
- `llm.fallback` additionally has a “None” option (fallback is optional, FR-CONFIG-2/LLD §642 “empty fallback is allowed, primary-only”).

### 10.6 Fields sub-form (compact area, in-scope fields only — §10.1)

| Field | Control | Constraints | Notes |
|---|---|---|---|
| STT language | Text input | BCP-47, default `en-US` | Helper: “e.g. en-US, fr-FR”. Client regex hint, not a full BCP-47 validator; server is authoritative (`CONFIG_LANGUAGE_INVALID`). |
| STT model | Text input, optional | — | Placeholder “Provider default”. |
| LLM primary model | Text input | Required | `CONFIG_MODEL_REQUIRED` maps here. |
| LLM fallback model | Text input | Required only if a fallback provider is selected | Hidden entirely when fallback provider is “None”. |
| TTS voice_id | Text input | Required | `CONFIG_VOICE_REQUIRED`. |
| Avatar avatar_id | Text input | Required | `CONFIG_AVATAR_ID_REQUIRED`. |
| Agent runtime | `mat-select`, 2 options | `langgraph` \| `pydantic-ai` | Plain enum, no provider/credential relationship. |
| System prompt | Large `textarea` (multi-row, resizable) | Max 32 KiB (32,768 **bytes**, not characters) | Live counter “{n} / 32,768 bytes” using `TextEncoder().encode(value).length` (a naive `.length` undercounts multi-byte characters and would let a prompt through the client check that the server then rejects) — counter turns error-colored + icon at/over the limit, and blocks further typing past the limit is **not** required (let the server be the hard stop; the counter is guidance, per “aesthetic & minimalist” — don’t build two independent enforcement paths that could drift). |
| Memory enabled | `mat-slide-toggle` | — | Reveals “Window (turns)” below when on. |
| Memory window_turns | Number input | 1–64, shown only when memory enabled | Default 16. |
| RAG enabled | `mat-slide-toggle` | — | Reveals “Index reference” below when on. |
| RAG index_ref | Text input, required when RAG enabled | — | `CONFIG_RAG_INDEX_REQUIRED`. |
| Residency (read-only) | Plain text line, not an input | — | “Residency: {send_to_remote_llm value}” + inert “Manage in Residency” link (§10.1). |
| Tools (read-only) | Plain text line, not an input | — | “{n} tools enabled” (§10.1) — no edit affordance yet. |

### 10.7 Accessibility (beyond §1.2)

- Every dropdown’s inline error is linked via `aria-describedby`, exactly like a standard field error (§1.2) — this is not a new pattern, just applied per-layer instead of once per form.
- The preview pane’s summary text (“3 errors” / “Valid configuration” / “Not configured yet”) sits in a small `aria-live="polite"` region; the full redacted YAML dump (`yaml-viewer`, a `<pre>`) is **not** part of that live region — re-announcing the entire YAML on every debounce tick would be unusable with a screen reader. Give the `<pre>` an `aria-label="Redacted configuration YAML"` instead.
- System-prompt byte counter is `aria-live="polite"`, coalesced (announce on blur or on crossing the limit threshold, not on every keystroke).
- “Unpublished changes” indicator and the disabled-Publish tooltip are both text, not color alone.
- Conflict banner and its Reload confirm-dialog follow the same `role="alert"` / APG dialog pattern as §5’s `TENANT_CONFLICT` handling — reuse, don’t reinvent.
- Tab layout (<1280 px, §10.4): standard APG tabs (Material’s `mat-tab-group` already implements this) — arrow-key navigation between “Configuration”/“Preview”.

### 10.8 Relevant heuristics

- **Visibility of system status:** debounced “Validating…”, dirty/“Unpublished changes” indicator, distinct Save-Draft-vs-Publish affordances so the admin always knows which state their edits are actually in.
- **Error prevention:** Publish is structurally impossible while invalid (disabled, not just discouraged); route-leave guard on unsaved changes; conflict flow never silently overwrites a concurrent edit.
- **User control & freedom:** Save Draft is independent of Publish — an admin can checkpoint incomplete work without being forced to either finish or lose it; Reload-on-conflict is opt-in via confirm, not automatic.
- **Consistency & standards:** identical dropdown/error/hosting-badge pattern across all seven layers; identical conflict-handling pattern to §5’s Rename dialog.
- **Recognition over recall:** hosting badges and hover/tooltip endpoint details on every option remove the need to remember which provider is self-hosted vs. remote, or which endpoint a credential points to.
- **Help & documentation:** the disabled-Publish tooltip and the no-credential dropdown helper both tell the admin the *next concrete action*, not just that something is wrong.

### 10.9 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `CONFIG_INCOMPLETE` | 422 | `Select a provider for {layer}.` | Inline under that layer’s dropdown |
| `CONFIG_TRANSPORT_UNSUPPORTED` | 422 | `v1 supports only LiveKit as transport.` | Transport dropdown (should be unreachable given the fixed single option — defensive only) |
| `CONFIG_PROVIDER_DISABLED` | 422 | `{key} is disabled on this platform.` | That layer’s dropdown |
| `CONFIG_CREDENTIAL_MISSING` | 422 | `Add an endpoint and credential ref for {key} in Provider Registry.` | That layer’s dropdown, with an inline “Add credential” link to §9.9 |
| `CONFIG_FALLBACK_IDENTICAL` | 422 | `Fallback LLM must differ from the primary provider or model.` | LLM fallback dropdown/model field |
| `CONFIG_RESIDENCY_BLOCKS_LLM` | 422 | `Residency policy 'none' cannot be used with a remote LLM. Choose prompt_text_only or an on-prem LLM (not available in v1).` | LLM primary dropdown, referencing the read-only Residency line (§10.6) |
| `CONFIG_LANGUAGE_INVALID` | 400 | `stt.language must be a BCP-47 tag (e.g. en-US).` | STT language field |
| `CONFIG_MODEL_REQUIRED` | 400 | `llm.primary.model is required.` | LLM primary model field |
| `CONFIG_VOICE_REQUIRED` | 400 | Contract map sentence (spec names the code without full prose beyond “empty”) — display `error.message` verbatim from the envelope. | TTS voice_id field |
| `CONFIG_AVATAR_ID_REQUIRED` | 400 | Contract map sentence, same convention as above. | Avatar avatar_id field |
| `CONFIG_PROMPT_TOO_LARGE` | 400 | `system_prompt must be at most 32768 bytes.` | System prompt field (also pre-empted by the live byte counter, §10.6) |
| `CONFIG_RAG_INDEX_REQUIRED` | 400 | `rag.index_ref is required when RAG is enabled.` | RAG index reference field |
| `CONFIG_RETRY_INVALID` / `CONFIG_RETENTION_INVALID` | 400 | Contract map sentence. | Should be unreachable from this screen’s own inputs (§10.1 defers these fields) — if seen, generic form-level banner, since there is no in-scope field to attach them to. |
| `CONFIG_SECRET_IN_YAML` | 400 | `Remove secrets from YAML. Use credential_ref fields only.` | Unreachable from the structured form (§10.1) — generic banner if ever seen. |
| `CONFIG_YAML_PARSE` / `CONFIG_YAML_UNKNOWN_KEY` / `CONFIG_VERSION_UNSUPPORTED` | 400 | Contract map sentence. | Unreachable in this UI (§10.1, no raw-YAML edit mode) — generic banner if ever seen. |
| `CONFIG_CONFLICT` | 409 | `Config was modified by another user. Reload and retry.` | Persistent banner + Reload flow (§10.3) |
| `TENANT_FORBIDDEN` | 403 | `You are not assigned to this tenant.` | Snackbar |
| `TENANT_NOT_FOUND` | 404 | `Tenant not found.` | Redirect to Deployments + snackbar (§5.7 pattern) |

### 10.10 Open decisions flagged for `nexus-dev` (see also §8.1)

- Multiple `ProviderCredential` rows per provider per tenant (§10.5) is this document’s own resolution, not a spec-defined UX — confirm the two-level dropdown is acceptable, or simplify by disallowing more than one credential per (tenant, provider) pair at the Provider Registry layer instead (which would remove the need for it entirely). That constraint does not currently exist (`PROVIDER_CREDENTIAL_EXISTS` only fires on duplicate `display_label`, not on a bare duplicate provider).
- `agent.tools[]` has no assigned screen (§10.1) — flag to product/architecture before a later phase needs full tool CRUD; Screen 2’s read-only count is a stopgap, not a design for that surface.
- The Residency read-only line and “Manage in Residency” inert link (§10.1) will need to become a real link once Screen 8 exists — no code change should be required beyond removing the `aria-disabled`/tooltip, provided Screen 8’s route matches the `/admin/tenants/:id/residency` shape already reserved in §1.7.

---

## 11. Phase 3 — Conversation SPA: Pre-call, Screen 9 (`FR-CALL-1`, `NFR-4`, `NFR-6`)

**Surface:** Conversation client (§1.1) — a **new, distinct** default design language from every other screen in this document so far. No accounts, no admin JWT, no sidenav. Optimized for a first-time visitor arriving from a shared link, frequently on a phone.

This supersedes §6 for Screen 9. §6's one-line placeholder no longer describes what ships.

### 11.1 Scope, routes, and the invented decisions this section is built on

- Angular route: `/c/:slug` (Screen 9). See §8.1's Phase 3 table for why this shape was chosen (authored, not spec-mandated).
- No login, no `AuthStore`. A lightweight, session-scoped `CallSessionStore` (parallel concept to the admin SPA's `AuthStore`, but holding call state — display name, mic/cam permission state, preflight result, issued LiveKit tokens — never persisted to `localStorage`, since a LiveKit token is a bearer credential with its own short TTL and should not outlive the tab).
- Camera is optional and defaults to **off** — an authored decision (§8.1 Phase 3 table); the spec's hard requirement is mic-only.
- Avatar preview: today **always** the platform placeholder (§8.1 Phase 3 table) since no v1 avatar adapter exists. Design the "real preview" path (image or muted looping video from `preview_url`) so the placeholder swaps cleanly later, but do not build UI polish for the real path beyond that swap point.

### 11.2 User flow

1. **Enter:** end user opens `/c/{slug}` from a link (no prior page in this SPA — this route is always a fresh landing).
2. On load, in parallel:
   - Browser-support feature detection (§8.1 Phase 3 table) — if it fails, short-circuit straight to the **browser-unsupported** dead-end state (§11.3) and do not run permission or preflight checks at all (no point asking for a mic the browser cannot use for a call).
   - `GET /public/deployments/{slug}/preflight` (LiveKit reachability + config completeness).
3. User sees the pre-call card: avatar preview (placeholder, §11.1), an optional display-name input (1–40 chars, defaults to "Guest" if left blank), a primary "Join call" button, and — once the mic permission has not yet been resolved — a short explanatory line before the browser's native permission prompt fires ("We'll ask for microphone access to start the call.") so the OS-level prompt doesn't ambush the user with no context (heuristic: help users recognize what's happening before it happens, not just after).
4. User optionally types a display name. Client-trims and caps at 40 chars; no validation error is ever shown for this field — it just clamps silently (an empty or over-limit input is not a mistake worth surfacing as an error on an unauthenticated, low-stakes field).
5. User optionally toggles "Turn on camera" (off by default, §11.1) — this requests camera permission separately from mic and is never blocking; if denied, camera silently stays off with no error state (it is optional, so a denial is not a failure of the flow, only mic denial is).
6. User taps "Join call" (or it is reachable via keyboard: Enter with focus anywhere in the card, since this is the sole primary action on the page).
7. Mic permission is requested at this point (not on page load) — asking a stranger for microphone access before they have expressed any intent to join is a dark-pattern-adjacent surprise; request it only on the explicit "Join call" tap.
   - Granted → proceed to step 8.
   - Denied → mic-denied error state (§11.3). Stay on Screen 9. No token issued.
8. If preflight (step 2) has not resolved yet, "Join call" shows a brief "Checking connection…" busy state rather than blocking the button before the user acts — do not run preflight as a silent background gate the user can't see progress on.
   - Preflight transport failure → error state (§11.3). No token.
   - Config incomplete / tenant paused → error state (§11.3). No token.
9. All checks pass → `POST /public/sessions` issues LiveKit tokens. Button shows "Joining…" busy state.
10. Success → navigate to `/c/:slug/call` (Screen 10), passing tokens + display name via Angular router state (not the URL — §8.1 Phase 3 table).
11. **Exit:** only forward, to Screen 10, on success. There is no "back" from Screen 9 except closing the tab (this is the SPA's entry point).

### 11.3 Screen / component states

| State | Behavior |
|---|---|
| **Browser-unsupported (dead end)** | Full-card replacement, no form at all: heading "This browser can't run a live call", body (verbatim) `"This browser cannot run a live video call. Use the latest Chrome, Edge, Firefox, or Safari."`, code `CALL_BROWSER_UNSUPPORTED`. No retry button (retrying won't change the browser) — the only actionable guidance is the sentence itself. |
| **Loading preflight (background)** | Not a blocking full-page spinner — the card renders immediately with the avatar preview, name input, and Join button available to interact with while `GET …/preflight` resolves quietly behind it. |
| **Mic-permission-prompt** | Transient — the moment between the "Join call" tap and the browser's native permission dialog resolving. Join button shows a busy label "Requesting microphone…"; the rest of the card stays visible (not hidden), since the native browser prompt already draws full attention. |
| **Mic-denied-error** | Card stays exactly as before (name, camera toggle, preview) with a `role="alert"` banner above the Join button: `"Microphone access is required to start. Allow the microphone in your browser and retry."` / `CALL_MIC_DENIED`. Join button remains present and re-triggers the permission request (most browsers re-prompt; if the browser has permanently blocked it, the same request will silently no-op and the identical error will show again — this is acceptable, since there's no reliable cross-browser way to detect "permanently blocked" vs "not yet asked"). No token issued. |
| **Preflight-error — transport** | Same card-stays pattern. Alert: `"Cannot reach the media server. Check your network or try again."` / `TRANSPORT_UNAVAILABLE`. "Join call" becomes "Retry" in-place (re-runs preflight, does not re-request mic permission if already granted). |
| **Preflight-error — config incomplete** | Alert: `"This assistant is not available right now."` / `CONFIG_INCOMPLETE`. Because this condition won't self-resolve from the user's side, do **not** offer a "Retry" that implies it might — show the sentence with no retry action, only the same passive page (a user closing and reopening the link later is the only realistic recovery, and that's implicit, not a button). |
| **Preflight-error — tenant paused** | Identical treatment and copy to config-incomplete (`"This assistant is not available right now."` / `TENANT_PAUSED`) — the spec intentionally gives these two distinct codes the same user-facing sentence, so the UI must not invent a way to tell them apart visually; that is the point of using one sentence for both. |
| **Avatar-preview-loaded** | Placeholder card (§11.1) — no loading spinner needed since it's a static asset bundled with the SPA, not a network fetch in this phase. |
| **Ready-to-join** | All of: browser supported, preflight resolved OK. Join button enabled. This does **not** require mic permission yet (that's requested on tap, not a precondition to enabling the button) — do not gray out Join while waiting on a permission the user hasn't been asked for. |
| **Joining / issuing token** | Button busy label "Joining…", disabled to prevent double-submit, name input and camera toggle become read-only (not removed) so screen-reader context isn't lost mid-submit (same convention as the admin SPA's submitting-form pattern, §2.2). |
| **Success** | Immediate navigation — no interstitial "You're in!" screen; Screen 10 itself is the confirmation via its connecting state. |

### 11.4 Information architecture

- No nav, no chrome, no shell. This is the entire page.
- Browser title: `Join call · Avatar Platform` (or the tenant's display name if the preflight response carries one — fall back to the generic title, do not block render waiting for a tenant name just for the `<title>`).
- Nothing is "adjacent" — this is a single-purpose landing page, not a section of a larger IA.

### 11.5 Accessibility (beyond §1.2)

- Hit targets ≥ 48×48 CSS px on this screen (§1.2's conversation-SPA note, now realized) for Join call, the camera toggle, and any icon buttons — larger than the admin SPA's 40×40, since this is a touch-first, one-handed context.
- Display-name input has a visible `<label>` "Your name (optional)" — not a placeholder-as-label. `maxlength="40"` with no visible counter needed (40 is a comfortable typing length; a counter would be clutter on a page this simple).
- The pre-permission explanatory line (§11.2 step 3) exists specifically so a screen-reader user is told *why* a browser permission dialog is about to interrupt them — this is new territory the admin SPA baseline doesn't cover (no screen there ever triggers an OS-level permission prompt).
- All error banners are `role="alert"`, matching the admin SPA convention (§1.6) — reused, not reinvented.
- The camera-off default state is announced as a toggle's normal unchecked state, not as an error or missing-feature state — a screen-reader user should hear "Turn on camera, not pressed," ordinary toggle semantics, not a warning.
- Focus order: name input → camera toggle → Join call. On the browser-unsupported dead end, focus lands on the heading on load (same convention as §3.4's invalid-invite empty-state) since there is no form to focus into.

### 11.6 Relevant heuristics

- **Help users recognize/diagnose/recover from errors:** every error state (mic denied, transport, config, paused) uses the spec's exact sentence and is scoped to a Screen 9 the user is still standing on — no dead-ending into a blank page.
- **Visibility of system status:** preflight runs visibly in the background rather than as an invisible gate; Join/Joining/Requesting-microphone are distinct busy labels, not one generic spinner.
- **Error prevention:** mic permission is requested only on explicit intent (Join tap), not preemptively on page load, avoiding an unprompted, confusing OS dialog.
- **Match between system and the real world:** "This assistant is not available right now." is deliberately vague for both config-incomplete and paused-tenant — the real world here is "an end user browsing a public link should never learn operational/billing details about a tenant's backend."

### 11.7 Responsive

- **Phone (primary target, `< 768`):** single column, full-viewport-height card, avatar preview sized to roughly the top third, name input and Join button in the bottom third within comfortable one-handed thumb reach (matches the mobile control-placement guidance carried into §12.7 for Screen 10 — this screen is the same physical context: one hand, portrait, holding the phone to their face).
- **Tablet/desktop (`≥ 768`):** centered card, max-width ~480px, same vertical order (preview → name → camera toggle → Join) — do not introduce a side-by-side layout; there's nothing to put beside the card.

### 11.8 Error / validation messaging (authoritative)

| Code | UI sentence (verbatim) | Placement |
|---|---|---|
| `CALL_MIC_DENIED` | `Microphone access is required to start. Allow the microphone in your browser and retry.` | Alert above Join button; stay on screen |
| `TRANSPORT_UNAVAILABLE` | `Cannot reach the media server. Check your network or try again.` | Alert above Join button; Join becomes Retry |
| `CONFIG_INCOMPLETE` | `This assistant is not available right now.` | Alert; no retry action |
| `TENANT_PAUSED` | `This assistant is not available right now.` | Alert; no retry action (identical to CONFIG_INCOMPLETE by design) |
| `CALL_BROWSER_UNSUPPORTED` | `This browser cannot run a live video call. Use the latest Chrome, Edge, Firefox, or Safari.` | Full dead-end state, no form |

---

## 12. Phase 3 — Conversation SPA: Live Conversation, Screen 10 (`FR-CALL-2`, `NFR-4`, `NFR-6`)

**Surface:** Conversation client (§1.1). Reached only from a successful Screen 9 join (§11.2 step 10) — this screen has no other entry point and redirects back to Screen 9 if reloaded directly with no in-memory session state (§8.1 Phase 3 table).

### 12.1 User flow

1. **Enter:** navigation from Screen 9 with LiveKit tokens/URL and display name already in hand (no further server round trip needed to *start* connecting — the LiveKit JS SDK begins its own room connection immediately on mount).
2. Screen renders the call stage: avatar video area (primary surface, full-bleed on phone), a control bar (mute/unmute, camera toggle if it was turned on in Screen 9, end-call), and a mic-level indicator.
3. LiveKit SDK connects to the room. While connecting, the avatar area shows a **connecting** state (§12.2), not a blank screen.
4. Once connected, if no agent avatar video track has arrived within 15s of the agent joining (today: **always**, since no agent process exists yet in this phase — §12.2's "connected, waiting for avatar" state, worded as ongoing progress, not failure), a persistent-but-calm banner shows over/near the video area. It does **not** auto-leave the call and does **not** block the mute/end-call controls.
5. User can mute/unmute at any time (stops/resumes publishing the local audio track — real, working control this phase, even though there's no STT downstream yet to observably react to it).
6. User can end the call at any time via the end-call control → LiveKit disconnect → `POST /public/sessions/{id}/end` (issues `summary_token`, 30 min TTL) → navigate to `/c/:slug/summary/:summary_token` (Screen 11, §18 — this superseded the old placeholder terminal state as of Phase 7).
7. If the connection drops mid-call, the SDK's own reconnect logic runs silently for up to 30s (§12.2 "reconnecting"); if it doesn't recover in that window, `CALL_RECONNECT_FAILED` fires and the user is moved back to Screen 9 (a **new** session, not a resume — the old tokens are discarded).
8. **Exit:** end-call (deliberate, §12.1 step 6) or reconnect-failure redirect (involuntary, §12.1 step 7) — the two are visually and behaviorally distinct (§8.1 Phase 3 table: they are not the same event to the user).

### 12.2 Screen / component states

| State | Behavior |
|---|---|
| **Connecting** | Video area shows a centered spinner + "Connecting…" over a neutral dark canvas (not the avatar placeholder image — that would falsely imply an avatar is already present). Controls (mute/end-call) are visible but disabled until the local participant has actually joined the room (muting a connection that doesn't exist yet is meaningless and would confuse state). |
| **Connected, waiting for avatar (0–15s, and the ongoing state after)** | Video area shows the same placeholder-style neutral surface (a decorative but static state, not a spinner-forever, since this could be indefinite in this phase) with a small, calm, non-modal banner: **"Still connecting you to your avatar…"** (authored — §8.1 Phase 3 table) using an info tone (not error/warning color), `aria-live="polite"` (announced once, not repeated). Mute/end-call remain fully live. This is the expected, common state in this phase — it must not read as broken. |
| **Connected, avatar video present** | Full-bleed video, controls overlaid at the bottom (phone) or in a fixed bar (desktop). The waiting banner disappears the moment a track actually arrives. |
| **Muted** | Mic icon shows the muted glyph (icon + label, not color alone, per baseline). Local audio track unpublished. Mic-level indicator goes to a flat/zero visual state (still present, just showing no input, so the user isn't confused about whether the meter itself is broken). |
| **Unmuted** | Default. Mic-level indicator animates with actual input level. |
| **Camera on/off** (if the user opted in on Screen 9, §11.1) | Small self-view thumbnail (picture-in-picture style, corner of the video area) when on; toggle hides it and unpublishes the local video track when off. Off is the default and requires no explanation UI of its own (it's simply the resting toggle state). |
| **Reconnecting** | LiveKit SDK-driven; UI shows a non-dismissible banner "Reconnecting…" (info tone) over the last-known video frame (not a blank screen — avoids implying the call ended when it might still recover) with the control bar still visible but mute/camera temporarily disabled (there is nothing to (un)publish to mid-reconnect) while end-call remains available (the user must always be able to leave, even mid-reconnect — user control & freedom). |
| **Reconnect-failed → redirect** | At 30s: full-screen takeover message (brief, ~2s display or until the user acknowledges — since this is a forced transition, not a dead end): `"Connection lost. Return to the start screen to rejoin."` / `CALL_RECONNECT_FAILED`, then automatic navigation to `/c/:slug` (Screen 9, a fresh session). If the user is looking at the phone this reads as an explanation before the screen changes under them, rather than a silent, disorienting jump cut. |
| **Ending (deliberate)** | End-call tap → button shows a brief busy state ("Ending call…") → LiveKit `room.disconnect()` → `POST /public/sessions/{id}/end` → navigate to `/c/:slug/summary/:summary_token` (Screen 11, §18). Always available, even mid-error/mid-reconnect (user control & freedom is never suspended by another in-flight state). |
| **Ended → Screen 11 (superseded, Phase 7)** | *(Was an authored placeholder through Phase 3/6 — §8.1 Phase 3 table. As of Phase 7 this row is superseded: see §18 for the real post-call summary screen.)* If `POST …/end` itself fails (network/5xx) before navigation, retry the call once automatically, then fall back to the same "You've left the call" / "Thanks for calling in." / "Start a new call" copy as a **local-only** dead end (no `summary_token` was issued, so there is nothing to show) — this is the one place the old Phase 3 stopgap copy is intentionally retained, now scoped narrowly to "the end-call network call itself failed," not to "Screen 11 doesn't exist." |

### 12.3 Information architecture

- No nav, no chrome. Full-viewport call surface.
- Browser title while on this screen: `Live call · Avatar Platform`.
- No "adjacent" screens — Screen 9 (backward, only via redirect) and Screen 11 (forward, only via end-call, §18) are the only two neighbors, and neither is a navigable link the user can reach except through the flows in §12.1.
- FR-CALL-3 (live captions, out of scope this phase) reserves a place in the control bar: leave a stable slot/anchor point for a future captions toggle icon next to mute, so Phase 4's addition doesn't require reflowing the whole bar — do not fill that slot with anything else in this phase.

### 12.4 Mute/end-call control layout and hit targets

- Both controls are ≥ 48×48 CSS px (§1.2's conversation-SPA note), exceeding the 24×24 NFR-4 floor by a comfortable margin given touch-first, one-handed use.
- **Phone (portrait, primary target):** control bar pinned to the **bottom** of the viewport, thumb-reachable in one-handed hold — mute (left-of-center), end-call (center, visually distinct as the "stop" action — larger and in `--la-error`, since it's the one irreversible-feeling action on this screen), camera toggle (right-of-center, only rendered if the user opted in on Screen 9). This ordering keeps the destructive/exit action in the natural center-thumb position on a phone held to the ear/face, while mute (the control used most often, mid-call) sits slightly off-center rather than buried in a corner.
- **Desktop:** same relative order, centered horizontally in a fixed bottom bar rather than floating over the video, since there's no thumb-reach constraint to satisfy but consistency with the phone layout still matters (a user's mental model of "mute is left of end-call" shouldn't flip between devices).
- Mic-level indicator sits adjacent to (not on top of) the mute button — a ring or small bar around/beside the mute icon, so it's readable at a glance without requiring the user to interpret a separate, disconnected meter.
- End-call is **not** behind a confirm dialog — unlike the admin SPA's destructive-action pattern (§5's pause confirm), ending a call is not data-destructive and the cost of a mis-tap is low (rejoin is one tap away on Screen 9); adding a confirm step here would fight the "user control & freedom" heuristic more than serve error prevention. This deliberately diverges from §1.6/§5's admin-destructive-action convention — flagged as an intentional Screen-10-specific exception, not an oversight.

### 12.5 Accessibility (beyond §1.2)

- **Live status changes are announced, not just shown:** connecting → connected → waiting-for-avatar → avatar-present → reconnecting → ended each update a single `aria-live="polite"` status region (visually hidden or a small text line near the controls) so a screen-reader user tracks the call's state without needing to interpret the video canvas at all. This is new territory beyond the admin SPA baseline — no earlier screen has a continuously live-updating state machine like this.
- **A deaf/hard-of-hearing user needs a visual signal that their own mic is live**, not just an audio cue they can't perceive: the mic-level indicator (§12.4) and the mute/unmute icon+label together serve this — the meter's visible motion is the "your mic is picking up sound" signal, and it must not be purely decorative or hidden.
- **A user cannot hear the "still connecting" banner's tone-of-voice**, so its calm framing has to be carried entirely in the text and icon (an info icon, not a warning/error icon) — do not rely on any audio cue (like a chime) to convey "this is normal, not broken."
- Mute/end-call/camera icon-buttons each have a visible text label alongside the icon at this hit-target size (space allows it, unlike a cramped toolbar) — not icon-only, consistent with baseline's "status is never icon-alone" principle extended to controls here.
- Video element itself: `aria-label` "Avatar video" on the `<video>` so a screen-reader user knows what's rendering even though the content itself isn't accessible in any textual form (there is no meaningful alt-text substitute for a live video stream — the state-region above is the actual accessible surface, not the video element).
- Reserve `prefers-reduced-motion` handling for the mic-level meter and any connecting/reconnecting spinner — reduce to a static/low-motion equivalent rather than a constantly animating meter, per baseline §1.2.

### 12.6 Relevant heuristics

- **Visibility of system status, carried to its limit:** this screen has more live, moment-to-moment state than anything else in the product — connecting/connected/waiting/reconnecting/ended each need their own clear signal, both visual and to assistive tech (§12.5).
- **User control & freedom:** end-call is always available, never confirm-gated, never disabled by another in-flight state (§12.4) — the one guarantee this screen makes no matter what else is happening.
- **Error recovery, reframed as normal:** the waiting-for-avatar banner (§12.2) is written so today's near-100%-occurrence case doesn't read as a recurring failure — this is a deliberate departure from how the admin SPA frames errors (which are true error conditions); here the "error" code (`CALL_RECONNECT_FAILED`) is the only state that gets error-toned copy, and the waiting-for-avatar banner is not an error code at all, just a status.
- **Consistency & standards:** mute is left, end-call is center, on both phone and desktop (§12.4) — a control never moves position based on viewport.

### 12.7 Responsive

- **Phone (primary target, portrait, one-handed):** full-bleed video, bottom-pinned control bar within thumb reach (§12.4), status banners overlaid near the top of the video (out of the way of the controls, above the fold), self-view camera thumbnail in the top corner (out of the thumb-reach zone, since it's glanced at rather than interacted with).
- **Tablet/desktop:** video area fills the available viewport minus a slim fixed bottom control bar; no side panels or split layout (there is nothing else to show yet — captions, when built in Phase 4, are the first candidate for an optional side/overlay panel, not this phase's concern).
- Landscape phone: not specially optimized this phase (the spec's persona is a portrait, one-handed caller) — the layout should not visibly break in landscape, but no bespoke landscape design is authored here.

### 12.8 Error / validation messaging (authoritative)

| Code | UI sentence (verbatim) | Placement |
|---|---|---|
| `CALL_RECONNECT_FAILED` | `Connection lost. Return to the start screen to rejoin.` | Full-screen takeover message, then automatic redirect to Screen 9 (§12.2) |

No other spec error code applies to Screen 10 itself (the pre-call codes in §11.8 cannot occur here, since a token would not have been issued). The "no avatar track" condition (FR-AVATAR-5's client-facing banner) has no assigned `AppErrorCode` in the spec — it is deliberately not treated as an error state at all (§8.1 Phase 3 table, §12.2, §12.6).

### 12.9 Open decisions flagged for `nexus-dev` (see also §8.1)

- The exact 15s no-avatar-track timer and the 30s reconnect-failure timer are read directly from FR-CALL-2/FR-AVATAR-5 — not invented — but the **debounce/announcement cadence** for the `aria-live` status region (§12.5) is this document's own judgment call; confirm it doesn't produce excessive screen-reader chatter once real users test it.
- End-call's no-confirm-dialog decision (§12.4) intentionally diverges from the admin SPA's destructive-action convention (§1.6/§5) — flag to product if a confirm is later deemed necessary (e.g., if call minutes are billed and an accidental end-call has a cost implication the current spec doesn't mention).
- The camera toggle and self-view thumbnail (§12.2, §12.4) are entirely this document's invention, including their existence at all — see §8.1's Phase 3 table entry questioning whether end-user camera capture is even meant to happen per the spec's actual data flow.
- The terminal "Ended" placeholder (§12.2) has been superseded by §18 (Phase 7) — resolved, not still open. The narrow local-only fallback for a failed `POST …/end` call (§12.2) is this phase's own small addition, not carried over from the old stopgap's reasoning.

---

## 13. Phase 7 — Dashboard, Screen 1 (`FR-DASH-1`, `FR-DASH-2`)

**Surface:** Platform admin console / tenant application (admin template, §1.1). Top-level nav item, genuinely cross-tenant (no picker indirection — see the §1.7 routing-conflict note, which does **not** apply to this screen).

### 13.1 User flow

1. **Enter:** sidebar "Dashboard" (now live) or deep link `/admin/dashboard`. No longer the shared coming-soon state (§7, superseded for this route).
2. On load: `GET /dashboard/summary?range=24h` (default) and `GET /dashboard/provider-health` fire in parallel. `admin` JWTs are scoped server-side to assigned tenants automatically — the UI does not need to know the assignment list to get correctly-scoped numbers.
3. Time range control (`mat-button-toggle-group`, 1h / 24h / 7d, default 24h per FR-DASH-1) re-fires `GET /dashboard/summary` only — provider-health has no range parameter (it is always "latest probe"), so switching range never re-fetches the health grid.
4. **New shared component this phase — `tenant-select`:** a typeahead combobox over the existing tenant list (`GET /tenants?q=`), used identically here, on Sessions (§14), and optionally on GPU health (§15). Operator default: "All tenants" (no `tenant_id` sent). Admin: the same control, scoped to their own assigned tenants only (the `GET /tenants` call is already role-scoped, so the typeahead options are correct with no extra logic) — an admin assigned to exactly one tenant still sees the control, just with one option, rather than special-casing it away (consistency over cleverness).
5. Selecting a tenant re-fires both summary and provider-health with `tenant_id` set. Provider-health has no `tenant_id` query parameter in the LLD (`GET /dashboard/provider-health` takes none) — **flagged in §13.9**: the health grid cannot currently be scoped to one tenant; selecting a tenant filters the snapshot widgets only, and the health grid keeps a visible "All assigned tenants" caption so the mismatch is disclosed, not silently wrong.
6. User clicks a provider-health category card → navigates to `/admin/providers` (§9.2) with a `?category={key}` query parameter. Per §9's own data shape (`ProviderDefinition` catalog is always exactly 10 rows, never filtered/paginated, FR-PROVIDER-1), the catalog page does not remove rows for this — it scrolls to and highlights that category's group header instead (an addition to §9.2, noted there implicitly by this cross-reference; the click-through is "jump to," not "filter to a subset").
7. **Exit:** sidebar navigation elsewhere. No form, nothing to lose.

### 13.2 Screen / component states

| State | Behavior |
|---|---|
| **Default (has data)** | Three snapshot widgets (Active deployments, Session volume, Error rate) + the 5-category provider-health row, all populated for the selected range/tenant scope. |
| **Loading (first fetch)** | `mat-progress-bar` under `page-header`; widget cards show skeleton placeholders (not zeros — a `0` and a "still loading" look identical otherwise, which would misreport a healthy zero-traffic tenant as broken). |
| **Loading (range/tenant change)** | Progress bar only; previous widget values stay visible, dimmed (`aria-busy`), same convention as Deployments' filter-change loading (§5.2). |
| **Empty — zero tenants (operator) / zero assigned (admin)** | Per FR-DASH-1's own literal sentence, both roles show the **same** copy: `empty-state` title "No deployments yet", body `"No deployments yet. Create a tenant to see traffic."` *(This reuses one sentence for both roles rather than §5.2's precedent of two distinct role-specific empty-states — flagged in §13.9: the spec gives exactly one sentence here, unlike Screen 3's two; following the spec's literal wording takes precedence over this document's own earlier per-role split.)* Operator sees a secondary action "Go to Deployments" (not "Create deployment" inline — creation happens on Screen 3, not here). Admin sees the same body with no action (nothing for them to do from here). Not an error. |
| **Zero sessions in range, ≥1 tenant exists** | Not the empty-state above — this is a normal "quiet period." Widgets show real zeros (`0` started/ended/failed/abandoned), error rate shows "—" (not `0%`, not `NaN%` — division by zero when `started = 0` is guidance-worthy, not a false "0% errors"). |
| **Provider-health cell — green/amber/red** | `status-chip`-style card per category: `check_circle` "Healthy" (green), `warning` "Degraded" (amber, `--la-caution`), `error` "Unreachable" (red, `--la-error`) — icon + text, never color alone, per baseline. |
| **Provider-health cell — gray/unknown (none configured, or stale probe)** | `help_outline` "Unknown". If the reason is a stale probe (>5 min old per FR-DASH-2), a `title`/tooltip shows the spec's exact sentence: `"No recent health check."` If the reason is no credential configured in that category at all, tooltip reads "No provider configured for this category" (authored — no spec sentence for the "never configured" sub-case, only the "stale" one; flagged in §13.9). |
| **Error — summary fetch** | `empty-state` error variant + Retry, generic transport copy: "Could not load the dashboard. Try again." (no spec code for this fetch failure — `400 RANGE_INVALID` should be unreachable since the UI only ever sends the three valid enum values from the toggle group). |
| **Error — provider-health fetch** | Independent of the summary widgets (two separate requests) — if only this one fails, the snapshot widgets still render normally and only the health-grid area shows its own inline `empty-state` error + Retry, not a full-page failure. |

### 13.3 Information architecture

- Nav label / `h1`: **Dashboard**. First live item in the sidebar, sits above Deployments.
- No secondary top-level action (this is a read-only snapshot). The `tenant-select` control and range toggle live in the `page-header`'s filter row, same visual slot Deployments (§5) uses for its search/status filters.
- Adjacent: Provider Registry (one hop from each health-category card, §13.1 step 6); Deployments (one hop from the zero-tenant empty-state's "Go to Deployments" action).

### 13.4 Accessibility (beyond §1.2)

- Range toggle: `mat-button-toggle-group` already exposes correct `role="group"`/`aria-pressed` semantics — label the group "Time range".
- Widget numbers are plain text, not chart-only — a screen reader gets "Active deployments: 12", not a bare SVG. No charts are introduced this phase (none were asked for; three number widgets + a health grid, per FR-DASH-1/2 exactly).
- Provider-health cards: each is a single tab stop with an `aria-label` combining category + state, e.g. `aria-label="STT, healthy. View in Provider Registry."` so the click-through destination is known before activating it.
- The "—" error-rate placeholder (zero-started case) has a `title`/`aria-label` "No sessions started in this range" so it doesn't read as a bare dash to assistive tech.

### 13.5 Relevant heuristics

- **Visibility of system status:** skeleton loading (not false zeros); independent failure of the two fetches so one bad request doesn't blank the whole page; stale-probe tooltip explains *why* a cell is gray instead of leaving it ambiguous.
- **Match between system and the real world:** "—" for an undefined error rate, not a misleading `0%` or `NaN%`.
- **Recognition over recall:** the health grid's click-through takes the operator straight to the relevant Provider Registry category rather than making them re-find it by memory.

### 13.6 Responsive

- **Desktop (≥1280):** three snapshot widgets in a row, provider-health row of 5 cards beneath.
- **Tablet:** widgets wrap to a 2-column grid; health cards wrap to a 2–3 per row grid.
- **Phone:** everything stacks single-column; range toggle becomes a `mat-select` (same phone convention as Deployments' status filter, §1.4) to avoid five cramped segmented buttons on a narrow screen.

### 13.7 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `RANGE_INVALID` | 400 | Should be unreachable (UI only sends `1h`/`24h`/`7d`) — if seen, generic: "Could not load the dashboard. Try again." | Widget-area error state |

### 13.8 Component reuse note

New shared primitive introduced this phase: **`tenant-select`** (typeahead over `GET /tenants?q=`), added to `projects/shared/ui` alongside the existing `status-chip`/`page-header`/`empty-state`/`confirm-dialog` (§1.3) — reused verbatim on Sessions (§14) and, where a tenant filter is offered, GPU health (§15). Do not build three separate tenant pickers.

### 13.9 Open decisions flagged for `nexus-dev`

- **Provider-health has no per-tenant scoping in the LLD** (`GET /dashboard/provider-health` takes no `tenant_id`) even though the summary widgets do. This document's resolution: selecting a tenant in `tenant-select` filters only the three summary widgets; the health grid stays aggregate-across-assigned-tenants with a visible "All assigned tenants" caption so this isn't silently misleading. Confirm with backend whether `provider-health` should gain a `tenant_id` filter in a later pass, or whether this aggregate-only shape is intentional (a single credential's health is arguably tenant-agnostic in some deployments, tenant-specific in others, depending on whether credentials are shared).
- **One empty-state sentence for both roles** (§13.2) deliberately follows the spec's literal single sentence rather than this document's own §5.2 precedent of splitting operator/admin copy — flagged as a conscious departure from an established pattern, not an oversight.
- **"Never configured" vs. "stale probe" gray-cell tooltip text** — only the stale-probe sentence is in the spec; the "never configured" sentence is authored placeholder copy, same caveat class as §9's `PROVIDER_PROBE_RATE_LIMITED`/`PROVIDER_CREDENTIAL_EXISTS` (§8.1) — confirm before shipping.
- **Provider Registry "jump to category" behavior** (§13.1 step 6) is this document's own resolution for how a "filtered by category" click-through can work against a catalog that FR-PROVIDER-1 guarantees is never actually filtered/paginated — implemented as scroll-to-and-highlight the existing group header (§9.2), not a new filtering capability on that screen.

---

## 14. Phase 7 — Session logs / transcripts, Screen 5 (`FR-SESS-1`, `-2`, `-3`)

**Surface:** Platform admin console / tenant application (admin template, §1.1). Top-level nav item, genuinely cross-tenant (no picker indirection).

Screen 5 is two pages: a **list** (`/admin/sessions`) and a **detail** (`/admin/sessions/:id`). Both reuse the Deployments list page's already-built filter/table/pagination pattern (§5) — this section documents only what differs, not a parallel design.

### 14.1 List — user flow

1. **Enter:** sidebar "Sessions" (now live) or deep link `/admin/sessions`.
2. Filters, all synced to the URL exactly like Deployments (§5.1 step 1): `tenant_select` (the §13.8 shared component) — **required for `admin`, optional for `operator`** per FR-SESS-1; `q` (full-text search on transcript, max 200, debounce 300ms, same pattern as Deployments' `q`); `from`/`to` date range (`mat-datepicker` pair, or a single `mat-date-range-input` — either is acceptable, both are stock Material); `status` filter (`mat-select`: All / active / ended / failed / abandoned — statuses per the `Session` status machine, LLD §8.1); pagination (`mat-paginator`, same 10/25/50/100 options as §5, default 25).
3. **`admin` with no `tenant_id` selected:** the search does not fire — the tenant filter shows required-field styling (not a submit error, since there is no explicit submit button; the empty-state area instead shows a prompt: "Choose a deployment to view its session logs." with the `tenant_select` control focused). This differs from Deployments' own filters, none of which are ever required — flagged as a deliberate, spec-mandated exception, not an inconsistency.
4. **`operator` with no `tenant_id` selected:** search fires immediately with no tenant scoping (per FR-SESS-1, `tenant_id` optional for operator) — shows sessions across all tenants, with a **Tenant** column visible (hidden for the admin case below, since it would be redundant when already scoped to one).
5. Table columns: **Session ID** (truncated UUID + `title` tooltip with the full value), **Tenant** (operator/unscoped view only — hidden once a specific tenant is selected, since every row would repeat the same value), **Started** (relative + absolute tooltip, same convention as Deployments' "Last modified", §5.2), **Duration** (`m:ss` or `h:mm:ss`, computed from `duration_ms`), **Status** (`status-chip`: `active`=`autorenew`/"Active", `ended`=`check_circle`/"Ended", `failed`=`error`/"Failed", `abandoned`=`schedule`/"Abandoned" — icon + text per baseline), **Provider stack** (compact chips or an em dash if `provider_stack` snapshot is empty, same em-dash convention as Deployments' Providers column, §5.2), **Error code** (mono `body-small` text, or em dash if null).
6. Row click → `/admin/sessions/:id` (detail). Same activation pattern as Deployments (§5.1 step 7 / §5.4): whole row is a tab stop, Enter/Space opens detail.
7. **Exit:** sidebar elsewhere, or the detail page's "Back to sessions" secondary action (preserves the list's filter/page state via the router, same convention as Agent Builder's "Back to deployments," §10.4).

### 14.2 Detail — user flow

1. **Enter:** row click from the list, or a direct deep link `/admin/sessions/:id`.
2. On load: `GET /sessions/:id` (header metadata — room name, participant identities, `recording_present`, `residency_snapshot`, `summary_status`), `GET /sessions/:id/transcript`, `GET /sessions/:id/hops` — three independent requests; a failure in one does not block the other two panels from rendering (same "independent panel failure" convention as Dashboard's two fetches, §13.2).
3. Header block: Session ID (full, selectable/copyable), Tenant (name, linking nowhere — no click-through to Deployments from here, out of scope), Room name, Participant identities (list — these are LiveKit identities, e.g. `user_{session}`, **never** tokens, per FR-SESS-2's explicit "not tokens"), a `status-chip` "Recording" / "No recording" driven by `recording_present` (v1 default: false, per spec — this is not a control, just a fact), Status chip (same as list).
4. Transcript panel: ordered list of utterances, each showing role (`user` | `assistant` — rendered as a simple two-column chat-log layout, user right-aligned or left-aligned consistently, assistant the other side — a familiar, recognizable pattern, not invented), text, and a `time` element pair (`started_at`–`ended_at`). If `transcript_purged: true` (session row exists but text is gone per FR-SESS-1's retention rule) **or** the transcript request itself returns `410 TRANSCRIPT_PURGED`, the panel shows the exact spec sentence instead of an empty transcript (§14.4).
5. Latency panel: a table, one row per `utterance_seq` (cycle), columns STT / LLM / TTS / Avatar / **e2e** (`utterance_end_to_first_motion_ms`) — each cell shows the hop's duration in `ms` when present. A hop the API omits for that cycle (FR-SESS-3: "missing hop omitted, not zero-filled") renders as an em dash with `aria-label` "Not recorded for this cycle" — **never** `0ms`, which would misreport a skipped hop as an instant one.
6. **Exit:** "Back to sessions" secondary action in the `page-header`.

### 14.3 Screen / component states

| State | Behavior |
|---|---|
| **List — default (has rows)** | Table populated; filters/pagination in the URL, same as Deployments. |
| **List — loading (first fetch)** | `mat-progress-bar`, `aria-busy`, same convention as §5.2. |
| **List — admin, no tenant chosen yet** | Not an error, not a spinner: prompt state "Choose a deployment to view its session logs." + focused `tenant_select`. Table area is not rendered at all (there is nothing valid to request yet). |
| **List — empty (valid filters, zero results)** | `{items: [], total: 0}` per FR-SESS-1 — `empty-state` title "No sessions found", body "No sessions match your filters.", action "Clear filters" (same convention as Deployments' filtered-empty state, §5.2). |
| **List — error (`SESS_RANGE_INVALID`)** | `from` > `to`: inline error under the date range control, spec sentence `"from must be before to."` — checked client-side on blur (both fields set) so this is pre-empted before the request in the common case, and re-shown identically if the server ever returns it anyway. |
| **List — error (`SESS_QUERY_TOO_LONG`)** | `q` capped at `maxlength="200"` client-side (hard stop, same convention as Deployments' 80-char search, §5.2) — `SESS_QUERY_TOO_LONG` should therefore be unreachable from this UI's own input; defensive-only. |
| **List — error (`PAGE_SIZE_INVALID`)** | Same unreachable/defensive handling as Deployments (§5.7). |
| **List — error (transport)** | `empty-state` error variant + Retry: "Could not load sessions. Try again." |
| **Detail — loading** | Three independent skeleton panels (header/transcript/latency), each with its own `mat-progress-bar`/`aria-busy` — not one page-level spinner, since the three requests resolve independently. |
| **Detail — 404 `SESSION_NOT_FOUND`** | Whole detail page replaced by `empty-state`: title "Session not found", body the spec sentence `"Session not found."`, action "Back to sessions". Applies identically to a genuinely missing id and a cross-tenant id (FR-SESS-2: same code for both — the UI must not distinguish them, exactly like §5's `TENANT_NOT_FOUND` precedent of never revealing existence across a scope boundary). |
| **Detail — transcript panel, `410 TRANSCRIPT_PURGED`** | Only the transcript panel shows this state (header + latency panels still render normally) — a calm `empty-state`-style inline block, not a page-level error: body the spec sentence `"Transcript was deleted per the retention policy."` No retry action (purge is permanent, retrying will not un-purge it). |
| **Detail — transcript panel, empty but not purged** | Session ended with zero utterances captured (e.g. immediately abandoned) — distinct copy from the purged case: "No transcript was recorded for this session." (authored, no spec sentence for this sub-case; flagged §14.9). |
| **Detail — latency panel, some hops missing** | Em-dash cells per §14.2 step 5 — never `0`. |
| **Detail — latency panel, zero cycles** | If the session never completed a single STT→…→avatar cycle, the panel shows "No utterance cycles recorded for this session." instead of an empty table shell. |
| **Detail — recording present** | `status-chip` "Recording available" — **v1 has no playback UI** (recording pipeline doesn't exist per BL-031/§17's same non-goal) — this is a factual indicator only, not a link to a player. If `recording_present` is ever true in v1 despite the stubbed pipeline, do not invent a broken "Play" button; the chip is informational only. |

### 14.4 Information architecture

- Nav label / `h1` (list): **Sessions**. Detail page `h1`: "Session {short id}" (first 8 chars + ellipsis, full id in a `title` tooltip and selectable text nearby).
- Not a child of Deployments in the same sense as Agent Builder/Alerts/Residency — Sessions is a genuinely cross-tenant top-level screen that happens to *require* a tenant filter for `admin` (a role-based input requirement, not a navigational parent/child relationship). It stays a direct sidebar destination.
- Adjacent: none from the detail page other than "Back to sessions" — no click-through to Deployments, Agent Builder, or Provider Registry from a session row (out of scope; the provider-stack snapshot is a static, historical fact about that session, not a live link to the current config, and must not be rendered as if it were one).

### 14.5 Accessibility (beyond §1.2)

- Transcript panel: `role="log"` (WAI-ARIA APG "log" pattern is the closest fit for an ordered, append-only conversational record being read after the fact) with each utterance as a list item; role (`user`/`assistant`) is announced as visible text, not color alone (e.g. a small caption "You said" / "Assistant said" rather than just left/right alignment, so a screen-reader user gets the same distinction a sighted user gets from position).
- Latency table: standard `mat-table` semantics; em-dash "not recorded" cells carry `aria-label` text (§14.2 step 5) so they don't read as blank/missing data to assistive tech.
- Admin's required-tenant prompt state (§14.3) focuses the `tenant_select` control on load, same "focus into the thing the user must act on" convention as §3.4's invalid-invite empty-state.
- Date range control: labelled "From" / "To", standard Material date-picker keyboard support (already APG-compliant via CDK).

### 14.6 Relevant heuristics

- **Error prevention:** client-side `from ≤ to` check and 200-char cap on `q` pre-empt both spec error codes before they can occur.
- **Match between system and the real world:** a purged transcript reads as "deleted per retention policy," not a generic 404/error — the user understands *why* the data is gone, and a missing/cross-tenant session id gives the identical "not found" experience either way, on purpose (no scope-boundary information leak).
- **Recognition over recall:** filters persist in the URL exactly like Deployments, so a bookmarked/shared session-log search is reproducible.

### 14.7 Responsive

- **Desktop (≥1280):** full table (list), two-column layout for detail (header spans full width; transcript and latency panels side by side below it, since both are read-only and benefit from being compared without scrolling past one to see the other).
- **Tablet:** list hides the Tenant column when a specific tenant is selected (already conditionally hidden, §14.1 step 5) and hides "Provider stack" if space is tight, same convention as Deployments hiding "Last modified" (§5.6). Detail stacks transcript above latency.
- **Phone:** list becomes stacked cards (same Deployments phone convention, §5.6): session id + status chip as the card header, started/duration/tenant as meta lines. Detail: header block, then transcript, then latency, each a full-width stacked section — the latency table degrades to one row-per-cycle as a small definition list (STT/LLM/TTS/Avatar/e2e as labeled lines) rather than a horizontally-scrolling table, since a 5-column table doesn't fit 360px meaningfully.

### 14.8 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `SESS_RANGE_INVALID` | 400 | `from must be before to.` | Inline under the date range control |
| `SESS_QUERY_TOO_LONG` | 400 | Contract map sentence (unreachable given the 200-char client cap) — if seen, generic form-level banner. | Search field, defensive only |
| `PAGE_SIZE_INVALID` | 400 | Same convention as §5.7 — unreachable, reset to 25 and retry if seen. | Snackbar |
| `SESSION_NOT_FOUND` | 404 | `Session not found.` | Full detail-page `empty-state` (§14.3) — identical for missing and cross-tenant ids |
| `TRANSCRIPT_PURGED` | 410 | `Transcript was deleted per the retention policy.` | Transcript panel only (header/latency unaffected) |

### 14.9 Open decisions flagged for `nexus-dev`

- **"No transcript recorded" (empty-but-not-purged) copy** (§14.3) is authored, not a spec sentence — the spec only defines the purged case's wording. Confirm before shipping, same caveat class as §8.1's other authored copy entries.
- **Admin's required-tenant prompt state** (§14.1 step 3, §14.3) is this document's own UI treatment of FR-SESS-1's "`tenant_id` required for admin" input rule — the spec states the validation requirement but not how the UI should present "you haven't chosen one yet" before any request is even attempted. The chosen treatment (prompt + focused control, no table shell) is designed to avoid firing an avoidable `400`/`403` just to discover the requirement.
- **No click-through from a session's provider-stack snapshot to the live Agent Builder config** is a deliberate scope boundary (§14.4), not an oversight — flag to product if a future phase wants "what does this provider stack look like today" reconciliation tooling; that would need a new, explicit design, not an implicit link that could mislead by implying the snapshot and the live config are the same thing.

---

## 15. Phase 7 — GPU / node health monitor, Screen 6 (`FR-GPU-1`, `-2`, `-3`)

**Surface:** Platform admin console / tenant application (admin template, §1.1). Top-level nav item, genuinely cross-tenant. **Strictly read-only** — no scale action of any kind exists anywhere on this screen, by explicit spec requirement (FR-GPU-1/2).

### 15.1 User flow

1. **Enter:** sidebar "GPU health" (now live) or deep link `/admin/gpu`.
2. On load: `GET /gpu/nodes` (optional `role`, `tenant_id` query params). No range selector (this is a live/current-state view, not a historical one — unlike Dashboard, there is no time-series data model for GPU nodes in the LLD).
3. Filters: **Role** (`mat-button-toggle-group` or `mat-select`: All / STT / TTS / Avatar) and **Tenant** (the §13.8 shared `tenant-select` component, optional for both roles here — GPU nodes are not owned by a single tenant the way a session or a config is, so this filter is a convenience lens, not an access-control boundary).
4. Cards render as a responsive grid (not a `mat-table` — the per-node data is compact and card-shaped, and there is no sorting/pagination need at v1's expected node counts).
5. **Exit:** sidebar elsewhere. No form, no mutation, nothing to confirm or lose — the simplest exit contract of any screen in this document.

### 15.2 Screen / component states

| State | Behavior |
|---|---|
| **Default (has nodes)** | Grid of cards, one per node: hostname (as the card title), role (`status-chip`-style label: `mic` STT / `record_voice_over` TTS / `face` Avatar — icon + text, reusing the same category icon set as Provider Registry's group headers, §9.2), GPU utilization % (a `mat-progress-bar` determinate bar + numeric label — **informational only, no color threshold** — see §15.9), memory % (same treatment), health (`status-chip`: `check_circle` "Healthy" / `error` "Unhealthy"), last heartbeat (relative time + absolute tooltip, same convention as Deployments' "Last modified," §5.2), and a small caption line "Autoscaler: Not configured" / "Autoscaler: External" (`autoscaler` field, plain text, deliberately **not** styled as a toggle, button, or any other interactive-looking control — FR-GPU-2 forbids any scale affordance, and a control-shaped element here would visually imply one exists even if it's disabled). |
| **Loading (first fetch)** | `mat-progress-bar` under `page-header`; card grid area shows skeleton cards (not an empty grid, to avoid a false "no nodes" flash). |
| **Empty — zero nodes reporting** | `empty-state`: title "No GPU nodes reporting", body the spec's exact sentence `"No GPU nodes are reporting. Agents may still run if provisioned outside this view."` No action button (there's nothing to create from this read-only screen). Not an error. |
| **Empty — filtered to zero (role/tenant filter narrows to nothing)** | Distinct from the true-zero case above: `empty-state` title "No matching nodes", body "No GPU nodes match your filters.", action "Clear filters" — same convention as Deployments' filtered-empty state (§5.2), so a filter-induced emptiness is never confused with "the whole platform has no GPU nodes." |
| **Error (list fetch)** | `empty-state` error variant + Retry: "Could not load GPU nodes. Try again." (No spec code is given for a fetch failure on this endpoint — generic transport copy, same convention as every other list screen's fallback.) |
| **Node — healthy, high utilization (e.g. 95%)** | Bar renders at 95% in the ordinary `--la-primary` color, same as 20% — utilization is not itself a health signal in the spec (only the server-computed `healthy` boolean is), so this document deliberately does **not** invent a red-bar-at-90%-utilization convention that the spec never asked for. Flagged in §15.9 as an open question for product, since a human operator will likely want *some* visual cue for "this node is under heavy load" even if it's not "unhealthy" yet. |
| **Node — stale heartbeat (server has already resolved to unhealthy)** | Renders identically to any other unhealthy node — the UI trusts the server's `healthy` boolean rather than re-deriving staleness client-side from `last_heartbeat_at` (the 60s staleness rule, FR-GPU-3, is the server's computation to own; re-implementing it in the browser risks clock-skew-driven disagreement with the authoritative value). |

### 15.3 Information architecture

- Nav label / `h1`: **GPU health**. Supporting line under the title: "Read-only. Scaling and provisioning happen outside this view." (authored, addressing FR-GPU-1/2's "no scale actions" requirement as a visible, not just implicit, fact — recognition over recall for an operator who might otherwise go hunting for a scale button that will never exist).
- No secondary top-level action.
- Adjacent: none — this is a standalone monitoring screen with no click-through to Deployments, Sessions, or Providers (a node's `role` and `tenant_id` are informational tags here, not links into those other screens' filtered views, unlike Dashboard's provider-health cards which *do* click through, §13.1 step 6 — the two screens intentionally differ here because Dashboard's health grid is provider-credential-centric with an obvious next action (fix the credential in Provider Registry), while a GPU node has no equivalent "go fix this" destination in v1).

### 15.4 Accessibility (beyond §1.2)

- Health `status-chip` and role label are both icon + text, per baseline.
- GPU/memory utilization bars: `mat-progress-bar` exposes `aria-valuenow`/`aria-valuemin`/`aria-valuemax` natively; add `aria-label="GPU utilization"` / `"Memory utilization"` per bar so a screen reader announces which metric it's hearing, not just a bare percentage.
- The "Autoscaler: …" caption is plain text, never rendered as (or confused with) an interactive control — no `role="button"`, no focusable affordance, so assistive tech does not present a non-existent action.
- Card grid: each card is a static, non-interactive region (no click-through, §15.3) — no `tabindex` is added to cards themselves; only the Role/Tenant filter controls are part of the tab order, keeping keyboard navigation short and predictable on a page with potentially many cards.

### 15.5 Relevant heuristics

- **Match between system and the real world:** "Autoscaler: Not configured" states the real operational fact plainly rather than hiding the concept — an operator who expects autoscaling from a typical cloud console is told directly that v1 doesn't have it, rather than wondering why no scale control exists.
- **Aesthetic & minimalist design:** no invented health thresholds, no decorative charts beyond the two progress bars the data actually supports — this screen resists the temptation to look more sophisticated than the v1 data model actually is.
- **Recognition over recall:** the "Read-only" supporting line (§15.3) heads off a operator's likely first instinct to look for a scale button.

### 15.6 Responsive

- **Desktop (≥1280):** grid, 3–4 cards per row depending on viewport width (CSS grid `auto-fill`/`minmax`, not a fixed column count — this is the first screen in this document to use a card *grid* rather than a table-or-stacked-cards dichotomy, since there was never a tabular "default" for this data to begin with).
- **Tablet:** 2 cards per row.
- **Phone:** 1 card per row, full width — identical visual card design to desktop/tablet, just narrower, since this was never a table needing a phone-specific stacked-card transformation (§1.4's table-breakpoint guidance doesn't apply here; there is no table on this screen at any breakpoint).

### 15.7 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| — | — | No spec-named error code applies to `GET /gpu/nodes` reads. Generic transport fallback: "Could not load GPU nodes. Try again." | `empty-state` error variant |

`400 GPU_HEARTBEAT_INVALID` (FR-GPU-3) applies only to the agent-facing `POST /internal/gpu-heartbeats` ingest endpoint, never surfaced in this admin UI.

### 15.8 Component reuse note

Reuses the §13.8 `tenant-select` shared component for the optional tenant filter. No new shared primitive is introduced by this screen beyond the card-grid layout itself, which is local to this page (not promoted to `shared/ui`, since no other screen in this document currently needs a bare card grid — Deployments/Sessions/Providers all use table-or-stacked-cards, not a grid).

### 15.9 Open decisions flagged for `nexus-dev`

- **No utilization color-threshold** (§15.2, "healthy, high utilization") is a deliberate choice to not invent a rule the spec never gave (only the binary `healthy`/`unhealthy` flag is spec-defined) — flag to product: operators likely want an at-a-glance "this node is running hot" signal distinct from "this node is down," which would need a threshold value (e.g., 90%) that is not currently anywhere in the spec or LLD. Until product supplies one, the bars stay neutral.
- **Provider-health-style click-through is intentionally absent here** (§15.3) — confirm this asymmetry with Dashboard's provider-health cards (§13.1 step 6) is acceptable, or whether a future iteration should let a GPU node link to, say, the tenant(s) it's currently serving (would require the LLD to expose that relationship, which `GET /gpu/nodes` does not currently return per-node).

---

## 16. Phase 7 — Alerts & failover config, Screen 7 (`FR-ALERT-1`, `-2`, `-3`, `-4`)

**Surface:** Platform admin console / tenant application (admin template, §1.1). **Tenant-scoped** — see the §1.7 routing-conflict flag: the sidebar "Alerts" item is a **picker/index** at `/admin/alerts`; the real, editable screen lives at `/admin/tenants/:id/alerts`, reached from there or from a Deployments row action "Alerts & failover" (§5.1).

### 16.1 Picker/index (`/admin/alerts`) — user flow

1. **Enter:** sidebar "Alerts."
2. Page-header `h1` "Alerts". Body copy: "Choose a deployment to view and configure its fallback LLM, retry policy, and recent alert activity."
3. A single `tenant_select` (§13.8 component) — full list for operator, assigned-only for admin.
4. **Auto-forward optimization (authored, §16.7):** if the resolved tenant list has exactly one entry (a common case for an `admin` assigned to a single deployment), skip the picker's own interaction and navigate straight to `/admin/tenants/:id/alerts` — the picker still renders for one frame at most, or not at all if the list is already known synchronously; this is a "flexibility & efficiency of use" nicety, not a hidden auto-redirect the user can't see coming (a screen reader / slow-connection user still sees "Loading your deployment…" briefly rather than a silent jump).
5. Selecting a tenant (when more than one exists) navigates to `/admin/tenants/:id/alerts`.
6. **Exit:** navigating to the real screen (forward), or elsewhere via the sidebar.

Zero-tenant states reuse Deployments' own empty-state copy and role split (§5.2) rather than inventing a third variant — "No deployments yet"/"No deployments assigned" with the same action button (or lack of one) as Screen 3.

### 16.2 Real screen (`/admin/tenants/:id/alerts`) — user flow

1. **Enter:** picker (§16.1) or Deployments row action.
2. On load, in parallel: `GET /tenants/:id` (header name; 404 → `"Tenant not found."`, redirect to Deployments, same convention as §5.7/§10.2), `GET /tenants/:id/alert-policy`, `GET /tenants/:id/failover-stats?range=24h`, `GET /tenants/:id/alerts` (default 7-day window per LLD).
3. Layout: two `mat-tab-group` tabs — **"Fallback & retry"** and **"Alerts"** (chosen over a single scrolling page, since the two halves have unrelated interaction models: one is a form with Save, the other is a read-only list — mirroring the tab pattern already established for Agent Builder's narrow-viewport Configuration/Preview split, §10.4, but used here at all viewport widths since the two halves are logically separate, not a responsive collapse of one layout).
4. **"Fallback & retry" tab:**
   - **Fallback LLM — read-only display**, not an editable control on this screen: shows `llm_fallback.provider` + `llm_fallback.model` (or "No fallback configured" if `null`), with a link "Edit in Agent Builder" → `/admin/tenants/:id/builder`. *(This is a direct consequence of §10.5's established division of labor — Agent Builder owns fallback **identity**, this screen owns retry timing and the degraded message only. See §16.7 for why this document does not simply let this screen edit fallback identity too, despite the brief that produced this section describing "fallback LLM" as in-scope here.)*
   - **Retry policy — editable:** `retry_max_attempts` (`mat-select` or number input, 1–5), and `retry_backoff_ms[]` — a dynamic list of number inputs, exactly `retry_max_attempts` long, labeled "Attempt 1 delay (ms)," "Attempt 2 delay (ms)," etc. Changing `retry_max_attempts` up adds a new input defaulted to the previous entry's value (a reasonable starting guess, not zero); changing it down removes the trailing input(s) without discarding the rest.
   - **Degraded-mode message — editable:** `textarea`, 1–500 chars, live counter, pre-filled with the tenant's current value (default on first-ever load, per FR-ALERT-1, is the spec's own default sentence: `"I'm having trouble reaching the language service. Please wait a moment and try again."`).
   - **Failover stats (read-only, last 24h):** three plain numbers with labels — "Primary failures," "Fallback successes," "Degraded-mode invocations" — from `GET /tenants/:id/failover-stats`. No range selector (LLD supports `range=1h|24h|7d` but FR-ALERT-2 only asks for "last-24h" display — a range toggle here would be scope creep the spec didn't ask for; flagged as an option in §16.7, not built by default).
   - **Save** (`PUT /tenants/:id/alert-policy` + `If-Match`): sends `retry_max_attempts`, `retry_backoff_ms`, `degraded_mode_message`, and **does not include `llm_fallback` in the payload at all** (since this screen never lets the user change it) — see §16.7's flagged concern about whether the endpoint is a true `PUT`-replace (which would silently null the fallback if omitted) or tolerates a partial body.
5. **"Alerts" tab:** a plain list (not a table — four fields per row does not need a `mat-table`'s sort/column affordances at v1's likely volume), each row: a type icon + label (`llm_failover`="sync_problem", `provider_unreachable`="cloud_off", `session_failed`="report", `gpu_unhealthy`="dns" — icon + text per baseline), the `message` text, and a relative+absolute timestamp (same convention as Deployments' "Last modified"). No filter/search UI beyond the implicit 7-day window the API already applies (`GET /tenants/:id/alerts` has no explicit range parameter beyond its default window per the LLD's own note) — pagination (`mat-paginator`) if `total` exceeds one page, same 10/25/50/100 convention as every other list in this document.
6. **Exit:** page-header "Back to deployments," or the route-leave dirty-check on the Fallback & retry tab (same unsaved-changes confirm pattern as Agent Builder, §10.2 step 9) if the retry form has unsaved edits.

### 16.3 Screen / component states

| State | Behavior |
|---|---|
| **Loading (initial)** | Skeleton form + skeleton stats + skeleton list, `mat-progress-bar`, three independent fetches (policy/stats/alerts) — a failure in one does not block the others, same "independent panel" convention as §13/§14. |
| **Default — has a saved policy** | Retry fields populated from `GET /tenants/:id/alert-policy`; fallback display shows the current value or "No fallback configured." |
| **Working — dirty (retry form)** | Standard dirty-tracking, same visual language as Agent Builder's draft state (§10.3) — a small "unsaved changes" indicator near Save, Save disabled only while genuinely invalid (e.g. `retry_backoff_ms` length mismatch, which the UI should make structurally impossible to produce given the array is generated from `retry_max_attempts`, not freely edited). |
| **Save in flight** | Save button busy label "Saving…", disabled; fields `readonly` (not destroyed) during submit, same convention as every other form in this document. |
| **Save — conflict (`409 CONFIG_CONFLICT`)** | Identical persistent-banner + confirm-and-reload pattern as Agent Builder (§10.3) — reused verbatim, not reinvented, since this screen writes into the same `DeploymentConfig` object. |
| **Save — `400 CONFIG_RETRY_INVALID`** | Inline at the retry fields (§16.8). |
| **Save — `422 CONFIG_FALLBACK_IDENTICAL`** | Should be unreachable from this screen's own inputs, since fallback identity isn't edited here — if the server still returns it (e.g., a race with a concurrent Agent Builder edit), show it as a form-level banner pointing at Agent Builder: "The fallback LLM configured in Agent Builder is identical to the primary. Update it there." rather than attaching it to a field this screen doesn't expose. |
| **Failover stats — zero activity** | All three numbers show `0`, not an empty-state (zero failovers in 24h is a genuinely good, common, expected state — never dressed up as "no data"). |
| **Alerts tab — empty (valid, zero events in 7 days)** | Per FR-ALERT-4's explicit "empty list valid": `empty-state` title "No alerts", body "No alerts in the last 7 days.", **no action button** — this is good news, not a problem to fix. |
| **Alerts tab — error (fetch)** | `empty-state` error variant + Retry, generic transport copy, scoped to just that tab's content. |
| **Tenant not found (`404 TENANT_NOT_FOUND`)** | Redirect to Deployments + snackbar `"Tenant not found."` — identical to §5.7/§10.2/§10.9's existing pattern. |

### 16.4 Information architecture

- Picker `h1`: **Alerts**. Real-screen page-header title: "{Tenant name} · Alerts & failover". Secondary actions: "Back to deployments," and (on the Fallback & retry tab) "Edit in Agent Builder" for the fallback-identity link.
- Not a sidebar destination for the real form (§1.7) — only Agent Builder-style child-of-Deployments navigation reaches it directly, plus the picker.

### 16.5 Accessibility (beyond §1.2)

- Tabs: standard APG tabs via `mat-tab-group` (same as Agent Builder, §10.7) — arrow-key navigation between "Fallback & retry" / "Alerts."
- Dynamic `retry_backoff_ms[]` inputs: each has its own `<label>` ("Attempt {n} delay (ms)"), not a shared/ambiguous label across the set — a screen reader user can identify exactly which attempt's delay they're adjusting.
- Degraded-message byte/char counter: `aria-live="polite"`, coalesced (same convention as Agent Builder's system-prompt counter, §10.7), announcing on blur or at the limit threshold, not every keystroke.
- Alerts-tab list: each row's icon + type label is not color-only (per baseline); the list itself uses a semantic `<ul>`/`role="list"` with each alert as a list item, not a bare series of `<div>`s.
- Conflict banner and Reload confirm: identical `role="alert"` / APG dialog reuse as §10.3/§10.7.

### 16.6 Relevant heuristics

- **Consistency & standards:** conflict handling, dirty-tracking, and Save/field-error conventions are all reused verbatim from Agent Builder (§10) rather than re-invented, since both screens write the same underlying object.
- **Match between system and the real world:** the read-only fallback display with a link to Agent Builder tells the admin exactly where the *actual* control for that field lives, instead of presenting a control here that would either silently fail to do anything or (worse) create a second, drifting source of truth.
- **Help users recognize/diagnose/recover from errors:** the "No alerts in the last 7 days" empty-state is explicitly framed as good news (per FR-ALERT-4), not styled identically to a load failure.

### 16.7 Responsive

- **Desktop/tablet (≥768):** tabs as a standard horizontal `mat-tab-group`; each tab's content is a single column (no dense two-pane layout is needed here, unlike Agent Builder's config-vs-preview split, since neither tab here has a "live preview" concept).
- **Phone (<768):** same tabs, same single-column content — no further collapse needed since there was never a two-pane layout on this screen to begin with.

### 16.8 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `CONFIG_RETRY_INVALID` | 400 | Contract map sentence (spec names the code without additional prose beyond the field rule) — display `error.message` verbatim from the envelope. | Retry fields (max_attempts / backoff_ms) |
| `CONFIG_FALLBACK_IDENTICAL` | 422 | `Fallback LLM must differ from the primary provider or model.` (same sentence as §10.9, since it's the same rule) | Form-level banner pointing to Agent Builder (§16.3) — unreachable from this screen's own inputs in normal operation |
| `CONFIG_CONFLICT` | 409 | `Config was modified by another user. Reload and retry.` | Persistent banner + Reload flow, identical to §10.3 |
| `TENANT_NOT_FOUND` | 404 | `Tenant not found.` | Redirect to Deployments + snackbar, identical to §5.7/§10.9 |
| `TENANT_FORBIDDEN` | 403 | `You are not assigned to this tenant.` | Snackbar |
| `SESS_RANGE_INVALID` | 400 | Contract map sentence — should be unreachable (the Alerts-tab list uses the API's own default window, no user-facing range control is built, §16.2 step 5). | Alerts-tab error state, defensive only |
| Network / 5xx | — | `Could not save this configuration. Check your connection and try again.` | Form-level banner (Fallback & retry tab), draft preserved |

### 16.9 Open decisions flagged for `nexus-dev`

- **This section's own scope departs from its brief.** The task that produced this section describes "a config form for fallback LLM + retry policy + degraded_mode_message." This document's resolution keeps fallback-LLM **identity** read-only here and editable only in Agent Builder, per the pre-existing, explicitly-flagged §10.5/§8.1 decision that Agent Builder is the sole owner of that field to avoid two screens editing the same identity with no reconciliation UI between them. **If product instead wants this screen to also edit fallback provider/model directly** (matching the brief's literal wording, and matching the fact that `PUT /tenants/{id}/alert-policy` does accept an optional `llm_fallback` body), the two-level dropdown pattern from §10.5 (provider → credential, with an "Add credential" escape hatch) can be lifted into this screen's Fallback & retry tab largely as-is — but then §10.5's Agent Builder copy needs a matching update so neither screen's docs claim exclusive ownership. **This is a genuine, unresolved product conflict, not a small wording nit — flag before implementation, don't silently pick one.**
- **Whether `PUT /tenants/{id}/alert-policy` is a true full-replace or tolerates a partial body** is unconfirmed. If full-replace, this screen's Save must echo back the current `llm_fallback` value (read from the initial `GET`) in every `PUT`, even though the field is read-only in this UI, to avoid silently clearing a configured fallback the moment an admin only meant to change the degraded message. Confirm the exact semantics with the backend contract before wiring Save.
- **No range toggle on the failover-stats block** (§16.2 step 4) is a deliberate "build only what FR-ALERT-2 asks for" restraint, even though the LLD's endpoint supports `1h`/`7d` too — flag to product if a range selector is wanted here to match Dashboard's own range control (§13).
- **The picker/index route split** (`/admin/alerts` vs. `/admin/tenants/:id/alerts`) is this document's own resolution to the nav-scaffold-vs-tenant-scoped-API mismatch (§1.7) — flag to product/architecture if a flat, single-screen design is preferred instead (which would require either making the underlying policy genuinely cross-tenant, which the data model doesn't support, or removing the sidebar item and routing exclusively through Deployments, matching Agent Builder's own precedent of not being a top-level nav item at all).

---

## 17. Phase 7 — Data residency / privacy settings, Screen 8 (`FR-PRIV-1`, `-2`)

**Surface:** Platform admin console / tenant application (admin template, §1.1). **Tenant-scoped**, same picker/real-screen split as Alerts (§16) — see §1.7. Sidebar "Residency" is a picker at `/admin/residency`; the real screen is `/admin/tenants/:id/residency`, reached from there or a Deployments row action "Data residency" (§5.1).

### 17.1 Picker/index (`/admin/residency`) — user flow

Identical pattern to §16.1: `page-header` "Residency", body "Choose a deployment to view and configure its data residency and privacy policy.", a single `tenant_select`, the same one-tenant auto-forward optimization, the same zero-tenant empty-states reused from Deployments (§5.2). Not re-described in full here — see §16.1 for the exact behavior; this page differs only in copy and destination route.

### 17.2 Real screen (`/admin/tenants/:id/residency`) — user flow

1. **Enter:** picker (§17.1) or Deployments row action.
2. On load: `GET /tenants/:id` (header name; 404 handling identical to §5.7/§10.2/§16.2), `GET /tenants/:id/residency`.
3. Single form, no tabs (this screen has only one concern, unlike Alerts' two):
   - **Send to remote LLM** (`send_to_remote_llm`) — `mat-radio-group` (three options are few enough that radio buttons beat a dropdown here, unlike the provider/model dropdowns elsewhere, which have many options): "Prompt text only" (`prompt_text_only`), "Prompt and transcript" (`prompt_and_transcript`), "None" (`none`). Each option has a one-line helper beneath it in smaller `body-small` text clarifying what it means in plain language (authored, since the spec names the enum values but not user-facing descriptions): "Prompt text only — the current turn's text is sent, not conversation history." / "Prompt and transcript — the current turn plus recent conversation history is sent." / "None — no prompt content is sent to a remote LLM; only a self-hosted/on-prem LLM may be used (not available in v1)." *(This last line pre-empts the confusion `CONFIG_RESIDENCY_BLOCKS_LLM` would otherwise cause after the fact — recognition over recall, §17.6.)*
   - **Retain transcripts (days)** (`retain_transcripts_days`) — number input, 1–730, default 90. Helper: "Transcripts older than this are permanently deleted by a daily job (FR-PRIV-3)." (plain-language restatement of the retention job's effect, since an admin setting this number should understand it's a real deletion, not an archive.)
   - **Recordings enabled** (`recordings_enabled`) — `mat-slide-toggle`, default off. The moment it's toggled **on** (before Save, not only after), a persistent, non-error-toned inline warning appears directly beneath the toggle: the spec's exact sentence, `"Recordings are enabled but capture is not implemented in v1; nothing will be stored."` This is shown proactively client-side (not only as a save-response warning) so the admin sees the caveat at the moment of the decision, not after committing to it — see §17.9 for why this document shows it earlier than the API's own `warnings: ["RECORDINGS_NOT_IMPLEMENTED"]` response would.
4. **Save** (`PUT /tenants/:id/residency` + `If-Match`): sends all three fields together (this endpoint has no sub-field partial-update ambiguity, unlike Alerts' `llm_fallback` question, §16.9 — all three fields are this screen's own and always fully owned by it).
5. Success → snackbar "Residency settings saved.", `updated_at`/`If-Match` refreshed. If the response includes `warnings: ["RECORDINGS_NOT_IMPLEMENTED"]`, the inline warning (already shown pre-save per step 3) simply persists post-save rather than appearing twice.
6. **Blocked save (`422 CONFIG_RESIDENCY_BLOCKS_LLM`):** `none` selected while the tenant's **published** Agent Builder config uses a remote LLM — form-level banner using the spec-adjacent Agent Builder sentence for the same code (§10.9): `"Residency policy 'none' cannot be used with a remote LLM. Choose prompt_text_only or an on-prem LLM (not available in v1)."` The "None" radio option is **not** save-blocked pre-emptively/disabled client-side (this screen has no visibility into the current published LLM provider's `hosting` classification without an extra fetch) — the block surfaces at Save time via the server's own combination-rule check, same "same rules, no drift" convention as Agent Builder (§10.3's "Working draft — invalid" state uses the identical principle for a different field set).
7. **Exit:** page-header "Back to deployments," or the same dirty-state route-leave confirm as Agent Builder/Alerts if unsaved.

### 17.3 Screen / component states

| State | Behavior |
|---|---|
| **Loading (initial)** | Skeleton form + `mat-progress-bar`, same convention as every other config form in this document. |
| **Default — has saved policy** | Fields populated from `GET /tenants/:id/residency`. New tenants (never explicitly saved) show the spec's stated defaults (§17.2) — since `POST /tenants` already creates a default `DataResidencyPolicy` row in the same transaction (per the LLD's tenant-creation endpoint note), this is never actually an "empty" state requiring special handling; every tenant has a residency row from the moment it exists. |
| **Recordings toggled on (pre-save)** | Inline warning appears immediately (§17.2 step 3) — non-error tone (info styling, not `--la-error`), since this is expected v1 behavior being disclosed, not a mistake. |
| **Recordings toggled back off** | Warning disappears immediately — no lingering state. |
| **Save in flight** | Busy label "Saving…", fields `readonly`, same convention as every other form. |
| **Save — `400 CONFIG_RETENTION_INVALID`** | Inline at the "Retain transcripts" field. |
| **Save — `422 CONFIG_RESIDENCY_BLOCKS_LLM`** | Form-level banner per §17.2 step 6 — radio group is not reset by the UI (the admin's chosen value stays visible so they can see what they picked and decide whether to change the LLM in Agent Builder instead, or pick a different residency option). |
| **Save — `409 CONFIG_CONFLICT`** | Identical persistent-banner + Reload-confirm pattern as §10.3/§16.3. |
| **Save — success, `warnings` present** | Snackbar "Residency settings saved." plus the already-visible inline recordings warning persists (§17.2 step 5) — no duplicate/second warning is created from the response. |
| **Tenant not found (`404`)** | Redirect to Deployments + snackbar, identical convention. |

### 17.4 Information architecture

- Picker `h1`: **Residency**. Real-screen page-header title: "{Tenant name} · Data residency". Secondary action: "Back to deployments."
- Cross-reference from Agent Builder (§10.1/§10.6): the read-only "Residency: {value}" line there gains its live link once this screen exists — per §10.10's own note, the link should now point to `/admin/tenants/:id/residency` and no longer be `aria-disabled`/tooltipped as "Coming soon." **This is the one piece of prior-phase UI this section directly un-blocks** — flagged as a required follow-up edit to the Agent Builder view, not a new design decision.

### 17.5 Accessibility (beyond §1.2)

- Radio group: `mat-radio-group` with a group `<label>` "Send to remote LLM" (already APG-compliant via Material); each option's plain-language helper is associated via the same visible-helper-before-error convention as §3.4/§9.12 (available up front, not just on error).
- Recordings warning: `role="status"` (advisory, not `role="alert"` — this is expected informational copy, not an error condition) with an info icon, not a warning/error icon or color, so it doesn't read as more alarming than it is.
- Retention helper text ("permanently deleted... FR-PRIV-3") is linked via `aria-describedby` before any error state, same WCAG 3.3.2 convention used throughout this document.

### 17.6 Relevant heuristics

- **Error prevention:** the "None" option's helper text pre-empts the most likely mistake (picking `none` while a remote LLM is configured) by explaining the consequence in plain language before the admin ever hits Save and gets a rejection.
- **Help users recognize/diagnose/recover from errors:** the blocked-save banner names the exact two ways out (switch residency mode, or change the LLM in Agent Builder) rather than a bare rejection.
- **Match between system and the real world:** the recordings warning tells the truth about v1's actual capability (nothing is stored) rather than letting the toggle imply a working feature.

### 17.7 Responsive

Single-column form at all breakpoints (§1.4's auth-card-style vertical stacking, not a two-pane layout — there is no preview pane on this screen, unlike Agent Builder). Desktop caps form width at a comfortable reading measure (~640px) rather than stretching radio buttons/helpers across a full ultra-wide viewport.

### 17.8 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `CONFIG_RETENTION_INVALID` | 400 | Contract map sentence (spec names the code, 1–730 range rule) — display `error.message` verbatim. | Retain-transcripts field |
| `CONFIG_RESIDENCY_BLOCKS_LLM` | 422 | `Residency policy 'none' cannot be used with a remote LLM. Choose prompt_text_only or an on-prem LLM (not available in v1).` (same sentence as §10.9) | Form-level banner (§17.2 step 6) |
| `CONFIG_CONFLICT` | 409 | `Config was modified by another user. Reload and retry.` | Persistent banner + Reload flow |
| `TENANT_NOT_FOUND` | 404 | `Tenant not found.` | Redirect to Deployments + snackbar |
| `TENANT_FORBIDDEN` | 403 | `You are not assigned to this tenant.` | Snackbar |
| Network / 5xx | — | `Could not save this configuration. Check your connection and try again.` | Form-level banner, draft preserved |

Server warning key `RECORDINGS_NOT_IMPLEMENTED` is **not** an `AppErrorCode` (it rides on a `200` success response's `warnings[]` array) — treat it as confirmation of the same client-shown warning, never as an error path.

### 17.9 Open decisions flagged for `nexus-dev`

- **Showing the recordings warning pre-save (client-side, on toggle) rather than only post-save (from the API's `warnings[]`)** is this document's own choice, favoring "tell them before they commit" over strictly waiting for server confirmation — functionally harmless (the sentence is identical either way, and it's the same non-blocking, non-error information either way) but flagged since it means the client asserts a fact (nothing will be stored) the server also asserts, rather than the client only ever displaying what the server says. Confirm this duplication is acceptable, or move the warning to appear only after a successful save if a single-source-of-truth-for-copy discipline is preferred.
- **The "None" radio is never pre-emptively disabled based on the current LLM's hosting classification** (§17.2 step 6) — this document chose to let the server's combination check be the sole enforcement point (matching Agent Builder's own "same rules, no drift" philosophy) rather than fetching the published config's LLM `hosting` value here too just to gray out one radio option pre-emptively. Confirm this is acceptable UX (a save-time rejection, not a pre-disabled option) or whether product wants the extra fetch to prevent the mistake earlier.
- **The picker/index route split** (`/admin/residency` vs. `/admin/tenants/:id/residency`) carries the same open flag as §16.9's identical item for Alerts — same resolution, same caveat, not repeated in full here.
- **Agent Builder's residency link must be un-blocked** (§17.4) — this is a required, not merely optional, follow-up edit once this screen ships, since §10.1/§10.6/§10.10 explicitly built that link in a disabled/tooltipped state pending this screen's existence.

---

## 18. Phase 7 — Post-call summary, Screen 11 (`FR-CALL-4`, `FR-CALL-5`)

**Surface:** Conversation client (§1.1) — same touch-first, unauthenticated, plain-CSS design language as Screens 9 (§11) and 10 (§12), **not** the admin Material template. This section **supersedes** §12.2's "Ended" terminal placeholder and closes out the last open item in §12.9/§8.1's Phase 3 table.

### 18.1 Scope, routes, and the invented decisions this section is built on

- Angular route: `/c/:slug/summary/:summary_token` (authored — neither the spec nor the LLD names a browser route; this document decides the shape, consistent with §11.1/§12.1's own precedent of choosing a route shape for Screens 9/10). The `summary_token` is a one-time, 30-minute-TTL bearer credential (§8.1 Phase 3 table's reasoning about not persisting LiveKit tokens to `localStorage` applies identically here — this token is likewise never persisted beyond the tab's in-memory/URL lifetime, though unlike the LiveKit token it **is** in the URL, since this page must survive a reload/share within its 30-minute window, e.g. the user closing and reopening the tab to see the summary again before it expires — an intentional divergence from §11.1's "never in the URL" LiveKit-token rule, justified because this token's blast radius is one already-ended session's transcript/feedback, not a live call takeover).
- No `CallSessionStore` dependency — this page does not require having arrived from Screen 10 in the same tab session (per FR-CALL-4, "same browser session" is not actually enforced by anything other than the token itself; a reload or a fresh tab with the same URL must still work within the TTL window). This is a **new**, simpler, self-contained store scoped to just this page (`SummaryStore` — display state, transcript, feedback-submitted flag), not sharing `CallSessionStore`'s call-in-progress concerns.
- No account, no admin JWT — identical unauthenticated posture to Screens 9/10.

### 18.2 User flow

1. **Enter:** navigation from Screen 10's end-call action (§12.1 step 6, §12.2 "Ending"), which itself calls `POST /public/sessions/{id}/end` and receives `{status: "ended", summary_token, summary_token_expires_at}`, then navigates to `/c/:slug/summary/:summary_token`. Also reachable by the user reopening/reloading that same URL within the 30-minute window (§18.1).
2. On load: `GET /public/sessions/{id}/summary` with `X-Summary-Token` header set from the route param. *(Note: the session id itself is not in this route's URL per §18.1's chosen shape — the summary token alone identifies the session server-side, consistent with FR-CALL-5's "cannot access other sessions by guessing an id": there is no id in this URL to guess in the first place. If implementation instead needs the id in the route for some technical reason, `summary_token` remains the sole authorization credential regardless of what's visible in the URL — FR-CALL-5 is enforced server-side either way.)*
3. Response renders, in order: an optional **summary paragraph** (if `summary_status: "ready"` and `summary_text` present — max 500 chars, one paragraph, no special formatting), an optional **transcript** (if `transcript` array present and non-empty — same simple two-column chat-log layout convention as the admin Sessions detail transcript, §14.2 step 4, reused here for visual/interaction consistency even though this is a different surface family, since "a transcript is a transcript" and re-inventing its layout would cost recognition for no benefit), and a **feedback form** (rating + optional comment) — **unless** `feedback_submitted: true`, in which case the feedback form is replaced by a calm confirmation line and no form is shown at all (§18.3).
4. If `summary_status` is anything other than `"ready"` (e.g. `"unavailable"`, generation failed) — per FR-CALL-4, this is **non-blocking**: the summary paragraph section is simply omitted entirely (not shown as an error banner "Summary unavailable" — the spec says the failure "hides summary" and is happening silently from the user's perspective; there is no user-facing `SUMMARY_UNAVAILABLE` banner to render, since the field is just absent). The transcript and feedback form render normally regardless.
5. User may rate 1–5 stars and optionally add a comment (max 1000 chars), then submit → `POST /public/sessions/{id}/feedback` `{rating, comment?}` with the same `X-Summary-Token` header.
6. Success (`201`) → feedback form replaced by a calm confirmation: "Thanks for your feedback."
7. User may instead skip/close without submitting feedback at all — per FR-CALL-4's explicit "skip/close without feedback is valid," there is no exit-blocking prompt, no "are you sure you don't want to rate this?" nag. The page simply has no forced action; closing the tab is a fully valid, silent exit.
8. **Exit:** closing the tab (no further destination in-app — this is the natural end of the conversation SPA's flow), or an optional "Start a new call" secondary action returning to `/c/:slug` (Screen 9) for a user who wants to call again immediately — authored, not spec-required, but a low-cost, obviously-useful affordance consistent with the old placeholder's same idea (§12.2's superseded "Ended" state also had this action) and cheap to keep.

### 18.3 Screen / component states

| State | Behavior |
|---|---|
| **Loading (initial fetch)** | A calm, centered spinner + "Loading your summary…" — not the admin SPA's `mat-progress-bar` convention (this is the conversation SPA's own plain-CSS visual language, §11/§12), full-card treatment matching Screen 9's loading posture (§11.3's "not a blocking full-page spinner" principle doesn't apply here the same way, since there is genuinely nothing else on this page to interact with until the fetch resolves — unlike Screen 9's pre-call card, which has a form to interact with during its background preflight check). |
| **Expired/invalid token (`401 CALL_SUMMARY_EXPIRED`)** | Full-card replacement, no form at all: heading "This link has expired", body the spec's exact sentence `"This summary link has expired."`, single action "Start a new call" → `/c/:slug`. No retry (an expired/invalid token will not become valid by retrying the same request). |
| **Session not found (`404 SESSION_NOT_FOUND`)** | Same full-card treatment as the expired case, same destination action — **intentionally identical wording and behavior to the expired-token state**, not a distinct "session not found" sentence, since FR-CALL-5 requires that guessing another session's summary access must not be distinguishable from an ordinary expiry (revealing "this token was well-formed but points to a session that doesn't belong to you" vs. "this token is simply expired" would leak information about token/session validity that an unauthenticated surface must not leak — same non-disclosure principle as §5.7's `TENANT_NOT_FOUND`/`TENANT_FORBIDDEN` precedent, applied here to prevent a token-guessing oracle). *(Authored — the spec gives `404 SESSION_NOT_FOUND` as the code for this case without prescribing UI copy; reusing the expired-token sentence rather than inventing a second one is this document's own decision, flagged in §18.9.)* |
| **Purged transcript (`410 TRANSCRIPT_PURGED` on the transcript portion)** | If the summary endpoint's response indicates the transcript itself was purged (retention already ran) rather than merely "not requested," the transcript section shows a short calm line in place of the chat log: "Your transcript is no longer available." (authored, distinct from the admin Sessions detail's `"Transcript was deleted per the retention policy."` — the end-user-facing sentence is deliberately shorter/less technical for this unauthenticated, non-admin audience; flagged in §18.9 since the spec's `TRANSCRIPT_PURGED` sentence was written for the admin surface, §14.4, and this document authors a second, end-user-appropriate wording rather than reusing the admin one verbatim). The rest of the page (summary, feedback form) renders normally regardless — a purged transcript does not block feedback. |
| **Summary unavailable (silent, no banner)** | Per §18.2 step 4 — the summary section is simply absent. No placeholder text, no "could not generate a summary" message — its absence *is* the state. |
| **Summary present** | Rendered as a single plain paragraph, no markdown/rich formatting (the API returns plain text, max 500 chars — this document does not invent a richer format the spec doesn't describe). |
| **Transcript present** | Ordered chat-log list (§18.2 step 3), same role/text/timestamp shape as §14.2's admin transcript, adapted to the conversation SPA's plain-CSS visual language (no Material components —§1.1's classification boundary). |
| **Transcript absent (not purged, genuinely empty)** | Distinct, calm copy: "No transcript is available for this call." (authored — parallels the admin Sessions detail's own "not purged, just empty" sub-case, §14.3, applied here in end-user register.) |
| **Feedback — default (not yet submitted)** | Star rating control (1–5, all unselected by default — **no pre-selected default rating**, since defaulting to e.g. 3★ would silently bias a user who never intended to submit any rating at all) + optional comment textarea (placeholder-as-hint is fine here since there's a visible `<label>` too, §18.5) + "Submit feedback" button, disabled until a rating is chosen (comment is genuinely optional and does not gate submission). |
| **Feedback — comment over limit** | Live counter "{n} / 1000", same non-blocking-counter convention as Agent Builder's system-prompt counter (§10.6) — let the server be the authoritative stop, the counter is guidance. |
| **Feedback — submitting** | Button busy label "Sending…", disabled, star control and textarea `readonly` (not destroyed) during submit — same convention as every submitting-form state in this document. |
| **Feedback — success (`201`)** | Form replaced by "Thanks for your feedback." No further action offered from this block (the page-level "Start a new call" action, if present, is separate and unaffected). |
| **Feedback — duplicate submit (`409 FEEDBACK_ALREADY_SUBMITTED`)** | Per the spec's explicit "idempotent-friendly" framing, this is treated as a **success-equivalent** outcome, not an error: same calm replacement as the success case, but with the spec's own sentence: "Feedback was already sent. Thank you." (not styled as an error banner — no `role="alert"`, no error color — since resubmission attempting to double-send is not a mistake worth alarming the user over, and the spec's own wording ends in "Thank you," clearly signaling a non-error tone was intended). |
| **Feedback — token expired between page-load and submit (`401 CALL_SUMMARY_EXPIRED` on the feedback call specifically)** | The whole page collapses to the same expired-token full-card state as the page-load case (§18.3 row 2) — the summary/transcript already rendered are not artificially kept half-visible behind a broken form; a token that expired mid-visit is treated identically to one that was already expired on arrival, since the user-facing consequence (this link no longer works) is the same either way. |
| **Feedback — invalid (`400 FEEDBACK_INVALID`)** | Inline at the relevant field — rating out of 1–5 range should be structurally impossible from the star control itself (defensive only); comment over 1000 chars is pre-empted by `maxlength` client-side, same convention as every other capped textarea in this document. |
| **Skip/close (no feedback ever submitted)** | Fully valid terminal state, per FR-CALL-4 — no confirmation prompt, no "are you sure," the tab simply closes or the user navigates to "Start a new call." |

### 18.4 Information architecture

- No nav, no chrome, no shell — identical posture to Screens 9/10 (§11.4/§12.3).
- Browser title: `Call summary · Avatar Platform`.
- Adjacent: only "Start a new call" → Screen 9 (§18.2 step 8) is a navigable link from this page; nothing links *to* this page except the Screen-10 end-call flow and the token URL itself (no admin surface links here, and no admin surface can construct this URL, since `summary_token` is minted only by the public `/end` endpoint).

### 18.5 Accessibility (beyond §1.2)

- Hit targets ≥ 48×48 CSS px on the star rating control and Submit button, matching Screens 9/10's touch-first convention (§11.5/§12.4), not the admin SPA's 40×40 floor.
- Star rating control follows the WAI-ARIA APG "slider" or "radio group" pattern (a 1–5 star picker is conventionally implemented as five radio-equivalent options, each announced as "N stars" — not a bare set of unlabelled clickable icons). Each star option needs a real accessible name ("1 star", "2 stars", … "5 stars"), not an icon-only control (per baseline's "status/controls are never icon-alone").
- Comment textarea has a visible `<label>` "Comments (optional)", not placeholder-as-label, consistent with every form field in this document (§1.2).
- The expired/not-found full-card state focuses the heading on load, same convention as §3.4's invalid-invite empty-state and §11.3's browser-unsupported dead end — a screen-reader user is told the terminal state immediately rather than landing in a form that no longer exists.
- Transcript region, when present: same `role="log"` treatment as §14.5's admin transcript, adapted — role (`user`/`assistant`) still announced as visible text, not color/position alone.
- The duplicate-submit and success states are both `aria-live="polite"` (non-alarming, confirmatory), never `role="alert"` (§18.3's explicit non-error framing for `FEEDBACK_ALREADY_SUBMITTED`).

### 18.6 Relevant heuristics

- **Help users recognize/diagnose/recover from errors, reframed as normal (mirroring §12.6's own precedent):** `FEEDBACK_ALREADY_SUBMITTED` is deliberately not treated as an error state at all — same design principle as Screen 10's "waiting for avatar" banner not being styled as a failure.
- **User control & freedom:** skip/close without feedback is fully supported with zero friction (§18.2 step 7) — this screen never traps the user behind a mandatory rating.
- **Error prevention:** no pre-selected default star rating (§18.3) avoids silently attributing an opinion the user never expressed; `maxlength` on the comment field pre-empts the one reachable validation error before it can occur.
- **Consistency & standards:** transcript layout reuses the admin Sessions detail's chat-log convention (§14.2) rather than inventing a third transcript visual pattern in the same product.

### 18.7 Responsive

- **Phone (primary target, `< 768`):** single column, full-viewport card — same posture as Screen 9's pre-call card (§11.7): summary paragraph (if present) at top, transcript below it (scrollable region if long, rather than pushing the feedback form far below the fold), feedback form pinned toward the bottom, "Start a new call" as a smaller secondary link beneath the feedback block (not competing visually with the primary "Submit feedback" action).
- **Tablet/desktop (`≥ 768`):** centered card, max-width ~560px (slightly wider than Screen 9's ~480px, since a transcript benefits from a bit more horizontal room than a single-field pre-call form does) — same vertical order, no side-by-side layout (there's no second, unrelated panel to place beside it, consistent with §11.7/§12.7's own restraint against inventing a desktop-only split layout this product doesn't otherwise have anywhere in the conversation SPA).

### 18.8 Error / validation messaging (authoritative)

| Code | HTTP | UI sentence (verbatim) | Placement |
|---|---|---|---|
| `CALL_SUMMARY_EXPIRED` | 401 | `This summary link has expired.` | Full-card replacement, no form (also used for mid-visit token expiry on the feedback submit, §18.3) |
| `SESSION_NOT_FOUND` | 404 | `This summary link has expired.` *(reused verbatim from `CALL_SUMMARY_EXPIRED` rather than a distinct sentence — §18.3's non-disclosure rationale, authored, flagged §18.9)* | Full-card replacement, no form — identical treatment to the expired case |
| `TRANSCRIPT_PURGED` | 410 (on the transcript portion of the summary response) | `Your transcript is no longer available.` *(authored end-user register, distinct from the admin-facing sentence in §14.4/§14.8 — flagged §18.9)* | Transcript section only; summary + feedback unaffected |
| `SUMMARY_UNAVAILABLE` | — (non-blocking, no banner) | No user-facing sentence — the summary section is simply omitted (§18.2 step 4, §18.3). | N/A |
| `FEEDBACK_ALREADY_SUBMITTED` | 409 | `Feedback was already sent. Thank you.` | Replaces the feedback form, non-error tone (§18.3, §18.5) |
| `FEEDBACK_INVALID` | 400 | Contract map sentence — should be unreachable given client-side `maxlength`/rating-range constraints; defensive only. | Inline at the relevant field |

### 18.9 Open decisions flagged for `nexus-dev` (see also §8.1)

- **Route shape** `/c/:slug/summary/:summary_token` (§18.1) is this document's own invention, same class of decision as §11.1/§12.1's route choices for Screens 9/10 — flag to product/architecture if a different shape is preferred (e.g. a route that also carries the session id explicitly).
- **`summary_token` living in the URL** (§18.1) is a deliberate, flagged divergence from §11.1's "never put a bearer credential in the URL" rule for the LiveKit token — justified by this token's much narrower blast radius (one ended session's transcript/feedback, not a live call) and the product need for the link to survive a reload/share within its 30-minute TTL. Confirm this reasoning is acceptable, or require the token to instead be carried via router state only (which would make the page permanently un-reloadable/un-shareable within its own TTL window, a real usability cost for what this document judges to be a low-severity credential).
- **`SESSION_NOT_FOUND` reusing the expired-token sentence verbatim** (§18.3, §18.8) rather than a distinct "session not found" message is an explicit, deliberate non-disclosure choice — confirm before shipping, same caveat class as every other authored-copy flag in this document (§8.1, §9.9, §13.9, etc.).
- **A second, end-user-register sentence for `TRANSCRIPT_PURGED`** ("Your transcript is no longer available.") distinct from the admin-facing spec sentence (§14.4/§14.8's `"Transcript was deleted per the retention policy."`) — the spec's sentence was written for FR-SESS-1's admin context; this document judges the admin wording ("retention policy") too technical for an unauthenticated end user and authors a second, shorter sentence for the same code in this different context. Confirm both wordings are acceptable for the same underlying code before shipping, or provide a single sentence both surfaces should use if a contract-map convention requires exactly one wording per code regardless of surface.
- **The optional "Start a new call" action** (§18.2 step 8) is authored, not spec-required — low-risk, kept from the superseded placeholder's own precedent (§12.2) since it costs little and was already judged useful there.
- **No explicit UI for `FR-PRIV-3`'s recordings-not-implemented interaction with this screen** — since `recording_present` isn't part of the public summary response shape in the LLD (`GET /public/sessions/{id}/summary` returns `status, summary_text?, summary_status, transcript?, feedback_submitted` — no recording field), this screen never mentions recordings at all, consistent with v1's stubbed recording pipeline (BL-031) not being an end-user-visible concept here even though it *is* shown (read-only, factual) on the admin Sessions detail (§14.2 step 3). This asymmetry is intentional, not an oversight — flagged for completeness.

---
