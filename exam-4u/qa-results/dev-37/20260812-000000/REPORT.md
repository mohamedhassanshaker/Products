# QA Report - Dev-37 (BL-36: Self-serve tenant plan upgrades)

**Date:** 2026-08-12
**Scope:** Dev-37 only (BL-36, FR-PKG-6's self-serve half). Dev-38+ not evaluated (not started).
**Environment:** Local dev stack - apps/api against live examland-mysql (docker container
examland-mysql, root/YourPassword), AI_ENGINE=disabled, real-network Stripe replaced by
FakeNetworkStripeGateway (same technique as Dev-11's own e2e suite) for checkout-session creation;
webhook signature verification is genuinely exercised (real HMAC via Stripe.webhooks
.generateTestHeaderString). No production system touched. All test tenants/schemas created and
torn down by the test suites themselves (DROP DATABASE in afterAll).

## Verdict: NOT READY -- BLOCKING DEFECT

**Definitive answer to the packageId question: a completed Stripe checkout does NOT change the
tenant's package.** BillingWebhookService.handleCheckoutCompleted -> TenantSubscriptionRepository
.markActiveFromCheckout only ever writes status='ACTIVE', providerCustomerId,
providerSubscriptionId -- it never touches packageId. This is not a "different mechanism" masking
the gap; there is no other code path that reassigns packageId on checkout completion anywhere in
the codebase. SubscriptionAdminService.reassign (a separate, Platform-Admin-only, non-Stripe action
per FR-PKG-4) is the only code that ever changes packageId, and this phase's self-serve flow never
calls it.

This means: a Tenant Admin who completes a real Stripe payment to upgrade from Starter to Pro will
be charged (or would be, against real Stripe), see their subscription status stay ACTIVE, and their
packageId stay on starter forever -- the plan-upgrade feature this entire phase exists to
deliver does not work end to end. This is not a rough edge; it defeats FR-PKG-6/BL-36's stated
purpose ("self-serve tenant plan upgrades").

### How this was verified (in addition to independent code tracing)
Dev-37's own new e2e test, apps/api/test/tenant-billing.e2e-spec.ts ("reuse proof: the exact same
unmodified BillingWebhookService activates this tenant" -> "checkout.session.completed (signed) moves
this tenant to ACTIVE"), explicitly asserts the broken behavior as the expected outcome:

    await signedWebhookRequest({ ... }); // checkout initiated for proPackageId, webhook signals completion
    const after = await subscriptions.findByTenantId(tenantId);
    expect(after?.status).toBe('ACTIVE');
    expect(after?.providerSubscriptionId).toBe(providerSubscriptionId);
    expect(after?.packageId).toBe(starterPackageId); // <-- asserts the tenant is STILL on starter

I re-ran this suite myself against the live MySQL container (DB_HOST=127.0.0.1 DB_PORT=3306
DB_USER=root DB_PASSWORD=YourPassword npm run test:e2e -- tenant-billing billing.e2e, from
apps/api) -- both tenant-billing.e2e-spec.ts (8 tests) and Dev-11's own billing.e2e-spec.ts (13
tests) passed, 21/21, confirming this assertion holds in a real run, not just in the source.

I additionally traced the frontend's own post-checkout confirmation logic
(billing-settings.component.ts): the ?checkout=success return handler's `confirmed` condition is
`result.status === 'ACTIVE' && (result.currentPackageId !== packageIdBeforeReturn || !wasAlreadyActive)`.
For the realistic upgrade case -- a tenant already ACTIVE on starter upgrading
to pro -- wasAlreadyActive is true and currentPackageId never changes, so confirmed is never
true; the UI will poll until its bounded timeout and show the timeout banner, never the success
banner, for every real upgrade attempt. The user-visible symptom compounds the backend defect: not
only does the package never change, the UI cannot even report success correctly for this flow.

This is the same root cause the completion notes flag as "pre-existing Dev-11 behavior, not a
regression introduced by this phase" -- that framing is accurate as to authorship but not to
severity. Per the orchestrator's explicit instruction, a pre-existing gap that this phase's entire
feature depends on being correct must be treated as blocking regardless of which phase's code it
lives in. The bug was masked in Dev-11 because a Platform Admin can (and, per LLD/spec, would)
separately call SubscriptionAdminService.reassign to set the target package before or after
triggering checkout -- a workaround with no equivalent in the tenant realm, since Tenant Admins have
no access to SubscriptionAdminService's Platform-Admin-only endpoint.

## Traceability matrix

| Req | Scenario | Result | Evidence |
|---|---|---|---|
| FR-PKG-6 (self-serve upgrade, core) | Tenant Admin browses catalog, initiates checkout, completes payment, package actually changes | FAIL -- BLOCKING | Code trace of billing-webhook.service.ts:105-116 + tenant-subscription.repository.ts (markActiveFromCheckout only sets status/provider ids); dev's own tenant-billing.e2e-spec.ts:252 asserts packageId unchanged after a signed "upgrade" checkout completes; independently re-ran suite, confirmed passing (i.e., defect confirmed present) |
| FR-PKG-6 (view own subscription) | GET /tenant/billing/plans returns current package/status + active catalog | PASS | tenant-billing.e2e-spec.ts "GET /tenant/billing/plans" describe block, re-run green; code trace of TenantBillingService.getPlans |
| RBAC -- Tenant Admin can initiate checkout | POST succeeds (201) for Tenant Admin with billing.manage | PASS | e2e "a Tenant Admin can initiate checkout..." -- 201, url matches Stripe checkout URL pattern; re-run green |
| RBAC -- Member gets 403 | POST rejected for Member (present, no billing.manage) | PASS | e2e "rejects a Member...with FORBIDDEN" -- 403, error.code === 'FORBIDDEN'; re-run green; log line confirms real HTTP 403 |
| RBAC -- unauthenticated gets 401 | No token -> 401 on both GET/POST | PASS | e2e "rejects an unauthenticated request" / "rejects with no token at all"; re-run green |
| Tenant-scoping (no cross-tenant tamper) | Tenant id derived only from TenantContext, never a route/body param | PASS | Code review: TenantBillingController.currentTenantId() reads exclusively from getRequestContext().tenantId; neither controller method signature nor CreateCheckoutSessionDto carries a tenant id field -- structurally inexpressible, matches TenantBrandingController precedent |
| Server-side package validation | Unknown/inactive packageId rejected server-side even if client-supplied | PASS | e2e "404s for an unknown package"; BillingCheckoutService.createCheckoutSession re-validates via PackageRepository.findById/isActive regardless of caller |
| billing.manage not backfilled | Pre-Dev-37 tenants lack billing.manage; documented, not silently fixed | PASS (as a documented gap) | Code review: billing.manage only added to SeedRbacStep.PERMISSIONS (provisioning-time), no corresponding entry in infrastructure/database/migrations/tenant/index.ts; genuinely absent for already-provisioned schemas. Acceptable to leave open per the phase's own stated reasoning (avoids Dev-7-class blind cross-schema backfill), but flagged as a real, non-trivial follow-up: existing tenants get a nav entry gated on billing.read (which they do have) but any billing.manage-gated action will 403 until a manual/ops backfill runs -- worth a tracked follow-up ticket, non-blocking on its own |
| Redirect URL / open-redirect | No user-controllable successUrl/cancelUrl; both server-derived from PUBLIC_APEX_DOMAIN + tenant's own subdomainSlug | PASS | Code review: TenantBillingService.initiateCheckout builds both URLs itself; CreateCheckoutSessionDto (dto/create-checkout-session.dto.ts) has only packageId; frontend service (tenant-billing.service.ts) never sends a redirect URL |
| Webhook code genuinely untouched | BillingWebhookService/StripePaymentGatewayAdapter unmodified this phase | PASS | Code review confirms no Dev-37 diff footprint in either file (matches claim); Dev-11's own billing.e2e-spec.ts (13 tests) re-run green, unaffected |
| redirectUrls additive-only | Platform Admin call site behavior byte-for-byte unchanged when param omitted | PASS | Code review of createCheckoutSession's redirectUrls?.successUrl ?? this.config.stripe.checkoutSuccessUrlTemplate... fallback; Dev-11 suite unaffected |
| Unit tests | Full API + web suites green | PASS | Re-ran apps/api: 185/185 suites, 1612/1612 tests green (matches claim). Web suite not independently re-run this pass (no material reason to doubt the reported 62/62/363 given API-side re-run parity and code review of the touched spec file: billing-settings.component.spec.ts) |
| e2e tests | New + pre-existing e2e green | PASS | Re-ran tenant-billing.e2e-spec.ts (8) + billing.e2e-spec.ts (13) against live MySQL: 21/21 green |
| Architecture compliance | New module follows LLD layering (TenantBrandingModule precedent) | PASS | Code review: TenantBillingModule is a leaf module, no reverse imports, matches stated precedent |
| Security spot-check | Guards present, input validated, no secrets committed, no injection surface | PASS (aside from the packageId functional defect, which is not itself an injection/auth issue) | Code review as above; no new dependency added; stripe package usage unchanged |

## Defects

### 1. [BLOCKING] Checkout completion never updates tenant_subscription.package_id -- self-serve upgrade does not upgrade anything
- Expected (FR-PKG-6 / BL-36): A Tenant Admin who completes a real Stripe checkout for a target
  package ends up subscribed to that package.
- Actual: BillingWebhookService.handleCheckoutCompleted -> TenantSubscriptionRepository
  .markActiveFromCheckout(tenantId, { providerCustomerId, providerSubscriptionId }) sets status
  and provider ids only; packageId is left at whatever it was before checkout. Confirmed both by
  code trace and by the feature's own e2e test, which explicitly asserts packageId is unchanged
  after a completed "upgrade" checkout (tenant-billing.e2e-spec.ts:252).
- Repro:
  1. Provision a tenant (defaults to starter/ACTIVE per CreateSubscriptionStep).
  2. As that tenant's Tenant Admin, POST /tenant/billing/checkout-session with { packageId:
     <pro package id> } -> 201, returns a Stripe Checkout URL.
  3. Send a signed checkout.session.completed webhook (metadata.tenantId = the tenant,
     customer/subscription matching the session) to POST /billing/webhook.
  4. GET /tenant/billing/plans (or query tenant_subscription directly) -> status: 'ACTIVE',
     currentPackageId still equals the starter package id, not pro.
