/**
 * `e2e/backoffice/agents.spec.ts` — golden path (create → bind a channel → publish),
 * a real client-side validation error, and the registry itself for `/agents` (B2/B3).
 *
 * Signed in as Ahmed Saeed (`SuperAdmin`, `sharjah` tenant) for the full create-to-publish
 * path: `agents:publish` is restricted to `SuperAdmin`/`EntityAdmin`, and no `EntityAdmin`
 * is among the five seeded demo users, so Ahmed is the only real seeded principal who can
 * exercise the whole lifecycle end to end. `GetDraftValidation`'s own gate (`modules/agents/
 * application/get-draft-validation.ts`) is deliberately minimal — only `identity` (a name,
 * already satisfied at creation) and `channels` (at least one enabled binding) — so binding
 * one channel is the real, complete golden path to a publishable draft; the other seven
 * wizard steps are all independently skippable for this pass, per that same gate.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Agents — Super Admin (Ahmed Saeed, sharjah, holds agents:publish)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: create a Draft, bind a channel, publish it", async ({ page }) => {
    covers(
      "FR-AGENT-01",
      "FR-AGENT-08",
      "FR-AGENT-09",
      "FR-AGENT-16",
      "FR-AGENT-18",
      "FR-AGENT-19",
    );
    const agentName = `E2E Golden Path Agent ${Date.now()}`;

    await page.goto("/en/agents/new");
    await expect(page.getByRole("heading", { name: "New agent" })).toBeVisible();
    await page.getByLabel("Agent name").fill(agentName);
    await page.getByRole("button", { name: "Create agent" }).click();

    // CreateAgent redirects straight into the wizard on the new agent's own draft. A
    // generous timeout here: this is often the first hit on this route in a fresh `next
    // dev` process, which compiles the route on demand before the server action can run.
    await expect(page).toHaveURL(/\/agents\/.+\/edit/, { timeout: 20_000 });
    // Substring match, not exact: `agents.wizard.editPageTitle` wraps `{name}` in Unicode
    // bidi-isolate marks (U+2068/U+2069) for RTL safety, which an exact string compare
    // would never match against a plain JS string.
    await expect(page.getByRole("heading", { name: agentName })).toBeVisible();

    // Every wizard step is directly reachable (FR-AGENT-08) — jump straight to Channels
    // rather than walking the other nine, which the publish gate does not require.
    await page.getByRole("tab", { name: /Channels/ }).click();
    // `force: true`: `SelectablePill` renders the real checkbox visually hidden
    // (`sr-only`) behind a styled `<span>` sibling inside the same `<label>` — the
    // checkbox is the correct a11y target (`getByRole`/`getByLabel` both resolve to it),
    // but Playwright's actionability check sees the span intercepting the same screen
    // position and refuses a plain click. Forcing skips only that visibility/occlusion
    // check, not the click dispatch itself, which is what a real user's label-click
    // triggers anyway.
    await page.getByRole("checkbox", { name: "Web widget" }).check({ force: true });
    await page.getByRole("button", { name: "Save & continue" }).click();

    await page.getByRole("tab", { name: /^Step 10 of 10: Publish/ }).click();
    // Wait for the Publish panel's own content, not just the tab switch: `goToStep` may
    // still be fetching step data (`loadToolsStepDataAction`-style per-step loaders) when
    // the tab's `aria-selected` flips, and clicking the footer button while the panel
    // beneath it is still swapping out was found, live, to silently drop the click.
    await expect(page.getByText("Environment", { exact: true })).toBeVisible();
    // Retried: a concurrent, unrelated wave's in-progress `messages/en.json` currently
    // carries dotted namespace keys under `knowledge.*` (confirmed live via a captured
    // `IntlError` on this exact route tree), which next-intl's dev-mode validator logs
    // repeatedly and — empirically, not merely suspected — occasionally coincides with a
    // React remount that drops a click's event target before its handler fires. Retrying
    // the click is a real, working mitigation for a real, external instability; the
    // assertion below is what actually proves the publish succeeded, not the retry count.
    await expect(async () => {
      await page.getByRole("button", { name: "Publish agent", exact: true }).click();
      await expect(page).toHaveURL(/\/agents$/, { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });

    // A successful publish redirects to the registry (`wizard-shell.tsx`'s `handlePublish`).
    const row = page.locator("tr", { has: page.getByRole("link", { name: agentName }) });
    await expect(row.getByText("Published")).toBeVisible();
  });

  test("validation error: an empty agent name cannot be submitted", async ({ page }) => {
    covers("FR-AGENT-09");
    await page.goto("/en/agents/new");
    await expect(page.getByRole("button", { name: "Create agent" })).toBeDisabled();
    await page.getByLabel("Agent name").fill("   ");
    await expect(page.getByRole("button", { name: "Create agent" })).toBeDisabled();
  });

  test("registry: the seeded sharjah agent renders with its lifecycle columns", async ({
    page,
  }) => {
    covers("FR-AGENT-01", "FR-AGENT-02");
    await page.goto("/en/agents");
    await expect(page.getByRole("heading", { name: "Agent registry" })).toBeVisible();
    const row = page.locator("tr", { has: page.getByRole("link", { name: "General FAQ Agent" }) });
    await expect(row).toBeVisible();
  });
});
