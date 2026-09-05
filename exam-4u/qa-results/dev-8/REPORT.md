# QA Report — Dev-8 (BL-08: Taxonomy — Education Level / Stage / Subject)

## Scope
Independent QA validation of Dev-8 only (FR-TAX-1..4), per orchestrator instruction. Dev-9a and
later are out of scope (not yet built). Phase 1, Dev-6a, Dev-6b, Dev-7 are pre-existing QA-green
and were not re-validated except incidentally via the full test suite run.

## Environment
- Dedicated, disposable MySQL 8.4 Docker containers (`qa-mysql-dev8`, `qa-mysql-dev8-b`), never the
  developer's persistent `examland-mysql` container — removed after the run.
- Backend: `apps/api` built via `npm run build:api`, run both under Jest (unit/e2e) and as a real
  compiled `node dist/main.js` process (`NODE_ENV=staging`) for the browser pass.
- Frontend: `apps/web` built via `npm run build:web` (production bundle), served by the API's
  `ServeStaticModule` in the real-browser pass (not `ng serve`).
- Real browser: Playwright/Chromium (ad-hoc, matching this project's established convention).
  A temporary `/etc/hosts` entry and a non-`.app`/non-HSTS-preloaded test domain
  (`browserqa.examlandqa.test`) were used to route a real subdomain to the local server over plain
  HTTP; both were removed after the run. A local response-mirroring `page.route` shim was used
  solely to defeat the app's own `upgrade-insecure-requests` CSP directive forcing HTTPS for
  subresources in a plain-HTTP QA harness — this is a test-harness artifact, not a product change.
- All temporary artifacts (seed scripts, Playwright scripts, screenshots, `.env` files, Docker
  containers, hosts-file entries, disposable MySQL schemas) were removed after verification.

## Independent verification performed (not just re-running nexus-dev's own tests)
1. **Genuine DB-layer case-insensitivity**: read the migration
   (`1730000000003-create-taxonomy-tables.ts`) directly — confirms `education_level`/`stage`/
   `subject` are created with `COLLATE=utf8mb4_0900_ai_ci` at the table level. Re-ran nexus-dev's
   own `information_schema`-based collation assertion and a raw cross-case `SELECT` proof
   (`taxonomy.e2e-spec.ts`), both green against a freshly provisioned tenant schema on a dedicated
   MySQL 8.4 instance.
2. **Create-or-fetch concurrency**: authored an independent, disposable e2e spec
   (`qa-dev8-independent.e2e-spec.ts`, deleted after the run) firing two truly simultaneous
   `POST /taxonomy/education-levels` requests (`Promise.all`) for the same name (differently cased).
   Result: statuses `[200, 201]`, identical returned `id`, and a direct `SELECT` confirmed exactly
   one row — the insert-first/catch-and-refetch strategy is genuinely concurrency-safe, not just
   correct under sequential calls.
3. **`TAXONOMY_ENTRY_IN_USE` deletion guard**: re-verified via real HTTP against a live MySQL
   instance — an Education Level referenced by a real `user.education_level_id` row is rejected
   409/`TAXONOMY_ENTRY_IN_USE` (row confirmed to still exist afterward, not silently orphaned or
   soft-deleted); a genuinely unreferenced entry at every level deletes cleanly (204). Independently
   confirmed the generic FK-violation-translation utility (`isRowReferencedError`) via nexus-dev's
   own disposable stub-FK fixtures for `stage` and `subject` (no real consumer table exists yet) —
   both correctly rejected 409/`TAXONOMY_ENTRY_IN_USE`, and a Stage with a real child Subject is
   rejected by the same mechanism.
4. **Name-length validation boundaries**: independently authored boundary test distinct from
   nexus-dev's own (which tested 1/151 char rejections but not the exact 149/150 pass boundary):
   149 → 201, 150 → 201, 151 → 400/`INVALID_NAME`, 1 → 400/`INVALID_NAME`, 2 → 201. All exact.
5. **Hierarchy scoping**: confirmed the same Stage name is permitted under two different Education
   Levels (distinct rows) while being create-or-fetched (idempotent) under the same parent — i.e.
   unique-within-parent, not globally unique, matching FR-TAX-1's literal wording. Same pattern
   confirmed for Subject-under-Stage.
6. **Permission gating**: independently authored a check narrower than nexus-dev's own (which only
   proved `taxonomy.read` 403 for a zero-role user) — confirmed a zero-role authenticated user gets
   403/`FORBIDDEN` specifically on `POST /taxonomy/education-levels` (create) and
   `DELETE /taxonomy/education-levels/:id` (delete), not just on the read route. Unauthenticated
   requests are rejected 401/`UNAUTHENTICATED` before any permission check.
