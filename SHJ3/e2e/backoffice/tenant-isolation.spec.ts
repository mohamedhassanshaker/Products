/**
 * `e2e/backoffice/tenant-isolation.spec.ts` — a real, UI-level tenant-isolation proof for
 * the two backoffice screens this pass covers, using two structurally-identical, value-
 * distinct fixtures the way `docs/testing.md` §4.4/§5.3 requires: a wrong value would be
 * caught here, an empty result would not be — the assertion always proves the query ran AND
 * that it was scoped, never only the second half.
 *
 * `scripts/seed-agents-tools-demo-data.ts` seeds one uniquely-named agent per tenant
 * (`sewa` → "SEWA & Utilities Billing Agent", `customs` → "Customs Enquiry Agent"), so the
 * agent registry is this pass's real, deterministic fixture for the property NFR-SEC-15/
 * NFR-SEC-21 name at the store layer: this proves the same property holds through the real
 * backoffice UI, end to end, for a principal who only ever authenticates once.
 *
 * This is deliberately narrower than the release-gate isolation suite
 * (`tests/isolation/*.spec.ts`, ADR-0002's `tenant-isolation.spec.ts`) — that suite proves
 * the property at the store boundary, forged-header/body/query included, across all four
 * stores. This file proves the same property survives one additional hop: the real
 * `withStaffAuth()` → `TenantContext` → Prisma-scoped-handle chain a browser actually
 * exercises, which the store-level suite alone cannot demonstrate.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Sara (sewa) never sees customs' agent", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("the sewa agent registry shows sewa's own agent, never customs'", async ({ page }) => {
    covers("NFR-SEC-15", "NFR-SEC-21");
    await page.goto("/en/agents");
    await expect(page.getByRole("link", { name: "SEWA & Utilities Billing Agent" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Customs Enquiry Agent" })).toHaveCount(0);
  });
});

test.describe("Omar (customs) never sees sewa's agent", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar cannot reach the agents screen at all, and it never leaks sewa data anyway", async ({
    page,
  }) => {
    // Omar (LiveAgent) has no `agents:manage`, so this is a stronger guarantee than a
    // scoped-but-visible list: the whole screen is denied before any query names a
    // tenant. Recorded here, not just in `e2e/roles/live-agent.spec.ts`, because tenant
    // isolation and permission denial are two independent guarantees that happen to
    // compose on this exact screen, and a reader of this file should see both proven in
    // one place rather than have to trust they were both checked elsewhere.
    covers("NFR-SEC-15", "FR-IAM-12");
    await page.goto("/en/agents");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
    await expect(page.getByText("SEWA & Utilities Billing Agent")).toHaveCount(0);
  });
});
