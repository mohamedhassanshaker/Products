# ExamLand — Product Specification (PRD/SRS)

**Status:** Canonical specification for the Nexus pipeline build of ExamLand.
**Deployment model:** SaaS, Multi-Tenant (confirmed; see §9).
**Source basis:** Consolidated from prior design material (`docs/raw input/*`) describing an
existing reference implementation of this product, reconciled against this build's mandated
technology stack. This document is self-contained — no other document needs to be read
alongside it to understand what ExamLand is or how it must behave.

---

## 1. Introduction

### 1.1 Purpose

ExamLand is an AI-powered, multi-tenant SaaS platform for exam authoring and practice. This
specification defines every product feature as a formal requirement, independent of build
order — each requirement is written as the target behavior the finished system must exhibit.
It is the single source of truth that the Architecture, Development, and QA phases of this
pipeline build against.

### 1.2 Scope

ExamLand covers: tenant and subscription management for the platform operator; identity,
access control, and organizational structure for each tenant; authoring of exams from manual
uploads or AI-processed source documents; a retrieval-augmented AI pipeline for question
generation and grounded practice; timed exam delivery with adaptive question selection; and
attempt tracking, review, and analytics.

Out of scope for the product as a whole (not merely deferred — see §7 for the MVP/roadmap
split of in-scope items): live/video proctoring and anti-cheating measures beyond timed,
single-question-at-a-time navigation; non-English content/UI; scanned (non-digital-text) PDF
ingestion; multi-tier billing add-ons, annual billing, and coupon/promotion-code discounts.

### 1.3 Glossary

| Term | Meaning |
|---|---|
| Tenant | An isolated customer organization using ExamLand under its own subdomain, with its own users, data, and subscription. |
| Platform Admin | Operates ExamLand itself across all tenants — manages the tenant registry and the package/feature catalog. Not scoped to any one tenant. |
| Tenant Admin | Manages one tenant's users, roles, exam content, and curricula. |
| Member | A tenant's end user — takes exams and practices from their own curriculum. |
| Exam Type | A named, configured exam: total questions, total duration, one or more modules, each module backed by a bank of questions. |
| Module | A named sub-section of an Exam Type with its own target question count. |
| Curriculum | A named, subject-scoped collection of source documents (lessons, references) that grounds AI generation and retrieval for its owner. |
| Attempt | One instance of a Member taking an Exam Type: a generated question set, answers, timing, and score. |
| Generated Question | An AI-produced or AI-extracted question awaiting human review before being packaged into an Exam Type. |
| Package | A subscribable tier defining which features a tenant can use and at what rate limits. |
| Feature (billing sense) | A single gated capability (e.g. "create exam type," "run a PDF generation") with a usage unit and reset period. |
| RAG | Retrieval-Augmented Generation — grounding an LLM's output in retrieved source-document context rather than the model's unaided knowledge. |
| Chunk | An overlapping, semantically-bounded segment of a source document's extracted text, the unit that gets embedded and stored for retrieval. |
| Processing Session | The tracked, resumable unit of work for one uploaded PDF moving through classification/generation. |
| Approved Model Allowlist | The platform-wide set of OpenRouter model identifiers a Platform Admin has vetted for production use; only these are assignable to a tenant. |
| Brand Accent Color | The single tenant-overridable color value layered on top of the platform's default brand palette to give each tenant's app chrome and branded email a distinct identity. |

---

## 2. Vision & Business Goals

**Vision:** Any educator or institution should be able to go from "a pile of source PDFs" to
"students taking a graded, adaptive practice exam" in minutes — AI drafts the tedious parts, a
human always reviews before anything goes live, and the whole platform is offered as self-serve
SaaS to any number of institutions at once.

**Business goals:**
1. Cut exam-authoring time from hours of manual question writing to minutes of AI drafting plus
   human review.
2. Make every practice session adaptive: a Member should keep seeing what they got wrong and
   stop seeing what they've mastered.
3. Make every piece of uploaded content reusable across every AI feature (generation,
   extraction, search, prompt practice) without redundant processing cost.
4. Operate as a true multi-tenant SaaS: one deployment serves many institutions, each fully
   isolated, each governed by a subscription that gates capability and usage.
5. Keep AI generation cost-bounded and auditable per tenant, so the unit economics of the
   AI-assisted authoring pipeline stay predictable as usage scales.

---

## 3. Personas & Roles

| Persona | Scope | Core needs |
|---|---|---|
| **Platform Admin** | Cross-tenant | Create, suspend, and configure tenants; define the package/feature catalog and rate limits; assign/change a tenant's subscription; monitor tenant health and usage — never sees inside a tenant's exam content. |
| **Tenant Admin** | One tenant | Manage users, roles, and permissions within the tenant; author exam types (manual upload or AI/PDF); manage curricula; view all attempts across the tenant; configure tenant-level settings (registration options, branding). |
| **Member** | One tenant, own data only | Browse available exam types; take timed exams; review past attempts (all or wrong-only); practice adaptively from their own curriculum and prompts. |

Platform Admin identity is structurally separate from tenant identity — a Platform Admin is
never also a tenant User, and a tenant User credential must never grant platform-level access,
regardless of role or permission assignment within a tenant. This separation is a security
boundary, not a UX convenience: it must be enforced at the authentication/authorization layer,
not merely by which endpoints happen to be exposed to which persona.

---

## 4. Functional Requirements

Each subsystem below is a complete, self-consistent set of requirements. Requirements are
written as target behavior; §7 defines which of them ship in the MVP versus later phases.

### 4.1 Multi-Tenancy

- **FR-MT-1 — Tenant entity.** The platform maintains a `Tenant` registry (id, name,
  subdomain, status, registration settings, branding logo, a reference to its dedicated data
  scope) in a shared platform data store, separate from any tenant's own data. A tenant's
  billing/subscription reference lives on its `TenantSubscription` record (§4.2), not on the
  `Tenant` row itself.
  - Required inputs at creation: tenant name (non-empty), desired subdomain.
  - Subdomain is unique platform-wide, immutable once set, and restricted to lowercase
    alphanumeric + hyphen, max 63 characters, validated at creation time; a subdomain
    violating the character set or already in use is rejected with a specific
    `INVALID_SUBDOMAIN` / `SUBDOMAIN_TAKEN` error respectively — never a generic 400.
  - `status` is one of `Provisioning`, `Active`, `Suspended`, `Failed`. Only `Active` tenants
    resolve successfully for end-user traffic; `Suspended` resolves to a distinct
    "tenant suspended" response (HTTP 403 with `TENANT_SUSPENDED` code) rather than a generic
    404, so a Tenant Admin sees an actionable message instead of confusion with a nonexistent
    tenant.
  - Deleting/deactivating a tenant is a distinct, explicit action from suspension. Deletion
    performs archival retention (data is retained, inaccessible to end users, for a
    configurable minimum retention window — default 30 days — before physical purge) rather
    than immediate hard delete, so an accidental deletion is recoverable within the window.
- **FR-MT-2 — Tenant resolution.** Every request resolves to exactly one tenant.
  - In non-production environments, resolution defaults to a single configured default tenant
    (no subdomain routing required for local development).
  - In production, resolution is derived from the request's subdomain
    (`{tenant}.examland.app`); an unrecognized subdomain returns 404 with a generic message
    (no information disclosure about which subdomains *are* valid) — it is never silently
    defaulted to the default tenant, since that would serve a mistyped/stale subdomain a
    *different* tenant's data.
  - Resolution happens once per request, as early as possible in the request pipeline, before
    any authentication or business logic runs.
  - Resolution result (tenant metadata only, never credentials) is cached with a short TTL
    (default 60s) to avoid a platform-store round trip on every request, with explicit
    invalidation on tenant update/suspend/delete.
- **FR-MT-3 — Tenant data isolation strategy.** The platform isolates tenant-scoped data using
  **schema-per-tenant on a single MySQL server instance**: one physical MySQL server hosts one
  schema (MySQL schema = MySQL database, they are synonyms) per tenant, containing that
  tenant's full tenant-scoped schema (users, roles, exams, curricula, attempts, etc.). This is
  the mandated, decided strategy for this build (not a runtime-configurable choice) — see §9
  for the rationale and the relationship between this decision and MySQL's schema/database
  terminology.
  - The connection/data-access layer resolves the correct tenant schema dynamically per
    request based on the resolved tenant, so application and business logic never assume a
    fixed schema/connection — they only ever operate through the request's resolved tenant
    data-access handle.
  - Per-tenant connections are pooled and reused across requests (not opened per request), with
    bounded pool size and LRU eviction so tenant count does not unboundedly grow open
    connections.
- **FR-MT-4 — Tenant provisioning.** Creating a tenant provisions its schema, applies the
  current schema/migrations, and seeds default roles, permissions, and a default Tenant Admin
  — as one atomic, retriable workflow.
  - Required inputs: tenant name, desired subdomain, initial package assignment, and the first
    Tenant Admin's email (invited, not given a pre-set password).
  - Provisioning is idempotent: re-running it against a tenant left in `Provisioning` or
    `Failed` status resumes/retries rather than duplicating already-created artifacts.
  - A provisioning failure at any step leaves the tenant in `Failed` status with a recorded
    reason, visible to Platform Admins, and never leaves a partially-usable tenant reachable by
    end users.
- **FR-MT-5 — Migration rollout.** A schema change is rolled out safely across every existing
  tenant schema, with a defined sequential-apply-and-rollback procedure.
  - Migrations apply to tenants sequentially by default (a configurable
    continue-on-error vs. halt-on-error mode), with per-tenant success/failure recorded, so a
    failure partway through does not require guessing which tenants already received the
    change.
  - A failed migration on one tenant does not block the batch from continuing to the next
    tenant when running in continue-on-error mode; a summary report of successes/failures is
    produced at the end of every run, including in dry-run mode.
