import { chromium } from "file:///D:/work/products/SHJ3/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs";
import { readFileSync } from "node:fs";

const AGENT_ID = "01M0Z65YPRFTA3GH9935XKNKGP";
const STORAGE_STATE = "D:/work/products/SHJ3/e2e/.auth/super-admin.json";
const BASE_URL = "http://localhost:3000";
const OUT = "D:/work/products/SHJ3/scratch/repro-investigation";

const consoleMessages = [];
const pageErrors = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: JSON.parse(readFileSync(STORAGE_STATE, "utf8")),
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) PlaywrightE2E/1.0",
    extraHTTPHeaders: { "x-forwarded-for": "127.0.0.1" },
    viewport: { width: 1512, height: 857 },
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text(), location: msg.location() });
    console.log(`[LIVE-CONSOLE:${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ message: err.message, stack: err.stack });
    console.log(`[LIVE-PAGEERROR] ${err.message}`);
  });

  const url = `${BASE_URL}/en/agents/${AGENT_ID}/edit`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  // Click Flows step (Radix Tabs renders these as role="tab", not role="button")
  const flowsTab = page.getByRole("tab", { name: /flows/i }).first();
  await flowsTab.click({ timeout: 10000 });
  await page.waitForTimeout(3000); // give React Flow / dev overlay time to settle

  await page.screenshot({ path: `${OUT}/r2-01-flows.png` });

  // Click a canvas node to see if it triggers anything (the Condition node "gfhfgh")
  try {
    await page.getByText("gfhfgh", { exact: true }).first().click({ timeout: 3000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/r2-02-after-node-click.png` });
  } catch (e) {
    console.log("Could not click condition node:", e.message);
  }

  // Try clicking the "N" devtools button (bottom-left) via shadow DOM piercing.
  // Next.js's dev indicator button typically has data-nextjs-dev-tools-button or similar.
  const clicked = await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    if (!portal || !portal.shadowRoot) return "no-portal-or-closed-shadow";
    const root = portal.shadowRoot;
    // Try a few likely selectors for the floating indicator trigger button.
    const candidates = [
      "[data-nextjs-dev-tools-button]",
      "[data-next-badge]",
      "[data-nextjs-toast]",
      "button[aria-label*='issue' i]",
      "button[aria-haspopup]",
      "button",
    ];
    for (const sel of candidates) {
      const el = root.querySelector(sel);
      if (el) {
        el.click();
        return `clicked:${sel}:${el.outerHTML.slice(0, 300)}`;
      }
    }
    return "no-button-found";
  });
  console.log("DevTools button click attempt:", clicked);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/r2-03-after-devtools-click.png`, fullPage: false });

  // Dump the full shadow DOM text content (not just HTML) looking for any issue count / labels.
  const shadowText = await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    if (!portal || !portal.shadowRoot) return null;
    return portal.shadowRoot.textContent?.slice(0, 5000) ?? "(empty textContent)";
  });
  console.log("=== nextjs-portal shadow text content ===");
  console.log(shadowText);

  // Also check for aria-live regions / toasts anywhere in light DOM.
  const bodyIssueMentions = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label], [title]"))
      .map((el) => el.getAttribute("aria-label") || el.getAttribute("title"))
      .filter((t) => t && /issue|error/i.test(t)),
  );
  console.log("=== light-DOM elements mentioning issue/error ===");
  console.log(JSON.stringify(bodyIssueMentions));

  console.log("=== FINAL CONSOLE MESSAGE COUNT ===", consoleMessages.length);
  console.log("=== FINAL PAGE ERROR COUNT ===", pageErrors.length);

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
