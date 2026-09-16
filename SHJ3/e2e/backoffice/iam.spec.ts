/**
 * `e2e/backoffice/iam.spec.ts` — golden path, a real validation error, and tenant isolation
 * for `/iam` (B9: users, teams, roles). Signed in as Ahmed Saeed (`SuperAdmin`, `sharjah`
 * tenant) for the mutating cases — `users:manage` is restricted to `SuperAdmin` alone
 * (`permissions.ts`'s `RESTRICTED_PERMISSIONS`), so he is the only one of the five seeded
 * demo users who can reach these actions at all. The permission-boundary case (an
 * under-permissioned role denied) lives in `e2e/roles/*.spec.ts`; this file adds one direct
 * check too so the golden-path and the boundary are provably the same screen.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("IAM — Super Admin (Ahmed Saeed, sharjah)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: inviting a user adds an Invited row", async ({ page }) => {
    covers("FR-IAM-01", "FR-IAM-02");
    const email = `e2e-golden-${Date.now()}@shj.ae`;

    await page.goto("/en/iam");
    await expect(page.getByRole("heading", { name: "Users, teams & roles" })).toBeVisible();

    await page.getByRole("button", { name: "Invite user" }).click();
    await page.getByLabel("Display name").fill("E2E Golden Path User");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();

    const row = page.locator("tr", { has: page.getByText(email) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Invited")).toBeVisible();
  });

  test("golden path: reassigning a user's team updates their membership immediately", async ({
    page,
  }) => {
    // This is also this project's first committed, automated proof of the cross-module
    // wiring checklist's "reassign a user's team → team membership updates" scenario
    // (`tasks/todo.md`'s "Cross-module wiring" section) — a dedicated research pass over
    // every prior wave's "## Review" entry found the mechanism described (B-2's own
    // `TeamRepository.setMemberships` "hard-replace" contract) but no review entry proving
    // a live reassign-then-reread sequence. This test is that live proof, made permanent.
    covers("FR-IAM-06", "FR-IAM-07");
    const email = `e2e-team-reassign-${Date.now()}@shj.ae`;

    await page.goto("/en/iam");
    await page.getByRole("button", { name: "Invite user" }).click();
    await page.getByLabel("Display name").fill("E2E Team Reassign User");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(email)).toBeVisible();

    const row = page.locator("tr", { has: page.getByText(email) });
    // `UsersTab`'s columns render in this order: name (`<th>`), email, team, role,
    // status, actions (`users-tab.tsx`). Both the team and role cells fall back to the
    // identical "—" placeholder (`noPrimaryTeam`/`noRoles` in `messages/en.json`) for a
    // freshly-invited user with neither assigned — `row.getByText("—")` alone matches
    // both cells and is ambiguous. Scope to the team cell specifically: it is the
    // second `<td>` (the identifying `name` column is a `<th>`, not a `<td>`, so
    // `getByRole("cell")` — which only matches `<td>`s, not the `<th scope="row">` — at
    // index 1 is unambiguously the team column.
    const teamCell = row.getByRole("cell").nth(1);
    // No team assigned yet — `sharjah`'s own seeded "no primary team" placeholder.
    await expect(teamCell.getByText("—", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    // `EditUserDialog` mounts with every `SelectablePill` disabled (`disabled={loading}`)
    // until its own `loadEditContext` Server Action call resolves (`users-tab.tsx`) — a
    // real, genuinely-disabled `<input>`, not merely visually occluded. `check({force:
    // true})` only bypasses Playwright's own actionability *checks* (visibility, the
    // sr-only occlusion `agents.spec.ts`'s identical comment documents); it does not make
    // a real browser dispatch a state-changing click against a disabled input, so a click
    // that lands during this load window silently no-ops. Wait for the real, live-loaded
    // enabled state first.
    const platformCheckbox = page.getByRole("checkbox", { name: "Platform" });
    await expect(platformCheckbox).toBeEnabled();
    await platformCheckbox.check({ force: true });
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(teamCell.getByText("Platform", { exact: true })).toBeVisible();

    // Reassign again — remove the team entirely — and confirm the change is reflected
    // just as immediately, proving this is a real, live read-back each time, not a
    // one-way "join only" action.
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(platformCheckbox).toBeEnabled();
    await platformCheckbox.uncheck({ force: true });
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(teamCell.getByText("—", { exact: true })).toBeVisible();
  });

  test("validation error: editing a user's email to one already in use is rejected", async ({
    page,
  }) => {
    covers("FR-IAM-05");
    const email = `e2e-conflict-${Date.now()}@shj.ae`;

    await page.goto("/en/iam");
    await page.getByRole("button", { name: "Invite user" }).click();
    await page.getByLabel("Display name").fill("E2E Conflict User");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(email)).toBeVisible();

    const row = page.locator("tr", { has: page.getByText(email) });
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Email").fill("ahmed.saeed@shj.ae");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText('Email "ahmed.saeed@shj.ae" is already in use by another staff account.'),
    ).toBeVisible();
  });

  test("tenant isolation: the sharjah user list never shows another tenant's staff", async ({
    page,
  }) => {
    covers("NFR-SEC-15", "NFR-SEC-21");
    await page.goto("/en/iam");
    await expect(page.getByRole("heading", { name: "Users, teams & roles" })).toBeVisible();

    // sharjah's own SuperAdmin — proves the query ran and returned real rows.
    await expect(page.getByText("Ahmed Saeed")).toBeVisible();
    // sewa/customs/libraries staff must never bleed into sharjah's own listing.
    for (const name of ["Sara Al Mazrouei", "Omar Khan", "Priya Nair", "Lina Haddad"]) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });
});

test.describe("IAM — permission boundary", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar (LiveAgent) is denied /iam entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/iam");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});
