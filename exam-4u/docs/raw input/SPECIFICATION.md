# ExamLand — Product Specification & Solution Design

**Document type:** Self-contained Software Requirements Specification (Part 1) + Solution Design (Part 2).
**Date:** 2026-08-07 (reconciled against current codebase: NestJS runtime, Google sign-in, Stripe billing, tenant isolation strategies, email/logging infra)
**Status:** Living document. This is the single source of truth for what ExamLand is and how it is built — no other document needs to be consulted alongside it.

---

# PART 1 — PRODUCT SPECIFICATION (SRS)

## 1. Introduction

### 1.1 Purpose
ExamLand is an AI-powered, multi-tenant SaaS platform for exam authoring and practice. This specification defines every product feature as a formal requirement, independent of whether that requirement is currently live, partially built, or not yet started — implementation status is not a category the requirements are organized by. Each requirement is written the way it should behave when complete.

### 1.2 Scope
ExamLand covers: tenant and subscription management for the platform operator; identity, access control, and organizational structure for each tenant; authoring of exams from manual uploads or AI-processed source documents; a retrieval-augmented AI pipeline for question generation and grounded practice; timed exam delivery with adaptive question selection; and attempt tracking/review/analytics.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| Tenant | An isolated customer organization using ExamLand under its own subdomain, with its own users, data, and subscription. |
| Platform Admin | Operates ExamLand itself across all tenants — manages the tenant registry and the package/feature catalog. Not scoped to any one tenant. |
| Tenant Admin | Manages one tenant's users, roles, exam content, and curricula. |
| Member | A tenant's end user — takes exams and practices from their own curriculum. |
| Exam Type | A named, configured exam: total questions, total duration, one or more modules, each module backed by a bank of questions. |
| Curriculum | A named, subject-scoped collection of source documents (lessons, references) that grounds AI generation and retrieval for its owner. |
| Attempt | One instance of a Member taking an Exam Type: a generated question set, answers, timing, and score. |
| Generated Question | An AI-produced or AI-extracted question awaiting human review before being packaged into an Exam Type. |
| Package | A subscribable tier defining which features a tenant can use and at what rate limits. |
| Feature | A single gated capability (e.g. "create exam type," "run a PDF generation") with a usage unit and reset period. |

---

## 2. Product Vision & Goals

**Vision:** Any educator or institution should be able to go from "a pile of source PDFs" to "students taking a graded, adaptive practice exam" in minutes — AI drafts the tedious parts, a human always reviews before anything goes live, and the whole platform is offered as self-serve SaaS to any number of institutions at once.

**Goals:**
1. Cut exam-authoring time from hours of manual question writing to minutes of AI drafting plus review.
2. Make every practice session adaptive: a Member should keep seeing what they got wrong and stop seeing what they've mastered.
3. Make every piece of uploaded content reusable across every AI feature (generation, extraction, search, prompt practice) without redundant processing cost.
4. Operate as a true multi-tenant SaaS: one deployment serves many institutions, each fully isolated, each governed by a subscription that gates capability and usage.

---

## 3. Personas & Roles

| Persona | Scope | Core needs |
|---|---|---|
| **Platform Admin** | Cross-tenant | Create, suspend, and configure tenants; define the package/feature catalog and rate limits; assign/change a tenant's subscription; monitor tenant health and usage — never sees inside a tenant's exam content. |
| **Tenant Admin** | One tenant | Manage users, roles, and permissions within the tenant; author exam types (manual upload or AI/PDF); manage curricula; view all attempts across the tenant; configure tenant-level settings (registration options, branding). |
| **Member** | One tenant, own data only | Browse available exam types; take timed exams; review past attempts (all or wrong-only); practice adaptively from their own curriculum and prompts. |

Platform Admin identity is structurally separate from tenant identity — a Platform Admin is never also a tenant User, and a tenant User credential must never grant platform-level access, regardless of role or permission assignment within a tenant.

---

## 4. Functional Requirements

Each subsystem below is specified as a complete, consistent set of requirements. Every requirement is written as the target behavior, whether it exists today, is mid-build, or is upcoming work — this document does not tag requirements by build status.

### 4.1 Multi-Tenancy

- **FR-MT-1 — Tenant entity.** The platform maintains a `Tenant` registry (id, name, subdomain, status, registration settings, branding logo, a reference to its dedicated data store) in a shared platform data store, separate from any tenant's own data. A tenant's billing/subscription reference lives on its `TenantSubscription` record (§4.2), not on the `Tenant` row itself.
  - Subdomain is unique platform-wide, immutable once set, and restricted to a safe character set (lowercase alphanumeric + hyphen) validated at creation time.
  - `status` is one of `Provisioning`, `Active`, `Suspended`, `Failed`. Only `Active` tenants resolve successfully for end-user traffic; `Suspended` resolves to a distinct "tenant suspended" response rather than a generic 404, so a Tenant Admin sees an actionable message instead of confusion with a nonexistent tenant.
  - Deleting/deactivating a tenant is a distinct, explicit action from suspension; deletion behavior (hard delete vs. archival retention window) must be a defined, deliberate policy, not left implicit.
- **FR-MT-2 — Tenant resolution.** Every request resolves to exactly one tenant. In non-production environments, resolution defaults to a single configured default tenant (no subdomain routing required for local development). In production, resolution is derived from the request's subdomain (`{tenant}.examland.app`); an unrecognized subdomain is rejected, never silently defaulted.
  - Resolution happens once per request, as early as possible in the middleware chain, before any authentication or business logic runs.
  - Resolution result (tenant metadata, not credentials) is cached with a short TTL to avoid a platform-store round trip on every request, with explicit invalidation on tenant update/suspend.
  - A request whose subdomain does not match any tenant returns 404 with a generic message (no information disclosure about which subdomains *are* valid).
- **FR-MT-3 — Configurable data isolation strategy.** The platform supports tenant data isolation via a **selectable isolation mode**, chosen by platform-level configuration and applied consistently at deployment time (not mixed per-tenant within a single deployment):
  - **Database-per-tenant** — each tenant owns a dedicated MySQL database containing the full tenant-scoped schema (users, roles, exams, curricula, attempts, etc.). Strongest isolation; simplest backup/restore and per-tenant scaling; higher per-tenant connection/resource overhead.
  - **Schema-per-tenant** — each tenant owns a dedicated schema within a shared MySQL server/instance. Lighter-weight provisioning and connection pooling than database-per-tenant, with equivalent logical isolation of tenant-scoped tables.
  - **Shared-schema (row-level)** — all tenants share one schema; every tenant-scoped table carries a `tenantId` column and every query is scoped by it. Lowest operational overhead, useful for very small tenants or pure development, at the cost of relying on application-level enforcement rather than physical isolation.
  - The connection/data-access layer resolves the correct tenant-scoped connection or filter dynamically per request based on the configured mode and the resolved tenant, so application and business logic are written once and are agnostic to which isolation mode is active.
  - The active mode is a single global setting per deployment; changing it requires an explicit, one-time bulk migration of every existing tenant's data into the new mode's shape (see FR-MT-5), not a live per-tenant toggle.
- **FR-MT-4 — Tenant provisioning.** Creating a tenant provisions its data store according to the active isolation mode (new database, new schema, or a `tenantId` scope, respectively), applies the current schema/migrations, and seeds default roles, permissions, and a default Tenant Admin — as one atomic, retriable workflow.
  - Required inputs: tenant name, desired subdomain, initial package assignment, and the first Tenant Admin's email (invited, not given a pre-set password).
  - Provisioning is idempotent: re-running it against a tenant left in `Provisioning` or `Failed` status resumes/retries rather than duplicating already-created artifacts.
  - A provisioning failure at any step leaves the tenant in `Failed` status with a recorded reason, visible to Platform Admins, and never leaves a partially-usable tenant reachable by end users.
- **FR-MT-5 — Migration rollout.** A schema change is rollable out safely across every existing tenant's data store under the active isolation mode, with a defined sequential-apply-and-rollback procedure.
  - Migrations apply to tenants sequentially (not in parallel) by default, with per-tenant success/failure recorded, so a failure partway through does not require guessing which tenants already received the change.
  - A failed migration on one tenant does not block the batch from continuing to the next tenant; a summary report of successes/failures is produced at the end of a run.
- **FR-MT-6 — Per-tenant registration settings.** Each tenant independently toggles: (a) email/password self-registration, (b) "Sign in with Google" (`Tenant.allowGoogleSignIn`). Google OAuth uses one platform-wide client shared by all tenants (a single `GOOGLE_CLIENT_ID`) — tenants only enable/disable the option, they do not configure their own OAuth credentials. The login/registration flow resolves the correct tenant before evaluating the OAuth request.
  - When self-registration is disabled for a tenant, the registration endpoint rejects new sign-ups for that tenant with a specific, actionable error (not a generic 403), and the frontend hides the registration entry point accordingly.
  - When Google sign-in is disabled for the resolved tenant, the Google sign-in endpoint rejects with a specific 403 ("Google sign-in is disabled for this tenant"), never silently falling through to password auth.
  - Sign-in with Google requires a valid Google ID token; the platform verifies it against the platform-wide OAuth client id as audience and rejects with 401 if verification fails or the token's email is unverified.
  - Google sign-in resolves to a `User` by email: if no user with that email exists in the tenant it is created on the fly (no password set); if a user with that email already exists — regardless of whether that account was originally created via password registration or a prior Google sign-in — the same account is reused and logged into, with no separate identity-linking step or conflict prompt. An account created via Google sign-in has no password hash, so password-based login against it always fails until the user separately sets a password via password recovery (FR-IAM-3).
  - If the platform-wide Google OAuth client id is not configured, the endpoint rejects with a specific 401 explaining Google sign-in is enabled for the tenant but not yet configured on the server, rather than a generic failure.
