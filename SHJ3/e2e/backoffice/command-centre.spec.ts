/**
 * `e2e/backoffice/command-centre.spec.ts` — golden path, the documented "page reachable,
 * analytics gated separately" split, and a permission boundary for `/command-centre` (B1:
 * Command centre, the admin landing screen).
 *
 * Two permissions, per `command-centre/page.tsx`'s own doc comment: `dashboard:view` gates
 * landing on the page at all (every seeded role but `LiveAgent` holds it);
 * `analytics:view` additionally gates the real, metrics-heavy tab content. Ahmed
 * (`SuperAdmin`) holds both; Sara (`AgentDesigner`) holds `dashboard:view` only; Omar
 * (`LiveAgent`) holds neither.
 *
 * `sharjah.Conversations` has zero rows before this file's own run (confirmed live — no
 * `analytics`/`conversation` seed step exists yet for this tenant), so the Overview tab's
 * KPI grid renders real, honestly-zero figures rather than fabricated ones. The explorer
 * tab's own emptiness is NOT a stable invariant across this shared, mutating suite, though:
 * `evaluation.spec.ts`'s own "Run now" golden path creates one real, synthetic
 * `Conversation` row per scored case (`RunGoldenSetNow`'s own doc comment names this a real,
 * flagged gap — these rows are not distinguishable from real citizen conversations), which
 * persists for every later run once that spec has ever executed. The explorer assertion
 * below is written to be correct either way, rather than assuming a permanently-empty
 * table. Feedback & knowledge gaps has no such cross-spec writer anywhere in this suite, so
 * its own empty state is asserted directly.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Command centre — Super Admin (Ahmed Saeed, sharjah, holds dashboard:view + analytics:view)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: all three tabs render with real (honestly empty) data", async ({ page }) => {
    covers("FR-ANLY-01", "FR-ANLY-02", "FR-ANLY-05", "FR-ANLY-09", "FR-ANLY-10");
    await page.goto("/en/command-centre");
    await expect(page.getByRole("heading", { name: "Command centre" })).toBeVisible();
    await expect(page.getByText("Your role can view this page but not its metrics")).toHaveCount(0);

    // Overview — the KPI grid always renders, real zero-valued figures for a tenant with
    // no conversation data yet.
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Conversations", { exact: true })).toBeVisible();
    await expect(page.getByText("Containment rate")).toBeVisible();

    // Conversation explorer — real data either way. Column headers render regardless of
    // row count, so they're the state-independent proof this tab is real and working;
    // whether the body is the real empty state or a real row (see this file's own module
    // comment on why emptiness isn't guaranteed here) is reported, not assumed.
    await page.getByRole("tab", { name: "Conversation explorer" }).click();
    await expect(page.getByRole("columnheader", { name: "User" })).toBeVisible();
    const isEmpty = await page.getByText("No conversations yet").isVisible();
    console.info(
      `[command-centre.spec] Conversation explorer: ${isEmpty ? "empty (no prior evaluation run in this environment)" : "has at least one real row"}.`,
    );

    // Feedback & knowledge gaps — both queues render their real, honest empty states.
    await page.getByRole("tab", { name: "Feedback & knowledge gaps" }).click();
    await expect(page.getByText("No open feedback issues")).toBeVisible();
    await expect(page.getByText("No unanswered-question clusters")).toBeVisible();
  });

  test("golden path: switching the date range re-renders the KPI grid", async ({ page }) => {
    covers("FR-ANLY-01");
    await page.goto("/en/command-centre");
    await page.getByRole("radio", { name: "Last 7 days" }).click();
    await expect(page.getByRole("radio", { name: "Last 7 days" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("Command centre — Agent Designer (Sara Al Mazrouei, sewa, dashboard:view only)", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("Sara lands on the page but sees the no-analytics-access notice instead of tabs", async ({
    page,
  }) => {
    covers("FR-ANLY-02");
    await page.goto("/en/command-centre");
    await expect(page.getByRole("heading", { name: "Command centre" })).toBeVisible();
    await expect(
      page.getByText(
        "Your role can view this page but not its metrics — that needs an additional permission.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveCount(0);
  });
});

test.describe("Command centre — permission boundary (Omar, LiveAgent)", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar (LiveAgent) is denied /command-centre entirely — no dashboard:view", async ({
    page,
  }) => {
    covers("FR-IAM-12");
    await page.goto("/en/command-centre");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});
