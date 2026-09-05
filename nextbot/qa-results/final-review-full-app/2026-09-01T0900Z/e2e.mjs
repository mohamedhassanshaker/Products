import { chromium } from "file:///C:/Users/m.hassan/AppData/Local/npm-cache/_npx/bbb8a2c4738e2b0c/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const SHOTS = "qa-results/final-review-full-app/2026-09-01T0900Z/shots";
const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text()}`); });
page.on("pageerror", (e) => pageErrors.push(`${page.url()} :: ${e.message}`));

// ---- 1. Real login through the real form
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.screenshot({ path: `${SHOTS}/01-login.png` });
await page.fill('input[name="tenantSlug"], input[name="tenant"]', "demo").catch(() => {});
await page.fill('input[type="email"], input[name="email"]', "admin@demo.nextbot.local");
await page.fill('input[type="password"], input[name="password"]', "NextbotDemo!2026");
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|admin|\//, { timeout: 30000 }).catch(() => {});
await page.waitForLoadState("networkidle").catch(() => {});
console.log("AFTER_LOGIN_URL:", page.url());
await page.screenshot({ path: `${SHOTS}/02-after-login.png`, fullPage: true });

// ---- 2. DEFECT-1: real authenticated multipart upload
const uploadResult = await page.evaluate(async () => {
  const fd = new FormData();
  const content = "QA Final Review retry DEFECT-1 re-verification " + new Date().toISOString();
  fd.append("file", new Blob([content], { type: "text/markdown" }), "qa-defect1-reverify.md");
  const r = await fetch("/api/v1/admin/knowledge/upload", { method: "POST", body: fd });
  return { status: r.status, body: await r.text(), content };
});
console.log("UPLOAD_STATUS:", uploadResult.status);
console.log("UPLOAD_BODY:", uploadResult.body.slice(0, 500));
console.log("UPLOAD_CONTENT:", uploadResult.content);
fs.writeFileSync(`${SHOTS}/../upload-result.json`, JSON.stringify(uploadResult, null, 2));

// ---- 3. Walk every sidebar nav link (Chakra->shadcn smoke)
const links = await page.$$eval('nav a[href^="/"], aside a[href^="/"]', (as) =>
  [...new Set(as.map((a) => a.getAttribute("href")))].filter((h) => h && !h.startsWith("/api")),
);
console.log("NAV_LINK_COUNT:", links.length);
const navResults = [];
let i = 3;
for (const href of links) {
  const resp = await page.goto(BASE + href, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForLoadState("networkidle").catch(() => {});
  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  navResults.push({ href, status: resp ? resp.status() : "ERR", h1: (h1 || "").trim() });
  console.log(`NAV ${resp ? resp.status() : "ERR"} ${href} :: ${(h1 || "").trim()}`);
  if (!resp || resp.status() >= 400) {
    await page.screenshot({ path: `${SHOTS}/${String(i).padStart(2, "0")}-FAIL-${href.replace(/\W+/g, "-")}.png`, fullPage: true });
  }
  i++;
}
await page.screenshot({ path: `${SHOTS}/90-last-nav-page.png`, fullPage: true });
fs.writeFileSync(`${SHOTS}/../nav-results.json`, JSON.stringify(navResults, null, 2));

// ---- 4. Settings hub card count
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.screenshot({ path: `${SHOTS}/91-settings-hub.png`, fullPage: true });
const settingsLinks = await page.$$eval('main a[href^="/settings/"]', (as) => as.length);
console.log("SETTINGS_CARDS:", settingsLinks);

console.log("CONSOLE_ERRORS:", consoleErrors.length);
consoleErrors.slice(0, 20).forEach((e) => console.log("  CE:", e));
console.log("PAGE_ERRORS:", pageErrors.length);
pageErrors.slice(0, 20).forEach((e) => console.log("  PE:", e));
await browser.close();
