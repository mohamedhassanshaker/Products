# QA Report — Target Architecture Blueprint Phase 4 (BL-36, FR-SEC-10)
SSO (SAML/OIDC), SCIM 2.0 provisioning, real-time session revocation, service
accounts + scoped API keys — `packages/modules/iam`

Dispatched immediately (not batched), per this project's auth-boundary-work rule.

## Scope tested

Everything in the dispatch brief: SSO login (SAML + OIDC), JIT provisioning
toggle, SCIM 2.0 Users resource + tenant isolation, real-time session
revocation, service accounts + scoped `nbk_…` API keys, the SCIM `PUT`
`displayName` fix, password+TOTP regression, and full-repo QC (typecheck,
lint, lint:boundaries, migrations, isolation, iam suite, full-repo suite).

## Environment

- `compose.test.yml` ephemeral Postgres (`localhost:55432`)/Redis/ClickHouse,
  reset (`down -v` + `up -d`) and freshly migrated (`0001`–`0053`) for this pass.
- All tests run via `vitest` against real Postgres (no mocked DB layer) except
  where explicitly noted (OIDC network layer mocked per dev's own documented,
  reasonable rationale — `openid-client`'s own crypto is out of this project's
  audit scope).
- No production environment touched. All fixture tenants created via
  `createFixtureTenant()`/cleaned via `deleteFixtureTenant()` in every test's
  `afterEach`. Temporary adversarial test files and debug scripts I authored
  during this pass were deleted before finishing; no artifacts left in the
  source tree.

## Traceability matrix

