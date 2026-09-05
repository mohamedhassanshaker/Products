# QA Report - Dev-4 (BL-04: RBAC engine & standard tenant roles)

**Date:** 2026-08-08
**Scope:** Dev-4 only (FR-IAM-5, FR-IAM-6). Dev-0a..Dev-3 already QA-green, not re-litigated.
**Environment:** Freshly provisioned, dedicated MySQL 8.4 Docker container (qa-dev4-mysql,
port 3406), destroyed after this session (not the developer's persistent examland-mysql).
Node 22.16 (sandbox), same as prior QA passes.

## Verification performed

1. `npm run typecheck` - clean across all 3 workspaces (real `tsc -p tsconfig.json --noEmit`,
   not ts-jest transpile mode). `isolatedModules: true` on `apps/api/tsconfig.json` does not
   weaken this: `isolatedModules` restricts what a single file may contain for safe
   file-by-file transpilation (no const enums, `export type` required for type-only
   re-exports, etc.) - it does not disable tsc's own cross-file type-checking, which only
   `--noEmit`'s Program-based check performs regardless of the flag. The real typecheck script
   ran clean with zero errors, confirming the flag has not masked anything. Confirmed
   `src/**/*.spec.ts` was already excluded from this script before Dev-4 (pre-existing scope,
   not a regression).
2. `npm run lint` - clean, zero warnings, `--max-warnings=0`.
3. `npm run test:cov -w apps/api` - reproduced exactly: 51 suites / 355 tests, aggregate
   coverage 92.94% / 80.26% / 89.37% / 92.85% (stmt/branch/func/line), matching the
   self-report byte-for-byte.
4. apps/api e2e suite (`test/jest-e2e.json`, `--runInBand`) against the dedicated MySQL 8.4
   instance - reproduced exactly: 9 suites / 58 tests, all green, including
   `test/rbac.e2e-spec.ts`'s 9 real-HTTP/real-DB cases. Confirmed zero leaked tenant or
   platform schemas after the run (`SHOW DATABASES` shows no `t_*` or `examland_platform_*`
   residue).
5. Read `PermissionsGuard`, `PermissionResolutionService`, `RolesService`,
   `PermissionsCrudService`, `UserRoleAssignmentService`, `RolesController`, and `app.module.ts`
   directly (not just trusting the self-report's prose).

## Independent findings, item by item

1. **Fail-closed default - CONFIRMED, no default-allow path exists anywhere.**
   `PermissionsGuard.canActivate()` has exactly two return/throw shapes: (a) no
   `@RequiresPermission` metadata -> `return true` (documented "authentication-only" default,
   HLD 5.2's own reviewable convention, not a permission decision); (b) metadata present ->
   every named permission must be in the resolved set or it throws `ForbiddenDomainError`.
   There is no branch that treats an empty/unresolved permission set as a pass. Live-verified:
   registered a real user, logged in, zero role grants, hit `GET /roles` (a
   `@RequiresPermission('roles.read')` route) -> 403 FORBIDDEN. The guard's defensive
   "principal missing" branch also fails closed (throws `UnauthenticatedError`) rather than
   allowing through.
2. **Union-of-roles - CONFIRMED.** `test/rbac.e2e-spec.ts`'s union case assigns a real user the
   Member role plus a custom role granting only `billing.read` (disjoint sets) and confirms
   the resolved effective set contains both `exams.read` (from Member) and `billing.read`
   (from the custom role). `PermissionResolutionService`'s only read path is
   `UserRoleRepository.findEffectivePermissionNames`, a single query with no code path that
   could return an intersection instead of a union.
3. **LAST_ADMIN_PROTECTED - CONFIRMED, not over-broad.** For a tenant with exactly one Tenant
   Admin, both `replaceRolesForUser` (role-replace) and `assertUserDeletable` (hard-delete
   pre-check) reject with `LAST_ADMIN_PROTECTED`, and a follow-up read confirms no partial
   write occurred (the admin still holds the role). For a tenant with two Tenant Admins,
   demoting one succeeds. Both paths share one implementation (`assertNotLastAdmin`), so there
   is no risk of the two invariant sites drifting apart.
4. **ROLE_IN_USE / PERMISSION_IN_USE - CONFIRMED, and the "unused" counter-case also holds.**
   A custom role referenced by a user is rejected on delete with `ROLE_IN_USE`; freeing the
   reference (removing the user's role grant) then allows deletion, confirmed by a follow-up
   `RoleNotFoundError` on re-fetch. A permission (`exams.read`) granted to the seeded Member
   role is rejected on delete with `PERMISSION_IN_USE`.
5. **SYSTEM_ROLE_PROTECTED - CONFIRMED.** Deleting the seeded Tenant Admin role is rejected
   with `SYSTEM_ROLE_PROTECTED`. Renaming a system role is also blocked (unit-tested in
   `roles.service.spec.ts`, read directly). One judgment call worth flagging for awareness
   (non-blocking, documented deliberately by nexus-dev, not a defect): `PUT
   /roles/:id/permissions` (grant replacement) is not blocked on system roles - a Tenant
   Admin can rewrite what Member/Tenant Admin itself grants. This is a literal reading of
   the LLD's route table (only PATCH/DELETE marked system-protected) and is defensible,
   but is worth the orchestrator/product owner's awareness since a Tenant Admin could
   inadvertently strip their own role's permissions via this route with no additional
   confirmation step. Not a spec violation - FR-IAM-6 only requires protecting the role's
   existence and the last-admin invariant, both of which hold.
6. **Guard ordering - CONFIRMED.** `TenantResolutionMiddleware` is registered via Express
   middleware in `AppModule.configure()`, which in Nest's request lifecycle always executes
   before any guard, structurally (not by convention) - no `@UseGuards` chain can run before
   middleware. `JwtAuthGuard` before `PermissionsGuard` is enforced by listing order in
   `@UseGuards(JwtAuthGuard, PermissionsGuard)`, and Nest's documented left-to-right
   short-circuit evaluation makes `PermissionsGuard` unreachable once `JwtAuthGuard` rejects.
   Live-verified: an unauthenticated request to a permission-gated route returns 401
   UNAUTHENTICATED (never reaching a permission check), confirmed by the guard's own code
   path (no query fired) and the e2e assertion.
7. **Per-request memoization - CONFIRMED.** Read `PermissionResolutionService` directly: it
   consults `RequestContext.effectivePermissions` (ALS-scoped) before querying, and unit tests
   (`permission-resolution.service.spec.ts`) assert the repository mock is called exactly once
   across two calls within the same `runWithRequestContext` scope, and exactly twice across two
   independent contexts - a real call-count proof, not just an assertion of returned value
   equality (also asserts same Set instance is returned, ruling out a copy-then-discard
   implementation).
8. **isolatedModules concern - no masking found.** `npm run typecheck` (the real `tsc --noEmit`
   Program-based check) ran clean with zero errors across all RBAC module files. Confirmed by
   reading tsc/ts-jest semantics: `isolatedModules` restricts per-file transpilation
   safety, not tsc's own full-program type-checking - the flag only changes behavior for
   transpile-only tools (ts-jest, babel, esbuild) that skip full type-checking for speed;
   `tsc -p ... --noEmit` always does full cross-file checking regardless of the flag. This
   confirms nexus-dev's claim is architecturally correct, not merely asserted.
9. **Unit + e2e reproduction - CONFIRMED exact match** (see "Verification performed" above):
   51/355 unit tests, 92.94/80.26/89.37/92.85% coverage, 9/58 e2e tests - all numbers
   reproduced byte-for-byte independently.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-IAM-5 fail-closed default | zero-role user denied FORBIDDEN; guard source walked for default-allow branches | Pass | test/rbac.e2e-spec.ts "fail-closed default"; permissions.guard.ts read |
| FR-IAM-5 union of roles | two disjoint-permission roles both present in resolved set | Pass | test/rbac.e2e-spec.ts "union-of-roles resolution" |
| FR-IAM-5 ROLE_IN_USE | delete referenced role rejected; unreferenced role deletable | Pass | test/rbac.e2e-spec.ts |
| FR-IAM-5 PERMISSION_IN_USE | delete referenced permission rejected | Pass | test/rbac.e2e-spec.ts |
| FR-IAM-6 seeded roles | Tenant Admin/Member present and functional via real HTTP | Pass | test/rbac.e2e-spec.ts "Tenant Admin can use the RBAC engine" |
| FR-IAM-6 LAST_ADMIN_PROTECTED | sole admin rejected on role-replace and delete-precheck; 2nd admin allows demotion | Pass | test/rbac.e2e-spec.ts |
| SYSTEM_ROLE_PROTECTED | delete of seeded role rejected | Pass | test/rbac.e2e-spec.ts |
| HLD 5.2 guard ordering | unauth request 401 before permission check; middleware-before-guard structural | Pass | test/rbac.e2e-spec.ts; app.module.ts read |
| HLD 5.1 per-request memoization | repository call-count assertions (1 within request, 2 across requests) | Pass | permission-resolution.service.spec.ts |
| Regression: GET /auth/me reports real permissions | Tenant Admin sees >10 real permissions incl. roles.read | Pass | test/rbac.e2e-spec.ts |
| isolatedModules typecheck regression risk | real tsc --noEmit run clean; flag semantics confirmed non-weakening | Pass | direct npm run typecheck run |

## Defects

None blocking. One non-blocking observation (not a spec violation, flagged for awareness only):
`PUT /roles/:id/permissions` allows rewriting a system role's (Tenant Admin/Member) own
permission grants with no extra confirmation, which is a literal-but-permissive reading of the
LLD's route table - worth a UX confirmation dialog in a later phase, not a Dev-4 defect.

## Verdict

**Dev-4 QA-green - no blocking defects.** Self-reported unit (51/355) and e2e (9/58) numbers,
coverage percentages, and every named exit-gate scenario independently reproduced and verified
against a freshly provisioned, dedicated MySQL 8.4 instance. No default-allow path exists
anywhere in the permission system.