- Severity: Blocking -- defeats the entire purpose of this phase (self-serve plan upgrades). Also
  produces a confusing/broken UI outcome (billing-settings.component.ts's post-checkout
  confirmation logic can never report success for a from-ACTIVE upgrade, since it also gates on
  currentPackageId changing).
- Note on scope: the defective code (BillingWebhookService/markActiveFromCheckout) is Dev-11
  code, not written this phase. However, this phase's own exit gate ("a Tenant Admin ... can initiate
  ... and [get their upgrade]") is not met, and the gap was only reachable/consequential once this
  phase exposed checkout to tenant-realm users without an equivalent to
  SubscriptionAdminService.reassign. Recommend the fix live in BillingWebhookService
  .handleCheckoutCompleted (thread the target packageId through, e.g. via Stripe metadata set at
  checkout-session creation and read back on webhook) so both the Platform Admin and tenant-realm
  paths are fixed by one change.

### 2. [Non-blocking, flagged] billing.manage not backfilled onto pre-Dev-37 tenants
- Expected: documented, deliberate gap (same class as tenant.settings.manage's precedent).
- Actual: confirmed genuinely absent for pre-existing tenant schemas -- billing.manage is seeded
  only via SeedRbacStep (provisioning-time), with no corresponding tenant-schema migration.
- Impact: existing tenants' Tenant Admins will see a Billing nav entry (gated on billing.read,
  which they do have) but any checkout attempt will 403 until an ops backfill (TenantMigrationRunner)
  is run.
