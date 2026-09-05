# QA Report - Dev-9b (BL-09: Platform Admin catalog UI, FR-PKG-7)

**Date**: 2026-08-09
**Scope**: Dev-9b only (Platform Admin Features/Packages catalog CRUD UI + backend, tenant
subscription reassignment UI + backend). Dev-9c and later are out of scope (not started).

## Environment

- Dedicated, freshly provisioned, disposable MySQL 8.4.11 Docker container (qa-dev9b-mysql,
  port 3307) - not the developer's persistent examland-mysql container (which runs mysql:latest
  = 26.7, not representative of the CI/production-pinned 8.4 line).
- API: apps/api built via npm run build:api, real NestFactory.create(AppModule) production
  bootstrap (qa-boot.js, a throwaway script mirroring main.ts's own boot sequence: create app,
  run real platform migrations via the real PLATFORM_DATA_SOURCE, then app.listen(), so
  PlatformAdminBootstrapService's onModuleInit runs against fully-migrated tables).
- Web: apps/web built via npm run build:web (production bundle), copied into apps/api/public
  and served by the real ServeStaticModule wiring, not ng serve.
- Browser: real Chromium via Playwright, driving the actual compiled SPA over HTTP against the real
  compiled API - no internal service calls bypassing the UI.
- All temporary containers, schemas, scripts, and screenshots were removed after this run.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PKG-7: Feature CRUD | create, duplicate-key rejection, edit, 404 on unknown id, delete-when-unreferenced | Pass | test/platform-catalog.e2e-spec.ts (real DB), browser screenshots 05-06 |
| FR-PKG-7: Feature key immutable once referenced | isReferenced flag correctness, preemptive UI lock, reactive 409 FEATURE_KEY_IMMUTABLE fallback | Pass | e2e spec assertions; browser screenshot 17 (locked Key field + exact helper copy) |
| FR-PKG-7: Feature delete guard | 409 FEATURE_IN_USE when referenced | Pass | e2e spec assertion |
| FR-PKG-7: Package CRUD | create, duplicate-key rejection, edit, deactivate (isActive), activeOnly=true filtering | Pass | e2e spec assertions; browser screenshots 07-08 |
| FR-PKG-3: Atomic feature-configuration replace | PUT .../:id/features - success, all-or-nothing rejection on unknown featureId (writes nothing), matrix UI (checkbox + limit, "Unlimited" placeholder) | Pass | e2e spec assertions; browser screenshots 08-09 |
| FR-PKG-4/FR-PKG-7: Tenant subscription reassignment | view current package/status, active-packages-only dropdown, confirm dialog, reassign, 404 PACKAGE_NOT_FOUND, 409 PACKAGE_INACTIVE | Pass | e2e spec assertions; browser screenshots 11-15 |
| FR-PKG-5: Full create-to-configure-to-assign-to-enforce loop | create feature, add to package (limit 2 in e2e / limit 1 in browser), assign to a real provisioned tenant, Dev-9a's real unmodified FeatureUsageService.checkAndIncrement allows exactly the limit and rejects the next call with FeatureLimitReachedError ({feature, limit, resetsAt} shape), admin-visible usage snapshot reflects it | Pass | test/platform-catalog.e2e-spec.ts lines 276-295 (direct FeatureUsageService calls against the real, migrated DataSource); browser screenshot 16 (usage table shows "QA Browser Feature: Yes / 1 / 0 / 1" immediately after a real reassignment, all other features flip to "No" matching the new package's config) |
| Real DataSource check (Dev-9a defect class) | New Dev-9b repositories/services (FeatureRepository write paths, PackageFeatureRepository, SubscriptionAdminService) exercised against a real, initialized DataSource via NestFactory.create(AppModule), not Test.createTestingModule alone | Pass | test/platform-catalog.e2e-spec.ts uses Test.createTestingModule({imports:[AppModule]}) + real migrations (equivalent rigor); independently re-verified via a separate qa-boot.js real-NestFactory.create bootstrap + live browser flow, which exercises every new repository through real HTTP end to end |
| Platform-realm auth | Every new route (/platform/features/**, /platform/packages/**, /platform/tenants/:id/{usage,subscription}) rejects with 401 when unauthenticated; PlatformAdminGuard verified by direct source read (separate JWT secret/aud/typ from tenant-realm tokens) | Pass | e2e spec "guard coverage" block; source read of platform-admin.guard.ts |
| Security spot-check | Every mutation writes platform.audit_log; every DTO class-validator-validated; no client-supplied id trusted without server-side re-check; atomic feature-config replace validates before writing; no raw SQL concatenation; currency platform-fixed server-side | Pass (by source read) | features.controller.ts, packages.controller.ts, create-feature.dto.ts, create-package.dto.ts, replace-package-features.dto.ts |
| Architecture compliance | New platform/features, platform/packages, platform/subscriptions (SubscriptionAdminService) modules follow the existing api/application/domain/infrastructure layering; module-cycle avoidance documented and structurally sound | Pass (by source read) | doc comments + import graph inspection |
| Regression | Full API unit suite, full API e2e suite, full web unit suite, typecheck, lint, build | Pass | see below |

## Independent verification performed

- npm run typecheck / npm run lint: clean across all 3 workspaces.
- npm run test:cov -w apps/api: 96 suites / 735 tests, all green - exact match to self-report.
- npm run test:e2e -w apps/api (--runInBand, against the dedicated disposable MySQL 8.4
  container): 20 suites / 184 tests, all green - exact match to self-report, including
  test/platform-catalog.e2e-spec.ts (25 tests) which independently proves the full FR-PKG-7 CRUD
  surface plus the exit-gate's real enforcement loop against Dev-9a's unmodified engine.
- npm run test -w apps/web: 32 suites / 166 tests, all green - exact match to self-report.
- npm run build:api / npm run build:web: clean (one pre-existing, non-blocking 12.21 kB bundle
  budget warning, not a new regression).
- npm audit: 3 vulnerabilities (2 high, 1 critical), all pre-existing in bcrypt's transitive
  node-pre-gyp/tar build-time dependency chain, not introduced by Dev-9b. Not blocking.
- Real-browser Playwright/Chromium run against the compiled production bundle + compiled API booted
  via the real NestFactory.create(AppModule) path against the dedicated MySQL 8.4 instance:
  logged in as a real bootstrapped Platform Admin, created a tenant, created a feature, created a
  package, enabled the feature in the package's feature-configuration matrix with limit 1, saved,
  reassigned the tenant to that package via the tenant-detail screen's confirm-required reassignment
  control, confirmed the exact snackbar copy, confirmed the usage snapshot table reflected the new
  package's feature set immediately, reloaded and confirmed persistence, separately confirmed the
  preemptive Key-lock UI on a referenced feature with the exact specified helper copy. Zero browser
  console errors across the entire run.

## Defects found

### 1. Confirm-dialog "Reassign" button uses error/warn styling, contradicting explicit UX guidance (non-blocking)

Expected (UX_GUIDELINES section 7.4, explicit): "Reuse shared/ui/confirm-dialog, destructive-adjacent
but not literally destructive styling - this isn't a delete, so the confirm button need not be
error-styled the way section 4.5's user-delete/section 6.3's taxonomy-delete buttons are; a standard
filled primary-color confirm button is appropriate here."

Actual: shared/ui/confirm-dialog/confirm-dialog.component.ts hardcodes a mat-flat-button with
color="warn" and no way to opt out - every caller, including the Reassign flow, gets the same
red/error-toned confirm button used for Suspend/Delete. Confirmed live in the browser (screenshot:
reassign confirm dialog shows a red "Reassign" button) and by direct source read (the component has
no color/tone input at all).

Repro: Open any tenant's detail screen, select a package in the "Reassign to package" dropdown,
click "Reassign" - the confirm dialog's action button renders in Material's warn (red/error)
palette.

Severity: Non-blocking / rough edge. This is a pre-existing shared component (already used
correctly for Suspend, which should be warn-styled) that Dev-9b reused as-is without adding the
color differentiation its own consulted UX guidance explicitly called for. It does not block the
FR-PKG-7 deliverable, does not lose data, and the dialog's copy is unambiguous regardless of button
color - but it is a literal, verifiable deviation from a documented UX decision that nexus-dev's own
self-report did not flag. Recommend adding an optional tone/color input to ConfirmDialogComponent
(defaulting to warn to preserve existing Suspend/Delete callers unchanged) and passing a
neutral/primary tone from the Reassign call site.

## Untested / gaps

- Mobile responsive degradation of the feature-configuration matrix and Features/Packages list
  screens (UX_GUIDELINES section 7.5) was not driven at a narrow viewport this pass - the desktop
  flow was the priority given the phase's exit gate is the enforcement loop, not responsive layout.
  Not blocking; recommend a follow-up pass if a future phase touches this screen again.
- nexus-dev's deliberate deviation from UX_GUIDELINES section 7.5's mobile card-body treatment for
  the feature-configuration matrix (horizontal-scroll table instead of the two-control card body)
  was reviewed by source/doc-comment only, not visually, since it doesn't affect the FR-PKG-7
  desktop functional exit gate and the WCAG 2.2 SC 1.4.10 technical justification given is sound.

## Verdict

Dev-9b: QA-GREEN. No blocking defects. The phase's headline exit-gate claim - the full
create-feature to add-to-package to assign-to-tenant to enforcement-reflected loop, using Dev-9a's
real, unmodified FeatureUsageService - genuinely holds, verified independently via both a fresh
real-DB e2e run and a live, real-browser walkthrough with zero console errors. One non-blocking
cosmetic defect (confirm-dialog button color) reported for awareness, not required before advancing.
