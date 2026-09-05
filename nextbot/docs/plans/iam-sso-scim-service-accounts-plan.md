# Phase 4 — SSO/SCIM + session management + service accounts (BL-36)

Source: `docs/plans/target-architecture-blueprint-plan.md`'s Phase 4 section,
`docs/PRODUCT_SPECIFICATION.md` FR-SEC-10/FR-ADM-02/FR-SEC-03/NFR-17,
`docs/blueprint/NextBot-Target-Architecture-Blueprint.md` §12.6/G-12,
`docs/architecture/LLD.md` §3.3 (`app_user`/`sso_group_mapping` already schema-ready),
§5.1 (`/api/v1/admin/**` accepts a tenant API key `Authorization: Bearer nbk_…`
alongside the session cookie — named but not yet implemented).

This is a single-phase dispatch (no sub-phases) because every piece — SSO, SCIM,
sessions, service accounts — shares one thing: they all mutate or bypass the
authentication boundary, so splitting them across dispatches would leave the
system in an intermediate state where *some* auth paths are revocation-aware and
others aren't. Per this project's own rule, this phase gets **immediate**
security-relevant QA, not batched with any other phase.

## Backlog item

BL-36.

## Key decisions (recorded here per nexus-dev §3/§7)

1. **JIT provisioning, opt-in per connection, default ON.** FR-ADM-02 already says
   "SSO group mapping can auto-assign roles" and the schema already ships
   `sso_group_mapping` (external group → role) with no accompanying "invite first"
   mechanism — that only makes sense if a user can be created at first SSO login.
   Decision: `sso_connection.jit_provisioning_enabled` (default `true`) controls
   this per-tenant; when `false`, SSO login requires a pre-existing `app_user` row
   with a matching `email` (linked to `sso_subject` on first successful login) and
   is rejected otherwise. Either way, role assignment at login time is always
   re-derived from `sso_group_mapping` + `default_role_id`, never trusted from a
   stale prior assignment.
2. **One SSO connection per tenant.** The spec speaks of "an identity provider"
   (singular); `sso_connection.tenant_id` is unique. A tenant that later needs a
   second IdP is out of scope for this phase (not required by any FR-n).
3. **API key format carries its own tenant/lookup key, no cross-tenant table scan.**
   `nbk_<tenantSlug>.<12-char keyId>.<32-char secret>` — the tenant slug and keyId
   are looked up by ordinary tenant-scoped RLS reads (`resolveTenantBySlug` then a
   `WHERE tenant_id = ... AND key_prefix = ...` read), never a platform-wide
   bypass. This avoids extending `withPlatform()`'s allow-list (LLD §3.2 rule 4)
   for a login-adjacent path, which is out of scope for this phase to touch.
4. **SCIM tenant resolution via URL path, not token content.** `/api/scim/v2/
   {tenantSlug}/**`, bearer-token-authenticated against that tenant's own
   `scim_token` row (one active token per tenant, rotate-only, argon2id-hashed
   same as passwords/API keys). Same reasoning as #3 — no platform-wide scan.