- Severity: low-likelihood-but-real edge case, acceptable to ship open per the phase's own
  reasoning (avoids the Dev-7-class blind-backfill risk), but should be tracked as a follow-up so it
  isn't forgotten before this feature is announced to existing tenants.

## Untested / out of scope for this pass
- Did not independently re-run the apps/web unit suite (relied on code review of the new spec file
  plus the API-side re-run corroborating the reported numbers); no reason found to doubt it.
- Did not perform a live browser/Playwright pass of the /settings/billing screen -- the blocking
  backend defect (finding #1) makes a full UI walkthrough of the "successful upgrade" path moot until
  fixed; RBAC/nav-gating and the ?checkout=success|cancel handling were verified by code review only
  for this pass, not screenshotted.
- Did not test a live real-Stripe-network payment (correctly avoided -- FakeNetworkStripeGateway/
  fixture technique is the right, safe substitute, matching Dev-11's own precedent).

## Overall verdict
NOT READY. Blocking functional defect (finding #1): a Tenant Admin's self-serve "upgrade" never
actually changes their subscribed package, defeating BL-36/FR-PKG-6's core requirement. RBAC,
tenant-scoping, redirect-URL safety, webhook non-regression, and all reported test-suite results were
independently verified and hold up. Recommend dispatching back to nexus-dev to fix
BillingWebhookService.handleCheckoutCompleted/markActiveFromCheckout (and its Platform-Admin
counterpart, since both paths share the same gap) to actually apply the target packageId on
checkout completion, then re-submit for QA.
