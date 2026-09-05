# @nextbot/iam

BL-01 auth/RBAC slice (Phase 2): `app_user`/`role`/`user_role`/`sso_group_mapping`/
`login_attempt`/`login_lockout_policy`/`mfa_secret`, password + TOTP MFA, lockout,
RBAC permission-matrix guard (`docs/architecture/LLD.md` §3.3).

## Auth architecture decision: why this isn't a literal Better Auth integration

ADR-0002 names **Better Auth** as the auth library. This module implements Better
Auth's *feature set* (email+password, SSO config surface, per-role MFA with backup
codes, org/tenant model, account lockout) natively against the LLD's own schema,
rather than wiring the `better-auth` npm package's adapter directly, for a concrete
architectural reason:

Better Auth's adapter model assumes a single long-lived DB client/pool with no
per-request transaction scoping, and its own session/user/account tables are not
designed to sit behind a `SET LOCAL app.current_tenant` + RLS boundary re-established
per request. NextBot's entire isolation model (ADR-0001) is that **all** data access —
including the most sensitive table in the schema, user credentials — goes through
`withTenant()`'s transaction-scoped RLS primitive. Bolting Better Auth's adapter onto
that primitive would require either (a) giving Better Auth its own non-RLS-protected
tables for credentials (weakening ADR-0001's guarantee for exactly the data that most
needs it), or (b) forcing Better Auth's adapter to open a fresh `withTenant`-scoped
transaction per internal call, which its adapter interface isn't built around and
which would be fragile to keep correct across every Better Auth internal code path
this dev phase cannot fully audit in one dispatch.

**This is flagged to the architect/orchestrator rather than silently decided** (per
nexus-dev's operating instructions §3/§7: a library substitution and an auth-boundary
decision both call for a stop-and-flag, not a quiet workaround) — see
`docs/plans/nextbot-plan.md`'s Phase 2 dispatch notes and `docs/NEXUS_STATE.md`'s
decision log for the same note. The `better-auth` package is **not** added as a
dependency. If the architecture team wants literal Better Auth wired in a later pass,
the schema (`app_user` etc.) and the feature surface here (argon2id hashing, TOTP,
lockout, RBAC) should still be directly reusable — swapping the session-issuance layer
(`application/session-token.ts`) for Better Auth's session cookie handling is the
main remaining seam.

## What's fully implemented vs. stubbed this phase

- **Fully implemented:** email+password login, argon2id hashing, TOTP MFA (enrollment
  + challenge + backup codes), configurable lockout (default 5/15min, FR-SEC-03),
  RBAC permission matrix + `requirePermission()` guard, the six seeded system roles,
  zero-role fail-closed rejection (`AUTH_NO_ROLE_ASSIGNED`).
