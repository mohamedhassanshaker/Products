/**
 * `e2e/backoffice/tools.spec.ts` — golden path, a real client-side validation error, and two
 * "action available, real dependency behaviour" assertions for `/tools` (B3 step 4 / B5).
 *
 * Signed in as Sara Al Mazrouei (`AgentDesigner`, `sewa` tenant) — `agents:manage` is the
 * only permission this whole screen ever checks (`tools/actions.ts`; there is no `tools:*`
 * permission key at all), and `scripts/seed-agents-tools-demo-data.ts` only seeds skills,
 * MCP servers, API connectors and circuit breakers into the `sewa` tenant, so Sara is the
 * only seeded principal who can see this screen's fixture data at all — `sharjah` (Ahmed's
 * tenant) has none of it.
 *
 * "Connect & discover" is a real, clickable action with a **real** outbound execution path
 * as of the B-MCP wave (`apps/ai`'s `tools_router.py`/`McpSdkClient` — see `docs/api.md`
 * §5.6/§9.12): this test now genuinely requires the `ai` Docker service to be running
 * (`docker compose up -d ai`, already the norm for this project's own live-verification
 * workflow), unlike before that wave, when the endpoint did not exist and the assertion was
 * on a documented stub response. The seeded "Sharjah Customs MCP" row's `authMode: "MutualTls"`
 * with `credentialSecretRef: "env:MCP_CUSTOMS_CERT"` — a variable this dev environment never
 * sets — makes a real, honest `auth` failure ("The server rejected these credentials.") the
 * deterministic real outcome, asserted below rather than the old stub text. "Test connection"
 * is still confirmed — by reading `TestApiConnector`'s own doc comment, not assumed — to have
 * no real outbound execution path yet ("Connection testing isn't wired up yet"); that
 * assertion is unchanged and needs no live `ai` service.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

test.describe("Tools — Agent Designer (Sara Al Mazrouei, sewa)", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("golden path: adding a native skill adds a catalogue row", async ({ page }) => {
    covers("FR-TOOL-01", "FR-TOOL-02");
    const skillName = `E2E Golden Path Skill ${Date.now()}`;

    await page.goto("/en/tools");
    await expect(page.getByRole("heading", { name: "Tools & MCP registry" })).toBeVisible();
    await page.getByRole("tab", { name: "Skills catalogue" }).click();

    await page.getByRole("button", { name: "Add native skill" }).click();
    await page.getByLabel("Name").fill(skillName);
    await page.getByLabel("Input schema (JSON)").fill('{"type":"object","properties":{}}');
    await page.getByRole("button", { name: "Create skill" }).click();

    await expect(page.getByText(skillName)).toBeVisible();
  });

  test("validation error: malformed JSON in the input schema is rejected client-side", async ({
    page,
  }) => {
    covers("FR-TOOL-01");
    await page.goto("/en/tools");
    await page.getByRole("tab", { name: "Skills catalogue" }).click();
    await page.getByRole("button", { name: "Add native skill" }).click();

    await page.getByLabel("Name").fill(`E2E Invalid Schema Skill ${Date.now()}`);
    await page.getByLabel("Input schema (JSON)").fill("{not valid json");
    await page.getByRole("button", { name: "Create skill" }).click();

    await expect(page.getByText("This is not valid JSON.")).toBeVisible();
  });

  test("MCP discovery is real and reports a genuine, honest auth failure for the unset-secret fixture", async ({
    page,
  }) => {
    covers("FR-TOOL-04");
    await page.goto("/en/tools");
    await page.getByRole("tab", { name: "MCP servers" }).click();
    // "Sharjah Customs MCP" (`MutualTls`, `credentialSecretRef: "env:MCP_CUSTOMS_CERT"` — a
    // variable this dev environment never sets) named explicitly rather than `.first()`, so
    // the assertion does not depend on the table's row order.
    const row = page.getByRole("row", { name: /Sharjah Customs MCP/ });
    await row.getByRole("button", { name: "Connect & discover" }).click();
    await expect(page.getByText("The server rejected these credentials.")).toBeVisible();
  });

  test("API connector testing is wired up but has no outbound path yet, and fails safely", async ({
    page,
  }) => {
    covers("FR-TOOL-09");
    await page.goto("/en/tools");
    await page.getByRole("tab", { name: "API connectors" }).click();
    await page.getByRole("button", { name: "Test connection" }).first().click();
    await expect(page.getByText(/Connection testing isn't wired up yet/)).toBeVisible();
  });

  test("the seeded SEWA bill API breaker renders its Open fallback state", async ({ page }) => {
    covers("FR-TOOL-13");
    await page.goto("/en/tools");
    await page.getByRole("tab", { name: "Resilience & fallbacks" }).click();
    await expect(page.getByText("Open — fallback active")).toBeVisible();
  });
});