- **FR-MT-7 — Tenant-aware email.** Transactional email (registration, password reset) is sent through a provider-agnostic email port and reflects the sending tenant's branding (tenant name, and logo if configured) in both the subject and the HTML body, with tenant-controlled values HTML-escaped before interpolation. If no email provider is configured for the deployment, sends are skipped (logged, not thrown) so registration/password-recovery flows still succeed without email wired up; any provider failure is caught and swallowed rather than failing the triggering request.
- **FR-MT-8 — Tenant-scoped password management.** Forgot/reset/change-password flows are tenant-scoped, since the same email address may exist independently across multiple tenants.
  - A forgot-password request is resolved against the *requesting tenant's* user table only; it never matches or leaks the existence of an account with the same email in a different tenant.
- **FR-MT-9 — Platform Admin console.** Platform Admins operate through their own authenticated area (structurally separate credential/token type from tenant Users) to create/suspend/configure tenants and manage the package/feature catalog.

### 4.2 Packages, Features, Rate Limits & Billing

- **FR-PKG-1 — Feature catalog.** The platform defines a catalog of `Feature`s, each with a unique key, a usage unit, and a reset period (none / daily / monthly).
  - Feature key is immutable once referenced by any package (renaming would silently break enforcement bound to the old key); a key naming convention (`domain.action`, e.g. `exams.create`, `pdf.generations`) keeps the catalog self-describing.
  - `resetPeriod = none` denotes a lifetime cap (e.g. total curricula allowed), not a recurring one.
  - Creating a feature with a duplicate key is rejected with a specific validation error.
