/**
 * `e2e/roles/live-agent.spec.ts` — the permission walkthrough for Omar Khan (`LiveAgent`
 * role, `customs` tenant, seeded by `scripts/seed-iam-demo-data.ts`). Per `docs/testing.md`
 * §1.1's `e2e/roles/<role>.spec.ts` convention: one file per role, walking every screen that
 * role's real, seeded permission set does and does not grant.
 *
 * `LiveAgent` holds only `escalations:handle` (`permissions.ts`'s `SEEDED_ROLE_PERMISSIONS`)
 * — none of `agents:manage`, `users:manage` or `appearance:manage` — so Omar is the cleanest
 * real "denied everywhere on these four screens" fixture the seed provides.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.use({ storageState: "e2e/.auth/live-agent.json" });

test("Omar (LiveAgent) is denied the IAM screen entirely", async ({ page }) => {
  covers("FR-IAM-12");
  await page.goto("/en/iam");
  await expect(
    page.getByRole("heading", { name: "You don't have access to this screen" }),
  ).toBeVisible();
  await expect(
    page.getByText("Managing users, teams and roles requires the Super Admin role."),
  ).toBeVisible();
});

test("Omar (LiveAgent) is denied the Agents registry entirely", async ({ page }) => {
  covers("FR-IAM-12");
  await page.goto("/en/agents");
  await expect(
    page.getByRole("heading", { name: "You don't have access to this screen" }),
  ).toBeVisible();
  await expect(
    page.getByText("Managing agents requires the Agent Designer role or above."),
  ).toBeVisible();
});

test("Omar (LiveAgent) is denied the Tools registry entirely", async ({ page }) => {
  covers("FR-IAM-12");
  await page.goto("/en/tools");
  await expect(
    page.getByRole("heading", { name: "You don't have access to this screen" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Managing the tool registry requires the ability to manage agents — the same permission the agent builder uses.",
    ),
  ).toBeVisible();
});

test("Omar (LiveAgent) reaches Settings -> Appearance, but only in view-only scope", async ({
  page,
}) => {
  covers("FR-THEME-01", "FR-THEME-18");
  await page.goto("/en/settings/appearance");
  // Unlike IAM/Agents/Tools, Appearance never fully blocks an authenticated principal
  // (design-system.md §9.3) — every signed-in staff member may set their own preference.
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(
    page.getByText(
      "You can set your own personal preferences below. Changing your organisation's branding requires the Manage appearance permission.",
    ),
  ).toBeVisible();
});