7. **Real-browser e2e**: launched the actual compiled app (`node dist/main.js`) against live MySQL,
   logged in as a real Tenant Admin, and drove the full breadcrumb browse/create/delete flow:
   login → Taxonomy nav → create "Higher Education" (201) → re-add "HIGHER EDUCATION" (200,
   confirmed exactly one row in the DOM, not two) → 1-char name rejected with the exact UX-spec
   copy ("Enter a name between 2 and 150 characters.") → drill into Higher Education (empty,
   parent-named Stages state) → create "Undergraduate" → drill into it (empty, parent-named
   Subjects state) → create "Mathematics" (confirmed 0 drill-chevron buttons on the Subjects row,
   i.e. leaf rows correctly non-drillable) → delete confirm dialog (exact copy "Delete
   'Mathematics'? This cannot be undone.", confirmed initial DOM focus is on "Cancel", not
   "Delete") → confirmed deletion (snackbar "Deleted.") → breadcrumb back-navigation to both the
   intermediate and root levels (URL and heading both updated correctly at each step). Screenshots
   captured at every step (14 total, retained only in this run's transient temp directory per QA
   hygiene — not committed to the repo).
8. **Re-ran the full test suites independently** (not trusting the self-report):
   - `npm run typecheck` / `npm run lint`: clean across all 3 workspaces.
   - `npm run test:cov -w apps/api`: **81 suites / 621 tests, all green**, coverage
     93.73%/**80.51%**/89.44%/93.8% (stmt/branch/func/line) — exactly matching the self-report.
     Read the taxonomy-module coverage detail directly: the added branch coverage
     (`taxonomy.controller.spec.ts`, repository specs) exercises genuine conditional paths (e.g.
     the 200-vs-201 branch, the not-found branches, the duplicate-vs-non-duplicate error branches),
     not superficial no-op assertions — confirmed by reading the spec files' actual assertions, not
     just the percentage.
   - `npm run test:e2e -w apps/api`: **`test/taxonomy.e2e-spec.ts` (18 tests) passed** on every run.
     A full-suite run showed 3 unrelated failures (`tenants-crud.e2e-spec.ts`,
     `tenant-resolution.real-bootstrap.e2e-spec.ts`, `platform-tenants-console.e2e-spec.ts` — all
     pre-existing Dev-0b/Dev-1/Dev-5b suites, none touching taxonomy) with `beforeAll` hook
     timeouts (5000ms exceeded). Re-ran those 3 suites in isolation (`--runInBand`) against the
     same MySQL instance: **all 3 passed cleanly** (20/20 tests, ~25s). This is jest
     parallel-worker resource contention against a single MySQL container on this machine (each
     worker's `beforeAll` provisions a full tenant schema concurrently), not a Dev-8 regression or
     a real defect in those suites — confirmed by isolation re-run. Full 17-suite/152-test count
     matches the self-report when accounting for this environment artifact.
   - `apps/web`'s `ng test`: **25 suites / 125 tests, all green**, including the 15 new
     `taxonomy-browse.component.spec.ts` tests. (Benign jsdom "Could not parse CSS stylesheet"
     stderr noise on some specs is pre-existing test-environment noise, not a real failure — all
     tests still pass.)

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-TAX-1 (hierarchy, unique-within-parent) | Same Stage name under two different Education Levels (distinct rows); same name under one parent is create-or-fetched | Pass | `taxonomy.e2e-spec.ts`; independent re-verification |
| FR-TAX-2 (create-or-fetch semantics) | 201 on new, 200 on existing (case-varied); DB-layer collation (not app-level lowercasing); genuine concurrent-create race | Pass | `taxonomy.e2e-spec.ts` + independent collation/concurrency checks |
| FR-TAX-2 (name validation, 2–150 chars) | 1/149/150/151/whitespace-only | Pass | independent boundary spec (149/150 pass, 151/1 reject) + `taxonomy.e2e-spec.ts` (1/151/whitespace reject) |
| FR-TAX-3 (scoping) | Stages listed under their Education Level; Subjects under their Stage; unknown parent → 404 `TAXONOMY_ENTRY_NOT_FOUND` | Pass | `taxonomy.e2e-spec.ts` |
| FR-TAX-4 (deletion constraint) | Real `user` reference (Education Level); disposable stub-FK fixtures (Stage, Subject); own-hierarchy child-reference (Stage-with-Subject); genuinely unreferenced deletes cleanly | Pass | `taxonomy.e2e-spec.ts`; independently re-verified via direct SQL confirmation of non-deletion |
| Permission gating (`taxonomy.read`/`create`/`delete`) | Zero-role user 403 on read, create, and delete specifically; unauthenticated 401 before permission check | Pass | `taxonomy.e2e-spec.ts` (read) + independent spec (create/delete) |
| UI: browse/create/delete flow, UX_GUIDELINES §6 | Full real-browser flow: empty states, create-or-fetch UX (no 200/201 leak), `INVALID_NAME` copy, leaf-row no-chevron, delete confirm copy/focus, `TAXONOMY_ENTRY_IN_USE` copy (not independently triggered via UI this pass, but present per code read), breadcrumb navigation, console-error check | Pass | Playwright screenshots (14 steps); code read of `taxonomy-browse.component.html` confirms `TAXONOMY_ENTRY_IN_USE` copy matches spec verbatim |
| Architecture compliance (LLD §1.2 Tier B layering) | Read `modules/taxonomy` structure directly | Pass | `domain/` holds only errors/types, `application/` calls repositories directly, matching the documented Tier B judgment call |
| Security spot-check | JWT+Permissions guard on every route; parameterized SQL throughout; parent ids re-derived server-side, never trusted from client; no new dependency; no secrets | Pass | Code read of `taxonomy.controller.ts`, `taxonomy.service.ts`, `mysql-error.util.ts` |

## Defects found

### 1. Breadcrumb links throw a CSP violation on every click (non-blocking)
- **Severity**: Non-blocking / rough edge. Functionality is unaffected (Angular's `(click)` handler
  fires regardless), but this is a real, reproducible browser-console error on a code path this
  project's own QA convention explicitly requires checking ("check browser console/network tab for
  errors during each flow").
- **What was expected**: UX_GUIDELINES §6.4 specifies the breadcrumb must be "a real semantic
  breadcrumb" with working navigation and no other stated console-error tolerance; this project's
  own helmet-based CSP is `script-src 'self'` (no `unsafe-inline`), configured project-wide.
- **What actually happened**: `taxonomy-browse.component.html`'s non-current breadcrumb links use
  `<a href="javascript:void(0)" (click)="goToLevel()">...</a>` / `goToRoot()`. Every click causes
  Chromium to attempt to execute the `javascript:` URL as page navigation, which the app's own CSP
  (`script-src 'self'`) blocks and logs to console: *"Running the JavaScript URL violates the
  following Content Security Policy directive 'script-src 'self''... The action has been blocked."*
  Navigation still succeeds because Angular's bound `(click)` handler runs as a separate DOM event
  listener, independent of the blocked `href` navigation attempt — confirmed by verifying the URL
  and panel heading update correctly after the click despite the console error.
- **Repro steps**: 1) Log in as a Tenant Admin. 2) Go to Settings → Taxonomy. 3) Create an
  Education Level and drill into it (so a non-current breadcrumb segment — e.g. "Education
  Levels" — is a link). 4) Open the browser devtools console. 5) Click the "Education Levels"
  breadcrumb link. 6) Observe the CSP violation error logged to console, on every such click
  (reproduced twice in this pass, once per breadcrumb link exercised).
- **Suggested fix direction** (not performed — QA does not fix defects): replace
  `href="javascript:void(0)"` with either no `href` attribute at all (bind `(click)` on a `<button>`
  styled as a link, matching this project's own existing pattern elsewhere for non-navigating
  clickable text) or `href="#"` with `(click)="$event.preventDefault(); goToLevel()"`.

## No other findings
No blocking defects. Coverage numbers, e2e counts, and the browser-verified CSS fix (the
`INVALID_NAME` error rendering below the input in its own column, not squeezed into the flex row)
all reproduced independently and match the self-report. No architecture-boundary violations, no
security spot-check findings, no dependency concerns (no new third-party dependency this phase).

## Verdict
**Dev-8 is QA-green.** One non-blocking defect (CSP-violating breadcrumb `href`) reported for
`nexus-dev`'s awareness — recommended to fix opportunistically (e.g. alongside Dev-9a) since it is
cosmetic/console-noise only and does not block any requirement, but should not be allowed to
accumulate across future phases that add more `javascript:void(0)` links under this same strict CSP.
