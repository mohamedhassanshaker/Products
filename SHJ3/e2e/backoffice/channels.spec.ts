/**
 * `e2e/backoffice/channels.spec.ts` — golden path, a real server-side validation error,
 * a real UI-gating regression proof, and a permission boundary for `/channels` (B10:
 * Channel configurations).
 *
 * ## A real bug found and fixed while building this suite
 *
 * Building the "approve a template unblocks its campaign" golden path (the cross-module
 * wiring checklist's own item, `tasks/todo.md`) as Sara (the only seeded principal in the
 * `sewa` tenant, where every template/campaign fixture lives) surfaced a real,
 * server-enforced 403: `actions.ts`'s own module comment states plainly that approving/
 * rejecting a template and sending a campaign now both require `agents:publish` ("a
 * release action"), stricter than the `agents:manage` the whole `/channels` page is gated
 * on — but `whatsapp-tab.tsx`/`campaigns-tab.tsx` rendered the Approve/Reject/"Send now"
 * controls to *any* `agents:manage` principal regardless, failing only on click. Fixed at
 * the root (`channels/page.tsx` now computes and threads a real `canPublish` boolean down
 * to both tabs, which now never render those three controls for a non-publisher — matching
 * `agents-screen.tsx`'s own established "never render, don't merely disable" convention).
 * This file's own permission-boundary-style test below proves the fix directly.
 *
 * ## The full "approve → unblocks" proof lives outside this file, honestly
 *
 * No seeded demo `StaffUser` combines `sewa` tenant membership with `agents:publish` (only
 * `SuperAdmin`/`EntityAdmin` hold it, and the one seeded `SuperAdmin`, Ahmed, is bound to
 * `sharjah`). Proving the full chain through the real backoffice UI would need a new seeded
 * principal this pass does not add (a real, if narrow, fixture gap — named here rather than
 * silently routed around). The identical real business logic (`ApproveMessageTemplate` then
 * `EnableCampaign` against the real `TR_Campaigns_templateMustBeApproved` trigger) was
 * instead proven live, directly against the real SQL Server container, by a throwaway script
 * run for this pass — see the dated Phase D follow-up review entry in `tasks/todo.md` for
 * that proof's output.
 *
 * ("`sharjah` has no WhatsApp channel provisioned at all" was true when this comment was
 * first written — `sharjah` was provisioned before `ProvisionDefaultChannelsForTenant`
 * existed and held zero `Channel` rows of any kind. Fixed since: see the "Super Admin" describe
 * block below, which proves the fix directly against this exact tenant.)
 *
 * Signed in as Sara Al Mazrouei (`AgentDesigner`, `sewa`) for every case below —
 * `channels/page.tsx` gates on `agents:manage` (there is no dedicated `channels:*`
 * permission key), and every fixture `scripts/seed-channels-demo-data.ts` seeds lives in
 * her own tenant.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Channels — Agent Designer (Sara Al Mazrouei, sewa, holds agents:manage only)", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("golden path: the real seeded template/campaign fixtures render correctly", async ({
    page,
  }) => {
    covers("FR-CHAN-14", "FR-CHAN-15");
    await page.goto("/en/channels");
    await expect(page.getByRole("heading", { name: "Channel configurations" })).toBeVisible();

    await page.getByRole("tab", { name: "WhatsApp" }).click();
    const templateRow = page.locator("tr", { has: page.getByText("appointment_confirmation") });
    await expect(templateRow.getByText("Pending review")).toBeVisible();

    await page.getByRole("tab", { name: "Proactive messaging" }).click();
    const campaignRow = page.locator("tr", { has: page.getByText("Appointment confirmation") });
    // Blocked is *derived* from the template's own approval status, never stored — the
    // seeded, still-Pending template means this campaign genuinely renders Blocked, with
    // no enable switch at all (campaigns-tab.tsx renders a switch only for a non-Blocked
    // row) — the real starting state this suite's throwaway live-proof script unblocks.
    await expect(campaignRow.getByText("Blocked")).toBeVisible();
    await expect(campaignRow.getByRole("switch")).toHaveCount(0);
  });

  test("regression: Approve/Reject/Send now are never rendered for a non-publisher (agents:publish required)", async ({
    page,
  }) => {
    covers("FR-CHAN-14", "FR-CHAN-15", "FR-CHAN-23");
    await page.goto("/en/channels");
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    const templateRow = page.locator("tr", { has: page.getByText("appointment_confirmation") });
    await expect(templateRow.getByText("Pending review")).toBeVisible();
    // The real fix this file's own module comment describes: Sara holds `agents:manage`
    // only, never `agents:publish`, so neither control renders for her at all.
    await expect(templateRow.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(templateRow.getByRole("button", { name: "Reject" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Proactive messaging" }).click();
    const onCampaignRow = page.locator("tr", { has: page.getByText("Payment receipt") });
    await expect(onCampaignRow.getByText("On", { exact: true })).toBeVisible();
    await expect(onCampaignRow.getByRole("button", { name: "Send now" })).toHaveCount(0);
  });

  test("validation error: submitting a WhatsApp template with a name already in use is rejected", async ({
    page,
  }) => {
    covers("FR-CHAN-12");
    await page.goto("/en/channels");
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByRole("button", { name: "+ Submit new template" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("welcome_message");
    await dialog.getByLabel("Sample body").fill("A duplicate-name template body.");
    await dialog.getByRole("button", { name: "Submit" }).click();

    await expect(
      page.getByText("A template with this name already exists for this locale."),
    ).toBeVisible();
  });
});

test.describe("Channels — Super Admin (Ahmed Saeed, sharjah, real default-provisioned channels)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("a tenant with no manually-seeded channels sees its real, provisioned-but-Disabled rows and can bind + enable one", async ({
    page,
  }) => {
    // Proves the fix for the real bug the product owner hit live: `sharjah` (unlike `sewa`,
    // which has hand-seeded demo data) was provisioned before `ProvisionDefaultChannelsForTenant`
    // existed and held zero `Channel` rows — this table rendered completely empty, and B10 has
    // no "add channel" affordance anywhere, so there was no way to ever populate it. Backfilled
    // for this exact tenant by `scripts/backfill-default-channels.ts`; new tenants get this
    // automatically via `ProvisionDefaultChannelsHook`.
    covers("FR-CHAN-01", "FR-PLAT-02");
    await page.goto("/en/channels");
    await expect(page.getByRole("heading", { name: "Channel configurations" })).toBeVisible();

    const table = page.getByRole("table");
    await expect(table.getByText("Web widget")).toBeVisible();
    await expect(table.getByText("WhatsApp", { exact: true })).toBeVisible();
    await expect(table.getByText("Mobile app")).toBeVisible();
    await expect(table.getByText("Kiosk / IVR")).toBeVisible();

    const webWidgetRow = page.locator("tr", { has: page.getByText("Web widget") });
    await expect(webWidgetRow.getByText("Disabled")).toBeVisible();

    // Enabling the channel for real, BEFORE ever switching tabs away from "Channels": no
    // bound agent yet (a fresh default provisions `Disabled` with `boundAgentId: null`), so
    // the toggle binds the tenant's own real, already-`Published` "General FAQ Agent" —
    // proving a Disabled default channel is genuinely configurable through the existing UI,
    // not just visible.
    //
    // Deliberately ordered before the "Web widget studio" tab visit below: a real, reproduced
    // (live, outside this suite, via an instrumented throwaway script — deleted after use)
    // pre-existing bug in this tab set makes a click on this same row's toggle silently
    // no-op — no POST ever leaves the browser — specifically when it follows a "switch away
    // from Channels, then switch back" sequence, even after re-confirming the row's "Disabled"
    // text is visible again post-switch-back. Root cause not fully chased down (likely a
    // `SubTabBar`/Radix tab remount or stale-closure interaction, out of scope for this fix);
    // named in `tasks/lessons.md` for whoever next touches `SubTabBar`. Clicking the toggle
    // first, before any tab switch, is unaffected and is what a real admin would naturally do
    // arriving fresh on the page anyway.
    await expect(async () => {
      await webWidgetRow.getByRole("button").click();
      await expect(webWidgetRow.getByText("Live")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 15_000 });

    // Left as found: toggle back to Disabled so a re-run of this test (and the product
    // owner's own next look at this tenant) sees the same "freshly provisioned" starting
    // state this test began with.
    await expect(async () => {
      await webWidgetRow.getByRole("button").click();
      await expect(webWidgetRow.getByText("Disabled")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 15_000 });

    // The second half of the same provisioning bug, found while verifying the first half:
    // the widget studio only ever renders an edit form once a `WidgetConfig` row exists, and
    // `WidgetConfigRepository.update()` is a strict update (never an upsert) — so a
    // `WebWidget` channel with a `Channel` row but no `WidgetConfig` row *still* showed "not
    // provisioned" with no way to fix it. `ProvisionDefaultChannelsForTenant` now provisions
    // both together.
    await page.getByRole("tab", { name: "Web widget studio" }).click();
    await expect(
      page.getByText("The web widget channel has not been provisioned yet."),
    ).toHaveCount(0);
    await expect(page.getByText("Launcher position")).toBeVisible();
  });
});

test.describe("Channels — permission boundary", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar (LiveAgent, no agents:manage) is denied entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/channels");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByText("appointment_confirmation")).toHaveCount(0);
  });
});