5. **Session revocation is real-time, not cached.** `auth_session` is a new
   persisted table (`id` = the JWT's `sid` claim, `revoked_at`/`expires_at`).
   Every request that resolves a session (`apps/web/src/lib/session.ts`'s
   `getSession()`) now does one extra indexed lookup against this table in
   addition to the existing stateless JWT verify — a revoked/expired session is
   rejected on the very next request, not after a TTL/cache window. This is a
   deliberate, disclosed architecture change to the previously-fully-stateless
   session token (see `packages/modules/iam/README.md` for detail) — required
   because a purely stateless JWT cannot support real revocation at all.
6. **Service accounts reuse `app_user`/`user_role`, not a parallel identity
   model.** `app_user.kind` (`Human` | `ServiceAccount`) distinguishes them; a
   service account is assigned roles via the *same* `user_role` table, so its
   effective permission matrix is computed by the *same* `mergePermissionMatrices`
   path a human user's is. An API key optionally carries a `scope_matrix` that can
   only **narrow** (never widen) the service account's role-derived matrix —
   enforced by intersection at auth time, not trusted from the key row alone.
7. **SCIM DELETE never physically deletes a user row.** Deactivates
   (`status = 'Disabled'`) and revokes all sessions, mirroring the "no destructive
   action without a flag" rule (§7) — a hard delete of `app_user` would cascade
   into conversation/audit history FKs, which is exactly the kind of irreversible
   action this project's dev-agent rules require flagging rather than silently
   doing. SCIM's own spec (RFC 7644 §3.6) doesn't mandate a hard delete either —
   "resource no longer exists / accessible" is satisfied by deactivation.
8. **NFR-17 plan-tier gate.** Creating/enabling an `sso_connection` or issuing a
   SCIM token requires the tenant's plan tier to be `Enterprise` (checked via
   `@nextbot/tenancy`'s existing `getTenantPlanTier`) — service accounts/API keys
   and session listing/revocation are not gated (they're baseline security
   hygiene, not an enterprise-only capability per the spec's wording).

## Scope

- `packages/db/src/schema/iam.ts` + migrations `0049`–`0051`: `sso_connection`,
  `auth_session`, `scim_token`, `api_key` tables; `app_user.kind` column; new
  enums (`sso_protocol`, `sso_connection_status`, `user_kind`); `login_outcome`
  gains `SsoFailed` (separate single-statement migration per the `ALTER TYPE ADD
  VALUE` same-transaction restriction, same pattern Model Gateway v2 used).
- `packages/contracts/src/iam.ts`: new request/response schemas + domain errors.
- `packages/modules/iam`: SAML (`@node-saml/node-saml`) + OIDC (`openid-client`)
  login flows, SCIM Users resource, session listing/revocation,
  service-account + API-key issuance/verification, all wired through the
  existing `http/admin-routes.ts` composition-root convention.
- `apps/web/app/api/v1/admin/**` new routes (sso config, scim token, sessions,
  service-accounts), `apps/web/app/api/sso/**` (SAML ACS / OIDC callback,
  unauthenticated by definition), `apps/web/app/api/scim/v2/[tenantSlug]/**`
  (bearer-token-authenticated, not session-cookie), `apps/web/src/lib/session.ts`
  (revocation check + bearer-API-key acceptance for `/api/v1/admin/**`).
- New console screens under `/settings/sso` (SSO/SCIM config card, added to the
  Settings hub, `security_settings` gated), `/settings/sessions` (personal
  session list, no permission gate beyond authentication — plus an admin-visible
  "all tenant sessions" table gated `users_roles` Read/Write), `/settings/
  service-accounts` (`users_roles` gated, consistent with how user/role admin is
  already gated).

**Out of scope** (explicitly, not silently dropped): SAML/OIDC single-logout
(SLO), SCIM Groups resource (role assignment happens via SCIM Users' custom role
attribute + the existing `sso_group_mapping`/direct role-id assignment, not a
second parallel Groups-resource path), multiple IdPs per tenant.

## Exit gate

Standard batched gate (typecheck/lint/lint:boundaries, full test suite,
coverage ≥80% on changed files) **plus**:

- A successful SSO login (both SAML and OIDC) resolves to a real, correctly
  tenant-scoped `app_user` row and a valid session.
- A forged/invalid SAML assertion or OIDC token is rejected (fail-closed), never
  silently accepted.
- A SCIM-provisioned user in tenant A is never visible/resolvable from tenant
  B's context (real 2-tenant adversarial test).
- A revoked session is rejected on the very next request (no cache/TTL window).
- A deactivated service account's API key is rejected on the very next request.
- An API key scoped to `connectors:Read` cannot perform a `connectors:Write`
  action through the real authorization path (not a mocked check).
- The existing password+TOTP login path has zero regressions.

**Status: IMPLEMENTED 2026-08-29 — flagged for IMMEDIATE (not batched) security-relevant
QA, per this phase's own brief and this project's standing rule for auth-boundary work.
Full implementation report, decisions, and verification results are in
`docs/NEXUS_STATE.md`'s 2026-08-29 dev decision-log entry (Phase 4) and
`docs/plans/target-architecture-blueprint-plan.md`'s Phase 4 section. NOT yet
QA-approved — orchestrator should dispatch `nexus-qa` for this phase immediately,
not batched with Phase 3/5/6.**
