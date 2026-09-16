/**
 * `e2e/backoffice/appearance.spec.ts` — golden path, a real WCAG contrast validation
 * failure, and the permission-scoped view for `/settings/appearance` and its
 * `/settings/appearance/reset` sibling (Phase E theming).
 *
 * Confirmed live against the real running app before being written into this file (not
 * assumed from the design doc): setting a semantic family's fill and foreground to the
 * identical hex value produces a real, server-computed WCAG contrast failure (ratio 1.00:1),
 * rendered as `skinEditor.contrastBlocked.introText` above the still-dirty form — exactly
 * FR-THEME-16's "reject color combinations that break WCAG 2.1 AA contrast" requirement,
 * exercised for real rather than through a mocked save action.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Appearance — Super Admin (Ahmed Saeed, sharjah, holds appearance:manage)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: every editing section is reachable and tenant editing is unrestricted", async ({
    page,
  }) => {
    covers("FR-THEME-01");
    await page.goto("/en/settings/appearance");
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    // Ahmed holds appearance:manage — the view-only notice must not render for him.
    await expect(page.getByText("You can set your own personal preferences below.")).toHaveCount(0);

    for (const section of ["Brand", "Semantic", "Typography", "Layout", "Mode & direction"]) {
      await expect(page.getByRole("tab", { name: section })).toBeVisible();
    }
  });

  test("validation error: an unreadable colour pair blocks the save, naming the failing pair", async ({
    page,
  }) => {
    covers("FR-THEME-16");
    await page.goto("/en/settings/appearance");
    await page.getByRole("tab", { name: "Semantic" }).click();

    await page.locator("#skin-editor-semantic-destructive").fill("#000000");
    await page.locator("#skin-editor-semantic-destructiveForeground").fill("#000000");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(
      page.getByText("Save is blocked — the following text is not readable enough:"),
    ).toBeVisible();
    await expect(page.getByText(/below the 4\.5:1 threshold/)).toBeVisible();
    // Blocked means nothing was persisted — the dirty badge must still read unsaved.
    await expect(page.getByText("Unsaved changes")).toBeVisible();
  });
});

test.describe("Appearance — Agent Designer (Sara Al Mazrouei, sewa, no appearance:manage)", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("golden path: Sara can save her own personal preference", async ({ page }) => {
    covers("FR-THEME-01", "FR-THEME-12", "FR-THEME-13");
    await page.goto("/en/settings/appearance");
    await page.getByRole("tab", { name: "Mode & direction" }).click();

    await page.getByLabel("Reduce motion").click();
    await expect(page.getByText("Unsaved changes")).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  });

  test("permission boundary: tenant-scope controls are disabled and reset is scoped to her own preference", async ({
    page,
  }) => {
    covers("FR-THEME-01", "FR-THEME-18");
    await page.goto("/en/settings/appearance");
    await expect(
      page.getByText(
        "You can set your own personal preferences below. Changing your organisation's branding requires the Manage appearance permission.",
      ),
    ).toBeVisible();

    await page.goto("/en/settings/appearance/reset");
    await expect(page.getByRole("button", { name: "Reset my preference" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset tenant branding" })).toHaveCount(0);
    await expect(page.getByText("You do not have the Manage appearance permission.")).toBeVisible();
  });

  test("golden path: resetting her own preference submits without error", async ({ page }) => {
    covers("FR-THEME-17");
    await page.goto("/en/settings/appearance/reset");
    await page.getByRole("button", { name: "Reset my preference" }).click();
    // The escape hatch's own doc comment: a plain, always-legible page, no client-side
    // routing — a successful submit re-renders this same route with its form intact.
    await expect(page).toHaveURL(/\/settings\/appearance\/reset$/);
    await expect(page.getByRole("button", { name: "Reset my preference" })).toBeVisible();
  });
});
