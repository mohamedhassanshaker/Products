# B-2 IAM — implementation plan (working notes, folded into tasks/todo.md on completion)

## Pre-flight findings beyond the brief (verified against real files, not assumed)

1. **No SQL adapter implements `UserRepository` anywhere** (only `testing/fakes.ts`). Must build `PrismaUserRepository`.
2. **No SQL adapter implements `CredentialRepository`.** Needed to construct the real `LocalPasswordProvider` (which `ResolveSession` needs for `.resolvePrincipal()`). Must build `PrismaCredentialRepository`.
3. **`platform.Permissions` is never seeded** — zero INSERTs anywhere. Must seed 9 rows with the REAL colon-form keys (`dashboard:view` … `appearance:manage`), not data-model.md's illustrative snake_case names.
4. **No code path creates a `TenantProfile` row for a provisioned tenant** (only the isolation test fixture hand-builds one, always `isPlatformTenant: false`). `TR_Teams_crossEntityScope` therefore rejects an AllEntities team for EVERY tenant today. Root-cause fix: add `TenantProfile` creation to `SqlStoreProvisioner.create()` (derives `isPlatformTenant` from `Tenant.entityKind === 'PlatformOperator'`), not just to the seed script.
5. **Real bug: `TR_RolePermissions_protectSuperAdmin`'s literal `'manage_users_teams'`** does not match the domain layer's actual, tested, load-bearing permission key `"users:manage"` (`domain/permissions.ts`). The trigger would never fire. Fix the trigger's literal to `'users:manage'`. `Role.key` convention (`'super_admin'` etc., snake_case) is untouched — nothing persists a Role row yet, so the trigger's existing snake_case literal becomes the established convention going forward, adopted by the seed script and `update-role-permissions.ts`.
6. **`sewa`/`customs` are the isolation suite's exclusive, ephemeral tenants** (provisioned + destroyed by `tests/isolation/setup.ts` on every isolation run). Reusing them for persistent demo data is legitimate (idempotent seed script re-provisions after a wipe) but must be documented, not silently assumed safe.
7. **Empirically confirmed (throwaway `next dev` experiment, deleted after)**: an `AsyncLocalStorage` context bound in a layout via `runWithTenant(ctx, () => children)` does NOT propagate to a nested page render or to a Server Action — both came back `UNBOUND` in a real test. This means `settings/appearance`'s existing bare `tryGetTenantContext()`/`requirePrincipal()` calls can never see a real principal under any layout-level binding scheme; every real entry point must independently resolve context from request cookies. Design accordingly: no ambient layout binding — an explicit per-entry-point resolver, reusing `AuthMiddleware.handle()`.

## Build order

1. **Backend foundation fixes**
   - `prisma/sql/001_constraints.sql`: fix `TR_RolePermissions_protectSuperAdmin` literal.
   - `SqlStoreProvisioner.create()`: create/sync the `TenantProfile` singleton row.
   - `domain/permissions.ts`: add `ROLE_KEYS: Readonly<Record<SeededRole,string>>` (snake_case persisted keys).
2. **New adapters**: `PrismaUserRepository`, `PrismaCredentialRepository`, minimal real `EnrolmentTokenIssuer` (Redis-backed), confirm `RedisSessionStore` file's `ChallengeStore`/`ReplayGuard` coverage.
3. **New ports/adapters**: `team-repository.ts` + `PrismaTeamRepository`; `role-repository.ts` + `PrismaRoleRepository` (matrix read/write, protected-cell error mapping).
4. **Application use cases**: invite-user, edit-user, reactivate-user, remove-user, list-users, create-team, list-teams-with-live-membership, update-role-permissions, create-custom-role.
5. **Next.js auth wiring**: a request-context resolver (adapters/inbound) reusing `AuthMiddleware.handle()` fresh at every entry point (page + each Server Action) — no ambient binding.
6. **Route**: `(backoffice)/layout.tsx` (mounts `AppShell`), `(backoffice)/iam/page.tsx` + 3 tab components + `actions.ts`, `?tab=` via `SubTabBar`'s `urlParam`.
7. **confirmChange** (separation of duties) + **isLocked** (protected cell) wiring in the Roles tab.
8. **Seed script**: `scripts/seed-iam-demo-data.ts`, provisions/upserts 4 tenants (sewa, customs, libraries, sharjah[platform operator]) + seeds Permissions/StaffUsers/Roles/RolePermissions/Teams/TeamMembers/UserRoleAssignments/TenantProfiles.
9. **Tests** for every new use case + adapters.
10. **Live DB proof** (throwaway script, deleted after) + **next dev check** (real cookie via real sign-in + TOTP).
11. **Gates**: verify.mjs --staged, typecheck, eslint, design gates.
12. **Docs**: tasks/todo.md review entry, docs/api.md + docs/data-model.md updates if warranted.