- **FR-MT-6 — Per-tenant registration settings.** Each tenant independently toggles: (a)
  email/password self-registration, (b) "Sign in with Google". Google OAuth uses one
  platform-wide client shared by all tenants (a single configured client id) — tenants only
  enable/disable the option, they do not configure their own OAuth credentials.
  - When self-registration is disabled for a tenant, the registration endpoint rejects new
    sign-ups for that tenant with a specific `REGISTRATION_DISABLED` error (not a generic 403),
    and the frontend hides the registration entry point accordingly.
  - When Google sign-in is disabled for the resolved tenant, the Google sign-in endpoint
    rejects with a specific 403 (`GOOGLE_SIGNIN_DISABLED`), never silently falling through to
    password auth.
  - Sign-in with Google requires a valid Google ID token; the platform verifies it against the
    platform-wide OAuth client id as audience and rejects with 401 if verification fails or the
    token's email is unverified.
  - Google sign-in resolves to a `User` by email within the resolved tenant: if no user with
    that email exists it is created on the fly (no password set); if a user with that email
    already exists — regardless of whether that account was originally created via password
    registration or a prior Google sign-in — the same account is reused and logged into, with
    no separate identity-linking step or conflict prompt. An account created via Google
    sign-in has no password hash, so password-based login against it always fails until the
    user separately sets a password via password recovery (FR-IAM-3).
  - If the platform-wide Google OAuth client id is not configured on the server, the endpoint
    rejects with a specific 401 explaining Google sign-in is enabled for the tenant but not yet
    configured on the server, rather than a generic failure.
- **FR-MT-7 — Tenant-aware email.** Transactional email (registration, password reset) is sent
  through a provider-agnostic email interface and reflects the sending tenant's branding
  (tenant name, and logo if configured) in both the subject and the HTML body, with
  tenant-controlled values HTML-escaped before interpolation (to prevent stored-XSS via a
  tenant name/logo URL).
  - If no email provider is configured for the deployment, sends are skipped (logged, not
    thrown) so registration/password-recovery flows still succeed without email wired up; any
    provider failure is caught and swallowed rather than failing the triggering request.
- **FR-MT-8 — Tenant-scoped password management.** Forgot/reset/change-password flows are
  tenant-scoped, since the same email address may exist independently across multiple tenants.
  - A forgot-password request is resolved against the *requesting tenant's* user table only; it
    never matches or leaks the existence of an account with the same email in a different
    tenant.
- **FR-MT-9 — Platform Admin console.** Platform Admins operate through their own authenticated
  area (structurally separate credential/token type from tenant Users) to create/suspend/
  configure tenants and manage the package/feature catalog.
- **FR-MT-10 — Tenant brand theming.** `nexus-ux` establishes, as part of the project-wide
  design-system baseline, a default brand color palette (primary, secondary, accent — each with
  a light-mode and dark-mode value), verified to meet WCAG 2.2 AA contrast ratios against both
  surface modes. This default palette is applied to every tenant unless that tenant has
  configured an override.
  - **Override scope (deliberate, bounded — see §9.3 for rationale): a tenant may override its
    logo (FR-MT-1, unchanged) and its accent color only.** Primary and secondary colors, and the
    overall light/dark surface treatment, are not tenant-configurable in this scope — every
    tenant shares the platform's base palette structure, with the accent color as the sole
    brand-differentiating value.
  - Optional input: `accentColorOverride`, a 6-digit hex color. Omitted/cleared means the
    platform default accent applies.
  - An accent color override is validated server-side against both the light-mode and
    dark-mode surface backgrounds it will render on; a color failing the WCAG 2.2 AA contrast
    minimum for the UI-component context it's used in (contrast ratio ≥ 3:1 for large-scale/
    non-text UI components, the applicable threshold for an accent used on buttons/highlights
    rather than as body text) is rejected with a specific `INSUFFICIENT_COLOR_CONTRAST` error
    naming the computed ratio and the required minimum — never silently applied or silently
    clamped to a "closest passing" color.
  - A malformed hex value is rejected with `INVALID_COLOR_FORMAT`.
  - Only a Tenant Admin can set their own tenant's accent override; it takes effect immediately
    for that tenant's app chrome. If FR-MT-7's tenant-branded email templates render an accent
    highlight, they use the same resolved (override-or-default) accent color for consistency
    between in-app and email branding.
  - Clearing an override (explicit reset-to-default action) is idempotent and always succeeds.

### 4.2 Packages, Features, Rate Limits & Billing

- **FR-PKG-1 — Feature catalog.** The platform defines a catalog of `Feature`s, each with a
  unique key, a usage unit, and a reset period (`none` / `daily` / `monthly`).
  - Feature key is immutable once referenced by any package; naming convention is
    `domain.action` (e.g. `exams.create`, `pdf.generations`).
  - `resetPeriod = none` denotes a lifetime cap (e.g. total curricula allowed), not a recurring
    one.
  - Creating a feature with a duplicate key is rejected with a specific
    `FEATURE_KEY_EXISTS` validation error.
- **FR-PKG-2 — Package catalog.** The platform defines a catalog of `Package`s (e.g. Starter,
  Pro, Enterprise), each with a name, price, currency, and active/inactive state.
  - `isActive = false` hides a package from new-subscription flows without breaking tenants
    already subscribed to it (a retired package keeps enforcing its configured limits for
    existing subscribers until they're migrated).
  - `sortOrder` determines catalog display order in pricing/plan-selection UI.
- **FR-PKG-3 — Feature-to-package configuration.** Each package configures, per feature,
  whether it is enabled and — if enabled — an optional numeric limit per reset period; an
  absent limit means unlimited use of that feature on that package.
  - A feature absent from a package's configuration is treated as disabled for that package
    (default-deny), not default-allow — a new feature added to the catalog does not silently
    become usable on every existing package.
  - Updating a package's feature set replaces the full set atomically (no partial-apply state
    visible mid-update).
- **FR-PKG-4 — Tenant subscription.** Each tenant subscribes to exactly one active package at a
  time. Subscription status (`ACTIVE`, `PAST_DUE`, `CANCELED`) is tracked and kept current.
  - Changing a tenant's package takes effect immediately for enforcement purposes; usage
    already recorded in the current period against the old package's limits carries forward
    (not reset) unless a Platform Admin explicitly resets it.
  - A tenant with no subscription record (e.g. mid-provisioning) is treated as having zero
    enabled features, never as unlimited.
- **FR-PKG-5 — Usage tracking & enforcement.** Every gated action increments a per-tenant,
  per-feature, per-period usage counter. A request to a gated action is rejected once the
  tenant's package limit for that feature and period is reached; the request is otherwise
  allowed and the counter incremented. Enforcement happens at the point of the guarded action,
  not merely logged.
  - The rejection response (`FEATURE_LIMIT_REACHED`) identifies the feature, the limit, and
    when the current period resets, so the caller/UI can present an actionable upgrade prompt.
  - The increment (recording one unit consumed) is a single atomic upsert keyed on
    tenant+feature+period, so two concurrent increments never clobber each other's count. The
    preceding limit check reads the current count before that upsert rather than being combined
    into one conditional statement; at low-to-moderate concurrency for a given tenant+feature
    this is an accepted trade-off (a small overrun is possible under a burst of concurrent
    requests at the exact limit boundary), with a single compare-and-swap UPDATE identified as
    the upgrade path if this becomes a real problem under high concurrent load on the same
    tenant+feature.
  - Current usage and remaining quota for a tenant's own features are readable by that tenant's
    Admin (self-service visibility), not only by Platform Admins.
- **FR-PKG-6 — Billing integration.** Tenant subscriptions are backed by a payment provider
  (Stripe): a hosted Checkout Session for a tenant's chosen package (one monthly-recurring line
  item, price and currency taken from the package catalog), and webhook-driven sync of
  subscription status changes.
  - Creating a checkout session does not by itself grant access — the tenant's subscription
    only moves to `ACTIVE` when the corresponding `checkout.session.completed` webhook is
    received; an abandoned checkout leaves the tenant without access. The tenant's provider
    customer id is recorded so a returning tenant reuses the same customer on a later attempt
    rather than accumulating duplicate customer records.
  - Subscription status transitions are driven exclusively by signature-verified webhook events
    (`checkout.session.completed` → `ACTIVE`; `customer.subscription.updated` → maps the
    provider's status, defaulting unrecognized values to `PAST_DUE`, fail-toward-restrictive;
    `customer.subscription.deleted` → `CANCELED` unconditionally), matched to the tenant's
    subscription by the provider's subscription id. An event for a subscription id with no
    matching tenant record is logged and ignored (200 response) rather than failing the
    webhook, so the provider does not endlessly retry it.
  - A `PAST_DUE` subscription retains its assigned package's feature limits unchanged during
    the grace period — no feature is downgraded or blocked during this state.
  - A `CANCELED` subscription falls back to a designated free/starter package's feature limits
    (looked up by a fixed package key) rather than to zero features, so existing data remains
    viewable and a baseline of functionality continues without an active paid plan; if that
    fallback package does not exist in the catalog, the tenant is treated as having zero
    enabled features (fail closed) rather than silently keeping its old paid-plan limits.
  - Every webhook event's signature is verified before processing; a signature that fails
    verification is rejected outright (401) without revealing why; unrecognized event types are
    accepted (200) but otherwise ignored.
  - Only a Platform Admin can initiate a checkout session for a tenant; there is no self-serve
    "upgrade my plan" flow for a Tenant Admin in the current scope, though a Tenant Admin can
    view their tenant's own subscription status.
