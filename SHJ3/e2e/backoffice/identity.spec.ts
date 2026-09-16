/**
 * `e2e/backoffice/identity.spec.ts` — golden path, a real validation error, and a
 * permission boundary for `/identity` (B11: Identity & transactions). Gated on
 * `users:manage`, the narrowest permission in the matrix (`identity/page.tsx`'s own doc
 * comment, api.md §6.10/§6.11's `[ASSUMPTION]`) — Ahmed Saeed (`SuperAdmin`) is the only
 * one of the three seeded sessions who can reach this screen at all.
 *
 * `scripts/seed-identity-payments-demo-data.ts` seeds its four step-up rules, three
 * verification providers, two payment gateways etc. into the `sewa` tenant only (confirmed
 * live: `SELECT * FROM sewa.StepUpRules` returns four rows, `SELECT * FROM sharjah.
 * StepUpRules` returns zero) — Ahmed's own session is bound to `sharjah`, so this screen's
 * step-up rules render from `identity/page.tsx`'s own documented fallback ("a fresh tenant
 * that has never visited this screen has no seeded rows" — rendered as the closed action
 * vocabulary, `Anonymous`/disabled, per action) rather than the seeded values. This is a
 * real, honestly-named gap in the seed data (it targets the wrong tenant for this suite's
 * own `sharjah` principal), not a reason to skip real coverage: `SetStepUpRule`'s upsert
 * (`PrismaStepUpRuleRepository.setRequiredAssurance`) creates the row on first write
 * regardless, so the golden path below is exercised against real, freshly-written state.
 * `sharjah.VerificationConfigs` DOES have a row already (`accountOwnershipCheckEnabled=1`,
 * confirmed live) from an earlier wave's own proof, so the account-ownership section below
 * asserts real, persisted data. No `RefundRequests` are seeded for any tenant — the
 * "Pending refund requests" section is asserted in its real, honest empty state rather than
 * against a fabricated pending refund.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Identity — Super Admin (Ahmed Saeed, sharjah, holds users:manage)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: changing a step-up rule's required assurance persists", async ({ page }) => {
    covers("FR-VERI-06");
    await page.goto("/en/identity");
    await expect(page.getByRole("heading", { name: "Identity & transactions" })).toBeVisible();

    const linkAccountRow = page.locator("tr", { has: page.getByText("LinkUtilityAccount") });
    await expect(linkAccountRow).toBeVisible();
    await linkAccountRow.locator("select").selectOption("Verified");

    // No refusal banner for a change that respects the payment floor (this action isn't
    // `InitiatePayment`, so `belowPaymentFloor` never applies to it).
    await expect(page.getByText("The action was refused.")).toHaveCount(0);

    // Reload for a fresh server render — the select is uncontrolled (`defaultValue`), so
    // only a real page load proves the change is actually persisted, not just clicked.
    await page.reload();
    const reloadedRow = page.locator("tr", { has: page.getByText("LinkUtilityAccount") });
    await expect(reloadedRow.locator("select")).toHaveValue("Verified");

    // The account-ownership section is real, seeded state (not this test's own write).
    await expect(
      page.getByText("Enabled — a payment must resolve to the verified identity."),
    ).toBeVisible();
    // No refund requests are seeded anywhere — the real, honest empty state.
    await expect(page.getByText("No pending refund requests.")).toBeVisible();
  });

  test("validation error: InitiatePayment cannot be configured below the L2 payment floor", async ({
    page,
  }) => {
    covers("FR-PAY-06");
    await page.goto("/en/identity");

    const paymentRow = page.locator("tr", { has: page.getByText("InitiatePayment") });
    await expect(paymentRow).toBeVisible();
    // `sharjah.StepUpRules` has no seeded `InitiatePayment` row (the seed script only
    // targets `sewa` — see this file's own module comment), so `identity/page.tsx`'s own
    // fallback renders it at `Anonymous` before this test touches it. Attempting
    // `Verified` (rank 1) is still below the L2 floor (`VerifiedPlusOtp`, rank 2) and
    // lets the reload check below distinguish "rejected, nothing changed" from "silently
    // accepted" — selecting `Anonymous` again would look identical either way.
    await paymentRow.locator("select").selectOption("Verified");

    // `SetStepUpRule`'s own pre-check (`belowPaymentFloor`) refuses before ever reaching
    // the database — the action returns this exact reason string, rendered verbatim.
    await expect(page.getByText("identity.payment_floor_violation")).toBeVisible();

    // Reload to prove the rejected change never took effect: still the real fallback
    // (`Anonymous`), never the rejected `Verified` attempt.
    await page.reload();
    const reloadedRow = page.locator("tr", { has: page.getByText("InitiatePayment") });
    await expect(reloadedRow.locator("select")).toHaveValue("Anonymous");
  });
});

test.describe("Identity — permission boundary (Sara, AgentDesigner)", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("Sara (AgentDesigner) is denied /identity entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/identity");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});

test.describe("Identity — permission boundary (Omar, LiveAgent)", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar (LiveAgent) is denied /identity entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/identity");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});
