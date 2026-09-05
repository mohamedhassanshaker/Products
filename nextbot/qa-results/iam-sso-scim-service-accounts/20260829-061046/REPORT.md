# QA Report -- Target Architecture Blueprint Phase 4 (BL-36, FR-SEC-10), Retry 1 re-QA

Immediate re-QA pass (not batched, per this project's auth-boundary-work rule). Scoped
to the one blocking defect from the first pass (Finding 1, stale SSO role persistence)
plus a full re-confirmation that everything else previously verified still holds.

Prior FAIL report (record of the original defect): `qa-results/iam-sso-scim-service-accounts/20260829-054900/REPORT.md`.
Dev's retry-1 fix: `docs/NEXUS_STATE.md`'s 2026-08-29 dev decision-log entry (Phase 4
retry 1) and `docs/plans/target-architecture-blueprint-plan.md`'s Phase 4 "Retry 1" section.

## Scope tested

1. Reproduce the exact original failing scenario (two logins, group A then
   non-overlapping group B) and confirm it now passes exactly, not just partially.
2. The "don't overcorrect" check: a manually-granted role must survive an SSO login
   whose assertion maps to a different role set.
3. Re-grant idempotency: a role both Manually granted and currently IdP-asserted must
   not be reclassified from `Manual` to `Sso` -- verified directly against the DB
   column, not just role presence.
4. Zero-roles-from-SSO edge case: no crash, existing SSO-derived roles survive, an
   observable warning is logged; separately, a user who genuinely has zero roles for
   an unrelated reason still hits `AuthNoRoleAssignedError` normally.
5. Re-confirmation of every previously-passing finding (SAML/OIDC forgery rejection,
   SCIM isolation/scoping, session/API-key revocation, API-key scope enforcement,
   cross-tenant API-key forgery rejection, JIT toggle, SCIM `PUT displayName`,
   password+TOTP regression).
6. The 2 previously-flagged unrelated lint errors, claimed resolved as a side effect of
   concurrent Phase 5 work landing.
7. Full regression: fresh migration, `@nextbot/iam` suite, isolation suite, typecheck,
   lint + lint:boundaries, full repo unit+integration suite.

## Environment

- `compose.test.yml` ephemeral Postgres (`localhost:55432`)/Redis/ClickHouse, reset
  (`down -v` + `up -d`) and freshly migrated (`0001`-`0058`) for this pass, independent
  of dev's own run.
- All tests run via `vitest` against real Postgres (no mocked DB layer), except the
  OIDC network layer (same documented, reasonable mocking rationale as the first pass
  -- `openid-client`'s own crypto is out of this project's audit scope).
- No production environment touched. Independent adversarial test file
  (`qa-adversarial-retry1.int.test.ts`, 5 new tests) written directly against real
  Postgres via `createFixtureTenant()`/`deleteFixtureTenant()`, run green, then deleted
  before finishing -- no artifacts left in the source tree. `compose.test.yml` stack
  torn down (`down -v`) at the end of this pass.

## Independent adversarial verification (this pass's own tests, not dev's fixtures)

All 5 written and run directly against real Postgres, reading the `user_role.source`
column directly via `withTenant`/`schema.userRole` rather than trusting role presence
alone:

1. **Exact original repro** (group A -> non-overlapping group B): login 2's
   `roleIds`/`permissions.security_settings` are exactly Read-Only's (`"Read"`), not a
   union with login 1's Tenant Admin (`"Write"`) -- **PASS**, confirms Finding 1 fixed.
2. **Manual grant survives SSO re-derivation to a disjoint role set**: a
   console-registered user (`Designer` role, source defaults to `Manual`) logs in via
   SSO asserting only `readonly`. Result: both roles present. Direct DB read confirms
   `Designer` row's `source = 'Manual'`, the new `Read-Only` row's `source = 'Sso'`
   -- **PASS**.
3. **No silent reclassification**: a user manually granted `Read-Only` (`source =
   'Manual'`), then logs in via SSO where the IdP asserts a group mapping to that SAME
   role. Direct DB read before AND after the SSO login: `source` remains `'Manual'`
   throughout (`onConflictDoNothing` never touches the existing row's `source` column)
   -- **PASS**, confirms dev's `onConflictDoNothing` claim empirically, not just by code
   reading.
4. **Zero-roles-from-SSO edge case** (part a): a user with an existing SSO-derived
   `Read-Only` grant logs in again with the IdP now asserting an entirely unmapped
   group (zero resolved roles, no `defaultRoleId` configured). Result: no crash,
   `roleIds` unchanged (`Read-Only` survives), and `console.warn` was called with a
   message identifying `syncSsoRoleAssignment` and the affected user/tenant -- **PASS**.
5. **Zero-roles edge case** (part b, genuine zero-role rejection untouched): a
   brand-new JIT user whose IdP assertion maps to no role and has no `defaultRoleId`
   and no pre-existing grant to preserve -- `completeOidcLogin` still throws
   `AuthNoRoleAssignedError` as before, confirming the refuse-to-shrink-to-zero
   no-op does not suppress the downstream FR-ADM-02 check -- **PASS**.

## Traceability matrix

| Requirement / adversarial item | Scenario tested | Result | Evidence |
|---|---|---|---|
| SSO role re-derivation is exact, not additive (original Finding 1) | Two-login repro, group A then non-overlapping group B | **PASS** (fixed) | Independent adversarial test #1 above; dev's own `sso-login.int.test.ts` re-run and confirmed (11/11) |
| Manual grant survives SSO re-derivation | Console-registered user with a Designer role logs in via SSO asserting an unrelated group | **PASS** | Independent adversarial test #2; DB `source` column read directly |
| No reclassification of a Manual row that happens to overlap an SSO assertion | Manual `Read-Only` grant, then SSO login asserting the mapped-to-`Read-Only` group | **PASS** | Independent adversarial test #3; DB `source` column read directly before/after |
| Zero-roles-from-SSO: refuse-to-shrink, warn, no crash | Existing SSO-derived role, next login asserts an unmapped group | **PASS** | Independent adversarial test #4a; `console.warn` spy assertion |
| Genuine zero-role rejection untouched (FR-ADM-02) | Brand-new JIT user, unmapped group, no default role, no prior grant | **PASS** | Independent adversarial test #4b; `AuthNoRoleAssignedError` thrown |
| Forged/garbage SAML assertion (unsigned/wrong-key/expired) | Dev's own real, unmocked `@node-saml` test re-run | PASS, unregressed | `sso-login.int.test.ts` (SAML describe block) |
| Invalid OIDC token exchange fails closed | Dev's own test re-run | PASS, unregressed | `sso-login.int.test.ts:116`-equivalent |
| SCIM cross-tenant isolation + bearer-token scoping | Dev's own tests re-run | PASS, unregressed | `scim-users.int.test.ts` |
| Real-time session revocation | Dev's own tests re-run | PASS, unregressed | `session-management.int.test.ts` |
| Real-time API-key/service-account revocation | Dev's own tests re-run | PASS, unregressed | `service-account.int.test.ts` |
| API-key scope enforcement via real `requirePermission()` | Dev's own tests re-run | PASS, unregressed | `service-account.int.test.ts` |
| Cross-tenant API-key forgery rejection | Dev's own test re-run | PASS, unregressed | `service-account.int.test.ts` |
| JIT toggle both directions | Dev's own tests re-run | PASS, unregressed | `sso-login.int.test.ts` |
| SCIM `PUT displayName` fix | Dev's own test re-run | PASS, unregressed | `scim-users.int.test.ts` |
| Password+TOTP login regression | Dev's own suite re-run (14 tests) | PASS, unregressed | `authenticate-user.int.test.ts` |
| Fresh migration `0001`-`0058` | `pnpm --filter @nextbot/db run migrate:test` against a wiped, recreated `compose.test.yml` Postgres, run independently by QA | **PASS** -- "applied 58 migration(s)" | migration log |
| `@nextbot/iam` full suite | `vitest --project unit --project integration packages/modules/iam`, run independently | **PASS** -- 206/206 (33 files) | vitest output |
| Isolation suite | `vitest --project isolation`, run independently | **PASS** -- 92/92 (11 files), matches prior baseline exactly | vitest output |
| Typecheck | `pnpm run typecheck` (turbo, all packages), run independently | **PASS** for every package this phase touched; the one pre-existing, unrelated `@nextbot/model-gateway` test-file error (`route-admin-routes.test.ts`) reconfirmed present and unrelated to IAM/SSO | turbo output |
| Lint (repo-wide) -- the two previously-flagged errors | `pnpm run lint`, run independently (twice, once foregrounded to full completion) | **PASS -- genuinely clean, 0 errors/warnings.** Confirms dev's claim that `agent-platform.ts`/`security-tags.ts` were fixed as a side effect of Phase 5 landing. Finding 4 from the first pass is resolved. | eslint output (exit 0) |
| lint:boundaries (dependency-cruiser) | `npx dependency-cruiser --config .dependency-cruiser.cjs --output-type err apps packages`, run independently | **PASS** -- 0 violations, 2011 modules/5462 dependencies (matches dev's claim exactly) | dependency-cruiser output |
| Full repo unit+integration suite | `vitest run --project unit --project integration` (whole repo), run independently | **PASS** -- 1890/1890, 334 files. (Dev reported 1889/1890 with one resource-contention timeout on a full-parallel run; this independent run did not reproduce that flake at all -- consistent with dev's own characterization of it as parallel-load timing noise, not a real regression.) | vitest output |

## Defects

None found in this scope. The prior blocking Finding 1 is confirmed fixed by
independent adversarial evidence, not just by re-running dev's own tests. Findings 2
and 3 from the original report (disclosed API-key-over-HTTP scope gap, non-cryptographic
tenant-slug binding) were already marked non-blocking/informational in the original
pass and are unchanged by this retry -- not re-litigated here since dev's fix
deliberately did not touch that surface.

## Verdict

**PASS.** The retry-1 fix (`user_role.source` Manual/Sso distinction +
`syncSsoRoleAssignment` set-replacement re-derivation) correctly resolves the original
blocking defect: SSO role assignment is now genuinely re-derived fresh on every login,
a manually-granted role is never touched by that re-derivation (verified directly
against the `source` column, not just role presence), a role that happens to be both
Manual and currently-asserted is never silently reclassified, and the deliberate
refuse-to-shrink-to-zero edge case behaves exactly as designed (a no-op plus an
observable warning, not a crash or a silent full-wipe) while leaving the pre-existing
genuine-zero-role rejection path (`AuthNoRoleAssignedError`) untouched. Every
previously-passing check (SAML/OIDC forgery rejection, SCIM isolation/scoping,
real-time session/API-key revocation, API-key scope enforcement, cross-tenant API-key
forgery rejection, JIT toggle, SCIM `PUT displayName`, password+TOTP regression) was
re-confirmed unregressed. The two previously-flagged unrelated lint errors are
genuinely resolved repo-wide. Full regression (migration, `@nextbot/iam` suite,
isolation suite, typecheck, lint, lint:boundaries, full repo suite) reconciles cleanly
against dev's claims.

**This closes Phase 4 for good -- both the original scope and this retry. The
orchestrator can consider Phase 4 QA-green and move on.**