- **FR-PKG-7 — Platform Admin management UI.** Platform Admins can view/create/edit the feature
  and package catalog, and view/reassign any tenant's active subscription.

### 4.3 Identity & Access Management

- **FR-IAM-1 — Authentication.** Users authenticate via email + password, receiving a signed
  bearer token (default 60-minute expiry) usable on subsequent requests. Passwords are stored
  using a strong one-way hash (bcrypt or equivalent, cost factor configurable).
  - A failed login (unknown email or wrong password) returns the same generic
    `INVALID_CREDENTIALS` error either way, so the endpoint cannot be used to enumerate valid
    emails.
  - Successful login records a last-login timestamp on the user record.
  - Token expiry triggers a clean re-authentication requirement on the client; there is no
    silent refresh in the MVP — the user is prompted to log in again once the token lapses.
- **FR-IAM-2 — Registration.** New users register with email, password, first and last name,
  subject to the tenant's registration settings (FR-MT-6).
  - Email uniqueness is enforced per tenant (not globally) — see FR-MT-8. A duplicate
    registration within the same tenant is rejected with `EMAIL_ALREADY_REGISTERED`.
  - Password must meet a minimum-strength policy (minimum 8 characters; complexity rules
    configurable) enforced server-side, not only in the UI; violation returns
    `WEAK_PASSWORD` naming the unmet rule.
  - A newly registered user receives no roles by default unless the tenant configures a default
    role for self-registered users (e.g. auto-assign Member).
- **FR-IAM-3 — Password recovery.** Users can request a password-reset token via email and use
  it, within its validity window, to set a new password. Authenticated users can change their
  password by supplying their current password.
  - The reset token is single-use and expires after a fixed window (default 1 hour); an
    expired token returns `RESET_TOKEN_EXPIRED`, an already-used or unknown token returns
    `RESET_TOKEN_INVALID` — distinct errors.
  - Requesting a reset for a non-existent email still returns a generic success response (no
    account-existence disclosure), while silently doing nothing server-side.
  - Changing a password while authenticated requires the correct current password
    (`CURRENT_PASSWORD_INCORRECT` on mismatch); on success, the new password takes effect
    immediately for future logins (existing issued tokens remain valid until their own expiry —
    no forced global logout in the MVP).
- **FR-IAM-4 — Profile.** Users can view and update their profile (name, phone, occupation,
  company, country, education level) and upload a profile picture, served via a time-limited,
  tamper-proof signed URL (FR-FILE-1).
  - Editable fields are validated for length/format server-side; email is not editable via the
    profile endpoint (it is the login identifier).
  - Profile picture upload is restricted to standard image MIME types (JPEG/PNG/WebP) and a
    maximum file size (default 5MB); a violation returns a specific
    `UNSUPPORTED_IMAGE_TYPE` / `FILE_TOO_LARGE` error. Replacing a picture schedules the
    previous file for cleanup rather than deleting it inline (avoiding orphaned files being
    left indefinitely, without blocking the request on storage I/O).
- **FR-IAM-5 — Role-based access control.** The platform provides a granular permission engine:
  named `Permission`s grouped by domain (Users, Roles, Permissions, Exams), assignable to
  named `Role`s, which are assignable to `User`s (many-to-many in both directions). A user's
  effective permissions are the union of their assigned roles' permissions.
  - Permission checks fail closed: absence of an explicit grant is always a denial
    (`FORBIDDEN`), never a default allow.
  - A permission or role cannot be deleted while still referenced (by a role or a user,
    respectively) without an explicit cascade/reassignment step (`ROLE_IN_USE` /
    `PERMISSION_IN_USE`), to avoid silently stripping access from users who depend on it.
- **FR-IAM-6 — Standard tenant roles.** Every tenant is seeded with, at minimum, a Tenant Admin
  role (full user/role/permission/exam management) and a Member role (exam-taking access plus
  implicit ownership of their own curricula and attempts). Additional custom roles may be
  defined per tenant on top of the same permission engine.
  - A tenant always retains at least one user holding the Tenant Admin role — removing the last
    Tenant Admin (by role change or deletion) is rejected with `LAST_ADMIN_PROTECTED`, to
    prevent a tenant from becoming unmanageable.
- **FR-IAM-7 — Administrative user management.** Tenant Admins can list (with search/sort/
  paginate), view, create, update, and delete users within their tenant, and assign/remove
  roles.
  - Creating a user administratively allows an optional temporary password (defaulting to a
    known placeholder value if omitted, forcing a change on first login is a roadmap item — see
    §7) and an optional initial role assignment.
  - Deleting a user is a hard delete of the account; ownership of that user's prior attempts/
    curricula is retained (for reporting/audit) rather than being deleted along with the
    account — attempts and curricula records keep their `userId` reference even after the user
    row is removed (soft foreign key, tolerant of a missing user for display purposes: shown as
    "deleted user").

### 4.4 Taxonomy

- **FR-TAX-1 — Hierarchy.** The platform maintains a hierarchical reference taxonomy:
  `Education Level → Stage → Subject`, each level uniquely named within its parent (e.g. two
  Stages under the same Education Level cannot share a name, but the same Stage name may exist
  under two different Education Levels).
- **FR-TAX-2 — Create-or-fetch semantics.** Exam managers can browse and create taxonomy
  entries at any level; creating an entry whose name already exists under the same parent
  returns the existing entry (200) rather than creating a duplicate or erroring, so client code
  can "ensure this exists" without a separate existence check.
  - Name validation: required, trimmed, 2–150 characters (`INVALID_NAME` otherwise); duplicate
    detection is case-insensitive.
- **FR-TAX-3 — Scoping.** Exam Types, Curricula, and generated content are scoped to a
  `Stage`/`Subject`, which drives grounding, adaptive selection, and reporting.
- **FR-TAX-4 — Deletion constraint.** A taxonomy entry referenced by any Exam Type, Curriculum,
  or User (via education level) cannot be deleted outright (`TAXONOMY_ENTRY_IN_USE`); it must
  be reassigned or the dependents removed first, preventing orphaned foreign keys.

### 4.5 Exam Authoring

- **FR-AUTH-1 — Manual (ZIP) authoring.** An exam manager can create an Exam Type by uploading
  a ZIP archive whose top-level folders represent subjects/modules and whose `.json` files each
  represent one multiple-choice question (text, options, correct answer, explanation). On
  upload, the platform validates the structure, persists the Exam Type configuration, extracts
  the archive into managed storage, and records the storage location against the Exam Type.
  - Required fields at creation: name (unique within tenant, non-empty), total question count,
    total duration in minutes, and at least one module (name + question count), plus the target
    Stage.
  - Duplicate exam type names within the tenant are rejected (`EXAM_TYPE_NAME_EXISTS`).
  - Validation failures (malformed zip structure → `INVALID_ZIP_STRUCTURE`; a `.json` question
    file missing a required field → `INVALID_QUESTION_FILE` naming the file and field; a module
    folder with zero valid questions → `EMPTY_MODULE` naming the module) reject the whole
    upload — no partial Exam Type is left behind; any storage already extracted during a failed
    attempt is rolled back/deleted.
  - The declared total question count should reconcile with the sum of per-module counts; a
    mismatch is flagged (`QUESTION_COUNT_MISMATCH`) rather than silently accepted.
- **FR-AUTH-2 — AI-assisted authoring.** An exam manager can create or extend an Exam Type from
  AI-processed source documents (see §4.6), reviewing and editing generated content before it
  becomes part of a live exam.
- **FR-AUTH-3 — Module configuration.** An Exam Type defines one or more modules, each with a
  name and a target question count; the sum of module counts governs how an attempt is
  assembled.
  - A module's question count must not exceed the number of questions actually available to it
    at attempt-generation time (enforced at attempt start — FR-TAKE-3 — not only at authoring
    time, since the bank can grow/shrink after authoring).
- **FR-AUTH-4 — Curriculum linking.** An Exam Type may be linked to one or more Curricula, each
  link carrying a context weight and, optionally, a restriction to specific modules — used to
  ground AI generation and grounding-aware review for that exam.
  - Context weight is a bounded integer 1–10 (`INVALID_CONTEXT_WEIGHT` outside that range)
    expressing relative grounding priority when multiple Curricula are linked to the same Exam
    Type.
- **FR-AUTH-5 — Deletion.** Deleting an Exam Type removes its configuration, its stored question
  content, and any cache entries derived from it; cascading cleanup includes any
  generated-question sessions and images uniquely tied to it.
  - An Exam Type with in-progress Attempts cannot be deleted immediately
    (`EXAM_TYPE_HAS_ACTIVE_ATTEMPTS`); deletion is deferred until those attempts complete/expire
    — an in-progress attempt must never be left pointing at a deleted Exam Type.
- **FR-AUTH-6 — Retroactive subject re-mapping.** An exam manager can trigger a
  re-classification pass over an already-authored Exam Type's questions to correct their
  subject/module mapping without re-uploading source material; already-correctly-mapped
  questions are left untouched so the operation is cheap, idempotent, and safely repeatable
  (running it twice in a row produces no further changes on the second run).

### 4.6 AI-Powered Document Processing Pipeline

**AI subsystem architecture, 2026-08-15 amendment (binding, supersedes the 2026-08-08 decision
below):** the platform is being rewritten onto a single Next.js/TypeScript monolith (one Docker
image, replacing the NestJS+Angular+Python-service stack). As part of that rewrite, the AI
subsystem moves **in-process**, implemented with **Google's Agent Development Kit for
TypeScript (`@google/adk`)** calling **OpenRouter** directly (no separate Python service, no
mTLS service boundary). This is a user-directed, deliberate reversal of the 2026-08-08 decision
immediately below (which had itself reversed an earlier in-process-TypeScript-ADK draft) — kept
for history, not currently binding:

