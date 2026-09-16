# ADR-0006 — Local auth now, SSO later, port from day one

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Product owner, architecture

## Context

SHJ3 has **two unrelated identity problems**, and conflating them would be an error:

| Principal | Need | Wireframe |
|---|---|---|
| **Staff** | Sign in to the backoffice; map to one of 7 roles across 4 teams; MFA appropriate to a government admin surface | B9 — users, teams, the 7×8 permission matrix, `Invited` / `Active` / `Suspended` states |
| **Citizen** | Mostly anonymous; become *verified* before money moves | B11 — UAE PASS returning verified name, Emirates ID hash and mobile; OTP fallback; Emirates ID scan; four assurance levels in the step-up rules |

The eventual targets are clear: **Entra ID or Keycloak** for staff, **UAE PASS** for citizens. UAE PASS is the mandated national digital identity for UAE government services and is not something an application can self-provision — it requires onboarding, credentials and a procurement path.

The product owner's decision: **"local auth for now, later I will connect with SSO."**

The danger in that decision is well known. "Local auth now, SSO later" usually produces an application whose session model, user table and authorization checks are so entangled with password authentication that adding OIDC becomes a rewrite. Meanwhile B11's step-up rules — the most consequential logic in the system, gating payments — cannot be built or tested at all without *some* verification implementation.

## Options considered

### A. Build local auth directly into the application

Password columns on the user table, session logic in middleware, `req.user.password_hash` reachable from feature code.

- **For:** Fastest to write.
- **Against:** Exactly the trap described above. Authentication mechanism leaks into feature modules; every one of them must change when SSO arrives. Rejected.

### B. Wait for SSO; build no auth

- **For:** No throwaway work.
- **Against:** Blocks all 14 backoffice screens, because every one is RBAC-gated. Blocks B11 entirely. Rejected.

### C. Ports with swappable adapters — **chosen**

Two ports, `IdentityProvider` (staff) and `VerificationProvider` (citizen), with local/mock adapters now and OIDC/UAE PASS adapters later.

- **For:** Feature code never learns how a principal authenticated. SSO becomes one new adapter plus configuration. B11's step-up rules become buildable and testable immediately against the mock.
- **Against:** One layer of indirection, and the local adapter is genuinely throwaway code.

## Decision

**Two ports, adapters swappable by configuration.**

```
ports/
├── IdentityProvider        authenticate(credentials) → Principal
│                           adapters: LocalPasswordProvider  (now)
│                                     OidcProvider           (later: Entra ID / Keycloak)
└── VerificationProvider    verify(session, level) → AssuranceResult
                            adapters: MockVerificationProvider (now)
                                      UaePassProvider          (later)
                                      OtpProvider              (later)
```

### Binding rules

1. **Feature modules consume `Principal`, never credentials.** A `Principal` carries id, tenant, roles, permissions and assurance level — and nothing about *how* it was established. No feature module may reference a password, a token, a cookie or an OIDC claim.
2. **Sessions are opaque and adapter-independent.** A server-side session in Redis keyed by an opaque id, never a JWT carrying claims the application interprets. This is deliberate: OIDC arrival then changes only how the session is *created*, not how it is read, and revocation stays immediate.
3. **The user record has no `password_hash` column.** Credentials live in a separate `LocalCredential` table owned solely by the local adapter. When SSO lands, that table is dropped and no other table changes — the migration is a deletion, not a restructuring.
4. **Local auth is built to production standard anyway**, because it will be in front of a government backoffice for some period: Argon2id hashing, mandatory TOTP for every role that can publish or manage users, rate-limited login with progressive backoff, account lockout, forced rotation on invite acceptance, and no password reset via email link without a second factor. "Temporary" is not a licence for weak authentication.
5. **The mock verification adapter is a first-class test fixture, not a stub.** It implements all four assurance levels from B11 tab 2 — *anonymous allowed*, *verified identity required*, *verified + OTP* — and can be driven to any state by a test. The step-up tests written against it are the same tests that will validate `UaePassProvider`, unchanged. That is how this ADR avoids the usual trap.
6. **The mock cannot run in production.** Adapter selection is environment configuration, and the process refuses to boot if `MockVerificationProvider` is selected while the environment is Production. A mocked verification path in front of real payments is the worst failure this system could have, so it is prevented at startup rather than by policy.
7. **Authorization is entirely separate from authentication.** The 7×8 matrix in B9 is evaluated against `Principal.permissions`, deny-by-default, in the inbound adapter. Swapping identity providers does not touch authorization at all.

## Consequences

### Positive

- All 14 backoffice screens and B11's step-up logic are buildable now.
- SSO arrival is one adapter, one config change, one dropped table — the stated intent is preserved rather than quietly becoming a rewrite.
- Opaque server-side sessions give immediate revocation, which matters for B9's `Suspended` state: suspending a user must end their session now, not at token expiry.
- The step-up test suite has real value before UAE PASS exists, and carries over intact.

### Negative

- The local adapter is throwaway code, built to production standard, that will be deleted. Accepted cost.
- MFA enrolment, reset and recovery flows must be built for a temporary mechanism. Reduced by requiring TOTP only for privileged roles.
- One indirection layer between a request and a user.
- Until UAE PASS is connected, B11's verification screens are configurable but not truly exercised end to end; the assurance guarantees are only as good as the mock. This is stated plainly in `testing.md` so nobody reads a green step-up suite as proof that real verification works.

### Follow-up

- UAE PASS onboarding is a **procurement dependency with a long lead time**; it should start now rather than when the code is ready. Tracked as **RISK-004** in `requirements.md`.
- Decide staff SSO target (Entra ID vs Keycloak) before build of the OIDC adapter; the choice affects group→role mapping only.
