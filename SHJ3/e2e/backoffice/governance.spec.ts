/**
 * `e2e/backoffice/governance.spec.ts` — golden paths, a real validation error, and a
 * permission boundary for `/governance` (B14: Environments & promotions, Audit log,
 * Observability, Privacy & data). Gated on the single `governance:manage` permission,
 * granted only to `SuperAdmin`/`EntityAdmin` (`iam/domain/permissions.ts`'s
 * `RESTRICTED_PERMISSIONS`) — Ahmed Saeed is the only one of the three seeded sessions who
 * holds it.
 *
 * `tasks/todo.md`'s own B-9 review names the ONE live proof this screen already had before
 * this file existed: a real `ApprovePromotion` producing the atomic status-change +
 * `AuditLogEntries` write, and a real, refused self-approval attempt (FR-GOV-15, error
 * 51192) — both run through a throwaway script, not committed E2E ("no committed Playwright
 * e2e spec for `/evaluation`, `/governance`, or `/command-centre`" is literally item 8 of
 * that review's own honesty list). The golden paths below are DIFFERENT surfaces of this
 * same screen — Observability's "Recompute now" and Privacy & data's settings save — so
 * this file adds genuinely new coverage rather than re-proving the same promotion flow.
 *
 * The self-approval validation case below DOES reuse that same FR-GOV-15 rule, but proves
 * it for the first time through the real, running UI rather than a throwaway script. There
 * is, as of this wave, no "request a promotion" form anywhere in the shipped UI —
 * `environments-tab.tsx` wires `requestPromotionAction` into `GovernanceScreenActions` but
 * no button anywhere calls it (confirmed by reading the whole component). So this test's
 * `beforeAll` seeds exactly one real `PromotionRequests` row by spawning
 * `scripts/seed-self-approval-promotion.ts` under `tsx` — the same "real Prisma-touching
 * code runs under `tsx`, never under Playwright's own transform" boundary
 * `e2e/support/mint-session.ts`'s own module comment documents and `scripts/
 * mint-e2e-sessions.ts` already exercises for authentication. Once a real create-promotion
 * form ships, this seeding step can retire in favour of driving it through the browser too.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

// `__dirname`, not `import.meta.dirname`: Playwright transpiles spec files to CommonJS
// (confirmed directly — `import.meta` throws under it), matching `e2e/global-setup.ts`'s
// own identical finding for the same loader.
const ROOT = resolve(__dirname, "../..");
const isWindows = process.platform === "win32";

interface SeededPromotion {
  readonly promotionRequestId: string;
  readonly agentName: string;
  readonly versionLabel: string;
}

/** Runs `scripts/seed-self-approval-promotion.ts` under `tsx` and parses its one line of
 *  stdout JSON — see this file's own module comment for why this can't just be imported
 *  directly into a Playwright spec. */
function seedSelfApprovalPromotion(): SeededPromotion | null {
  const proc = spawnSync("pnpm", ["exec", "tsx", "scripts/seed-self-approval-promotion.ts"], {
    cwd: ROOT,
    shell: isWindows,
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error(
      `[governance.spec] seed-self-approval-promotion.ts failed (exit ${String(proc.status)}):\n` +
        `${proc.stdout}\n${proc.stderr}`,
    );
  }
  const lastLine = proc.stdout.trim().split("\n").at(-1) ?? "";
  const parsed: { ok: boolean; reason?: string } & Partial<SeededPromotion> = JSON.parse(lastLine);
  if (!parsed.ok) return null;
  return {
    promotionRequestId: parsed.promotionRequestId!,
    agentName: parsed.agentName!,
    versionLabel: parsed.versionLabel!,
  };
}

test.describe("Governance — Super Admin (Ahmed Saeed, sharjah, holds governance:manage)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: Privacy & data settings save persists a new residency choice", async ({
    page,
  }) => {
    covers("FR-GOV-25");
    await page.goto("/en/governance");
    await expect(page.getByRole("heading", { name: "Governance & ops" })).toBeVisible();
    await page.getByRole("tab", { name: "Privacy & data" }).click();

    // `SelectTrigger aria-labelledby="data-residency-label"` means this combobox's
    // accessible NAME is always the fixed label text ("Data residency"), never the
    // currently-selected value — the trigger's own visible text (checked below) is what
    // shows which option is selected.
    const residencyTrigger = page.getByRole("combobox", { name: "Data residency" });
    await residencyTrigger.click();
    await page.getByRole("option", { name: "Region-flexible" }).click({ force: true });
    await expect(residencyTrigger).toContainText("Region-flexible");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    // Reload to prove the residency choice is real, persisted state, not just a client
    // selection.
    await page.reload();
    await page.getByRole("tab", { name: "Privacy & data" }).click();
    await expect(page.getByRole("combobox", { name: "Data residency" })).toContainText(
      "Region-flexible",
    );
  });

  test("golden path: Observability's Recompute now populates real service-health rows", async ({
    page,
  }) => {
    covers("FR-GOV-18", "FR-GOV-19");
    await page.goto("/en/governance");
    await page.getByRole("tab", { name: "Observability" }).click();

    await page.getByRole("button", { name: "Recompute now" }).click();
    await expect(page.getByText("Sharjah Services Gateway (MCP)")).toBeVisible();
    await expect(page.getByText("Graph RAG retrieval")).toBeVisible();
  });

  test("validation error: a requester cannot approve their own promotion (FR-GOV-15)", async ({
    page,
  }) => {
    covers("FR-GOV-15");
    const seeded = seedSelfApprovalPromotion();
    test.skip(seeded === null, "No Published AgentVersion exists yet in sharjah to promote.");

    await page.goto("/en/governance");
    await expect(page.getByRole("heading", { name: "Governance & ops" })).toBeVisible();

    const pendingRow = page.locator("tr", {
      has: page.getByText(`${seeded!.agentName} ${seeded!.versionLabel}`),
    });
    await expect(pendingRow).toBeVisible();
    await pendingRow.getByRole("button", { name: "Approve" }).click();

    await expect(
      page.getByText("A requester cannot approve or reject their own promotion (FR-GOV-15)."),
    ).toBeVisible();

    // Refused means the request is still pending, not silently approved.
    await page.reload();
    await expect(
      page.locator("tr", { has: page.getByText(`${seeded!.agentName} ${seeded!.versionLabel}`) }),
    ).toBeVisible();
  });
});

test.describe("Governance — permission boundary (Sara, AgentDesigner)", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("Sara (AgentDesigner) is denied /governance entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/governance");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});

test.describe("Governance — permission boundary (Omar, LiveAgent)", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar (LiveAgent) is denied /governance entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/governance");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});