- **FR-AI-1 (superseded 2026-08-15) — in-process AI subsystem.** The AI subsystem is delivered
  in-process within the application (not as a separate service/codebase), gated by an
  `AI_ENABLED` runtime flag. When `AI_ENABLED=false` (or unset), every AI-dependent feature fails
  closed with the same named `AI_SERVICE_UNAVAILABLE`-class error the prior design used for an
  unreachable Python service — the *external* behavior of "AI absent → graceful, named failure,
  never a crash" is unchanged; only the internal mechanism (an in-process check instead of a
  network call) changes.
  - Durable job/session state (processing session status, watermark, heartbeat, budget, resume
    count) remains owned by the application's data layer exactly as already specified in
    §4.6/§4.10, unchanged by this amendment — only *where* a reasoning step executes moved
    in-process; ADK's own optional persistent session/memory store (which depends on a second
    ORM) is explicitly not used for this reason.
  - **Accepted trade-off, recorded deliberately rather than silently dropped**: the prior design's
    blast-radius isolation (an AI-side crash/CPU spike could not affect request-serving),
    independent horizontal scaling of AI load from web traffic, and credential isolation
    (`OPENROUTER_API_KEY` scoped to a single throwaway, network-locked-down container) are all
    given up in exchange for a single deployable artifact. This is an explicit, user-confirmed
    trade for deployment simplicity, not an oversight — see NFR-10's matching amendment below.
  - *(Historical, 2026-08-08, now superseded above)* **FR-AI-1 — AI subsystem service boundary.**
    The AI subsystem is delivered and deployed as its own Python service/codebase, independent of
    the NestJS monolith's build, deploy, and scaling lifecycle, communicating over an internal API
    contract owned by `AiServicePort`.
    - The NestJS side treats the AI service as an unreliable external dependency: calls are
      time-bounded (a configurable per-call timeout) and a timeout or connection failure surfaces
      as a specific `AI_SERVICE_UNAVAILABLE` error to the calling feature (e.g. a PDF processing
      session step), which follows the same graceful degradation already specified for that
      feature (FR-PDF-12's budget-exhaustion completion, FR-REL-3's stale-session recovery) rather
      than crashing the calling request/job.
    - The Python service is stateless per call (no cross-call session memory of its own); all
      durable job/session state (processing session status, watermark, heartbeat) remains owned by
      the NestJS side exactly as already specified in §4.6/§4.10 — the service boundary changes
      *where* a reasoning step executes, not *which side owns durable state*.
    - Empty/boundary case: if the AI service is not configured/reachable at all in a given
      deployment (e.g. `AI_ENGINE=disabled`), every AI-dependent feature fails closed with a clear,
      named error rather than silently no-op'ing or falling back to fabricated output.
- **FR-AI-2 — Platform-level approved model allowlist.** A Platform Admin curates a
  platform-wide allowlist of approved OpenRouter model identifiers that may be used for AI
  generation across all tenants. Tenant Admins do not get free-text model selection — they may
  only be assigned one of the models a Platform Admin has approved (FR-AI-3).
  - Required inputs to approve a model: the OpenRouter model id (string, non-empty, must match
    OpenRouter's `provider/model` id shape — a malformed id is rejected with
    `INVALID_MODEL_ID`), a display name.
  - Approving a model id already on the allowlist is rejected with `MODEL_ALREADY_APPROVED`
    rather than creating a duplicate entry.
  - Exactly one approved model is designated the **platform default** at all times once at least
    one model has been approved; approving the very first model auto-designates it default.
    Attempting to unset the default without designating a replacement in the same action is
    rejected with `DEFAULT_MODEL_REQUIRED` — the platform must never be left with no default.
  - A Platform Admin can disable (not delete) an approved model: a disabled model is hidden from
    future tenant-assignment choices but any tenant already assigned to it keeps using it
    unchanged, so disabling never silently breaks an already-configured tenant.
  - Removing (hard-deleting) a model still assigned to one or more tenants is rejected with
    `MODEL_IN_USE` naming the count of affected tenants; the admin must reassign those tenants
    (or the platform default) first. Removing the current platform default is rejected with the
    same `DEFAULT_MODEL_REQUIRED` guard as above.
- **FR-AI-3 — Per-tenant model assignment.** A Platform Admin assigns exactly one approved,
  enabled model (FR-AI-2) to a tenant; a tenant with no explicit assignment uses the current
  platform default.
  - Assigning a model id that is not on the allowlist, or is disabled, is rejected with
    `MODEL_NOT_APPROVED`.
  - A Tenant Admin can view (read-only) which model is currently in effect for their tenant
    (their explicit assignment, or "platform default" if unassigned) but cannot change it —
    model selection is a Platform Admin action only, consistent with Platform Admin owning the
    package/feature catalog (FR-PKG-7).
  - Clearing a tenant's explicit assignment (revert-to-default action) is idempotent and always
    succeeds; the tenant immediately starts resolving to whatever the current platform default
    is, including future changes to that default, until explicitly assigned again.
  - Changing the platform default does not retroactively change any tenant's *explicit*
    assignment — only tenants currently resolving via "no explicit assignment" are affected by a
    default change.

- **FR-PDF-1 — Upload & validation.** A user uploads a PDF (≤ a configured maximum size,
  default 50MB); the platform validates it is a genuine PDF (file-signature check), computes a
  content hash, and creates a processing session that the client can poll for status.
  - Rejections are specific: `INVALID_FILE_SIGNATURE` (non-PDF signature), `INVALID_EXTENSION`
    (wrong extension), `FILE_TOO_LARGE`, and `EMPTY_FILE` (zero-byte) each produce a distinct,
    actionable error rather than one generic "upload failed."
  - The session is created and an identifier returned to the caller (HTTP 202) *before* any AI
    work begins — the endpoint never blocks on classification or generation.
  - Optional inputs at upload: a content-type hint (to skip classification when the caller
    already knows it's an exam), a target Subject, and a force-reprocess flag.
- **FR-PDF-2 — Deduplication.** Before running any AI processing, the platform checks whether
  an identical or semantically equivalent document (by exact hash, then by semantic fingerprint
  similarity above a high threshold, default cosine ≥ 0.97) has already been successfully
  processed; if so, its resulting questions are reused for the new session and the AI pipeline
  is skipped, unless the caller explicitly forces reprocessing.
  - Exact-hash match is checked first (cheapest); semantic fingerprint match is only attempted
    if the exact match misses.
  - A reused session is marked as such in its generation-method metadata
    (`reused_from_cache`) so reviewers can see a question originated from cache, not fresh
    generation.
- **FR-PDF-3 — Content classification.** The platform classifies each processed document as
  `lesson`, `exam`, or `reference`, along with a topic list and an estimate of achievable
  questions per page, to select the correct downstream processing branch.
  - An explicit content-type hint from the uploader bypasses classification entirely for that
    value.
  - A classification result outside the three recognized types is a processing failure with a
    specific `UNRECOGNIZED_CONTENT_TYPE` error identifying the unrecognized label, not silently
    coerced to a default branch.
- **FR-PDF-4 — Lesson question generation.** For lesson content, the platform generates new
  multiple-choice questions covering the material's concepts, avoiding duplicate concept
  coverage within the same document, targeting a question count derived from document length
  and estimated density (bounded by configured minimums/maximums).
  - Each generated question includes: question text, 4–5 answer options, exactly one correct
    option, a 2–3 sentence explanation, a difficulty/Bloom's-level indicator (1–6), and a
    confidence score (0–1).
  - Generation proceeds in bounded batches (default ≤10 questions per LLM call), not one giant
    call, so a single oversized document cannot exceed a single call's practical token limit;
    concepts already covered by earlier batches are carried forward so later batches don't
    repeat them.
  - A parse failure or a response missing required fields for a given item is treated as "that
    item produced nothing" (logged, skipped) rather than failing the entire batch/session — one
    malformed question in a batch does not discard the rest.
- **FR-PDF-5 — Exam question extraction.** For exam content, the platform extracts existing
  questions verbatim, determines whether the correct answer was explicitly provided in the
  source or must be inferred, and calibrates a confidence score accordingly.
  - Extraction processes the document by page; a page with negligible extractable text
    (< 20 characters) is skipped rather than sent to the model.
  - An explicitly-answered question receives materially higher confidence (≥ 0.95) than an
    inferred one (0.60–0.90 depending on grounding strength), and the distinction (`provided`
    vs. `inferred`) is retained on the question record for reviewer visibility, not just folded
    into a single opaque score.
- **FR-PDF-6 — Reference indexing.** For reference content, the platform indexes the document
  into the user's Curriculum for future retrieval rather than generating questions from it.
  - If no Curriculum is specified/resolvable for the upload's Subject, one is created
    automatically (named from the source file) so reference material is never silently dropped.
- **FR-PDF-7 — Subject classification.** Generated or extracted questions are mapped to a real
  taxonomy subject rather than left tagged only by page location; this mapping can be
  retroactively re-run against already-imported content without disturbing already-correct
  mappings (shared mechanism with FR-AUTH-6).
- **FR-PDF-8 — Review & edit.** Generated questions are presented for paginated human review:
  full text/option/answer/explanation editing, review-flagging, bulk deletion, and targeted
  regeneration (replacing selected questions with freshly generated ones from the same source,
  preserving the original count).
  - Editing a generated question's content marks it as no longer purely auto-generated (a
    human-touched flag), distinct from the review-flag, so downstream reporting can distinguish
    "AI output, unedited" from "AI output, human-corrected."
  - Bulk delete and regenerate operations accept a list of question ids and are no-ops (200,
    not errors) on an empty list, so batch UI actions don't need to special-case "nothing
    selected."
