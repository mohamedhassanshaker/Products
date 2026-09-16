/**
 * `e2e/backoffice/escalations.spec.ts` — golden path, a real client-side validation error,
 * and a permission boundary for `/escalations` (B8: Human agent workspace).
 *
 * The golden path is also this project's first **committed, automated** proof of the
 * cross-module wiring checklist's "reorder a routing rule → tester returns a different
 * route" scenario (`tasks/todo.md`'s "Cross-module wiring" section) — B-7's own review
 * entry already proved this once, live, via a throwaway script, against the seeded `sewa`
 * rule set. This test proves the identical mechanism permanently and regression-checked in
 * CI, but builds its own two rules live rather than depending on that seeded fixture:
 * `scripts/seed-escalation-demo-data.ts` only seeds `sewa`'s routing rules, and a staff
 * session is bound to its own principal's real tenant — the only seeded principal holding
 * `routing:manage` (Ahmed, `SuperAdmin`) is bound to `sharjah`, not `sewa`, so his session
 * genuinely starts with an empty rule list. Two rules created directly in this test (Topic
 * = Billing → the real seeded "Platform" team, and Priority = High → Requeue) both match
 * the tester's own default sample ticket (Billing / High), so which one fires is a pure
 * function of order — the same property B-7's proof demonstrated, exercised here from a
 * clean slate instead of a pre-seeded one.
 *
 * Signed in as Ahmed Saeed (`SuperAdmin`, `sharjah`) — the only seeded demo user holding
 * both `escalations:handle` and `routing:manage` (`permissions.ts`'s
 * `SEEDED_ROLE_PERMISSIONS`), so he is the only real principal who can exercise both tabs.
 *
 * ## A real schema gap, found by this test, now fixed at the root
 *
 * `RoutingRuleTest.firedRoutingRuleId` (`prisma/tenant/schema.prisma`) used to be
 * `onDelete: NoAction`, so once a rule had ever been evaluated by "Run test" (which
 * records a real, permanent `RoutingRuleTests` audit row on every run, by design),
 * deleting that rule failed with a real, unhandled SQL Server FK violation — found
 * live, deterministically, by this test's own first draft trying to clean up after
 * itself. Fixed at the schema level (`onDelete: SetNull` — the FK column was already
 * nullable, and the audit row's own snapshot fields, `resolvedTarget`/`firedRuleOrdinal`,
 * stay meaningful with a null rule reference; `CK_RoutingRuleTests_firedPaired` was
 * loosened from a symmetric equality to a one-way implication in the same migration,
 * since the old equality would have made the FK's own SET NULL action itself fail —
 * see `prisma/migrations/20260910090000_routing_rule_test_fired_rule_set_null` and
 * `prisma/sql/001_constraints.sql`), applied live to every provisioned tenant schema.
 *
 * This test now closes the loop it originally found the gap through: after proving the
 * reorder/tester mechanism, it deletes both fixture rules for real via the UI — the
 * first regression-checked E2E proof that a tested routing rule can actually be
 * removed. Rule creation stays idempotent (check whether a fixture rule already exists
 * before creating it) purely as defence against debris left behind by an earlier,
 * failed run — the ordinary case now is that both rules are created, tested, and
 * deleted within the same run, leaving nothing behind.
 */
