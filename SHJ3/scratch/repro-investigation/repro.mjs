import { chromium } from "file:///D:/work/products/SHJ3/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs";
import { readFileSync } from "node:fs";

const AGENT_ID = "01M0Z65YPRFTA3GH9935XKNKGP";
const STORAGE_STATE = "D:/work/products/SHJ3/e2e/.auth/super-admin.json";
const BASE_URL = "http://localhost:3000";

const consoleMessages = [];
const pageErrors = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: JSON.parse(readFileSync(STORAGE_STATE, "utf8")),
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) PlaywrightE2E/1.0",
    extraHTTPHeaders: { "x-forwarded-for": "127.0.0.1" },
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text(), location: msg.location() });
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });

  const url = `${BASE_URL}/en/agents/${AGENT_ID}/edit`;
  console.log("Navigating to", url);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log("Current URL:", page.url());
  await page.screenshot({ path: "D:/work/products/SHJ3/scratch/repro-investigation/01-loaded.png", fullPage: false });

  // Try to click the "Flows" step in the wizard nav.
  const flowsCandidates = [
    page.getByRole("button", { name: /flows/i }),
    page.getByRole("tab", { name: /flows/i }),
    page.getByText(/^Flows$/i),
  ];
  let clicked = false;
  for (const cand of flowsCandidates) {
    try {
      if (await cand.first().isVisible({ timeout: 2000 })) {
        await cand.first().click();
        clicked = true;
        console.log("Clicked Flows step via candidate");
        break;
      }
    } catch {
      // try next
    }
  }
  console.log("Flows step clicked:", clicked);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: "D:/work/products/SHJ3/scratch/repro-investigation/02-flows-step.png", fullPage: false });

  // Look for the Next.js dev tools indicator (nextjs-portal custom element, shadow DOM).
  const portalCount = await page.locator("nextjs-portal").count();
  console.log("nextjs-portal element count:", portalCount);

  // Try to find an "Issue" badge/button by text, piercing shadow DOM via Playwright locators.
  let issueLocator = page.locator("text=/\\d+\\s+Issue/i");
  let issueCount = await issueLocator.count();
  console.log("Issue badge text matches:", issueCount);

  if (issueCount > 0) {
    const issueText = await issueLocator.first().textContent();
    console.log("Issue badge text:", issueText);
    try {
      await issueLocator.first().click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "D:/work/products/SHJ3/scratch/repro-investigation/03-issue-clicked.png", fullPage: false });
    } catch (e) {
      console.log("Could not click issue badge:", e.message);
    }
  }

  // Dump full accessibility tree text near nextjs-portal for diagnostics.
  try {
    const portalHTML = await page.evaluate(() => {
      const portal = document.querySelector("nextjs-portal");
      if (!portal) return null;
      const root = portal.shadowRoot;
      return root ? root.innerHTML.slice(0, 20000) : "no shadowRoot (closed?)";
    });
    console.log("=== nextjs-portal shadow DOM HTML (truncated) ===");
    console.log(portalHTML);
  } catch (e) {
    console.log("Error reading portal shadow DOM:", e.message);
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: "D:/work/products/SHJ3/scratch/repro-investigation/04-final.png", fullPage: true });

  console.log("=== CONSOLE MESSAGES ===");
  for (const m of consoleMessages) {
    console.log(`[${m.type}] ${m.text} @ ${m.location?.url}:${m.location?.lineNumber}`);
  }
  console.log("=== PAGE ERRORS ===");
  for (const e of pageErrors) {
    console.log(e.message);
    console.log(e.stack);
  }

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