- **FR-PDF-9 — Finalize into an Exam Type.** A reviewer selects questions meeting a confidence
  threshold (optionally restricted to auto-generated-only), configures modules, exam name,
  description, duration, and total question count, and finalizes them into a new Exam Type; the
  eligible questions are grouped into modules by their detected source section.
  - If no question in the session meets the selection criteria, finalize is rejected with a
    specific `NO_ELIGIBLE_QUESTIONS` error rather than creating an empty Exam Type.
  - The reviewer may optionally link one or more Curricula to the resulting Exam Type as part
    of the same finalize action (FR-AUTH-4).
- **FR-PDF-10 — Append to an existing Exam Type.** A reviewer can append newly generated/
  reviewed questions into an existing AI-authored Exam Type's modules, increasing its module
  and total question counts.
  - Appending is rejected (`APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP`) against an Exam Type that was
    authored via the manual ZIP path (FR-AUTH-1), since it lacks the manifest structure the AI
    pipeline appends to; the error explains this distinction rather than failing generically.
  - Appending is idempotent — re-submitting the same append request after a partial failure does
    not duplicate already-appended questions.
- **FR-PDF-11 — Image handling.** Images extracted from a source document are stored
  (deduplicated by content hash), associated with the questions whose source location overlaps
  the image's page, and rendered inline in the review and exam-taking experience with alt text.
- **FR-PDF-12 — Cost and usage accounting.** Every AI call's token usage and cost is recorded
  against its processing session; a configured per-session token and cost budget bounds how
  much any single document can consume. A check runs before each batch/page call in the
  chunked generators — a session that would exceed its budget completes gracefully (`Completed`
  status) with whatever was generated so far, rather than failing outright (`Failed`).
- **FR-PDF-13 — Full-bank lesson assessment.** For a Curriculum document, the platform can
  generate a complete, difficulty-tiered question bank covering the whole document as a
  standalone fixed-length assessment, resumable from the last successfully completed section if
  interrupted.
  - The resulting assessment is a fixed, well-known shape (a defined question count and
    duration) so students get a consistent "assess this lesson" experience regardless of source
    document length.
  - If interrupted, resuming never re-generates already-completed sections and never loses
    already-generated questions, even across an application restart — the progress watermark
    only advances after its output is durably persisted (see FR-REL-2).

### 4.7 Curriculum & Retrieval-Augmented Generation

- **FR-CUR-1 — Curriculum ownership.** A Curriculum is owned by the Member or Tenant Admin who
  created it, scoped to a single Subject, and contains one or more uploaded documents.
  - Only the owner (or a Tenant Admin acting in an oversight capacity) can modify or delete a
    Curriculum.
  - **FR-CUR-1a — Ownership scope.** Curriculum ownership is enforced at the individual-user
    level, not merely at the tenant level — two Members in the same tenant do not share each
    other's Curricula by default; a non-owner Member's attempt to view/modify a Curriculum they
    don't own returns 403 (`NOT_CURRICULUM_OWNER`), or 404 if hiding existence is preferred by
    the implementation (decided consistently, not mixed, at Architecture time).
- **FR-CUR-2 — Document ingestion.** Uploading a document to a Curriculum extracts its text,
  splits it into overlapping context-preserving chunks tagged with source page, and embeds each
  chunk for semantic retrieval.
  - Multiple documents can be uploaded to the same Curriculum in one request; each is validated
    and processed independently so one bad file doesn't block the rest — a per-file result list
    is returned (success/failure per file), not a single aggregate outcome.
  - A document upload with no usable extractable text (e.g. an empty file) is rejected with a
    specific `NO_EXTRACTABLE_TEXT` error before any embedding cost is incurred.
- **FR-CUR-3 — Semantic search.** A user can search within a Curriculum by free-text query and
  receive the most relevant source excerpts with their originating document and page.
  - An empty query returns an empty result set (200, `[]`) rather than an error or an arbitrary
    "browse everything" listing.
- **FR-CUR-4 — Grounded generation.** Every AI generation feature that needs subject-matter
  context (lesson generation, exam extraction, prompt-based practice) retrieves the most
  relevant chunks from the relevant Curriculum and includes them as grounding context in its
  prompt, rather than generating from the model's unaided knowledge alone.
- **FR-CUR-5 — Prompt Practice.** A user can request a set of 1–30 practice questions generated
  live from a free-text prompt, grounded against a chosen Curriculum, with confidence
  calibrated by how much relevant grounding context was actually found.
  - An empty prompt (`EMPTY_PROMPT`), a question count outside the 1–30 range
    (`INVALID_QUESTION_COUNT`), or a nonexistent Curriculum id (`CURRICULUM_NOT_FOUND`) are
    each rejected with a distinct, specific validation error.
  - If generation yields zero usable questions (e.g., an unanswerable prompt), the session is
    marked failed with a message suggesting a more specific prompt or a different Curriculum,
    rather than silently returning nothing.
- **FR-CUR-6 — Adaptive Lesson Practice.** A user can request a practice set for a subject or a
  specific document; the platform first draws from the existing packaged question bank for that
  scope (ranked by relevance to the document when document-scoped, or selected for topical
  diversity when subject-scoped) before generating any new questions to fill a shortfall —
  minimizing redundant AI calls.
  - Document-scoped requests must resolve to a real, non-empty question bank for the requested
    stage/subject; a document merely being *present* in a Curriculum with no packaged questions
    behind it does not by itself satisfy a practice request (`EMPTY_QUESTION_BANK`) — the bank,
    not the raw document, is the source of practice questions.
- **FR-CUR-7 — Curriculum-exam linkage.** Curricula linked to an Exam Type (FR-AUTH-4)
  participate in that exam's generation and review grounding.
- **FR-CUR-8 — Cascading deletion.** Deleting a Curriculum document removes its indexed
  vectors, its stored file, its database record, and cascades to any processing sessions and
  any Exam Types produced solely from it.
  - Cascading Exam Type deletion here follows the same rules as FR-AUTH-5 (blocked/deferred
    while in-progress Attempts exist).

### 4.8 Exam Taking & Adaptive Practice

- **FR-TAKE-1 — Discovery.** A Member can list available Exam Types visible to them and view an
  instructions screen (modules, total questions, total duration) before starting.
- **FR-TAKE-2 — Attempt generation.** Starting an exam builds a randomized question set per the
  Exam Type's module configuration. Selection is adaptive: for each module, questions the
  Member has never attempted are prioritized first, then questions previously answered
  incorrectly, then questions previously answered correctly — each group independently shuffled
  — until the module's required count is filled; the full selection is then shuffled across
  modules and persisted as the attempt.
  - "Previously answered" is determined from the Member's own attempt history only, using the
    *most recent* answer to each question (a question corrected on a later attempt is no longer
    treated as "wrong").
  - Only one attempt at a time may be `InProgress` per Member per Exam Type; starting a new
    attempt while one is already in progress either resumes the existing one or is rejected
    (`ATTEMPT_ALREADY_IN_PROGRESS`) — it never silently creates a second concurrent attempt
    against the same Exam Type.
- **FR-TAKE-3 — Insufficient bank handling.** If a module's question bank cannot supply its
  required count, attempt generation fails with a specific `INSUFFICIENT_QUESTION_BANK` error
  naming the deficient module and stating the shortfall (available vs. required).
- **FR-TAKE-4 — Timed navigation.** During an attempt, the Member sees one question at a time
  within a persistent header showing exam name, current question number of total, and an
  elapsed-vs-total timer; the final question's action changes from "Next" to "Submit."
  - Navigating to a question index outside the attempt's range, or belonging to a different
    attempt, is rejected (404, `QUESTION_NOT_FOUND`), never silently clamped to a nearby valid
    index.
- **FR-TAKE-5 — Answering.** The Member selects one option per question; a selection can be
  changed while the attempt is in progress. Answering is not permitted once the attempt is no
  longer in progress (`ATTEMPT_NOT_IN_PROGRESS`).
  - Submitting an answer to a question that does not belong to the specified attempt is
    rejected (404, `QUESTION_NOT_FOUND`), preventing cross-attempt tampering.
- **FR-TAKE-6 — Auto-submit.** An attempt is automatically submitted when the total allowed
  time elapses, regardless of how many questions were answered.
- **FR-TAKE-7 — Scoring.** On submission, the platform computes answered/correct/wrong counts
  and a percentage score, and marks each answer's correctness case-insensitively against the
  correct option.
  - Score = correct ÷ total questions × 100, rounded to one decimal place; an Exam Type with
    zero total questions defensively scores 0 rather than dividing by zero.
  - Submitting an attempt that is not currently in progress (already submitted or timed out) is
    rejected with `ATTEMPT_NOT_IN_PROGRESS`, not silently re-scored.
- **FR-TAKE-8 — Review.** After submission, and for any past attempt, the Member can review
  either the wrong-only subset or the full question set, each shown with the question, all
  options, the Member's selection, correctness, and the explanation.
  - Review ordering is always by the question's original position in the attempt, regardless of
    filter, so "wrong only" is a subset view, not a re-ordered one.
- **FR-TAKE-9 — Attempt history.** A Member can list all of their own past attempts, optionally
  filtered to one Exam Type. A Tenant Admin can list all attempts across the tenant with the
  same level of detail.

### 4.9 Files & Media

- **FR-FILE-1 — Signed delivery.** All user-facing file access (avatars, question images,
  source documents) is served through time-limited, tamper-evident signed URLs rather than
  direct, permanently-guessable paths.
  - A signature that fails verification, or a URL past its expiry, is rejected with a specific
    `LINK_INVALID_OR_EXPIRED` response distinct from a generic 404, so clients can prompt a
    fresh link request rather than treating it as a missing file.
  - A signed URL cannot be used to traverse outside its intended storage root (path-traversal
    sequences are rejected regardless of signature validity).