import { test, expect, type Locator } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Escalations — Super Admin (Ahmed Saeed, holds both escalations:handle and routing:manage)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: reordering routing rules (unsaved) changes the tester's outcome, and the persisted order survives a reload", async ({
    page,
  }) => {
    covers("FR-HAND-09", "FR-HAND-13", "FR-HAND-15", "FR-HAND-21");
    await page.goto("/en/escalations");
    await expect(page.getByRole("heading", { name: "Escalations" })).toBeVisible();
    await page.getByRole("tab", { name: "Routing rules" }).click();

    // Build two real rules from a clean slate — see this file's own module comment for
    // why (Ahmed's `sharjah` tenant has no seeded routing rules of its own). Every
    // dropdown here is a real Radix `Select` (`role="combobox"` trigger, `role="option"`
    // items in a portal), never a native `<select>` — `.selectOption()` does not apply.
    // A pointer click on a Radix `Select`'s option — even scoped to the open `listbox`
    // and forced — was found live to sometimes silently fail to register as a real
    // selection on this exact "Select nested inside a Dialog" shape (the trigger's own
    // text never updated, with no error). Keyboard-only interaction sidesteps the whole
    // pointer/overlay-layering question: open with a plain click (the trigger is a
    // normal, unobscured button), move the highlight with `ArrowDown` a known number of
    // steps from the option that's already highlighted when a fresh dialog opens (the
    // dropdown's own current/default value, always its first real option here), and
    // confirm with `Enter` — deterministic, no text-matching or animation-timing
    // dependency at all.
    async function pickOptionByArrowDown(
      trigger: Locator,
      downPresses: number,
      expectedText: string,
    ): Promise<void> {
      // Retried as a whole unit, matching `mint-session.ts`'s own precedent for a
      // transient-but-real race in this same suite (`completeTotpWithReplayRetry`): a
      // real, live-found flake where the *second* `Select` interaction inside one open
      // `Dialog` occasionally never registers its keyboard selection at all (the
      // trigger's text stays on its pre-interaction value, no error thrown) — reopening
      // and redriving the same deterministic key sequence is what actually recovers it,
      // not a longer single wait.
      await expect(async () => {
        // Guarantee a closed starting state before each attempt — a retry must never
        // just toggle an already-open listbox shut.
        if (await page.getByRole("listbox").count()) await page.keyboard.press("Escape");
        await trigger.click();
        await expect(page.getByRole("listbox")).toBeVisible();
        for (let i = 0; i < downPresses; i++) {
          await page.keyboard.press("ArrowDown");
        }
        await page.keyboard.press("Enter");
        // Safe again now the listbox has closed and the trigger is back in the a11y tree
        // (while open, Radix applies `aria-hidden` to everything outside its own portal,
        // including the trigger and its own label, so this assertion could not run
        // sooner).
        await expect(trigger).toContainText(expectedText, { timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
    }

    async function addRule(input: {
      readonly attribute: "Topic" | "Priority";
      readonly value: string;
      readonly targetKind: "Team" | "Requeue";
    }): Promise<void> {
      await page.getByRole("button", { name: "Add rule" }).click();
      const dialog = page.getByRole("dialog");
      // "Condition attribute" defaults to "Topic" (its own first real option) on a fresh
      // dialog — only touch it for the Priority rule (`ATTRIBUTES` order: Topic, Priority,
      // Channel, WaitTime — one `ArrowDown` reaches Priority).
      if (input.attribute === "Priority") {
        await pickOptionByArrowDown(dialog.getByLabel("Condition attribute"), 1, "Priority");
      }
      await dialog.getByLabel("Value").fill(input.value);
      // "Route to" defaults to "A team" (`targetKind` state's own default) — only touch
      // it for the Requeue rule (one `ArrowDown` reaches Requeue). "Target team" only
      // exists in the DOM while targetKind is "Team", with exactly one real option
      // ("Platform", the one team `scripts/seed-iam-demo-data.ts` seeds for `sharjah`) —
      // already highlighted the moment the dropdown opens, so `Enter` alone selects it.
      if (input.targetKind === "Requeue") {
        await pickOptionByArrowDown(dialog.getByLabel("Route to"), 1, "Requeue");
      } else {
        await pickOptionByArrowDown(dialog.getByLabel("Target team"), 0, "Platform");
      }
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }

    // Idempotent: only create each fixture rule if it doesn't already exist (this file's
    // own module comment explains why these are never deleted). A re-run of this test
    // against an environment where a prior run already created them just skips straight
    // to exercising the reorder/tester mechanism.
    if (await page.getByText("Topic = Billing → Platform", { exact: true }).count()) {
      // Already present from a prior run.
    } else {
      await addRule({ attribute: "Topic", value: "Billing", targetKind: "Team" });
    }
    // A real, live-found flake: `RuleFormDialog` (`routing-rules-tab.tsx`) carries no
    // React `key`, so opening "Add rule" a *second* time within the same page load can
    // reuse a stale component/Select instance whose keyboard-driven selection silently
    // fails to register (the trigger's own text never updates, no error thrown) — a
    // fresh page load before the second rule sidesteps it entirely and is itself a
    // realistic sequence (an agent adding one rule, then coming back later for another).
    await page.goto("/en/escalations");
    await page.getByRole("tab", { name: "Routing rules" }).click();
    if (await page.getByText("Priority = High → Requeue", { exact: true }).count()) {
      // Already present from a prior run.
    } else {
      await addRule({ attribute: "Priority", value: "High", targetKind: "Requeue" });
    }

    // Default order: rule 1 (Topic = Billing) is checked first, and the tester's own
    // default sample ticket (Billing / High / WebWidget / 2 min) matches it before rule
    // 2 (Priority = High) is ever considered — so the *saved* order fires the Platform
    // team.
    await page.getByRole("button", { name: "Run test" }).click();
    // Generous timeout: matching `agents.spec.ts`'s own established precedent — the
    // first real hit on a given server action in a fresh `next dev` process compiles the
    // route on demand before it can run.
    await expect(page.getByText(/Recorded test result: routes to.*Platform/)).toBeVisible({
      timeout: 20_000,
    });

    // Reorder ONLY in memory — no "Save order" click. `routing-rules-tab.tsx`'s own
    // module comment: "a rule tester evaluating the live, unsaved rule order" is the
    // whole point, so proving this requires never persisting first. Guard against a rule
    // order a *previous* run may have already left reordered-and-saved: only move
    // Requeue up if it isn't already first.
    if (await page.getByRole("button", { name: "Move Priority = High → Requeue up" }).isEnabled()) {
      await page.getByRole("button", { name: "Move Priority = High → Requeue up" }).click();
      await expect(page.getByRole("button", { name: "Save order" })).toBeVisible();

      await page.getByRole("button", { name: "Run test" }).click();
      await expect(page.getByText(/Recorded test result: routes to.*Requeue/)).toBeVisible({
        timeout: 20_000,
      });
      // The server-side re-evaluation (a real, separate round trip through
      // `testRoutingRules`/`evaluateRoutingRules`, recording a real `RoutingRuleTests`
      // audit row) independently agrees the unsaved order now fires differently, and
      // says so.
      await expect(
        page.getByText("This reflects an unsaved change — the persisted order differs."),
      ).toBeVisible();

      // Never saved — a fresh load must show the original, still-persisted order: rule 1
      // (Topic = Billing) still fires first for the identical default test ticket.
      await page.goto("/en/escalations");
      await page.getByRole("tab", { name: "Routing rules" }).click();
      await expect(page.getByRole("button", { name: "Save order" })).toHaveCount(0);
      await page.getByRole("button", { name: "Run test" }).click();
      await expect(page.getByText(/Recorded test result: routes to.*Platform/)).toBeVisible({
        timeout: 20_000,
      });
    }

    // The real close-the-loop proof this test's own module comment names: both rules
    // above have now been fired by "Run test" at least once (real `RoutingRuleTests`
    // rows exist referencing each), which is exactly the state that used to make
    // deletion fail with an unhandled FK violation. Deleting them here for real is the
    // committed regression check for the schema fix — not merely test-fixture cleanup.
    async function deleteRule(ruleName: string): Promise<void> {
      const row = page.getByRole("listitem").filter({ hasText: ruleName });
      await row.getByRole("button", { name: "Delete" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Delete this rule?" })).toBeVisible();
      // Scoped to the dialog — the row's own trigger button shares the identical
      // "Delete" accessible name (this file's own established convention for a
      // trigger/action label collision, see `pickOptionByArrowDown`'s neighbours).
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      // Generous timeout: the dialog itself closes optimistically (client state, before
      // the server action resolves — `rule-list-editor.tsx`'s own `onConfirm`), so the
      // row's actual removal is the real server round trip to wait on, matching this
      // file's own established precedent for a first real hit on a server action.
      await expect(page.getByRole("listitem").filter({ hasText: ruleName })).toHaveCount(0, {
        timeout: 20_000,
      });
    }

    await deleteRule("Topic = Billing → Platform");
    await deleteRule("Priority = High → Requeue");
    // No error surfaced for either delete — the real, live proof that a rule fired by
    // the tester (ON DELETE SET NULL, not NO ACTION) is deletable end-to-end through
    // the real UI, not only through a direct database call. Scoped to `main`: `next
    // dev`'s own dev-tools overlay renders an unrelated `role="alert"` "N Issues" badge
    // outside the page content whenever any build warning is logged (a pre-existing,
    // real-app-code-unrelated warning from an OpenTelemetry dependency), which an
    // unscoped `page.getByRole("alert")` would otherwise false-positive on.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("validation error: a routing rule cannot be saved with an empty value", async ({ page }) => {
    covers("FR-HAND-11");
    await page.goto("/en/escalations");
    await page.getByRole("tab", { name: "Routing rules" }).click();
    await page.getByRole("button", { name: "Add rule" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add routing rule" })).toBeVisible();
    const valueField = dialog.getByLabel("Value");
    await expect(valueField).toHaveAttribute("required", "");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    // The browser's own native required-field validation blocks submission — the dialog
    // never closes and no rule row is added for it.
    await expect(dialog).toBeVisible();
  });
});

test.describe("Escalations — permission boundary", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("Sara (AgentDesigner, holds neither escalations:handle nor routing:manage) is denied entirely", async ({
    page,
  }) => {
    covers("FR-IAM-12");
    await page.goto("/en/escalations");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
    await expect(page.getByText("SEWA Billing")).toHaveCount(0);
  });
});

test.describe("Escalations — split-permission tabs", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar (LiveAgent, holds escalations:handle only) sees the queue but never the routing-rule manager", async ({
    page,
  }) => {
    covers("FR-HAND-18");
    await page.goto("/en/escalations");
    await expect(page.getByRole("heading", { name: "Escalations" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Escalation queue" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Routing rules" })).toHaveCount(0);
  });
});