| Requirement / adversarial item | Scenario tested | Result | Evidence |
|---|---|---|---|
| Forged/garbage SAML assertion (unsigned, wrong signature, expired) | Hand-forged, self-signed XML (own cert authority) fed through real, unmocked `@node-saml` validation via `completeSamlLogin`; sanity-checked with a genuinely valid signed response first to prove the harness itself is sound | **PASS** | Independent test harness (deleted after run); all 3 forged cases + 1 sanity-check case green |
| Invalid OIDC token exchange | `authorizationCodeGrant` simulated to throw `invalid_grant`; confirms fail-closed wrapping | PASS (dev's own test, re-run and confirmed) | `sso-login.int.test.ts:116` |
| SCIM cross-tenant isolation | User provisioned via tenant A's SCIM token, confirmed invisible/unresolvable from tenant B's context | PASS (dev's own test, re-run and confirmed) | `scim-users.int.test.ts:42` |
| SCIM bearer token scoping | Tenant A's SCIM token rejected against tenant B's endpoint | PASS (dev's own test, re-run and confirmed) | `scim-users.int.test.ts:140` |
| Real-time session revocation | `isSessionActive()` checked immediately after `revokeMySession`/`adminRevokeSession`/`revokeAllMySessions`/`adminRevokeAllSessionsForUser` — no sleep, no cache; confirmed no caching layer exists in `session-repository.ts` (`isSessionActive` is a direct indexed DB read every call) | PASS (dev's own tests, re-run and confirmed; code-read confirms no cache) | `session-management.int.test.ts` (10 tests) |
| Real-time API-key/service-account revocation | Revoked key and disabled-service-account key both rejected on the very next `verifyApiKey()` call | PASS (dev's own tests, re-run and confirmed) | `service-account.int.test.ts:66,76` |
| API-key scope enforcement against the REAL RBAC path | (a) `connectors:Read`-scoped key: Read allowed, Write rejected, via the actual `requirePermission()` every route imports (dev's own test, re-confirmed); (b) **independently added**: an unscoped key whose account role grants `security_settings: None` — both Read and Write on that module rejected via the same real path, while its actually-granted module still works | PASS, **with a caveat** (see Finding 3) | `service-account.int.test.ts:45`; my own supplementary test (run green, then deleted per cleanup) |
| Cross-tenant API-key forgery (tenant-slug swap) | Real tenant A key's secret/keyId spliced onto tenant B's real slug — rejected; tenant-slug confirmed to be a routing label, not cryptographically bound, but safe in practice because `keyId` lookup is tenant-scoped and the forged tenant has no row for that `keyId` | PASS (dev's own test, re-run and confirmed) | `service-account.int.test.ts:98` |
| JIT provisioning toggle (off → reject unprovisioned; on → correct-tenant JIT) | Both directions tested against real Postgres | PASS (dev's own tests, re-run and confirmed) | `sso-login.int.test.ts:64,82` |
| **Role re-derivation across two logins with a changed IdP group assertion** | Same SSO identity logs in twice: login 1 asserts group→Tenant Admin, login 2 asserts a *different* group→Read-Only only | **FAIL — real defect** | See Finding 1 |
| Existing password+TOTP login regression | Full `authenticate-user.int.test.ts` (14 tests: lockout, wrong MFA, backup codes) re-run | PASS, unaffected | `authenticate-user.int.test.ts` |
| SCIM `PUT` `displayName` persistence fix | `replaceScimUser` int test + direct read of the Next.js route handler's body-mapping code confirming `body.displayName` is read and forwarded | PASS | `scim-users.int.test.ts:84`; `apps/web/app/api/scim/v2/[tenantSlug]/Users/[id]/route.ts:52-56` |
| RLS coverage on 4 new auth-adjacent tables | `sso_connection`/`auth_session`/`scim_token`/`api_key` confirmed in `TENANT_SCOPED_TABLES` and covered by the generic 68-row RLS-coverage isolation test | PASS | `rls-coverage.isolation.test.ts` (68/68 green after fresh migration) |
| Fresh migration `0001`–`0053` (incl. concurrent Phase 3) | `pnpm --filter @nextbot/db run migrate:test` against a wiped, recreated `compose.test.yml` Postgres | PASS | migration log: "applied 53 migration(s)" |
| Typecheck | `pnpm run typecheck` (turbo, all packages) | PASS for `@nextbot/iam` and every phase-4-touched package; 1 pre-existing, unrelated `@nextbot/model-gateway` test-file error confirmed (file has no relationship to IAM/auth) | turbo output |
| Lint (repo-wide) | `pnpm run lint` | **Not clean** — 3 errors, but all in files unrelated to Phase 4 (`packages/db/src/schema/agent-platform.ts` unused imports, `packages/yaml-diff/src/security-tags.ts` a parse error referencing later Blueprint-phase ADR-0016 work). `@nextbot/iam`-scoped lint (`npx eslint packages/modules/iam`) is clean. See Finding 4. | eslint output |
| lint:boundaries (dependency-cruiser) | `npx dependency-cruiser --config .dependency-cruiser.cjs --output-type err apps packages` | PASS — 0 violations, 1980 modules/5313 dependencies | dependency-cruiser output |
| `@nextbot/iam` full suite | unit + integration, run via `vitest --project unit --project integration packages/modules/iam` | PASS — 200/200 | vitest output |
| Isolation suite | `vitest --project isolation` | PASS — 92/92 (11 files) | vitest output |

## Defects (ordered by severity)

### Finding 1 — BLOCKING: SSO role assignment silently accumulates instead of being re-derived fresh (contradicts the phase's own documented security guarantee)

**Expected** (README decision #1, and `sso-login.ts`'s own doc comment, verbatim):
> "Role assignment is always re-derived fresh from `sso_group_mapping`/`defaultRoleId` at every login — never trusted from a stale prior assignment... an IdP-side group change takes effect on the very next SSO login."

**What actually happens**: `resolveIdentityAndIssueSession()` (`sso-login.ts:94-96`) computes the *currently*-asserted role IDs and calls `assignRolesToUser(ctx, userId, roleIdsToAssign)`, but `assignRolesToUser` (`role-repository.ts:68-76`) is a pure **additive** `INSERT ... ON CONFLICT DO NOTHING` — it never removes a `user_role` row for a role no longer asserted. `getUserRolesAndMatrix()` then reads **every** `user_role` row ever inserted for that user and takes the union (`mergePermissionMatrices` — highest grant per module wins). The practical effect: once a user has ever been granted a role via SSO, that role's permissions persist through every subsequent login **regardless of what the IdP currently asserts**, because the stale row is never retracted.

**Repro** (independently constructed, not from dev's own fixtures):
1. Enterprise-tier tenant, OIDC connection, JIT on, group mappings: `"admins"` → Tenant Admin, `"readonly"` → Read-Only.
2. Login 1: IdP asserts `groups: ["admins"]`. Result: `permissions.security_settings === "Write"` (Tenant Admin). Correct.
3. Login 2 (same `sub`/identity): IdP now asserts `groups: ["readonly"]` only (the "admins" membership was revoked IdP-side).
4. **Actual**: `second.roleIds` still contains the Tenant Admin role ID from login 1, and `second.permissions.security_settings` is still `"Write"` — not `"None"` as a fresh Read-Only-only assignment would produce.

This is a real privilege-persistence bug: an admin who is demoted at the IdP (removed from the admin group) keeps full admin permissions in NextBot indefinitely via SSO, contradicting the phase's own stated security invariant and the exact scenario QA dispatch item #10 asks to verify.

**Originating phase**: Phase 4 (dev misused the pre-existing, intentionally-additive `assignRolesToUser` primitive — correct for its original Phase 2 use, an admin manually granting an *additional* role — in a new context that requires set-replacement semantics, not additive ones). Not a Phase 2 regression; the primitive itself behaves as designed for its original caller.

**Suggested fix direction (not applied — QA does not fix)**: `resolveIdentityAndIssueSession` needs a "replace this user's role set" operation for the SSO path specifically (e.g., delete `user_role` rows for this user that aren't in the newly-computed `roleIdsToAssign` set, within the same transaction as the insert) — or a dedicated `syncSsoRoleAssignment()` that diffs and removes stale rows, distinct from the admin-console's intentionally-additive `assignRolesToUser`.

**Severity**: Blocks the requirement — this is exactly the auth-boundary correctness property this phase exists to deliver, and the class of bug (stale privilege escalation) this project's immediate-QA rule specifically targets.

### Finding 2 — Non-blocking, disclosed scope gap (informational, not a defect): API-key scope enforcement cannot be verified end-to-end over real HTTP yet

Dispatch item #7 asks to trace scope enforcement "through the actual `requirePermission()` call a real route handler makes." I confirmed `requirePermission()` is indeed the same function (traced via `verifyApiKey()` → `SessionClaims` → `requirePermission()`), but **no live HTTP route currently accepts an `nbk_…` bearer key** — `apps/web/src/lib/api-guard.ts`'s `requireApi()` (the composition-root guard every `/api/v1/admin/**` route uses) deliberately still calls session-cookie-only `getSession()`, not the bearer-key-aware `getAuthContext()`. This is disclosed clearly in both the README and the guard's own code comment as an intentional Phase-18 deferral, not a hidden gap. I verified the deepest layer that *is* wired (the exact `requirePermission()` symbol every route imports, fed real `SessionClaims` from a real `verifyApiKey()` call) rather than a live HTTP round trip, since none exists to test against yet. Flagging this so the record is accurate: full HTTP-level verification of this claim will only be possible once a route is retrofitted (Phase 18).

**Severity**: Informational — accurately disclosed by dev, not a regression, no action needed from this phase.

### Finding 3 — Non-blocking: tenant-slug segment in `nbk_` API keys is not cryptographically bound to the key material

Per dispatch item #8: the `nbk_<tenantSlug>.<keyId>.<secret>` format's tenant-slug segment is a plain routing label, not bound via HMAC/signature to `keyId`/`secret`. Security holds today only because `keyId` lookup is tenant-scoped (`WHERE tenant_id = ... AND key_prefix = ...`) and `keyId` has ~72 bits of entropy, so a forged cross-tenant splice finds no matching row in practice (confirmed empirically — dev's own cross-tenant forgery test, re-run and passing). This is explicitly, deliberately how dev designed it (README decision #3, "no cross-tenant table scan"), and it is safe as implemented, but it is worth recording explicitly since the dispatch specifically asked whether the binding is cryptographic or cosmetic: it's the latter, protected by keyspace size rather than a cryptographic binding.

**Severity**: Low-likelihood edge case / informational — not a blocking defect given the entropy involved, but worth the architecture team's awareness if `keyId` generation parameters ever change.

### Finding 4 — Non-blocking: repo-wide `lint` is not actually clean (contradicts dev's decision-log claim), but not attributable to this phase

`pnpm run lint` (full repo) fails with 3 errors:
- `packages/db/src/schema/agent-platform.ts:20` — unused imports `skill`/`skillVersion`.
- `packages/yaml-diff/src/security-tags.ts:23` — a parsing error (`'}' expected`).

Both files are unrelated to `packages/modules/iam`/SSO/SCIM — `security-tags.ts`'s own content references ADR-0016 and a "Blueprint Phase 5" correction, i.e. work from a different, apparently-already-landed phase in this snapshot, not Phase 3 or Phase 4. `@nextbot/iam`-scoped lint (`npx eslint packages/modules/iam --max-warnings=0`) is clean, and `dependency-cruiser` (the other half of `lint:boundaries`) is clean with 0 violations. Recorded here only because dev's decision-log entry states "`pnpm run lint` (eslint, 0 warnings) clean across the whole repo," which is not accurate as of this QA pass — but the cause is pre-existing/unrelated to Phase 4, so it does not block this phase's verdict.

**Severity**: Low — inaccurate claim in dev's own decision log, but the actual defect (if any) belongs to whichever other phase touched those two files, not Phase 4.

## Verdict

**FAIL** — blocked by Finding 1 (stale SSO role/privilege persistence across logins, contradicting this phase's own documented "always re-derived fresh, never stale" security guarantee). Everything else tested (SAML/OIDC forgery rejection, SCIM isolation/scoping, real-time session and API-key revocation, API-key scope narrowing on the same module, JIT toggle both directions, the SCIM `PUT displayName` fix, and the password+TOTP regression) passed independent adversarial verification. Route Finding 1 back to `nexus-dev` for a retry; Findings 2–4 are informational/non-blocking and do not need to gate this retry.