- **FR-FILE-2 — Range support.** File delivery supports HTTP range requests so that media
  (large PDFs, images) can be seeked/streamed rather than fully downloaded before use.
- **FR-FILE-3 — Image association.** Stored images can be linked to a specific question at a
  specific position (within the question text, a given option, or the explanation), each with
  an optional caption and required alt text.
  - The same stored image can be associated with more than one question (e.g., a shared
    diagram); usage count is tracked so a still-referenced image is not deleted when only one of
    its associations is removed.

### 4.10 Platform Reliability

- **FR-REL-1 — Asynchronous side effects.** Domain events (e.g., a user being created) are
  recorded transactionally with the triggering change and published to interested consumers
  asynchronously (outbox pattern), so a downstream failure in a side effect never rolls back the
  primary action.
  - Publication is at-least-once: a consumer must tolerate receiving the same event more than
    once (idempotent handling), since the outbox does not guarantee exactly-once delivery.
- **FR-REL-2 — Resumable long-running jobs.** Any generation job spanning multiple AI calls
  (full-bank assessment generation in particular) tracks its own progress watermark, so an
  interruption resumes from the last completed unit of work rather than restarting or silently
  losing partial progress.
  - The watermark advances only after its corresponding output (generated questions) is
    durably persisted, so a crash between "generated" and "persisted" re-does that one unit of
    work rather than skipping it.
- **FR-REL-3 — Stale session recovery.** A background process periodically identifies and
  resolves processing sessions that are stuck (crashed mid-run) or still pending, either
  resuming or failing them with a clear error, so no session is left indefinitely in an
  ambiguous state.
  - "Stuck" is determined by a heartbeat timestamp updated periodically by the active worker; a
    session whose heartbeat has not updated within a defined grace period (default 5 minutes)
    is eligible for recovery by another worker pass.

---

## 5. Non-Functional Requirements

- **NFR-1 — Performance.** Standard API responses (excluding AI-generation endpoints) meet a
  p95 latency target of 500ms under nominal load. PDF document processing completes within an
  average target time proportionate to document size, bounded by the configured maximum
  document size. Image extraction succeeds at a rate of ≥95% for digital-text-native PDFs.
- **NFR-2 — Scalability.** The platform supports a growing number of tenants without degrading
  isolation guarantees or per-tenant performance; API instances are stateless and horizontally
  scalable; background processing scales independently of request-serving capacity.
- **NFR-3 — Reliability.** No user-facing action is lost due to a transient downstream failure
  (AI provider outage, vector store outage); long-running jobs are resumable; every write
  establishing tenant data is atomic with respect to its provisioning workflow.
- **NFR-4 — Security.** All authenticated endpoints require a valid bearer token; passwords are
  never stored in reversible form; file access is never guessable; Platform Admin and tenant
  User credentials are structurally incompatible with one another; all tenant data is
  inaccessible to any other tenant's request context, enforced at the data-access layer (not
  merely by application-level filtering that could be bypassed by a coding mistake).
- **NFR-5 — Usability.** Core author and exam-taking flows require a minimal number of steps;
  error messages are specific enough to act on (e.g., naming the deficient module, not a generic
  failure); UI meets WCAG 2.2 AA accessibility targets for core flows.
- **NFR-6 — Maintainability.** Business logic is implemented independent of the HTTP framework
  and independent of the specific data-access, vector-store, and LLM-provider implementations
  (each accessed through a port/interface owned by the domain), so any of these can be swapped
  by changing one adapter binding without rewriting domain logic.
- **NFR-6a — Diagnosability.** Every process writes its console output to a durable, dated log
  file in addition to the console, so operational history survives past terminal/process
  lifetime and is inspectable without live terminal access; a failure to write the log file
  never interrupts the request or job that produced the log line.
- **NFR-7 — Cost Management.** Every AI call's token usage and cost is tracked against its
  owning tenant and processing session; sessions cannot silently exceed a configured cost/token
  budget (FR-PDF-12).
- **NFR-8 — Engineering standard.** All feature work follows consistent module conventions, is
  unit-tested at the service/business-logic layer, and is end-to-end tested for user-facing
  flows.
- **NFR-9 — Data residency & isolation auditability.** It must be possible to demonstrate, for
  any given tenant, exactly which physical schema its data resides in, and to enumerate that
  schema's contents independent of the application (for compliance/export requests).