- **Stubbed (per the plan's open item #2 — SMS/email MFA provider choice deferred):**
  SMS/Email MFA methods are named in the `mfa_method` enum and the `app_user` schema
  supports them, but only TOTP has a working `MfaChallenger`-shaped implementation
  (`domain/totp.ts`). Wiring an SMS/email provider is a later, local/reversible choice.
- **Not implemented this phase:** SAML/OIDC SSO callback handling itself (the
  `sso_subject`/`sso_group_mapping` schema exists and is ready for it, but the actual
  IdP redirect/callback flow is out of scope for this dispatch's time budget — flagged
  as a gap, not silently declared done).

  **Closed by Phase 4 below.**

## Phase 4 (BL-36, FR-SEC-10) — SSO (SAML/OIDC), SCIM, session management, service
## accounts + scoped API keys

Adds, on top of the Phase 2 slice above: SAML + OIDC single sign-on (additive —
the existing password+TOTP flow is completely unchanged), a SCIM 2.0 Users
resource, real-time session listing/revocation, and service accounts with
scoped `nbk_…` API keys (LLD §5.1's tenant-API-key mechanism, first
implemented here). This is security-relevant, auth-boundary work — per this
project's own rule it gets **immediate** QA, not batched with anything else.

### Key decisions (see also the plan doc, `docs/plans/iam-sso-scim-service-accounts-plan.md`)

1. **JIT provisioning, opt-in per connection, default ON.** FR-ADM-02 already
   documents "SSO group mapping can auto-assign roles," and `sso_group_mapping`
   existed since Phase 2 with no accompanying "invite first" mechanism — that
   only makes sense in a JIT flow. `sso_connection.jitProvisioningEnabled`
   (default `true`) lets a tenant require pre-invited users instead
   (`SsoUserNotProvisionedError` when off and no matching invited user exists).
   Either way, role assignment is always re-derived fresh from
   `sso_group_mapping`/`defaultRoleId` at every login — never trusted from a
   stale prior assignment. **QA retry 1 fix (`20260829-054900` Finding 1)**:
   the first implementation violated this invariant — it called the additive
   `assignRolesToUser`, which never retracts a role the IdP stops asserting.
   Fixed via `user_role.source` (`Manual` | `Sso`) and
   `role-repository.ts`'s `syncSsoRoleAssignment`, which deletes/re-inserts
   only `source = 'Sso'` rows to match the current assertion exactly, never
   touching a `Manual` (console/SCIM/service-account) grant, and never
   shrinking the SSO-derived set to zero on an empty/misconfigured assertion
   (a no-op + warning instead — see `docs/plans/target-architecture-blueprint-
   plan.md`'s Phase 4 "Retry 1" section for full rationale).
2. **One SSO connection per tenant** (`sso_connection.tenant_id` unique) — the
   spec speaks of "an identity provider," singular.
3. **API key format avoids any cross-tenant table scan.** `nbk_<tenantSlug>.
   <keyId>.<secret>` — the tenant slug is public (already in the login URL),
   only `keyId`/`secret` need to stay confidential. Verification resolves the
   tenant via the same public `resolveTenantBySlug()` the password-login path
   uses, then does an ordinary tenant-scoped, RLS-protected `WHERE tenant_id =
   ... AND key_prefix = ...` read — never a `withPlatform()` bypass.
4. **SCIM tenant resolution via URL path** (`/api/scim/v2/{tenantSlug}/Users`),
   bearer-token-authenticated against that one tenant's own `scim_token` row
   (one active token per tenant, rotate-only, argon2id-hashed like a
   password). Same "no cross-tenant scan" reasoning as #3.
5. **Session revocation is real-time, not cached.** The session JWT
   (`application/session-token.ts`) is no longer purely stateless — it now
   carries a `sid` claim pointing at a new `auth_session` row
   (`infrastructure/session-repository.ts`). Every session-consuming request
   (`apps/web/src/lib/session.ts`'s `getSession()`) does one additional
   indexed lookup confirming the session isn't revoked/expired, in addition to
   the existing JWT signature check. This is a deliberate, disclosed
   architecture change — a bare JWT cannot express "this was just revoked" at
   all, so real revocation requires this DB-backed check.
6. **Service accounts reuse `app_user`/`user_role`, not a parallel identity
   model.** `app_user.kind` (`Human` | `ServiceAccount`) distinguishes them —
   they're assigned roles through the exact same table/RBAC matrix a human
   user is. An API key's optional `scope_matrix` can only **narrow** (never
   widen) the account's role-derived matrix — enforced by intersection at
   verification time (`domain/permission-scope.ts`), not trusted from the key
   row alone, and re-derived from the account's LIVE roles on every call (a
   role change or account disablement takes effect on the key's very next use).
7. **SCIM `DELETE`/`PATCH active:false` deactivate, never hard-delete.** A
   physical `app_user` delete would cascade into conversation/audit-log FK
   history — exactly the irreversible-action class this project's dev-agent
   rules require flagging rather than silently doing. RFC 7644 §3.6 doesn't
   require a hard delete either.
8. **NFR-17 plan-tier gate.** Creating/activating an `sso_connection` or
   rotating a SCIM token requires the tenant's plan tier to be `Enterprise`
   (`@nextbot/tenancy`'s `getTenantPlanTier`). Sessions and service accounts
   are not gated — they're baseline security hygiene, not an
   enterprise-only capability per the spec's wording.

### Libraries added this phase (checked against the ADR's maturity bar — not
### named in the LLD, which was silent on SSO/SCIM's concrete protocol library)

- **`openid-client`** (panva, MIT) — OIDC discovery + authorization-code flow +
  ID-token validation. Widely adopted, actively maintained.
- **`@node-saml/node-saml`** (MIT) — maintained fork of `passport-saml`, used
  standalone (not through Passport middleware) for the two operations this
  module needs: build the redirect, validate the POSTed response.
  `wantAssertionsSigned: true` is set unconditionally — the library's own
  signature-verification gate.

### What this phase does NOT cover (disclosed, not silently dropped)

- SAML/OIDC single logout (SLO).
- A SCIM Groups resource — role assignment travels on a Users-resource
  extension attribute (`nextbotRoleIds`) plus the existing
  `sso_group_mapping`, not a second parallel resource type.
- Multiple IdPs per tenant.
- Retrofitting every pre-existing `requireApi()`-gated `/api/v1/admin/**`
  route (connectors, tools, escalations, etc.) to accept the new `nbk_…` API
  key — `apps/web/src/lib/session.ts`'s `getAuthContext()` resolves a bearer
  key into the exact same `SessionClaims` shape a session cookie does and is
  available today to any route that wants it, but making it the *default* for
  every existing composition-root call site is FR-API-01's Public API scope
  (Phase 18 in the blueprint plan, not this phase) — wiring it in now would
  have been an undisclosed scope expansion into a later phase's work, and
  would have required updating ~16 existing test files' mocks with no
  corresponding FR-n requirement in this phase's brief.
