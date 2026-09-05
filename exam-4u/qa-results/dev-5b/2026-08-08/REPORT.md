# QA Report -- Dev-5b (BL-05: Platform Admin console UI)

Date: 2026-08-08
Scope: Dev-5b only (Platform Admin console UI, FR-MT-9, NFR-5/WCAG 2.2 AA). Dev-6a+ out of scope (not built).
Environment: Freshly provisioned, disposable MySQL 8.4 containers (Docker), compiled production build (npm run build), real node dist/main.js boot (NODE_ENV=staging) serving the built Angular SPA, real bootstrap Platform Admin, real Playwright/Chromium browser driving the actual UI over HTTP (http://127.0.0.1:3555). All containers/artifacts removed after the run.

## Summary verdict

NOT ready -- one blocking defect (mobile responsive/WCAG reflow), plus non-blocking notes. All other exit-gate items (nexus-ux consultation, real-browser e2e flow, realm separation, aria-live, Failed/retry path, no HSTS/CSP regressions, test suite reproduction) verified and pass.

## Traceability matrix

| Requirement / exit-gate item | Result | Evidence |
|---|---|---|
| nexus-ux consulted before building | PASS | UX_GUIDELINES.md section 3, added before Dev-5b dev entry in decision log |
| Golden path login-list-create-Active-detail-suspend-activate-list | PASS | screens 01 through 11, real tenant reached Active with generated schema name |
| Platform-admin login enumeration-safety | PASS | 401 INVALID_CREDENTIALS generic message |
| Suspend requires confirm, activate/retry do not | PASS | screens 08 and 10 |
| aria-live announcements actually fire | PASS | live DOM text captured: tenant created, tenant suspended |
| Failed-status display plus real retry wired to Dev-5a retry endpoint | PASS | screens/01-failed-tenant-detail.png, real retry call reached Active |
| provisioningError never rendered as HTML | PASS | source uses Angular default interpolation only |
| Realm separation, distinct storage keys | PASS | el.ptok vs el.tok.slug, confirmed live |
| Realm separation, tenant token rejected for platform session | PASS | injected real tenant JWT under platform key, redirected to platform/login |
| Backend cross-realm rejection | PASS carried forward | qa-results/dev-5a/REPORT.md, no backend files changed this phase |
| WCAG status badge not color alone | PASS | icon plus text for all four statuses |
| WCAG warning badge contrast | PASS | approx 5.08 to 1, exceeds 4.5 to 1 |
| WCAG form field labeling | PASS | mat-label/mat-form-field on every input |
| WCAG keyboard navigability | PASS | visible focus ring on mat-select, screens/03 |
| WCAG confirm dialog focus trap | PASS | Angular CDK mat-dialog |
| WCAG reflow at mobile width, NFR-5 SC 1.4.10 | FAIL, see Defect 1 | screens/mobile-tenant-list.png |
| No HSTS/CSP-style real-browser regression | PASS | zero console errors across all screens tested |
| Frontend test suite reproduction | PASS | 16 suites, 65 tests, matches self-report |
| Backend unit test reproduction | PASS | 62 suites, 411 tests, matches self-report |
| Backend e2e test reproduction | PASS on clean run | 12 suites, 76 tests, matches self-report |
| typecheck/lint/build | PASS | clean across all 3 workspaces, bundle 649.51 kB within budget |

## Defects

### Defect 1 -- BLOCKING: No mobile-responsive degradation on the Platform Admin console; sidebar never collapses, causing real content loss/clipping at narrow viewports (WCAG 2.2 SC 1.4.10 Reflow)

Expected (per the Dev-5b exit gate NFR-5/WCAG 2.2 AA requirement, and per UX_GUIDELINES.md section 3.1's explicit "responsive mobile card-list degradation for the table" requirement, which nexus-dev's own completion notes claim was built): at mobile viewport widths, the tenant table degrades to a stacked card list, and the persistent sidebar becomes a collapsible/overlay drawer rather than a fixed rail.

Actual: at a 375px-wide viewport (a standard mobile breakpoint), the sidebar remains a permanent, non-collapsible rail. It only shrinks from 240px to 200px per platform-shell.component.css's single media query at max-width 600px, despite that rule's own code comment claiming the sidebar becomes an overlay drawer, which it does not implement. This squeezes the main content into a roughly 175px-wide column. Result: the Create tenant button text is clipped, the status-filter mat-select shows only a bare dropdown arrow with its label unreadable, and the tenant table's column headers are cut down to just Name -- Subdomain, Status, Created, and Actions are not visible or reachable. Grepping tenant-list.component.css confirms there is no media-query rule at all for a card-list layout -- the feature described in the UX guidance and claimed as delivered in the phase completion notes was not actually implemented.

Repro steps:
1. Boot the app (node dist/main.js) with a live MySQL instance and the built SPA served.
2. In a real browser, set the viewport to 375 by 700 (a standard phone width).
3. Log in as Platform Admin, land on /platform/tenants.
4. Observe the sidebar occupies roughly half the 375px viewport with no way to collapse it, and the table content is clipped and unusable.

Evidence: qa-results/dev-5b/2026-08-08/screens/mobile-tenant-list.png; source: apps/web/src/app/layouts/platform-shell/platform-shell.component.css lines 36-40 (comment vs code mismatch); apps/web/src/app/features/platform/tenants/tenant-list/tenant-list.component.css (no card-list breakpoint present at all).

Severity: Blocking. This phase's own exit gate names WCAG 2.2 AA pass on the new screens (NFR-5) as a hard requirement, and SC 1.4.10 Reflow is a genuine AA success criterion this fails outright at a standard mobile width, with real content and functionality loss, not just visual awkwardness -- a Platform Admin cannot use the console's primary actions (create tenant, filter by status) on a phone. It is also a factual gap against nexus-dev's own self-reported deliverable list.

### Non-blocking note -- Transient e2e flake observed once, not reproduced

On the first test:e2e run (immediately following a test:cov run against the same fresh MySQL container in the same shell session, and after an earlier debugging attempt that passed a nonstandard rootDir override), one run reported failures across suites in a way inconsistent with a normal assertion failure. A clean, isolated rerun exactly as CI invokes it was 100 percent green (12 suites, 76 tests), matching nexus-dev's self-report exactly, and was repeatable. Root cause attributed to my own debugging invocation, not a genuine defect in Dev-5b -- flagged for completeness only, not required before advancing.

### Non-blocking environmental note -- examland.app hostnames cannot be tested in a real browser without TLS

The .app gTLD is a Google-mandated-HTTPS TLD; every mainstream browser, including the Chromium build Playwright uses, force-upgrades any examland.app subdomain navigation to HTTPS via browser-baked-in preload rules, independent of the app's own security headers. This means any future real-browser pass that needs to exercise a tenant subdomain (not needed for this phase, since Platform Admin routes are hostname-agnostic) must either terminate real TLS or use a Host-header-rewrite technique (as used in this pass for the realm-separation check) rather than DNS-mapping the literal domain. Not a code defect and not new to this phase -- flagged for the orchestrator and future QA passes' awareness.

## What was NOT re-tested this pass (carried forward from Dev-5a, unaffected)

- Backend cross-realm token rejection over live HTTP (already proven in qa-results/dev-5a/REPORT.md; no backend files changed this phase).
- Audit logging correctness (same carry-forward reasoning).
- Provisioning concurrency lock (same carry-forward reasoning).

## Cleanup performed

All Docker containers used for this session, the temporary apps/api/public static copy, the throwaway migration script, and the .env file used to boot the app were removed after this session. The disposable tenants and tenant-user account created during testing existed only in the disposable MySQL container, which was destroyed.