- **NFR-10 (amended 2026-08-15) — AI subsystem degradation isolation, without process
  independence.** Following the 2026-08-15 in-process AI amendment (FR-AI-1), independent
  deployability/scaling and hard process-level blast-radius isolation are explicitly **no longer
  required** — this is an accepted, user-confirmed trade for a single-container deployment.
  What remains binding: an AI outage/misconfiguration/disabled state (`AI_ENABLED=false`) must
  still degrade only AI-dependent features (per each feature's own documented
  graceful-degradation behavior) and must never crash or hang non-AI request handling (tenant
  resolution, auth, exam taking/scoring, billing, etc.) — i.e. software-level fault containment
  (timeouts, circuit breakers, try/catch around the AI call path) replaces the previous
  process-level isolation as the enforcement mechanism.
  - *(Historical, pre-2026-08-15, now superseded above)* **NFR-10 — AI subsystem independence.**
    The Python AI service (FR-AI-1) is independently deployable and horizontally scalable from
    the NestJS API/worker processes; an outage or degradation of the AI service degrades only
    AI-dependent features (per each feature's own documented graceful-degradation behavior) and
    never blocks or crashes non-AI request handling (tenant resolution, auth, exam
    taking/scoring, billing, etc.).

---

## 6. Data Model

The model is split into two physical scopes: a **platform store** (always shared, one schema
holding cross-tenant registry/billing data) and **tenant stores** (one schema per tenant, all
running the identical tenant-scoped schema — see §9 for the isolation strategy). All identifiers
are UUIDs unless otherwise noted; all timestamps are UTC.

### 6.1 Platform-level entities

**`Tenant`**
| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| name | string | Display name |
| subdomainSlug | string, unique | Immutable once set; lowercase alphanumeric + hyphen; max 63 chars |
| schemaName | string, unique | Name of the tenant's dedicated MySQL schema |
| status | enum(`Provisioning`,`Active`,`Suspended`,`Failed`) | |
| isDefault | boolean | Marks the single tenant used for non-production/local requests |
| allowEmailRegistration | boolean | Default true |
| allowGoogleSignIn | boolean | Default false |
| logoUrl | string, nullable | Used for tenant-branded transactional email |
| accentColorOverride | string, nullable | 6-digit hex; FR-MT-10. Null = platform default accent applies |
| assignedAiModelId | UUID, nullable (FK → `ApprovedAiModel`) | FR-AI-3. Null = tenant resolves to the current platform default model |
| createdAt, updatedAt | datetime | |
| deletedAt | datetime, nullable | Set on deletion; retained through the retention window before purge |

**`PlatformAdmin`** — id, email (unique, platform-wide), passwordHash, name, createdAt.

**`ApprovedAiModel`** — id (UUID, PK), openRouterModelId (string, unique, `provider/model`
shape), displayName (string), enabled (boolean, default true), isPlatformDefault (boolean;
exactly one row is true at all times once any row exists — FR-AI-2), createdAt, updatedAt.

**`Feature`** — id, key (unique, immutable once referenced), name, description (nullable),
unit (e.g. "generations", "exams"), resetPeriod enum(`NONE`,`DAILY`,`MONTHLY`), createdAt.

**`Package`** — id, key (unique), name, description (nullable), priceCents (int, default 0),
currency (default `usd`), isActive (boolean, default true), sortOrder (int), createdAt,
updatedAt.

**`PackageFeature`** — id (PK), packageId (FK), featureId (FK), limit (int, nullable =
unlimited), enabled (boolean, default true). Unique on (packageId, featureId).

**`TenantSubscription`** — id, tenantId (FK, unique), packageId (FK), status
enum(`ACTIVE`,`PAST_DUE`,`CANCELED`; default `ACTIVE`), providerCustomerId (string, nullable),
providerSubscriptionId (string, nullable), currentPeriodStart, currentPeriodEnd (nullable),
createdAt, updatedAt.

**`TenantFeatureUsage`** — id, tenantId (FK), featureId (FK), periodKey (string, e.g.
`2026-08` for monthly, `2026-08-07` for daily, `lifetime` for a `NONE`-reset feature), count
(int, default 0), updatedAt. Unique on (tenantId, featureId, periodKey).

### 6.2 Tenant-scoped entities

**Taxonomy**
- `EducationLevel` — id (int, PK), name (unique), createdAt.
- `Stage` — id (int, PK), educationLevelId (FK), name (unique within educationLevelId),
  createdAt.
- `Subject` — id (int, PK), stageId (FK), name (unique within stageId), createdAt.

**Identity**
- `User` — id (UUID, PK), email (unique within tenant), firstName, lastName, passwordHash
  (nullable — null for OAuth-only accounts), phone, occupation, companyName, country,
  educationLevelId (FK, nullable), pic (storage key, nullable), isActive (boolean),
  passwordResetToken (nullable), passwordResetTokenExpiry (nullable), createdAt, lastLoginAt.
- `Role` — id (int, PK), name (unique), description, createdAt.
- `Permission` — id (int, PK), name (unique), description, group (e.g. "Users", "Exams"),
  createdAt.
- `UserRole` — userId (FK), roleId (FK). Composite PK.
- `RolePermission` — roleId (FK), permissionId (FK). Composite PK.

**Exam authoring**
- `ExamType` — id (UUID, PK), name (unique within tenant), totalQuestions (int), totalMinutes
  (int), storagePath, stageId (FK, nullable), storageMode enum(`LocalDisk`,`ObjectStore`), kind
  enum(`Standard`,`LessonPractice`,`LessonAssessment`), createdAt.
- `ExamModule` — id (UUID, PK), examTypeId (FK), moduleName, questionCount (int).
- `ExamTypeQuestion` — a packaged question filed under an Exam Type/module: id, examTypeId
  (FK), moduleName, questionText, optionsJson, correctAnswer, explanation,
  sourceGeneratedQuestionId (FK, nullable — traceable back to its AI origin if applicable).
- `ExamTypeCurriculum` — examTypeId (FK), curriculumId (FK), contextWeight (int, 1–10),
  applicableModulesJson (nullable). Composite PK (examTypeId, curriculumId).

**Curriculum / RAG**
- `Curriculum` — id (UUID, PK), name, description, subjectId (FK), ownerUserId (FK — per-user
  ownership), createdAt, updatedAt.
- `CurriculumDocument` — id (UUID, PK), curriculumId (FK), fileName, title (nullable),
  contentType enum(`Reference`), storageKey, pageCount (nullable), uploadedAt.
- *(Vector-store side, not relational — see §9 architectural notes)*: content chunks and
  question-bank embeddings keyed by `curriculumId`/`documentId`/`examTypeId` payload filters in
  Qdrant.

**AI pipeline**
- `PdfProcessingSession` — id (UUID, PK), initiatedByUserId (FK), sourceFileName,
  contentTypeHint (nullable), contentType enum(`Lesson`,`Exam`,`Reference`, nullable until
  classified), status enum(`Pending`,`Extracting`,`Classifying`,`Processing`,`Completed`,
  `Failed`), errorMessage (nullable), totalQuestions (int), successfulQuestions (int),
  storageKeyPrefix, subjectId (FK, nullable), curriculumDocumentId (FK, nullable), fileHash
  (SHA-256), forceReprocess (boolean), tokensUsed (int), totalCost (decimal), lastCompletedPage
  (int, watermark), resumeAttempts (int), heartbeatAt (nullable), createdAt, updatedAt,
  completedAt (nullable).
- `GeneratedQuestion` — id (UUID, PK), processingSessionId (FK), subjectId (FK, nullable),
  questionText, optionsJson, correctAnswer, explanation, questionType, bloomsLevel (1–6,
  nullable), sourcePageRange, sourceSection, confidenceScore (0–1), generationMethod (e.g.
  `lesson_generation`, `exam_extraction_with_key`, `exam_extraction_inferred`,
  `reused_from_cache`, `regenerated`), isAutoGenerated (boolean), isReviewFlagged (boolean),
  notes (nullable), linkedExamTypeId (FK, nullable — set once finalized/appended), createdAt,
  updatedAt.

**Exam delivery**
- `Attempt` — id (UUID, PK), userId (FK), examTypeId (FK), startTime, endTime (nullable),
  status enum(`InProgress`,`Submitted`,`TimedOut`).
- `AttemptQuestion` — id (UUID, PK), attemptId (FK), questionIndex (int, 0-based, defines
  display order), subjectName, questionFileName (identity used for adaptive history matching),
  questionText, optionsJson, correctAnswer, selectedOption (nullable), isCorrect (nullable, null
  until answered), explanation.

**Media**
- `StoredImage` — id (UUID, PK), fileName, originalFileName, contentType (MIME), fileSize,
  fileHash (SHA-256, dedup key), storageKey, sourcePageNumber (nullable), sourceDocumentId (FK,
  nullable), generatedAltText (nullable), extractedAt, usageCount (int).
- `QuestionImage` — id (UUID, PK), generatedQuestionId (FK), imageId (FK), sequenceOrder
  (nullable), caption (nullable), altText, position enum(`question_text`,`option`,
  `explanation`), width/height (nullable).

**Reliability**
- `OutboxMessage` — id (UUID, PK), eventType (e.g. `user.created`), payload (JSON), createdAt,
  processedAt (nullable).

### 6.3 Key relationships

- A `Tenant` has many `User`s, `ExamType`s, `Curriculum`s, and exactly one
  `TenantSubscription`.
- A `Tenant` optionally references one `ApprovedAiModel` (`assignedAiModelId`); when absent, the
  tenant resolves to whichever `ApprovedAiModel` row currently has `isPlatformDefault = true`.
- A `User` has many `Role`s; a `Role` has many `Permission`s (both many-to-many via join
  tables).
- An `ExamType` has many `ExamModule`s and many `ExamTypeQuestion`s, and may link many
  `Curriculum`s via `ExamTypeCurriculum`.
- A `Curriculum` belongs to exactly one owning `User` and one `Subject`, and has many
  `CurriculumDocument`s.
- A `PdfProcessingSession` produces many `GeneratedQuestion`s; each `GeneratedQuestion`
  optionally links to the `ExamType` it was finalized/appended into, and optionally to an
  originating `CurriculumDocument` (for lesson-assessment sessions).
- An `Attempt` belongs to one `User` and one `ExamType`, and has many `AttemptQuestion`s (one
  per question in that attempt, ordered by `questionIndex`).
- A `GeneratedQuestion` may have many `QuestionImage` associations to `StoredImage`s
  (many-to-many via the join, since one image can illustrate multiple questions).

### 6.4 Entity-relationship overview

```
Tenant 1───1 TenantSubscription ───* PackageFeature ───1 Package
  │                                                        │
  │                                                     1 Feature (per row)
  │
  ├──0..1 ApprovedAiModel (assignedAiModelId; absent = platform-default ApprovedAiModel)
  │
  ├──* User ──*───* Role ──*───* Permission
  │     │
  │     └──* Curriculum ──* CurriculumDocument
  │              │
  │              └──(vector chunks, payload-filtered, in Qdrant)
  │
  ├──* ExamType ──* ExamModule
  │       │ ──* ExamTypeQuestion
  │       └──*───* Curriculum   (via ExamTypeCurriculum)
  │
  ├──* PdfProcessingSession ──* GeneratedQuestion ──*───* StoredImage (via QuestionImage)
  │                                    │
  │                                    └──0..1 ExamType (linkedExamTypeId)
  │
  └──* Attempt (per User × ExamType) ──* AttemptQuestion
```

---

## 7. MVP Scope vs. Future Roadmap

### 7.1 MVP (ships first — the product is not viable without these)

- Full Multi-Tenancy subsystem (§4.1): tenant registry, resolution, schema-per-tenant
  provisioning, migration rollout, per-tenant registration settings (email/password + Google),
  tenant-branded email, tenant-scoped password management, Platform Admin console, tenant brand
  theming (default palette + logo/accent override, FR-MT-10).
- AI subsystem governance (§4.6): the Python AI service boundary (FR-AI-1), the Platform Admin
  approved-model allowlist (FR-AI-2), and per-tenant model assignment (FR-AI-3) — these are
  prerequisites for every AI generation feature below, not separable from the PDF pipeline MVP.
- Full Packages/Billing subsystem (§4.2): feature/package catalog, usage tracking &
  enforcement, Stripe checkout + webhook sync, past-due/canceled fallback behavior, Platform
  Admin management UI.
- Full Identity & Access Management (§4.3): authentication, registration, password recovery,
  profile, RBAC, standard tenant roles, administrative user management.
- Full Taxonomy (§4.4).
- Exam Authoring: manual ZIP authoring (FR-AUTH-1), module configuration (FR-AUTH-3),
  curriculum linking (FR-AUTH-4), deletion (FR-AUTH-5). AI-assisted authoring (FR-AUTH-2) ships
  as part of the PDF pipeline MVP below.
- AI-Powered Document Processing Pipeline (§4.6): upload/validation, exact-hash deduplication,
  content classification, lesson generation, exam extraction, reference indexing, subject
  classification, review & edit, finalize into an Exam Type, cost/usage accounting. Semantic
  fingerprint dedup (part of FR-PDF-2), append-to-existing-exam (FR-PDF-10), image handling
  (FR-PDF-11), and full-bank lesson assessment (FR-PDF-13) are P1 — see roadmap.
- Curriculum & RAG core (§4.7): ownership, document ingestion, semantic search, grounded
  generation, Prompt Practice. Adaptive Lesson Practice (FR-CUR-6) is P1.
- Exam Taking & Adaptive Practice (§4.8): full subsystem — discovery, adaptive attempt
  generation, timed navigation, answering, auto-submit, scoring, review, attempt history.
- Files & Media core (§4.9): signed delivery, range support. Rich image-to-question
  association (FR-FILE-3) ships alongside PDF image handling (P1).
- Platform Reliability core (§4.10): asynchronous side effects (outbox), stale session
  recovery. Full watermark-based resumability (FR-REL-2) ships alongside full-bank assessment
  (P1).

### 7.2 P1 — high value, ships soon after MVP

- Semantic fingerprint deduplication (FR-PDF-2 full).
- Append-to-existing-exam-type (FR-PDF-10).
- Image extraction/association pipeline (FR-PDF-11, FR-FILE-3 richer cases).
- Full-bank lesson assessment with resumable generation (FR-PDF-13, FR-REL-2 full).
- Adaptive Lesson Practice (FR-CUR-6), including farthest-point diversity selection for
  subject-scoped requests.
- Retroactive subject re-mapping as a standalone reviewer-triggered action decoupled from
  initial ingestion (FR-AUTH-6/FR-PDF-7 as an explicit endpoint+UI, beyond the automatic pass
  during ingestion).
- Cross-tenant migration rollout tooling as an operator-facing tool (FR-MT-5 as a dedicated,
  documented ops workflow with dry-run mode).

### 7.3 P2 — explicitly deferred / future roadmap

- Reranking / relevance-score floor and hybrid (keyword + vector) search for RAG retrieval.
- Cross-encoder reranking of retrieved chunks.
- "Find similar questions" reviewer tool built on the question-bank vector index.
- Multi-document synthesis for Lesson Practice (searching across a whole Curriculum rather than
  one document).
- Confidence-driven review-flag threshold recalibration based on human edit/accept feedback.
- Evaluation harness for generation quality (golden-set regression testing of prompts).
- Streaming/granular progress feedback for long-running generation jobs (beyond the coarse
  status enum).
- Image-aware RAG (vision-model captioning of extracted images feeding into retrieval).
- Self-serve tenant plan upgrades (currently Platform-Admin-initiated only).
- Multi-tier billing add-ons, annual billing, coupon/promotion codes.
- Non-English content/UI support.
- Scanned (non-digital-text) PDF ingestion (OCR pipeline).
- Live/video proctoring and richer anti-cheating measures.
- Forced password change on first login for administratively-created users.
- A durable job-queue-based worker model (replacing interval-based single-process workers), to
  be adopted once concurrent multi-tenant load exceeds single-worker sweep capacity.

---

## 8. Success Metrics

- **Authoring efficiency**: median time from PDF upload to a reviewed, finalized Exam Type
  under 15 minutes for a typical (20–40 page) lesson document.
- **Adoption**: number of active tenants and, within each, week-over-week growth in Members
  taking at least one Attempt.
- **AI cost efficiency**: average cost per finalized question stays within the configured
  per-session budget; cache/dedup hit rate on repeated document uploads (target ≥30% for
  institutions re-using shared source material across cohorts).
- **Practice engagement**: proportion of Members who complete at least one adaptive practice
  session (Prompt Practice or Lesson Practice) after their first Attempt.
- **Reliability**: PDF processing session failure rate (excluding graceful budget-exhaustion
  completions) below a defined threshold (target <2%); zero data leakage incidents across
  tenant boundaries (a hard invariant, not a target to trend toward).
- **Billing health**: checkout-to-active conversion rate; involuntary churn rate (subscriptions
  reaching `CANCELED` via payment failure exhaustion rather than voluntary cancellation).
- **Review quality signal**: proportion of AI-generated questions accepted without edits versus
  edited during human review, tracked per generation method, as a proxy for generation quality
  over time.

---

## 9. Constraints & Assumptions

### 9.1 Deployment model

Confirmed: **SaaS, Multi-Tenant**. One deployment serves many tenant institutions, each with
isolated data and an independent subscription governing feature access.

### 9.2 Mandated technology stack (binding on Architecture and Development)

These are user-mandated, non-negotiable constraints carried forward into this specification and
binding on every later phase:

- **Backend**: NestJS.
- **Frontend**: Angular.
- **Database**: MySQL. Isolation strategy is **schema-per-tenant on a single physical MySQL
  server instance** — one MySQL server hosts multiple schemas, one per tenant, plus one
  additional schema for the shared platform store. This reconciles cleanly with the prior
  reference implementation's architectural finding that, in MySQL, `CREATE SCHEMA` is a literal
  synonym for `CREATE DATABASE` — there is no separate lighter-weight "schema" concept the way
  Postgres has one. "Single physical database" in the user's mandate is therefore interpreted
  as *one MySQL server instance* (not one schema/database per tenant on separate server
  instances), and "multi-schema" as *one schema per tenant* within that instance — i.e., this
  build implements exactly the "dedicated-datastore-per-tenant" strategy the prior reference
  material already validated, under the schema/database terminology MySQL actually uses. A
  fully row-level shared-schema mode (all tenants in one schema, `tenantId`-filtered) is **not**
  part of this build's scope; it is out of scope entirely (not merely deferred), since the
  mandate already decided the isolation strategy.
- **AI orchestration — AMENDED AGAIN 2026-08-15, supersedes the 2026-08-08 decision below**: per
  §4.6's 2026-08-15 amendment, AI orchestration moved back **in-process**, now using the real,
  GA/mature **`@google/adk` TypeScript package** (not a hand-rolled substitute) calling
  OpenRouter directly, as part of the single-container Next.js monolith rewrite. This reverses the
  2026-08-08 decision immediately below for reasons of deployment simplicity (one container, one
  language, no mTLS/PKI machinery) rather than any remaining maturity concern with the TypeScript
  SDK — `@google/adk` reached GA (v1.6.0) with steady maintenance since the 2026-08-08 decision was
  made. `docs/architecture/HLD.md`/`LLD.md` require a matching targeted amendment.
  - *(Historical, 2026-08-08, now superseded above)* the platform's AI functionality (PDF
    processing pipeline's classify → extract/generate → review orchestration, curriculum-grounded
    generation, and any future multi-step or tool-using AI flow) is implemented in a
    **standalone Python service using Google's Agent Development Kit for Python (`google-adk`)**,
    not the TypeScript variant, and not in-process with the NestJS application. This was itself a
    user-mandated change from the original spec's decision (recorded here for history): *"ADK
    (Agent Development Kit, TypeScript)... implemented using ADK's agent/workflow primitives...
    Architecture decides the exact boundary"* assumed an in-process TypeScript dependency that, at
    the time, was judged not yet mature enough.
