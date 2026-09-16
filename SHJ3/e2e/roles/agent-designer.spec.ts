/**
 * `e2e/roles/agent-designer.spec.ts` — the permission walkthrough for Sara Al Mazrouei
 * (`AgentDesigner` role, `sewa` tenant). `AgentDesigner` holds `dashboard:view` +
 * `agents:manage` only (`permissions.ts`) — never `agents:publish` or `users:manage` — which
 * makes her the real fixture for FR-IAM-11's separation-of-duties rule: she can author an
 * agent end to end but the server refuses to let her release it, and the registry's own
 * "Publish"/"Unpublish" row actions are never even rendered for her (not merely disabled).
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.use({ storageState: "e2e/.auth/agent-designer.json" });

test("Sara (AgentDesigner) is denied the IAM screen entirely", async ({ page }) => {
  covers("FR-IAM-12");
  await page.goto("/en/iam");
  await expect(
    page.getByRole("heading", { name: "You don't have access to this screen" }),
  ).toBeVisible();
});

test("Sara (AgentDesigner) can manage agents but the registry never offers Publish/Unpublish", async ({
  page,
}) => {
  covers("FR-IAM-11", "FR-AGENT-19");
  await page.goto("/en/agents");
  await expect(page.getByRole("heading", { name: "Agent registry" })).toBeVisible();

  const row = page.locator("tr", {
    has: page.getByRole("link", { name: "SEWA & Utilities Billing Agent" }),
  });
  await row.getByRole("button", { name: "Actions" }).click();

  // Separation of duties is enforced by never rendering the control, not merely disabling
  // it — `canPublish` is resolved server-side (`agents/page.tsx`) and passed down.
  await expect(page.getByRole("menuitem", { name: "Publish", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Unpublish" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Clone" })).toBeVisible();
});

test("Sara (AgentDesigner) can manage the tool registry", async ({ page }) => {
  covers("FR-TOOL-01");
  await page.goto("/en/tools");
  await expect(page.getByRole("heading", { name: "Tools & MCP registry" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Skills catalogue" })).toBeVisible();
});

test("Sara (AgentDesigner) reaches Settings -> Appearance in view-only scope", async ({ page }) => {
  covers("FR-THEME-01", "FR-THEME-18");
  await page.goto("/en/settings/appearance");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(
    page.getByText(
      "You can set your own personal preferences below. Changing your organisation's branding requires the Manage appearance permission.",
    ),
  ).toBeVisible();
});