- **FR-PKG-2 — Package catalog.** The platform defines a catalog of `Package`s (e.g. Starter, Pro, Enterprise), each with a name, price, currency, and active/inactive state.
  - `isActive = false` hides a package from new-subscription flows without breaking tenants already subscribed to it (a retired package keeps enforcing its configured limits for existing subscribers until they're migrated).
  - `sortOrder` determines catalog display order in pricing/plan-selection UI.
- **FR-PKG-3 — Feature-to-package configuration.** Each package configures, per feature, whether it is enabled and — if enabled — an optional numeric limit per reset period; an absent limit means unlimited use of that feature on that package.
  - A feature absent from a package's configuration is treated as disabled for that package (default-deny), not default-allow — a new feature added to the catalog does not silently become usable on every existing package.
  - Updating a package's feature set replaces the full set atomically (no partial-apply state visible mid-update).
- **FR-PKG-4 — Tenant subscription.** Each tenant subscribes to exactly one active package at a time. Subscription status (active, past due, canceled) is tracked and kept current.
  - Changing a tenant's package takes effect immediately for enforcement purposes; usage already recorded in the current period against the old package's limits carries forward (not reset) unless the platform admin explicitly resets it.
  - A tenant with no subscription record (e.g. mid-provisioning) is treated as having zero enabled features, never as unlimited.
- **FR-PKG-5 — Usage tracking & enforcement.** Every gated action increments a per-tenant, per-feature, per-period usage counter. Requests to a gated action are rejected once the tenant's package limit for that feature and period is reached; the request is otherwise allowed and the counter incremented. Enforcement is applied at the point of the guarded action, not merely logged.
  - Rejection response identifies the feature, the limit, and when the current period resets, so the caller/UI can present an actionable upgrade prompt rather than a generic failure.
  - The increment itself (recording that a request consumed one unit) is a single atomic upsert keyed on tenant+feature+period, so two concurrent increments never clobber each other's count. The preceding limit check reads the current count before that upsert rather than being combined with it into one conditional statement; at low-to-moderate concurrency for a given tenant+feature this is an accepted trade-off, with a single conditional-update (compare-and-swap) version identified as the upgrade path if it ever becomes a real capacity problem under high concurrent load on the same tenant+feature.
  - Current usage and remaining quota for a tenant's own features are readable by that tenant's Admin (self-service visibility), not only by Platform Admins.
- **FR-PKG-6 — Billing integration.** Tenant subscriptions are backed by a payment provider (Stripe): a hosted Checkout Session for a tenant's chosen package (one monthly-recurring line item, price and currency taken from the package catalog), and webhook-driven sync of subscription status changes.
  - Creating a checkout session does not by itself grant access — the tenant's subscription only moves to `ACTIVE` when the corresponding `checkout.session.completed` webhook is received; an abandoned checkout leaves the tenant without access, and the tenant's Stripe customer id is recorded so a returning tenant reuses the same customer on a later attempt rather than accumulating duplicate customers.
  - Subscription status transitions (`ACTIVE`, `PAST_DUE`, `CANCELED`) are driven exclusively by verified webhook events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`), matched to the tenant's subscription by the Stripe subscription id; an event for a subscription id with no matching tenant record is logged and ignored rather than failing the webhook (so Stripe does not endlessly retry it).
  - A tenant whose subscription is `PAST_DUE` (Stripe's grace period for a failed payment) retains its assigned package's feature limits unchanged — no feature is downgraded or blocked during this state.
  - A `CANCELED` subscription falls back to a designated free/starter package's feature limits (looked up by a fixed package key) rather than to zero features, so existing data remains viewable and a baseline of functionality continues without an active paid plan; if that fallback package does not exist in the catalog, the tenant is treated as having zero enabled features (fail closed) rather than silently keeping its old paid-plan limits.
  - Every webhook event's signature is verified against the platform's webhook signing secret before processing; a signature that fails verification is rejected outright (401) without revealing why, and unrecognized event types are accepted (200) but otherwise ignored.
  - Only a Platform Admin can initiate a checkout session for a tenant; there is no self-serve "upgrade my plan" flow for a Tenant Admin in the current scope, though a Tenant Admin can view their tenant's own subscription status.
- **FR-PKG-7 — Platform Admin management UI.** Platform Admins can view/create/edit the feature and package catalog, and view/reassign any tenant's active subscription.

### 4.3 Identity & Access Management

- **FR-IAM-1 — Authentication.** Users authenticate via email + password, receiving a signed bearer token (with a defined expiry) usable on subsequent requests. Passwords are stored using a strong one-way hash.
  - A failed login (unknown email or wrong password) returns the same generic error either way, so the endpoint cannot be used to enumerate valid emails.
  - Successful login records a last-login timestamp on the user record.
  - Token expiry triggers a clean re-authentication requirement on the client; there is no silent refresh — the user is prompted to log in again once the token lapses.
- **FR-IAM-2 — Registration.** New users register with email, password, first and last name, subject to the tenant's registration settings (FR-MT-6).
  - Email uniqueness is enforced per tenant (not globally) — see FR-MT-8.
  - Password must meet a minimum-strength policy (length at minimum; complexity rules configurable) enforced server-side, not only in the UI.
  - A newly registered user receives no roles by default unless the tenant configures a default role for self-registered users (e.g. auto-assign Member).
- **FR-IAM-3 — Password recovery.** Users can request a password-reset token via email and use it, within its validity window, to set a new password. Authenticated users can change their password by supplying their current password.
  - The reset token is single-use and expires after a fixed window (default 1 hour); an expired or already-used token is rejected with a specific error distinguishing "expired" from "invalid."
  - Requesting a reset for a non-existent email still returns a success response (no account-existence disclosure), while silently doing nothing server-side.
  - Changing a password while authenticated requires the correct current password; on success, the new password takes effect immediately for future logins (existing issued tokens remain valid until their own expiry — no forced global logout).
- **FR-IAM-4 — Profile.** Users can view and update their profile (name, phone, occupation, company, country, education level) and upload a profile picture, served via a time-limited, tamper-proof signed URL.
  - Editable fields are validated for length/format server-side; email is not editable via the profile endpoint (it is the login identifier).
  - Profile picture upload is restricted to standard image types and a maximum file size; replacing a picture does not orphan the previous file indefinitely (subject to a defined cleanup policy).
- **FR-IAM-5 — Role-based access control.** The platform provides a granular permission engine: named `Permission`s grouped by domain (Users, Roles, Permissions, Exams), assignable to named `Role`s, which are assignable to `User`s (many-to-many in both directions). A user's effective permissions are the union of their assigned roles' permissions.
  - Permission checks fail closed: absence of an explicit grant is always a denial, never a default allow.
  - A permission or role cannot be deleted while still referenced (by a role or a user, respectively) without an explicit cascade/reassignment step, to avoid silently stripping access from users who depend on it.
- **FR-IAM-6 — Standard tenant roles.** Every tenant is seeded with, at minimum, a Tenant Admin role (full user/role/permission/exam management) and a Member role (exam-taking access plus implicit ownership of their own curricula and attempts). Additional custom roles may be defined per tenant on top of the same permission engine.
  - A tenant always retains at least one user holding the Tenant Admin role — removing the last Tenant Admin (by role change or deletion) is rejected, to prevent a tenant from becoming unmanageable.
- **FR-IAM-7 — Administrative user management.** Tenant Admins can list (with search/sort/paginate), view, create, update, and delete users within their tenant, and assign/remove roles.
  - Creating a user administratively allows an optional temporary password (defaulting to a known placeholder value if omitted) and an optional initial role assignment.
  - Deleting a user is a hard delete of the account; ownership of that user's prior attempts/curricula follows a defined retention rule (retained for reporting/audit, not silently deleted along with the account) rather than being left undefined.

### 4.4 Taxonomy

- **FR-TAX-1 — Hierarchy.** The platform maintains a hierarchical reference taxonomy: `Education Level → Stage → Subject`, each level uniquely named within its parent (e.g. two Stages under the same Education Level cannot share a name, but the same Stage name may exist under two different Education Levels).
- **FR-TAX-2 — Create-or-fetch semantics.** Exam managers can browse and create taxonomy entries at any level; creating an entry whose name already exists under the same parent returns the existing entry rather than creating a duplicate or erroring, so client code can "ensure this exists" without a separate existence check.
  - Name validation: required, trimmed, 2–150 characters; comparison for duplicate detection is case-insensitive.
- **FR-TAX-3 — Scoping.** Exam Types, Curricula, and generated content are scoped to a `Stage`/`Subject`, which drives grounding, adaptive selection, and reporting.
- **FR-TAX-4 — Deletion constraint.** A taxonomy entry referenced by any Exam Type, Curriculum, or User (via education level) cannot be deleted outright; it must be reassigned or the dependents removed first, preventing orphaned foreign keys.

### 4.5 Exam Authoring

- **FR-AUTH-1 — Manual (ZIP) authoring.** An exam manager can create an Exam Type by uploading a ZIP archive whose top-level folders represent subjects/modules and whose `.json` files each represent one multiple-choice question (text, options, correct answer, explanation). On upload, the platform validates the structure, persists the Exam Type configuration, extracts the archive into managed storage, and records the storage location against the Exam Type. Duplicate exam type names are rejected.
  - Required fields at creation: name (unique, non-empty), total question count, total duration in minutes, and at least one module (name + question count).
  - Validation failures (malformed zip structure, a `.json` question file missing a required field, a module folder with zero valid questions) reject the whole upload — no partial Exam Type is left behind; any storage already extracted during a failed attempt is rolled back/deleted.
  - The declared total question count should reconcile with the sum of per-module counts; a mismatch is flagged rather than silently accepted.
- **FR-AUTH-2 — AI-assisted authoring.** An exam manager can create or extend an Exam Type from AI-processed source documents (see §4.6), reviewing and editing generated content before it becomes part of a live exam.
- **FR-AUTH-3 — Module configuration.** An Exam Type defines one or more modules, each with a name and a target question count; the sum of module counts governs how an attempt is assembled.
  - A module's question count must not exceed the number of questions actually available to it at attempt-generation time (enforced at attempt start — see FR-TAKE-3 — not only at authoring time, since the bank can grow/shrink after authoring).
- **FR-AUTH-4 — Curriculum linking.** An Exam Type may be linked to one or more Curricula, each link carrying a context weight and, optionally, a restriction to specific modules — used to ground AI generation and grounding-aware review for that exam.
  - Context weight is a bounded integer (1–10) expressing relative grounding priority when multiple Curricula are linked to the same Exam Type.
- **FR-AUTH-5 — Deletion.** Deleting an Exam Type removes its configuration, its stored question content, and any cache entries derived from it; cascading cleanup includes any generated-question sessions and images uniquely tied to it.
  - An Exam Type with in-progress Attempts is either blocked from deletion or deletion is deferred until those attempts complete/expire — an in-progress attempt must never be left pointing at a deleted Exam Type.
- **FR-AUTH-6 — Retroactive subject re-mapping.** An exam manager can trigger a re-classification pass over an already-authored Exam Type's questions to correct their subject/module mapping without re-uploading source material; already-correctly-mapped questions are left untouched so the operation is cheap and safely repeatable.

### 4.6 AI-Powered Document Processing Pipeline

- **FR-PDF-1 — Upload & validation.** A user uploads a PDF (≤ a configured maximum size, default 50MB); the platform validates it is a genuine PDF (file-signature check), computes a content hash, and creates a processing session that the client can poll for status.
  - Rejections are specific: non-PDF signature, wrong extension, oversized file, and empty/zero-byte file each produce a distinct, actionable error rather than one generic "upload failed."
  - The session is created and an identifier returned to the caller *before* any AI work begins — the endpoint never blocks on classification or generation.
  - Optional inputs at upload: a content-type hint (to skip classification when the caller already knows it's an exam), a target Subject, and a force-reprocess flag.
- **FR-PDF-2 — Deduplication.** Before running any AI processing, the platform checks whether an identical or semantically equivalent document (by exact hash, then by semantic fingerprint similarity above a high threshold) has already been successfully processed; if so, its resulting questions are reused for the new session and the AI pipeline is skipped, unless the caller explicitly forces reprocessing.
  - Exact-hash match is checked first (cheapest); semantic fingerprint match is only attempted if the exact match misses.
  - A reused session is marked as such in its generation-method metadata so reviewers can see a question originated from cache, not fresh generation.
- **FR-PDF-3 — Content classification.** The platform classifies each processed document as `lesson`, `exam`, or `reference`, along with a topic list and an estimate of achievable questions per page, to select the correct downstream processing branch.
  - An explicit content-type hint from the uploader bypasses classification entirely for that value.
  - A classification result outside the three recognized types is treated as a processing failure with a specific error identifying the unrecognized label, not silently coerced to a default branch.
- **FR-PDF-4 — Lesson question generation.** For lesson content, the platform generates new multiple-choice questions covering the material's concepts, avoiding duplicate concept coverage within the same document, targeting a question count derived from document length and estimated density (bounded by configured minimums/maximums).
  - Each generated question includes: question text, 4–5 answer options, exactly one correct option, a 2–3 sentence explanation, a difficulty/Bloom's-level indicator, and a confidence score.
  - Generation proceeds in bounded batches (not one giant call) so a single oversized document cannot exceed a single call's practical token limit; concepts already covered by earlier batches are carried forward so later batches don't repeat them.
- **FR-PDF-5 — Exam question extraction.** For exam content, the platform extracts existing questions verbatim, determines whether the correct answer was explicitly provided in the source or must be inferred, and calibrates a confidence score accordingly.
  - Extraction processes the document by page; a page with negligible extractable text is skipped rather than sent to the model.
  - An explicitly-answered question receives materially higher confidence than an inferred one, and the distinction (`provided` vs. `inferred`) is retained on the question record for reviewer visibility, not just folded into a single opaque score.
- **FR-PDF-6 — Reference indexing.** For reference content, the platform indexes the document into the user's Curriculum for future retrieval rather than generating questions from it.
  - If no Curriculum is specified/resolvable for the upload's Subject, one is created automatically (named from the source file) so reference material is never silently dropped.
- **FR-PDF-7 — Subject classification.** Generated or extracted questions are mapped to a real taxonomy subject rather than left tagged only by page location; this mapping can be retroactively re-run against already-imported content without disturbing already-correct mappings.
- **FR-PDF-8 — Review & edit.** Generated questions are presented for paginated human review: full text/option/answer/explanation editing, review-flagging, bulk deletion, and targeted regeneration (replacing selected questions with freshly generated ones from the same source, preserving the original count).
  - Editing a generated question's content marks it as no longer purely auto-generated (a human-touched flag), distinct from the review-flag, so downstream reporting can distinguish "AI output, unedited" from "AI output, human-corrected."
  - Bulk delete and regenerate operations accept a list of question ids and are no-ops (not errors) on an empty list, so batch UI actions don't need to special-case "nothing selected."
- **FR-PDF-9 — Finalize into an Exam Type.** A reviewer selects questions meeting a confidence threshold (optionally restricted to auto-generated-only), configures modules, exam name, description, duration, and total question count, and finalizes them into a new Exam Type; the eligible questions are grouped into modules by their detected source section.
  - If no question in the session meets the selection criteria, finalize is rejected with a specific error rather than creating an empty Exam Type.
  - The reviewer may optionally link one or more Curricula to the resulting Exam Type as part of the same finalize action (FR-AUTH-4).
- **FR-PDF-10 — Append to an existing Exam Type.** A reviewer can append newly generated/reviewed questions into an existing AI-authored Exam Type's modules, increasing its module and total question counts.
  - Appending is rejected against an Exam Type that was authored via the legacy ZIP path (FR-AUTH-1), since it lacks the manifest structure the AI pipeline appends to; the error explains this distinction rather than failing generically.
  - Appending is idempotent — re-submitting the same append request after a partial failure does not duplicate already-appended questions.
- **FR-PDF-11 — Image handling.** Images extracted from a source document are stored (deduplicated by content hash), associated with the questions whose source location overlaps the image's page, and rendered inline in the review and exam-taking experience with alt text.
- **FR-PDF-12 — Cost and usage accounting.** Every AI call's token usage and cost is recorded against its processing session; a configured per-session token and cost budget bounds how much any single document can consume, and a session that would exceed its budget completes gracefully with whatever was generated so far rather than failing outright.
- **FR-PDF-13 — Full-bank lesson assessment.** For a Curriculum document, the platform can generate a complete, difficulty-tiered question bank covering the whole document as a standalone fixed-length assessment, resumable from the last successfully completed section if interrupted.
  - The resulting assessment is a fixed, well-known shape (a defined question count and duration) so students get a consistent "assess this lesson" experience regardless of source document length.
  - If interrupted, resuming never re-generates already-completed sections and never loses already-generated questions, even across an application restart.

### 4.7 Curriculum & Retrieval-Augmented Generation

- **FR-CUR-1 — Curriculum ownership.** A Curriculum is owned by the Member or Tenant Admin who created it, scoped to a single Subject, and contains one or more uploaded documents.
  - Only the owner (or a Tenant Admin acting in an oversight capacity) can modify or delete a Curriculum; other Members cannot see or use a Curriculum they do not own, once per-user ownership is in effect (see FR-CUR-1a below).
  - **FR-CUR-1a — Ownership scope.** Curriculum ownership is enforced at the individual-user level, not merely at the tenant level — two Members in the same tenant do not share each other's Curricula by default.
- **FR-CUR-2 — Document ingestion.** Uploading a document to a Curriculum extracts its text, splits it into overlapping context-preserving chunks tagged with source page, and embeds each chunk for semantic retrieval.
  - Multiple documents can be uploaded to the same Curriculum in one request; each is validated and processed independently so one bad file doesn't block the rest.
  - A document upload with no usable extractable text (e.g. an empty file) is rejected with a specific error before any embedding cost is incurred.
- **FR-CUR-3 — Semantic search.** A user can search within a Curriculum by free-text query and receive the most relevant source excerpts with their originating document and page.
  - An empty query returns an empty result set rather than an error or an arbitrary "browse everything" listing.
- **FR-CUR-4 — Grounded generation.** Every AI generation feature that needs subject-matter context (lesson generation, exam extraction, prompt-based practice) retrieves the most relevant chunks from the relevant Curriculum and includes them as grounding context in its prompt, rather than generating from the model's unaided knowledge alone.
- **FR-CUR-5 — Prompt Practice.** A user can request a set of 1–30 practice questions generated live from a free-text prompt, grounded against a chosen Curriculum, with confidence calibrated by how much relevant grounding context was actually found.
  - An empty prompt, a question count outside the 1–30 range, or a nonexistent Curriculum id are each rejected with a distinct, specific validation error.
  - If generation yields zero usable questions (e.g., an unanswerable prompt), the session is marked failed with a message suggesting a more specific prompt or a different Curriculum, rather than silently returning nothing.
- **FR-CUR-6 — Adaptive Lesson Practice.** A user can request a practice set for a subject or a specific document; the platform first draws from the existing packaged question bank for that scope (ranked by relevance to the document when document-scoped, or selected for topical diversity when subject-scoped) before generating any new questions to fill a shortfall — minimizing redundant AI calls.
  - Document-scoped requests must resolve to a real, non-empty question bank for the requested stage/subject; a document merely being *present* in a Curriculum with no packaged questions behind it does not by itself satisfy a practice request — the bank, not the raw document, is the source of practice questions.
- **FR-CUR-7 — Curriculum-exam linkage.** Curricula linked to an Exam Type (FR-AUTH-4) participate in that exam's generation and review grounding.
- **FR-CUR-8 — Cascading deletion.** Deleting a Curriculum document removes its indexed vectors, its stored file, its database record, and cascades to any processing sessions and any Exam Types produced solely from it.
  - Cascading Exam Type deletion here follows the same rules as FR-AUTH-5 (blocked/deferred while in-progress Attempts exist).

### 4.8 Exam Taking & Adaptive Practice

- **FR-TAKE-1 — Discovery.** A Member can list available Exam Types visible to them and view an instructions screen (modules, total questions, total duration) before starting.
- **FR-TAKE-2 — Attempt generation.** Starting an exam builds a randomized question set per the Exam Type's module configuration. Selection is adaptive: for each module, questions the Member has never attempted are prioritized first, then questions previously answered incorrectly, then questions previously answered correctly — each group independently shuffled — until the module's required count is filled; the full selection is then shuffled across modules and persisted as the attempt.
  - "Previously answered" is determined from the Member's own attempt history only, using the *most recent* answer to each question (a question corrected on a later attempt is no longer treated as "wrong").
  - Only one attempt at a time may be `InProgress` per Member per Exam Type; starting a new attempt while one is already in progress either resumes the existing one or is rejected — it never silently creates a second concurrent attempt against the same Exam Type.
- **FR-TAKE-3 — Insufficient bank handling.** If a module's question bank cannot supply its required count, attempt generation fails with a clear, specific error naming the deficient module and stating the shortfall (available vs. required).
- **FR-TAKE-4 — Timed navigation.** During an attempt, the Member sees one question at a time within a persistent header showing exam name, current question number of total, and an elapsed-vs-total timer; the final question's action changes from "Next" to "Submit."
  - Navigating to a question index outside the attempt's range, or belonging to a different attempt, is rejected (not found), never silently clamped to a nearby valid index.
- **FR-TAKE-5 — Answering.** The Member selects one option per question; a selection can be changed while the attempt is in progress. Answering is not permitted once the attempt is no longer in progress.
  - Submitting an answer to a question that does not belong to the specified attempt is rejected (not found), preventing cross-attempt tampering.
- **FR-TAKE-6 — Auto-submit.** An attempt is automatically submitted when the total allowed time elapses, regardless of how many questions were answered.
- **FR-TAKE-7 — Scoring.** On submission, the platform computes answered/correct/wrong counts and a percentage score, and marks each answer's correctness case-insensitively against the correct option.
  - Score = correct ÷ total questions × 100, rounded to one decimal place; an Exam Type with zero total questions defensively scores 0 rather than dividing by zero.
  - Submitting an attempt that is not currently in progress (already submitted or timed out) is rejected with a specific error, not silently re-scored.
- **FR-TAKE-8 — Review.** After submission, and for any past attempt, the Member can review either the wrong-only subset or the full question set, each shown with the question, all options, the Member's selection, correctness, and the explanation.
  - Review ordering is always by the question's original position in the attempt, regardless of filter, so "wrong only" is a subset view, not a re-ordered one.
- **FR-TAKE-9 — Attempt history.** A Member can list all of their own past attempts, optionally filtered to one Exam Type. A Tenant Admin can list all attempts across the tenant with the same level of detail.

### 4.9 Files & Media

- **FR-FILE-1 — Signed delivery.** All user-facing file access (avatars, question images, source documents) is served through time-limited, tamper-evident signed URLs rather than direct, permanently-guessable paths.
  - A signature that fails verification, or a URL past its expiry, is rejected with a specific "link invalid or expired" response distinct from a generic 404, so clients can prompt a fresh link request rather than treating it as a missing file.
  - A signed URL cannot be used to traverse outside its intended storage root (path-traversal sequences are rejected regardless of signature validity).
- **FR-FILE-2 — Range support.** File delivery supports HTTP range requests so that media (large PDFs, images) can be seeked/streamed rather than fully downloaded before use.
- **FR-FILE-3 — Image association.** Stored images can be linked to a specific question at a specific position (within the question text, a given option, or the explanation), each with an optional caption and required alt text.
  - The same stored image can be associated with more than one question (e.g., a shared diagram); usage count is tracked so a still-referenced image is not deleted when only one of its associations is removed.

### 4.10 Platform Reliability

- **FR-REL-1 — Asynchronous side effects.** Domain events (e.g., a user being created) are recorded transactionally with the triggering change and published to interested consumers asynchronously, so a downstream failure in a side effect never rolls back the primary action.
  - Publication is at-least-once: a consumer must tolerate receiving the same event more than once (idempotent handling), since the outbox does not guarantee exactly-once delivery.
- **FR-REL-2 — Resumable long-running jobs.** Any generation job spanning multiple AI calls (full-bank assessment generation in particular) tracks its own progress watermark, so an interruption resumes from the last completed unit of work rather than restarting or silently losing partial progress.
  - The watermark advances only after its corresponding output (generated questions) is durably persisted, so a crash between "generated" and "persisted" re-does that one unit of work rather than skipping it — the system never advances progress ahead of what it has actually saved.
- **FR-REL-3 — Stale session recovery.** A background process periodically identifies and resolves processing sessions that are stuck (crashed mid-run) or still pending, either resuming or failing them with a clear error, so no session is left indefinitely in an ambiguous state.
  - "Stuck" is determined by a heartbeat timestamp updated periodically by the active worker; a session whose heartbeat has not updated within a defined grace period is eligible for recovery by another worker pass.

---

## 5. Data Model (Detailed)

The model is split into two physical scopes regardless of which multi-tenancy isolation mode is active (§ FR-MT-3): a **platform store**, always shared, and a **tenant store**, isolated per tenant according to the active mode. All identifiers are UUIDs unless otherwise noted; all timestamps are UTC.

### 5.1 Platform-level entities

**`Tenant`**
| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| name | string | Display name |
| subdomainSlug | string, unique | Immutable once set; lowercase alphanumeric + hyphen; max 63 chars |
| databaseName | string, unique | Name of the tenant's dedicated database/schema under the active isolation mode |
| status | enum(`Active`,`Suspended`) | |
| isDefault | boolean | Marks the single tenant used for non-production/local requests (FR-MT-2) |
| allowEmailRegistration | boolean | Default true |
| allowGoogleSignIn | boolean | Default false |
| logoUrl | string, nullable | Used for tenant-branded transactional email (FR-MT-7) |
| createdAt, updatedAt | datetime | |

**`PlatformAdmin`** — id, email (unique, platform-wide), passwordHash, name, createdAt.

**`Feature`** — id, key (unique, immutable once referenced), name, description (nullable), unit (e.g. "generations", "exams"), resetPeriod enum(`NONE`,`DAILY`,`MONTHLY`), createdAt.

**`Package`** — id, key (unique), name, description (nullable), priceCents (int, default 0), currency (default `usd`), isActive (boolean, default true), sortOrder (int), createdAt, updatedAt.

**`PackageFeature`** — id (PK), packageId (FK), featureId (FK), limit (int, nullable = unlimited), enabled (boolean, default true). Unique on (packageId, featureId).

**`TenantSubscription`** — id, tenantId (FK, unique — one subscription per tenant), packageId (FK), status enum(`ACTIVE`,`PAST_DUE`,`CANCELED`; default `ACTIVE`), stripeCustomerId (string, nullable), stripeSubscriptionId (string, nullable), currentPeriodStart, currentPeriodEnd (nullable), createdAt, updatedAt.

**`TenantFeatureUsage`** — id, tenantId (FK), featureId (FK), periodKey (string, e.g. `2026-08` for monthly, `2026-08-07` for daily, `lifetime` for a `NONE`-reset feature), count (int, default 0), updatedAt. Unique on (tenantId, featureId, periodKey).

### 5.2 Tenant-scoped entities

**Taxonomy**
- `EducationLevel` — id (int, PK), name (unique), createdAt.
- `Stage` — id (int, PK), educationLevelId (FK), name (unique within educationLevelId), createdAt.
- `Subject` — id (int, PK), stageId (FK), name (unique within stageId), createdAt.

**Identity**
- `User` — id (UUID, PK), email (unique within tenant), firstName, lastName, passwordHash (nullable — null for OAuth-only accounts), phone, occupation, companyName, country, educationLevelId (FK, nullable), pic (storage key, nullable), isActive (boolean), passwordResetToken (nullable), passwordResetTokenExpiry (nullable), createdAt, lastLoginAt.
- `Role` — id (int, PK), name (unique), description, createdAt.
- `Permission` — id (int, PK), name (unique), description, group (e.g. "Users", "Exams"), createdAt.
- `UserRole` — userId (FK), roleId (FK). Composite PK.
- `RolePermission` — roleId (FK), permissionId (FK). Composite PK.

**Exam authoring**
- `ExamType` — id (UUID, PK), name (unique within tenant), totalQuestions (int), totalMinutes (int), storagePath, stageId (FK, nullable), storageMode enum(`LocalDisk`,`ObjectStore`), kind enum(`Standard`,`LessonPractice`,`LessonAssessment`), createdAt.
- `ExamModule` — id (UUID, PK), examTypeId (FK), moduleName, questionCount (int).
- `ExamTypeQuestion` — a packaged question filed under an Exam Type/module: id, examTypeId (FK), moduleName, questionText, optionsJson, correctAnswer, explanation, sourceGeneratedQuestionId (FK, nullable — traceable back to its AI origin if applicable).
- `ExamTypeCurriculum` — examTypeId (FK), curriculumId (FK), contextWeight (int, 1–10), applicableModulesJson (nullable). Composite PK (examTypeId, curriculumId).

**Curriculum / RAG**
- `Curriculum` — id (UUID, PK), name, description, subjectId (FK), ownerUserId (FK — per-user ownership), createdAt, updatedAt.
- `CurriculumDocument` — id (UUID, PK), curriculumId (FK), fileName, title (nullable), contentType enum(`Reference`), storageKey, pageCount (nullable), uploadedAt.
- *(Vector-store side, not relational, see §13.4–13.5):* content chunks and question-bank embeddings keyed by `curriculumId`/`documentId`/`examTypeId` payload filters.

**AI pipeline**
- `PdfProcessingSession` — id (UUID, PK), initiatedByUserId (FK), sourceFileName, contentTypeHint (nullable), contentType enum(`Lesson`,`Exam`,`Reference`, nullable until classified), status enum(`Pending`,`Extracting`,`Classifying`,`Processing`,`Completed`,`Failed`), errorMessage (nullable), totalQuestions (int), successfulQuestions (int), storageKeyPrefix, subjectId (FK, nullable), curriculumDocumentId (FK, nullable), fileHash (SHA-256), forceReprocess (boolean), tokensUsed (int), totalCost (decimal), lastCompletedPage (int, watermark), resumeAttempts (int), heartbeatAt (nullable), createdAt, updatedAt, completedAt (nullable).
- `GeneratedQuestion` — id (UUID, PK), processingSessionId (FK), subjectId (FK, nullable), questionText, optionsJson, correctAnswer, explanation, questionType, bloomsLevel (1–6, nullable), sourcePageRange, sourceSection, confidenceScore (0–1), generationMethod (e.g. `lesson_generation`, `exam_extraction_with_key`, `exam_extraction_inferred`, `reused_from_cache`, `regenerated`), isAutoGenerated (boolean), isReviewFlagged (boolean), notes (nullable), linkedExamTypeId (FK, nullable — set once finalized/appended), createdAt, updatedAt.

**Exam delivery**
- `Attempt` — id (UUID, PK), userId (FK), examTypeId (FK), startTime, endTime (nullable), status enum(`InProgress`,`Submitted`,`TimedOut`).
- `AttemptQuestion` — id (UUID, PK), attemptId (FK), questionIndex (int, 0-based, defines display order), subjectName, questionFileName (identity used for adaptive history matching), questionText, optionsJson, correctAnswer, selectedOption (nullable), isCorrect (nullable, null until answered), explanation.

**Media**
- `StoredImage` — id (UUID, PK), fileName, originalFileName, contentType (MIME), fileSize, fileHash (SHA-256, dedup key), storageKey, sourcePageNumber (nullable), sourceDocumentId (FK, nullable), generatedAltText (nullable), extractedAt, usageCount (int).
- `QuestionImage` — id (UUID, PK), generatedQuestionId (FK), imageId (FK), sequenceOrder (nullable), caption (nullable), altText, position enum(`question_text`,`option`,`explanation`), width/height (nullable).

**Reliability**
- `OutboxMessage` — id (UUID, PK), eventType (e.g. `user.created`), payload (JSON), createdAt, processedAt (nullable).

### 5.3 Key relationships

- A `Tenant` has many `User`s, `ExamType`s, `Curriculum`s, and exactly one `TenantSubscription`.
- A `User` has many `Role`s; a `Role` has many `Permission`s (both many-to-many via join tables).
- An `ExamType` has many `ExamModule`s and many `ExamTypeQuestion`s, and may link many `Curriculum`s via `ExamTypeCurriculum`.
- A `Curriculum` belongs to exactly one owning `User` and one `Subject`, and has many `CurriculumDocument`s.
- A `PdfProcessingSession` produces many `GeneratedQuestion`s; each `GeneratedQuestion` optionally links to the `ExamType` it was finalized/appended into, and optionally to an originating `CurriculumDocument` (for lesson-assessment sessions).
- An `Attempt` belongs to one `User` and one `ExamType`, and has many `AttemptQuestion`s (one per question in that attempt, ordered by `questionIndex`).
- A `GeneratedQuestion` may have many `QuestionImage` associations to `StoredImage`s (many-to-many via the join, since one image can illustrate multiple questions).

### 5.4 Entity-relationship overview

```
Tenant 1───1 TenantSubscription ───* PackageFeature ───1 Package
  │                                                        │
  │                                                     1 Feature (per row)
  │
  ├──* User ──*───* Role ──*───* Permission
  │     │
  │     └──* Curriculum ──* CurriculumDocument
  │              │
  │              └──(vector chunks, payload-filtered)
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

## 6. Non-Functional Requirements

- **NFR-1 Performance.** Document processing should complete within a target average time regardless of document size within the supported maximum; standard API responses should meet a defined p95 latency target; image extraction should succeed at a high defined rate.
- **NFR-2 Scalability.** The platform must support a growing number of tenants without degrading isolation guarantees or per-tenant performance; background processing must scale independently of request-serving capacity.
- **NFR-3 Reliability.** No user-facing action should be lost due to a transient downstream failure (AI provider outage, vector store outage); long-running jobs must be resumable; every write establishing tenant data must be atomic with respect to its provisioning workflow.
- **NFR-4 Security.** All authenticated endpoints require a valid bearer token; passwords are never stored in reversible form; file access is never guessable; Platform Admin and tenant User credentials are structurally incompatible with one another; all tenant data under any isolation mode is inaccessible to any other tenant's request context.
- **NFR-5 Usability.** Core author and exam-taking flows should require a minimal number of steps; error messages must be specific enough to act on (e.g., naming the deficient module, not a generic failure).
- **NFR-6 Maintainability.** Business logic is implemented independent of the HTTP framework and independent of the specific data-access, vector-store, and LLM providers, so any of these can be swapped without rewriting domain logic.
- **NFR-6a Diagnosability.** Every process writes its console output to a durable, dated log file in addition to the console, so operational history survives past terminal/process lifetime and is inspectable without live terminal access; a failure to write the log file never interrupts the request or job that produced the log line.
- **NFR-7 Cost Management.** Every AI call's cost is tracked; sessions cannot silently exceed a configured cost/token budget.
- **NFR-8 Engineering standard.** All feature work follows consistent module conventions, is unit-tested at the service/business-logic layer, and is end-to-end tested for user-facing flows.

---

## 7. Constraints & Assumptions

- MySQL is the system-of-record database technology under every isolation mode.
- A single platform-wide OAuth client is used for "Sign in with Google" across all tenants; tenants do not bring their own OAuth credentials.
- Of the three designed tenant-isolation modes, only dedicated-datastore isolation (serving both the `database` and `schema` configuration values identically) is implemented; selecting the `shared` (row-level) mode is a supported configuration value that currently fails fast rather than silently degrading to a different isolation guarantee.
- Stripe subscriptions are single-price, monthly-interval, single-line-item only; multi-tier add-ons, annual billing, and coupon/promotion-code discounts are out of scope for the current billing integration.
- English is the only supported content/UI language for the current scope.
- Scanned (non-text) PDFs and other non-digital-text source material are out of scope for AI processing.
- Video/live-proctoring and anti-cheating measures beyond timed, single-question-at-a-time navigation are out of scope.

---

# PART 2 — SOLUTION DESIGN

*Prepared as a senior solution architecture view: high-level architecture first, then progressively detailed designs for the subsystems that carry the most technical risk (multi-tenancy, AI/RAG pipeline, data architecture, security, deployment).*

## 8. Architectural Style & Principles

ExamLand is built on **NestJS** (v10) as a **modular monolith** with clean internal layering, not a microservices system — a deliberate choice given team size and the tight coupling between exam authoring, AI processing, and delivery. Nest's module/controller/provider structure is the concrete realization of the layering described below, not merely a target shape to migrate toward. The design principles that constrain every subsystem below:

1. **Ports-and-adapters at every external dependency.** Data access, vector search, LLM inference, file storage, email, and payments are each accessed through an interface (a TypeScript port, e.g. `EmailPort`, `PaymentGatewayPort`, `TenantDataAccessStrategy`) owned by the domain and bound via Nest DI tokens; the concrete provider (MySQL/Prisma, Qdrant, OpenAI, local disk/S3, Nodemailer/SMTP, Stripe) is an adapter behind it, swappable by changing one provider binding. This is what makes NFR-6 achievable and is the single most important structural decision in the system.
2. **HTTP is a thin edge.** Nest controllers do request parsing (DTO validation via `class-validator`), auth/permission enforcement (guards), and response shaping only. All business logic lives in injectable services with no HTTP-framework imports; Express survives underneath only as Nest's `platform-express` HTTP adapter, plus two explicit low-level uses — a raw-body route for Stripe webhook signature verification, and static-file serving of the built Angular SPA.
3. **Tenant context is threaded, never assumed.** Every unit of business logic that touches tenant data receives its data-access handle from the request's resolved tenant context — no service silently assumes "the" database.
4. **Long-running work is asynchronous by default.** Anything involving an LLM call chain (PDF processing, full-bank generation) is modeled as a background job with persisted, pollable state — never a synchronous request held open for the duration of generation, except for small bounded operations (Prompt Practice's on-demand generation, capped at 30 questions).
5. **Every AI/vector operation degrades gracefully.** A vector-store or LLM outage must not corrupt a write path (e.g., index write-through is fire-and-forget after the authoritative write) or crash a request — it should log, skip, and let the primary action succeed.

## 9. High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          Client (Angular SPA)                         │
│   Tenant app (subdomain-routed)         Platform-Admin console        │
└───────────────────────────┬───────────────────────┬───────────────────┘
                            │ HTTPS/JSON             │ HTTPS/JSON
                            ▼                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          API Edge (NestJS on Express)                 │
│  Tenant-Resolution MW → Auth Guard → Permission/Feature Guards →       │
│  Controllers (HTTP-only)                                              │
└───────────────────────────┬───────────────────────┬───────────────────┘
                            │                        │
                 ┌──────────▼──────────┐   ┌─────────▼─────────┐
                 │  Domain Services     │   │ Platform Services │
                 │ (auth, exams, RAG,   │   │ (tenants, packages,│
                 │  attempts, curricula)│   │  billing sync)     │
                 └──────────┬───────────┘   └─────────┬──────────┘
                            │                          │
        ┌───────────────────┼──────────────────────────┼───────────────┐
        ▼                   ▼                          ▼               ▼
┌───────────────┐  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│ Tenant Data    │  │ Vector Store    │  │ LLM Provider      │  │ Platform Data    │
│ Access Layer   │  │ (Qdrant)        │  │ (OpenAI-compatible)│  │ Store (shared)   │
│ (mode-aware)   │  └────────────────┘  └──────────────────┘  └─────────────────┘
└───────┬────────┘
        │
 ┌──────▼───────────────────────┐        ┌───────────────────────────┐
 │ Tenant DB / Schema / Rows     │        │ File Storage (signed URLs) │
 │ (per active isolation mode)  │        │ local disk → S3-compatible │
 └───────────────────────────────┘        └───────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│                         Background Workers                            │
│  PDF-pipeline sweeper (resume/fail-stuck/pick-up-pending)              │
│  Outbox publisher (event delivery)                                    │
│  Feature-usage period reset                                           │
└───────────────────────────────────────────────────────────────────────┘
```

## 10. Module Decomposition

| Module | Responsibility |
|---|---|
| Tenancy | Tenant registry, resolution middleware, connection routing, provisioning workflow, sequential migration rollout |
| Platform Admin | Platform-scoped auth realm, tenant management console API |
| Packages | Feature/package catalog, subscription state, usage tracking, feature-limit guard/decorator |
| Billing | Stripe checkout-session creation, webhook ingestion and status sync, tenant-facing billing-status read endpoint |
| Identity | Authentication (password + Google sign-in), registration, password lifecycle, profile |
| Access Control | Role/permission engine, guards |
| Taxonomy | Education level / stage / subject reference data |
| Exam Authoring | Exam Type/Module CRUD, ZIP import, question-bank writer |
| PDF Processing | Upload, extraction, classification, generation/extraction orchestration, finalize/append |
| Curriculum | Document ingestion, chunking, embedding, search, cross-feature retrieval |
| Prompt/Lesson Practice | On-demand and adaptive practice generation |
| Attempts | Attempt lifecycle, adaptive selection, scoring, review |
| Media | Image storage, question associations, signed delivery |
| Reliability | Outbox pattern, background workers |
| Email | Provider-agnostic email port, SMTP adapter, tenant-branded transactional templates (registration, password reset) |
| Logging | Process-wide console-output mirror to dated log files, for diagnosability independent of terminal/process lifetime |
| Client Billing UX | Angular billing-status service and a past-due warning banner surfaced in the tenant's authenticated layout |

Each module is a self-contained unit: routes/controllers, a service layer with no framework imports, and its own data-access calls — mirroring the target NestJS module/controller/provider shape regardless of which HTTP framework is currently in front of it.

## 11. Multi-Tenancy Solution Design

### 11.1 Configurable isolation strategy

Isolation mode is a **deployment-time configuration value** (`TENANT_ISOLATION_MODE = database | schema | shared`, env-driven, default `database`), read once at boot in `TenancyModule`'s provider factory and used to bind the `TENANT_DATA_ACCESS_STRATEGY` DI token to one `TenantDataAccessStrategy` implementation:

```
interface TenantDataAccessStrategy {
  resolveClient(tenant: Tenant): PrismaClient;
}
```

- **`DedicatedDatastoreStrategy`** — bound for both `database` and `schema` config values, since under MySQL `CREATE SCHEMA` is a synonym for `CREATE DATABASE`; a distinct schema-level implementation is therefore unnecessary. `resolveClient` returns a pooled Prisma client for `tenant.databaseName` via a connection cache (`TenantConnectionService`), so a tenant's connection is opened once and reused across requests rather than per-request.
- **`SharedSchemaStrategy`** — bound for `shared`. This is currently a deliberate fail-fast placeholder: `resolveClient` throws rather than silently behaving like `database` mode, because row-level shared-schema isolation requires every tenant-scoped Prisma model to carry and be queried through a `tenantId` column, which has not been built into the schema. Selecting `shared` in the current deployment is therefore a supported *configuration value* whose *implementation* is intentionally not yet present — an operator must use `database` or `schema` today.

Both strategies satisfy the same interface and the same tenant-scoped Prisma schema, so no service-layer code branches on isolation mode — only the tenancy module and deployment configuration do, satisfying NFR-6. Completing the shared-schema strategy (adding `tenantId` to every tenant-scoped model and injecting the filter transparently at the ORM layer) is the identified next step for an operator who wants that isolation profile.

### 11.2 Request-time resolution flow

```
Request → TenantResolutionMiddleware (registered globally, excluding GET /health)
   1. Determine subdomain:
        - non-production (NODE_ENV !== "production"): fixed DEFAULT_TENANT_SUBDOMAIN from config
        - production: first label of the Host header
   2. Look up Tenant by subdomainSlug in the platform store
   3. Not found → 404 (never silently falls back to the default tenant,
      since that would serve a mistyped/stale subdomain a DIFFERENT tenant's data)
   4. strategy.resolveClient(tenant) → attach both tenant and its Prisma
      client to the request (req.tenant, req.tenantPrisma)
   5. Downstream guards/services use req.tenant / req.tenantPrisma exclusively
```

Per-tenant Prisma clients are cached and reused across requests (not opened per-request) for the dedicated-datastore strategy, so the number of concurrently active tenants does not unboundedly grow open connections.

### 11.3 Provisioning workflow

```
POST /platform/tenants  (Platform Admin only)
   1. Insert Tenant row (status = Active) in platform store
   2. strategy equivalent: create database/schema (or no-op for shared mode)
        - apply current tenant schema/migrations
        - seed: Tenant Admin role, Member role, default permissions,
          a default Tenant Admin user (invited, not password-set)
   3. Create default TenantSubscription (lowest/free package)
   4. On any failure: leave provisioned artifacts for manual/automatic
      cleanup retry (idempotent re-run of step 2)
```

### 11.4 Platform Admin vs. tenant identity separation

Two independent auth realms share only the signing infrastructure, never the claim shape or the guard logic:

| | Platform Admin token | Tenant User token |
|---|---|---|
| Subject | `PlatformAdmin.id` | `User.id` |
| Scope claim | `typ: platform-admin` | tenant roles + permissions |
| Guard | `PlatformAdminGuard` — rejects any token without the platform-admin type claim | `JwtAuthGuard` + `PermissionsGuard` — evaluated against tenant-resolved roles |
| Data reachable | Platform store only | Resolved tenant's data only |

This separation is enforced structurally (different claim shape checked by different guards), not just by which endpoints happen to be called — a stolen tenant-user token cannot be replayed against any platform-admin endpoint regardless of the roles/permissions attached to it.

## 12. Packages & Billing Solution Design

- **Catalog model**: `Feature(key, unit, resetPeriod)` × `Package(key, priceCents, currency)` joined by `PackageFeature(limit?, enabled)` — a sparse matrix, so adding a feature to one package doesn't require touching the others.
- **Enforcement**: `FeatureLimitGuard`, opted into per-route via a `@RequiresFeature(key)` decorator (a no-op when the decorator is absent), calls `FeatureUsageService.checkAndIncrement(tenantId, featureKey)`. That method resolves the tenant's effective `PackageFeature` row — the tenant's own assigned package for `ACTIVE`/`PAST_DUE` status, or a fixed free/starter package's row for `CANCELED` status (failing closed if that fallback package is missing) — reads the current period's `TenantFeatureUsage.count`, rejects with a specific "limit reached" `DomainException` if at/over a non-null limit, and otherwise records the usage via an upsert (`create` with `count: 1` or `update: { count: { increment: 1 } }`) keyed on the unique `(tenantId, featureId, periodKey)` triple. The upsert itself is atomic at the database level; the preceding read-then-compare is not combined with it into one conditional statement, so a burst of concurrent requests against the same tenant+feature at the exact limit boundary could allow a small overrun — an accepted trade-off at current concurrency, with a single compare-and-swap UPDATE identified as the fix if it becomes a real problem.
- **Period key derivation**: computed on read, not stored precomputed — `MONTHLY` → `YYYY-MM`, `DAILY` → `YYYY-MM-DD`, `NONE` → the literal string `lifetime` — so no scheduled "period rollover" job is needed; a new period's counter starts implicitly at its first increment because the composite key changes.
- **Billing sync**: Stripe is the payment provider of record, isolated to a single adapter (`StripePaymentGatewayAdapter`) that is the only file permitted to import the `stripe` package directly, behind a `PaymentGatewayPort`. `CreateCheckoutSessionUseCase` creates a single-line-item, monthly-recurring Stripe Checkout Session for a tenant/package pair (reusing the tenant's existing Stripe customer id if one is on file) and records the resulting customer id against the tenant's subscription without changing its status. `HandleStripeWebhookEventUseCase` is the single source of truth for `TenantSubscription.status`, driven only by signature-verified webhook events: `checkout.session.completed` sets `ACTIVE` (this is what actually grants access after checkout, not the checkout-session creation itself); `customer.subscription.updated` maps Stripe's status (`active`/`trialing`→`ACTIVE`, `past_due`/`unpaid`/`incomplete`→`PAST_DUE`, `canceled`/`incomplete_expired`→`CANCELED`, anything unrecognized defaults to `PAST_DUE` — fail toward restrictive) and refreshes the current period dates; `customer.subscription.deleted` sets `CANCELED` unconditionally. No coupon, promotion-code, or discount handling exists in the current billing integration — every checkout session is created at the package's full catalog price.
- **Endpoint surface**: session creation is Platform-Admin-only (`POST /api/tenants/:id/billing/checkout-session`); the webhook endpoint (`POST /api/billing/webhook`) carries no auth guard by design, trusting Stripe's signature instead, and is the one route excluded from the app's global JSON body parser so the raw byte stream needed for signature verification reaches Stripe's SDK unmodified; a tenant-facing read-only status endpoint (`GET /api/tenant/billing/status`, regular tenant-user auth) backs the client's past-due warning banner.

## 13. AI / RAG Pipeline Solution Design

### 13.1 Pipeline state machine

```
Pending → Extracting → Classifying → Processing → Completed
                                            └────────→ Failed
```

Each transition is a persisted write to `PdfProcessingSession.status`, making the pipeline resumable and pollable by design rather than by convention. A background sweeper worker is the only writer that moves a session out of `Pending`, decoupling upload (HTTP request) from processing (worker-driven), which is what lets the upload endpoint return immediately (202-style) regardless of how long generation takes.

### 13.2 Deduplication as a cost-control gate

Two cheap checks run **before** any expensive classification/generation call:

1. **Exact hash** — O(1) index lookup on `PdfProcessingSession.fileHash` against prior `Completed` sessions.
2. **Semantic fingerprint** — embed a fixed-size text sample once, similarity-search a dedicated small vector collection (not the main chunk collection, to keep it cheap and fast), threshold near-1.0 cosine similarity.

Either hit short-circuits straight to cloning the prior session's questions — the pipeline never even reaches `Extracting`. This is deliberately placed as a gate in front of the state machine, not inside it, so it's trivial to reason about and to disable (`forceReprocess`) per request.

### 13.3 Generation/extraction as strategy objects

Classification output selects one of three interchangeable generator strategies (`LessonGenerator`, `ExamExtractor`, `ReferenceIndexer`), each consuming the same `ExtractedDocument` (text + per-page text + images) and producing the same `GeneratedQuestion[]` shape (or, for the reference case, none). This uniform interface is what lets the orchestrator (`PdfProcessingService`) stay a fixed six-step sequence regardless of content type, and what makes adding a fourth content type in the future a matter of adding one more strategy, not touching the orchestrator.

### 13.4 Retrieval-augmented grounding

A single `RetrievalService` interface is shared by every feature that needs grounding context:

```
retrieve(scope: { curriculumId? , documentId? }, queryText: string, topK: number): Chunk[]
```

Callers differ only in what they pass for `queryText`/`topK`/scope — lesson generation embeds a document excerpt with topK=5, exam extraction does the same with topK=12, Prompt Practice embeds the user's literal prompt with topK=12. Centralizing retrieval behind one call site is the leverage point for the two most valuable pending quality improvements (relevance-score floor, hybrid keyword+vector search) — both can be added once, inside `RetrievalService`, and every caller benefits without individual changes.

### 13.5 Question-bank index as a second, purpose-built collection

Distinct from the document-chunk collection, a `question-bank` vector collection indexes only questions that have been packaged into a live Exam Type, keyed by a deterministic id (`hash(examTypeId + questionFileName)`) so re-classification (subject-mapping fixes) upserts in place instead of orphaning stale points. This index is what makes Adaptive Lesson Practice cheap: ranking or diversity-selecting against an already-embedded bank avoids re-embedding or re-generating anything for the common case where the bank already covers the requested practice scope.

### 13.6 LLM resilience layer

Every model call is issued through one function that owns: a primary-plus-fallback model chain per task type, bounded retry with exponential backoff restricted to transient failure classes (429/5xx/network) — a genuine bad-request failure moves straight to the next model rather than retrying a call that will never succeed — a hard wall-clock timeout enforced independently of the HTTP client's own timeout, and per-call cost accounting written back to the owning session. Swapping the underlying model provider means changing this one seam, not any of the generator strategies that call it.

```
generateWithFallback(task, prompt, maxTokens, temperature):
  for model in modelChain[task]:            # e.g. [primary, fallback1, fallback2]
    for attempt in 1..maxRetries:            # default 2
      try:
        response = callModel(model, prompt, maxTokens, temperature, timeout=90s)
        cost = promptTokens * pricePerPromptToken[model]
             + completionTokens * pricePerCompletionToken[model]
        recordCost(session, cost, promptTokens, completionTokens)
        return response
      catch TransientError (429 | 5xx | network):
        if attempt < maxRetries: sleep(backoff(attempt)); continue
        else: break                          # exhausted retries on this model, try next
      catch PermanentError (4xx):
        break                                # do not retry a call that cannot succeed
  raise AllModelsFailed(task)
```

### 13.7 Chunking algorithm

Source text is never embedded raw — it is first split by `ChunkingService` into overlapping, semantically-bounded segments:

- **Target chunk size**: ~1500 characters.
- **Overlap**: 200 characters between consecutive chunks, so a concept spanning a chunk boundary is still fully present in at least one chunk.
- **Cut points**: preferentially on paragraph breaks, then sentence boundaries, only falling back to a hard character cut if no natural boundary exists within the target window — this avoids splitting a sentence (and therefore a fact) across two chunks whenever avoidable.
- **Metadata carried per chunk**: source document id, source page number, a sequential chunk index within the document, and the chunk's raw text (the payload actually embedded and later returned to the caller verbatim).

### 13.8 Embedding & vector-search parameters

| Parameter | Value | Rationale |
|---|---|---|
| Embedding model | `text-embedding-3-small` (1536 dimensions) | Cost-efficient; sufficient discrimination for domain-scoped (subject-bounded) retrieval rather than open-web search |
| Batch size | 100 texts per embedding call | API-imposed practical batch ceiling; results are re-ordered to match input order since batch APIs do not guarantee return order |
| Similarity metric | Cosine similarity | Standard for normalized text embeddings |
| Collections | `kb_chunks` (document content), `document_fingerprints` (whole-document dedup), `question_bank` (packaged questions) | Kept separate rather than one collection with a `type` filter, so each collection's payload index and typical query shape stay simple and fast |
| Fingerprint dedup threshold | cosine ≥ 0.97 | High enough to treat only near-identical re-exports/re-scans as duplicates, not merely similar documents |
| Retrieval top-K | 5 (lesson generation) / 12 (exam extraction, Prompt Practice) | Lesson generation needs a tight, highly relevant excerpt; exam extraction and Prompt Practice benefit from a wider context window since they must ground an entire document or an open-ended prompt |

### 13.9 Prompt structure (representative shapes, not literal strings)

**Lesson generation batch prompt** — sent once per batch of ≤10 target questions:
```
SYSTEM: You are an expert educational assessment designer.
CONTEXT: <topK grounding chunks, each as "--- Source: {file}, page {n} ---\n{text}">
CONTENT: <lesson excerpt for this batch>
ALREADY COVERED CONCEPTS: <rolling list, capped at 80, most-recent-kept>
REQUIREMENTS:
  - Generate exactly {batchCount} multiple-choice questions
  - 4–5 distinct, plausible options; exactly one correct answer
  - 2–3 sentence explanation per question
  - Bloom's level 3–6 (intermediate to hard); vary across the batch
  - Do not repeat an already-covered concept
  - No trick questions
OUTPUT: strict JSON array; each item: {question, options{A..E}, correct_answer,
         explanation, blooms_level, confidence_score, concept}
```

**Exam extraction page prompt** — sent once per page with ≥20 characters of extractable text:
```
SYSTEM: You are extracting existing exam questions verbatim, not writing new ones.
CONTEXT: <topK grounding chunks from the same document, resolved once per document>
PAGE TEXT: <this page's raw text>
TASK: extract every complete question on this page. For each, determine:
  - answer_source: "provided" if the page text itself states/implies the correct
    answer or explanation; otherwise "inferred"
  - if inferred, reason like a subject-matter expert using the grounding context;
    if no reliable inference is possible, still produce a best-effort answer but
    keep confidence in the lower band
OUTPUT: strict JSON array; each item: {question, options, correct_answer,
         explanation, answer_source, confidence_score}
```

**Content classification prompt** — single call, first ~4000 characters of the document:
```
SYSTEM: Classify this educational document.
TEXT SAMPLE: <first 4000 chars>
OUTPUT: strict JSON: {content_type: "lesson"|"exam"|"reference",
         detected_topics: string[], document_structure: string,
         confidence: number, estimated_questions_per_page: number}
```

All model outputs are parsed as strict JSON; markdown code-fence wrapping is stripped before parsing if present. A parse failure or a response missing required fields for a given item is treated as "that item produced nothing" (logged, skipped) rather than failing the entire batch/session — one malformed question in a 10-question batch should not discard the other nine.

### 13.10 Confidence calibration

| Source | Default confidence | Notes |
|---|---|---|
| Lesson generation | 0.85 (model-reported value used if present) | Purely generated content; not verified against a definitive answer key |
| Prompt Practice, grounded (relevant context found) | 0.80–0.95 | Higher when strong grounding context was retrieved |
| Prompt Practice, ungrounded (no relevant context found) | 0.50–0.75 | Model falls back to general domain knowledge; flagged lower to bias toward review |
| Exam extraction, answer provided in source | ≥ 0.95 | Highest confidence tier — the source itself states the answer |
| Exam extraction, answer inferred, strong grounding | 0.75–0.90 | |
| Exam extraction, answer inferred, weak/no grounding | 0.60–0.75 | Lowest tier still produced (never silently dropped), but always review-flagged |
| Reused-from-cache (dedup hit) | Inherits the original session's per-question confidence | Not recalculated — treated as identical content |

`isReviewFlagged` is set automatically whenever a question's confidence falls below a configured threshold (0.75 by default), surfacing it prominently in the review UI; a human accepting, editing, or dismissing the flag is the intended workflow — nothing is auto-published to a live Exam Type below the reviewer's chosen threshold at finalize time (FR-PDF-9).

### 13.11 End-to-end pipeline sequence

```
Client                API                 Worker              LLM/Vector Store        DB
  │  POST /pdf-processing/upload
  ├───────────────────►│
  │                     │ create session (Pending), store file, hash
  │                     │◄──────────────────────────────────────────────────────────►│
  │  202 {sessionId}    │
  │◄────────────────────┤
  │                     │                    │ (sweeper picks up Pending, every Ns)
  │                     │                    ├─ exact-hash check ─────────────────────►│
  │                     │                    ├─ fingerprint check (if no exact hit) ──►vector
  │                     │                    │   (hit → clone questions, skip to Completed)
  │                     │                    ├─ status=Extracting → extract text/pages
  │                     │                    ├─ status=Classifying → 1 LLM call ──────►LLM
  │                     │                    ├─ status=Processing →
  │                     │                    │    branch: lesson | exam | reference
  │                     │                    │    (batched/paged LLM calls) ──────────►LLM
  │                     │                    ├─ subject classification pass ──────────►LLM
  │                     │                    ├─ image association (page-range match)
  │                     │                    ├─ write fingerprint (if new + ≥1 question) ►vector
  │                     │                    └─ status=Completed (or Failed + message)
  │  GET /pdf-processing/{id}  (poll every ~2s)
  ├───────────────────►│──────────────────────────────────────────────────────────────►│
  │  200 {status, progress, questionsGenerated, ...}
  │◄────────────────────┤
  │  GET .../{id}/questions?page=1
  ├───────────────────►│──────────────────────────────────────────────────────────────►│
  │  200 {questions: [...]}      (review & edit loop, client-side)
  │◄────────────────────┤
  │  POST .../{id}/finalize
  ├───────────────────►│ create ExamType + modules, write question objects, link curricula
  │  201 ExamTypeResponse
  │◄────────────────────┤
```

### 13.12 Adaptive selection & diversity algorithms (supporting Lesson Practice)

Two distinct selection algorithms serve Adaptive Lesson Practice (FR-CUR-6) depending on scope, both operating purely on already-embedded vectors with no LLM call in the common case:

- **Document-scoped** (a specific source document is named): reconstruct the document's own text from its stored chunks, embed a representative excerpt, and rank the subject's packaged question-bank vectors by similarity to it — the practice set is "questions most relevant to this specific document," pulled from the real exam bank rather than the document's own (separate) assessment questions.
- **Subject-scoped** (no specific document): no natural query vector exists, so the platform performs **farthest-point selection** — greedily picking the vector farthest (least similar) from the ones already chosen, discarding any candidate whose similarity to an already-chosen point exceeds 0.93 (near-duplicate suppression) — to build a practice set that spreads across the subject's topics rather than clustering around whatever happens to rank highest by any single relevance measure.
- In both cases, the LLM is invoked **only for the shortfall** — the gap between what the bank could supply and the requested practice-set size — never to regenerate what the bank already covers.

## 14. Data Architecture

- **Platform store**: one physical database, always shared regardless of tenant isolation mode, holding `Tenant`, `PlatformAdmin`, and the package/billing catalog. Small, low-write-volume, safe to keep simple (no sharding needed).
- **Tenant store(s)**: physically one, many, or logically partitioned per §11.1, all running the identical tenant-scoped schema (taxonomy, identity, exam authoring, curricula, pipeline, attempts, media, outbox). Schema migrations are versioned once and replayed per tenant store per the active isolation mode's `migrateAll`.
- **Vector store**: one Qdrant deployment shared by all tenants, logically partitioned by payload filters (`tenantId`, `curriculumId`/`documentId`, or `scopeKey` for the question bank) rather than physically separated — chosen because Qdrant's per-collection overhead makes per-tenant collections impractical at scale, and because every query already carries an equality filter as part of its normal retrieval scope, so tenant filtering is an additive constraint, not new plumbing.
- **File storage**: logically namespaced by tenant and entity id in the storage key regardless of physical backend (local disk today, S3-compatible object storage as the designed production target), so switching backends is a storage-adapter change only.

## 15. Security Design

- **AuthN**: JWT bearer, HS256, short-lived (configurable, default 60 minutes); refresh is out of scope by design (re-authentication on expiry) to avoid the added complexity/attack surface of refresh-token rotation at current scale.
- **AuthZ**: two independent guard chains — tenant `PermissionsGuard` (role→permission resolution) and platform `PlatformAdminGuard` (claim-type check) — never share a code path, so a defect in one cannot silently widen the other's scope.
- **Tenant isolation as a security boundary, not just a data-modeling convenience**: under every isolation mode, the resolved-tenant connection/filter is attached once at the edge (§11.2) and is the only thing services are given — a service physically cannot query another tenant's data because it never receives a handle capable of doing so (database/schema modes) or because the ORM layer injects the filter transparently (shared mode).
- **Feature-limit and permission checks compose**: a request must pass authentication, then tenant resolution, then permission check, then feature-limit check — ordered so that the cheapest, most decisive rejections (missing/invalid token) happen before any tenant-store or usage-counter I/O.
- **Signed URLs**: HMAC-SHA256 over `path|expiry`, verified server-side on every file fetch, independent of the requester's authentication state — deliberately anonymous-but-unguessable, since media needs to be embeddable (e.g., `<img>` tags) without attaching an auth header.
- **Secrets**: LLM/vector/payment provider credentials and the JWT/signing keys are environment-supplied, never hardcoded or persisted in the platform/tenant stores.

## 16. Deployment Architecture

- **Packaging**: a single container image bundles the built SPA and the API server, served same-origin — this eliminates CORS complexity for the primary tenant app and simplifies TLS/routing to one edge.
- **Runtime topology**: 
  - Stateless API instances behind a load balancer, horizontally scalable — safe because tenant context is resolved per-request from the `Host` header and no in-memory tenant state is required across instances beyond a short-TTL cache.
  - A separate worker process (or a role flag on the same image) runs the background sweepers — deployable as one replica (interval-based workers are not designed for multi-instance concurrency without an added leasing mechanism; that is the first thing to add if worker throughput becomes the bottleneck).
  - MySQL, Qdrant, and object storage are external managed or self-hosted services, not co-located in the app image.
- **Environment promotion**: identical image across dev/staging/prod; behavior differences (tenant resolution mode, isolation mode, provider credentials) are entirely configuration-driven, never build-time branches.
- **Zero-downtime tenant provisioning and migration**: because provisioning and migration are explicit workflows owned by the tenancy module (§11.3, §11.1), they can run against a live system without a deploy, and are independently retriable if interrupted.

## 17. Scalability & Reliability Design

| Concern | Design response |
|---|---|
| Growing tenant count | Isolation mode chosen for the operator's actual scale profile (§11.1); connection pool capped with LRU eviction so tenant count doesn't unboundedly grow open connections |
| AI provider latency/outages | Model fallback chains + bounded retry + hard timeout (§13.6); a stuck session is detected and resolved by the sweeper rather than hanging indefinitely |
| Vector store outage | Every vector write on the hot path (question-bank indexing) is fire-and-forget after the authoritative relational write succeeds — an outage degrades a secondary feature (search/adaptive practice quality) without blocking the primary action (exam authoring) |
| Long generation jobs surviving restarts | Watermark-based resumability (§4.6 FR-PDF-13, FR-REL-2) — a full-bank job persists progress after each completed batch, so a deploy or crash mid-job loses at most one in-flight batch |
| Background worker throughput at scale | Interval-based single-process workers are the current design; the identified upgrade path is a proper job queue (e.g., a durable queue with multiple consumers and per-job leasing) once concurrent multi-tenant load exceeds single-worker sweep capacity — deliberately deferred until justified by actual load |
| Runaway AI cost | Per-session token/cost budget checked before each batch in chunked generators, graceful completion rather than failure on breach (§4.6 FR-PDF-12) |

## 18. Technology Stack & Rationale

| Layer | Choice | Rationale |
|---|---|---|
| API runtime | Node.js + TypeScript | Single language across API and background workers; strong ecosystem for both HTTP and AI-provider SDKs |
| HTTP framework | NestJS v10 (on the `platform-express` adapter) | Structured module/controller/provider DI, first-class guards/pipes/decorators for cross-cutting concerns (auth, permissions, feature limits, validation) without hand-rolled middleware chains |
| ORM / data access | Prisma over MySQL | Type-safe schema-as-code, straightforward multi-database/multi-schema client construction needed for the isolation-mode strategy |
| Vector store | Qdrant (REST) | Payload-filtered search fits the tenant/scope-partitioning model without per-tenant collections; REST avoids gRPC firewall issues in constrained network environments |
| LLM provider | OpenAI-compatible, behind a provider-agnostic interface | Keeps the option open to swap or add providers (the interface is designed to support model-routing services like OpenRouter) without touching generator logic |
| Payments | Stripe | Industry-standard subscription billing with native coupon/discount and webhook primitives that map directly onto the package/subscription model |
| File storage | Local disk today, S3-compatible interface as the designed target | Storage is behind an adapter from day one so the production target requires no domain-logic change |
| Email | SMTP via Nodemailer, behind an `EmailPort` | No dependency on a specific transactional-email vendor's API; any SMTP-compatible provider (or none, in which case sends no-op) works without code changes |
| Frontend | Angular (Metronic admin template) | Mature admin-UI component set matching the platform-admin and tenant-admin console needs |

---

*End of document.*