- **Vector store**: Qdrant. Collections, payload-filter partitioning strategy (by
  `curriculumId`/`documentId`/`examTypeId`, not per-tenant collections), and dedup/fingerprint
  approach as described in §4.6/§4.7 carry forward as the target behavior; Architecture selects
  the concrete client/library.
- **LLM access**: via OpenRouter (a model-agnostic LLM gateway), not a direct provider SDK
  (e.g., not the OpenAI SDK directly). All chat/completion calls described in §4.6 (classification,
  generation, extraction, quality-check) route through OpenRouter's API from within the Python AI
  service (FR-AI-1), so the specific underlying model per task/tenant is a configuration value
  (governed by FR-AI-2/FR-AI-3's allowlist and per-tenant assignment), not a code dependency.
  **Open item for Architecture**: OpenRouter's primary surface is chat/completions; the
  text-embedding requirement (FR-CUR-2, FR-PDF-2's semantic fingerprinting) needs an
  embeddings-capable endpoint. Architecture must confirm whether OpenRouter's catalog includes a
  suitable embedding model at build time, or bind the embeddings port to a separate
  embeddings-capable provider behind the same port abstraction (NFR-6) — this is an
  infrastructure choice that does not change any product-facing behavior in this spec, so it is
  intentionally left as an Architecture-phase decision rather than resolved here. (Note: HLD
  already resolved this for the prior in-process design — OpenAI `text-embedding-3-small` behind
  a vendor-neutral `EmbeddingsPort` — Architecture's amendment for the Python-service split should
  confirm whether that port now lives in the Python service, the NestJS side, or both, rather than
  re-litigating the vendor choice itself.)

### 9.3 Decided-but-inherited product/technical choices

These were established by the prior reference implementation and are carried forward as
decided (not open) because nothing in the mandate or research contradicts them:

- Stripe is the payment provider for billing (FR-PKG-6). Single-price, monthly-interval,
  single-line-item subscriptions only.
- A single platform-wide Google OAuth client is used for "Sign in with Google" across all
  tenants; tenants do not bring their own OAuth credentials.
- File storage is local disk for initial deployment, behind a storage-port abstraction so an
  S3-compatible backend can be substituted without domain-logic changes.
- Email delivery is provider-agnostic (an `EmailPort`), defaulting to SMTP; a missing/
  unconfigured provider degrades to a no-op (logged) rather than failing the triggering request.
- JWT bearer authentication, short-lived tokens (default 60 minutes), no silent refresh in the
  MVP (re-authentication on expiry).
- **Tenant brand theming scope (FR-MT-10) — product-manager decision, documented rather than
  escalated**: tenant override is limited to **logo + accent color**, not a full primary/
  secondary/accent palette override. Rationale: (1) a full palette override multiplies the
  WCAG-AA verification and QA surface by every possible tenant combination, whereas a single
  accent color can be contrast-checked deterministically against the two fixed (light/dark)
  surface treatments `nexus-ux` already owns; (2) most SaaS admin-console products in this
  category differentiate tenant branding via logo + one accent color while keeping the rest of
  the chrome consistent, which is enough brand identity for a B2B admin/exam-taking surface
  without fragmenting the design system; (3) it keeps `nexus-ux`'s baseline (established once,
  in Dev-3) authoritative rather than something every tenant can silently degrade. If real
  customer demand for deeper theming emerges post-MVP, it is a natural P1/P2 backlog addition,
  not a gap in this decision.
- **AI model governance scope (FR-AI-2/FR-AI-3) — user-confirmed, not a PM judgment call**:
  Tenant Admins do not get free-text OpenRouter model selection. A Platform Admin curates the
  approved-model allowlist and assigns one model (or leaves a tenant on the platform default)
  per tenant. This bounds both cost exposure (unvetted/expensive models cannot be selected by a
  tenant) and support surface (only a known, tested set of models is ever in production use).

### 9.4 Other constraints and assumptions

- English is the only supported content/UI language for the current scope.
- Scanned (non-digital-text) PDFs and other non-digital-text source material are out of scope
  for AI processing.
- Video/live-proctoring and anti-cheating measures beyond timed, single-question-at-a-time
  navigation are out of scope.
- Multi-tier billing add-ons, annual billing, and coupon/promotion-code discounts are out of
  scope for the current billing integration.
- The platform assumes a moderate-scale multi-tenant deployment (tens to low hundreds of
  tenants at MVP); a durable multi-consumer job queue for background workers is an explicitly
  deferred scaling response (§7.3), not built into the MVP.

---

*End of document.*
