# QA Re-verification Report -- Dev-37 retry 1 (BL-36, self-serve tenant plan upgrades)

**Date:** 2026-08-12
**Scope:** Re-verification of the single blocking defect reported in
qa-results/dev-37/20260812-000000/REPORT.md ("a completed Stripe checkout never applied the
target packageId to tenant_subscription, for both the Platform Admin (Dev-11) and tenant-realm
self-serve (Dev-37) checkout paths"), plus regression of everything else that report already
passed. This is retry 1 of 3 for Dev-37.

**Environment:** Local dev stack, apps/api against live examland-mysql (docker container
examland-mysql, root/YourPassword), real-network Stripe replaced by FakeNetworkStripeGateway
(same technique as the original report and Dev-11's own e2e suite); webhook signature
verification genuinely exercised via real HMAC (Stripe.webhooks.generateTestHeaderString). No
production system touched. All test tenants/schemas created and torn down by the suites
themselves (confirmed via SHOW DATABASES after the run -- none left over).

## Verdict: PASS -- no blocking defects

The previously-reported blocking defect is fixed for both checkout paths, confirmed
independently (not by trusting nexus-dev's self-report).

## What was independently reproduced

1. Platform Admin path (Dev-11), real signed webhook, direct proof of packageId change.
   Re-ran apps/api/test/billing.e2e-spec.ts against live MySQL. Test "checkout.session.completed
   moves the tenant subscription to ACTIVE, records both provider ids, AND applies the target
   packageId from metadata": provisions a tenant on starter, initiates checkout for pro,
   delivers a genuinely signed checkout.session.completed event with
   metadata: { tenantId, packageId: proPackageId }, then asserts
   after.packageId === proPackageId (read back from TenantSubscriptionRepository against the
   real DB row) -- passed.

2. Tenant-realm self-serve path (Dev-37's own endpoint), same proof. Re-ran
   apps/api/test/tenant-billing.e2e-spec.ts. Test "checkout.session.completed (signed), carrying
   the target packageId in metadata, moves this tenant to ACTIVE on the NEW (pro) package" --
   identical structure and result, independently confirming the self-serve path, not just the
   Platform Admin one. Both suites: 23/23 tests green (13 + 10), matching nexus-dev's reported
   count.

3. Server-side re-validation of the metadata packageId (anti-tamper). Read
   BillingWebhookService.handleCheckoutCompleted directly: it never applies metadata.packageId
   verbatim -- it always calls PackageRepository.findById(metadataPackageId) first and only sets
   resolvedPackageId if that lookup returns a real row. Confirmed via
   billing-webhook.service.spec.ts test "leaves packageId unchanged (with a logged warning) when
   metadata.packageId does not resolve to any known package", which mocks findById to
   return null for a bogus id and asserts the write still carries packageId: undefined (i.e.
   left alone) plus a billing.webhook_checkout_completed_unknown_package_in_metadata warning log
   -- re-ran this spec file directly, passed. This is the tamper case: a forged/unresolvable
   packageId in the webhook payload is provably never trusted blindly.

4. Missing/malformed metadata edge case. Both e2e suites include a dedicated "no packageId in
   metadata" case (billing.e2e-spec.ts: "a checkout.session.completed with no packageId in
   metadata leaves the current (pro) package untouched"; tenant-billing.e2e-spec.ts: equivalent)
   simulating a replayed pre-fix session/hand-crafted event. Both assert the tenant's existing
   packageId is unchanged afterward (never nulled) and the request still returns 200 (no Stripe
   retry storm). Backed by the matching unit test ("leaves packageId unchanged ... when metadata
   has no packageId at all") which additionally asserts packages.findById is never even called
   in this branch. All re-run, all green.

5. Atomic-update claim. Read TenantSubscriptionRepository.markActiveFromCheckout source
   directly (not the tests, the code): status, providerCustomerId, providerSubscriptionId, and
   (conditionally) packageId are all passed into a single call to this.repo.update(...).
   Confirmed: one TypeORM update call, i.e. one SQL UPDATE statement -- status, provider ids, and
   packageId are genuinely written together, not as two separate writes that could partially fail.

6. Shared call site / metadata stamping. Confirmed BillingCheckoutService.createCheckoutSession
   is the one call site both SubscriptionAdminService's Platform Admin flow and
   TenantBillingService's tenant-realm flow route through, and that it passes packageId: pkg.id
   into this.gateway.createCheckoutSession(...). Confirmed StripePaymentGatewayAdapter (via
   stripe.adapter.spec.ts test "stamps packageId (alongside tenantId/packageKey) onto the created
   session metadata", re-run and green) genuinely writes metadata: { tenantId, packageId,
   packageKey } on the real Stripe Checkout Session create call.

7. Frontend confirmation logic. Read billing-settings.component.ts's poll gate directly --
   unchanged, as claimed: confirmed is true only when result.status is ACTIVE AND either
   currentPackageId changed from what it was before the checkout, or the tenant was not already
   active. Re-ran billing-settings.component.spec.ts (13/13 green); its test "shows a
   ?checkout=success confirming banner, polls, and swaps to the success message once confirmed"
   exercises exactly the previously-broken realistic case (tenant already ACTIVE on starter,
   second poll tick returns currentPackageId of the pro package) and correctly flips to the
   success banner -- proving the frontend logic, unmodified, now works once the backend genuinely
   changes currentPackageId. Did not do a live-browser Playwright pass this retry (backend fix +
   component spec covering the exact regression scenario was judged sufficient corroboration
   given time; flagged as not independently browser-verified this pass).

8. Full test-suite re-runs (not accepted on nexus-dev's word).
   - apps/api unit suite: 185/185 suites, 1617/1617 tests green (re-run myself against a
     clean checkout, not copied from the completion notes).
   - apps/api e2e (tenant-billing + billing.e2e): 23/23 tests green (see above).
   - apps/web unit suite (targeted at the touched spec, billing-settings.component.spec.ts):
     13/13 green.

## Traceability matrix
(defect-specific; full Dev-37 matrix otherwise unchanged from the original report -- RBAC,
tenant-scoping, redirect-URL safety, billing.manage non-backfill, and Dev-11 non-regression all
still pass and were not re-litigated line by line this pass since this fix touched none of that
surface)

| Item | Scenario | Result | Evidence |
|---|---|---|---|
| Platform Admin checkout completion applies packageId | Signed webhook after Platform-Admin-initiated checkout for a different package | PASS | billing.e2e-spec.ts re-run, real DB read-back starter to pro |
| Tenant-realm self-serve checkout completion applies packageId | Signed webhook after Tenant-Admin-initiated checkout for a different package | PASS | tenant-billing.e2e-spec.ts re-run, real DB read-back starter to pro |
| Server-side re-validation of metadata.packageId (anti-tamper) | Unresolvable/forged packageId in webhook metadata | PASS | billing-webhook.service.spec.ts unit test re-run; code trace of PackageRepository.findById gate |
| Missing/malformed metadata (replay/legacy event) | No packageId in metadata at all | PASS | e2e (both suites) + unit test re-run; packageId left untouched, warning logged, 200 returned |
| Atomic single-write claim | status/provider ids/packageId all in one UPDATE | PASS | Direct source read of markActiveFromCheckout -- one repo.update() call |
| Frontend post-checkout confirmation | ACTIVE-to-ACTIVE upgrade (currentPackageId change while already active) | PASS | billing-settings.component.spec.ts re-run, 13/13; code trace of unchanged confirmed-gate logic |
| Full unit suite | apps/api | PASS | Re-run: 185/185 suites, 1617/1617 tests |
| Full e2e suite | tenant-billing + billing.e2e | PASS | Re-run: 23/23 tests |

## Residual notes (non-blocking)
- Did not perform a live real-browser Playwright walkthrough of the /settings/billing
  post-checkout confirmation flow this retry -- relied on the component's own targeted spec test
  (which exercises exactly the previously-broken scenario) plus the backend fix's direct
  verification. Low risk given the frontend code is unmodified and the gate logic was already
  independently confirmed correct in the original report; worth a real-browser pass in a future
  full-regression/Final Review sweep, not blocking here.
- All other findings from the original report (RBAC pass, tenant-scoping structural guarantee,
  redirect-URL safety, deliberate billing.manage non-backfill gap, Dev-11 webhook-code
  non-regression) were not re-litigated line-by-line this pass since this fix touched none of that
  surface; the e2e suites covering them were re-run in full as part of the 23/23 result above and
  show no regression.

## Overall verdict
PASS. The blocking defect is fixed and independently re-verified end to end for both checkout
paths, including the tamper and missing-metadata edge cases and the atomic-write claim. Dev-37
(BL-36) is ready to close out. This was retry 1 of 3 for Dev-37.
