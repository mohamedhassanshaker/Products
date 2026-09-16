/**
 * `e2e/backoffice/knowledge.spec.ts` — golden path, a real server-side validation error,
 * and a permission boundary for `/knowledge` (B6: Knowledge / Graph RAG).
 *
 * Signed in as Ahmed Saeed (`SuperAdmin`, `sharjah`) — `knowledge:manage` is granted to
 * `SuperAdmin`/`EntityAdmin`/`KnowledgeManager` only (`permissions.ts`), and no
 * `KnowledgeManager` is among the three seeded E2E sessions, so Ahmed is the only real
 * seeded principal who can reach this screen at all.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Knowledge — Super Admin (Ahmed Saeed, holds knowledge:manage)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: adding a Document source with pasted text adds a real, indexed row", async ({
    page,
  }) => {
    covers("FR-KNOW-01", "FR-KNOW-02");
    const sourceName = `E2E Golden Path Source ${Date.now()}`;

    await page.goto("/en/knowledge");
    await expect(page.getByRole("heading", { name: "Knowledge / Graph RAG" })).toBeVisible();
    await page.getByRole("tab", { name: "Sources" }).click();

    // `createAction` (the trigger) and `createDialogSubmit` (the dialog's own submit
    // button) share the identical translated label "Add source" — `tasks/lessons.md`'s
    // own documented Playwright pitfall for this exact shape. Scope the trigger click to
    // the page (no dialog open yet) and the submit click to the dialog.
    await page.getByRole("button", { name: "Add source" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add source" })).toBeVisible();

    await dialog.getByLabel("Name").fill(sourceName);
    // Source type defaults to "Document" — the one type this wave fetches/chunks for
    // real, per `sources-tab.tsx`'s own module comment.
    await dialog
      .getByLabel("Pasted or uploaded text")
      .fill(
        "This is a real, pasted policy document for the E2E golden path. It is chunked and " +
          "indexed immediately on save, exactly like every other real Document source.",
      );
    await dialog.getByRole("button", { name: "Add source", exact: true }).click();

    const row = page.locator("tr", { has: page.getByText(sourceName) });
    await expect(row).toBeVisible();
  });

  test("validation error: chunk overlap greater than chunk size is rejected by the real server-side check", async ({
    page,
  }) => {
    covers("FR-KNOW-11");
    await page.goto("/en/knowledge");
    await page.getByRole("tab", { name: "Retrieval" }).click();

    await page.getByLabel("Chunk size (tokens)").fill("100");
    await page.getByLabel("Chunk overlap (tokens)").fill("500");
    await page.getByRole("button", { name: "Save configuration" }).click();

    await expect(page.getByText("Chunk overlap must be smaller than chunk size.")).toBeVisible();
  });
});

test.describe("Knowledge — permission boundary", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("Sara (AgentDesigner, no knowledge:manage) is denied entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/knowledge");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
    await expect(page.getByText("Knowledge sources")).toHaveCount(0);
  });
});
